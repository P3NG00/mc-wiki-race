# Wiki data

For people: [wiki-data.md](../wiki-data.md), [hosting.md](../hosting.md#files-to-serve), [how-it-works.md](../how-it-works.md#the-files).

## The ZIM

`wiki-data.js` is generated from the English Kiwix ZIM of minecraft.wiki, which is linked from [Minecraft Wiki:Offline use](https://minecraft.wiki/w/Minecraft_Wiki:Offline_use) and rebuilt quarterly.

- That dump is the only source: the data is never updated by crawling the wiki.
- Its date (`snapshot`, the ZIM's own) shows in the setup screen's footer and the result's par line.
- Don't edit `wiki-data.js` by hand.
- The ZIM (1.9 GB) is downloaded by hand from `https://download.kiwix.org/zim/other/` into the repo root.
- `.gitignore` keeps it out of git and only its checksum is committed (`sha256sum -c minecraft.wiki_en_all_2026-08.zim.sha256`).

## The tools

The tools in `tools/wikidata/` are Python, run in an ignored venv (`python3 -m venv .venv && .venv/bin/pip install -r tools/wikidata/requirements.txt`), always with `.venv/bin/python -I`.

### extract.py

`extract.py <zim>` scans the ZIM (about a minute) into an ignored snapshot, `tools/wikidata/cache/<name>.jsonl.gz`.

The snapshot holds every page's:

- namespace (from mwoffliner's `ns-<N>` body class, since main-namespace titles can contain colons)
- visible categories
- links.

Links are split into:

- those outside `.navbox` tables and requirement lists
  - with, as `lead`, those of them above the first section heading, a `div.mw-heading` or bare `h2`–`h6`, or the whole page without one, for Top links only
- each navbox's own, as `boxes`
  - a navbox is an outermost navbox table, nested tables included, or, outside one, an advancement's or achievement's list of what it asks for, `div.hlist.searchaux`
  - the page's own title is added to each, since a navbox shows the page it is on as plain text, so every copy of a navbox has the same titles
  - `Snapshot` derives `nav`, their union, from them.

Links are taken from the parser output only, leaving out what the page hides (below), and resolved against the page's own path as a browser would, since a subpage links to `../Diamond`.

Redirects include mwoffliner's forwarding pages for redirects to a section.

#### Requirement lists

A requirement list ("Kill one of these 41 monsters", "Eat each of these foods", the biomes of Adventuring Time: 621 lists on 346 pages of the 2026-08 snapshot, most folded behind [show]) is the same list on every page it concerns, so it counts as a navbox, not as the article's own links.

- Before, it made 39% of mob pairs and 41% of world pairs one click apart on Normal, through a link nobody would think to unfold (17% and 14% after).
- Only those lists: `searchaux` alone also marks hatnotes and message boxes, which are the article's.

#### What a page hides

`drop_hidden` leaves out what nobody sees in the game's article frame, so can't click, and all inside it:

- An element with `style="display:none"`, such as the crafting tables of dye recipes hidden in a `div` on 11 pages (Wool, Bed, Bundle, a guide), hidden on the wiki too.
- But not one the wiki's calculator gadget shows (`.calculatorgadget-enabled`), since the frame runs it (see [rendering.md](rendering.md#calculators)). Most are the options under a breaking-time table, on about 545 block pages of the 2026-08 snapshot: their Efficiency and Haste labels put Haste one click from those blocks (Coarse Dirt to Haste is par 1), and 545 of the 578 articles linking Haste link it only there.
- And what the gadget hides (`.calculatorgadget-fallback`, on 2 pages, none holding a link).

The frame and this rule go together: in v1.0.0 the frame ran no gadget, so Coarse Dirt to Haste was par 1 through a link nobody could see.

### build.py

`build.py <snapshot> [-o folder]` writes `wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js` and `wiki-lead.js` (to the repo root by default) from the snapshot and `config.json`.

`config.json` holds the hand-picked inputs:

- the topics (each a list of categories; an article goes to the first it is in)
- the categories and titles that aren't game content (other editions, list and set index pages)
- the Popular and Deep cuts shares
- the Content families by category (`joke`, `removed`, `education`, `fiction`, `variants`, `mechanics`; the pool leaves their articles out)
- the spin-off namespaces
- the disambiguation categories
- the version categories
- the list pages
- the hubs and the core namespaces the ZIM doesn't hold
- Scavenger's kinds (`kinds`: hand-picked categories, approved 2026-10-21, each with the name the game shows and the members it leaves out).

A kind's members are the pool articles in its category linked well enough to be a target, less its exclusions.
The build stops if an excluded title has left its category or a kind has fewer than `MIN_KIND` (5) members, so a new snapshot gets the list looked at again.

The build also stops:

- if a category the config names (a topic's, a family's, a kind, or a not-content or disambiguation category) is on no page, such as one renamed on the wiki, which would otherwise move its articles without a word
- if a not-content title is no longer an article (gone, or a redirect left by a rename, which would let the page under its new title into the pool).

#### Left-out pages

Every article and every spin-off page is listed but the left-out pages, which are left out altogether:

- the version pages
- the list pages
- the subpages of either.

Version pages are the articles and spin-off pages in a category ending in " versions" or in `version_categories` (Versions, Development version lists), but those with a topic or a family (the removed and unused features lists).
Almost every article links to some version pages from its history, and they link to most of the pool, so with them nearly any pair was two clicks through one.

List pages are the hand-picked `list_titles` (Closed captions, the data values pages, Block sound type, Creative inventory, Instant mining…), tables of game data that many articles link to and that link to much of the pool, left out even from a family.
The build stops if a list page is no longer an article.

The left-out pages' links don't count and the graph doesn't go through them.
`left_out` lists their titles with the redirects to them that a page links to, for the game to kill links to them.
A redirect nothing links to is left out, like a page newer than the snapshot, since the list goes into every article the game shows.

#### Content, topics and tiers

A pool-mode roll may only pick content: not a subpage, a disambiguation page or a page that isn't game content.

Such content gets its topic, or its family or spin-off instead, and the pool's articles get their tiers (`tiers` in `build.py`, which `report.py` also uses):

- Popular is the best-linked share of the pool
- Deep cuts the least-linked share of each topic among articles linked well enough to be a target.

Education is its four exact categories (blocks, items, entities, mobs), since the broad Minecraft Education category also holds Brewing, Charcoal and Dye.

#### Link counts and output

Links are counted per linking page, through redirects:

- an article's count only has links from articles
- a spin-off page's also has links from its own namespace, which are live when that spin-off is on.

The same snapshot always gives the same bytes, one entry per line, so a new snapshot reads as a git diff.

### report.py

`report.py <snapshot>` writes a Markdown report (about 3 minutes):

- pool sizes
- what moved to a Content family
- each family's and spin-off's size and possible targets
- link-count quartiles
- Scavenger's kinds with every member (to read through before shipping a new snapshot)
- dead ends (articles with no route to the most linked one, so a game starting there can't be won)
- the pool designs compared
- hub candidates.

The pool designs come from `config.json`'s `research` section (the Famous and Deep cuts shares to try, and the sweet spot's range of good first clicks), which only the report reads.

Each design is measured on random pairs (`--pairs`, 200 by default, seeded by its name) with all links, without navboxes, and without navboxes or hubs:

- fewest clicks
- good first clicks (links on the start page that begin a shortest route)
- the sweet spot
- how familiar the ends are.

[`RESEARCH.md`](../../tools/wikidata/RESEARCH.md) records what the first run found.

### diff.py

`diff.py <old> <new>` compares two `wiki-data.js` files, such as `<(git show HEAD:wiki-data.js) wiki-data.js`:

- pages added and removed
- pool, family, spin-off and kind members that joined or left
- link counts that moved
- hub, left-out page and namespace changes.

### test.py

`test.py` writes a small ZIM in mwoffliner's shape and checks the other tools against it, in a few seconds.

## The link graph files

The link graph numbers pages by their place in `wiki-data.js`'s `articles` and goes through redirects.

- `wiki-links.js` (`WIKI_LINKS`) lists each page's links outside navboxes: about 310,000 links, 0.90 MB, 0.35 MB gzipped.
- `wiki-navboxes.js` (`WIKI_NAVBOXES`) lists each distinct navbox once (about 1,100) and each page's navboxes: a ninth of the 1.8 million links every page's own list would hold, 0.58 MB, 37 KB gzipped.
  - Normal and Hard only need the first, `wiki-links.js`, so Relaxed's navboxes are a file of their own.
- `wiki-lead.js` (`WIKI_LEAD`) lists each page's links above its first heading, for Top links only: about 65,000, 0.30 MB, 95 KB gzipped, loaded only when that rule is on.

Each entry is page numbers as the gaps between them in base 36, one entry per line.
Every graph file carries the ZIM's sha256, which the game checks against `wiki-data.js`'s.

## Updating the snapshot

To update:

1. Download the new ZIM.
2. Replace the `.sha256` file.
3. Run extract, build, diff and the test, and read the report's Scavenger hunt kinds through, member by member.
4. Then both game suites (`test/run-e2e.sh --offline` and `test/run-e2e.sh`), whose checks lean on the snapshot (named pages, par routes, the kinds and the dailies).
   - The pre-commit hook only runs the offline one (and the docs check), so the live one has to be run by hand, and the hook says so when a commit changes the generated files or the checksum.
   - The offline suite's first checks say which named facts changed, and a changed one means picking another page that has it.
5. Play a few games.
6. Update the docs that name the ZIM or its counts: the ZIM's name here, its name, date and topic counts in [../wiki-data.md](../wiki-data.md), and the par shares in [picking.md](picking.md) and in the comment above `REACHES` in `index.html`.
7. Commit the four generated files, the new checksum, the old checksum's removal, any change to `config.json` and the docs together.
