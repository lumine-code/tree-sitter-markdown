const { join } = require('node:path');
const { root, grammars, treeSitter } = require('./run');

for (const [index, grammar] of grammars.entries()) {
  const name = index === 0 ? 'markdown' : 'markdown_inline';
  treeSitter(
    ['build', '--wasm', '--output', join(root, `tree-sitter-${name}.wasm`)],
    {
      cwd: join(root, grammar),
    },
  );
}
