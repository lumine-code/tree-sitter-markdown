const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '../..');
const binding =
  typeof process.versions.bun === 'string'
    ? require(
        `${root}/prebuilds/${process.platform}-${process.arch}/tree-sitter-markdown.node`,
      )
    : require('node-gyp-build')(root);

function loadMetadata(language, directory) {
  language.nodeTypeInfo = require(join(root, directory, 'src/node-types.json'));
  for (const [property, name] of [
    ['HIGHLIGHTS_QUERY', 'highlights'],
    ['INJECTIONS_QUERY', 'injections'],
    ['LOCALS_QUERY', 'locals'],
    ['TAGS_QUERY', 'tags'],
  ]) {
    Object.defineProperty(language, property, {
      configurable: true,
      enumerable: true,
      get() {
        let query;
        try {
          query = readFileSync(
            join(root, directory, 'queries', `${name}.scm`),
            'utf8',
          );
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        Object.defineProperty(language, property, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: query,
        });
        return query;
      },
    });
  }
}

loadMetadata(binding, 'tree-sitter-markdown');
loadMetadata(binding.inline, 'tree-sitter-markdown-inline');
module.exports = binding;
