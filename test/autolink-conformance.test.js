const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Language, Parser } = require('web-tree-sitter');
const specification = require('./fixtures/gfm-autolinks.json');
const interplay = require('./fixtures/autolink-interplay.json');

let language;
before(async () => {
  await Parser.init();
  language = await Language.load(
    path.resolve(__dirname, '..', 'tree-sitter-markdown_inline.wasm'),
  );
});

function links(tree) {
  return tree.rootNode
    .descendantsOfType(['bare_uri_autolink', 'bare_email_autolink'])
    .map((node) => ({
      kind: node.type === 'bare_uri_autolink' ? 'uri' : 'email',
      text: node.text,
    }));
}

function parse(source, callback) {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  try {
    assert.equal(
      tree.rootNode.hasError,
      false,
      `${source}\n${tree.rootNode.toString()}`,
    );
    callback(tree);
  } finally {
    tree.delete();
    parser.delete();
  }
}

for (const example of specification.examples) {
  test(`GFM extended autolink example ${example.number}`, () => {
    const actual = [];
    // Inline parsing receives paragraph ranges from the block parser, never
    // a synthetic paragraph spanning the specification's blank lines.
    for (const paragraph of example.markdown.trimEnd().split(/\n\n+/)) {
      parse(paragraph, (tree) => actual.push(...links(tree)));
    }
    assert.deepEqual(
      actual,
      example.links.map(({ kind, text }) => ({ kind, text })),
      example.html,
    );
  });
}

for (const example of interplay.examples) {
  test(`bare autolink and emphasis precedence: ${example.markdown}`, () => {
    parse(example.markdown, (tree) => {
      assert.deepEqual(links(tree), example.links, example.html);
      assert.deepEqual(
        tree.rootNode.descendantsOfType('emphasis').map((node) => node.text),
        example.emphasis,
        example.html,
      );
    });
  });
}

for (const prefix of ['', ' ', '\t', '\n', '*', '_', '~', '(']) {
  test(`bare URL left boundary ${JSON.stringify(prefix)}`, () => {
    const source = `${prefix}https://example.com/path`;
    parse(source, (tree) =>
      assert.deepEqual(links(tree), [
        { kind: 'uri', text: 'https://example.com/path' },
      ]),
    );
  });
}
for (const prefix of [
  'a',
  '3',
  'λ',
  ')',
  '[',
  ']',
  '!',
  '.',
  ':',
  '/',
  '-',
  '+',
]) {
  test(`bare URL rejects left boundary ${JSON.stringify(prefix)}`, () => {
    parse(`${prefix}https://example.com/path`, (tree) =>
      assert.deepEqual(links(tree), []),
    );
  });
}

for (const [source, expected] of [
  ['www.example.com/path?!.,:*_~', [['uri', 'www.example.com/path']]],
  ['https://example.com/a(b)', [['uri', 'https://example.com/a(b)']]],
  ['https://example.com/a(b)))', [['uri', 'https://example.com/a(b)']]],
  ['https://example.com/a)b(c)', [['uri', 'https://example.com/a)b(c']]],
  ['https://example.com/a)b(c)x', [['uri', 'https://example.com/a)b(c)x']]],
  ['www.example.com/a&letters;', [['uri', 'www.example.com/a']]],
  ['www.example.com/a&123;', [['uri', 'www.example.com/a']]],
  ['www.example.com/a&letters;.', [['uri', 'www.example.com/a']]],
  ['www.example.com/a&letters;x', [['uri', 'www.example.com/a&letters;x']]],
  ['www.example.com/a&letters', [['uri', 'www.example.com/a&letters']]],
  ['www.example.com/a&#123;', [['uri', 'www.example.com/a&#123;']]],
  ['www.example.com/a;literal;', [['uri', 'www.example.com/a;literal;']]],
  ['www.example.com/a<tail', [['uri', 'www.example.com/a']]],
  ['https://example.com/a\u00a0tail', [['uri', 'https://example.com/a']]],
  [
    'http://foo_bar.example.com/path',
    [['uri', 'http://foo_bar.example.com/path']],
  ],
  ['http://foo.bar_baz/path', []],
  ['http://foo_bar.example/path', []],
  ['www.foo_bar.example/path', []],
  ['http://localhost/path', []],
  ['ftp://example.com/path', []],
  ['_local@example.com', [['email', '_local@example.com']]],
  ['+local@example.com', [['email', '+local@example.com']]],
  ['.local@example.com', [['email', '.local@example.com']]],
  ['foo_bar_@example.com', [['email', 'foo_bar_@example.com']]],
  ['local@foo_bar.example', [['email', 'local@foo_bar.example']]],
  ['local@example.com.', [['email', 'local@example.com']]],
  ['local@example.com-', []],
  ['local@example.com_', []],
  ['local@example', []],
  ['local@mail+xyz.example', []],
  ['mailto:local@example.com/', [['email', 'mailto:local@example.com']]],
  [
    'xmpp:local@example.com/a@b.c/path',
    [['email', 'xmpp:local@example.com/a@b.c']],
  ],
]) {
  test(`bare autolink validation: ${JSON.stringify(source)}`, () => {
    parse(source, (tree) => {
      assert.deepEqual(
        links(tree),
        expected.map(([kind, text]) => ({ kind, text })),
      );
      for (const node of tree.rootNode.descendantsOfType([
        'bare_uri_autolink',
        'bare_email_autolink',
      ])) {
        assert.equal(source.slice(node.startIndex, node.endIndex), node.text);
      }
    });
  });
}

test('angle-delimited autolinks retain their existing node types', () => {
  parse('<https://example.com/path> <local@example.com>', (tree) => {
    assert.deepEqual(links(tree), []);
    assert.equal(tree.rootNode.descendantsOfType('uri_autolink').length, 1);
    assert.equal(tree.rootNode.descendantsOfType('email_autolink').length, 1);
  });
});

for (const source of [
  '`https://example.com/p*q`',
  '[label](https://example.com/p*q)',
  '![alt](https://example.com/p*q)',
  '<a href="https://example.com/p*q">',
  '<a title="local@example.com">',
]) {
  test(`existing inline atoms remain opaque to bare links: ${source}`, () => {
    parse(source, (tree) => assert.deepEqual(links(tree), []));
  });
}

test('explicit link text cannot acquire a nested bare autolink', () => {
  parse('[www.foo.com](/u)', (tree) => {
    assert.deepEqual(links(tree), []);
    assert.equal(tree.rootNode.descendantsOfType('inline_link').length, 1);
    assert.deepEqual(
      tree.rootNode.descendantsOfType('link_text').map((node) => node.text),
      ['www.foo.com'],
    );
  });
});

for (const [source, type, text, start] of [
  ['*https://example.com/p*', 'emphasis', 'https://example.com/p', 1],
  ['**https://example.com/p**', 'strong_emphasis', 'https://example.com/p', 2],
  ['*local@example.com*', 'emphasis', 'local@example.com', 1],
]) {
  test(`emphasis boundaries around a bare link: ${source}`, () => {
    parse(source, (tree) => {
      assert.equal(tree.rootNode.descendantsOfType(type).length, 1);
      const node = tree.rootNode.descendantsOfType([
        'bare_uri_autolink',
        'bare_email_autolink',
      ])[0];
      assert.ok(node, source);
      assert.equal(node.text, text);
      assert.equal(node.startIndex, start);
      assert.equal(node.endIndex, start + text.length);
    });
  });
}

test('bare URI/email content is opaque to emphasis', () => {
  parse('https://example.com/p*q_r*z local_a_b@example.com', (tree) => {
    assert.equal(links(tree).length, 2);
    assert.deepEqual(
      tree.rootNode.descendantsOfType(['emphasis', 'strong_emphasis']),
      [],
    );
  });
});

function pointAt(source, index) {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1).length };
}
function snapshot(node) {
  return [
    node.type,
    node.startIndex,
    node.endIndex,
    node.children.map(snapshot),
  ];
}

test('incremental bare autolinks match fresh parsing through trimming and invalid states', () => {
  const parser = new Parser();
  const freshParser = new Parser();
  parser.setLanguage(language);
  freshParser.setLanguage(language);
  const states = [
    ['www.example.com/a.', 'uri', 'www.example.com/a'],
    ['www.example.com/a(b))', 'uri', 'www.example.com/a(b)'],
    ['www.example.com/a&hl;', 'uri', 'www.example.com/a'],
    ['foo_bar@example.com.', 'email', 'foo_bar@example.com'],
    ['foo_bar@example.com-', null, null],
    ['mailto:foo_bar@example.com', 'email', 'mailto:foo_bar@example.com'],
    ['xmpp:foo@example.com/a@b.c/path', 'email', 'xmpp:foo@example.com/a@b.c'],
  ];
  let source = states[0][0];
  let tree = parser.parse(source);
  try {
    for (const [next, kind, text] of states) {
      tree.edit({
        startIndex: 0,
        oldEndIndex: source.length,
        newEndIndex: next.length,
        startPosition: { row: 0, column: 0 },
        oldEndPosition: pointAt(source, source.length),
        newEndPosition: pointAt(next, next.length),
      });
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
        assert.deepEqual(links(tree), kind ? [{ kind, text }] : [], next);
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
