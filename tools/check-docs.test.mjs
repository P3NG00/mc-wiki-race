#!/usr/bin/env node
// Runs tools/check-docs.mjs on a made-up repo in a temporary directory, with one of each mistake it should catch and one
// of each thing it should let pass, on the working tree and then on what is staged. Run by the pre-commit hook when
// check-docs changes.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

// What the check should report on the made-up repo, on what is staged; the working tree also has an unstaged draft.
const want = [
  "README.md:1: link to docs/internal/b.md, which doesn't exist",
  "README.md:1: link to /nope.html, which doesn't exist",
  "README.md:1: link to odds-50%.md, which doesn't exist",
  'docs/internal/a.md:7: link to a.md#no-such-heading, which has no heading for #no-such-heading',
  "docs/internal/a.md:7: link to missing.md, which doesn't exist",
  'docs/internal/a.md:7: link to #next-line, which has no heading for #next-line',
  "docs/internal/a.md:7: link to titled.md, which doesn't exist",
  "docs/internal/a.md:10: link to referenced.md, which doesn't exist",
  "docs/internal/a.md:8: `goneThing()` isn't in the code",
  "docs/internal/a.md:8: `goneCall(page, 2)` isn't in the code",
  "docs/internal/a.md:8: `SOUNDS.vanished` isn't in the code",
  "docs/internal/a.md:8: `inData` isn't in the code",
  "index.html:2: names docs/gone.md, which doesn't exist",
].sort();
const draft = "docs/draft.md:1: link to nowhere.md, which doesn't exist";

const dir = mkdtempSync(join(tmpdir(), 'check-docs-'));
const runs = {};
try {
  const put = (f, text) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); };
  // Run from the hook, git sets GIT_DIR, GIT_INDEX_FILE and the like for the real repo: without them, the made-up repo's
  // git commands can't touch the real index.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const run = (...args) => spawnSync('node', [fileURLToPath(new URL('check-docs.mjs', import.meta.url)), ...args, dir],
    { encoding: 'utf8', env });
  put('index.html', `<script>
// See docs/internal/a.md and docs/gone.md, not https://example.com/docs/elsewhere.md.
// A path with brackets, a stray % and a footnote are fine too: see the README.
function renderThing() { el.dataset.mwrNote = SOUNDS.explode; load('Advancement-plain-raw.png'); }
</script>`);
  // A data file's article titles aren't names in the code.
  put('wiki-data.js', 'const WIKI_DATA = { articles: ["inData"] };\n');
  // Its own names don't count as the game's: goneThing is in this file, and in a copy of it in the made-up tools/.
  put('tools/check-docs.test.mjs', 'goneThing();\n');
  put('docs/café.md', '# Café\n');
  put('docs/notes_(old).md', 'Underlined <em>heading</em>\n===\n\n[^1]: A footnote, not a link.\n');
  put('README.md', 'See [the rules](docs/internal/a.md#the-rules), [b](docs/internal/b.md), [root](/index.html), [top](/), [no](/nope.html), [café](docs/caf%C3%A9.md#café), [old](docs/notes_(old).md#underlined-heading), [odd](odds-50%.md) and [web](https://example.com).\n');
  put('docs/internal/a.md', `# A

## The rules

  ### [Linked](https://example.com) heading
Fine: \`renderThing()\`, \`renderThing(page)\`, \`#renderThing\`, \`data-mwr-note\`, \`SOUNDS.explode\`, \`Advancement-plain\`, \`ns-<N>\`, \`[ex](nowhere.md)\`, \`a b\`stale\`renderThing\`, [h](#linked-heading), [y](#the-rules).
Broken: [x](a.md#no-such-heading), [z](missing.md), [e](#next-line), [t](titled.md "Title"), [r][ref].
Stale: \`goneThing()\`, \`goneCall(page, 2)\`, \`SOUNDS.vanished\`, \`inData\`.

[ref]: referenced.md

- In a list:
  \`\`\`sh
  inFenceThing [skipped](nowhere.md)
  \`\`\`

~~~
\`fencedThing\` [skipped](nowhere.md)
~~~

#
Next line
`);
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  execFileSync('git', ['add', '-A'], { cwd: dir, env });
  // Not staged, so only the working-tree run sees it.
  put('docs/draft.md', '[draft](nowhere.md)\n');
  runs['working tree'] = [run(), [draft, ...want].sort()];
  runs.staged = [run('--staged'), want];
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const [name, [{ status, stdout, stderr }, lines]] of Object.entries(runs)) {
  const got = stdout.trim().split('\n'), summary = got.pop();
  check(`${name}: exits 1`, status === 1, stderr.trim());
  const same = JSON.stringify(got.sort()) === JSON.stringify(lines);
  check(`${name}: reports each problem and nothing else`, same, same ? '' : `got:\n${got.join('\n')}`);
  check(`${name}: counts them`, summary === `check-docs: ${lines.length} problem(s)`, summary);
}
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
