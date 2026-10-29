# The wiki snapshot

MC Wiki Race plays on the live minecraft.wiki, but picks its articles and works out par from an offline copy of it.
This page is about that copy and the four files built from it: what they hold, the scripts that make them, and how to update them.
If you came here from the header of a generated file, the steps are under [Updating the snapshot](#updating-the-snapshot).
Never edit those files by hand; rebuild them.

## What comes from the snapshot, and what is live

Everything you read in a game is fetched live from the minecraft.wiki API while you play: the articles, their pictures and the cards' descriptions.
Everything the game has to know about the whole wiki at once comes from the snapshot instead: which articles a roll can pick, their topics and link counts, the hubs and the pages left out, the wiki's namespaces, the Scavenger hunt's kinds, and the links between all 13,177 pages that par is worked out on.
The snapshot's date shows in the setup screen's footer ("Rolls and par go by the wiki’s offline copy from …") and in the result's par line ("Going by the wiki’s offline copy from …").
Between snapshots the live wiki moves on, so a page newer than the snapshot can't be rolled, and par can be off where an article has changed.

## Why the data is never crawled

The data comes from one dump of the wiki and nothing else: it is never updated by crawling minecraft.wiki.
That keeps all of it as of one date, from a file anyone can download and check against the committed checksum.
The same dump always builds the same bytes, one entry per line, so a new snapshot reads as an ordinary git diff.

## The ZIM

The dump is the English Kiwix ZIM (Kiwix's single-file offline archive of a website) of minecraft.wiki, linked from [Minecraft Wiki:Offline use](https://minecraft.wiki/w/Minecraft_Wiki:Offline_use) and rebuilt quarterly.
The current one is `minecraft.wiki_en_all_2026-08.zim`, dated 2026-08-21.

- It is about 1.9 GB, downloaded by hand from `https://download.kiwix.org/zim/other/` into the repo root.
- `.gitignore` keeps it out of git; only its checksum, `minecraft.wiki_en_all_2026-08.zim.sha256`, is committed.
- To check a downloaded copy: `sha256sum -c minecraft.wiki_en_all_2026-08.zim.sha256`.
- Every generated file names the ZIM it came from in its header, and the game checks that the graph files carry the same ZIM sha256 as `wiki-data.js`.

Details: [internal/wiki-data.md](internal/wiki-data.md#the-zim)

## The generated files

All four are made by `tools/wikidata/build.py` and sit in the repo root beside `index.html`.

| File | Defines | What it holds | Size (gzipped) | Loaded |
|---|---|---|---|---|
| `wiki-data.js` | `WIKI_DATA` | The snapshot's date and ZIM, the namespaces, topics, Content families and spin-offs, then every page with its link counts, topic, families and tiers, plus the hubs, the left-out pages and the Scavenger hunt's kinds | 1.0 MB (150 KB) | Always, by a script tag |
| `wiki-links.js` | `WIKI_LINKS` | Each page's links outside navboxes, about 310,000 | 0.9 MB (350 KB) | As the page loads, for the background and the cards' checks |
| `wiki-navboxes.js` | `WIKI_NAVBOXES` | Each distinct navbox once (about 1,100), and which navboxes each page carries | 0.6 MB (37 KB) | Only on **Relaxed**, where navboxes are on |
| `wiki-lead.js` | `WIKI_LEAD` | Each page's links above its first heading, about 65,000 | 0.3 MB (95 KB) | Only with **Top links only** |

The three graph files number pages by their place in `wiki-data.js`, and the game refuses one whose sha256 doesn't match, since that would give wrong routes.
All four are JavaScript rather than JSON so that `index.html` can load them from `file://`.

Details: [internal/wiki-data.md](internal/wiki-data.md#the-link-graph-files)

## The tools

The scripts in `tools/wikidata/` are Python. Set up a virtual environment once (the `.venv` folder is ignored by git):

```sh
python3 -m venv .venv && .venv/bin/pip install -r tools/wikidata/requirements.txt
```

Then run each one with `.venv/bin/python -I tools/wikidata/<script>`.

| File | What it does |
|---|---|
| `extract.py <zim>` | Scans the ZIM (about a minute) into an extract, `tools/wikidata/cache/<name>.jsonl.gz`: each page's namespace, categories and links (not those the page hides, which nobody can click, but those the wiki's calculator script shows, which the game runs), split into the article's own, those above its first heading, and each navbox's. It also lists every redirect. The cache is ignored by git. |
| `build.py <extract>` | Writes the four generated files from the extract and `config.json`, to the repo root unless given `-o folder`. It stops with an error when the config no longer fits the wiki (see below). |
| `report.py <extract>` | Writes a Markdown report (about 3 minutes): pool sizes, Content families and spin-offs, link counts, every Scavenger hunt kind with its members, dead ends, the pool designs compared, and hub candidates. |
| `diff.py <old> <new>` | Compares two `wiki-data.js` files: pages added and removed, pool, family, spin-off and kind members that joined or left, link counts that moved, and hub, left-out page and namespace changes. |
| `test.py` | Writes a small ZIM shaped like the real one and checks the other scripts against it, in a few seconds. |
| `common.py` | Loads an extract and the link graph built from it, and reads a `wiki-data.js` back, for the other scripts. |
| `config.json` | The hand-picked inputs to the build (next section). |
| `requirements.txt` | The one dependency, `libzim`, which reads the ZIM. |

A navbox here is a navbox table at the foot of an article, or an advancement's or achievement's list of what it asks for ("Kill one of these 41 monsters"), which is the same list on every page it concerns.

Details: [internal/wiki-data.md](internal/wiki-data.md#the-tools)

## What config.json controls

Everything in `wiki-data.js` comes from the ZIM except what `config.json` picks by hand.

| Key | What it picks |
|---|---|
| `topics` | The pool's five topics, each a list of wiki categories; an article goes to the first topic it is in |
| `not_content_categories`, `not_content_titles` | Pages in game categories that aren't game content: other editions, list and set index pages |
| `popular_share`, `deep_cuts_share` | How much of the pool is Popular (0.3) and of each topic Deep cuts (0.33) |
| `families` | The Content families, by category; their articles leave the pool unless turned on |
| `spinoffs` | The spin-off games' namespaces, each a Spin-offs checkbox |
| `kinds` | The Scavenger hunt's kinds: a category, the name the game shows ("a hostile mob") and the members it leaves out |
| `disambiguation_categories` | Disambiguation pages, which only **Chaos** rolls |
| `version_categories`, `list_titles` | Version pages and list pages, left out of the data altogether |
| `hubs` | The big overview pages whose links are dead in **Hard** |
| `core_namespaces` | The wiki's namespaces the ZIM doesn't hold, so the game knows to disable links into them |
| `research` | Only `report.py` reads it: the other shares its pool designs compare, and the sweet spot's range |

The build stops rather than quietly moving articles when the wiki has changed under the config: a category it names is on no page, a left-out or not-content title is no longer an article, an excluded title has left its kind, a kind has fewer than 5 members, a hub is no longer an article, a spin-off's namespace is gone, or a topic, family, spin-off or tier ends up empty.

Details: [internal/wiki-data.md](internal/wiki-data.md#buildpy)

## Pools, topics and tiers

The pool is the game content, split into five topics by category.
Rolls draw a topic, then an article, and never take the start and target from the same topic.

| Topic | Articles (2026-08) |
|---|---|
| Blocks | 478 |
| Items | 273 |
| Mobs | 93 |
| Biomes & structures | 94 |
| Enchantments & effects | 82 |

The build tags the pool's articles with tiers by how many articles link to them from outside navboxes. **Popular** is the best-linked 30% of the pool, and **Deep cuts** the least-linked third of each topic, among articles linked from at least 5 others, the least a target needs. **Everyday** is the whole pool, and **Chaos** every article in the data, with the pages of each spin-off that is on.

Articles in a Content family (**April Fools**, **Removed & unused**, **Education**, **Books & comics**, **Variants**, **Mechanics**) and spin-off pages (Dungeons, Dungeons II, Legends, Earth, Story Mode, Movie) are out of the pool until their checkbox is on.
Version pages and a few list pages (Closed captions, the data values pages, Creative inventory…) are left out of the data altogether, since almost every article links to them and they link to most of the pool, which would put nearly any pair two clicks apart.

Details: [internal/picking.md](internal/picking.md#pools)

## Updating the snapshot

When Kiwix publishes a newer ZIM:

1. Download it from `https://download.kiwix.org/zim/other/` into the repo root.
2. Replace the old `.sha256` file with the new ZIM's: `sha256sum minecraft.wiki_en_all_<date>.zim > minecraft.wiki_en_all_<date>.zim.sha256`, then delete the old one.
3. Extract it: `.venv/bin/python -I tools/wikidata/extract.py minecraft.wiki_en_all_<date>.zim`.
4. Build: `.venv/bin/python -I tools/wikidata/build.py tools/wikidata/cache/minecraft.wiki_en_all_<date>.jsonl.gz`. If it stops, fix `config.json` as its message says and build again.
5. See what changed: `.venv/bin/python -I tools/wikidata/diff.py <(git show HEAD:wiki-data.js) wiki-data.js`.
6. Run the scripts' own tests: `.venv/bin/python -I tools/wikidata/test.py`.
7. Write the report and read its Scavenger hunt kinds through, member by member: `.venv/bin/python -I tools/wikidata/report.py tools/wikidata/cache/minecraft.wiki_en_all_<date>.jsonl.gz -o /tmp/report.md` (about 3 minutes).
8. Run both game suites, `test/run-e2e.sh --offline` and then `test/run-e2e.sh`. Their checks lean on the snapshot (named pages, par routes, the kinds and the dailies). If the offline suite's first checks say a named fact changed, pick another page that has it.
9. Play a few games.
10. Update the docs that name the ZIM or its counts: the ZIM's name, date and topic counts on this page, the ZIM's name in [internal/wiki-data.md](internal/wiki-data.md), and the par shares in [internal/picking.md](internal/picking.md) and in the comment above `REACHES` in `index.html`.
11. Commit the four generated files, the new checksum, the old checksum's removal, any change to `config.json` and the docs together.

The pre-commit hook runs the docs check and the offline suite, not the live one. When a commit changes the generated files or the checksum, it reminds you to run the live suite by hand.

Details: [internal/wiki-data.md](internal/wiki-data.md#updating-the-snapshot)

## RESEARCH.md

[`tools/wikidata/RESEARCH.md`](../tools/wikidata/RESEARCH.md) records the testing behind the pools, done in October 2026 on the 2026-08 snapshot before they were decided.
It measures pool designs on random pairs with all links, without navboxes and without hubs too, and sets out the decisions that came of it: the four pools, drawing a topic first, the pages left out, the difficulties, and **Top links only**.
`report.py` has moved on since, so a new snapshot's report reads alongside it rather than matching it line for line.
