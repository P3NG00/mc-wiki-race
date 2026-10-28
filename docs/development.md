# Development

How to run the game, test it and keep the docs in step with it.

## Running the game

There's no build step. Open `index.html` straight from disk in a browser; `file://` works and needs no server.
If you want a real origin, serve the repo folder instead:

```sh
python3 -m http.server
```

Articles, pictures and sounds come live from minecraft.wiki either way, so the game needs network access.

For what each file and folder is, see [The files](how-it-works.md#the-files) in how-it-works.md.

## The test suites

Both run in headless Firefox, driven over WebDriver BiDi, with the game opened from `file://`.
They need `firefox` and Node 22 or newer.

| Suite | Command | What it's for |
| --- | --- | --- |
| Live, `test/e2e.mjs` | `test/run-e2e.sh [screenshot-dir]` | Plays real games against the live wiki: rendering, links, navigation, the result. Needs network access. |
| Offline, `test/offline.mjs` | `test/run-e2e.sh --offline` | The game's own logic: rolls, the daily, Content, difficulty, which links are live, every rule, items, advancements. About three and a half minutes. |

The live suite saves screenshots to `screenshot-dir` if you give one, making the folder if it isn't there. Either suite fails on any uncaught error in the page or the article frame.

Details: [internal/testing.md](internal/testing.md#live-suite-teste2emjs)

## The offline suite

Every request to minecraft.wiki is answered by the test, so it works without network access or while the wiki is down.
Every article is the same short made-up page holding one of each kind of link the game treats differently, stylesheets come back empty and images fail.
It also checks that the [wiki snapshot](wiki-data.md) still has the pages it names, so a new snapshot that drops one fails there by name rather than passing without testing anything.
Rendering real articles is left to the live suite.

Details: [internal/testing.md](internal/testing.md#offline-suite-testofflinemjs)

## When to run the live suite

The live suite runs only by hand; there's no CI, so the live wiki can change between runs unnoticed. Run it:

- after changing how articles are fetched or shown, since the offline suite never renders a real one
- after every [update of the wiki snapshot](wiki-data.md#updating-the-snapshot) (the hook reminds you)
- before a release

To focus on one behaviour, edit or comment out checks in `e2e.mjs`.

Details: [internal/testing.md](internal/testing.md#before-a-release)

## Random play

The live suite ends with random play: 30 seeded steps on one pair, started again after each win, clicking links (sometimes a second one mid-load), going back, switching theme, peeking and toggling the path.
After each step the click count, the path, the Back stack, the article shown and the clock have to agree.
The seed is printed with the result, and `MWR_SEED=<seed> test/run-e2e.sh` replays the same choices, though the wiki may have changed since.

Details: [internal/testing.md](internal/testing.md#random-play)

## The pre-commit hook

Turn it on once per clone:

```sh
git config core.hooksPath .githooks
```

On each commit it then:

1. Reminds you to run the live suite by hand if the commit changes the wiki snapshot (any of the four data files or the ZIM's `.sha256`).
2. Runs the docs check's own test, if the commit changes the check or its test.
3. Runs the docs check on what is staged, on every commit, so it needs Node even for a commit of docs alone.
4. Runs the offline suite on the working tree, unless the commit has only Markdown, pictures (`.png`, `.ico`), `LICENSE`, `.gitignore` or files under `docs/` or `tools/`.

It prints only the failures and the summary, and stops the commit if anything fails. It runs the offline suite on port 9335, so a live suite running at the same time keeps its Firefox.
`git commit --no-verify` skips the hook, for a commit on a machine that can't run Firefox.

Since the docs check reads the staged files, stage everything that belongs together: a function renamed in `index.html` and the internal doc that names it go in the same commit.

Details: [internal/testing.md](internal/testing.md#pre-commit-hook)

## The docs check

`tools/check-docs.mjs` keeps the docs from quietly drifting from the code. It fails on:

- a relative link in any Markdown file to a file that doesn't exist, or to a `#heading` that isn't in it
- a name in backticks in `docs/internal/` (a function, an id, a key, a class) that's no longer anywhere in the code
- a `docs/….md` path in a code comment that doesn't exist

Links in code spans, and anything in fenced code blocks, are examples and aren't checked. A name is checked when it fills a code span by itself, with or without a call's brackets.
Run `node tools/check-docs.mjs` by hand to check the working tree, untracked files too.

## Quick syntax check

To check the inline script without a browser, pull it out and run `node --check` on it.
This also fails if an HTML comment opener appears in the script, which would stop the page running without a word:

```sh
python3 -c "import re;h=open('index.html').read();s=re.findall(r'<script>\n(.*?)</script>\n</body>',h,re.S)[0];assert '<!--' not in s;open('/tmp/m.js','w').write(s)" && node --check /tmp/m.js
```

Details: [internal/rendering.md](internal/rendering.md#rendering-articles)

## Before a release

Run the live suite, then check by hand what neither suite can:

- the game in Chrome, since the suites only drive Firefox
- the game in Safari on an iPhone: inputs not zooming, the layout under the toolbars, no leave-page dialog
- how real articles look: glance at the live suite's screenshots, and a few articles in both themes for a new wiki widget that needs the wiki's own script
- that the sounds play and the mute works
- the items: a blast on a scrolled setup screen and article, the pieces resting on the page without anything scrolling sideways, Rebuild, and the textures and toasts
- a game or two on a real phone, upright and on its side

Details: [internal/testing.md](internal/testing.md#before-a-release)

## How the docs are organised

The pages for people and the detailed reference in `docs/internal/` are described in [the docs index](README.md).
A change to the game updates the internal doc that covers it, and the page in `docs/` too when players, hosts or contributors would notice.

## Rules that break things quietly

A few mistakes leave the game silently broken rather than failing loudly. They're listed in [how-it-works.md](how-it-works.md#rules-that-break-things-quietly); read them before changing `index.html`.
