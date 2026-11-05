const assert = require('node:assert/strict');
const { test } = require('node:test');
const Parser = require('tree-sitter');
const markdown = require('./index.js');

for (const [name, language, source, node] of [
  ['block', markdown, '# Heading\n', 'atx_heading'],
  ['inline', markdown.inline, '*emphasis*', 'emphasis'],
]) {
  test(`loads and parses the ${name} grammar`, () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);
    assert.equal(tree.rootNode.hasError, false);
    assert.ok(tree.rootNode.descendantsOfType(node).length > 0);
    assert.ok(Array.isArray(language.nodeTypeInfo));
    assert.ok(language.nodeTypeInfo.length > 0);
    assert.match(language.HIGHLIGHTS_QUERY, /@/);
    assert.match(language.INJECTIONS_QUERY, /injection/);
    assert.equal(language.LOCALS_QUERY, undefined);
    assert.equal(language.TAGS_QUERY, undefined);
  });
}

test('supports CommonJS inline entry and ESM default import', async () => {
  assert.equal(require('./inline.js'), markdown.inline);
  const imported = await import('./index.js');
  assert.equal(imported.default, markdown);
});

test('supports independent parser instances', () => {
  const first = new Parser().setLanguage(markdown.inline);
  const second = new Parser().setLanguage(markdown.inline);
  assert.equal(first.parse('*one*').rootNode.firstNamedChild.type, 'emphasis');
  assert.equal(
    second.parse('**two**').rootNode.firstNamedChild.type,
    'strong_emphasis',
  );
});

test('invalidates pending delimiter plans after edits to either run', () => {
  const parser = new Parser().setLanguage(markdown.inline);
  const pointAt = (source, index) => {
    const lines = source.slice(0, index).split('\n');
    return { row: lines.length - 1, column: lines.at(-1).length };
  };
  const snapshot = (tree) => {
    const nodes = [];
    const pending = [tree.rootNode];
    while (pending.length) {
      const node = pending.pop();
      const { row: startRow, column: startColumn } = node.startPosition;
      const { row: endRow, column: endColumn } = node.endPosition;
      nodes.push([
        node.type,
        node.startIndex,
        node.endIndex,
        startRow,
        startColumn,
        endRow,
        endColumn,
        node.childCount,
      ]);
      pending.push(...node.children.reverse());
    }
    return nodes;
  };

  for (const delimiter of ['*', '_']) {
    for (const length of [16, 31, 254, 1024]) {
      for (const both of [false, true]) {
        const prefix = both ? 'prefix\n(' : 'prefix\n';
        const body = both ? '!alpha!' : 'alpha';
        const run = delimiter.repeat(length);
        const before =
          prefix + run + body + run + (both ? ')\nsuffix' : '\nsuffix');
        const opener = prefix.length + Math.floor(length / 2);
        const closer =
          prefix.length + length + body.length + Math.floor(length / 2);
        for (const [name, start, removed, inserted] of [
          ['extend opener', opener, 0, delimiter],
          ['shorten opener', opener, 1, ''],
          ['split opener', opener, 1, 'x'],
          ['extend closer', closer, 0, delimiter],
          ['shorten closer', closer, 1, ''],
          ['escape closer', closer, 0, '\\'],
        ]) {
          const context = `${delimiter}/${length}/both=${both}/${name}`;
          const oldTree = parser.parse(before);
          assert.equal(oldTree.rootNode.hasError, false, context);
          const after =
            before.slice(0, start) + inserted + before.slice(start + removed);
          oldTree.edit({
            startIndex: start,
            oldEndIndex: start + removed,
            newEndIndex: start + inserted.length,
            startPosition: pointAt(before, start),
            oldEndPosition: pointAt(before, start + removed),
            newEndPosition: pointAt(after, start + inserted.length),
          });
          const incremental = parser.parse(after, oldTree);
          const fresh = parser.parse(after);
          assert.equal(fresh.rootNode.hasError, false, context);
          assert.equal(incremental.rootNode.hasError, false, context);
          assert.deepEqual(snapshot(incremental), snapshot(fresh), context);
        }
      }
    }
  }
});
