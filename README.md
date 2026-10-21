# MC Wiki Race

A wiki race (like [The Wiki Game](https://www.thewikigame.com/)) through [minecraft.wiki](https://minecraft.wiki): you get a random start article and a target article, and have to reach the target by clicking only the links inside articles. Fewest clicks and fastest time win.

Play it at **[mcwikirace.com](https://mcwikirace.com/)**.

The whole game is one `index.html`, with no build step and no dependencies. Next to it are `wiki-data.js`, what the game knows about the wiki (which articles it can roll, how well linked they are), generated from the wiki's offline copy by `tools/wikidata/`, the icon (`favicon.ico`, `apple-touch-icon.png`) and the link-preview image (`og-image.png`). Articles are fetched live from the minecraft.wiki API.

## Playing

Open `index.html` in a browser. Opening it straight from disk (`file://`) works fine.

- **Modes** decide how articles are picked:
  - **Classic:** blocks, items, mobs, biomes and other game content. Every category is equally likely, so small ones like bosses come up often.
  - **Balanced:** the same content, with bigger categories picked more often.
  - **Even:** the same content, with every article equally likely.
  - **Chaos:** any article on the wiki.
- **Content** adds more to Classic, Balanced and Even: **April Fools** jokes, **Removed & unused** features, **Education** blocks, items and mobs, and **Books & comics** objects. Chaos has them all already.
- **Spin-offs** (Dungeons, Dungeons II, Legends, Earth, Story Mode, Movie) add the wiki's pages about other Minecraft games, in any mode, and make links to them work. **All** switches every spin-off on or off. Without them, links into those pages are dead.
- **Target** difficulty goes by how many articles link to the target. **Any** takes any target linked from at least 5 articles, **Easy** the best-linked of 5 random targets and **Hard** the least-linked of 5. A **topic** (Blocks, Items, Mobs, Biomes & structures, Enchantments & effects) picks the target from that part of the wiki, in any mode. The start still comes from the mode, because two articles from the same topic are usually one click apart. Changing difficulty or topic rerolls only the target, and a target you type yourself skips both.
- **Reroll** any card, or type your own article.
- **📅 Daily** loads today's pair, which is the same for everyone on the same date. Your rules still apply, and the result says it was the daily. `index.html#daily` opens it directly.
- **Back** returns to the previous article and counts as a click. The clock pauses while an article loads.
- **Rules** are optional extras you can switch on:
  - **No Back:** the Back button is gone, so every click is final.
  - **No hubs:** links to big overview pages like Block, Item, Mob, Crafting or Java Edition are dead, unless that page is the target.
  - **Blind target:** you only get the target's name, with no picture or description.
  - **Six clicks:** reach the target in 6 clicks or fewer, Back included, or the game is over.
  - **No navboxes:** the big link tables at the bottom of articles are gone, so you have to use links in the article itself.
  - **Checkpoint:** a third card. You have to visit that article on the way, and reaching the target before it doesn't count.
- **Copy challenge link** shares the exact pair you're looking at, plus any checkpoint and rules, as `index.html#start=<Title>&target=<Title>&via=<Title>&rules=checkpoint`.
- **Theme** (top right of the setup screen): Auto follows your system's light or dark setting. Articles switch to the wiki's own dark theme to match.
- Your last 50 games, your personal best for each pair and your theme are kept in the browser. Personal bests are kept separately for each combination of rules. Each result also notes the target difficulty and topic it was rolled with and the Content that was on, so you can see whether Hard really plays harder.

## Hosting

Serve `index.html` as a static file, with `wiki-data.js`, `favicon.ico`, `apple-touch-icon.png` and `og-image.png` next to it. Without `wiki-data.js` the game doesn't start. Its `canonical` link and Open Graph tags point at https://mcwikirace.com/, so search engines treat other copies as duplicates of that one. To add a theme without editing it, put a stylesheet in its `<head>` marked with `data-mwr-theme`. It shows up in the theme picker, and `data-mwr-default` makes it the default:

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

See `CLAUDE.md` for how the game works internally.

## License

[MIT](LICENSE). Article content shown in the game comes from [minecraft.wiki](https://minecraft.wiki), is licensed under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) unless noted otherwise on the wiki, and is not covered by this license. The game credits it in the footer and with a link to each article it shows.

MC Wiki Race is not an official Minecraft product, and is not approved by or associated with Mojang or Microsoft. Contact: [BryantF.xyz+mcwikirace@gmail.com](mailto:BryantF.xyz+mcwikirace@gmail.com).

Not an official Minecraft product. Not affiliated with or endorsed by Mojang Studios, Microsoft, Minecraft or minecraft.wiki.
