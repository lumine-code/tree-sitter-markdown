/// <reference types="tree-sitter-cli/dsl" />

module.exports.EXTENSION_DEFAULT = !process.env.NO_DEFAULT_EXTENSIONS;
module.exports.EXTENSION_GFM =
  process.env.EXTENSION_GFM ||
  module.exports.EXTENSION_DEFAULT ||
  process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_TASK_LIST =
  process.env.EXTENSION_TASK_LIST ||
  module.exports.EXTENSION_GFM ||
  process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_STRIKETHROUGH =
  process.env.EXTENSION_STRIKETHROUGH ||
  module.exports.EXTENSION_GFM ||
  process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_PIPE_TABLE =
  process.env.EXTENSION_PIPE_TABLE ||
  module.exports.EXTENSION_GFM ||
  process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_MINUS_METADATA =
  process.env.EXTENSION_MINUS_METADATA ||
  module.exports.EXTENSION_DEFAULT ||
  process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_PLUS_METADATA =
  process.env.EXTENSION_PLUS_METADATA ||
  module.exports.EXTENSION_DEFAULT ||
  process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_TAGS =
  process.env.EXTENSION_TAGS || process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_LATEX =
  process.env.EXTENSION_LATEX ||
  module.exports.EXTENSION_DEFAULT ||
  process.env.ALL_EXTENSIONS;
module.exports.EXTENSION_WIKI_LINK =
  process.env.EXTENSION_WIKI_LINK || process.env.ALL_EXTENSIONS;

const PUNCTUATION_CHARACTERS_REGEX = '!-/:-@\\[-`\\{-~';
const PUNCTUATION_CHARACTERS_ARRAY = [
  '!',
  '"',
  '#',
  '$',
  '%',
  '&',
  "'",
  '(',
  ')',
  '*',
  '+',
  ',',
  '-',
  '.',
  '/',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  '@',
  '[',
  '\\',
  ']',
  '^',
  '_',
  '`',
  '{',
  '|',
  '}',
  '~',
];

const PRECEDENCE_LEVEL_LINK = 10;

module.exports.PRECEDENCE_LEVEL_LINK = PRECEDENCE_LEVEL_LINK;

module.exports.PUNCTUATION_CHARACTERS_REGEX = PUNCTUATION_CHARACTERS_REGEX;

/** @type {Record<string, ($: GrammarSymbols<any>) => RuleOrLiteral>} */
module.exports.rules = {
  // A backslash escape. This can often be part of different nodes like link labels
  //
  // https://github.github.com/gfm/#backslash-escapes
  backslash_escape: ($) => $._backslash_escape,
  _backslash_escape: ($) =>
    new RegExp('\\\\[' + PUNCTUATION_CHARACTERS_REGEX + ']'),

  // HTML entity and numeric character references.
  //
  // The regex for entity references are build from the html_entities.json file.
  //
  // https://github.github.com/gfm/#entity-and-numeric-character-references
  entity_reference: ($) => html_entity_regex(),
  numeric_character_reference: ($) => /&#([0-9]{1,7}|[xX][0-9a-fA-F]{1,6});/,

  // These are text inside destinations and titles, not ASCII separators.
  // The inline grammar adds the corresponding delimiter-flanking markers.
  _unicode_whitespace: ($) => /[\p{Zs}&&[^ ]]/v,
  // eslint-disable-next-line no-control-regex -- Exclude all ASCII from the Unicode punctuation token.
  _unicode_punctuation: ($) => /[\p{P}&&[^\u0000-\u007f]]/v,

  link_label: ($) =>
    seq(
      '[',
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

  // Angle brackets delimit a destination; they are not part of its source range.
  // An empty <> destination has no nonempty link_destination node.
  _link_destination: ($) =>
    choice(
      $.link_destination,
      seq(
        '<',
        optional(alias($._link_destination_angle_content, $.link_destination)),
        '>',
      ),
    ),
  _link_destination_angle_content: ($) =>
    repeat1(
      choice(
        $._text_no_angle,
        $.backslash_escape,
        $.entity_reference,
        $.numeric_character_reference,
      ),
    ),
  link_destination: ($) =>
    prec.dynamic(
      PRECEDENCE_LEVEL_LINK,
      seq(
        choice(
          // first character is not a '<'
          $._word,
          $._unicode_whitespace,
          $._unicode_punctuation,
          punctuation_without($, ['<', '(', ')']),
          $.backslash_escape,
          $.entity_reference,
          $.numeric_character_reference,
          $._link_destination_parenthesis,
        ),
        repeat(
          choice(
            $._word,
            $._unicode_whitespace,
            $._unicode_punctuation,
            punctuation_without($, ['(', ')']),
            $.backslash_escape,
            $.entity_reference,
            $.numeric_character_reference,
            $._link_destination_parenthesis,
          ),
        ),
      ),
    ),
  _link_destination_parenthesis: ($) =>
    seq(
      '(',
      repeat(
        choice(
          $._word,
          $._unicode_whitespace,
          $._unicode_punctuation,
          punctuation_without($, ['(', ')']),
          $.backslash_escape,
          $.entity_reference,
          $.numeric_character_reference,
          $._link_destination_parenthesis,
        ),
      ),
      ')',
    ),
  _text_no_angle: ($) =>
    choice(
      $._word,
      $._unicode_whitespace,
      $._unicode_punctuation,
      punctuation_without($, ['<', '>']),
      $._whitespace,
    ),
  link_title: ($) =>
    choice(
      seq(
        '"',
        repeat(
          choice(
            $._word,
            $._unicode_whitespace,
            $._unicode_punctuation,
            punctuation_without($, ['"']),
            $._whitespace,
            $.backslash_escape,
            $.entity_reference,
            $.numeric_character_reference,
            seq(
              $._soft_line_break,
              optional(seq($._soft_line_break, $._trigger_error)),
            ),
          ),
        ),
        '"',
      ),
      seq(
        "'",
        repeat(
          choice(
            $._word,
            $._unicode_whitespace,
            $._unicode_punctuation,
            punctuation_without($, ["'"]),
            $._whitespace,
            $.backslash_escape,
            $.entity_reference,
            $.numeric_character_reference,
            seq(
              $._soft_line_break,
              optional(seq($._soft_line_break, $._trigger_error)),
            ),
          ),
        ),
        "'",
      ),
      seq(
        '(',
        repeat(
          choice(
            $._word,
            $._unicode_whitespace,
            $._unicode_punctuation,
            punctuation_without($, ['(', ')']),
            $._whitespace,
            $.backslash_escape,
            $.entity_reference,
            $.numeric_character_reference,
            seq(
              $._soft_line_break,
              optional(seq($._soft_line_break, $._trigger_error)),
            ),
          ),
        ),
        ')',
      ),
    ),

  _newline_token: ($) => /\n|\r\n?/,
};

// Returns a rule that matches all characters that count as punctuation inside markdown, besides
// a list of excluded punctuation characters. Calling this function with a empty list as the second
// argument returns a rule that matches all punctuation.
function punctuation_without($, chars) {
  return seq(
    choice(...PUNCTUATION_CHARACTERS_ARRAY.filter((c) => !chars.includes(c))),
    optional($._last_token_punctuation),
  );
}

module.exports.punctuation_without = punctuation_without;

// Constructs a regex that matches all html entity references.
function html_entity_regex() {
  // A file with all html entities, should be kept up to date with
  // https://html.spec.whatwg.org/multipage/entities.json
  let html_entities = require('./html_entities.json');
  let s = '&(';
  s += Object.keys(html_entities)
    .map((name) => name.substring(1, name.length - 1))
    .join('|');
  s += ');';
  return new RegExp(s);
}
