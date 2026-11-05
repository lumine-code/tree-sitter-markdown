// Zero-width preparation of extended autolinks and delimiter precedence.
// Independently implemented; covered by the repository's MIT license.
#ifndef TREE_SITTER_MARKDOWN_INLINE_PREPARATION_H_
#define TREE_SITTER_MARKDOWN_INLINE_PREPARATION_H_

#include "autolink.h"
#include "emphasis.h"
#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct {
    BareAutolinkKind kind;
    uint32_t length;
    uint8_t ending_flank;
    bool ending_boundary;
} InlinePreparation;

typedef struct {
    TSLexer lexer;
    EmphasisLookahead *input;
    size_t position;
} InlinePreparationLexer;

static void inline_preparation_advance(TSLexer *lexer, bool skip) {
    (void)skip;
    InlinePreparationLexer *virtual_lexer = (InlinePreparationLexer *)lexer;
    if (emphasis_character(virtual_lexer->input, virtual_lexer->position) >= 0) {
        virtual_lexer->position++;
    }
    int32_t character = emphasis_character(virtual_lexer->input, virtual_lexer->position);
    lexer->lookahead = character < 0 ? 0 : character;
}

static bool inline_preparation_eof(const TSLexer *lexer) {
    const InlinePreparationLexer *virtual_lexer = (const InlinePreparationLexer *)lexer;
    return emphasis_character(virtual_lexer->input, virtual_lexer->position) < 0;
}

typedef struct {
    EmphasisLookahead *input;
    size_t end;
} InlinePreparationBound;

static int32_t inline_preparation_bounded_read(void *context, size_t position) {
    InlinePreparationBound *bound = (InlinePreparationBound *)context;
    return position < bound->end ? emphasis_character(bound->input, position) : -1;
}

static bool inline_preparation_parent_pair(unsigned parent_modulo, bool parent_can_close,
                                            size_t length, bool can_open) {
    unsigned modulo = (unsigned)(length % 3);
    parent_modulo %= 3;
    return !((parent_can_close || can_open) && (parent_modulo + modulo) % 3 == 0 &&
             (parent_modulo != 0 || modulo != 0));
}

// An email is recognized after its surrounding emphasis. A domain underscore
// that can close the nearest parent therefore ends the email candidate first.
// Inspect whole original runs, including a suffix beyond the accepted email.
static size_t inline_preparation_email_limit(EmphasisLookahead *input, size_t end,
                                               bool previous_whitespace,
                                               bool previous_punctuation,
                                               bool parent_can_close,
                                               unsigned parent_modulo) {
    size_t position = 0;
    while (position < end) {
        if (emphasis_character(input, position) != '_') {
            position++;
            continue;
        }
        size_t start = position;
        do { position++; } while (emphasis_character(input, position) == '_');
        int32_t previous = start ? emphasis_character(input, start - 1) : -1;
        int32_t next = emphasis_character(input, position);
        bool before_space = start ? is_unicode_whitespace(previous) : previous_whitespace;
        bool before_punctuation = start ? is_unicode_punctuation(previous) : previous_punctuation;
        bool after_space = next < 0 || is_unicode_whitespace(next);
        bool after_punctuation = next >= 0 && is_unicode_punctuation(next);
        bool left = !after_space && (!after_punctuation || before_space || before_punctuation);
        bool right = !before_space && (!before_punctuation || after_space || after_punctuation);
        bool opens = left && (!right || before_punctuation);
        bool closes = right && (!left || after_punctuation);
        if (closes && inline_preparation_parent_pair(parent_modulo, parent_can_close,
                                                     position - start, opens)) return start;
    }
    return end;
}

static BareAutolinkMatch inline_preparation_bare_match(EmphasisLookahead *input,
        bool left_boundary, bool prev_whitespace, bool prev_punctuation,
        int32_t parent_delimiter, bool parent_can_close, unsigned parent_modulo,
        bool in_link_text) {
    BareAutolinkMatch match = bare_autolink_match(emphasis_bare_autolink_read,
        input, 0, left_boundary, NULL);
    if (match.kind != BARE_AUTOLINK_URI && parent_delimiter == '_') {
        size_t candidate_end = match.end;
        if (match.kind == BARE_AUTOLINK_NONE) {
            int32_t character;
            while ((character = emphasis_character(input, candidate_end)) >= 0 &&
                   !is_unicode_whitespace(character) && character != '<' &&
                   (!in_link_text || character != ']')) candidate_end++;
        }
        size_t limit = inline_preparation_email_limit(input, candidate_end,
            prev_whitespace, prev_punctuation, parent_can_close, parent_modulo);
        if (limit < candidate_end) {
            InlinePreparationBound bounded = {input, limit};
            match = bare_autolink_match(inline_preparation_bounded_read,
                &bounded, 0, left_boundary, NULL);
            if (match.kind != BARE_AUTOLINK_EMAIL) return (BareAutolinkMatch){BARE_AUTOLINK_NONE, 0};
        }
    }
    return match;
}

// The caller marks a zero-width token BEFORE calling this function, then
// emits that token even when kind is NONE. No callback here marks or consumes
// a committed source span: all lookahead is temporary and can be replayed by
// the next scan at the caller's original position.
static InlinePreparation prepare_inline(TSLexer *lexer, bool left_boundary,
                                         bool prev_whitespace, bool prev_punctuation,
                                         int32_t parent_delimiter, bool parent_can_close,
                                         unsigned parent_modulo, bool in_link_text) {
    InlinePreparation result = {BARE_AUTOLINK_NONE, 0, 0, false};
    EmphasisLookahead input = {.lexer = lexer};
    int32_t first = emphasis_character(&input, 0);
    BareAutolinkMatch match = {BARE_AUTOLINK_NONE, 0};
    if (first == '_') {
        // Establish only whether an email candidate exists before doing an
        // emphasis suffix analysis. No candidate means ordinary delimiter
        // processing can use its serialized absence cache instead. Acceptance
        // still waits until the emphasis-precedence check below has passed.
        match = bare_autolink_match(emphasis_bare_autolink_read,
            &input, 0, left_boundary, NULL);
        if (match.kind != BARE_AUTOLINK_EMAIL) goto done;
        size_t count = 1;
        while (emphasis_character(&input, count) == '_') count++;
        int32_t next = emphasis_character(&input, count);
        bool next_space = next < 0 || is_unicode_whitespace(next);
        bool next_punctuation = next >= 0 && is_unicode_punctuation(next);
        bool left = !next_space && (!next_punctuation || prev_whitespace || prev_punctuation);
        bool right = !prev_whitespace && (!prev_punctuation || next_space || next_punctuation);
        bool opens = left && (!right || prev_punctuation);
        bool closes = right && (!left || next_punctuation);
        if (opens) {
            if (count > UINT32_MAX) abort();
            InlinePreparationLexer virtual_lexer = {
                .input = &input,
                .position = count,
            };
            virtual_lexer.lexer.lookahead = next < 0 ? 0 : next;
            virtual_lexer.lexer.advance = inline_preparation_advance;
            virtual_lexer.lexer.eof = inline_preparation_eof;
            // Only existence of an opening match matters here. A single
            // parent unit detects a crossing parent closure; an eligible
            // initial underscore closer is also rejected by email clipping.
            uint32_t matches = emphasis_opening_matches_in_context(&virtual_lexer.lexer,
                '_', (uint32_t)count, opens, closes, in_link_text, true, NULL,
                parent_delimiter, parent_modulo, parent_can_close,
                parent_delimiter == '*' || parent_delimiter == '_' ? 1 : 0);
            if (matches != 0) goto done;
        }
    }
    match = inline_preparation_bare_match(&input, left_boundary,
        prev_whitespace, prev_punctuation, parent_delimiter, parent_can_close,
        parent_modulo, in_link_text);
    if (match.kind == BARE_AUTOLINK_NONE || match.end == 0) goto done;
    if (match.end > UINT32_MAX) abort();
    int32_t ending = emphasis_character(&input, match.end - 1);
    result.kind = match.kind;
    result.length = (uint32_t)match.end;
    result.ending_flank = is_unicode_whitespace(ending) ? 1 : is_unicode_punctuation(ending) ? 2 : 0;
    result.ending_boundary = bare_autolink_boundary(ending);
done:
    free(input.characters);
    return result;
}

typedef enum {
    INLINE_TOKEN_NONE,
    INLINE_TOKEN_BARE,
    INLINE_TOKEN_RAW,
    INLINE_TOKEN_OPEN,
    INLINE_TOKEN_CLOSE
} InlineTokenRole;

typedef struct {
    bool prev_whitespace;
    bool prev_punctuation;
    bool left_boundary;
    bool bare_autolinks;
    int32_t parent_delimiter;
    unsigned parent_modulo;
    bool parent_can_close;
    uint32_t parent_unit;
    bool in_link_text;
    bool pending_active;
    int32_t pending_delimiter;
    uint32_t pending_count;
    unsigned pending_modulo;
    bool pending_can_open;
    bool pending_can_close;
    bool pending_opening_phase;
    uint16_t *impossible_openers;
    uint16_t *unmatched_root_openers;
} InlineTokenOptions;

typedef struct {
    InlineTokenRole role;
    BareAutolinkKind kind;
    int32_t delimiter;
    uint32_t length;
    bool original_can_open;
    bool original_can_close;
    uint8_t original_modulo;
    uint32_t next_remaining;
    bool next_opening_phase;
    uint8_t ending_flank;
    bool ending_boundary;
} InlineTokenPreparation;

static InlinePreparationLexer inline_preparation_virtual(EmphasisLookahead *input, size_t position) {
    InlinePreparationLexer result = {.input = input, .position = position};
    int32_t character = emphasis_character(input, position);
    result.lexer.lookahead = character < 0 ? 0 : character;
    result.lexer.advance = inline_preparation_advance;
    result.lexer.eof = inline_preparation_eof;
    return result;
}

// Plan a bare link, literal run, or one/two-marker delimiter before committing.
// All probes share one replayable source buffer. The real lexer can already
// be past the candidate when another probe starts at its virtual beginning.
static InlineTokenPreparation prepare_inline_token(TSLexer *lexer, InlineTokenOptions options) {
    InlineTokenPreparation result = {0};
    EmphasisLookahead input = {.lexer = lexer};
    int32_t first = emphasis_character(&input, 0);
    bool pending = options.pending_active && options.pending_delimiter == first &&
        options.pending_count != 0;
    if (options.bare_autolinks) {
        InlinePreparationLexer virtual_lexer = inline_preparation_virtual(&input, 0);
        InlinePreparation bare = prepare_inline(&virtual_lexer.lexer,
            options.left_boundary, options.prev_whitespace, options.prev_punctuation,
            options.parent_delimiter, options.parent_can_close,
            options.parent_modulo, options.in_link_text);
        if (bare.kind != BARE_AUTOLINK_NONE && !(pending && first == '_')) {
            result.role = INLINE_TOKEN_BARE;
            result.kind = bare.kind;
            result.length = bare.length;
            result.ending_flank = bare.ending_flank;
            result.ending_boundary = bare.ending_boundary;
            goto done;
        }
    }
    if (first != '*' && first != '_') goto done;
    size_t count = 1;
    while (emphasis_character(&input, count) == first) count++;
    if (count > UINT32_MAX) abort();
    uint32_t remaining = pending ? options.pending_count : (uint32_t)count;
    bool opening_phase = pending && options.pending_opening_phase;
    bool opens;
    bool closes;
    unsigned modulo;
    if (pending) {
        opens = options.pending_can_open;
        closes = options.pending_can_close;
        modulo = options.pending_modulo % 3;
    } else {
        int32_t next = emphasis_character(&input, count);
        bool after_space = next < 0 || is_unicode_whitespace(next);
        bool after_punctuation = next >= 0 && is_unicode_punctuation(next);
        bool left = !after_space && (!after_punctuation || options.prev_whitespace || options.prev_punctuation);
        bool right = !options.prev_whitespace && (!options.prev_punctuation || after_space || after_punctuation);
        opens = first == '_' ? left && (!right || options.prev_punctuation) : left;
        closes = first == '_' ? right && (!left || after_punctuation) : right;
        modulo = (unsigned)(count % 3);
    }
    result.delimiter = first;
    result.original_can_open = opens;
    result.original_can_close = closes;
    result.original_modulo = (uint8_t)modulo;
    result.next_opening_phase = opening_phase;
    result.ending_flank = 2;
    result.ending_boundary = true;
    uint32_t parent_unit = options.parent_unit == 2 ? 2 : 1;
    bool closes_parent = !opening_phase && closes && options.parent_delimiter == first &&
        inline_preparation_parent_pair(options.parent_modulo, options.parent_can_close, modulo, opens);
    if (closes_parent) {
        result.role = INLINE_TOKEN_CLOSE;
        result.length = parent_unit < remaining ? parent_unit : remaining;
    } else {
        uint8_t leftmost_unit = 0;
        uint32_t matches = 0;
        unsigned bit = (first == '_' ? 6 : 0) + (closes ? 3 : 0) + modulo;
        bool impossible = !options.in_link_text && options.impossible_openers != NULL &&
            (*options.impossible_openers & (1u << bit));
        impossible |= !pending && !options.in_link_text && !options.parent_delimiter &&
            options.unmatched_root_openers != NULL && (*options.unmatched_root_openers & (1u << bit));
        if (opens && !impossible) {
            InlinePreparationLexer virtual_lexer = inline_preparation_virtual(&input, remaining);
            matches = emphasis_opening_plan_in_context(&virtual_lexer.lexer, first,
                remaining, opens, closes, options.in_link_text, options.bare_autolinks,
                options.in_link_text ? NULL : options.impossible_openers,
                options.parent_delimiter, options.parent_modulo, options.parent_can_close,
                options.parent_delimiter == '*' || options.parent_delimiter == '_' ? parent_unit : 0,
                modulo, opening_phase, &leftmost_unit,
                options.in_link_text || pending ? NULL : options.unmatched_root_openers);
        }
        if (pending && first == '_' && options.bare_autolinks && matches == 0) {
            // Recomputing the remaining run's modulo in prepare_inline would
            // let an email steal markers that still belong to an original
            // opening run. Conversely, genuinely unmatched residual markers
            // may start an email after a parent closure. Resolve this using
            // the original metadata before accepting the bare candidate.
            BareAutolinkMatch email = inline_preparation_bare_match(&input,
                options.left_boundary, options.prev_whitespace, options.prev_punctuation,
                options.parent_delimiter, options.parent_can_close,
                options.parent_modulo, options.in_link_text);
            if (email.kind == BARE_AUTOLINK_EMAIL && email.end != 0) {
                if (email.end > UINT32_MAX) abort();
                int32_t ending = emphasis_character(&input, email.end - 1);
                result = (InlineTokenPreparation){
                    .role = INLINE_TOKEN_BARE,
                    .kind = email.kind,
                    .length = (uint32_t)email.end,
                    .ending_flank = is_unicode_whitespace(ending) ? 1 : is_unicode_punctuation(ending) ? 2 : 0,
                    .ending_boundary = bare_autolink_boundary(ending),
                };
                goto done;
            }
        }
        if (matches == 0 || matches < remaining) {
            result.role = INLINE_TOKEN_RAW;
            result.length = remaining - matches;
        } else {
            if (leftmost_unit == 0 || leftmost_unit > remaining) abort();
            result.role = INLINE_TOKEN_OPEN;
            result.length = leftmost_unit;
            result.next_opening_phase = true;
        }
    }
    result.next_remaining = remaining - result.length;
done:
    free(input.characters);
    return result;
}

#endif
