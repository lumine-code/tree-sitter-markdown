const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'prebuilds/**',
      'target/**',
      '**/src/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/grammar.js', 'common/common.js'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^(?:_|\\$)' }],
      // These expressions are consumed by the Tree-sitter Rust regex generator.
      'no-useless-escape': 'off',
    },
    languageOptions: {
      globals: Object.fromEntries(
        [
          'grammar',
          'seq',
          'choice',
          'repeat',
          'repeat1',
          'optional',
          'prec',
          'alias',
          'token',
          'field',
          'blank',
          'reserved',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
  prettier,
];
