# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MC Wiki Race, a wiki race (like thewikigame.com) through minecraft.wiki: the player gets a random start and target article and must reach the target by clicking links inside articles, scored on clicks and time. The whole game is one `index.html` with no build step and no dependencies, plus `wiki-data.js`, which it loads with a script tag, and the link graph files `wiki-links.js` and `wiki-navboxes.js`, which it loads when a result works out par, all generated from an offline copy of the wiki (see [docs/wiki-data.md](docs/wiki-data.md)). Beside them are only static assets: the icon (`favicon.ico` at 16/32/48 px, `apple-touch-icon.png` at 180 px) and the 1200×630 link-preview image `og-image.png`. The name follows Mojang's usage guidelines, which forbid "Minecraft" as the first word or dominant part of a fan project's name. Its home is https://mcwikirace.com/ (BryantF.xyz/games/mc-wiki-race forwards there), and `<head>` has a meta description, Open Graph tags and a `canonical` link pointing there, so every copy of the page names that address as the original. The footer says who runs the game (BryantF.xyz, linked) and how to reach them, which the guidelines also ask for. Articles, pictures and descriptions are fetched live from the minecraft.wiki MediaWiki API at runtime, while what rolls pick from (the pool, link counts, hub redirects, namespaces) comes from `wiki-data.js`.

## Running

Open `index.html` directly in a browser (`file://` works; no server needed). `python3 -m http.server` also works if a real origin is wanted.

## Testing

`test/run-e2e.sh [--offline] [screenshot-dir]` runs the suites in headless Firefox with WebDriver BiDi: `test/e2e.mjs` plays real games against the live wiki, and with `--offline`, `test/offline.mjs` checks the game's own logic in just over a minute with every request answered by the test. They need `firefox` and Node ≥ 22. The offline suite runs before every commit as a git pre-commit hook (`git config core.hooksPath .githooks` once per clone); the live suite runs only by hand, before a release and after a snapshot update. [docs/testing.md](docs/testing.md) has what each suite checks, random play and its seed, and what to check by hand before a release.

Quick syntax check of the inline script, which also fails on an HTML comment opener in it (see [docs/rendering.md](docs/rendering.md)):
```sh
python3 -c "import re;h=open('index.html').read();s=re.findall(r'<script>\n(.*?)</script>\n</body>',h,re.S)[0];assert '<!--' not in s;open('/tmp/m.js','w').write(s)" && node --check /tmp/m.js
```

## Rules that break things quietly

- Every API request goes through `api()`, which adds `origin=*`: without it MediaWiki sends no CORS header and the page fetches nothing from `file://`.
- The HTML comment opener must not appear literally anywhere in `index.html`'s scripts, comments included, or the page silently doesn't run; values written into the article frame's script go in as JSON with `<` escaped.
- During play and in `finish`, read `game.rules`, never the checkboxes.
- Everything in a navigation that can fail has to fail inside `navigate`'s `try`, or the game stays loading with Give up disabled.
- `wiki-data.js`, `wiki-links.js` and `wiki-navboxes.js` are generated from the Kiwix ZIM only: never edit them by hand, and never update the data by crawling the wiki.

## Docs

Read the one that covers what you are changing; keep it up to date with the code. The architecture is all in `index.html`.

- [docs/setup-screen.md](docs/setup-screen.md): the setup screen top to bottom, the footer and the licence credit during play.
- [docs/url-hash.md](docs/url-hash.md): the URL hash keys, sealed challenge links (`g=`), `daily=`.
- [docs/testing.md](docs/testing.md): everything the live and offline suites check, random play, the pre-commit hook, the manual release checks.
- [docs/wiki-data.md](docs/wiki-data.md): the ZIM, the `tools/wikidata/` scripts and `config.json`, the link graph files, how to update the snapshot.
- [docs/picking.md](docs/picking.md): rolls, pools, Content and spin-offs, target topic and par, joining the web of links, the daily.
- [docs/par.md](docs/par.md): par and golf scores, route searches, the result window and Share.
- [docs/rendering.md](docs/rendering.md): `api()`, the sandboxed article iframe and its script (link classification, animator, tabber, blueprints, the article theme).
- [docs/rules.md](docs/rules.md): the `game` object, difficulty, every game and extra rule, leaving the page, the clock, `navToken`, the parse cache.
- [docs/ui.md](docs/ui.md): themes (host themes too), pictures, sounds, the game header, the phone layout.
- [docs/persistence.md](docs/persistence.md): `localStorage` keys, history records, `isRecord`, personal bests, the Recent games table.
