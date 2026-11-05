// Test inputs shared by the pinned oracle generator and incremental tests.
const unit = '**a****b ';

function insertInRun(source, index) {
  return `${source.slice(0, index)}x${source.slice(index)}`;
}

const repeated = `prefix ${unit.repeat(8)}suffix`;
const parent = 'prefix *a**b* then *c**d**e* suffix';
const outside = parent.replace('then', 'then x');
const firstParent = outside.replace('a**b', 'a*x*b');

module.exports = [
  {
    name: 'inserting inside the middle four-marker run of eight repeated candidates',
    // Split the fifth unit's four-marker run after its second marker.
    sources: [
      repeated,
      insertInRun(repeated, 'prefix '.length + 4 * unit.length + 5),
    ],
  },
  {
    name: 'edits outside and inside separate parents with the same delimiter context',
    sources: [
      parent,
      outside,
      firstParent,
      firstParent.replace('c**d**e', 'c**d*x*e'),
    ],
  },
  ...[
    // The whitespace-delimited math run is literal under the GFM oracle too;
    // its presence must disable ordinal shortcuts while math remains opaque.
    ['math', '$x ** y$', 'latex_block'],
    ['code', '`**hidden***`', 'code_span'],
    ['HTML', '<b title="**hidden***">x</b>', 'html_tag'],
    ['URI', '<https://example.com/**hidden***>', 'uri_autolink'],
    ['email', '<x**y@example.com>', 'email_autolink'],
    ['link', '[label](path**hidden***)', 'inline_link'],
  ].map(([name, atom, type]) => {
    const prefix = `prefix ${unit.repeat(3)}${atom} `;
    const source = `${prefix}${unit.repeat(3)}suffix`;
    return {
      name: `ordinal counts skip ${name} contents between repeated candidates`,
      sources: [source, insertInRun(source, prefix.length + unit.length + 5)],
      atom: type,
    };
  }),
];
