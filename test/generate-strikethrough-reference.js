// Test-only oracle generator. No reference implementation code is vendored.
// Pass clean official github/cmark-gfm checkouts and their built executables.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [
  ,
  ,
  executable,
  sourceDirectory,
  currentExecutable,
  currentSourceDirectory,
] = process.argv;
if (
  !executable ||
  !sourceDirectory ||
  !currentExecutable ||
  !currentSourceDirectory
)
  throw new Error(
    'Usage: node test/generate-strikethrough-reference.js <historical executable> <historical source checkout> <current executable> <current source checkout>',
  );

const revision = 'b8eb2e00de094999f978e9cb02b1a78d810812d3';
const currentRevision = '27d942c8b0a62d192f616e5bf3578f4b6a89e180';
for (const [directory, expected] of [
  [sourceDirectory, revision],
  [currentSourceDirectory, currentRevision],
]) {
  const actual = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const changed = execFileSync(
    'git',
    ['-C', directory, 'status', '--porcelain'],
    {
      encoding: 'utf8',
    },
  ).trim();
  if (actual !== expected || changed)
    throw new Error(`Expected clean official cmark-gfm source at ${expected}`);
}
const version = execFileSync(executable, ['--version'], {
  encoding: 'utf8',
}).trim();
if (!version.startsWith('cmark-gfm 0.29.0.gfm.0 -'))
  throw new Error(`Unexpected historical cmark-gfm executable: ${version}`);

const examples = [];
const bySource = new Map();
function add(name, markdown, requiredAtom) {
  if (bySource.has(markdown)) return bySource.get(markdown).name;
  const example = { name, markdown };
  if (requiredAtom) example.requiredAtom = requiredAtom;
  examples.push(example);
  bySource.set(markdown, example);
  return name;
}

for (const emphasis of ['*', '**', '_', '__']) {
  for (const strike of ['~', '~~']) {
    add(
      `crossed ${emphasis} then ${strike}`,
      `${emphasis}a ${strike}b${emphasis} c${strike}`,
    );
    add(
      `crossed ${strike} then ${emphasis}`,
      `${strike}a ${emphasis}b${strike} c${emphasis}`,
    );
    add(
      `nested ${emphasis} inside ${strike}`,
      `${strike}a ${emphasis}b${emphasis} c${strike}`,
    );
    add(
      `nested ${strike} inside ${emphasis}`,
      `${emphasis}a ${strike}b${strike} c${emphasis}`,
    );
  }
}
for (let opening = 1; opening <= 4; opening++) {
  for (let closing = 1; closing <= 4; closing++) {
    add(
      `exact tilde widths ${opening}/${closing}`,
      `prefix ${'~'.repeat(opening)}a${'~'.repeat(closing)} suffix`,
    );
  }
}
for (const source of [
  'prefix \\~a~ suffix',
  'prefix \\~~a~~ suffix',
  'prefix ~~a\\~~ suffix',
  'prefix ~~a &amp; b~~ suffix',
]) {
  add(`escape/entity ${JSON.stringify(source)}`, source);
}
for (const source of ['~a~~b~c~~', '~~a~b~~c~', '~a~~b~ c~~', '~~a~b~~ c~']) {
  add(`dual-purpose mismatched widths ${JSON.stringify(source)}`, source);
}
for (const outerOpen of [1, 2]) {
  for (const innerOpen of [1, 2]) {
    for (const innerClose of [1, 2]) {
      for (const outerClose of [1, 2]) {
        add(
          `nested tilde widths ${outerOpen}/${innerOpen}/${innerClose}/${outerClose}`,
          `${'~'.repeat(outerOpen)}a ${'~'.repeat(innerOpen)}b${'~'.repeat(innerClose)} c${'~'.repeat(outerClose)}`,
        );
      }
    }
  }
}
for (const strike of ['~', '~~']) {
  for (const source of [
    `a${strike}b${strike}c`,
    `${strike} a${strike}`,
    `${strike}a ${strike}`,
    `!${strike}?a${strike}.`,
    `${strike}!a${strike}`,
    `a${strike}!b${strike}c`,
  ]) {
    add(`tilde flanks ${JSON.stringify(source)}`, source);
  }
  for (const [source, atom] of [
    [`${strike}a \`b${strike}\` c${strike}`, 'code_span'],
    [`${strike}a <b title="${strike}"> c${strike}`, 'html_tag'],
    [`${strike}a [b](path${strike}) c${strike}`, 'inline_link'],
    [`${strike}a [*b*](u) c${strike}`, 'inline_link'],
    [`${strike}a ![*b*](i) c${strike}`, 'image'],
    [`${strike}a <https://example.org/p${strike}> c${strike}`, 'uri_autolink'],
    [
      `${strike}a https://example.org/p${strike}q c${strike}`,
      'bare_uri_autolink',
    ],
    [
      `${strike}a local_${strike}b@example.org c${strike}`,
      'bare_email_autolink',
    ],
  ]) {
    add(`opaque ${JSON.stringify(source)}`, source, atom);
  }
  for (const source of [
    `«${strike}λ_2${strike}»`,
    `😀${strike}λ_2${strike}😀`,
    `${strike}a\u00a0b${strike}`,
    `λ${strike}β${strike}γ`,
  ]) {
    add(`Unicode ${JSON.stringify(source)}`, source);
  }
  for (const source of [
    `${strike}a\n*b* c${strike}`,
    `*a\n${strike}b* c${strike}`,
  ]) {
    add(`multiline ${JSON.stringify(source)}`, source);
  }
}

const restoreSources = [];
for (const strike of ['~', '~~']) {
  const other = strike === '~' ? '~~' : '~';
  for (const both of [false, true]) {
    const left = both ? 'prefix a' : 'prefix ';
    for (const emphasis of ['*', '**', '_', '__']) {
      const sources = [
        `${left}${strike}a ${emphasis}b${emphasis} c${other} d${strike}`,
        `${left}${strike}a ${emphasis}b${emphasis}${other}c${strike}`,
        `${left}${strike}a ${emphasis}b${emphasis} c${other}d${strike}`,
        `${left}${strike}a ${emphasis}b${emphasis} c${other}d${strike}e${other}`,
      ];
      for (const [index, source] of sources.entries()) {
        add(
          `restore tilde parent ${strike} ${both ? 'BOTH' : 'OPEN'} child ${emphasis} variant ${index}`,
          source,
        );
      }
      if (emphasis === '*' && strike === '~') restoreSources.push(...sources);
    }
  }
}

const skipTildeSources = [];
for (const width of [1, 2, 3]) {
  const tilde = '~'.repeat(width);
  for (const source of [
    `prefix _b_${tilde}c suffix`,
    `prefix ${tilde}a${tilde}_b_ suffix`,
    `prefix *${tilde} b${tilde}* suffix`,
    `prefix *${tilde}b ${tilde}* suffix`,
  ]) {
    add(`effective flank skipping tilde ${JSON.stringify(source)}`, source);
    skipTildeSources.push(source);
  }
}
const atomTildeSources = [
  'prefix \\~_b_ suffix',
  'prefix `a`~_b_ suffix',
  'prefix <b>~_c_ suffix',
  'prefix [a](b)~_c_ suffix',
  'prefix ~a~https://example.org/p suffix',
  'prefix ~a~local@example.org suffix',
  '_b_\\~c',
  'a\\~_b_',
  '\\~~a~',
  '~_a_~',
  '_b_~~~ c',
];
for (const source of atomTildeSources)
  add(`effective flank at escape or atom ${JSON.stringify(source)}`, source);

const repeatedCacheSequences = [];
for (const [pattern, width] of [
  ['~a~~b ', '~'],
  ['~~a~b ', '~~'],
]) {
  const half = pattern.repeat(4);
  const futureMatch = `${width}x${width} `;
  const atoms =
    '`*~x~~*` <b title="*~x~~*"> [~*x*~](path~~~) local_abc@example.org https://example.org/p*~q~~r';
  const invalid = `~~~x${'~'.repeat(17)}y~~~ `;
  repeatedCacheSequences.push({
    name: `repeated ${JSON.stringify(pattern)} cache invalidation and physical marker ordinals`,
    sources: [
      `prefix ${half}${half}suffix`,
      `prefix ${half}${futureMatch}${half}suffix`,
      `prefix ${half}${atoms} ${futureMatch}${half}suffix`,
      `prefix ${half}${invalid}${atoms} ${futureMatch}${half}suffix`,
    ],
  });
}

const sequences = [
  {
    name: 'crossing a formerly unmatched strike and emphasis closer',
    sources: ['*a ~~b c~~', '*a ~~b* c~~', '*a ~~b* c'],
  },
  {
    name: 'exact widths, unmatched closers and literal triple runs',
    sources: [
      'prefix ~~a suffix',
      'prefix ~~a~~ suffix',
      'prefix ~a~~ suffix',
      'prefix ~a~ suffix',
      'prefix ~~~a~~~ suffix',
    ],
  },
  {
    name: 'nested widths and nearest mismatched opener',
    sources: ['~~a ~b~ c~~', '~~a ~~b~ c~~', '~~a ~~b~~ c~~', '~a ~~b~~ c~'],
  },
  {
    name: 'revealing and restoring closers in opaque code and destinations',
    sources: [
      '~~a `b~~` c',
      '~~a b~~ c',
      '~~a [b](path~~) c',
      '~~a [b] path~~) c',
    ],
  },
  {
    name: 'Unicode positions and newline edits',
    sources: ['😀 ~~λ_2 *a*~~', '😀 ~λ_2 *a*~', '😀 ~λ_2\n*a*~'],
  },
  {
    name: 'changing nesting between strike, emphasis and strong emphasis',
    sources: ['~~a *b* c~~', '*a ~~b~~ c*', '__a ~b~ c__'],
  },
  {
    name: 'restoring OPEN and BOTH tilde parent metadata after emphasis children',
    sources: restoreSources,
  },
  {
    name: 'concatenating delimiters across single, double and triple tilde runs',
    sources: skipTildeSources,
  },
  {
    name: 'restoring effective flanks at escaped tildes and opaque atoms',
    sources: atomTildeSources,
  },
  ...repeatedCacheSequences,
].map(({ name, sources }) => ({
  name,
  cases: sources.map((source) =>
    add(`incremental ${JSON.stringify(source)}`, source),
  ),
}));

const args = [
  '--to',
  'html',
  '--unsafe',
  '-e',
  'strikethrough',
  '-e',
  'autolink',
];
const differences = [];
for (const example of examples) {
  example.html = execFileSync(executable, args, {
    input: example.markdown,
    encoding: 'utf8',
  });
  const currentHtml = execFileSync(currentExecutable, args, {
    input: example.markdown,
    encoding: 'utf8',
  });
  if (currentHtml !== example.html) {
    example.currentHtml = currentHtml;
    differences.push(example.name);
  }
}
const fixture = {
  source: {
    repository: 'https://github.com/github/cmark-gfm',
    revision,
    tag: '0.29.0.gfm.0',
    command: 'cmark-gfm --to html --unsafe -e strikethrough -e autolink',
    note: 'Historical GFM single/double-tilde dialect. Mismatched opener widths and other changes in the current reference remain explicit; tests assert the historical outputs.',
    crossCheckedRevision: currentRevision,
    currentDifferences: differences,
  },
  examples,
  sequences,
};
fs.writeFileSync(
  path.join(__dirname, 'fixtures', 'strikethrough-reference.json'),
  JSON.stringify(fixture, null, 2) + '\n',
);
console.log(JSON.stringify({ examples: examples.length, differences }));
