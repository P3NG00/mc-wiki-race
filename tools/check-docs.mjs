#!/usr/bin/env node
// Checks the docs against the repo, so they can't quietly drift from it. Run by the pre-commit hook on every commit.
// 1. Every relative link in a Markdown file leads to a file that exists, and its #fragment to a heading in it.
// 2. Every name in backticks in docs/internal/ (an id, a function, a key, a class) is still in the code. It catches a
//    name gone from the code entirely: one still in a comment or a test passes, and so does a dotted name whose parts
//    are each somewhere in it.
// 3. Every docs/….md path the code mentions in a comment leads to a doc that exists.
// Fenced code blocks (``` or ~~~) are skipped; a block marked only by a four-space indent isn't told apart from a list
// item's text, so it is checked like prose.
// Usage: node tools/check-docs.mjs [--staged] [repo]
//   --staged checks what is staged, as the commit will have it, rather than the working tree. repo is this one by
//   default; tools/check-docs.test.mjs runs it on a made-up one. Exits 1 and lists the problems if there are any.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

const args = process.argv.slice(2), staged = args.includes('--staged');
const git = (gitArgs, cwd) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
const root = git(['rev-parse', '--show-toplevel'], args.find(a => a !== '--staged') ?? '.').trim();
const at = f => posix.join(root, f);
// The files as the commit will have them, or as they are on disk with untracked ones (but not ignored ones) too.
// -z keeps paths with non-ASCII letters as they are, rather than quoted.
const all = git(['ls-files', '-z', '--cached', ...staged ? [] : ['--others', '--exclude-standard']], root).split('\0')
  .filter(f => f && (staged || existsSync(at(f))));
const files = new Set(all);
const exists = p => p === '' || files.has(p) || all.some(f => f.startsWith(p + '/'));
// Each file is read once, however many of the checks below look at it.
const texts = new Map();
const read = f => {
  if (!texts.has(f)) texts.set(f, staged ? git(['show', `:${f}`], root) : readFileSync(at(f), 'utf8'));
  return texts.get(f);
};
const problems = [];

// Fenced code blocks, indented ones in lists too, hold commands and samples, not links or names to check.
const prose = text => text.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1/gm, m => m.replace(/[^\n]/g, ''));
const lineOf = (text, i) => text.slice(0, i).split('\n').length;
const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };

// GitHub's heading anchors: the heading's text (a link's words, not its address, and no HTML tags), lower case,
// punctuation dropped, spaces to hyphens, repeats numbered. Headings are # lines, or a line underlined with = or -.
// A stray % that isn't an escape is taken as it is.
const anchors = new Map();
function anchorsOf(file) {
  if (!anchors.has(file)) {
    const seen = new Map(), set = new Set();
    const headings = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*$|^ {0,3}([^\s#|>*+-].*?)[ \t]*\n {0,3}(?:=+|-+)[ \t]*$/gm;
    for (const [, atx, setext] of prose(read(file)).matchAll(headings)) {
      const base = (atx ?? setext).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>|`/g, '').toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      set.add(n ? `${base}-${n}` : base);
    }
    anchors.set(file, set);
  }
  return anchors.get(file);
}

const mdFiles = all.filter(f => f.endsWith('.md'));
for (const file of mdFiles) {
  // A link in an inline code span is an example, not a link.
  const text = prose(read(file)).replace(/`[^`\n]*`/g, m => ' '.repeat(m.length));
  // Inline links, with or without a title or <…> and with one level of brackets in the address, and reference
  // definitions ([name]: target, not a footnote's [^name]:).
  const links = [...text.matchAll(/\]\(<?((?:[^()\s>]|\([^()\s]*\))+)>?(?:\s+"[^"]*")?\)/g),
    ...text.matchAll(/^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*<?([^\s>]+)>?/gm)];
  for (const m of links) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target)) continue;   // http:, https:, mailto:
    const [encoded, frag] = target.split('#'), path = decode(encoded);
    // A link starting with / starts at the repo's root, as GitHub reads it.
    const dest = !path ? file : path.startsWith('/') ? posix.normalize(path.slice(1)).replace(/^\.$/, '')
      : posix.relative(root, posix.resolve(root, posix.dirname(file), path));
    const where = `${file}:${lineOf(text, m.index)}`;
    if (!exists(dest.replace(/\/$/, ''))) problems.push(`${where}: link to ${target}, which doesn't exist`);
    else if (frag && dest.endsWith('.md') && !anchorsOf(dest).has(decode(frag)))
      problems.push(`${where}: link to ${target}, which has no heading for #${frag}`);
  }
}

// The code the internal docs describe, leaving out this check and its test, whose names would otherwise pass as the
// game's, and the wiki-*.js data files, whose article titles would pass as names (the keys in them are build.py's).
const codeFiles = all.filter(f => !f.endsWith('.md') && !f.startsWith('tools/check-docs')
  && (f === 'index.html' || /^(test|tools|\.githooks)\//.test(f)));
// A hyphenated name counts whole, part by part and by its leading parts (Advancement-plain of Advancement-plain-raw).
const tokens = new Set();
for (const f of codeFiles) for (const [t] of read(f).matchAll(/[\w$]+(?:-[\w$]+)*/g)) {
  tokens.add(t);
  if (!t.includes('-')) continue;
  let lead = '';
  for (const part of t.split('-')) { tokens.add(part); tokens.add(lead += (lead && '-') + part); }
}
// data-foo-bar is set from scripts as dataset.fooBar.
const camel = s => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const known = name => {
  const n = name.replace(/^[#.]/, '');
  return n.split('.').every(p => tokens.has(p)) || (n.startsWith('data-') && tokens.has(camel(n.slice(5))));
};
for (const file of mdFiles.filter(f => f.startsWith('docs/internal/'))) {
  const text = prose(read(file));
  // Each code span in turn, so a closing backtick never opens one; a span is a name if it is one by itself, with or
  // without a call's brackets (renderThing(), navigate(title)).
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const name = m[1].match(/^([#.]?[A-Za-z_$][\w$.-]*)(?:\(.*\))?$/)?.[1];
    if (name && !known(name)) problems.push(`${file}:${lineOf(text, m.index)}: \`${m[1]}\` isn't in the code`);
  }
}

// Docs named in the code's comments: a path from the repo's root, not the end of a URL or another repo's path.
for (const file of codeFiles) {
  const text = read(file);
  for (const m of text.matchAll(/(?<![\w/.-])docs\/[\w/-]+\.md\b/g))
    if (!files.has(m[0])) problems.push(`${file}:${lineOf(text, m.index)}: names ${m[0]}, which doesn't exist`);
}

for (const p of problems) console.log(p);
console.log(problems.length ? `check-docs: ${problems.length} problem(s)` : 'check-docs: links and names all check out');
process.exit(problems.length ? 1 : 0);
