# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A "Wiki Game" (like thewikigame.com) for minecraft.wiki: the player gets a random start and target article and must reach the target by clicking links inside articles, scored on clicks and time. The whole game is one self-contained `index.html` with no build step and no dependencies. All content is fetched live from the minecraft.wiki MediaWiki API at runtime.

## Running

Open `index.html` directly in a browser (`file://` works; no server needed). `python3 -m http.server` also works if a real origin is wanted.

A `#start=<Title>&target=<Title>` URL hash loads a fixed pair (this is what "Copy challenge link" produces), which is handy for testing a specific route. An optional `&rules=noback` (comma-separated rule keys) sets the rule checkboxes; it is applied even if the pair fails to load.

## Testing

`test/run-e2e.sh [screenshot-dir]` starts headless Firefox with WebDriver BiDi and runs `test/e2e.mjs`. The test opens `index.html` from `file://` and plays a real game against the live wiki: challenge-hash load, rendering, link classification, navigation, Back served from the parse cache, switching the article's theme in place (also mid-load), the win condition, Escape handling, the No Back rule (in the challenge link and the result, and kept out of the personal best of games without it), the No hubs rule (hub links and redirects dead, a hub target live), the Blind target rule, the Six clicks rule (lost on the sixth click, recorded as `outOfClicks`), random rolls in all four modes, difficulty selection (with `candidate` stubbed), interwiki titles, the same-article guard, image-map links and a host-page theme (injected with a BiDi preload script) becoming the default. It needs `firefox` and Node ≥ 22 (for the global `WebSocket`), plus network access. It runs as a single script; to focus on one behavior, edit or comment out checks in `e2e.mjs`. Code inside the article iframe is evaluated in the frame's own browsing context (`frameCtx()`).

Quick syntax check of the inline script:
```sh
python3 -c "import re;h=open('index.html').read();open('/tmp/m.js','w').write(re.findall(r'<script>\n(.*?)</script>\n</body>',h,re.S)[0])" && node --check /tmp/m.js
```

## Architecture (all in `index.html`)

**API access.** Every request goes through `api()`, which always adds `origin=*`. That parameter is mandatory: it is what makes MediaWiki send `Access-Control-Allow-Origin: *` for anonymous requests, and without it the page cannot fetch anything from `file://`. Calls used: `list=categorymembers` (pool modes), `generator=random` (Chaos pool), `list=backlinks` (target reachability), `prop=pageprops|pageimages` (description and thumbnail, redirect resolution), `prop=redirects` (No hubs), `action=parse` (article HTML). Nothing polls; every request comes from a player action. `pageInfo(title, { backlinks: true })` gets the info and the backlink count in one request.

**Picking articles.** Start and target are rolled in parallel. `rollOne` reads the other card after each await, so the two normally don't land on the same article. If they do, `updatePlay` disables Start.
- *Pool modes* draw from `POOL_CATEGORIES`. `categoryMembers()` follows `cmcontinue` (Blocks has more than 500 pages) and caches per session. It drops subpages (`/`) and disambiguation pages. The modes are being play-tested side by side:
  - *Classic*: a category chosen uniformly, then a member chosen uniformly. Small categories are heavily over-represented (Wither and Ender Dragon about 2.75% each per roll). Only the chosen category is fetched.
  - *Balanced*: categories weighted by the square root of their size.
  - *Even*: uniform over the de-duplicated union of all categories.
  - Balanced and Even fetch every category on first use (about 21 requests in parallel, once per session).
- *Chaos*: one `generator=random` request returns 50 articles with their info. They are filtered by the `CHAOS_REJECT` regex (raw random results are mostly version, changelog and render-history pages) and for disambiguation pages, then queued in `chaosQueue` and drawn uniformly without replacement, so later rolls and rejected targets usually need no new request. Concurrent refills share one request.
- *Target difficulty* (`DIFFICULTY`, the Target row) is relative. Any takes one candidate. Easy and Hard roll `DIFFICULTY_SAMPLES` (5) candidates in parallel and keep the one with the most or fewest incoming main-namespace links (`better`). Fixed thresholds were tried and dropped: navboxes link most items and mobs from 500+ articles, while no biome reaches 500, so a fixed band is empty for some pools. Counts come from `list=backlinks`: `bllimit` is `MIN_BACKLINKS` for Any and 500, the anonymous cap, for Easy and Hard. Difficulty is not recorded with results or carried in challenge links. Changing it rerolls only the target, and custom targets skip it.
- A target must have at least `MIN_BACKLINKS` incoming links, and start ≠ target.

**Rendering articles.** Each article is written into a sandboxed iframe (`sandbox="allow-scripts"`, so it gets an opaque origin) via `srcdoc`. This design is deliberate:
- The wiki's own stylesheets (`WIKI_STYLES`, loaded from `load.php`) apply without leaking into the game UI. They rely on `:root` and `body.wgl-theme-*` selectors, which is why a shadow root doesn't work.
- `<base href="https://minecraft.wiki/">` resolves the parse output's relative `/images/...` URLs, `srcset` values and CSS `url()` values without any rewriting.
- An inline script inside the iframe classifies every `<a>` and image-map `<area>` and intercepts clicks. Same-page `#anchors` scroll locally. Main-namespace `/w/Title#frag` links are sent to the parent with `postMessage({mwg:'nav', title, frag})`. Everything else gets the `mwg-dead` class and does nothing: other namespaces (`NAMESPACES`, including `Tutorial:`, `File:` and `Category:`), red links (`.new`), external links and `?query` links. Titles passed in `blocked` (No hubs) are dead too.
- The article is drawn in the wiki's light or dark theme (`wgl-theme-light`/`wgl-theme-dark` on its `<body>`), matching the game theme (see Themes). `wgl.theme.dark` is always in `WIKI_STYLES` (about 4 KB gzipped): apart from a few rules that change nothing visible here, it is scoped to the dark body class, so switching is a swap of `WGL_THEME_CLASSES`, which the parent asks for with `postMessage({mwg:'theme', dark})` without reloading the article. The parent also sends it when the frame reports `ready`, which catches a theme change made while the article was loading.

**Game rules / state** (`game` object):
- *Rules* are optional toggles defined in `RULES` and rendered as checkboxes under the modes. `startGame` copies the checked keys into `game.rules` (sorted in `RULES` order), and everything during play and in `finish` reads that, never the checkboxes. Changing a rule doesn't reroll. *No Back* hides the Back button and is also enforced in `goBack()`. *No hubs* makes links to the `HUBS` pages dead: `hubTitles()` maps every hub and its redirects (about 600 titles, fetched with `prop=redirects` the first time a No hubs game loads an article, alongside the parse) to the hub, and `navigate` passes all of them except the target's hub to `renderArticle` as `blocked`. Going Back to a hub start is allowed. *Blind target* hides the target's picture and description: on the setup card (`renderCard` reads the checkbox, and changing any rule re-renders the target card), in the HUD and through the peek button, which is hidden. *Six clicks* shows `clicks/CLICK_LIMIT` in the HUD, and `navigate` ends the game as lost (`finish(false, true)`) when an arrival that isn't the target uses up the last click.
- `path` records every visit in order and drives the click count (`path.length - 1`).
- `stack` is the navigation stack for Back. Going back is recorded in `path` and counts as a click.
- The win check compares `parse.title`, which is the title after redirects, against the target's resolved title. Following a redirect to the target therefore counts as arriving.
- The clock pauses while an article is loading and rendering, and while the Give-up confirmation is open. It keeps running while the player peeks at the target description. `game.loading` stays set until the frame posts `{mwg:'ready', token}`. That message comes from its own `<script>` after the main frame script, so it is sent only after the render-blocking stylesheets have loaded. A 15 s timeout calls `frameReady` anyway.
- `navToken` throws away responses from navigations that have been superseded, and stale `ready` messages too.
- `parseCache` keeps up to `PARSE_CACHE_MAX` parse results, stored under both the requested and the resolved title, and is cleared on return to setup. Back and "Retry this pair" don't refetch. The API marks parse responses uncacheable, so the browser's HTTP cache can't do this.

**Themes.** A theme is the set of CSS variables on `:root` (colours, `--font`, `--radius*`) plus `color-scheme`, which also decides the article's wiki theme (`themeIsDark()` reads the computed `color-scheme`, falling back to `prefers-color-scheme` when it is ambiguous). Built in: Auto (no `data-theme` attribute, follows the OS), Light and Dark (`data-theme="light"`/`"dark"`). Auto's dark rule is `:root:not([data-theme])`, so no other theme ever picks up the dark variables. A page serving the game can add themes without editing this file: a `<link rel="stylesheet">` or `<style>` in `<head>` with `data-mwg-theme="Name"` that defines `:root[data-theme="Name"]`, plus `data-mwg-default` to make it the default. The names `auto`, `light` and `dark` belong to the built-ins (a host theme named `auto` could never apply). The `#theme-boot` script at the top of `<body>` runs before first paint: it builds `THEMES` (used by the main script) from those elements and applies the saved theme if it still exists, else the default, else Auto. It is not `<script>` followed by a newline on purpose, so the syntax-check regex still finds the main script. The picker on the setup screen calls `setTheme()`.

**Persistence.** `localStorage` key `mwg.history` holds the last 50 results and is used for the recent-games table and the per-pair personal best. A record lost to Six clicks has `outOfClicks: true`. Each record has `rules` (an array of rule keys; older records lack it and count as no rules), and the personal best only compares records with the same rules (`sameRules`). `mwg.theme` holds the chosen theme. Access goes through the `store` wrapper, which swallows storage errors.
