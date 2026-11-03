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
