// Forward delimiter matching for the current emphasis run.
// Independently implemented from the GFM delimiter-stack algorithm.
// This file is covered by the repository's MIT license.
#ifndef TREE_SITTER_MARKDOWN_EMPHASIS_H_
#define TREE_SITTER_MARKDOWN_EMPHASIS_H_

#include "tree_sitter/parser.h"
#include "unicode.h"
#include "autolink.h"
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

// The lexer cannot rewind, but its marked token end stays at the caller's
// current delimiter. Lazily buffer lookahead so failed code/HTML/link probes
// can be replayed as ordinary text without discarding possible delimiters.
typedef struct {
    TSLexer *lexer;
    int32_t *characters;
    size_t length;
    size_t capacity;
} EmphasisLookahead;

static void *emphasis_grow(void *memory, size_t *capacity, size_t needed, size_t width) {
    size_t next = *capacity ? *capacity : 32;
    while (next < needed) {
        if (next > SIZE_MAX / 2) abort();
        next *= 2;
    }
    if (next > SIZE_MAX / width) abort();
    void *result = realloc(memory, next * width);
    if (result == NULL) abort();
    *capacity = next;
    return result;
}

static int32_t emphasis_character(EmphasisLookahead *input, size_t position) {
    while (position >= input->length) {
        if (input->lexer->eof(input->lexer)) return -1;
        if (input->length == input->capacity) {
            input->characters = emphasis_grow(input->characters, &input->capacity,
                                               input->length + 1, sizeof(int32_t));
        }
        input->characters[input->length++] = input->lexer->lookahead;
        input->lexer->advance(input->lexer, false);
    }
    return input->characters[position];
}

static int32_t emphasis_bare_autolink_read(void *context, size_t position) {
    return emphasis_character((EmphasisLookahead *)context, position);
}

static bool emphasis_ascii_punctuation(int32_t character) {
    return (character >= '!' && character <= '/') ||
           (character >= ':' && character <= '@') ||
           (character >= '[' && character <= '`') ||
           (character >= '{' && character <= '~');
}

static bool emphasis_ascii_alpha(int32_t character) {
    return (character >= 'a' && character <= 'z') ||
           (character >= 'A' && character <= 'Z');
}

static bool emphasis_ascii_digit(int32_t character) {
    return character >= '0' && character <= '9';
}

static bool emphasis_ascii_space(int32_t character) {
    return character == ' ' || character == '\t' ||
           character == '\n' || character == '\r';
}

static bool emphasis_newline(int32_t character) {
    return character == '\n' || character == '\r';
}

static bool emphasis_starts_with(EmphasisLookahead *input, size_t position, const char *text) {
    for (size_t index = 0; text[index]; index++) {
        if (emphasis_character(input, position + index) != (unsigned char)text[index]) return false;
    }
    return true;
}

// Return the position after a matching code span, or start if unmatched.
static size_t emphasis_code_end(EmphasisLookahead *input, size_t start) {
    size_t position = start;
    while (emphasis_character(input, position) == '`') position++;
    size_t width = position - start;
    while (emphasis_character(input, position) >= 0) {
        if (emphasis_character(input, position) != '`') {
            position++;
            continue;
        }
        size_t run = position;
        do { position++; } while (emphasis_character(input, position) == '`');
        if (position - run == width) return position;
    }
    return start;
}

static size_t emphasis_terminated_end(EmphasisLookahead *input, size_t start,
                                      size_t position, const char *terminator) {
    while (emphasis_character(input, position) >= 0) {
        if (emphasis_starts_with(input, position, terminator)) {
            while (*terminator++) position++;
            return position;
        }
        position++;
    }
    return start;
}

static bool emphasis_attribute_start(int32_t character) {
    return emphasis_ascii_alpha(character) || character == '_' || character == ':';
}

static bool emphasis_attribute_character(int32_t character) {
    return emphasis_attribute_start(character) || emphasis_ascii_digit(character) ||
           character == '.' || character == '-';
}

static size_t emphasis_tag_end(EmphasisLookahead *input, size_t start) {
    size_t position = start + 1;
    bool closing = emphasis_character(input, position) == '/';
    if (closing) position++;
    if (!emphasis_ascii_alpha(emphasis_character(input, position))) return start;
    do { position++; } while (emphasis_ascii_alpha(emphasis_character(input, position)) ||
                              emphasis_ascii_digit(emphasis_character(input, position)) ||
                              emphasis_character(input, position) == '-');
    for (;;) {
        bool whitespace = false;
        while (emphasis_ascii_space(emphasis_character(input, position))) {
            whitespace = true;
            position++;
        }
        int32_t character = emphasis_character(input, position);
        if (character == '>') return position + 1;
        if (!closing && character == '/' && emphasis_character(input, position + 1) == '>') return position + 2;
        if (closing || !whitespace || !emphasis_attribute_start(character)) return start;
        do { position++; } while (emphasis_attribute_character(emphasis_character(input, position)));
        size_t after_name = position;
        while (emphasis_ascii_space(emphasis_character(input, position))) position++;
        if (emphasis_character(input, position) != '=') {
            // Preserve attribute-separating whitespace for the next iteration.
            position = after_name;
            continue;
        }
        position++;
        while (emphasis_ascii_space(emphasis_character(input, position))) position++;
        character = emphasis_character(input, position);
        if (character == '\'' || character == '"') {
            int32_t quote = character;
            position++;
            while ((character = emphasis_character(input, position)) >= 0 && character != quote) position++;
            if (character < 0) return start;
            position++;
        } else {
            size_t value = position;
            while ((character = emphasis_character(input, position)) >= 0 &&
                   !emphasis_ascii_space(character) && character != '"' && character != '\'' &&
                   character != '=' && character != '<' && character != '>' && character != '`') position++;
            if (position == value) return start;
        }
    }
}

static bool emphasis_email_local(int32_t character) {
    if (emphasis_ascii_alpha(character) || emphasis_ascii_digit(character)) return true;
    switch (character) {
        case '.': case '!': case '#': case '$': case '%': case '&': case '\'':
        case '*': case '+': case '/': case '=': case '?': case '^': case '_':
        case '`': case '{': case '|': case '}': case '~': return true;
        default: return false;
    }
}

static size_t emphasis_autolink_end(EmphasisLookahead *input, size_t start) {
    size_t position = start + 1;
    if (emphasis_ascii_alpha(emphasis_character(input, position))) {
        position++;
        while (emphasis_ascii_alpha(emphasis_character(input, position)) ||
               emphasis_ascii_digit(emphasis_character(input, position)) ||
               emphasis_character(input, position) == '+' || emphasis_character(input, position) == '-' ||
               emphasis_character(input, position) == '.') position++;
        size_t scheme_length = position - start - 1;
        if (scheme_length >= 2 && scheme_length <= 32 && emphasis_character(input, position) == ':') {
            position++;
            int32_t character;
            while ((character = emphasis_character(input, position)) > 0x20 && character != '<' && character != '>') position++;
            if (character == '>') return position + 1;
        }
    }
    position = start + 1;
    while (emphasis_email_local(emphasis_character(input, position))) position++;
    if (position == start + 1 || emphasis_character(input, position) != '@') return start;
    position++;
    for (;;) {
        if (!emphasis_ascii_alpha(emphasis_character(input, position)) &&
            !emphasis_ascii_digit(emphasis_character(input, position))) return start;
        size_t label = position;
        do { position++; } while (emphasis_ascii_alpha(emphasis_character(input, position)) ||
                                  emphasis_ascii_digit(emphasis_character(input, position)) ||
                                  emphasis_character(input, position) == '-');
        if (position - label > 63 || emphasis_character(input, position - 1) == '-') return start;
        if (emphasis_character(input, position) == '>') return position + 1;
        if (emphasis_character(input, position) != '.') return start;
        position++;
    }
}

// HTML/autolinks are atomic for delimiter matching; failed probes leave their
// buffered source available for ordinary emphasis processing.
static size_t emphasis_html_end(EmphasisLookahead *input, size_t start) {
    if (emphasis_starts_with(input, start, "<!--")) {
        size_t position = start + 4;
        if (emphasis_character(input, position) == '>' || emphasis_starts_with(input, position, "->")) return start;
        while (emphasis_character(input, position) >= 0) {
            if (emphasis_starts_with(input, position, "-->")) return position + 3;
            if (emphasis_starts_with(input, position, "--")) return start;
            position++;
        }
        return start;
    }
    if (emphasis_starts_with(input, start, "<?")) return emphasis_terminated_end(input, start, start + 2, "?>");
    if (emphasis_starts_with(input, start, "<![CDATA[")) return emphasis_terminated_end(input, start, start + 9, "]]>");
    int32_t declaration = emphasis_character(input, start + 2);
    if (emphasis_starts_with(input, start, "<!") && declaration >= 'A' && declaration <= 'Z') {
        return emphasis_terminated_end(input, start, start + 3, ">");
    }
    size_t end = emphasis_autolink_end(input, start);
    return end != start ? end : emphasis_tag_end(input, start);
}

static size_t emphasis_link_destination_end(EmphasisLookahead *input, size_t start) {
    size_t position = start + 1;
    while (emphasis_ascii_space(emphasis_character(input, position))) position++;
    if (emphasis_character(input, position) == ')') return position + 1;
    if (emphasis_character(input, position) == '<') {
        position++;
        int32_t character;
        while ((character = emphasis_character(input, position)) >= 0 && character != '>') {
            if (character == '<' || emphasis_newline(character)) return start;
            if (character == '\\' && emphasis_ascii_punctuation(emphasis_character(input, position + 1))) position++;
            position++;
        }
        if (character != '>') return start;
        position++;
    } else {
        size_t depth = 0;
        int32_t character;
        while ((character = emphasis_character(input, position)) >= 0 && character > 0x20) {
            if (character == '\\' && emphasis_ascii_punctuation(emphasis_character(input, position + 1))) {
                position += 2;
                continue;
            }
            if (character == '(') depth++;
            else if (character == ')') {
                if (depth == 0) return position + 1;
                depth--;
            }
            position++;
        }
        if (depth != 0) return start;
    }
    size_t separator = position;
    while (emphasis_ascii_space(emphasis_character(input, position))) position++;
    if (emphasis_character(input, position) == ')') return position + 1;
    int32_t quote = emphasis_character(input, position);
    if (position == separator || (quote != '\'' && quote != '"' && quote != '(')) return start;
    int32_t close = quote == '(' ? ')' : quote;
    position++;
    int32_t character;
    unsigned line_endings = 0;
    while ((character = emphasis_character(input, position)) >= 0 && character != close) {
        if (character == '\\' && emphasis_ascii_punctuation(emphasis_character(input, position + 1))) {
            position += 2;
            line_endings = 0;
            continue;
        }
        if (emphasis_newline(character)) {
            if (++line_endings > 1) return start;
            if (character == '\r' && emphasis_character(input, position + 1) == '\n') position++;
        } else if (!emphasis_ascii_space(character)) line_endings = 0;
        if (quote == '(' && character == '(') return start;
        position++;
    }
    if (character != close) return start;
    position++;
    while (emphasis_ascii_space(emphasis_character(input, position))) position++;
    return emphasis_character(input, position) == ')' ? position + 1 : start;
}

static size_t emphasis_bracket_end(EmphasisLookahead *input, size_t start, bool *nonblank) {
    size_t position = start + 1;
    size_t depth = 0;
    *nonblank = false;
    int32_t character;
    while ((character = emphasis_character(input, position)) >= 0) {
        if (character == '\\' && emphasis_ascii_punctuation(emphasis_character(input, position + 1))) {
            *nonblank = true;
            position += 2;
            continue;
        }
        if (character == '`' || character == '<') {
            size_t end = character == '`' ? emphasis_code_end(input, position) : emphasis_html_end(input, position);
            if (end != position) {
                *nonblank = true;
                position = end;
                continue;
            }
        }
        if (character == ']') {
            if (depth == 0) return position + 1;
            depth--;
        } else if (character == '[') depth++;
        if (!is_unicode_whitespace(character)) *nonblank = true;
        position++;
    }
    return start;
}

static size_t emphasis_link_end(EmphasisLookahead *input, size_t start) {
    bool nonblank;
    size_t end = emphasis_bracket_end(input, start, &nonblank);
    if (end == start) return start;
    if (emphasis_character(input, end) == '(') {
        size_t destination = emphasis_link_destination_end(input, end);
        if (destination != end) return destination;
    }
    // The grammar intentionally approximates reference lookup. Match that
    // boundary here: a nonblank shortcut/reference candidate is atomic even
    // when no document-wide reference resolver has established its target.
    if (nonblank) {
        if (emphasis_character(input, end) == '[') {
            bool label_nonblank;
            size_t label_end = emphasis_bracket_end(input, end, &label_nonblank);
            if (label_end != end) return label_end;
        }
        return end;
    }
    return start;
}

typedef struct {
    int32_t character;
    size_t original_length;
    size_t remaining;
    size_t previous;
    bool can_open;
    bool can_close;
    uint32_t star_ordinal;
} EmphasisRun;

static bool emphasis_pair_allowed(const EmphasisRun *opening, const EmphasisRun *closing) {
    return !(opening->can_close || closing->can_open) ||
           (opening->original_length + closing->original_length) % 3 != 0 ||
           (opening->original_length % 3 == 0 && closing->original_length % 3 == 0);
}

// Called after the current full run has been inspected and the caller has
// marked its actual token end. This function never changes that mark. It
// returns how many markers in that run can act as opening delimiters when
// future delimiters are processed in source order. The nearest parent is
// supplied explicitly; grammar states retain its ancestors across nesting.
static uint32_t emphasis_opening_plan_in_context(TSLexer *lexer, int32_t delimiter,
                                        uint32_t count, bool can_open,
                                        bool can_close, bool in_link_text,
                                        bool bare_autolinks,
                                        uint16_t *impossible_openers,
                                        int32_t parent_delimiter,
                                        unsigned parent_modulo,
                                        bool parent_can_close,
                                        uint32_t parent_remaining,
                                        unsigned original_modulo,
                                        bool opening_phase,
                                        uint8_t *out_leftmost_unit,
                                        uint16_t *unmatched_root_openers,
                                        uint32_t *next_matched_star,
                                        uint32_t star_ordinal) {
    if (out_leftmost_unit != NULL) *out_leftmost_unit = 0;
    if (!can_open || count == 0) return 0;
    EmphasisLookahead input = {.lexer = lexer};
    size_t capacity = 0;
    EmphasisRun *runs = emphasis_grow(NULL, &capacity, 1, sizeof(EmphasisRun));
    bool has_parent = (parent_delimiter == '*' || parent_delimiter == '_') && parent_remaining != 0;
    size_t current_run = has_parent ? 1 : 0;
    if (has_parent) {
        runs[0] = (EmphasisRun){parent_delimiter, parent_modulo % 3,
            parent_remaining, SIZE_MAX, true, parent_can_close, 0};
    }
    runs[current_run] = (EmphasisRun){delimiter, original_modulo % 3, count,
        has_parent ? 0 : SIZE_MAX, can_open, can_close, 0};
    size_t length = current_run + 1;
    size_t tail = current_run;
    // Failed opener searches establish a lower bound for each distinct
    // compatibility class. The indexed run itself remains eligible later.
    size_t bottoms[2][2][3] = {{{0}}};
    size_t position = 0;
    int32_t previous = delimiter;
    uint32_t matched = 0;
    uint16_t compatible_openers = 0;
    uint16_t matched_classes = 0;
    bool parent_closed = false;
    uint32_t future_stars = 0;
    uint32_t first_matched_star[6] = {UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX};
    bool saw_math = false;
    int32_t character = 0;
    if (!opening_phase && has_parent && can_close && delimiter == parent_delimiter &&
        emphasis_pair_allowed(&runs[0], &runs[current_run])) {
        while (runs[0].remaining && runs[current_run].remaining) {
            size_t used = runs[0].remaining >= 2 && runs[current_run].remaining >= 2 ? 2 : 1;
            runs[0].remaining -= used;
            runs[current_run].remaining -= used;
        }
        if (!runs[0].remaining) runs[current_run].previous = SIZE_MAX;
        if (!runs[current_run].remaining) goto done;
    }
    while ((character = emphasis_character(&input, position)) >= 0) {
        saw_math |= character == '$';
        if (in_link_text && character == ']') break;
        if (character == '\\' && emphasis_ascii_punctuation(emphasis_character(&input, position + 1))) {
            previous = emphasis_character(&input, position + 1);
            position += 2;
            continue;
        }
        if (bare_autolinks && bare_autolink_boundary(previous)) {
            BareAutolinkMatch link = bare_autolink_match(emphasis_bare_autolink_read,
                &input, position, true, NULL);
            if (link.kind == BARE_AUTOLINK_URI && link.end > position) {
                previous = emphasis_character(&input, link.end - 1);
                position = link.end;
                continue;
            }
        }
        if (character == '`' || character == '<' || character == '[' ||
            (character == '!' && emphasis_character(&input, position + 1) == '[')) {
            size_t end = position;
            if (character == '`') end = emphasis_code_end(&input, position);
            else if (character == '<') end = emphasis_html_end(&input, position);
            else {
                size_t bracket = position + (character == '!');
                size_t link = emphasis_link_end(&input, bracket);
                if (link != bracket) end = link;
            }
            if (end != position) {
                previous = emphasis_character(&input, end - 1);
                position = end;
                continue;
            }
        }
        if (character != '*' && character != '_') {
            previous = character;
            position++;
            continue;
        }
        size_t start = position;
        do { position++; } while (emphasis_character(&input, position) == character);
        size_t run_length = position - start;
        if (character == '*') {
            if (future_stars == UINT32_MAX) abort();
            future_stars++;
        }
        int32_t next = emphasis_character(&input, position);
        bool previous_space = is_unicode_whitespace(previous);
        bool next_space = next < 0 || is_unicode_whitespace(next);
        bool previous_punctuation = is_unicode_punctuation(previous);
        bool next_punctuation = next >= 0 && is_unicode_punctuation(next);
        bool opens = !next_space && (!next_punctuation || previous_space || previous_punctuation);
        bool closes = !previous_space && (!previous_punctuation || next_space || next_punctuation);
        if (character == '_') {
            opens &= previous_space || previous_punctuation;
            closes &= next_space || next_punctuation;
        }
        previous = character;
        if (closes) {
            // Record lexical compatibility, not successful stack matches.
            // A hypothetical earlier opener can remove future candidates;
            // absence of a match in that hypothetical stack is not proof
            // that the same class cannot match in another parse context.
            for (unsigned opening_closes = 0; opening_closes < 2; opening_closes++) {
                for (unsigned modulo = 0; modulo < 3; modulo++) {
                    bool forbidden = (opening_closes || opens) &&
                        (modulo + run_length % 3) % 3 == 0 &&
                        (modulo != 0 || run_length % 3 != 0);
                    if (!forbidden) {
                        unsigned bit = (character == '_' ? 6 : 0) + opening_closes * 3 + modulo;
                        compatible_openers |= (uint16_t)(1u << bit);
                    }
                }
            }
        }
        if (!opens && !closes) continue;
        if (length == capacity) runs = emphasis_grow(runs, &capacity, length + 1, sizeof(EmphasisRun));
        size_t current = length++;
        runs[current] = (EmphasisRun){character, run_length, run_length, tail, opens, closes, future_stars};
        tail = current;
        if (!closes) continue;
        size_t *bottom = &bottoms[character == '_'][opens][run_length % 3];
        while (runs[current].remaining) {
            size_t opening = runs[current].previous;
            while (opening != SIZE_MAX && opening >= *bottom) {
                if (runs[opening].character == character && runs[opening].can_open &&
                    emphasis_pair_allowed(&runs[opening], &runs[current])) break;
                opening = runs[opening].previous;
            }
            if (opening == SIZE_MAX || opening < *bottom) {
                *bottom = current;
                if (!opens) tail = runs[current].previous;
                break;
            }
            size_t used = runs[opening].remaining >= 2 && runs[current].remaining >= 2 ? 2 : 1;
            unsigned opening_bit = (runs[opening].character == '_' ? 6 : 0) +
                (runs[opening].can_close ? 3 : 0) + runs[opening].original_length % 3;
            if (!has_parent || opening != 0) matched_classes |= (uint16_t)(1u << opening_bit);
            if (runs[opening].character == '*' && opening != current_run &&
                (!has_parent || opening != 0) &&
                runs[opening].star_ordinal < first_matched_star[opening_bit]) {
                first_matched_star[opening_bit] = runs[opening].star_ordinal;
            }
            runs[opening].remaining -= used;
            runs[current].remaining -= used;
            if (opening == current_run) {
                matched += (uint32_t)used;
                if (out_leftmost_unit != NULL) *out_leftmost_unit = (uint8_t)used;
            }
            // A preceding parent can close across the candidate currently
            // being classified. Its unmatched markers then leave the stack.
            // Already formed matches of the candidate remain valid children.
            if (has_parent && opening == 0 && runs[current_run].remaining) {
                parent_closed = runs[0].remaining == 0;
                goto done;
            }
            // Removing intervening candidates is essential: they cannot later
            // form a crossing emphasis interval.
            size_t surviving = runs[opening].remaining ? opening : runs[opening].previous;
            runs[current].previous = surviving;
            tail = runs[current].remaining ? current : surviving;
            if (!runs[current_run].remaining) goto done;
        }
    }
done:
    // Only a logical traversal to EOF proves absence in the whole remaining
    // context. Speculative lookahead reaching EOF, a completed current run,
    // or the enclosing link's closing bracket cannot establish this cache.
    // The caller must not apply an outer-context mask inside link text,
    // whose own emphasis candidates were intentionally skipped as opaque.
    if (character < 0 && impossible_openers != NULL) {
        *impossible_openers |= (uint16_t)(~compatible_openers & 0x0fff);
    }
    if ((character < 0 || parent_closed) && matched == 0 && unmatched_root_openers != NULL) {
        // An unmatched opener is inert in this scope. Removing it leaves the future
        // delimiter stack unchanged. Only cache its class when no future
        // opener of that class matched either; merely failing the current
        // opener is insufficient (for example, "*a *b *c*"). Never apply this
        // proof outside this parent's lifetime, inside link text, or for a
        // partially consumed run. The scanner clears a context's mask when
        // that context opens or closes, including same-class nested spans.
        unsigned bit = (delimiter == '_' ? 6 : 0) + (can_close ? 3 : 0) + original_modulo % 3;
        if (!(matched_classes & (1u << bit))) *unmatched_root_openers |= (uint16_t)(1u << bit);
        // A later matched opener of the same class prevents an absence mask,
        // but earlier candidates still cannot match. Count physical star runs
        // to expire this proof before that first matched opener. Rich links
        // can contribute extra actual runs, expiring the bound earlier; code,
        // HTML and URI atoms are opaque to both traversals. Math is opaque only
        // at runtime, so a dollar sign disables this ordinal optimization.
        // Intraword underscores can be internal word tokens, so only stars use
        // ordinal bounds. Boundaries count runs consumed BEFORE a candidate.
        if (delimiter == '*' && !saw_math && next_matched_star != NULL &&
            first_matched_star[bit] != UINT32_MAX &&
            star_ordinal <= UINT32_MAX - first_matched_star[bit]) {
            uint32_t boundary = star_ordinal + first_matched_star[bit];
            if (boundary > next_matched_star[bit]) next_matched_star[bit] = boundary;
        }
    }
    free(input.characters);
    free(runs);
    return matched;
}

static uint32_t emphasis_opening_matches_in_context(TSLexer *lexer, int32_t delimiter,
                                        uint32_t count, bool can_open,
                                        bool can_close, bool in_link_text,
                                        bool bare_autolinks,
                                        uint16_t *impossible_openers,
                                        int32_t parent_delimiter,
                                        unsigned parent_modulo,
                                        bool parent_can_close,
                                        uint32_t parent_remaining) {
    return emphasis_opening_plan_in_context(lexer, delimiter, count, can_open,
        can_close, in_link_text, bare_autolinks, impossible_openers, parent_delimiter,
        parent_modulo, parent_can_close, parent_remaining, count % 3, false, NULL, NULL, NULL, 0);
}

static uint32_t emphasis_opening_matches(TSLexer *lexer, int32_t delimiter,
                                        uint32_t count, bool can_open,
                                        bool can_close, bool in_link_text,
                                        bool bare_autolinks,
                                        uint16_t *impossible_openers) {
    return emphasis_opening_matches_in_context(lexer, delimiter, count,
        can_open, can_close, in_link_text, bare_autolinks, impossible_openers,
        0, 0, false, 0);
}

#endif
