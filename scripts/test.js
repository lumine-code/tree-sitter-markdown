#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { root, grammars, treeSitter } = require('./run');

function disabledExtensionTests(directory) {
  const types = JSON.parse(
    readFileSync(join(directory, 'src/node-types.json'), 'utf8'),
  );
  const disabled = [];
  for (const [node, file] of [
    ['tag', 'tags.txt'],
    ['wiki_link', 'extension_wikilink.txt'],
  ]) {
    if (types.some((type) => type.type === node)) continue;
    const lines = readFileSync(
      join(directory, 'test/corpus', file),
      'utf8',
    ).split(/\r?\n/);
    let headerStart = true;
    let current;
    const finish = (end) => {
      if (!current || current.bodyStart === undefined) return;
      const body = lines.slice(current.bodyStart, end);
      const separator = body.findLastIndex((line) => /^-{3,}$/.test(line));
      const expected = body.slice(separator + 1).join('\n');
      // Negative cases remain meaningful when the extension is disabled.
      if (!new RegExp(`\\(${node}(?:\\s|\\))`).test(expected)) return;
      disabled.push(current.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    };
    for (let index = 0; index < lines.length - 1; index++) {
      if (!/^={3,}$/.test(lines[index])) continue;
      headerStart = !headerStart;
      if (headerStart) current.bodyStart = index + 1;
      else {
        finish(index);
        current = { name: lines[index + 1] };
      }
    }
    finish(lines.length);
  }
  return disabled;
}

for (const grammar of grammars) {
  console.log(`Testing ${grammar}`);
  const directory = join(root, grammar);
  const excluded = grammar.endsWith('-inline')
    ? disabledExtensionTests(directory)
    : [];
  const args = ['test'];
  if (excluded.length) args.push('--exclude', `^(?:${excluded.join('|')})$`);
  try {
    treeSitter(args, { cwd: directory });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
