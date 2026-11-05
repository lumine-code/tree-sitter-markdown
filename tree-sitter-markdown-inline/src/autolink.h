// GFM extended autolink recognition, independently implemented from section 6.9.
// Covered by the repository's MIT license; no renderer or external parser is used.
#ifndef TREE_SITTER_MARKDOWN_AUTOLINK_H_
#define TREE_SITTER_MARKDOWN_AUTOLINK_H_

#include "tree_sitter/parser.h"
#include "unicode.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

typedef int32_t (*BareAutolinkRead)(void *, size_t);
typedef void (*BareAutolinkAccept)(void *, size_t);
typedef enum {
    BARE_AUTOLINK_NONE,
    BARE_AUTOLINK_URI,
    BARE_AUTOLINK_EMAIL
} BareAutolinkKind;
typedef struct {
    BareAutolinkKind kind;
    size_t end;
} BareAutolinkMatch;

static bool bare_autolink_alpha(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
static bool bare_autolink_alnum(int32_t c) {
    return bare_autolink_alpha(c) || (c >= '0' && c <= '9');
}
static bool bare_autolink_space(int32_t c) {
    return c == '\v' || is_unicode_whitespace(c);
}
static bool bare_autolink_boundary(int32_t previous) {
    return previous < 0 || bare_autolink_space(previous) || previous == '*' ||
           previous == '_' || previous == '~' || previous == '(';
}
static bool bare_autolink_starts(BareAutolinkRead read, void *context,
                                  size_t start, const char *text, bool insensitive) {
    for (size_t i = 0; text[i]; i++) {
        int32_t c = read(context, start + i);
        if (insensitive && c >= 'A' && c <= 'Z') c += 'a' - 'A';
        if (c != (unsigned char)text[i]) return false;
    }
    return true;
}
static void bare_autolink_accept(BareAutolinkRead read, void *context,
                                  BareAutolinkAccept accept, size_t end) {
    // A lexer-backed reader must be at the position after the accepted prefix
    // when mark_end is called. A pure lookahead reader can omit the callback.
    (void)read(context, end);
    if (accept) accept(context, end);
}
static bool bare_autolink_host_character(int32_t c, bool email) {
    return bare_autolink_alnum(c) || c == '_' || c == '-' ||
           (!email && c >= 0x80 && !bare_autolink_space(c) && !is_unicode_punctuation(c));
}

typedef struct {
    size_t end;
    size_t accepted;
    bool valid;
} BareAutolinkDomain;

static BareAutolinkDomain bare_autolink_domain(BareAutolinkRead read, void *context,
                                               size_t start, bool email,
                                               BareAutolinkAccept accept) {
    size_t position = start;
    size_t labels = 1;
    size_t dots = 0;
    size_t accepted = start;
    bool previous_underscore = false;
    bool current_underscore = false;
    int32_t last = -1;
    if (!bare_autolink_host_character(read(context, position), email)) {
        return (BareAutolinkDomain){start, start, false};
    }
    for (;;) {
        int32_t c = read(context, position);
        if (c == '.') {
            dots++;
            position++;
            continue;
        }
        if (!bare_autolink_host_character(c, email)) break;
        if (dots) {
            // Trailing periods are punctuation; empty interior labels are not
            // domain segments. Keep the last two nonempty labels' underscores.
            if (dots > 1) return (BareAutolinkDomain){position, accepted, false};
            previous_underscore = current_underscore;
            current_underscore = false;
            labels++;
            dots = 0;
        }
        current_underscore |= c == '_';
        last = c;
        position++;
        bool valid = labels >= 2 &&
                     (email ? c != '-' && c != '_'
                            : !previous_underscore && !current_underscore);
        if (valid) {
            accepted = position;
            bare_autolink_accept(read, context, accept, accepted);
        }
    }
    bool valid = labels >= 2 &&
                 (email ? last != '-' && last != '_'
                        : !previous_underscore && !current_underscore);
    return (BareAutolinkDomain){position, accepted, valid};
}

static bool bare_autolink_trailing_punctuation(int32_t c) {
    return c == '?' || c == '!' || c == '.' || c == ',' || c == ':' ||
           c == '*' || c == '_' || c == '~';
}

static BareAutolinkMatch bare_autolink_uri(BareAutolinkRead read, void *context,
                                           size_t start, size_t host_start,
                                           BareAutolinkAccept accept) {
    BareAutolinkDomain domain = bare_autolink_domain(read, context, host_start, false, accept);
    if (!domain.valid) return (BareAutolinkMatch){BARE_AUTOLINK_NONE, start};
    size_t position = domain.end;
    size_t accepted = domain.accepted;
    int64_t parentheses = 0;
    // 0 ordinary text, 1 after &, 2 after &alnum+, 3 complete &alnum+;.
    unsigned entity = 0;
    for (;;) {
        int32_t c = read(context, position);
        if (c < 0 || c == '<' || bare_autolink_space(c)) break;
        if (entity == 1 || entity == 2) {
            if (bare_autolink_alnum(c)) {
                entity = 2;
                position++;
                continue;
            }
            if (entity == 2 && c == ';') {
                entity = 3;
                position++;
                continue;
            }
            // This was not an entity suffix. Its letters and ampersand are
            // ordinary URL text, even if punctuation follows them.
            accepted = position;
            bare_autolink_accept(read, context, accept, accepted);
            entity = 0;
        }
        if (c == '(') parentheses++;
        if (c == ')') parentheses--;
        if (c == '&') {
            entity = 1;
            position++;
            continue;
        }
        bool trailing = bare_autolink_trailing_punctuation(c) ||
                        (c == ')' && parentheses < 0);
        position++;
        if (!trailing) {
            accepted = position;
            bare_autolink_accept(read, context, accept, accepted);
            entity = 0;
        }
    }
    if (entity == 1 || entity == 2) {
        accepted = position;
        bare_autolink_accept(read, context, accept, accepted);
    }
    return (BareAutolinkMatch){BARE_AUTOLINK_URI, accepted};
}

static BareAutolinkMatch bare_autolink_email(BareAutolinkRead read, void *context,
                                             size_t start, size_t local_start,
                                             bool xmpp, BareAutolinkAccept accept) {
    size_t position = local_start;
    for (;;) {
        int32_t c = read(context, position);
        if (!bare_autolink_alnum(c) && c != '.' && c != '-' && c != '_' && c != '+') break;
        position++;
    }
    if (position == local_start || read(context, position) != '@') {
        return (BareAutolinkMatch){BARE_AUTOLINK_NONE, start};
    }
    BareAutolinkDomain domain = bare_autolink_domain(read, context, position + 1, true, accept);
    if (!domain.valid) return (BareAutolinkMatch){BARE_AUTOLINK_NONE, start};
    size_t accepted = domain.accepted;
    position = domain.end;
    if (xmpp && read(context, position) == '/') {
        position++;
        for (;;) {
            int32_t c = read(context, position);
            if (!bare_autolink_alnum(c) && c != '@' && c != '.') break;
            position++;
            if (c != '.') {
                accepted = position;
                bare_autolink_accept(read, context, accept, accepted);
            }
        }
    }
    return (BareAutolinkMatch){BARE_AUTOLINK_EMAIL, accepted};
}

// Offsets count Unicode code points in the supplied reader. It may buffer
// arbitrary lookahead; end is an absolute offset, or start when no link matches.
// The optional callback observes accepted prefix ends in forward order.
static BareAutolinkMatch bare_autolink_match(BareAutolinkRead read, void *context,
                                             size_t start, bool left_boundary,
                                             BareAutolinkAccept accept) {
    if (!left_boundary) return (BareAutolinkMatch){BARE_AUTOLINK_NONE, start};
    if (bare_autolink_starts(read, context, start, "https://", true)) {
        return bare_autolink_uri(read, context, start, start + 8, accept);
    }
    if (bare_autolink_starts(read, context, start, "http://", true)) {
        return bare_autolink_uri(read, context, start, start + 7, accept);
    }
    if (bare_autolink_starts(read, context, start, "www.", false)) {
        BareAutolinkMatch uri = bare_autolink_uri(read, context, start, start, accept);
        if (uri.kind != BARE_AUTOLINK_NONE) return uri;
    }
    if (bare_autolink_starts(read, context, start, "mailto:", true)) {
        return bare_autolink_email(read, context, start, start + 7, false, accept);
    }
    if (bare_autolink_starts(read, context, start, "xmpp:", true)) {
        return bare_autolink_email(read, context, start, start + 5, true, accept);
    }
    return bare_autolink_email(read, context, start, start, false, accept);
}

typedef struct {
    TSLexer *lexer;
    int32_t *characters;
    size_t position;
    size_t capacity;
    size_t marked;
    bool failed;
} BareAutolinkLexer;

static int32_t bare_autolink_lexer_read(void *context, size_t position) {
    BareAutolinkLexer *input = context;
    if (position < input->position) return input->characters[position];
    while (input->position < position) {
        if (input->lexer->eof(input->lexer)) return -1;
        if (input->position == input->capacity) {
            size_t next = input->capacity ? input->capacity * 2 : 32;
            if (next < input->capacity || next > SIZE_MAX / sizeof(int32_t)) {
                input->failed = true;
                return -1;
            }
            int32_t *characters = realloc(input->characters, next * sizeof(int32_t));
            if (!characters) {
                input->failed = true;
                return -1;
            }
            input->characters = characters;
            input->capacity = next;
        }
        input->characters[input->position++] = input->lexer->lookahead;
        input->lexer->advance(input->lexer, false);
    }
    return input->lexer->eof(input->lexer) ? -1 : input->lexer->lookahead;
}

static void bare_autolink_lexer_accept(void *context, size_t end) {
    BareAutolinkLexer *input = context;
    if (input->position == end) {
        input->lexer->mark_end(input->lexer);
        input->marked = end;
    }
}

// The caller assigns the URI/email token after checking its valid_symbols.
// This consumes lookahead even when returning NONE: the caller must then end
// this scanner branch, allowing Tree-sitter to reset the lexer for alternatives.
static BareAutolinkKind bare_autolink_lex(TSLexer *lexer, bool left_boundary) {
    BareAutolinkLexer input = {0};
    input.lexer = lexer;
    BareAutolinkMatch match = bare_autolink_match(bare_autolink_lexer_read, &input,
                                                 0, left_boundary,
                                                 bare_autolink_lexer_accept);
    BareAutolinkKind kind = !input.failed && input.marked == match.end
                               ? match.kind : BARE_AUTOLINK_NONE;
    free(input.characters);
    return kind;
}

#endif
