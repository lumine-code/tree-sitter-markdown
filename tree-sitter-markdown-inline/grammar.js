// This grammar only concerns the inline structure according to the CommonMark Spec
// (https://spec.commonmark.org/0.30/#inlines)
// For more information see README.md

/// <reference types="tree-sitter-cli/dsl" />

const common = require('../common/common');

// Levels used for dynmic precedence. Ideally
// n * PRECEDENCE_LEVEL_EMPHASIS > PRECEDENCE_LEVEL_LINK for any n, so maybe the
// maginuted of these values should be increased in the future
const PRECEDENCE_LEVEL_LINK = 10;
const PRECEDENCE_LEVEL_HTML = 100;

// Punctuation characters as specified in
// https://github.github.com/gfm/#ascii-punctuation-character
const PUNCTUATION_CHARACTERS_REGEX = '!-/:-@\\[-`\\{-~';
const ASCII_PUNCTUATION = Array.from({ length: 94 }, (_, index) =>
  String.fromCharCode(index + 33),
).filter((character) => !/[a-zA-Z0-9]/.test(character));

// !!!
// Notice the call to `add_inline_rules` which generates some additional rules related to parsing
// inline contents in different contexts.
// !!!
module.exports = grammar(
  add_inline_rules({
    name: 'markdown_inline',

    externals: ($) => [
      // An `$._error` token is never valid  and gets emmited to kill invalid parse branches. Concretely
      // this is used to decide wether a newline closes a paragraph and together and it gets emitted
      // when trying to parse the `$._trigger_error` token in `$.link_title`.
      $._error,
      $._trigger_error,

      // Opening and closing delimiters for code spans. These are sequences of one or more backticks.
      // An opening token does not mean the text after has to be a code span if there is no closing token
      $._code_span_start,
      $._code_span_close,

      // Whole-run flanking and modulo are retained for every marker.
      ...emphasis_tokens($),

      // For emphasis we need to tell the parser if the last character was a whitespace (or the
      // beginning of a line) or punctuation. Zero-width tokens retain this
      // context when an internal token or an incremental subtree is consumed.
      $._last_token_whitespace,
      $._last_token_punctuation,
      $._last_token_other,

      $._strikethrough_open,
      $._strikethrough_close,

      // Opening and closing delimiters for latex. These are sequences of one or more dollar signs.
      // An opening token does not mean the text after has to be latex if there is no closing token
      $._latex_span_start,
      $._latex_span_close,

      // Token emmited when encountering opening delimiters for a leaf span
      // e.g. a code span, that does not have a matching closing span
      $._unclosed_span,
      $._nonblank_link_text,
      $._tag,
      $._in_link_text,
      $._last_token_boundary,
      $._literal_delimiter,
      $._prepare_inline,
      $._bare_uri_autolink,
      $._bare_email_autolink,
      ...emphasis_parent_tokens($),
      $._bare_autolinks_enabled,
      $._close_star_em,
      $._close_star_strong,
      $._close_underscore_em,
      $._close_underscore_strong,
      $._raw_star,
      $._raw_underscore,
      $._image_text_start,
      $._image_text_end,
      $._strikethrough_open_double,
      $._strikethrough_close_double,
      $._raw_tilde,
      $._parent_tilde_single,
      $._parent_tilde_double,
      $._strikethrough_enabled,
      $._strikethrough_open_both,
      $._strikethrough_open_double_both,
      $._parent_tilde_single_both,
      $._parent_tilde_double_both,
      $._last_token_escaped_tilde,
    ],
    precedences: ($) => [
      [$.hard_line_break, $._whitespace],
      [$.hard_line_break, $._text_base],
      [$.hard_line_break, $._text_inline_base],
    ],
    // More conflicts are defined in `add_inline_rules`
    conflicts: ($) => [
      [$._image_description_non_empty, $._inline_element],
      [$._open_bracket, $._link_text_non_empty],

      [$._closing_tag, $._text_base],
      [$._open_tag, $._text_base],
      [$._html_comment, $._text_base],
      [$._processing_instruction, $._text_base],
      [$._declaration, $._text_base],
      [$._cdata_section, $._text_base],
      [$._closing_tag, $._text_inline_base],
      [$._open_tag, $._text_inline_base],
      [$._html_comment, $._text_inline_base],
      [$._processing_instruction, $._text_inline_base],
      [$._declaration, $._text_inline_base],
      [$._cdata_section, $._text_inline_base],

      [$._link_text_non_empty, $._inline_element],
      [$._link_text, $._inline_element],

      [$._image_description, $._image_description_non_empty, $._text_base],
      [
        $._image_description,
        $._image_description_non_empty,
        $._text_inline_base,
      ],
      // [$._image_description, $._image_description_non_empty, $._text_inline],
      // [$._image_description, $._image_description_non_empty, $._text_inline_no_star],
      // [$._image_description, $._image_description_non_empty, $._text_inline_no_underscore],

      [$._image_shortcut_link, $._image_description],
      [$.shortcut_link, $._link_text],
      [$.link_destination, $.link_title],
      [$._link_destination_parenthesis, $.link_title],

      [$.wiki_link, $._inline_element],
    ],
    extras: ($) => [],

    rules: {
      inline: ($) => seq(optional($._last_token_whitespace), $._inline),

      ...common.rules,
      bare_uri_autolink: ($) => $._bare_uri_autolink,
      bare_email_autolink: ($) => $._bare_email_autolink,
      backslash_escape: ($) =>
        choice(
          seq(token('\\~'), optional($._last_token_escaped_tilde)),
          seq(
            token(seq('\\', choice('*', '_', '('))),
            optional($._last_token_boundary),
          ),
          seq(
            token(
              seq(
                '\\',
                choice(
                  ...ASCII_PUNCTUATION.filter(
                    (character) => !'*_~('.includes(character),
                  ),
                ),
              ),
            ),
            optional($._last_token_punctuation),
          ),
        ),
      _open_bracket: ($) => choice('[', alias($._nonblank_link_text, '[')),
      link_label: ($) =>
        seq(
          $._open_bracket,
          repeat1(
            choice(
              $._text_inline_no_link,
              $.backslash_escape,
              $.entity_reference,
              $.numeric_character_reference,
              $._soft_line_break,
            ),
          ),
          ']',
        ),

      // A lot of inlines are defined in `add_inline_rules`, including:
      //
      // * collections of inlines
      // * emphasis
      // * textual content
      //
      // This is done to reduce code duplication, as some inlines need to be parsed differently
      // depending on the context. For example inlines in ATX headings may not contain newlines.

      code_span: ($) =>
        seq(
          alias($._code_span_start, $.code_span_delimiter),
          repeat(
            choice($._text_base, $._open_bracket, ']', $._soft_line_break),
          ),
          alias($._code_span_close, $.code_span_delimiter),
        ),

      latex_block: ($) =>
        seq(
          alias($._latex_span_start, $.latex_span_delimiter),
          repeat(
            choice(
              $._text_base,
              $._open_bracket,
              ']',
              $._soft_line_break,
              $._html_tag,
              $.backslash_escape,
            ),
          ),
          alias($._latex_span_close, $.latex_span_delimiter),
        ),

      // Different kinds of links:
      // * inline links (https://github.github.com/gfm/#inline-link)
      // * full reference links (https://github.github.com/gfm/#full-reference-link)
      // * collapsed reference links (https://github.github.com/gfm/#collapsed-reference-link)
      // * shortcut links (https://github.github.com/gfm/#shortcut-reference-link)
      //
      // Dynamic precedence is distributed as granular as possible to help the parser decide
      // while parsing which branch is the most important.
      //
      // https://github.github.com/gfm/#links
      _link_text: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_LINK,
          choice(
            $._link_text_non_empty,
            seq(
              $._open_bracket,
              optional($._last_token_punctuation),
              optional(
                alias(
                  repeat1(
                    seq(
                      optional($._prepare_inline),
                      choice(
                        $._whitespace,
                        $._unicode_whitespace,
                        $._form_feed,
                        $._soft_line_break,
                      ),
                    ),
                  ),
                  $.link_text,
                ),
              ),
              optional($._prepare_inline),
              ']',
              optional($._last_token_punctuation),
            ),
          ),
        ),
      _link_text_non_empty: ($) =>
        prec.right(
          seq(
            alias($._nonblank_link_text, '['),
            optional($._last_token_punctuation),
            alias($._inline_no_link, $.link_text),
            optional($._prepare_inline),
            ']',
            optional($._last_token_punctuation),
          ),
        ),
      shortcut_link: ($) =>
        prec.dynamic(PRECEDENCE_LEVEL_LINK, $._link_text_non_empty),
      full_reference_link: ($) =>
        prec.dynamic(
          2 * PRECEDENCE_LEVEL_LINK,
          seq($._link_text, optional($._prepare_inline), $.link_label),
        ),
      collapsed_reference_link: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_LINK,
          seq($._link_text, optional($._prepare_inline), $._open_bracket, ']'),
        ),
      inline_link: ($) =>
        prec.dynamic(
          2 * PRECEDENCE_LEVEL_HTML,
          seq(
            $._link_text,
            optional($._prepare_inline),
            '(',
            repeat(choice($._whitespace, $._soft_line_break)),
            optional(
              seq(
                choice(
                  seq(
                    $._link_destination,
                    optional(
                      seq(
                        repeat1(choice($._whitespace, $._soft_line_break)),
                        $.link_title,
                      ),
                    ),
                  ),
                  $.link_title,
                ),
                repeat(choice($._whitespace, $._soft_line_break)),
              ),
            ),
            ')',
          ),
        ),

      wiki_link: ($) =>
        prec.dynamic(
          2 * PRECEDENCE_LEVEL_LINK,
          seq(
            $._open_bracket,
            optional($._last_token_punctuation),
            $._open_bracket,
            optional($._last_token_punctuation),
            alias($._wiki_link_destination, $.link_destination),
            optional(
              seq(
                '|',
                optional($._last_token_punctuation),
                alias($._wiki_link_text, $.link_text),
              ),
            ),
            ']',
            optional($._last_token_punctuation),
            ']',
            optional($._last_token_punctuation),
          ),
        ),

      _wiki_link_destination: ($) =>
        repeat1(
          choice(
            $._word,
            $._unicode_punctuation,
            $._unicode_whitespace,
            punctuation_without($, ['[', ']', '|']),
            $._whitespace,
          ),
        ),

      _wiki_link_text: ($) =>
        repeat1(
          choice(
            $._word,
            $._unicode_punctuation,
            $._unicode_whitespace,
            punctuation_without($, ['[', ']']),
            $._whitespace,
          ),
        ),

      // Images work exactly like links with a '!' added in front.
      //
      // https://github.github.com/gfm/#images
      image: ($) =>
        choice(
          $._image_inline_link,
          $._image_shortcut_link,
          $._image_full_reference_link,
          $._image_collapsed_reference_link,
        ),
      _image_inline_link: ($) =>
        prec.dynamic(
          2 * PRECEDENCE_LEVEL_HTML,
          seq(
            $._image_description,
            optional($._prepare_inline),
            '(',
            repeat(choice($._whitespace, $._soft_line_break)),
            optional(
              seq(
                choice(
                  seq(
                    $._link_destination,
                    optional(
                      seq(
                        repeat1(choice($._whitespace, $._soft_line_break)),
                        $.link_title,
                      ),
                    ),
                  ),
                  $.link_title,
                ),
                repeat(choice($._whitespace, $._soft_line_break)),
              ),
            ),
            ')',
          ),
        ),
      _image_shortcut_link: ($) =>
        prec.dynamic(3 * PRECEDENCE_LEVEL_LINK, $._image_description_non_empty),
      _image_full_reference_link: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_LINK,
          seq($._image_description, optional($._prepare_inline), $.link_label),
        ),
      _image_collapsed_reference_link: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_LINK,
          seq(
            $._image_description,
            optional($._prepare_inline),
            $._open_bracket,
            ']',
          ),
        ),
      _image_description: ($) =>
        prec.dynamic(
          3 * PRECEDENCE_LEVEL_LINK,
          choice(
            $._image_description_non_empty,
            seq(
              '!',
              optional($._last_token_punctuation),
              optional($._prepare_inline),
              $._open_bracket,
              optional($._last_token_punctuation),
              optional($._prepare_inline),
              prec(1, ']'),
              optional($._last_token_punctuation),
            ),
          ),
        ),
      _image_description_non_empty: ($) =>
        prec.right(
          seq(
            '!',
            optional($._last_token_punctuation),
            optional($._prepare_inline),
            $._open_bracket,
            optional($._last_token_punctuation),
            $._image_text_start,
            alias($._inline, $.image_description),
            optional($._prepare_inline),
            prec(1, ']'),
            optional($._last_token_punctuation),
            $._image_text_end,
          ),
        ),

      // Autolinks. Uri autolinks actually accept protocolls of arbitrary length which does not
      // align with the spec. This is because the binary for the grammar gets to large if done
      // otherwise as tree-sitters code generation is not very concise for this type of regex.
      //
      // Email autolinks do not match every valid email (emails normally should not be parsed
      // using regexes), but this is how they are defined in the spec.
      //
      // https://github.github.com/gfm/#autolinks
      uri_autolink: ($) =>
        /<[a-zA-Z][a-zA-Z0-9+\.\-][a-zA-Z0-9+\.\-]*:[^ \t\r\n<>]*>/,
      email_autolink: ($) =>
        /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>/,

      // Raw html. As with html blocks we do not emit additional information as this is best done
      // by a proper html tree-sitter grammar.
      //
      // https://github.github.com/gfm/#raw-html
      _html_tag: ($) =>
        choice(
          $._open_tag,
          $._closing_tag,
          $._html_comment,
          $._processing_instruction,
          $._declaration,
          $._cdata_section,
        ),
      _open_tag: ($) =>
        token(
          /<[A-Za-z][A-Za-z0-9-]*(?:[ \t\r\n]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t\r\n]*=[ \t\r\n]*(?:[^ \t\r\n"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\r\n]*\/?>/,
        ),
      _closing_tag: ($) => token(/<\/[A-Za-z][A-Za-z0-9-]*[ \t\r\n]*>/),
      _html_comment: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_HTML,
          seq(
            '<!--',
            optional(
              seq(
                choice(
                  $._word,
                  $._whitespace,
                  $._soft_line_break,
                  punctuation_without($, ['-', '>']),
                  seq('-', punctuation_without($, ['>'])),
                ),
                repeat(
                  prec.right(
                    choice(
                      $._word,
                      $._whitespace,
                      $._soft_line_break,
                      punctuation_without($, ['-']),
                      seq(
                        '-',
                        choice(
                          $._word,
                          $._whitespace,
                          $._soft_line_break,
                          punctuation_without($, ['-']),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            '-->',
          ),
        ),
      _processing_instruction: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_HTML,
          seq(
            '<?',
            repeat(
              prec.right(
                choice(
                  $._word,
                  $._whitespace,
                  $._soft_line_break,
                  punctuation_without($, []),
                ),
              ),
            ),
            '?>',
          ),
        ),
      _declaration: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_HTML,
          seq(
            /<![A-Z]+/,
            choice($._whitespace, $._soft_line_break),
            repeat(
              prec.right(
                choice(
                  $._word,
                  $._whitespace,
                  $._soft_line_break,
                  punctuation_without($, ['>']),
                ),
              ),
            ),
            '>',
          ),
        ),
      _cdata_section: ($) =>
        prec.dynamic(
          PRECEDENCE_LEVEL_HTML,
          seq(
            '<![CDATA[',
            repeat(
              prec.right(
                choice(
                  $._word,
                  $._whitespace,
                  $._soft_line_break,
                  punctuation_without($, []),
                ),
              ),
            ),
            ']]>',
          ),
        ),

      // A hard line break.
      //
      // https://github.github.com/gfm/#hard-line-breaks
      hard_line_break: ($) =>
        seq(
          token(seq(choice('\\', /\t| [ \t]+/), /\r?\n/)),
          optional($._last_token_whitespace),
        ),
      _text: ($) => choice($._word, punctuation_without($, []), $._whitespace),

      // Whitespace is divided into single whitespaces and multiple whitespaces as wee need this
      // information for hard line breaks.
      _whitespace_ge_2: ($) => /\t| [ \t]+/,
      _whitespace: ($) =>
        seq(
          choice($._whitespace_ge_2, / /),
          optional($._last_token_whitespace),
        ),
      _unicode_whitespace: ($) =>
        seq(/[\p{Zs}&&[^ ]]/v, optional($._last_token_whitespace)),
      _form_feed: ($) => seq(/\f/, optional($._last_token_whitespace)),
      _unicode_punctuation: ($) =>
        // eslint-disable-next-line no-control-regex -- ASCII punctuation has separate grammar tokens.
        seq(/[\p{P}&&[^\u0000-\u007f]]/v, optional($._last_token_punctuation)),

      // Other than whitespace we tokenize into strings of digits, punctuation characters
      // (handled by `common.punctuation_without`) and strings of any other characters. This way the
      // lexer does not have to many different states, which makes it a lot easier to make
      // conflicts work.
      _word: ($) => choice($._word_no_digit, $._digits),
      _word_no_digit: ($) =>
        seq(
          new RegExp(
            '[^' +
              PUNCTUATION_CHARACTERS_REGEX +
              '\\p{P}\\p{Zs}\\t\\n\\r\\f0-9]+(_+[^' +
              PUNCTUATION_CHARACTERS_REGEX +
              '\\p{P}\\p{Zs}\\t\\n\\r\\f0-9]+)*',
            'u',
          ),
          optional($._last_token_other),
        ),
      _digits: ($) => seq(/[0-9]+(_+[0-9]+)*/, optional($._last_token_other)),
      _soft_line_break: ($) =>
        seq($._newline_token, optional($._last_token_whitespace)),

      _inline_base: ($) =>
        choice(
          seq($.image, optional($._last_token_punctuation)),
          $._soft_line_break,
          $.backslash_escape,
          $.hard_line_break,
          seq($.uri_autolink, optional($._last_token_punctuation)),
          seq($.email_autolink, optional($._last_token_punctuation)),
          seq($.entity_reference, optional($._last_token_punctuation)),
          seq(
            $.numeric_character_reference,
            optional($._last_token_punctuation),
          ),
          common.EXTENSION_LATEX
            ? seq($.latex_block, optional($._last_token_punctuation))
            : choice(),
          seq($.code_span, optional($._last_token_punctuation)),
          seq(
            alias($._html_tag, $.html_tag),
            optional($._last_token_punctuation),
          ),
          $._text_inline_base,
          common.EXTENSION_TAGS ? $.tag : choice(),
          seq($._unclosed_span, optional($._last_token_punctuation)),
          seq($._literal_delimiter, optional($._last_token_boundary)),
          ...(common.EXTENSION_GFM
            ? [$.bare_uri_autolink, $.bare_email_autolink]
            : []),
        ),
      _text_inline_base: ($) =>
        choice(
          $._word,
          $._unicode_punctuation,
          $._unicode_whitespace,
          $._form_feed,
          $._whitespace,
          punctuation_without($, [
            '[',
            ']',
            '*',
            '_',
            ...(common.EXTENSION_STRIKETHROUGH ? ['~'] : []),
          ]),
          '<!--',
          /<![A-Z]+/,
          '<?',
          '<![CDATA[',
        ),
      _text_base: ($) =>
        choice(
          $._word,
          $._unicode_punctuation,
          $._unicode_whitespace,
          $._form_feed,
          $._whitespace,
          punctuation_without($, ['[', ']']),
          '<!--',
          /<![A-Z]+/,
          '<?',
          '<![CDATA[',
        ),
      _text_inline_no_link: ($) =>
        choice(
          $._text_base,
          $._literal_star,
          $._literal_underscore,
          $._unclosed_span,
        ),

      ...(common.EXTENSION_TAGS
        ? {
            tag: ($) => $._tag,
          }
        : {}),
    },
  }),
);

// This function adds some extra inline rules. This is done to reduce code duplication, as some
// rules may not contain newlines, characters like '*' and '_', ... depending on the context.
//
// This is by far the most ugly part of this code and should be cleaned up.

function emphasis_tokens($) {
  return ['star', 'underscore'].flatMap((delimiter) =>
    ['open', 'both'].flatMap((mode) =>
      [0, 1, 2].flatMap((modulo) =>
        ['em', 'strong'].map(
          (unit) =>
            $['_open_' + delimiter + '_' + mode + '_' + modulo + '_' + unit],
        ),
      ),
    ),
  );
}

function emphasis_parent_tokens($) {
  return [
    $._parent_root,
    ...['star', 'underscore'].flatMap((delimiter) =>
      ['open', 'both'].flatMap((mode) =>
        [0, 1, 2].map(
          (modulo) => $['_parent_' + delimiter + '_' + mode + '_' + modulo],
        ),
      ),
    ),
    $._parent_em,
    $._parent_strong,
  ];
}

function add_inline_rules(grammar) {
  const conflicts = [];
  for (const delimiter of [
    'star',
    'underscore',
    ...(common.EXTENSION_STRIKETHROUGH ? ['tilde'] : []),
  ]) {
    grammar.rules['_literal_' + delimiter] = ($) => $['_raw_' + delimiter];
  }
  for (const link of [true, false]) {
    const suffix = link ? '' : '_no_link';
    const pairs = [];
    const prefix = ($, context) => [
      ...(context ? [optional($[context])] : []),
      ...(link === true ? [] : [optional($._in_link_text)]),
      ...(common.EXTENSION_GFM ? [optional($._bare_autolinks_enabled)] : []),
      ...(common.EXTENSION_STRIKETHROUGH
        ? [optional($._strikethrough_enabled)]
        : []),
      optional($._prepare_inline),
    ];
    const elements = ($, excluded) => {
      const result = [
        $._inline_base,
        ...pairs.map((pair) => alias($[pair.name], $[pair.node])),
      ];
      if (excluded !== 'star') result.push($._literal_star);
      if (excluded !== 'underscore') result.push($._literal_underscore);
      if (common.EXTENSION_STRIKETHROUGH && excluded !== 'tilde')
        result.push($._literal_tilde);
      if (link) {
        result.push(
          seq(
            choice(
              $.shortcut_link,
              $.full_reference_link,
              $.collapsed_reference_link,
              $.inline_link,
            ),
            optional($._last_token_punctuation),
          ),
          seq(
            choice($._open_bracket, ']'),
            optional($._last_token_punctuation),
          ),
        );
        if (common.EXTENSION_WIKI_LINK) result.push($.wiki_link);
      }
      return choice(...result);
    };
    for (const delimiter of ['star', 'underscore']) {
      for (const mode of ['open', 'both']) {
        for (const modulo of [0, 1, 2]) {
          if (mode === 'both' && modulo === 0) continue;
          for (const strong of [false, true]) {
            const unit = strong ? 'strong' : 'em';
            const name =
              '_' + unit + '_' + delimiter + '_' + mode + '_' + modulo + suffix;
            const body = '_body_' + delimiter + suffix;
            const endpoint = '_content_no_' + delimiter + suffix;
            const context = '_parent_' + delimiter + '_' + mode + '_' + modulo;
            pairs.push({
              name,
              node: strong ? 'strong_emphasis' : 'emphasis',
              delimiter,
              strong,
            });
            grammar.rules[name] = ($) => {
              const opening =
                modulo === 0
                  ? choice(
                      $['_open_' + delimiter + '_open_0_' + unit],
                      $['_open_' + delimiter + '_both_0_' + unit],
                    )
                  : $[
                      '_open_' +
                        delimiter +
                        '_' +
                        mode +
                        '_' +
                        modulo +
                        '_' +
                        unit
                    ];
              const open = alias(opening, $.emphasis_delimiter);
              const close = alias(
                $['_close_' + delimiter + '_' + unit],
                $.emphasis_delimiter,
              );
              return prec.dynamic(
                strong ? 3 : 1,
                seq(
                  open,
                  $[body],
                  optional($[context]),
                  optional(strong ? $._parent_strong : $._parent_em),
                  optional($._prepare_inline),
                  close,
                ),
              );
            };
            grammar.rules[endpoint] = ($) => elements($, delimiter, false);
            grammar.rules[body] = ($) => {
              const middle = seq(
                ...prefix($, null),
                $['_literal_' + delimiter],
              );
              const item = seq(...prefix($, null), $[endpoint]);
              return seq(item, repeat(seq(repeat(middle), item)));
            };
            conflicts.push([body]);
            for (const element of [endpoint]) {
              if (link)
                conflicts.push(
                  ['_link_text', element],
                  ['_link_text_non_empty', element],
                  ['wiki_link', element],
                );
            }
          }
        }
      }
    }
    if (common.EXTENSION_STRIKETHROUGH) {
      const body = '_body_tilde' + suffix;
      const endpoint = '_content_no_tilde' + suffix;
      for (const width of ['single', 'double']) {
        for (const mode of ['open', 'both']) {
          const widthSuffix = width === 'double' ? '_double' : '';
          const modeSuffix = mode === 'both' ? '_both' : '';
          const name = '_strikethrough_' + width + '_' + mode + suffix;
          const context = '_parent_tilde_' + width + modeSuffix;
          pairs.push({ name, node: 'strikethrough', delimiter: 'tilde' });
          grammar.rules[name] = ($) =>
            prec.dynamic(
              1,
              seq(
                alias(
                  $['_strikethrough_open' + widthSuffix + modeSuffix],
                  $.emphasis_delimiter,
                ),
                $[body],
                optional($[context]),
                optional($._prepare_inline),
                alias(
                  $['_strikethrough_close' + widthSuffix],
                  $.emphasis_delimiter,
                ),
              ),
            );
        }
      }
      grammar.rules[endpoint] = ($) => elements($, 'tilde');
      grammar.rules[body] = ($) => {
        const middle = seq(...prefix($, null), $._literal_tilde);
        const item = seq(...prefix($, null), $[endpoint]);
        return seq(item, repeat(seq(repeat(middle), item)));
      };
      conflicts.push([body]);
      if (link)
        conflicts.push(
          ['_link_text', endpoint],
          ['_link_text_non_empty', endpoint],
          ['wiki_link', endpoint],
        );
    }
    const name = '_inline_element' + suffix;
    grammar.rules[name] = ($) => seq(...prefix($, '_parent_root'), elements($));
    grammar.rules['_inline' + suffix] = ($) => repeat1($[name]);
  }
  const oldConflicts = grammar.conflicts;
  const unique = [
    ...new Map(
      conflicts.map((names) => [names.toSorted().join(','), names]),
    ).values(),
  ];
  grammar.conflicts = ($) => [
    ...oldConflicts($),
    ...unique.map((names) => names.map((name) => $[name])),
  ];
  return grammar;
}

function punctuation_without($, excluded) {
  const characters = ASCII_PUNCTUATION.filter(
    (character) => !excluded.includes(character),
  );
  const boundaries = characters.filter((character) =>
    '*_~('.includes(character),
  );
  const other = characters.filter((character) => !'*_~('.includes(character));
  return choice(
    ...(other.length
      ? [
          seq(
            other.length === 1 ? other[0] : choice(...other),
            optional($._last_token_punctuation),
          ),
        ]
      : []),
    ...(boundaries.length
      ? [
          seq(
            boundaries.length === 1 ? boundaries[0] : choice(...boundaries),
            optional($._last_token_boundary),
          ),
        ]
      : []),
  );
}
