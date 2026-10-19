# Minecraft Wiki Game

A [Wiki Game](https://www.thewikigame.com/) for [minecraft.wiki](https://minecraft.wiki): you get a random start article and a target article, and have to reach the target by clicking only the links inside articles. Fewest clicks and fastest time win.

The whole game is one `index.html`, with no build step and no dependencies. Articles are fetched live from the minecraft.wiki API.

## Playing

Open `index.html` in a browser. Opening it straight from disk (`file://`) works fine.

- **Modes** decide how articles are picked:
  - **Classic:** blocks, items, mobs, biomes and other game content. Every category is equally likely, so small ones like bosses come up often.
  - **Balanced:** the same content, with bigger categories picked more often.
  - **Even:** the same content, with every article equally likely.
  - **Chaos:** any article on the wiki.
- **Target** difficulty goes by how many articles link to the target. **Any** takes any target linked from at least 5 articles, **Easy** the best-linked of 5 random targets and **Hard** the least-linked of 5. Changing it rerolls only the target, and a target you type yourself skips it.
- **Reroll** either card, or type your own article.
- **Back** returns to the previous article and counts as a click. The clock pauses while an article loads.
- **Rules** are optional extras you can switch on:
  - **No Back:** the Back button is gone, so every click is final.
  - **No hubs:** links to big overview pages like Block, Item, Mob, Crafting or Java Edition are dead, unless that page is the target.
  - **Blind target:** you only get the target's name, with no picture or description.
  - **Six clicks:** reach the target in 6 clicks or fewer, Back included, or the game is over.
- **Copy challenge link** shares the exact pair you're looking at, plus any rules, as `index.html#start=<Title>&target=<Title>&rules=noback`.
- **Theme** (top right of the setup screen): Auto follows your system's light or dark setting. Articles switch to the wiki's own dark theme to match.
- Your last 50 games, your personal best for each pair and your theme are kept in the browser. Personal bests are kept separately for each combination of rules.

## Hosting

Serve `index.html` as a static file. To add a theme without editing it, put a stylesheet in its `<head>` marked with `data-mwg-theme`. It shows up in the theme picker, and `data-mwg-default` makes it the default:

```html
<link rel="stylesheet" href="my-theme.css" data-mwg-theme="My site" data-mwg-default>
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
