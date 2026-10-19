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
- **Reroll** either card, or type your own article.
- **Back** returns to the previous article and counts as a click. The clock pauses while an article loads.
- **Copy challenge link** shares the exact pair you're looking at, as `index.html#start=<Title>&target=<Title>`.
- Your last 50 games and your personal best for each pair are kept in the browser.

## Dev options

### End-to-end test

```sh
test/run-e2e.sh [screenshot-dir]
```

Plays a real game in headless Firefox against the live wiki. Needs `firefox`, Node 22 or newer, and network access.

See `CLAUDE.md` for how the game works internally.
