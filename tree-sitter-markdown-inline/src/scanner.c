#include "tree_sitter/parser.h"
#include "unicode.h"

#ifdef _MSC_VER
#define UNUSED
#else
#define UNUSED __attribute__((unused))
#endif

// For explanation of the tokens see grammar.js
typedef enum {
    ERROR,
    TRIGGER_ERROR,
    CODE_SPAN_START,
    CODE_SPAN_CLOSE,
    EMPHASIS_OPEN_STAR,
    EMPHASIS_OPEN_UNDERSCORE,
    EMPHASIS_CLOSE_STAR,
    EMPHASIS_CLOSE_UNDERSCORE,
    LAST_TOKEN_WHITESPACE,
    LAST_TOKEN_PUNCTUATION,
    STRIKETHROUGH_OPEN,
    STRIKETHROUGH_CLOSE,
    LATEX_SPAN_START,
    LATEX_SPAN_CLOSE,
    UNCLOSED_SPAN,
    NONBLANK_LINK_TEXT,
    TAG,
    IN_LINK_TEXT
} TokenType;

// State bitflags used with `Scanner.state`

// Opening run lengths modulo three, kept independently for each delimiter.
static const uint8_t STATE_EMPHASIS_DELIMITER_MOD_3 = 0x3;
static const uint8_t STATE_UNDERSCORE_DELIMITER_MOD_3 = 0x18;

static bool rule_of_three_forbids(unsigned opening, unsigned closing) {
    return (opening + closing) % 3 == 0 && (opening % 3 != 0 || closing % 3 != 0);
}
// Current delimiter run is opening
static const uint8_t STATE_EMPHASIS_DELIMITER_IS_OPEN = 0x1 << 2;

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
    // Parser state flags
    uint8_t state;
    uint8_t code_span_delimiter_length;
    uint8_t latex_span_delimiter_length;
    uint8_t strikethrough_delimiter_length;
    // The number of characters remaining in the currrent emphasis delimiter
    // run.
    uint8_t num_emphasis_delimiters_left;

} Scanner;

// Write the whole state of a Scanner to a byte buffer
static unsigned serialize(Scanner *s, char *buffer) {
    unsigned size = 0;
    buffer[size++] = (char)s->state;
    buffer[size++] = (char)s->code_span_delimiter_length;
    buffer[size++] = (char)s->latex_span_delimiter_length;
    buffer[size++] = (char)s->strikethrough_delimiter_length;
    buffer[size++] = (char)s->num_emphasis_delimiters_left;
    return size;
}

// Read the whole state of a Scanner from a byte buffer
// `serizalize` and `deserialize` should be fully symmetric.
static void deserialize(Scanner *s, const char *buffer, unsigned length) {
    s->state = 0;
    s->code_span_delimiter_length = 0;
    s->latex_span_delimiter_length = 0;
    s->strikethrough_delimiter_length = 0;
    s->num_emphasis_delimiters_left = 0;
    if (length > 0) {
        size_t size = 0;
        s->state = (uint8_t)buffer[size++];
        s->code_span_delimiter_length = (uint8_t)buffer[size++];
        s->latex_span_delimiter_length = (uint8_t)buffer[size++];
        s->strikethrough_delimiter_length = (uint8_t)buffer[size++];
        s->num_emphasis_delimiters_left = (uint8_t)buffer[size++];
    }
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

// Inspect only the next relevant run. There is no document-length cutoff:
// long spans have the same semantics as short ones. Backslash escapes and
// closed code spans cannot contribute emphasis or strike delimiters.
static bool next_delimiter_run_can_close(TSLexer *lexer, int32_t delimiter,
                                         unsigned opening_length, bool exact_length) {
    int32_t previous = delimiter;
    while (!lexer->eof(lexer)) {
        int32_t current = lexer->lookahead;
        if (current == '\\') {
            lexer->advance(lexer, false);
            if (!lexer->eof(lexer)) {
                previous = lexer->lookahead;
                lexer->advance(lexer, false);
            }
            continue;
        }
        if (current == '`') {
            unsigned ticks = 0;
            while (lexer->lookahead == '`') {
                ticks++;
                lexer->advance(lexer, false);
            }
            // If these backticks are unmatched they are ordinary text. Save
            // the first candidate in their suffix in case no code span closes.
            int fallback = -1;
            bool closed = false;
            bool escaped = false;
            previous = '`';
            while (!lexer->eof(lexer)) {
                current = lexer->lookahead;
                if (current == '`') {
                    unsigned closing_ticks = 0;
                    do {
                        closing_ticks++;
                        lexer->advance(lexer, false);
                    } while (lexer->lookahead == '`');
                    if (closing_ticks == ticks) {
                        closed = true;
                        break;
                    }
                    previous = '`';
                    escaped = false;
                    continue;
                }
                if (current == delimiter && !escaped) {
                    unsigned count = 0;
                    do {
                        count++;
                        lexer->advance(lexer, false);
                    } while (lexer->lookahead == delimiter);
                    if (fallback < 0 && (!exact_length || count == opening_length)) {
                        bool whitespace = lexer->eof(lexer) || is_unicode_whitespace(lexer->lookahead);
                        bool punctuation = is_unicode_punctuation(lexer->lookahead);
                        bool closes = !is_unicode_whitespace(previous) &&
                            (!is_unicode_punctuation(previous) || whitespace || punctuation);
                        if (delimiter == '_') closes &= whitespace || punctuation;
                        fallback = closes && (exact_length || !rule_of_three_forbids(opening_length, count));
                    }
                    previous = delimiter;
                    continue;
                }
                lexer->advance(lexer, false);
                escaped = current == '\\' && !escaped;
                previous = current;
            }
            if (!closed) return fallback == 1;
            previous = '`';
            continue;
        }
        if (current == delimiter) {
            unsigned count = 0;
            do {
                count++;
                lexer->advance(lexer, false);
            } while (lexer->lookahead == delimiter);
            if (!exact_length || count == opening_length) {
                bool whitespace = lexer->eof(lexer) || is_unicode_whitespace(lexer->lookahead);
                bool punctuation = is_unicode_punctuation(lexer->lookahead);
                bool closes = !is_unicode_whitespace(previous) &&
                    (!is_unicode_punctuation(previous) || whitespace || punctuation);
                if (delimiter == '_') closes &= whitespace || punctuation;
                return closes && (exact_length || !rule_of_three_forbids(opening_length, count));
            }
            previous = delimiter;
        } else {
            lexer->advance(lexer, false);
            previous = current;
        }
    }
    return false;
}

static bool parse_star(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    lexer->advance(lexer, false);
    // If `num_emphasis_delimiters_left` is not zero then we already decided
    // that this should be part of an emphasis delimiter run, so interpret it as
    // such.
    if (s->num_emphasis_delimiters_left > 0) {
        // The `STATE_EMPHASIS_DELIMITER_IS_OPEN` state flag tells us wether it
        // should be open or close.
        if ((s->state & STATE_EMPHASIS_DELIMITER_IS_OPEN) &&
            valid_symbols[EMPHASIS_OPEN_STAR]) {
            lexer->result_symbol = EMPHASIS_OPEN_STAR;
            s->num_emphasis_delimiters_left--;
            return true;
        }
        if (valid_symbols[EMPHASIS_CLOSE_STAR]) {
            lexer->result_symbol = EMPHASIS_CLOSE_STAR;
            s->num_emphasis_delimiters_left--;
            return true;
        }
    }
    lexer->mark_end(lexer);
    // Otherwise count the number of stars
    uint8_t star_count = 1;
    while (lexer->lookahead == '*') {
        star_count++;
        lexer->advance(lexer, false);
    }
    bool line_end = lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
                    lexer->eof(lexer);
    if (valid_symbols[EMPHASIS_OPEN_STAR] ||
        valid_symbols[EMPHASIS_CLOSE_STAR]) {
        // The desicion made for the first star also counts for all the
        // following stars in the delimiter run. Rembemer how many there are.
        s->num_emphasis_delimiters_left = star_count - 1;
        // Look ahead to the next symbol (after the last star) to find out if it
        // is whitespace punctuation or other.
        bool next_symbol_whitespace =
            line_end || is_unicode_whitespace(lexer->lookahead);
        bool next_symbol_punctuation = is_unicode_punctuation(lexer->lookahead);
        // Information about the last token is in valid_symbols. See grammar.js
        // for these tokens for how this is done.
        bool can_close = valid_symbols[EMPHASIS_CLOSE_STAR] && !valid_symbols[LAST_TOKEN_WHITESPACE] && (!valid_symbols[LAST_TOKEN_PUNCTUATION] || next_symbol_punctuation || next_symbol_whitespace);
        bool can_open = valid_symbols[EMPHASIS_OPEN_STAR] && !next_symbol_whitespace && (!next_symbol_punctuation || valid_symbols[LAST_TOKEN_PUNCTUATION] || valid_symbols[LAST_TOKEN_WHITESPACE]);
        unsigned opening_modulo = (s->state & STATE_EMPHASIS_DELIMITER_MOD_3) >> 0;
        if (can_close && !(can_open && rule_of_three_forbids(opening_modulo, star_count) &&
            next_delimiter_run_can_close(lexer, '*', star_count, false))) {
            // Closing delimiters take precedence
            s->state &= ~STATE_EMPHASIS_DELIMITER_IS_OPEN;
            lexer->result_symbol = EMPHASIS_CLOSE_STAR;
            return true;
        }
        if (can_open) {
            s->state |= STATE_EMPHASIS_DELIMITER_IS_OPEN;
            s->state = (s->state & ~STATE_EMPHASIS_DELIMITER_MOD_3) | ((star_count % 3) << 0);
            lexer->result_symbol = EMPHASIS_OPEN_STAR;
            return true;
        }
    }
    // Invalid runs are literal as a whole. Returning false lets the internal
    // lexer consume one delimiter and retry the suffix with invented flanks.
    if (valid_symbols[UNCLOSED_SPAN]) {
        s->num_emphasis_delimiters_left = 0;
        lexer->mark_end(lexer);
        lexer->result_symbol = UNCLOSED_SPAN;
        return true;
    }
    return false;
}

// GFM accepts matching runs of one or two tildes. Emit each complete
// run as one delimiter; sharing emphasis's partial-run state can pair
// unrelated tildes or turn one strike into nested strikes.
static bool parse_tilde(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    unsigned length = 0;
    do {
        lexer->advance(lexer, false);
        length++;
    } while (lexer->lookahead == '~');
    lexer->mark_end(lexer);
    if (length > 2) {
        if (!valid_symbols[UNCLOSED_SPAN]) return false;
        lexer->result_symbol = UNCLOSED_SPAN;
        return true;
    }
    bool next_whitespace = lexer->eof(lexer) || is_unicode_whitespace(lexer->lookahead);
    bool next_punctuation = is_unicode_punctuation(lexer->lookahead);
    bool previous_whitespace = valid_symbols[LAST_TOKEN_WHITESPACE];
    bool previous_punctuation = valid_symbols[LAST_TOKEN_PUNCTUATION];
    if (valid_symbols[STRIKETHROUGH_CLOSE] && (s->strikethrough_delimiter_length & (1 << length)) &&
        !previous_whitespace && (!previous_punctuation || next_punctuation || next_whitespace)) {
        s->strikethrough_delimiter_length &= ~(1 << length);
        lexer->result_symbol = STRIKETHROUGH_CLOSE;
        return true;
    }
    if (valid_symbols[STRIKETHROUGH_OPEN] && !next_whitespace &&
        (!next_punctuation || previous_punctuation || previous_whitespace) &&
        next_delimiter_run_can_close(lexer, '~', length, true)) {
        s->strikethrough_delimiter_length |= (1 << length);
        lexer->result_symbol = STRIKETHROUGH_OPEN;
        return true;
    }
    if (valid_symbols[UNCLOSED_SPAN]) {
        lexer->result_symbol = UNCLOSED_SPAN;
        return true;
    }
    return false;
}

static bool parse_underscore(Scanner *s, TSLexer *lexer,
                             const bool *valid_symbols) {
    lexer->advance(lexer, false);
    // If `num_emphasis_delimiters_left` is not zero then we already decided
    // that this should be part of an emphasis delimiter run, so interpret it as
    // such.
    if (s->num_emphasis_delimiters_left > 0) {
        // The `STATE_EMPHASIS_DELIMITER_IS_OPEN` state flag tells us wether it
        // should be open or close.
        if ((s->state & STATE_EMPHASIS_DELIMITER_IS_OPEN) &&
            valid_symbols[EMPHASIS_OPEN_UNDERSCORE]) {
            lexer->result_symbol = EMPHASIS_OPEN_UNDERSCORE;
            s->num_emphasis_delimiters_left--;
            return true;
        }
        if (valid_symbols[EMPHASIS_CLOSE_UNDERSCORE]) {
            lexer->result_symbol = EMPHASIS_CLOSE_UNDERSCORE;
            s->num_emphasis_delimiters_left--;
            return true;
        }
    }
    lexer->mark_end(lexer);
    // Otherwise count the number of stars
    uint8_t underscore_count = 1;
    while (lexer->lookahead == '_') {
        underscore_count++;
        lexer->advance(lexer, false);
    }
    bool line_end = lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
                    lexer->eof(lexer);
    if (valid_symbols[EMPHASIS_OPEN_UNDERSCORE] ||
        valid_symbols[EMPHASIS_CLOSE_UNDERSCORE]) {
        // The desicion made for the first underscore also counts for all the
        // following underscores in the delimiter run. Rembemer how many there are.
        s->num_emphasis_delimiters_left = underscore_count - 1;
        // Look ahead to the next symbol (after the last underscore) to find out if it
        // is whitespace punctuation or other.
        bool next_symbol_whitespace =
            line_end || is_unicode_whitespace(lexer->lookahead);
        bool next_symbol_punctuation = is_unicode_punctuation(lexer->lookahead);
        // Information about the last token is in valid_symbols. See grammar.js
        // for these tokens for how this is done.
        bool can_close = valid_symbols[EMPHASIS_CLOSE_UNDERSCORE] && !valid_symbols[LAST_TOKEN_WHITESPACE] && (!valid_symbols[LAST_TOKEN_PUNCTUATION] || next_symbol_punctuation || next_symbol_whitespace) && (next_symbol_whitespace || next_symbol_punctuation);
        bool can_open = valid_symbols[EMPHASIS_OPEN_UNDERSCORE] && !next_symbol_whitespace && (!next_symbol_punctuation || valid_symbols[LAST_TOKEN_PUNCTUATION] || valid_symbols[LAST_TOKEN_WHITESPACE]) && (valid_symbols[LAST_TOKEN_WHITESPACE] || valid_symbols[LAST_TOKEN_PUNCTUATION]);
        unsigned opening_modulo = (s->state & STATE_UNDERSCORE_DELIMITER_MOD_3) >> 3;
        if (can_close && !(can_open && rule_of_three_forbids(opening_modulo, underscore_count) &&
            next_delimiter_run_can_close(lexer, '_', underscore_count, false))) {
            // Closing delimiters take precedence
            s->state &= ~STATE_EMPHASIS_DELIMITER_IS_OPEN;
            lexer->result_symbol = EMPHASIS_CLOSE_UNDERSCORE;
            return true;
        }
        if (can_open) {
            s->state |= STATE_EMPHASIS_DELIMITER_IS_OPEN;
            s->state = (s->state & ~STATE_UNDERSCORE_DELIMITER_MOD_3) | ((underscore_count % 3) << 3);
            lexer->result_symbol = EMPHASIS_OPEN_UNDERSCORE;
            return true;
        }
    }
    // Invalid runs are literal as a whole. Returning false lets the internal
    // lexer consume one delimiter and retry the suffix with invented flanks.
    if (valid_symbols[UNCLOSED_SPAN]) {
        s->num_emphasis_delimiters_left = 0;
        lexer->mark_end(lexer);
        lexer->result_symbol = UNCLOSED_SPAN;
        return true;
    }
    return false;
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    // A normal tree-sitter rule decided that the current branch is invalid and
    // now "requests" an error to stop the branch
    if (valid_symbols[TRIGGER_ERROR]) {
        return error(lexer);
    }

    if (valid_symbols[NONBLANK_LINK_TEXT] && lexer->lookahead == '[') {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        while (!lexer->eof(lexer) && is_unicode_whitespace(lexer->lookahead)) {
            lexer->advance(lexer, false);
        }
        if (!lexer->eof(lexer) && lexer->lookahead != ']') {
            lexer->result_symbol = NONBLANK_LINK_TEXT;
            return true;
        }
        return false;
    }

    // Decide which tokens to consider based on the first non-whitespace
    // character
    switch (lexer->lookahead) {
        case '#': {
            if (!valid_symbols[TAG] || !valid_symbols[LAST_TOKEN_WHITESPACE]) return false;
            lexer->advance(lexer, false);
            bool non_numeric = false;
            while (!lexer->eof(lexer)) {
                int32_t c = lexer->lookahead;
                bool letter = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    c == '_' || c == '-' || c == '/';
                if (!letter && !(c >= '0' && c <= '9')) break;
                non_numeric |= letter;
                lexer->advance(lexer, false);
            }
            if (!non_numeric) return false;
            lexer->result_symbol = TAG;
            return true;
        }
        case '`':
            // A backtick could mark the beginning or ending of a code span or a
            // fenced code block.
            return parse_backtick(s, lexer, valid_symbols);
        case '$':
            return parse_dollar(s, lexer, valid_symbols);
        case '*':
            // A star could either mark the beginning or ending of emphasis, a
            // list item or thematic break. This code is similar to the code for
            // '_' and '+'.
            return parse_star(s, lexer, valid_symbols);
        case '_':
            return parse_underscore(s, lexer, valid_symbols);
        case '~':
            return parse_tilde(s, lexer, valid_symbols);
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
