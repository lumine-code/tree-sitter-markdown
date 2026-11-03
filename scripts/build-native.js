const { root, run } = require('./run');
run(process.execPath, [require.resolve('node-gyp-build/bin.js')], {
  cwd: root,
});
