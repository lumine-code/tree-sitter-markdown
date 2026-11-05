const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Language, Parser } = require('web-tree-sitter');

let language;
before(async () => {
  await Parser.init();
  language = await Language.load(
    process.env.MARKDOWN_INLINE_WASM ??
      path.resolve(__dirname, '..', 'tree-sitter-markdown_inline.wasm'),
  );
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

const contexts = [
  ['*', 'p ', ' q', 0],
  ['_', 'p ', ' q', 0],
  ['*', 'a', 'b', 0],
  ['*', '_', '_', 1],
  ['_', '*', '*', 1],
];

for (const count of [5, 6, 31, 32, 127, 254, 1024]) {
  for (const [marker, prefix, suffix, outerEmphasis] of contexts) {
    test(`opening groups remain valid through distant edits: ${prefix}${marker.repeat(1)} x${count} ${suffix}`, (t) => {
      const parser = new Parser().setLanguage(language);
      const freshParser = new Parser().setLanguage(language);
      const run = marker.repeat(count);
      let source = `${prefix}${run}x${run}${suffix}`;
      let tree = parser.parse(source);
      t.after(() => {
        tree.delete();
        parser.delete();
        freshParser.delete();
      });
      assert.equal(tree.rootNode.hasError, false);
      assert.equal(
        tree.rootNode.descendantsOfType('strong_emphasis').length,
        Math.floor(count / 2),
      );
      assert.equal(
        tree.rootNode.descendantsOfType('emphasis').length,
        (count % 2) + outerEmphasis,
      );

      function replace(startIndex, oldLength, text) {
        const oldEndIndex = startIndex + oldLength;
        const next =
          source.slice(0, startIndex) + text + source.slice(oldEndIndex);
        const newEndIndex = startIndex + text.length;
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
        source = next;
        const fresh = freshParser.parse(source);
        try {
          assert.equal(tree.rootNode.hasError, false, source);
          assert.deepEqual(snapshot(tree.rootNode), snapshot(fresh.rootNode));
        } finally {
          fresh.delete();
        }
      }

      // A later closer changes both pairing eligibility and the original
      // modulo-three class, including BOTH-flanking runs between letters.
      const closeStart = source.indexOf(marker, source.indexOf('x') + 1);
      replace(closeStart, 1, '');
      replace(closeStart, 0, marker);
      replace(closeStart, 0, '\\');
      replace(closeStart, 1, '');

      // Edits within the physical opener must invalidate its original plan.
      const openMiddle = prefix.length + Math.floor(count / 2);
      replace(openMiddle, 0, marker);
      replace(openMiddle, 1, '');

      // Reused nested groups also retain source ranges across Unicode text
      // and a closing flank changing from a letter to whitespace.
      replace(source.indexOf('x') + 1, 0, '\nΩ😀');
      const afterBody = source.indexOf('x') + 1 + '\nΩ😀'.length;
      replace(afterBody, 0, ' ');
      replace(afterBody, 1, '');
    });
  }
}
