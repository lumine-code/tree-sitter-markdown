# Upstream audit

Audit date: 2026-11-03. Baseline: [tree-sitter-grammars/tree-sitter-markdown v0.5.4, revision 41ff24a6c775492c543b09228aeb98d1cd2b3a0f](https://github.com/tree-sitter-grammars/tree-sitter-markdown/tree/41ff24a6c775492c543b09228aeb98d1cd2b3a0f). The inventory contains all 65 open issues and 9 open pull requests captured on that date. Dispositions describe this fork's work; they do not imply that upstream accepted a change or closed a report.

This is an editor parser audit, not a claim of complete CommonMark or GitHub renderer equivalence. Block and inline parsing remain separate, reference-link resolution is approximate, and the inherited inline corpus contains explicitly skipped specification cases. A passing active suite does not establish that skipped cases pass. Optional dialect features are distinguished from GFM behavior.

## Block parsing fixes

| Issue | Disposition in this fork |
| --- | --- |
| [#286](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/286) | Isolated display-math blocks keep `=` and other Markdown syntax inside opaque math content. |
| [#225](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/225) | Display-math content is not parsed as Markdown blocks. |
| [#280](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/280) | Data and delimiter cell ranges consistently exclude surrounding whitespace. |
| [#241](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/241) | Table cell ranges expose trimmed content consistently. |
| [#112](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/112) | Adjacent pipes retain named empty cells without corrupting the row. |
| [#230](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/230) | Zero-content and whitespace-only table cells are accepted. |
| [#242](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/242) | Empty and ragged data rows remain in the table; delimiter cells require hyphens. |
| [#269](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/269) | Checked task markers no longer shadow `[x]` and `[X]` reference definitions. |
| [#267](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/267) | ATX content excludes a valid optional closing hash sequence. |
| [#263](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/263) | Final fences, list markers and headings close without a trailing newline. |
| [#232](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/232) | A final single-line heading does not require a trailing newline. |
| [#257](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/257) | Only ordered lists starting at `1` can interrupt a paragraph. |
| [#248](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/248) | A following block continuation is outside the preceding ATX heading. |
| [#233](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/233) | HTML declarations terminate without swallowing following Markdown. |
| [#127](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/127) | Extra nested-list indentation belongs to the continuation prefix, not the visible list marker. |
| [#93](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/93) | HTML scanning uses ASCII character checks; a WASM regression covers HTML at document start. |

## Inline parsing fixes

The inline changes below have targeted native and WebAssembly regressions, including exact source ranges and comparisons of incremental parses with fresh parses.

| Issue | Disposition in this fork |
| --- | --- |
| [#276](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/276) | Intraword underscores next to digits remain literal, including `Φ_2` and `λ_4`. |
| [#151](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/151) | Numeric tokens no longer consume closing underscore emphasis delimiters. |
| [#186](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/186) | Consecutive images remain images instead of becoming links. |
| [#209](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/209) | Separate bold spans ending in punctuation keep their authored bounds. |
| [#206](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/206) | A dollar sign in a link does not consume the destination as math. |
| [#236](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/236) | Approximation prefixes do not create spurious strikethrough spans. |
| [#224](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/224) | Optional tags reject URL fragments; tags remain disabled by default. |
| [#174](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/174) | Angle brackets delimit a link destination without belonging to its content range. |
| [#9](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/9) | Whitespace-only shortcut brackets are plain text; valid explicit links such as `[ ](url)` retain their text node. |
| [#10](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/10) | Angle-delimited image destinations take precedence over HTML. |
| [#11](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/11) | Quoted HTML attributes can contain tag-like text without splitting the tag. |
| [#7](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/7) | Code spans take precedence over autolinks in the reported case. |

## Bindings, builds and documentation

| Issue | Disposition in this fork |
| --- | --- |
| [#255](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/255) | The supported Node build uses the exception-enabled node-addon-api target and native binding checks; this does not establish compatibility with every reported host toolchain. |
| [#193](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/193) | The fork has its own scoped package metadata and source revisions; an outdated upstream registry release is not repaired by this fork. |
| [#150](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/150) | README lists LaTeX math as a dialect extension rather than CommonMark syntax. |
| [#168](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/168) | Rust `parse_with` documentation describes callback offsets, slices and repeated requests. |
| [#172](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/172) | Documentation explains that extensions are selected during grammar generation; changing Cargo build environment variables does not regenerate installed sources. |
| [#169](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/169) | Corrected the claim of complete `TreeCursor` API parity; the requested extra methods were not added. |
| [#118](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/118) | Default queries are checked against the shipped default grammars; wiki links are optional and absent by default. |
| [#69](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/69) | README now provides installation, block/inline usage and build instructions. |

## Working behavior, specification differences and host reports

| Issue | Disposition in this fork |
| --- | --- |
| [#59](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/59) | Repeated level-one Setext headings already parse; retained as a regression check. |
| [#5](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/5) | The reported multiline reference-label example already works; retained as a regression check. |
| [#202](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/202) | The requested empty nested list would contradict GFM paragraph-interruption rules; the valid Setext interpretation is preserved. |
| [#185](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/185) | An unescaped pipe remains a table delimiter. Supporting an unescaped wiki-link alias inside a table would require a separate dialect decision. |
| [#213](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/213) | A blank line legitimately ends a GFM table; empty cells and whitespace-only cell content are handled separately. |
| [#45](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/45) | Code spans belong to the inline grammar; a block-only parse is not expected to expose them. |
| [#6](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/6) | HTML/code-span precedence in the reported example is covered by the active GFM example 354 regression. |
| [#113](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/113) | Report concerns host LaTeX highlighting/injection configuration; no parser fix is established. |
| [#180](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/180) | Report concerns terminal/host hyperlink presentation; no parser fix is established. |

## Remaining bugs and limitations

| Issue | Disposition in this fork |
| --- | --- |
| [#8](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/8) | Partially addressed: Unicode flanking, invalid delimiter runs and several nested-emphasis cases are corrected. Four genuine limitations remain in examples 400, 401, 406 and 421; see PR #284 and the inline corpus's explicit skips. |
| [#154](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/154) | General list text-object ranges and ownership of trailing block continuations remain unresolved. |
| [#91](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/91) | General paragraph/list continuation ownership for folding remains unresolved; the targeted ATX/list-marker fixes do not settle this CST design question. |
| [#251](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/251) | Reproduced the native traversal crash on Python runtime 0.26.0 at 15 KB. The `core` extra selects `>=0.25.2,<0.26`, and an import guard rejects exactly 0.26.0 before runtime loading. Runtime 0.25.2 passes 1 KB, 15 KB and 150 KB traversal checks. This mitigates an external runtime incompatibility rather than claiming a parser repair. |

The four `:skip` records in [the inline failing corpus](../tree-sitter-markdown-inline/test/corpus/failing.txt) are confirmed limitations, not coverage counted as passing. Fourteen repaired examples moved into the active inline corpus. Example 538 was normalized to its inline paragraph because its inherited expectation incorrectly combined block and inline roots. Bare GFM autolinks are also still missing, as recorded below.

## Feature requests not implemented in this pass

| Issue | Disposition in this fork |
| --- | --- |
| [#273](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/273) | Footnote syntax is a separate extension request. |
| [#221](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/221) | Go bindings are a separate binding addition. |
| [#210](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/210) | Collapse/expand commands belong to the consuming editor. |
| [#195](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/195) | YAML metadata terminated by `...` is a dialect enhancement. |
| [#194](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/194) | Pandoc raw code-fence language attributes require a separate syntax/injection decision. |
| [#188](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/188) | `==highlight==` is an additional dialect feature. |
| [#183](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/183) | Pandoc single-tilde subscript conflicts with the selected GFM strikethrough dialect. |
| [#171](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/171) | Bare GFM autolinks remain unsupported; angle-bracket autolinks are distinct syntax. |
| [#170](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/170) | A Markdown-aware node wrapper and `walk()` API require a separate Rust API change. |
| [#164](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/164) | Dedicated bare-URL nodes remain unimplemented, overlapping #171. |
| [#146](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/146) | A published cross-parser benchmark is separate work; no comparative performance claim is made. |
| [#137](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/137) | MDX parser design is outside this Markdown bug-fix pass. |
| [#128](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/128) | Language-labelled metadata delimiters such as `---toml` are a dialect enhancement. |
| [#109](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/109) | Exposing autolink delimiter nodes is a separate CST/API addition. |
| [#81](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/81) | MDX support is not implemented. |
| [#76](https://github.com/tree-sitter-grammars/tree-sitter-markdown/issues/76) | YAML metadata away from document start is a Pandoc dialect enhancement. |

## Open pull requests

These dispositions concern the reported behavior, not an assertion that a pull request was copied or merged. Overlapping proposals were evaluated together against the fork's grammar and regression tests.

The independently written rule-of-three implementation was informed by [PR #284's reviewed revision 511cea7a5d0324661e2e92b2ad49085e363bfad8](https://github.com/tree-sitter-grammars/tree-sitter-markdown/commit/511cea7a5d0324661e2e92b2ad49085e363bfad8), by francobritannique (Ceri C). Its local lookahead also handles Unicode, escapes and unmatched backticks without a document-length cutoff.

| Pull request | Disposition in this fork |
| --- | --- |
| [#285](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/285) | Consecutive-image behavior addressed by removing ambiguous nested inline repetition. |
| [#284](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/284) | The next-relevant-run rule-of-three approach repairs examples 420, 424 and 438, with code-span/escape handling and no document-length cutoff. Incremental regressions and targeted delimiter-run performance probes pass. Nonlocal opener matching in example 421 remains unsupported; this is not complete GFM emphasis conformance. |
| [#256](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/256) | Empty-cell and delimiter-counting behavior addressed with the related table fixes. |
| [#239](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/239) | Named empty-cell behavior addressed with the related table fixes. |
| [#238](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/238) | Numeric underscores are internal to number tokens only when followed by further digits. |
| [#235](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/235) | Pandoc highlight, superscript and subscript features were not added. |
| [#231](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/231) | Empty data-cell support addressed; delimiter validation and named cell ranges are covered separately. |
| [#175](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/175) | Link destination content ranges exclude angle brackets; an empty `<>` has no nonempty destination node. |
| [#110](https://github.com/tree-sitter-grammars/tree-sitter-markdown/pull/110) | Broad conflict removal was not applied without an independently established correctness or performance benefit. |
