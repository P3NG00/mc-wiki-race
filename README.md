# MC Wiki Race

A wiki race (like [The Wiki Game](https://www.thewikigame.com/)) through [minecraft.wiki](https://minecraft.wiki): you get a random start article and a target article, and have to reach the target by clicking only the links inside articles. Fewest clicks and fastest time win.

Play it at **[mcwikirace.com](https://mcwikirace.com/)**.

The whole game is one `index.html`, with no build step and no dependencies. Next to it are `wiki-data.js`, what the game knows about the wiki (which articles it can roll, how well linked they are), and `wiki-links.js` and `wiki-navboxes.js`, the links between its pages, which the result uses to work out the fewest clicks, all generated from the wiki's offline copy by `tools/wikidata/`, the icon (`favicon.ico`, `apple-touch-icon.png`) and the link-preview image (`og-image.png`). Articles are fetched live from the minecraft.wiki API.

## Playing

Open `index.html` in a browser. Opening it straight from disk (`file://`) works fine.

- **Pools** decide which articles come up. The start and target are always from different topics (blocks, items, mobs, biomes & structures, enchantments & effects), since two things from the same topic are usually one click apart:
  - **Popular:** the best-known game content, the 30% most linked across the wiki.
  - **Everyday:** all the game content, each topic equally likely.
  - **Deep cuts:** the least-known third of each topic.
  - **Chaos:** any article on the wiki.
- **Content** adds more to the pools: **April Fools** jokes, **Removed & unused** features, **Education** blocks, items and mobs, **Books & comics** objects, **Variants** (stairs, slabs, walls, dyes and the like) and **Mechanics** (breeding, brewing, game rules). Chaos has them all already.
- **Spin-offs** (Dungeons, Dungeons II, Legends, Earth, Story Mode, Movie) add the wiki's pages about other Minecraft games, in any mode, and make links to them work. **All** switches every spin-off on or off. Without them, links into those pages are dead.
- **Target** topic (Blocks, Items, Mobs, Biomes & structures, Enchantments & effects) picks the target from that part of the wiki, in any pool. The start comes from another topic. Changing it rerolls the target, and a target you type yourself skips it.
- **Reroll** any card, or type your own article.
- **📅 Daily** loads today's pair, which is the same for everyone on the same date. It always plays on Normal with one extra rule of the day (No Back, Blind target, one or two checkpoints, Six clicks, a round trip, or Hard instead), it can always be done (on a Six clicks day in 4 clicks or fewer), and the result says it was the daily. `index.html#daily` opens it directly.
- **Back** returns to the previous article and counts as a click. The clock pauses while an article loads.
- **Par** is the fewest clicks the pair can be done in, with the same difficulty, checkpoints and spin-offs. It shows beside Start and in the game's header, and the result scores your win against it as golf does (Hole in one!, Par, Bogey, Double bogey…) and shows one route that takes that many. It goes by the wiki's offline copy, so the result names that copy's date.
- **Difficulty** decides which links you can use:
  - **Relaxed:** everything, including the big link tables at the bottom of articles (navboxes), so almost any sensible click gets you closer.
  - **Normal** (the default): the navboxes are hidden, so you find your way through the article itself.
  - **Hard:** no navboxes, and links to big overview pages like Block, Item, Mob, Crafting or Java Edition are dead too, unless that page is the target.
- **Rules** are optional extras you can switch on:
  - **No Back:** the Back button is gone, so every click is final.
  - **Blind target:** you only get the target's name, with no picture or description.
  - **Hot/cold:** after each click, a hint says whether you got closer to the target (🔥 warmer) or further away (❄️ colder), never how close.
  - **Six clicks:** reach the target in 6 clicks or fewer, Back included, or the game is over.
  - **Exact clicks:** reach the target in exactly par + 2 clicks, never on the same page twice, so there's no Back. Getting there sooner loses, so you have to find a detour, and so does running out.
  - **Checkpoint:** one to three more cards, a relay. You have to visit them on the way, in order, and reaching the target before them doesn't count.
  - **Round trip:** reach the target, then find your way back to the start. Back can't take you the way you came. With **No retracing** ticked as well, every page from the way there is a dead link on the way back.
- **Copy challenge link** shares the exact pair you're looking at, plus any checkpoints, the difficulty and rules, as `index.html#start=<Title>&target=<Title>&via=<Title>&rules=nonav,checkpoint` (`nonav` is Normal, `nonav,nohubs` Hard, neither Relaxed).
- **Theme** (top right of the setup screen): Auto follows your system's light or dark setting. Articles switch to the wiki's own dark theme to match.
- Your last 50 games, your personal best for each pair and your theme are kept in the browser. Personal bests are kept separately for each combination of rules. Each result also notes the target topic it was rolled with and the Content that was on.

## Hosting

Serve `index.html` as a static file, with `wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js`, `favicon.ico`, `apple-touch-icon.png` and `og-image.png` next to it. Without `wiki-data.js` the game doesn't start, and without the other two the result can't say the fewest clicks. All three change together with each new copy of the wiki, so serve them without long caching. Its `canonical` link and Open Graph tags point at https://mcwikirace.com/, so search engines treat other copies as duplicates of that one. To add a theme without editing it, put a stylesheet in its `<head>` marked with `data-mwr-theme`. It shows up in the theme picker, and `data-mwr-default` makes it the default:

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

Checks the game's own logic (rolls, the daily, Content, difficulty, which links are live) in about 20 seconds, with every request to the wiki answered by the test, so it works without network access or while the wiki is down.

See `CLAUDE.md` for how the game works internally.

## License

[MIT](LICENSE). Article content shown in the game comes from [minecraft.wiki](https://minecraft.wiki), is licensed under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) unless noted otherwise on the wiki, and is not covered by this license. Neither are `wiki-data.js`, `wiki-links.js` and `wiki-navboxes.js`, whose titles, categories and links come from the wiki's offline copy under the same license. The game credits the wiki in the footer and with a link to each article it shows.

MC Wiki Race is not an official Minecraft product, and is not approved by or associated with Mojang or Microsoft. Contact: [BryantF.xyz+mcwikirace@gmail.com](mailto:BryantF.xyz+mcwikirace@gmail.com).

Not an official Minecraft product. Not affiliated with or endorsed by Mojang Studios, Microsoft, Minecraft or minecraft.wiki.
