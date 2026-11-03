const { root, run } = require('./run');
const { join } = require('node:path');

run(process.execPath, ['--test', 'bindings/node/*_test.js'], { cwd: root });
run(process.execPath, [join(__dirname, 'test.js')], { cwd: root });
run(process.execPath, ['--test', 'test/*.test.js'], { cwd: root });
