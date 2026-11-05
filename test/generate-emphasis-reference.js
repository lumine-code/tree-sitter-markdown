// Test-only oracle generator. Build official commonmark/cmark at the pinned
// revision below, then pass its executable and clean source checkout. Neither CI nor the runtime
// loads cmark; tests consume the checked-in independent expected HTML.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const executable = process.argv[2];
const sourceDirectory = process.argv[3];
if (!executable || !sourceDirectory)
  throw new Error(
    'Usage: node test/generate-emphasis-reference.js <cmark executable> <pinned cmark source checkout>',
  );
const revision = '8dc7bd433a0c5caf43ad64a934bea17e4b7f8952';
const actualRevision = execFileSync(
  'git',
  ['-C', sourceDirectory, 'rev-parse', 'HEAD'],
  {
    encoding: 'utf8',
  },
).trim();
const sourceChanges = execFileSync(
  'git',
  ['-C', sourceDirectory, 'status', '--porcelain'],
  {
    encoding: 'utf8',
  },
).trim();
if (actualRevision !== revision || sourceChanges) {
  throw new Error(
    `Expected clean official cmark source at ${revision}, received ${actualRevision}`,
  );
}
const version = execFileSync(executable, ['--version'], {
  encoding: 'utf8',
}).trim();
if (!version.startsWith('cmark 0.30.3 -')) {
  throw new Error(
    `Expected the pinned official reference, received ${version}`,
  );
}
const cases = [];
const add = (name, markdown) => cases.push({ name, markdown });

for (const delimiter of ['*', '_']) {
  for (let opening = 1; opening <= 6; opening++) {
    for (let middle = 1; middle <= 6; middle++) {
      for (let closing = 1; closing <= 6; closing++) {
        add(
          `rule-of-three ${delimiter} ${opening}/${middle}/${closing}`,
          `prefix ${delimiter.repeat(opening)}a${delimiter.repeat(middle)}b${delimiter.repeat(closing)} suffix`,
        );
      }
    }
  }
  const other = delimiter === '*' ? '_' : '*';
  for (let opening = 1; opening <= 3; opening++) {
    for (let middle = 1; middle <= 3; middle++) {
      for (let closing = 1; closing <= 3; closing++) {
        add(
          `crossed ${delimiter}/${other} ${opening}/${middle}/${closing}`,
          `prefix ${delimiter.repeat(opening)}a ${other.repeat(middle)}b${delimiter.repeat(closing)} c${other.repeat(middle)} suffix`,
        );
      }
    }
  }
  for (const length of [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 31, 64, 127, 128, 129, 254, 255, 256, 257,
    258, 511, 512, 513, 1024,
  ]) {
    add(
      `long symmetric ${delimiter} ${length}`,
      `prefix ${delimiter.repeat(length)}x${delimiter.repeat(length)} suffix`,
    );
  }
  for (const chr of [
    'a',
    '3',
    'λ',
    '中',
    '«',
    '»',
    '。',
    '—',
    '¿',
    '😀',
    '𝄞',
    ' ',
    '\t',
    '\u00a0',
    '\u2003',
    '\u202f',
    '\u2028',
    '\f',
  ]) {
    for (const width of [1, 2]) {
      const run = delimiter.repeat(width);
      add(
        `Unicode left ${delimiter}${width} U+${chr.codePointAt(0).toString(16)}`,
        `prefix ${chr}${run}word${run} suffix`,
      );
      add(
        `Unicode right ${delimiter}${width} U+${chr.codePointAt(0).toString(16)}`,
        `prefix ${run}word${run}${chr} suffix`,
      );
      add(
        `Unicode inside opening ${delimiter}${width} U+${chr.codePointAt(0).toString(16)}`,
        `prefix ${run}${chr}word${run} suffix`,
      );
      add(
        `Unicode inside closing ${delimiter}${width} U+${chr.codePointAt(0).toString(16)}`,
        `prefix ${run}word${chr}${run} suffix`,
      );
    }
  }
}

for (const markdown of [
  '*a _b* c_',
  '_a **b_ c**',
  '*foo**bar*',
  '*foo**bar***',
  '**foo*bar*baz**',
  'a&amp;_b_',
  'a&#38;_b_',
  '`a`_b_',
  '<b>_c_',
  '[a](b)_c_',
  '*a*_b_',
  'a\\*_b_',
  '!`a\n`_x_',
  '*a `*` c*',
  '_a `_` c_',
  '**a `**` c**',
  '*a [b*](/url) c*',
  '*a [*b*](/url) c*',
  '*a ![*b*](image.png) c*',
  '*a <span title="*">b</span> c*',
  '*a <span>*b*</span> c*',
  '*a <http://example.com/*> c*',
  '*a [b](path*value) c*',
  '*a [b](path "*title*") c*',
  '*a \\* b*',
  '**a ![alt**](image.png) c**',
])
  add(`precedence ${JSON.stringify(markdown)}`, markdown);

// Cache regressions need independent expectations for every intermediate
// document, including states where no matching closer exists yet.
for (const markdown of [
  '*a',
  '*a*',
  '**a',
  '**a**',
  '*a _b',
  '*a _b_',
  '*a _b_*',
  '*a `b*` c',
  '*a b* c',
  '*a [b](path*) c',
  '*a [b] path*) c',
  '*a *b *c',
  '*a *b *c*',
  ...[1, 2, 3, 8].map((count) => '**a****b'.repeat(count)),
])
  add(`cache ${JSON.stringify(markdown)}`, markdown);

let state = 0x20261105;
const random = (limit) => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % limit;
};
const alphabet = [
  'a',
  'b',
  ' ',
  '*',
  '**',
  '***',
  '_',
  '__',
  '___',
  '(',
  ')',
  '!',
  '«',
  '»',
  '\u00a0',
  '\\*',
  '\\_',
];
for (let index = 0; index < 256; index++) {
  const size = 4 + random(20);
  let body = '';
  for (let j = 0; j < size; j++) body += alphabet[random(alphabet.length)];
  add(`seed 20261105 case ${index}`, `prefix ${body} suffix`);
}

for (const example of cases) {
  example.html = execFileSync(executable, ['--to', 'html', '--unsafe'], {
    input: example.markdown,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}
const fixture = {
  source: {
    repository: 'https://github.com/commonmark/cmark',
    revision,
    baseTag: '0.30.3',
    describe: '0.30.3-51-g8dc7bd4',
    version,
    generator:
      'node test/generate-emphasis-reference.js <pinned cmark executable> <pinned cmark source checkout>',
    note: 'Pinned official commit includes both delimiter-cache fixes while preserving all 131 published GFM emphasis examples, the punctuation-only Unicode flanking rule and nested strong emphasis. It immediately precedes the Unicode P/S classification change.',
  },
  cases,
};
fs.writeFileSync(
  path.join(__dirname, 'fixtures/emphasis-reference.json'),
  JSON.stringify(fixture, null, 2) + '\n',
);
process.stdout.write(`Generated ${cases.length} reference cases.\n`);
