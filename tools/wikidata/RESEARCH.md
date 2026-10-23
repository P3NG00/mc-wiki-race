# Pool research

Findings from testing pool designs on the link graph of the 2026-08-21 snapshot (`minecraft.wiki_en_all_2026-08.zim`), done in October 2026 before deciding the release pools. Everything was measured offline on the snapshot. The numbers come from `report.py` as of commit 02ebb25 (its Dead ends, Pool definitions and Pool designs sections) with 200 random pairs per design, which that version reproduces exactly. The report has since moved on to the pools as built (Everyday, Popular, Deep cuts, under those names), so a new snapshot's report reads alongside these findings rather than matching them line for line. Two findings come from earlier exploratory runs that the report doesn't repeat; they are marked.

## How pairs were measured

- **Clicks:** the fewest clicks from start to target (1, 2, 3, 4+, or none when there is no route).
- **Good first clicks:** how many links on the start page begin a shortest route (median). Many means almost any sensible click wins; one means a single hidden path.
- **Only one:** the share of pairs with exactly one good first click.
- **Sweet spot:** the share of pairs that take 2+ clicks and have 2–15 good first clicks: a real choice, neither trivial nor a single hidden path. It's a rough measure of "fun", not a ground truth.
- **Ends:** the median number of articles linking to the start and to the target from outside navboxes. This is how familiar they are; link counts track fame well (see Famous).
- **Graphs:** all links (the default game), no navboxes (the No navboxes rule), and no navboxes with the hubs removed (both rules).

## Findings

1. **Navboxes decide how hard a game is.**
   - With them, pool pairs have 19–51 good first clicks and only 2–31% are in the sweet spot.
   - Without them, Everyday and Deep cuts pairs have 3–7 good first clicks and 68–79% are in the sweet spot.
   - Removing hubs as well pushes 13–46% of those pairs to 3 clicks.
   - No pool definition comes close to that effect.
2. **Same-topic pairs are trivial with navboxes** (exploratory run). 70–87% were one click apart, with a single good first click: the navbox lists the whole family. Without navboxes it was still 17–53%. Different topics cut one-click pairs to 2–20% in every pool.
3. **Today's default game is one click a third of the time.** The pool with any pair and navboxes on is one click in 32% of pairs.
4. **Famous** (the best-linked share of Everyday):
   - **Sizes and edges:**
     - 20% is 206 articles, from 255 links (Glow Squid, Looting, Rail).
     - 25% is 257, from 227 (Sponge, Vex, Hanging Sign, Phantom).
     - 30% is 308, from 208 (Andesite, Deep Dark, Sculk Catalyst).
     - In the exploratory run even a 40% cut (Blue Dye, Steak, Ocean Monument) was still things players know.
   - **With navboxes, Famous pairs link each other heavily:** 17–20% one click across topics, with 40–51 good first clicks.
   - **It's the relaxed pool, best played without navboxes:** 15–21 good first clicks and 22–38% in the sweet spot, or 31–38% with hubs removed too.
   - **Its topics are uneven** (at 25%: blocks 105, mobs 64, items 48, world 32, magic 8), so drawing topic first matters.
5. **Deep cuts** must be taken per topic, without variants.
   - Taken from the whole pool (exploratory run), the least-linked articles were stairs, slabs and walls, with only 4–6 mobs: obscure but dull.
   - Taken per topic (the least-linked third or half of each topic) it holds Camel Husk, Piglin Brute, Igloo, Ruined Portal, Curse of Binding and Feather Falling. That's 339 articles at 33% and 513 at 50%, balanced across topics.
   - It plays hardest of the pools: without navboxes 12–14% of different-topic pairs need 3 clicks, and without hubs as well, 30–46% of its pairs do.
6. **Non-content pages are in today's pool:**
   - 15 pages: Minecraft 4k pages (8), China Edition (Micro Block, Mod (China Edition)), set index pages (Interactable blocks, Utility, Plant, Redstone, Uncooked food) and MCRedstoneSim schematics.
   - The categories `Minecraft 4k`, `China Edition`, `Set index pages` and `Pages using MCRS diagrams` mark them.
   - Chaos keeps them, since it is every page.
   - A few more remain that no category marks yet: Removed blocks and Drinks (list pages), Block variant, Farm.
7. **Variants are 208 of the pool** (about 17%): Slabs 43, Stairs 40, Walls 26, Pottery sherds 24, Music discs 23, Dyes 21, Smithing templates 20, Banner patterns 11. Leaving them out raises the pool's median familiarity from 118 to 138 links. Flowers were kept as real variety.
8. **Gameplay** (126 articles, not in any topic) is mostly abstract mechanics with the fewest links (median 68): Key codes, Narrator, Splitscreen, Block offset.
9. **Chaos:**
   - Starts are obscure (a median of 4–5 links). Half of all pairs need 3+ clicks with all links, and 69–73% without navboxes.
   - 2–4% of pairs have no route: 371 articles (2.7%, almost all subpages) can't reach the rest of the wiki, so a game starting there can't be won.
   - 1,019 articles (7.5%) can't be reached at all. Targets need 5+ links from outside navboxes, which keeps nearly all of those out.
   - Chaos stays every page by decision.
10. **The snapshot ages between quarterly builds** (live drift not measured yet): the game shows live articles, but rolls, link counts and hub redirects are as of the snapshot.

## Results

Different-topic pairs unless noted. "1" and "3+" are shares of pairs by fewest clicks; "good" is the median number of good first clicks; "sweet" is the sweet spot.

| Design | All links: 1 / good / sweet | No navboxes: 1 / 3+ / good / sweet | No navboxes, no hubs: 3+ / sweet | Ends |
|---|---|---|---|---|
| Pool today, any pair | 32% / 19 / 16% | 2% / 2% / 8 / 76% | 19% / 57% | 121/115 |
| Pool today | 7% / 28 / 22% | 2% / 6% / 6 / 72% | 18% / 62% | 134/143 |
| Everyday (cleaned, no variants) | 10% / 28 / 20% | 5% / 6% / 6 / 72% | 13% / 58% | 181/156 |
| Famous 20% | 20% / 51 / 6% | 12% / 0% / 21 / 22% | 0% / 31% | 370/334 |
| Famous 25% | 19% / 44 / 4% | 19% / 0% / 17 / 26% | 0% / 38% | 335/325 |
| Famous 30% | 17% / 40 / 8% | 13% / 0% / 15 / 38% | 2% / 38% | 298/306 |
| Deep cuts 33% per topic | 4% / 24 / 26% | 1% / 14% / 3 / 70% | 37% / 48% | 67/67 |
| Deep cuts 50% per topic | 2% / 24 / 31% | 2% / 12% / 4 / 70% | 37% / 50% | 94/88 |
| Variants only | 4% / 25 / 45% | 0% / 1% / 3 / 96% | 60% / 29% | 53/54 |
| Chaos (every article, any pair) | 4% / 6 / 54% | 2% / 73% / 3 / 64% | 69% / 55% | 4/21 |

## Decisions

Taken in October 2026 from these findings:
- **Pools:** Popular (the best-linked 30% of Everyday; "Famous" in the research), Everyday (the cleaned pool, the default), Deep cuts (the least-linked third of each topic) and Chaos. They replaced Classic, Balanced and Even, and Target difficulty (Easy/Any/Hard).
- **Topics:** rolls draw a topic, then an article, and never take the start and target from the same topic.
- **Pages left out:** the non-content pages leave the pool, plus three list pages no category marks (Block variant, Drinks, Removed blocks). Variants and Gameplay become the Content toggles Variants and Mechanics, off by default.
- **Difficulty:** No navboxes and No hubs became a difficulty setting (Relaxed with navboxes, Normal without, Hard without navboxes or hubs), with Normal as the default. Every daily plays on Normal plus one rule, No hubs making it Hard.

## Top links only (lead links)

Measured in October 2026 on the same snapshot, with a one-off script over the ZIM (not kept): each page's links above its first section heading, three ways, against the Normal graph. Pairs as in the game: a start from the pool and a target from another topic linked from at least 5 articles outside navboxes, 600 per pool and difficulty.

- **What the top holds:** of pool articles' links above the first heading, 62% are in the infobox, 31% in the opening text and 7% in hatnotes. A median pool article has 13 such links (71 outside navboxes), 4 in its text.
- **Text alone doesn't play:** with only the opening paragraphs and lists, 35% of Everyday pairs have no route in Normal and 46% in Hard, and most of the rest take 6 clicks or more; the first paragraph alone is worse (43% and 55%). 696 of the 1,019 targets are linked from the text of fewer than 5 articles.
- **The whole top does:** every pool start joins the web of links, and 905 targets can be reached in Normal (894 in Hard); the other 114 or so are linked from no page's top that leads anywhere. Among the pairs rolls allow, par in Normal is 2 for 2%, 3 for 18%, 4 for 36%, 5 for 29%, 6 for 10% and 7 or more for 4% (Hard: 3%, 12%, 29%, 34%, 14%, 8%), against Normal's 85% at par 2 with every link outside navboxes. The median good first clicks fall to 2 (1 in Hard). Popular plays shorter (mostly 3 to 4), Deep cuts longer.
- **Routes go through infobox rows:** the pages most often on a shortest route are those infoboxes link to, such as Renewable resource, Explosion (blast resistance), Durability, Breaking, Entity and Sulfur Cube (in 152 block infoboxes), each on 5–15% of routes.
- **Hatnotes barely matter:** leaving them out keeps the numbers within a few points and reaches 849 targets.

Decided: the rule keeps the whole top (opening text, infobox, hatnotes, the whole page when it has no heading, never a navbox), named Top links only, with Six clicks off under it since par is often more than six, and not a daily rule until it has been played.

## Open questions

- How fast the live wiki drifts from the snapshot, measured with a few API requests.
