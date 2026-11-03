const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { Language, Parser, Query } = require('web-tree-sitter');

const root = path.resolve(__dirname, '..');
const languages = {};

before(async () => {
  await Parser.init();
  languages.block = await Language.load(
    path.join(root, 'tree-sitter-markdown.wasm'),
  );
  languages.inline = await Language.load(
    path.join(root, 'tree-sitter-markdown_inline.wasm'),
  );
});

function parse(t, kind, source) {
  const parser = new Parser();
  parser.setLanguage(languages[kind]);
  const tree = parser.parse(source);
  t.after(() => {
    tree.delete();
    parser.delete();
  });
  assert.equal(tree.rootNode.hasError, false, tree.rootNode.toString());
  return tree;
}

const nodes = (tree, type) => tree.rootNode.descendantsOfType(type);
const texts = (tree, type) => nodes(tree, type).map((node) => node.text);

for (const source of [
  'Φ_2. Współczynnik λ_4',
  'Φ_2.\nWspółczynnik λ_4',
  'Współczynnik dynamiczny poprawiony do obliczenia zmęczenia. Teraz jest poprawne Φ_2. Współczynnik λ_4 przyjęty na korzyść bezpieczną, bez redukcji z uwagi na dwa tory.',
  'use ota_0 or ota_1',
  'abc_2 xyz_4',
  'foo_bar_',
  'foo_bar_baz',
  '5_6_78',
  '5__6__78',
  '_foo_2',
  'пристаням_стремятся_',
]) {
  test(`intraword underscores stay literal: ${source}`, (t) => {
    const tree = parse(t, 'inline', source);
    assert.deepEqual(texts(tree, 'emphasis'), []);
    assert.deepEqual(texts(tree, 'strong_emphasis'), []);
  });
}

for (const source of ['_2_', '_foobar1_', '_italic 1_', '_foo_bar_baz_']) {
  test(`numeric and internal text keeps its outer emphasis: ${source}`, (t) => {
    assert.deepEqual(texts(parse(t, 'inline', source), 'emphasis'), [source]);
  });
}

for (const source of ['__2__', '__foobar1__', "**What's missing:**"]) {
  test(`strong emphasis has its authored bounds: ${source}`, (t) => {
    assert.deepEqual(texts(parse(t, 'inline', source), 'strong_emphasis'), [
      source,
    ]);
  });
}

test('Unicode whitespace cannot open or close emphasis', (t) => {
  for (const source of [
    '_\u00a0word_',
    '_word\u00a0_',
    '*\u00a0word*',
    '*word\u00a0*',
  ]) {
    assert.deepEqual(texts(parse(t, 'inline', source), 'emphasis'), [], source);
  }
});

test('Unicode punctuation can flank underscore emphasis', (t) => {
  assert.deepEqual(texts(parse(t, 'inline', '«_word_»'), 'emphasis'), [
    '_word_',
  ]);
});

test('invalid delimiter runs stay whole instead of creating partial emphasis', (t) => {
  for (const source of ['a**"foo"**', 'a__"foo"__']) {
    const tree = parse(t, 'inline', source);
    assert.deepEqual(texts(tree, 'emphasis'), []);
    assert.deepEqual(texts(tree, 'strong_emphasis'), []);
  }
});

test('nested emphasis applies the rule of three', (t) => {
  const source = '*foo**bar**baz*';
  const tree = parse(t, 'inline', source);
  assert.deepEqual(texts(tree, 'emphasis'), [source]);
  assert.deepEqual(texts(tree, 'strong_emphasis'), ['**bar**']);
});

test('form feed stays text and cannot be part of a bare destination', (t) => {
  parse(t, 'inline', 'a\fb');
  assert.deepEqual(texts(parse(t, 'inline', '_word\f_'), 'emphasis'), []);
  assert.deepEqual(
    texts(parse(t, 'inline', '[a](foo\fbar)'), 'inline_link'),
    [],
  );
});

test('a whitespace-only explicit link preserves its text node', (t) => {
  const tree = parse(t, 'inline', '[ ](url)');
  assert.deepEqual(texts(tree, 'inline_link'), ['[ ](url)']);
  assert.deepEqual(texts(tree, 'link_text'), [' ']);
});

test('optional tags keep URL fragments literal in either dialect', (t) => {
  const tree = parse(
    t,
    'inline',
    'https://neovim.io#docs https://example.com/#/settings#privacy prefix#tag',
  );
  assert.deepEqual(texts(tree, 'tag'), []);
  const enabled = Array.from(
    { length: languages.inline.nodeTypeCount },
    (_, index) => languages.inline.nodeTypeForId(index),
  ).includes('tag');
  const positive = parse(t, 'inline', '#first a #second\n#third');
  assert.deepEqual(
    texts(positive, 'tag'),
    enabled ? ['#first', '#second', '#third'] : [],
  );
});

test('separate approximation prefixes do not become strikethrough', (t) => {
  const source =
    'The floor is raised (~14 vs ~7) and the ceiling lowered (~55 vs ~58).';
  assert.deepEqual(texts(parse(t, 'inline', source), 'strikethrough'), []);
  assert.deepEqual(
    texts(parse(t, 'inline', '~a ~b ~c ~d ~e'), 'strikethrough'),
    [],
  );
});

test('adjacent images all remain images', (t) => {
  const images = Array.from(
    { length: 16 },
    (_, i) => `![image ${i}](image-${i}.png)`,
  );
  const tree = parse(t, 'inline', images.join('\n'));
  assert.deepEqual(texts(tree, 'image'), images);
  assert.deepEqual(texts(tree, 'inline_link'), []);
});

test('a dollar sign in a link cannot consume its destination as math', (t) => {
  const source =
    '[$NVIM_APPNAME](https://neovim.io/doc/user/starting.html#$NVIM_APPNAME)';
  const tree = parse(t, 'inline', source);
  assert.deepEqual(texts(tree, 'inline_link'), [source]);
  assert.deepEqual(texts(tree, 'latex_block'), []);
});

test('angle brackets delimit a destination without belonging to its range', (t) => {
  const tree = parse(
    t,
    'inline',
    '[label](<target with space> "title") ![alt](<image.png>)',
  );
  assert.deepEqual(texts(tree, 'link_destination'), [
    'target with space',
    'image.png',
  ]);
  assert.deepEqual(texts(tree, 'link_title'), ['"title"']);
  const empty = parse(t, 'inline', '[label](<>)');
  assert.equal(nodes(empty, 'inline_link').length, 1);
  assert.deepEqual(texts(empty, 'link_destination'), []);
  assert.deepEqual(
    texts(
      parse(t, 'block', '[label]: <target with space>\n'),
      'link_destination',
    ),
    ['target with space'],
  );
});

test('empty table cells do not split or corrupt a table', (t) => {
  const source = '| | A1 | |\n|--|----|--|\n|||x|\n| | | |\n';
  const tree = parse(t, 'block', source);
  assert.equal(nodes(tree, 'pipe_table').length, 1);
  assert.equal(nodes(tree, 'pipe_table_header').length, 1);
  assert.equal(nodes(tree, 'pipe_table_row').length, 2);
});

test('table delimiter cells require a hyphen', (t) => {
  const tree = parse(t, 'block', '| a | b |\n| | |\n| c | d |\n');
  assert.deepEqual(texts(tree, 'pipe_table'), []);
});

test('only an ordered list starting at one interrupts a paragraph', (t) => {
  for (const number of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14]) {
    const source = `prose\n${number}. continuation\n`;
    const tree = parse(t, 'block', source);
    assert.deepEqual(texts(tree, 'list'), [], source);
    assert.equal(nodes(tree, 'paragraph').length, 1, source);
  }
  assert.equal(nodes(parse(t, 'block', 'prose\n1. item\n'), 'list').length, 1);
});

test('blocks close at end of file without requiring a final newline', (t) => {
  for (const [source, type] of [
    ['```', 'fenced_code_block'],
    ['- ', 'list_item'],
    ['# Top', 'atx_heading'],
  ]) {
    assert.equal(nodes(parse(t, 'block', source), type).length, 1, source);
  }
});

test('checked task markers do not shadow link reference definitions', (t) => {
  for (const label of ['x', 'X', 'a']) {
    const tree = parse(t, 'block', `[${label}]: /url\n\n[${label}]\n`);
    assert.deepEqual(texts(tree, 'link_label'), [`[${label}]`]);
    assert.deepEqual(texts(tree, 'link_destination'), ['/url']);
    assert.equal(nodes(tree, 'link_reference_definition').length, 1);
  }
  assert.equal(
    nodes(parse(t, 'block', '- [x] checked\n'), 'task_list_marker_checked')
      .length,
    1,
  );
});

test('HTML declarations release the following Markdown', (t) => {
  const tree = parse(t, 'block', '<!DOCTYPE html>\n\n# Heading\n');
  assert.deepEqual(
    texts(tree, 'atx_heading').map((text) => text.trim()),
    ['# Heading'],
  );
});

test('display math is opaque to Markdown block syntax', (t) => {
  const tree = parse(t, 'block', '$$\na\n=\nb\n**formula**\n$$\n\n# Heading\n');
  assert.equal(nodes(tree, 'latex_block').length, 1);
  assert.deepEqual(texts(tree, 'latex_block_content'), [
    'a\n=\nb\n**formula**\n',
  ]);
  assert.deepEqual(texts(tree, 'setext_heading'), []);
  assert.deepEqual(
    texts(tree, 'atx_heading').map((text) => text.trim()),
    ['# Heading'],
  );
});

test('WASM handles HTML without missing C library imports', (t) => {
  assert.equal(
    nodes(parse(t, 'block', '<h1>foo</h1>\n'), 'html_block').length,
    1,
  );
});

test('both default query sets compile against their shipped languages', () => {
  for (const [kind, dir] of [
    ['block', 'tree-sitter-markdown'],
    ['inline', 'tree-sitter-markdown-inline'],
  ]) {
    for (const file of fs.readdirSync(path.join(root, dir, 'queries'))) {
      if (!file.endsWith('.scm')) continue;
      const query = new Query(
        languages[kind],
        fs.readFileSync(path.join(root, dir, 'queries', file), 'utf8'),
      );
      query.delete();
    }
  }
});

function pointAt(text, index) {
  const lines = text.slice(0, index).split('\n');
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

for (const [kind, initial, edits] of [
  [
    'inline',
    'Φ_2. Współczynnik λ_4',
    [
      ['Φ_2', '_2_'],
      ['λ_4', '__λ4__'],
      ['_2_', 'Φ_2'],
    ],
  ],
  [
    'inline',
    '**bold:** and ~a ~b ~c',
    [
      ['bold:', 'word1'],
      ['~a ~b ~c', '~~strike~~'],
      ['word1', 'bold:'],
    ],
  ],
  [
    'block',
    '| a | b |\n|---|---|\n| x | y |\n',
    [
      [' x ', ''],
      [' y ', ''],
      ['||', '| x |'],
    ],
  ],
  [
    'block',
    'prose\n2. continuation\n',
    [
      ['2.', '1.'],
      ['1.', '2.'],
      ['\n', '\n\n'],
    ],
  ],
]) {
  test(`incremental ${kind} parsing matches fresh parsing through edits: ${initial}`, (t) => {
    const parser = new Parser();
    const freshParser = new Parser();
    parser.setLanguage(languages[kind]);
    freshParser.setLanguage(languages[kind]);
    let source = initial;
    let tree = parser.parse(source);
    t.after(() => {
      tree.delete();
      parser.delete();
      freshParser.delete();
    });
    for (const [search, replacement] of edits) {
      const startIndex = source.indexOf(search);
      assert.notEqual(startIndex, -1, search);
      const oldEndIndex = startIndex + search.length;
      const next =
        source.slice(0, startIndex) + replacement + source.slice(oldEndIndex);
      const newEndIndex = startIndex + replacement.length;
      tree.edit({
        startIndex,
        oldEndIndex,
        newEndIndex,
        startPosition: pointAt(source, startIndex),
        oldEndPosition: pointAt(source, oldEndIndex),
        newEndPosition: pointAt(next, newEndIndex),
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
      } finally {
        fresh.delete();
      }
      source = next;
    }
  });
}
