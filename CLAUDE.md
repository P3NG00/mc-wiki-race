# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A "Wiki Game" (like thewikigame.com) for minecraft.wiki: the player gets a random start and target article and must reach the target by clicking links inside articles, scored on clicks and time. The whole game is one self-contained `index.html` with no build step and no dependencies. All content is fetched live from the minecraft.wiki MediaWiki API at runtime.

## Running

Open `index.html` directly in a browser (`file://` works; no server needed). `python3 -m http.server` also works if a real origin is wanted.

A `#start=<Title>&target=<Title>` URL hash loads a fixed pair (this is what "Copy challenge link" produces), which is handy for testing a specific route.

## Testing

`test/run-e2e.sh [screenshot-dir]` starts headless Firefox with WebDriver BiDi and runs `test/e2e.mjs`. The test opens `index.html` from `file://` and plays a real game against the live wiki: challenge-hash load, rendering, link classification, navigation, Back served from the parse cache, the win condition, Escape handling, random rolls in all four modes, interwiki titles, the same-article guard and image-map links. It needs `firefox` and Node ≥ 22 (for the global `WebSocket`), plus network access. It runs as a single script; to focus on one behavior, edit or comment out checks in `e2e.mjs`. Code inside the article iframe is evaluated in the frame's own browsing context (`frameCtx()`).

Quick syntax check of the inline script:
```sh
python3 -c "import re;h=open('index.html').read();open('/tmp/m.js','w').write(re.findall(r'<script>\n(.*?)</script>\n</body>',h,re.S)[0])" && node --check /tmp/m.js
```

## Architecture (all in `index.html`)

**API access.** Every request goes through `api()`, which always adds `origin=*`. That parameter is mandatory: it is what makes MediaWiki send `Access-Control-Allow-Origin: *` for anonymous requests, and without it the page cannot fetch anything from `file://`. Calls used: `list=categorymembers` (pool modes), `generator=random` (Chaos pool), `list=backlinks` (target reachability), `prop=pageprops|pageimages` (description and thumbnail, redirect resolution), `action=parse` (article HTML). Nothing polls; every request comes from a player action. `pageInfo(title, { backlinks: true })` gets the info and the backlink count in one request.

**Picking articles.** Start and target are rolled in parallel. `rollOne` reads the other card after each await, so the two normally don't land on the same article. If they do, `updatePlay` disables Start.
- *Pool modes* draw from `POOL_CATEGORIES`. `categoryMembers()` follows `cmcontinue` (Blocks has more than 500 pages) and caches per session. It drops subpages (`/`) and disambiguation pages. The modes are being play-tested side by side:
  - *Classic*: a category chosen uniformly, then a member chosen uniformly. Small categories are heavily over-represented (Wither and Ender Dragon about 2.75% each per roll). Only the chosen category is fetched.
  - *Balanced*: categories weighted by the square root of their size.
  - *Even*: uniform over the de-duplicated union of all categories.
  - Balanced and Even fetch every category on first use (about 21 requests in parallel, once per session).
- *Chaos*: one `generator=random` request returns 50 articles with their info. They are filtered by the `CHAOS_REJECT` regex (raw random results are mostly version, changelog and render-history pages) and for disambiguation pages, then one is picked uniformly.
- A target must have at least `MIN_BACKLINKS` incoming main-namespace links, and start ≠ target.

**Rendering articles.** Each article is written into a sandboxed iframe (`sandbox="allow-scripts"`, so it gets an opaque origin) via `srcdoc`. This design is deliberate:
- The wiki's own stylesheets (`WIKI_STYLES`, loaded from `load.php`) apply without leaking into the game UI. They rely on `:root` and `body.wgl-theme-*` selectors, which is why a shadow root doesn't work.
- `<base href="https://minecraft.wiki/">` resolves the parse output's relative `/images/...` URLs, `srcset` values and CSS `url()` values without any rewriting.
- An inline script inside the iframe classifies every `<a>` and image-map `<area>` and intercepts clicks. Same-page `#anchors` scroll locally. Main-namespace `/w/Title#frag` links are sent to the parent with `postMessage({mwg:'nav', title, frag})`. Everything else gets the `mwg-dead` class and does nothing: other namespaces (`NAMESPACES`, including `Tutorial:`, `File:` and `Category:`), red links (`.new`), external links and `?query` links.
- The iframe theme follows `prefers-color-scheme` through the wiki's `wgl-theme-dark` body class.

**Game rules / state** (`game` object):
- `path` records every visit in order and drives the click count (`path.length - 1`).
- `stack` is the navigation stack for Back. Going back is recorded in `path` and counts as a click.
- The win check compares `parse.title`, which is the title after redirects, against the target's resolved title. Following a redirect to the target therefore counts as arriving.
- The clock pauses while an article is loading and rendering, and while the Give-up confirmation is open. It keeps running while the player peeks at the target description. `game.loading` stays set until the frame posts `{mwg:'ready', token}`. That message comes from its own `<script>` after the main frame script, so it is sent only after the render-blocking stylesheets have loaded. A 15 s timeout calls `frameReady` anyway.
- `navToken` throws away responses from navigations that have been superseded, and stale `ready` messages too.
- `parseCache` keeps up to `PARSE_CACHE_MAX` parse results, stored under both the requested and the resolved title, and is cleared on return to setup. Back and "Retry this pair" don't refetch. The API marks parse responses uncacheable, so the browser's HTTP cache can't do this.

**Persistence.** `localStorage` key `mwg.history` holds the last 50 results and is used for the recent-games table and the per-pair personal best. Access goes through the `store` wrapper, which swallows storage errors.
