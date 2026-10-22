# MC Wiki Race

A wiki race (like [The Wiki Game](https://www.thewikigame.com/)) through [minecraft.wiki](https://minecraft.wiki): you get a random start article and a target article, and have to reach the target by clicking only the links inside articles. Fewest clicks and fastest time win.

Play it at **[mcwikirace.com](https://mcwikirace.com/)**.

The whole game is one `index.html`, with no build step and no dependencies. Next to it are `wiki-data.js`, what the game knows about the wiki (which articles it can roll, how well linked they are), and `wiki-links.js` and `wiki-navboxes.js`, the links between its pages, which the game uses to work out par, Distance and Target par, all generated from the wiki's offline copy by `tools/wikidata/`, the icon (`favicon.ico`, `apple-touch-icon.png`) and the link-preview image (`og-image.png`). Articles are fetched live from the minecraft.wiki API.

## Playing

Open `index.html` in a browser. Opening it straight from disk (`file://`) works fine.

The setup screen puts playing first. Top to bottom:

- **📅 Daily challenge** shows today's game. **Play the daily** loads today's pair, which is the same for everyone on the same date. It always plays on Normal with one extra rule of the day (No Back, Blind target, a relay, Six clicks, a round trip, Exact clicks, a scavenger hunt, or Hard instead), it can always be done (on a Six clicks day in 4 clicks or fewer), and the result says it was the daily. `index.html#daily` opens it directly.
- **Your game** says what's set.
- **The cards:** **Reroll** any of them, or type your own article. **Par** is the fewest clicks the game can be done in, with the same difficulty, checkpoints and spin-offs. It shows beside Start and in the game's header, and the result scores your win against it as golf does, with what each name means (Par, even with par; Bogey, 1 over par; Birdie, 1 under…), and shows your path beside one route that takes that many, with how many clicks each page was from the target and how many of your clicks got no closer, so you can see where you lost ground. Share's path has the same counts. It goes by the wiki's offline copy, so the result names that copy's date.

Under the cards are the steps for changing the game:

- **1 · Choose a game.** One of these, with its own options in the strip under the tiles:
  - **Race:** from the start to the target, the classic.
  - **Relay:** one to three checkpoints to visit on the way, in order. Reaching the target before them doesn't count.
  - **Scavenger hunt:** instead of a target, find three things in any order: **3 kinds** (one of each, like a mob found in the Nether, an enchantment and a potion) or **3 articles**. A kind is a wiki category, hand-picked, with surprising members left out; the result says what each find was.
  - **Exact clicks:** reach the target in exactly par + a few clicks, never on the same page twice, so there's no Back. **Count** picks how many over par: 1 to 5 (2 at first), or **Random** for one rolled with the cards. Getting there sooner loses, so you have to find a detour, and so does running out.
- **2 · Extra rules**, in any mix:
  - **Round trip:** once you reach the target (or a scavenger hunt's last find), head back to the start. Every page of the way there is a dead link on the way back, and Back can't walk it backwards. A relay's checkpoints go around the loop, some on the way there and some on the way back (a single one on either). Not with Exact clicks, which never visits a page twice, while a round trip ends where it began.
  - **No Back:** the Back button is gone, so every click is final.
  - **Blind target:** the target isn't even picked until you press Start (Copy challenge link picks it unseen, and the daily keeps it hidden), so the setup screen shows no target, par or Exact clicks count, and there's no Swap. Once the game starts you only get its name, with no picture or description. In a relay each checkpoint, and the target, only shows once you reach the stop before it, so you don't know where it ends; a scavenger hunt's kinds or articles all show when you start.
  - **Six clicks:** reach the target in 6 clicks or fewer, Back included, or the game is over. Not with Exact clicks, which has its own count.
  - **Distance:** always shows how many clicks the target is from your page, by the shortest route.
- **3 · Articles and difficulty:**
  - **Articles** decide which come up. The start and target are always from different topics (blocks, items, mobs, biomes & structures, enchantments & effects), since two things from the same topic are usually one click apart. **Popular** is the best-known game content, the 30% most linked across the wiki; **Everyday** all of it, each topic equally likely; **Deep cuts** the least-known third of each topic; **Chaos** any article on the wiki.
  - **Difficulty** decides which links you can use. **Relaxed:** everything, including the big link tables at the bottom of articles (navboxes), so almost any sensible click gets you closer. **Normal** (the default): the navboxes are hidden, so you find your way through the article itself. **Hard:** no navboxes, and links to big overview pages like Block, Item, Mob, Crafting or Java Edition are dead too, unless that page is the target. In every difficulty, links to version pages (release notes, version histories) and to big data lists (Closed captions, the data values pages, Creative inventory and the like) are dead: they link to almost everything, so they'd make every game two clicks.
  - **Target** topic (Blocks, Items, Mobs, Biomes & structures, Enchantments & effects) picks the target from that part of the wiki, in any pool, and the start comes from another topic. **Target par** picks exactly how far it is: **Par 1** (linked straight from the start) up to **Par 4**, or **Par 5+**. Most pairs are par 2; par 4 and 5 mostly need Content or spin-offs on. Changing either rolls a new pair, but keeps a start you typed yourself. If no start has a target at that par with your articles, topic and difficulty, the game rolls at the nearest par that has one and says why, and that option is greyed out until you change them. A start you typed with none gets the nearest par it has, and rerolling only the start keeps the target, with a start at that par from it, or the nearest. A target you type yourself skips them.
  - **Content** adds more to the articles: **April Fools** jokes, **Removed & unused** features, **Education** blocks, items and mobs, **Books & comics** objects, **Variants** (stairs, slabs, walls, dyes and the like) and **Mechanics** (breeding, brewing, game rules). Chaos has them all already. **Spin-offs** (Dungeons, Dungeons II, Legends, Earth, Story Mode, Movie) add the wiki's pages about other Minecraft games and make links to them work; **All** switches every one on or off.
- **In a game** the header names the game and its extra rules, and shows your route as a row of stops: done (✓), the one you're heading for, and those still ahead, or a Scavenger hunt's checklist. On a long route the stops done shrink to a ✓; click one to see them all. **?** shows what the current objective is, and with Distance on, the clicks to go are beside the game's name.
- **Back** returns to the previous article and counts as a click. The clock pauses while an article loads.
- **Copy challenge link** shares the exact pair you're looking at, plus any checkpoints, the game (with Exact clicks's count), its rules and the difficulty, as a sealed link (`index.html#g=…`) that doesn't give the articles away at a glance. A link made by hand works too: `index.html#start=<Title>&target=<Title>&via=<Title>&rules=nonav,checkpoint` (`nonav` is Normal, `nonav,nohubs` Hard, neither Relaxed).
- **Sound**, **Timer** and **Theme** (top right of the setup screen): Sound turns the game's sounds on or off, as the speaker button in the game header does. With Timer off there's no clock, and results record clicks alone, for a relaxed game. Theme's Auto follows your system's light or dark setting, and articles switch to the wiki's own dark theme to match.
- Your last 50 games, your personal best for each pair and your Sound, Timer and Theme settings are kept in the browser. Personal bests are kept separately for each combination of rules, and for each Exact clicks count. Each result also notes the target topic it was rolled with and the Content that was on.

## Hosting

Serve `index.html` as a static file, with `wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js`, `favicon.ico`, `apple-touch-icon.png` and `og-image.png` next to it. Without `wiki-data.js` the game doesn't start, and without the other two it can't work out par, so par, Distance and Target par don't work. All three change together with each new copy of the wiki, so serve them without long caching. Its `canonical` link and Open Graph tags point at https://mcwikirace.com/, so search engines treat other copies as duplicates of that one. To add a theme without editing it, put a stylesheet in its `<head>` marked with `data-mwr-theme`. It shows up in the theme picker, and `data-mwr-default` makes it the default:

```html
<link rel="stylesheet" href="my-theme.css" data-mwr-theme="My site" data-mwr-default>
```

```css
:root[data-theme="My site"] {
  --bg: #101010; --panel: #202020; --ink: #fff; --muted: #aaa; --line: #333;
  --accent: #fff; --accent-ink: #000; --accent-soft: #333; --target: #f87;
  --shadow: none; --font: monospace; --radius: 0; --radius-lg: 0; --radius-pill: 0;
  color-scheme: dark;   /* the article uses the wiki's dark theme */
}
```

Any variable you leave out keeps its light-theme value, and the names `auto`, `light` and `dark` are taken by the built-in themes. If the server sends a Content-Security-Policy, it has to allow `https://minecraft.wiki` in `connect-src`, `img-src`, `style-src`, `font-src` and `base-uri`, and allow inline scripts and styles. The article frame inherits the page's policy.

## Dev options

### End-to-end test

```sh
test/run-e2e.sh [screenshot-dir]
```

Plays a real game in headless Firefox against the live wiki. Needs `firefox`, Node 22 or newer, and network access.

```sh
test/run-e2e.sh --offline
```

Checks the game's own logic (rolls, the daily, Content, difficulty, which links are live, every rule) in just over a minute, with every request to the wiki answered by the test, so it works without network access or while the wiki is down.

### Pre-commit hook

```sh
git config core.hooksPath .githooks
```

Run this once per clone. Every commit then runs the offline test first and stops if a check fails (`git commit --no-verify` skips it). The live test isn't in the hook: run it by hand for changes to rendering, the article frame, API handling or layout, before a release, and always after updating the wiki snapshot (`wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js`), which the hook reminds you of.

See `CLAUDE.md` and `docs/` for how the game works internally.

## License

[MIT](LICENSE). Article content shown in the game comes from [minecraft.wiki](https://minecraft.wiki), is licensed under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) unless noted otherwise on the wiki, and is not covered by this license. Neither are `wiki-data.js`, `wiki-links.js` and `wiki-navboxes.js`, whose titles, categories and links come from the wiki's offline copy under the same license. The game credits the wiki in the footer and with a link to each article it shows.

MC Wiki Race is not an official Minecraft product, and is not approved by or associated with Mojang or Microsoft. Contact: [BryantF.xyz+mcwikirace@gmail.com](mailto:BryantF.xyz+mcwikirace@gmail.com).

Not an official Minecraft product. Not affiliated with or endorsed by Mojang Studios, Microsoft, Minecraft or minecraft.wiki.
