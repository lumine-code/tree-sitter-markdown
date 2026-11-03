# Contributing

Report reproducible examples at https://github.com/lumine-code/tree-sitter-markdown/issues. Link the relevant CommonMark or GFM specification rule where possible, and include the expected syntax tree or rendering.

## Source layout

`tree-sitter-markdown/grammar.js` defines block structure; `tree-sitter-markdown-inline/grammar.js` defines inline structure. Shared rules live in `common/common.js`. Each grammar has an external scanner in `src/scanner.c` for context that the grammar DSL cannot express. Other files in `src/` are generated, except explicitly documented scanner helpers.

Add regression cases to the appropriate `test/corpus/` directory. Full-document integration, WebAssembly, query and incremental-parsing regressions live in the root `test/` directory. Preserve the specification-derived examples and their source links.

## Validation

```sh
npm ci
npm run build
npm run build:native
npm run build:wasm
npm test
npm run lint
npm pack --dry-run
```

After changing a grammar or a shared rule, regenerate both parsers and commit their generated output. Check generation after committing with `npm run check:generated`. Run `npm run build:all` and the corpus suites to validate optional extensions, then restore the default generated dialect with `npm run build` before committing.

Generation-time extension flags are documented in README.md. The flags change the grammar before C code is generated; they are not C preprocessor flags or runtime parser options.
