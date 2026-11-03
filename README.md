# tree-sitter-markdown

Parse Markdown with block and inline Tree-sitter grammars.

Fork of [tree-sitter-grammars/tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown).

## Features

- **Grammars**: provides separate block and inline Tree-sitter grammars.
- **Markdown**: recognizes CommonMark syntax and common GitHub Flavored Markdown extensions.
- **Editor queries**: includes syntax highlighting and language injection queries for both grammars.
- **Bindings**: supplies native Node.js, Rust, Python, C and Swift interfaces.
- **WebAssembly**: builds both grammars for web-tree-sitter with the pinned Tree-sitter CLI.

This parser is intended for syntax highlighting and editor tooling. Its incremental trees approximate some Markdown rules, including reference-link matching; it does not claim complete CommonMark or GitHub renderer equivalence. The corpus retains explicitly skipped cases documenting known limitations.

## Installation

Node.js 24 or newer and a native C/C++ build toolchain are required when no matching prebuild is available.

Install from an immutable Git commit. Replace `COMMIT` with the full reviewed commit SHA:

```sh
npm install github:lumine-code/tree-sitter-markdown#COMMIT tree-sitter
```

## Usage

```js
const Parser = require("tree-sitter");
const Markdown = require("@lumine-code/tree-sitter-markdown");

const blocks = new Parser().setLanguage(Markdown);
const blockTree = blocks.parse("# Heading\n\nSome *emphasis*.\n");

const inline = new Parser().setLanguage(Markdown.inline);
const inlineTree = inline.parse("Some *emphasis*.");
```

Both language objects expose `nodeTypeInfo`, `HIGHLIGHTS_QUERY` and `INJECTIONS_QUERY`. Optional query properties are `undefined` when that grammar does not ship the corresponding query. CommonJS `require()` and ESM default imports are supported; the inline entry is also available at `@lumine-code/tree-sitter-markdown/bindings/node/inline.js`.

For a complete document, parse blocks first, then parse each `inline` node or `pipe_table_cell` using its source ranges. Exclude the children of inline nodes from those ranges because block continuation markers belong to the block grammar. The Rust `MarkdownParser`, enabled by the `parser` feature, provides this orchestration and incremental tree updates.

The Python `core` extra selects Tree-sitter `>=0.25.2,<0.26`. Python runtime 0.26.0 has a reproducible native traversal crash with larger documents, so this binding rejects that specific runtime before loading it. Runtime 0.25.2 passes the large-document regression; this compatibility guard does not claim to repair the external runtime.

## Building and testing

```sh
npm ci
npm run build
npm run build:native
npm run build:wasm
npm test
npm run lint
npm pack --dry-run
```

`npm run build` regenerates both grammars with the exact Tree-sitter CLI version declared in `package.json`. `npm run build:wasm` writes `tree-sitter-markdown.wasm` and `tree-sitter-markdown_inline.wasm` at the repository root. The CLI provisions its pinned WASI SDK and Binaryen on demand; existing installations can be selected with `TREE_SITTER_WASI_SDK_PATH` and `TREE_SITTER_BINARYEN_PATH`. Modern web-tree-sitter can load these modules directly, without statically linking this grammar into its runtime.

`npm test` runs native binding tests, both corpus suites and WebAssembly regressions. CI exercises Node.js 24 on Linux, macOS and Windows, checks generated files, and tests the optional extensions in a separate build. Use `npm run check:generated` after committing generated output to verify that regeneration leaves the source tree unchanged.

The [upstream audit](docs/upstream-audit.md) records all reviewed issues and pull requests, implemented fixes and remaining limitations. Release workflows attach the source package and WASM grammars to GitHub releases after CI; they do not publish to a package registry.

## Extensions

Extensions are selected when `grammar.js` is evaluated during generation. Setting an environment variable after installing a pre-generated grammar does not change its syntax. Rust Cargo features do not regenerate the grammar; consumers who need a different dialect must regenerate the source with Node.js and the pinned Tree-sitter CLI before building their bindings.

Set a variable to a nonempty value to enable its extension. `NO_DEFAULT_EXTENSIONS` disables the default set. `npm run build:all` enables every extension without shell-specific environment syntax.

| Extension                       | Environment variable       | Default |
| ------------------------------- | -------------------------- | ------- |
| GitHub Flavored Markdown bundle | `EXTENSION_GFM`            | yes     |
| Task lists                      | `EXTENSION_TASK_LIST`      | yes     |
| Strikethrough                   | `EXTENSION_STRIKETHROUGH`  | yes     |
| Pipe tables                     | `EXTENSION_PIPE_TABLE`     | yes     |
| YAML metadata                   | `EXTENSION_MINUS_METADATA` | yes     |
| TOML metadata                   | `EXTENSION_PLUS_METADATA`  | yes     |
| LaTeX math                      | `EXTENSION_LATEX`          | yes     |
| Tags                            | `EXTENSION_TAGS`           | no      |
| Wiki links                      | `EXTENSION_WIKI_LINK`      | no      |

The GFM bundle enables task lists, strikethrough and pipe tables. Metadata, math, tags and wiki links are dialect extensions rather than a promise of GitHub rendering behavior.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
