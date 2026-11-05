const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Language, Parser } = require('web-tree-sitter');
const reference = require('./fixtures/strikethrough-reference.json');
const entities = require('../common/html_entities.json');

let language;
before(async () => {
  await Parser.init();
  language = await Language.load(
    process.env.MARKDOWN_INLINE_WASM ??
      path.resolve(__dirname, '..', 'tree-sitter-markdown_inline.wasm'),
  );
});

function append(target, value) {
  if (typeof value === 'string') {
    if (!value) return;
    if (typeof target.at(-1) === 'string') target[target.length - 1] += value;
    else target.push(value);
  } else target.push(value);
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

// This projection retains delimiter nesting and opaque code/link/image atoms.
// Expectations come from the independent pinned GitHub reference executable.
function htmlProjection(html) {
  html = html.replace(/^<p>/, '').replace(/<\/p>\n$/, '');
  const root = [];
  const stack = [{ tag: null, items: root }];
  let position = 0;
  for (const match of html.matchAll(/<(?:(?:"[^"]*"|'[^']*')|[^'">])*>/g)) {
    append(
      stack.at(-1).items,
      decodeEntities(html.slice(position, match.index)),
    );
    const tag = match[0].match(
      /^<(\/)?(em|strong|del|code|a|img|br)(?:\s|\/?>)/,
    );
    if (tag) {
      if (tag[1]) {
        assert.equal(stack.at(-1).tag, tag[2], html);
        stack.pop();
      } else {
        const node = [tag[2], []];
        append(stack.at(-1).items, node);
        if (tag[2] !== 'img' && tag[2] !== 'br')
          stack.push({ tag: tag[2], items: node[1] });
      }
    }
    position = match.index + match[0].length;
  }
  append(stack.at(-1).items, decodeEntities(html.slice(position)));
  assert.equal(stack.length, 1, html);
  return root;
}

const semanticTags = {
  emphasis: 'em',
  strong_emphasis: 'strong',
  strikethrough: 'del',
};

function treeProjection(node, source) {
  if (node.type === 'backslash_escape') return [node.text.slice(1)];
  if (['entity_reference', 'numeric_character_reference'].includes(node.type))
    return [decodeEntities(node.text)];
  if (node.type === 'html_tag') return [];
  if (node.type === 'image') return [['img', []]];
  if (node.type === 'uri_autolink' || node.type === 'email_autolink')
    return [['a', [node.text.slice(1, -1)]]];
  if (node.type === 'bare_uri_autolink' || node.type === 'bare_email_autolink')
    return [['a', [node.text]]];
  if (node.type === 'inline_link')
    return [
      [
        'a',
        treeProjection(
          node.namedChildren.find((child) => child.type === 'link_text'),
          source,
        ),
      ],
    ];
  if (node.type === 'code_span') {
    const delimiter = node.text.match(/^`+/)[0];
    let text = node.text
      .slice(delimiter.length, -delimiter.length)
      .replace(/\r\n?|\n/g, ' ');
    if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text))
      text = text.slice(1, -1);
    return [['code', [text]]];
  }
  const width =
    node.type === 'emphasis'
      ? 1
      : node.type === 'strong_emphasis'
        ? 2
        : node.type === 'strikethrough'
          ? node.text.startsWith('~~')
            ? 2
            : 1
          : 0;
  const result = [];
  const endIndex = node.endIndex - width;
  let position = node.startIndex + width;
  for (const child of node.namedChildren) {
    if (child.endIndex <= position || child.startIndex >= endIndex) continue;
    append(result, source.slice(position, child.startIndex));
    for (const item of treeProjection(child, source)) append(result, item);
    position = child.endIndex;
  }
  append(result, source.slice(position, endIndex));
  return semanticTags[node.type] ? [[semanticTags[node.type], result]] : result;
}

function pointAt(source, index) {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1).length };
}

function check(tree, example) {
  const source = example.markdown;
  assert.equal(
    tree.rootNode.hasError,
    false,
    `${source}\n${tree.rootNode.toString()}`,
  );
  assert.deepEqual(
    treeProjection(tree.rootNode, source),
    htmlProjection(example.html),
    `${source}\n${example.html}\n${tree.rootNode.toString()}`,
  );
  if (example.requiredAtom)
    assert.ok(
      tree.rootNode.descendantsOfType(example.requiredAtom).length > 0,
      `Expected opaque ${example.requiredAtom}: ${source}`,
    );
  for (const node of tree.rootNode.descendantsOfType(
    Object.keys(semanticTags),
  )) {
    assert.equal(node.text, source.slice(node.startIndex, node.endIndex));
    assert.deepEqual(node.startPosition, pointAt(source, node.startIndex));
    assert.deepEqual(node.endPosition, pointAt(source, node.endIndex));
    if (node.type === 'strikethrough') {
      const opening = node.text.match(/^~+/)[0];
      const closing = node.text.match(/~+$/)[0];
      assert.ok(opening.length === 1 || opening.length === 2, source);
      assert.equal(opening, closing, source);
    }
  }
}

for (const example of reference.examples) {
  test(`GitHub strikethrough reference: ${example.name}`, () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(example.markdown);
    try {
      check(tree, example);
    } finally {
      tree.delete();
      parser.delete();
    }
  });
}

function snapshot(node) {
  return [
    node.type,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map(snapshot),
  ];
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

const byName = new Map(
  reference.examples.map((example) => [example.name, example]),
);
for (const sequence of reference.sequences) {
  test(`incremental strikethrough, undo and redo: ${sequence.name}`, () => {
    const parser = new Parser();
    const freshParser = new Parser();
    parser.setLanguage(language);
    freshParser.setLanguage(language);
    const cases = [
      ...sequence.cases,
      ...sequence.cases.toReversed().slice(1),
      ...sequence.cases.slice(1),
    ].map((name) => byName.get(name));
    let source = cases[0].markdown;
    let tree = parser.parse(source);
    try {
      for (const example of cases) {
        const next = example.markdown;
        tree.edit(editBetween(source, next));
        const previous = tree;
        tree = parser.parse(next, previous);
        previous.delete();
        const fresh = freshParser.parse(next);
        try {
          check(tree, example);
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
    } finally {
      tree.delete();
      parser.delete();
      freshParser.delete();
    }
  });
}
