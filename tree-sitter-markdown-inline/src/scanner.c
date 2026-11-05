#include "tree_sitter/parser.h"
#include "unicode.h"
#include "emphasis.h"
#include "inline-preparation.h"
#include <string.h>

#ifndef UNUSED
#ifdef _MSC_VER
#define UNUSED
#else
#define UNUSED __attribute__((unused))
#endif
#endif

// For explanation of the tokens see grammar.js
typedef enum {
    ERROR,
    TRIGGER_ERROR,
    CODE_SPAN_START,
    CODE_SPAN_CLOSE,
    OPEN_STAR_OPEN_0_EM,
    OPEN_STAR_OPEN_0_STRONG,
    OPEN_STAR_OPEN_1_EM,
    OPEN_STAR_OPEN_1_STRONG,
    OPEN_STAR_OPEN_2_EM,
    OPEN_STAR_OPEN_2_STRONG,
    OPEN_STAR_BOTH_0_EM,
    OPEN_STAR_BOTH_0_STRONG,
    OPEN_STAR_BOTH_1_EM,
    OPEN_STAR_BOTH_1_STRONG,
    OPEN_STAR_BOTH_2_EM,
    OPEN_STAR_BOTH_2_STRONG,
    OPEN_UNDERSCORE_OPEN_0_EM,
    OPEN_UNDERSCORE_OPEN_0_STRONG,
    OPEN_UNDERSCORE_OPEN_1_EM,
    OPEN_UNDERSCORE_OPEN_1_STRONG,
    OPEN_UNDERSCORE_OPEN_2_EM,
    OPEN_UNDERSCORE_OPEN_2_STRONG,
    OPEN_UNDERSCORE_BOTH_0_EM,
    OPEN_UNDERSCORE_BOTH_0_STRONG,
    OPEN_UNDERSCORE_BOTH_1_EM,
    OPEN_UNDERSCORE_BOTH_1_STRONG,
    OPEN_UNDERSCORE_BOTH_2_EM,
    OPEN_UNDERSCORE_BOTH_2_STRONG,
    LAST_TOKEN_WHITESPACE,
    LAST_TOKEN_PUNCTUATION,
    LAST_TOKEN_OTHER,
    STRIKETHROUGH_OPEN,
    STRIKETHROUGH_CLOSE,
    LATEX_SPAN_START,
    LATEX_SPAN_CLOSE,
    UNCLOSED_SPAN,
    NONBLANK_LINK_TEXT,
    TAG,
    IN_LINK_TEXT,
    LAST_TOKEN_BOUNDARY,
    LITERAL_DELIMITER,
    PREPARE_INLINE,
    BARE_URI_AUTOLINK,
    BARE_EMAIL_AUTOLINK,
    PARENT_ROOT,
    PARENT_STAR_OPEN_0,
    PARENT_STAR_OPEN_1,
    PARENT_STAR_OPEN_2,
    PARENT_STAR_BOTH_0,
    PARENT_STAR_BOTH_1,
    PARENT_STAR_BOTH_2,
    PARENT_UNDERSCORE_OPEN_0,
    PARENT_UNDERSCORE_OPEN_1,
    PARENT_UNDERSCORE_OPEN_2,
    PARENT_UNDERSCORE_BOTH_0,
    PARENT_UNDERSCORE_BOTH_1,
    PARENT_UNDERSCORE_BOTH_2,
    PARENT_EM,
    PARENT_STRONG,
    BARE_AUTOLINKS_ENABLED,
    CLOSE_STAR_EM,
    CLOSE_STAR_STRONG,
    CLOSE_UNDERSCORE_EM,
    CLOSE_UNDERSCORE_STRONG,
    RAW_STAR,
    RAW_UNDERSCORE,
    IMAGE_TEXT_START,
    IMAGE_TEXT_END,
    STRIKETHROUGH_OPEN_DOUBLE,
    STRIKETHROUGH_CLOSE_DOUBLE,
    RAW_TILDE,
    PARENT_TILDE_SINGLE,
    PARENT_TILDE_DOUBLE,
    STRIKETHROUGH_ENABLED,
    STRIKETHROUGH_OPEN_BOTH,
    STRIKETHROUGH_OPEN_DOUBLE_BOTH,
    PARENT_TILDE_SINGLE_BOTH,
    PARENT_TILDE_DOUBLE_BOTH,
    LAST_TOKEN_ESCAPED_TILDE,
} TokenType;

// Convenience function to emit the error token. This is done to stop invalid
// parse branches. Specifically:
// 1. When encountering a newline after a line break that ended a paragraph, and
// no new block
//    has been opened.
// 2. When encountering a new block after a soft line break.
// 3. When a `$._trigger_error` token is valid, which is used to stop parse
// branches through
//    normal tree-sitter grammar rules.
//
// See also the `$._soft_line_break` and `$._paragraph_end_newline` tokens in
// grammar.js
static bool error(TSLexer *lexer) {
    lexer->result_symbol = ERROR;
    return true;
}

typedef struct {
    uint8_t code_span_delimiter_length;
    uint8_t latex_span_delimiter_length;
    uint8_t dialect_flags;
    uint16_t impossible_openers;
    uint16_t unmatched_openers[29];
    uint32_t next_matched_marker[29][8];
    uint32_t marker_ordinal;
    // Derived cache-row index; never part of the serialized state. A set bit
    // may conservatively name an empty row until the next serialization.
    uint32_t proof_contexts;
    uint8_t previous_flank;
    uint8_t delimiter_flank;
    uint8_t parent_context;
    uint32_t image_text_depth;
    bool prepared;
    int32_t pending_delimiter;
    uint32_t pending_count;
    uint8_t pending_modulo;
    bool pending_can_open;
    bool pending_can_close;
    uint8_t pending_opening_phase;
    InlineTokenPreparation preparation;
} Scanner;

static unsigned serialize(Scanner *s, char *buffer) {
    // Sparse proof caches keep ordinary states small. Drop optional cache
    // entries when needed to fit Tree-sitter's 1024-byte limit; delimiter
    // metadata is always retained, and dropped proofs only cost lookahead.
    unsigned masks = 0;
    unsigned boundaries = 0;
    uint32_t live_contexts = 0;
    for (unsigned index = 0, contexts = s->proof_contexts; index < 29 && contexts; index++, contexts >>= 1) {
        if (!(contexts & 1)) continue;
        masks += s->unmatched_openers[index] != 0;
        unsigned old_boundaries = boundaries;
        for (unsigned bit = 0; bit < 8; bit++) {
            if (s->next_matched_marker[index][bit] <= s->marker_ordinal) s->next_matched_marker[index][bit] = 0;
            boundaries += s->next_matched_marker[index][bit] != 0;
        }
        if (s->unmatched_openers[index] || boundaries != old_boundaries) live_contexts |= UINT32_C(1) << index;
    }
    if (!boundaries) s->marker_ordinal = 0;
    unsigned size = 0;
    buffer[size++] = (char)s->code_span_delimiter_length;
    buffer[size++] = (char)s->latex_span_delimiter_length;
    buffer[size++] = (char)s->dialect_flags;
    for (unsigned shift = 0; shift < 16; shift += 8) buffer[size++] = (char)((uint32_t)s->impossible_openers >> shift);
    buffer[size++] = (char)s->previous_flank;
    buffer[size++] = (char)s->delimiter_flank;
    buffer[size++] = (char)s->parent_context;
    for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)((uint32_t)s->image_text_depth >> shift);
    buffer[size++] = (char)s->prepared;
    for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)((uint32_t)s->pending_delimiter >> shift);
    for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)((uint32_t)s->pending_count >> shift);
    buffer[size++] = (char)s->pending_modulo;
    buffer[size++] = (char)s->pending_can_open;
    buffer[size++] = (char)s->pending_can_close;
    buffer[size++] = (char)s->pending_opening_phase;
    buffer[size++] = (char)s->preparation.role;
    buffer[size++] = (char)s->preparation.kind;
    for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)((uint32_t)s->preparation.delimiter >> shift);
    for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)((uint32_t)s->preparation.length >> shift);
    buffer[size++] = (char)s->preparation.original_can_open;
    buffer[size++] = (char)s->preparation.original_can_close;
    buffer[size++] = (char)s->preparation.original_modulo;
    for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)((uint32_t)s->preparation.next_remaining >> shift);
    buffer[size++] = (char)s->preparation.next_opening_phase;
    buffer[size++] = (char)s->preparation.ending_flank;
    buffer[size++] = (char)s->preparation.ending_boundary;
    buffer[size++] = (char)masks;
    for (unsigned index = 0, contexts = live_contexts; index < 29 && contexts; index++, contexts >>= 1) {
        if (!(contexts & 1)) continue;
        if (!s->unmatched_openers[index]) continue;
        buffer[size++] = (char)index;
        buffer[size++] = (char)s->unmatched_openers[index];
        buffer[size++] = (char)(s->unmatched_openers[index] >> 8);
    }
    unsigned boundary_count_position = size++;
    unsigned stored_boundaries = 0;
    uint32_t stored_contexts = 0;
    for (unsigned index = 0, contexts = live_contexts; index < 29 && contexts; index++, contexts >>= 1) {
        if (!(contexts & 1)) continue;
        uint32_t context_bit = UINT32_C(1) << index;
        if (s->unmatched_openers[index]) stored_contexts |= context_bit;
        for (unsigned bit = 0; bit < 8; bit++) {
            if (!s->next_matched_marker[index][bit]) continue;
            if (size + 9 > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
                s->next_matched_marker[index][bit] = 0;
                continue;
            }
            buffer[size++] = (char)(index * 8 + bit);
            for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)(s->next_matched_marker[index][bit] >> shift);
            stored_boundaries++;
            stored_contexts |= context_bit;
        }
    }
    s->proof_contexts = stored_contexts;
    buffer[boundary_count_position] = (char)stored_boundaries;
    for (unsigned shift = 0; shift < 32; shift += 8) buffer[size++] = (char)(s->marker_ordinal >> shift);
    return size;
}

static void deserialize(Scanner *s, const char *buffer, unsigned length) {
    *s = (Scanner){.previous_flank = 1, .delimiter_flank = 1};
    if (length < 51 || length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) return;
    unsigned size = 0;
    uint32_t proof_contexts = 0;
    s->code_span_delimiter_length = (uint8_t)(uint8_t)buffer[size++];
    s->latex_span_delimiter_length = (uint8_t)(uint8_t)buffer[size++];
    s->dialect_flags = (uint8_t)buffer[size++];
    for (unsigned shift = 0; shift < 16; shift += 8) s->impossible_openers |= (uint16_t)((uint32_t)(uint8_t)buffer[size++] << shift);
    s->previous_flank = (uint8_t)(uint8_t)buffer[size++];
    s->delimiter_flank = (uint8_t)buffer[size++];
    s->parent_context = (uint8_t)(uint8_t)buffer[size++];
    for (unsigned shift = 0; shift < 32; shift += 8) s->image_text_depth |= (uint32_t)((uint32_t)(uint8_t)buffer[size++] << shift);
    s->prepared = (bool)(uint8_t)buffer[size++];
    for (unsigned shift = 0; shift < 32; shift += 8) s->pending_delimiter |= (int32_t)((uint32_t)(uint8_t)buffer[size++] << shift);
    for (unsigned shift = 0; shift < 32; shift += 8) s->pending_count |= (uint32_t)((uint32_t)(uint8_t)buffer[size++] << shift);
    s->pending_modulo = (uint8_t)(uint8_t)buffer[size++];
    s->pending_can_open = (bool)(uint8_t)buffer[size++];
    s->pending_can_close = (bool)(uint8_t)buffer[size++];
    s->pending_opening_phase = (uint8_t)buffer[size++];
    s->preparation.role = (InlineTokenRole)(uint8_t)buffer[size++];
    s->preparation.kind = (BareAutolinkKind)(uint8_t)buffer[size++];
    for (unsigned shift = 0; shift < 32; shift += 8) s->preparation.delimiter |= (int32_t)((uint32_t)(uint8_t)buffer[size++] << shift);
    for (unsigned shift = 0; shift < 32; shift += 8) s->preparation.length |= (uint32_t)((uint32_t)(uint8_t)buffer[size++] << shift);
    s->preparation.original_can_open = (bool)(uint8_t)buffer[size++];
    s->preparation.original_can_close = (bool)(uint8_t)buffer[size++];
    s->preparation.original_modulo = (uint8_t)(uint8_t)buffer[size++];
    for (unsigned shift = 0; shift < 32; shift += 8) s->preparation.next_remaining |= (uint32_t)((uint32_t)(uint8_t)buffer[size++] << shift);
    s->preparation.next_opening_phase = (uint8_t)buffer[size++];
    s->preparation.ending_flank = (uint8_t)(uint8_t)buffer[size++];
    s->preparation.ending_boundary = (bool)(uint8_t)buffer[size++];
    unsigned masks = (uint8_t)buffer[size++];
    if (masks > 29 || size + masks * 3 + 5 > length) goto invalid;
    for (unsigned entry = 0; entry < masks; entry++) {
        unsigned index = (uint8_t)buffer[size++];
        if (index >= 29) goto invalid;
        proof_contexts |= UINT32_C(1) << index;
        s->unmatched_openers[index] = (uint16_t)(uint8_t)buffer[size++];
        s->unmatched_openers[index] |= (uint16_t)((uint16_t)(uint8_t)buffer[size++] << 8);
    }
    unsigned boundaries = (uint8_t)buffer[size++];
    if (boundaries > 232 || size + boundaries * 5 + 4 != length) goto invalid;
    for (unsigned entry = 0; entry < boundaries; entry++) {
        unsigned index = (uint8_t)buffer[size++];
        if (index >= 232) goto invalid;
        proof_contexts |= UINT32_C(1) << (index / 8);
        for (unsigned shift = 0; shift < 32; shift += 8) s->next_matched_marker[index / 8][index % 8] |= (uint32_t)(uint8_t)buffer[size++] << shift;
    }
    for (unsigned shift = 0; shift < 32; shift += 8) s->marker_ordinal |= (uint32_t)(uint8_t)buffer[size++] << shift;
    s->proof_contexts = proof_contexts;
    if (s->dialect_flags < 4 && s->parent_context < 29 && s->previous_flank < 4 && s->delimiter_flank < 4 && s->pending_modulo < 3 &&
        s->preparation.original_modulo < 3 && s->preparation.ending_flank < 4 &&
        s->pending_opening_phase <= INLINE_OPENING_STRONG_REMAINDER &&
        s->preparation.next_opening_phase <= INLINE_OPENING_STRONG_REMAINDER &&
        (s->pending_opening_phase != INLINE_OPENING_STRONG_REMAINDER || s->pending_count % 2 == 0) &&
        (s->preparation.next_opening_phase != INLINE_OPENING_STRONG_REMAINDER ||
         (s->preparation.next_remaining % 2 == 0 &&
          (s->preparation.delimiter == '*' || s->preparation.delimiter == '_'))) &&
        s->preparation.role <= INLINE_TOKEN_CLOSE && s->preparation.kind <= BARE_AUTOLINK_EMAIL &&
        (s->preparation.role == INLINE_TOKEN_NONE || s->preparation.length > 0) &&
        (s->preparation.role != INLINE_TOKEN_BARE || s->preparation.kind != BARE_AUTOLINK_NONE) &&
        ((s->preparation.role != INLINE_TOKEN_OPEN && s->preparation.role != INLINE_TOKEN_CLOSE) ||
         s->preparation.length == 1 || s->preparation.length == 2) &&
        (!s->pending_count || s->pending_delimiter == '*' || s->pending_delimiter == '_') &&
        (s->preparation.role < INLINE_TOKEN_RAW || s->preparation.delimiter == '*' || s->preparation.delimiter == '_' || s->preparation.delimiter == '~')) return;
invalid:
    *s = (Scanner){.previous_flank = 1, .delimiter_flank = 1};
}

static bool parse_leaf_delimiter(TSLexer *lexer, uint8_t *delimiter_length,
                                 const bool *valid_symbols,
                                 const char delimiter,
                                 const TokenType open_token,
                                 const TokenType close_token) {
    uint8_t level = 0;
    while (lexer->lookahead == delimiter) {
        lexer->advance(lexer, false);
        level++;
    }
    lexer->mark_end(lexer);
    if (level == *delimiter_length && valid_symbols[close_token]) {
        *delimiter_length = 0;
        lexer->result_symbol = close_token;
        return true;
    }
    if (valid_symbols[open_token]) {
        // Parse ahead to check if there is a closing delimiter
        size_t close_level = 0;
        unsigned bracket_depth = 0;
        while (!lexer->eof(lexer)) {
            if (lexer->lookahead == delimiter) {
                close_level++;
            } else {
                if (close_level == level) {
                    // Found a matching delimiter
                    break;
                }
                if (delimiter == '$') {
                    if (lexer->lookahead == '\\') {
                        lexer->advance(lexer, false);
                        if (!lexer->eof(lexer)) lexer->advance(lexer, false);
                        close_level = 0;
                        continue;
                    }
                    if (valid_symbols[IN_LINK_TEXT]) {
                        if (lexer->lookahead == '[') bracket_depth++;
                        if (lexer->lookahead == ']') {
                            if (bracket_depth == 0) break;
                            bracket_depth--;
                        }
                    }
                }
                close_level = 0;
            }
            lexer->advance(lexer, false);
        }
        if (close_level == level) {
            *delimiter_length = level;
            lexer->result_symbol = open_token;
            return true;
        }
        if (valid_symbols[UNCLOSED_SPAN]) {
            lexer->result_symbol = UNCLOSED_SPAN;
            return true;
        }
    }
    return false;
}

static bool parse_backtick(Scanner *s, TSLexer *lexer,
                           const bool *valid_symbols) {
    return parse_leaf_delimiter(lexer, &s->code_span_delimiter_length,
                                valid_symbols, '`', CODE_SPAN_START,
                                CODE_SPAN_CLOSE);
}

static bool parse_dollar(Scanner *s, TSLexer *lexer,
                         const bool *valid_symbols) {
    return parse_leaf_delimiter(lexer, &s->latex_span_delimiter_length,
                                valid_symbols, '$', LATEX_SPAN_START,
                                LATEX_SPAN_CLOSE);
}

static void capture_parent(Scanner *s, const bool *valid_symbols) {
    for (unsigned token = PARENT_STAR_OPEN_0; token <= PARENT_UNDERSCORE_BOTH_2; token++) {
        if (!valid_symbols[token]) continue;
        unsigned unit = valid_symbols[PARENT_STRONG] ? 2 : valid_symbols[PARENT_EM] ? 1 : s->parent_context ? (s->parent_context - 1) % 2 + 1 : 1;
        s->parent_context = (uint8_t)((token - PARENT_STAR_OPEN_0) * 2 + unit);
        return;
    }
    if (valid_symbols[PARENT_TILDE_SINGLE] || valid_symbols[PARENT_TILDE_DOUBLE] ||
        valid_symbols[PARENT_TILDE_SINGLE_BOTH] || valid_symbols[PARENT_TILDE_DOUBLE_BOTH]) {
        s->parent_context = valid_symbols[PARENT_TILDE_DOUBLE_BOTH] ? 28 :
            valid_symbols[PARENT_TILDE_SINGLE_BOTH] ? 27 : valid_symbols[PARENT_TILDE_DOUBLE] ? 26 : 25;
        return;
    }
    if (valid_symbols[PARENT_ROOT]) s->parent_context = 0;
}

static bool image_has_closer(TSLexer *lexer) {
    EmphasisLookahead input = {.lexer = lexer};
    input.characters = emphasis_grow(NULL, &input.capacity, 1, sizeof(int32_t));
    input.characters[0] = '[';
    input.length = 1;
    bool nonblank;
    size_t end = emphasis_bracket_end(&input, 0, &nonblank);
    free(input.characters);
    return end != 0;
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[TRIGGER_ERROR]) return error(lexer);
    if (valid_symbols[STRIKETHROUGH_ENABLED]) s->dialect_flags |= 1;
    if (valid_symbols[BARE_AUTOLINKS_ENABLED]) s->dialect_flags |= 3;
    const unsigned ghosts[] = {LAST_TOKEN_OTHER, LAST_TOKEN_WHITESPACE, LAST_TOKEN_PUNCTUATION, LAST_TOKEN_BOUNDARY};
    for (uint8_t flank = 0; flank < 4; flank++) {
        if (valid_symbols[ghosts[flank]] && (s->previous_flank != flank || s->delimiter_flank != flank || s->prepared)) {
            s->previous_flank = flank;
            s->delimiter_flank = flank;
            s->prepared = false;
            lexer->result_symbol = ghosts[flank];
            return true;
        }
    }
    if (valid_symbols[LAST_TOKEN_ESCAPED_TILDE] &&
        (s->previous_flank != 3 || s->delimiter_flank != 2 || s->prepared)) {
        s->previous_flank = 3;
        s->delimiter_flank = 2;
        s->prepared = false;
        lexer->result_symbol = LAST_TOKEN_ESCAPED_TILDE;
        return true;
    }
    if (valid_symbols[IMAGE_TEXT_END] && s->image_text_depth) {
        s->image_text_depth--;
        s->prepared = false;
        lexer->result_symbol = IMAGE_TEXT_END;
        return true;
    }
    if (valid_symbols[IMAGE_TEXT_START] && lexer->lookahead != ']') {
        if (lexer->eof(lexer)) return false;
        lexer->mark_end(lexer);
        bool valid = image_has_closer(lexer);
        if (valid) {
            if (s->image_text_depth == UINT32_MAX) abort();
            s->image_text_depth++;
            s->prepared = false;
            lexer->result_symbol = IMAGE_TEXT_START;
            return true;
        }
        if (valid_symbols[PREPARE_INLINE]) {
            capture_parent(s, valid_symbols);
            s->prepared = false;
            s->preparation = (InlineTokenPreparation){0};
            lexer->result_symbol = PREPARE_INLINE;
            return true;
        }
        return false;
    }
    int32_t first = lexer->lookahead;
    // Ordinary internal tokens need no preparation. A NONE probe can return
    // false safely for these candidates because their fallback is internal
    // text, not another external leaf token such as a code-span delimiter.
    // Prepared tokens stay at the same source position until commitment;
    // real flank ghosts invalidate rejected plans after internal tokens.
    // Do not use get_column as a position key: it rescans a long source line.
    bool candidate = first == '*' || first == '_' || (first == '~' && (s->dialect_flags & 1)) ||
        ((s->dialect_flags & 2) &&
         (bare_autolink_alnum(first) || first == '.' || first == '-' || first == '+'));
    if (valid_symbols[PREPARE_INLINE] && !lexer->eof(lexer) && candidate && !s->prepared) {
        capture_parent(s, valid_symbols);
        lexer->mark_end(lexer);
        unsigned frame = s->parent_context ? s->parent_context - 1 : 0;
        unsigned parent_unit = s->parent_context > 24 ? (s->parent_context - 25u) % 2 + 1 :
            s->parent_context ? frame % 2 + 1 : 0;
        InlineTokenOptions options = {
            .prev_whitespace = s->delimiter_flank == 1,
            .prev_punctuation = s->delimiter_flank >= 2,
            .left_boundary = s->previous_flank == 1 || s->previous_flank == 3,
            .bare_autolinks = (s->dialect_flags & 2) && !valid_symbols[IN_LINK_TEXT],
            .strikethrough = s->dialect_flags & 1,
            .parent_delimiter = s->parent_context > 24 ? '~' : s->parent_context ? (frame / 12 ? '_' : '*') : 0,
            .parent_modulo = s->parent_context > 24 ? parent_unit : frame % 6 / 2,
            .parent_can_close = s->parent_context > 24 ? s->parent_context > 26 : frame % 12 >= 6,
            .parent_unit = parent_unit,
            .in_link_text = s->image_text_depth || valid_symbols[IN_LINK_TEXT],
            .pending_active = s->pending_count != 0,
            .pending_delimiter = s->pending_delimiter,
            .pending_count = s->pending_count,
            .pending_modulo = s->pending_modulo,
            .pending_can_open = s->pending_can_open,
            .pending_can_close = s->pending_can_close,
            .pending_opening_phase = s->pending_opening_phase,
            .impossible_openers = &s->impossible_openers,
            .unmatched_root_openers = &s->unmatched_openers[s->parent_context],
            .next_matched_marker = s->next_matched_marker[s->parent_context],
            .marker_ordinal = s->marker_ordinal,
        };
        s->proof_contexts |= UINT32_C(1) << s->parent_context;
        s->preparation = prepare_inline_token(lexer, options);
        if (s->preparation.role == INLINE_TOKEN_NONE) return false;
        s->prepared = true;
        lexer->result_symbol = PREPARE_INLINE;
        return true;
    }
    if (s->prepared && s->preparation.role != INLINE_TOKEN_NONE) {
        InlineTokenPreparation *plan = &s->preparation;
        unsigned token;
        if (plan->role == INLINE_TOKEN_BARE) token = plan->kind == BARE_AUTOLINK_URI ? BARE_URI_AUTOLINK : BARE_EMAIL_AUTOLINK;
        else if (plan->delimiter == '~') token = plan->role == INLINE_TOKEN_RAW ? RAW_TILDE :
            plan->role == INLINE_TOKEN_CLOSE ? (plan->length == 2 ? STRIKETHROUGH_CLOSE_DOUBLE : STRIKETHROUGH_CLOSE) :
            plan->original_can_close ? (plan->length == 2 ? STRIKETHROUGH_OPEN_DOUBLE_BOTH : STRIKETHROUGH_OPEN_BOTH) :
            (plan->length == 2 ? STRIKETHROUGH_OPEN_DOUBLE : STRIKETHROUGH_OPEN);
        else if (plan->role == INLINE_TOKEN_RAW) token = plan->delimiter == '*' ? RAW_STAR : RAW_UNDERSCORE;
        else if (plan->role == INLINE_TOKEN_CLOSE) token = (plan->delimiter == '*' ? CLOSE_STAR_EM : CLOSE_UNDERSCORE_EM) + (plan->length == 2);
        else token = (plan->delimiter == '*' ? OPEN_STAR_OPEN_0_EM : OPEN_UNDERSCORE_OPEN_0_EM) + (plan->original_can_close ? 6 : 0) + plan->original_modulo * 2 + (plan->length == 2);
        if (!valid_symbols[token]) return false;
        for (uint32_t index = 0; index < plan->length; index++) {
            if (lexer->eof(lexer)) return false;
            lexer->advance(lexer, false);
        }
        lexer->mark_end(lexer);
        lexer->result_symbol = token;
        if ((plan->delimiter == '*' || plan->delimiter == '~') && !s->pending_count) {
            if (s->marker_ordinal == UINT32_MAX) abort();
            s->marker_ordinal++;
        }
        s->prepared = false;
        s->previous_flank = plan->ending_boundary ? 3 : plan->ending_flank;
        if (plan->delimiter != '~') s->delimiter_flank = s->previous_flank;
        s->pending_delimiter = plan->delimiter;
        s->pending_count = plan->next_remaining;
        s->pending_can_open = plan->original_can_open;
        s->pending_can_close = plan->original_can_close;
        s->pending_modulo = plan->original_modulo;
        s->pending_opening_phase = plan->next_opening_phase;
        if (plan->role == INLINE_TOKEN_CLOSE) {
            s->unmatched_openers[s->parent_context] = 0;
            memset(s->next_matched_marker[s->parent_context], 0, sizeof(s->next_matched_marker[0]));
            s->proof_contexts &= ~(UINT32_C(1) << s->parent_context);
        }
        if (plan->role == INLINE_TOKEN_OPEN) {
            // Modulo-zero emphasis has identical pairing eligibility in
            // OPEN/BOTH modes and shares one grammar context. Normalize its
            // cache lifetime key at entry to match the FOLLOW context.
            unsigned frame = (plan->delimiter == '_' ? 6 : 0) +
                (plan->original_can_close && plan->original_modulo != 0 ? 3 : 0) + plan->original_modulo;
            s->parent_context = (uint8_t)(plan->delimiter == '~' ? 24 + plan->length + (plan->original_can_close ? 2 : 0) : frame * 2 + plan->length);
            s->unmatched_openers[s->parent_context] = 0;
            memset(s->next_matched_marker[s->parent_context], 0, sizeof(s->next_matched_marker[0]));
            s->proof_contexts &= ~(UINT32_C(1) << s->parent_context);
        }
        return true;
    }
    s->prepared = false;
    if (valid_symbols[NONBLANK_LINK_TEXT] && lexer->lookahead == '[') {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        while (!lexer->eof(lexer) && is_unicode_whitespace(lexer->lookahead)) lexer->advance(lexer, false);
        if (!lexer->eof(lexer) && lexer->lookahead != ']') {
            lexer->result_symbol = NONBLANK_LINK_TEXT;
            return true;
        }
        return false;
    }
    switch (lexer->lookahead) {
        case '#': {
            if (!valid_symbols[TAG] || s->previous_flank != 1) return false;
            lexer->advance(lexer, false);
            bool non_numeric = false;
            while (!lexer->eof(lexer)) {
                int32_t c = lexer->lookahead;
                bool letter = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '-' || c == '/';
                if (!letter && !(c >= '0' && c <= '9')) break;
                non_numeric |= letter;
                lexer->advance(lexer, false);
            }
            if (!non_numeric) return false;
            lexer->result_symbol = TAG;
            return true;
        }
        case '`': return parse_backtick(s, lexer, valid_symbols);
        case '$': return parse_dollar(s, lexer, valid_symbols);
        case '~': case '*': case '_': {
            int32_t delimiter = lexer->lookahead;
            unsigned token = delimiter == '~' ? RAW_TILDE : delimiter == '*' ? RAW_STAR : RAW_UNDERSCORE;
            if (!valid_symbols[token]) return false;
            do { lexer->advance(lexer, false); } while (lexer->lookahead == delimiter);
            lexer->mark_end(lexer);
            lexer->result_symbol = token;
            if ((delimiter == '*' || delimiter == '~') && !s->pending_count) {
                if (s->marker_ordinal == UINT32_MAX) abort();
                s->marker_ordinal++;
            }
            s->pending_count = 0;
            s->previous_flank = 3;
            if (delimiter != '~') s->delimiter_flank = 3;
            return true;
        }
    }
    return false;
}

void *tree_sitter_markdown_inline_external_scanner_create() {
    Scanner *s = (Scanner *)malloc(sizeof(Scanner));
    deserialize(s, NULL, 0);
    return s;
}

bool tree_sitter_markdown_inline_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;
    return scan(scanner, lexer, valid_symbols);
}

unsigned tree_sitter_markdown_inline_external_scanner_serialize(void *payload,
                                                                char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    return serialize(scanner, buffer);
}

void tree_sitter_markdown_inline_external_scanner_deserialize(void *payload,
                                                              const char *buffer,
                                                              unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    deserialize(scanner, buffer, length);
}

void tree_sitter_markdown_inline_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    free(scanner);
}
