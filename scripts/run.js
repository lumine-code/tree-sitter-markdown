const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

const root = join(__dirname, '..');
const grammars = ['tree-sitter-markdown', 'tree-sitter-markdown-inline'];

function run(command, args, options = {}) {
  const env = { ...process.env, ...options.env };
  if (env.GITHUB_ACTIONS !== 'true') delete env.CI;
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status}`);
}

function treeSitter(args, options = {}) {
  const directory = dirname(require.resolve('tree-sitter-cli/package.json'));
  const executable = join(
    directory,
    process.platform === 'win32' ? 'tree-sitter.exe' : 'tree-sitter',
  );
  run(executable, args, options);
}

module.exports = { root, grammars, run, treeSitter };
