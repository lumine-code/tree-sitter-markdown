const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Language, Parser } = require('web-tree-sitter');

let language;
let referenceLanguage;
before(async () => {
  await Parser.init();
  language = await Language.load(
    process.env.MARKDOWN_INLINE_WASM ??
      path.resolve(__dirname, '..', 'tree-sitter-markdown_inline.wasm'),
  );
  referenceLanguage = process.env.MARKDOWN_REFERENCE_WASM
    ? await Language.load(process.env.MARKDOWN_REFERENCE_WASM)
    : language;
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

for (const marker of ['*', '_']) {
  for (const count of [16, 31]) {
    test(`partial delimiter runs survive every edit position and included-range gaps: ${marker} ${count}`, (t) => {
      const parser = new Parser().setLanguage(language);
      const freshParser = new Parser().setLanguage(referenceLanguage);
      const run = marker.repeat(count);
      const prefix = `outside\n> ${marker === '*' ? 'a' : 'p '}`;
      const suffix = `${marker === '*' ? 'b' : ' q'}\noutside`;
      let source = `${prefix}${run}x\n> y${run}${suffix}`;
      function ranges() {
        const gap = /\n>+ /.exec(source.slice(prefix.length));
        assert.ok(gap);
        const gapStart = prefix.length + gap.index;
        const end = source.length - '\noutside'.length;
        return [
          [prefix.length, gapStart + 1],
          [gapStart + gap[0].length, end],
        ].map(([startIndex, endIndex]) => ({
          startIndex,
          endIndex,
          startPosition: pointAt(source, startIndex),
          endPosition: pointAt(source, endIndex),
        }));
      }
      let tree = parser.parse(source, null, { includedRanges: ranges() });
      t.after(() => {
        tree.delete();
        parser.delete();
        freshParser.delete();
      });
      function compare() {
        const fresh = freshParser.parse(source, null, {
          includedRanges: ranges(),
        });
        try {
          assert.equal(tree.rootNode.hasError, false, source);
          assert.deepEqual(snapshot(tree.rootNode), snapshot(fresh.rootNode));
        } finally {
          fresh.delete();
        }
      }
      function edit(startIndex, oldLength, text) {
        const oldEndIndex = startIndex + oldLength;
        const next =
          source.slice(0, startIndex) + text + source.slice(oldEndIndex);
        tree.edit({
          startIndex,
          oldEndIndex,
          newEndIndex: startIndex + text.length,
          startPosition: pointAt(source, startIndex),
          oldEndPosition: pointAt(source, oldEndIndex),
          newEndPosition: pointAt(next, startIndex + text.length),
        });
        source = next;
        const previous = tree;
        tree = parser.parse(source, previous, { includedRanges: ranges() });
        previous.delete();
        compare();
      }
      compare();
      const starts = [
        prefix.length,
        source.indexOf(marker, source.indexOf('y') + 1),
      ];
      for (const start of starts) {
        for (let offset = 0; offset <= count; offset++) {
          const position = start + offset;
          edit(position, 0, marker);
          edit(position, 1, '');
          if (offset === count) continue;
          edit(position, 1, '');
          edit(position, 0, marker);
          edit(position, 0, '\\');
          edit(position, 1, '');
          edit(position, 1, marker === '*' ? '_' : '*');
          edit(position, 1, marker);
        }
      }
      const gapStart = source.indexOf('\n> ', prefix.length);
      edit(gapStart + 2, 0, '>');
      edit(gapStart + 2, 1, '');
      edit(source.indexOf('x') + 1, 0, 'Ω😀');
    });
  }
}
