# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MC Wiki Race, a wiki race (like thewikigame.com) through minecraft.wiki: the player gets a random start and target article and must reach the target by clicking links inside articles, scored on clicks and time.

The whole game is one `index.html` with no build step and no dependencies, plus files generated from an offline copy of the wiki (see [docs/internal/wiki-data.md](docs/internal/wiki-data.md)):
- `wiki-data.js`, loaded with a script tag: what rolls pick from (the pool, link counts, hub redirects, left-out pages, namespaces).
- the link graph files, also loaded by script tag: `wiki-links.js` as the page opens (the background and par), `wiki-navboxes.js` and `wiki-lead.js` the first time Relaxed or Top links only needs them.

Articles, pictures and descriptions are fetched live from the minecraft.wiki MediaWiki API at runtime. Beside the game are only static assets: the icon (`favicon.ico` at 16/32/48 px, `apple-touch-icon.png` at 180 px) and the 1200×630 link-preview image `og-image.png`.

The name follows Mojang's usage guidelines, which forbid "Minecraft" as the first word or dominant part of a fan project's name. Its home is https://mcwikirace.com/ (BryantF.xyz/games/mc-wiki-race forwards there), and `<head>` has a meta description, Open Graph tags and a `canonical` link pointing there, so every copy of the page names that address as the original. The footer says who runs the game (BryantF.xyz, linked) and how to reach them, which the guidelines also ask for.

## Running

Open `index.html` directly in a browser (`file://` works; no server needed). `python3 -m http.server` also works if a real origin is wanted.

## Testing

`test/run-e2e.sh [--offline] [screenshot-dir]` runs the suites in headless Firefox with WebDriver BiDi: `test/e2e.mjs` plays real games against the live wiki, and with `--offline`, `test/offline.mjs` checks the game's own logic in about three and a half minutes with every request answered by the test. They need `firefox` and Node ≥ 22.

The git pre-commit hook (`git config core.hooksPath .githooks` once per clone) runs on every commit:
- `tools/check-docs.test.mjs`, when the check itself changes.
- `tools/check-docs.mjs --staged`, which fails on a broken link between docs or a name in `docs/internal/` that's no longer in the code (all it checks is in [docs/internal/testing.md](docs/internal/testing.md#pre-commit-hook)). It reads the staged files, so stage a change and the docs that describe it together.
- the offline suite, unless the commit has only docs, pictures or `tools/`.

The live suite runs only by hand, before a release and after a snapshot update. [docs/internal/testing.md](docs/internal/testing.md) has what each suite checks, random play and its seed, and what to check by hand before a release.

Quick syntax check of the inline script, which also fails on an HTML comment opener in it (see [docs/internal/rendering.md](docs/internal/rendering.md)):
```sh
python3 -c "import re;h=open('index.html').read();s=re.findall(r'<script>\n(.*?)</script>\n</body>',h,re.S)[0];assert '<!--' not in s;open('/tmp/m.js','w').write(s)" && node --check /tmp/m.js
```

## Rules that break things quietly

- Every API request goes through `api()`, which adds `origin=*`: without it MediaWiki sends no CORS header and the page fetches nothing from `file://`.
- The HTML comment opener must not appear literally anywhere in `index.html`'s scripts, comments included, or the page silently doesn't run; values written into the article frame's script go in as JSON with `<` escaped.
- During play and in `finish`, read `game.rules`, never the checkboxes.
- Everything in a navigation that can fail has to fail inside `navigate`'s `try`, or the game stays loading with Give up disabled.
- `wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js` and `wiki-lead.js` are generated from the Kiwix ZIM only: never edit them by hand, and never update the data by crawling the wiki.

## Docs

There are two sets, and a change keeps both accurate:
- `docs/internal/`: the detailed reference, written for whoever changes the code. Read the one that covers what you are changing, and update it with the code, in the same commit. The architecture is all in `index.html`.
- `docs/` (and `README.md`): pages for people, short and readable, with no more code names than they need. Update the page too whenever players, hosts or contributors would notice the change: a label, a rule, a default, a number, a file, a command. `docs/how-to-play.md` spells everything out, advancements and secrets included, so a new advancement, item or rule goes in it too.

The internal reference:

- [docs/internal/setup-screen.md](docs/internal/setup-screen.md): the setup screen top to bottom, the footer and the licence credit during play.
- [docs/internal/url-hash.md](docs/internal/url-hash.md): the URL hash keys, sealed challenge links (`g=`), `daily=`.
- [docs/internal/testing.md](docs/internal/testing.md): everything the live and offline suites check, random play, the pre-commit hook, the manual release checks.
- [docs/internal/wiki-data.md](docs/internal/wiki-data.md): the ZIM, the `tools/wikidata/` scripts and `config.json`, the link graph files, how to update the snapshot.
- [docs/internal/picking.md](docs/internal/picking.md): rolls, pools, Content and spin-offs, target topic and par, joining the web of links, the daily.
- [docs/internal/par.md](docs/internal/par.md): par and golf scores, route searches, the result window and Share.
- [docs/internal/rendering.md](docs/internal/rendering.md): `api()`, the sandboxed article iframe and its script (link classification, animator, tabber, blueprints, the article theme).
- [docs/internal/rules.md](docs/internal/rules.md): the `game` object, difficulty, every game and extra rule, leaving the page, the clock, `navToken`, the parse cache.
- [docs/internal/ui.md](docs/internal/ui.md): themes (host themes too), pictures, sounds, effects (sparks, Distance's cheer), Reduce motion, the background (constellation, redstone map, facts line), the game header, the phone layout.
- [docs/internal/advancements.md](docs/internal/advancements.md): the advancements, what earns each, their toasts, icons, the panel and `mwr.advancements`.
- [docs/internal/items.md](docs/internal/items.md): the hotbar of items that blow the page up, breaking a page (and the article) into pieces, blown-up games, Rebuild.
- [docs/internal/persistence.md](docs/internal/persistence.md): `localStorage` keys, history records, `isRecord`, personal bests, the Recent games table.

Each internal doc opens with a "For people:" line linking the pages that draw on it: check those too when you change it.

`README.md`'s feature list and `docs/README.md`'s index change only when a page or a whole feature is added. The Content-Security-Policy is described only in `docs/hosting.md`, so a change to what the game fetches, or from where, updates it. The rules in "Rules that break things quietly" above are repeated, with their reasons, in `docs/how-it-works.md`.
