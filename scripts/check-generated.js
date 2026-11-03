const { root, grammars, run } = require('./run');
const { join } = require('node:path');

run(process.execPath, [join(__dirname, 'build.js')], { cwd: root });
run(
  'git',
  ['diff', '--exit-code', '--', ...grammars.map((grammar) => `${grammar}/src`)],
  { cwd: root },
);
