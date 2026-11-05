const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Language, Parser } = require('web-tree-sitter');
const specification = require('./fixtures/gfm-emphasis.json');
const reference = require('./fixtures/emphasis-reference.json');
const entities = require('../common/html_entities.json');

let language;

before(async () => {
  await Parser.init();
  language = await Language.load(
    process.env.MARKDOWN_INLINE_WASM ??
      path.resolve(__dirname, '..', 'tree-sitter-markdown_inline.wasm'),
  );
});

// Compare the specified semantic nesting rather than parser-specific helper
// nodes or the parser's own corpus expectations. HTML comes from the pinned
// published GFM specification, including its nested strong-emphasis cases.
function append(target, value) {
  if (typeof value === 'string') {
    if (!value) return;
    if (typeof target.at(-1) === 'string') target[target.length - 1] += value;
    else target.push(value);
  } else {
    target.push(value);
  }
}

function decodeEntities(text) {
  return text.replace(
    /&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]+);/g,
    (entity) => {
      if (entity.startsWith('&#')) {
        const value =
          entity[2].toLowerCase() === 'x'
            ? Number.parseInt(entity.slice(3, -1), 16)
            : Number.parseInt(entity.slice(2, -1), 10);
        return String.fromCodePoint(value);
      }
      return entities[entity]?.characters ?? entity;
    },
  );
}

function htmlEmphasis(html) {
  html = html.replace(/^<p>/, '').replace(/<\/p>\n$/, '');
  const root = [];
  const stack = [root];
  let position = 0;
  for (const match of html.matchAll(/<(?:(?:"[^"]*"|'[^']*')|[^'">])*>/g)) {
    append(stack.at(-1), decodeEntities(html.slice(position, match.index)));
    const emphasis = match[0].match(/^<(\/)?(em|strong)>$/);
    if (emphasis) {
      if (emphasis[1]) {
        assert.ok(stack.length > 1, html);
        stack.pop();
      } else {
        const node = [emphasis[2], []];
        append(stack.at(-1), node);
        stack.push(node[1]);
      }
    }
    position = match.index + match[0].length;
  }
  append(stack.at(-1), decodeEntities(html.slice(position)));
  assert.equal(stack.length, 1, html);
  return root;
}

function treeEmphasis(node, source) {
  if (node.type === 'backslash_escape') return [node.text.slice(1)];
  if (
    node.type === 'entity_reference' ||
    node.type === 'numeric_character_reference'
  ) {
    return [decodeEntities(node.text)];
  }
  if (node.type === 'html_tag' || node.type === 'image') return [];
  if (node.type === 'uri_autolink' || node.type === 'email_autolink') {
    return [node.text.slice(1, -1)];
  }
  if (node.type === 'inline_link') {
    return treeEmphasis(
      node.namedChildren.find((child) => child.type === 'link_text'),
      source,
    );
  }
  if (node.type === 'code_span') {
    const delimiter = node.text.match(/^`+/)[0];
    let text = node.text
      .slice(delimiter.length, -delimiter.length)
      .replace(/\r\n?|\n/g, ' ');
    if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text))
      text = text.slice(1, -1);
    return [text];
  }
  const result = [];
  // Delimiters belong to source ranges, not rendered content. Clip the known
  // one/two-character boundaries without depending on scanner helper tokens.
  const width =
    node.type === 'emphasis' ? 1 : node.type === 'strong_emphasis' ? 2 : 0;
  const endIndex = node.endIndex - width;
  let position = node.startIndex + width;
  for (const child of node.namedChildren) {
    if (child.endIndex <= position || child.startIndex >= endIndex) continue;
    append(result, source.slice(position, child.startIndex));
    const children = treeEmphasis(child, source);
    if (child.type === 'emphasis' || child.type === 'strong_emphasis') {
      append(result, [child.type === 'emphasis' ? 'em' : 'strong', children]);
    } else {
      for (const item of children) append(result, item);
    }
    position = child.endIndex;
  }
  append(result, source.slice(position, endIndex));
  return result;
}

for (const example of reference.cases) {
  test(`cmark-gfm reference: ${example.name}`, () => {
    const { parser, tree } = parse(example.markdown);
    try {
      assert.equal(tree.rootNode.hasError, false, example.markdown);
      assert.deepEqual(
        treeEmphasis(tree.rootNode, example.markdown),
        htmlEmphasis(example.html),
        `${example.markdown}\n${example.html}\n${tree.rootNode.toString()}`,
      );
    } finally {
      tree.delete();
      parser.delete();
    }
  });
}

function parse(source) {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  return { parser, tree };
}

for (const example of specification.examples) {
  test(`GFM emphasis example ${example.number} matches the published semantic tree`, () => {
    const source = example.markdown.replace(/\n$/, '');
    const { parser, tree } = parse(source);
    try {
      assert.equal(tree.rootNode.hasError, false, example.markdown);
      assert.deepEqual(
        treeEmphasis(tree.rootNode, source),
        htmlEmphasis(example.html),
        `${example.markdown}\n${example.html}\n${tree.rootNode.toString()}`,
      );
    } finally {
      tree.delete();
      parser.delete();
    }
  });
}

const rangeCases = [
  ['*a *b *c*', [['emphasis', 6, 9]]],
  ['**a****b', []],
  ['**a****b**a****b', [['strong_emphasis', 0, 10]]],
  [
    '**a****b**a****b**a****b',
    [
      ['strong_emphasis', 0, 10],
      ['strong_emphasis', 11, 23],
      ['strong_emphasis', 13, 21],
    ],
  ],
  ['*a _b* c_', [['emphasis', 0, 6]]],
  ['_a **b_ c**', [['emphasis', 0, 7]]],
  ['*foo**bar*', [['emphasis', 0, 10]]],
  [
    '*foo**bar***',
    [
      ['emphasis', 0, 12],
      ['strong_emphasis', 4, 11],
    ],
  ],
  [
    '**foo*bar*baz**',
    [
      ['strong_emphasis', 0, 15],
      ['emphasis', 5, 10],
    ],
  ],
  ['**foo*', [['emphasis', 1, 6]]],
  ['***foo**', [['strong_emphasis', 1, 8]]],
  ['*foo**', [['emphasis', 0, 5]]],
  [
    '****foo****',
    [
      ['strong_emphasis', 0, 11],
      ['strong_emphasis', 2, 9],
    ],
  ],
  [
    '***foo***',
    [
      ['emphasis', 0, 9],
      ['strong_emphasis', 1, 8],
    ],
  ],
  [
    '*****foo*****',
    [
      ['emphasis', 0, 13],
      ['strong_emphasis', 1, 12],
      ['strong_emphasis', 3, 10],
    ],
  ],
  [
    'foo******bar*********baz',
    [
      ['strong_emphasis', 3, 18],
      ['strong_emphasis', 5, 16],
      ['strong_emphasis', 7, 14],
    ],
  ],
  ['_foo_bar_baz_', [['emphasis', 0, 13]]],
  ['Φ_2. Współczynnik λ_4', []],
  ['a&amp;_b_', [['emphasis', 6, 9]]],
  ['a&#38;_b_', [['emphasis', 6, 9]]],
  ['`a`_b_', [['emphasis', 3, 6]]],
  ['<b>_c_', [['emphasis', 3, 6]]],
  ['[a](b)_c_', [['emphasis', 6, 9]]],
  [
    '*a*_b_',
    [
      ['emphasis', 0, 3],
      ['emphasis', 3, 6],
    ],
  ],
  ['a\\*_b_', [['emphasis', 3, 6]]],
  ['!<b\n>_x_', [['emphasis', 5, 8]]],
  ['!`a\n`_x_', [['emphasis', 5, 8]]],
  ['*a\nb*', [['emphasis', 0, 5]]],
  ['😀 **λ_2**。', [['strong_emphasis', 3, 10]]],
  ['*a `*` c*', [['emphasis', 0, 9]]],
  [
    '*a [*b*](u) c*',
    [
      ['emphasis', 0, 14],
      ['emphasis', 4, 7],
    ],
  ],
  [
    '*a ![*b*](i) c*',
    [
      ['emphasis', 0, 15],
      ['emphasis', 5, 8],
    ],
  ],
  ['*a <b title="*"> c*', [['emphasis', 0, 19]]],
  ['**a<http://foo.bar/?q=**>', []],
];

function pointAt(source, index) {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1).length };
}

for (const [source, expected] of rangeCases) {
  test(`emphasis source intervals: ${JSON.stringify(source)}`, () => {
    const { parser, tree } = parse(source);
    try {
      assert.equal(tree.rootNode.hasError, false, source);
      const spans = tree.rootNode.descendantsOfType([
        'emphasis',
        'strong_emphasis',
      ]);
      assert.deepEqual(
        spans.map((node) => [node.type, node.startIndex, node.endIndex]),
        expected,
        tree.rootNode.toString(),
      );
      for (const node of spans) {
        assert.equal(node.text, source.slice(node.startIndex, node.endIndex));
        assert.deepEqual(node.startPosition, pointAt(source, node.startIndex));
        assert.deepEqual(node.endPosition, pointAt(source, node.endIndex));
      }
    } finally {
      tree.delete();
      parser.delete();
    }
  });
}

function snapshot(root) {
  const nodes = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    nodes.push([
      node.type,
      node.startIndex,
      node.endIndex,
      node.startPosition,
      node.endPosition,
    ]);
    stack.push(...node.children.toReversed());
  }
  return nodes;
}

function editBetween(source, next) {
  let startIndex = 0;
  while (
    startIndex < Math.min(source.length, next.length) &&
    source[startIndex] === next[startIndex]
  )
    startIndex++;
  let suffix = 0;
  while (
    suffix < Math.min(source.length, next.length) - startIndex &&
    source.at(-1 - suffix) === next.at(-1 - suffix)
  )
    suffix++;
  const oldEndIndex = source.length - suffix;
  const newEndIndex = next.length - suffix;
  return {
    startIndex,
    oldEndIndex,
    newEndIndex,
    startPosition: pointAt(source, startIndex),
    oldEndPosition: pointAt(source, oldEndIndex),
    newEndPosition: pointAt(next, newEndIndex),
  };
}

const byNumber = new Map(
  specification.examples.map((example) => [example.number, example]),
);
const byName = new Map(
  reference.cases.map((example) => [example.name, example]),
);

function cachedStates(sources) {
  // Walk forward, undo every edit, then redo them. The same parser and old
  // trees survive each step, so an EOF/absence result cannot stay cached after
  // a closer is added or becomes visible outside an opaque inline atom.
  return [
    ...sources,
    ...sources.toReversed().slice(1),
    ...sources.slice(1),
  ].map((source) => {
    const example = byName.get(`cache ${JSON.stringify(source)}`);
    assert.ok(example, `Missing independent cache reference: ${source}`);
    return example;
  });
}

for (const [name, cases] of [
  [
    'EOF cache invalidation after appending and removing closers',
    cachedStates(['*a', '*a*', '**a', '**a**']),
  ],
  [
    'root delimiter absence masks and restoration',
    cachedStates(['*a _b', '*a _b_', '*a _b_*']),
  ],
  [
    'exposing and restoring a closer inside code',
    cachedStates(['*a `b*` c', '*a b* c']),
  ],
  [
    'exposing and restoring a closer inside a link destination',
    cachedStates(['*a [b](path*) c', '*a [b] path*) c']),
  ],
  ['unsafe cached opener progression', cachedStates(['*a *b *c', '*a *b *c*'])],
  [
    'repeated dual-purpose runs',
    cachedStates([1, 2, 3, 8].map((count) => '**a****b'.repeat(count))),
  ],
  [
    'nesting and crossed delimiters',
    [420, 421, 478, 479, 480, 481, 476, 477].map((number) =>
      byNumber.get(number),
    ),
  ],
  [
    'atom-ending punctuation',
    [
      'a&amp;_b_',
      'a&#38;_b_',
      '`a`_b_',
      '<b>_c_',
      '[a](b)_c_',
      '*a*_b_',
      'a\\*_b_',
    ].map((source) => byName.get(`precedence ${JSON.stringify(source)}`)),
  ],
  [
    'run-length boundaries',
    [254, 255, 256, 257, 258, 255, 3].map((length) =>
      byName.get(`long symmetric * ${length}`),
    ),
  ],
  [
    'underscore run-length boundaries',
    [254, 255, 256, 257, 258, 255, 3].map((length) =>
      byName.get(`long symmetric _ ${length}`),
    ),
  ],
  [
    'Unicode flanks',
    [
      'Unicode left *1 U+1f600',
      'Unicode left _1 U+1f600',
      'Unicode left _1 U+ab',
      'Unicode inside opening _1 U+a0',
      'Unicode right _2 U+4e2d',
    ].map((name) => byName.get(name)),
  ],
]) {
  test(`incremental emphasis matches fresh trees and the reference through ${name}`, () => {
    const parser = new Parser();
    const freshParser = new Parser();
    parser.setLanguage(language);
    freshParser.setLanguage(language);
    let source = cases[0].markdown.replace(/\n$/, '');
    let tree = parser.parse(source);
    try {
      for (const example of cases) {
        const next = example.markdown.replace(/\n$/, '');
        tree.edit(editBetween(source, next));
        const previous = tree;
        tree = parser.parse(next, previous);
        previous.delete();
        const fresh = freshParser.parse(next);
        try {
          assert.equal(tree.rootNode.hasError, false, next);
          assert.deepEqual(
            snapshot(tree.rootNode),
            snapshot(fresh.rootNode),
            next,
          );
          assert.deepEqual(
            treeEmphasis(tree.rootNode, next),
            htmlEmphasis(example.html),
            next,
          );
        } finally {
          fresh.delete();
        }
        source = next;
      }
    } finally {
      tree.delete();
      parser.delete();
      freshParser.delete();
    }
  });
}
