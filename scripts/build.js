#!/usr/bin/env node
const { join } = require('node:path');
const { root, grammars, treeSitter } = require('./run');

for (const grammar of grammars) {
  console.log(`Generating ${grammar}`);
  treeSitter(['generate', '--abi', '15'], {
    cwd: join(root, grammar),
    env: process.argv.includes('--all') ? { ALL_EXTENSIONS: '1' } : {},
  });
}
