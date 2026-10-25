# MC Wiki Race

A wiki race (like [The Wiki Game](https://www.thewikigame.com/)) through [minecraft.wiki](https://minecraft.wiki): you get a random start article and a target article, and have to reach the target by clicking only the links inside articles.

Play it at **[mcwikirace.com](https://mcwikirace.com/)**.

> **Spoiler warning:** this repository gives away the whole game. The docs and the code spell out how everything works, including every advancement and how to earn it, the hidden ones too, and anything else meant to be found by playing. To discover them for yourself, play first and read later.

## What's in the game

- **Four games:** Race, Relay (checkpoints on the way), Scavenger hunt and Exact clicks.
- **Extra rules** to mix in: Round trip, No Back, Blind target, Top links only, Six clicks and Distance.
- **Three difficulties**, a choice of articles from the best known to the deepest cuts, a target topic and a target par.
- **A daily challenge**, the same pair for everyone on the same date, with streaks.
- **Scored like golf** against par, the fewest clicks the game can be done in, with the route you missed.
- **Advancements**, a background that maps the wiki's links, a note block for your clicks, and items that blow the page up.

Everything is explained in [How to play](docs/how-to-play.md).

## Running it

The whole game is one `index.html`, with no build step and no dependencies. Open it in a browser; opening it straight from disk (`file://`) works fine. Articles are fetched live from the minecraft.wiki API.

Next to it are the data it rolls from and works out par with (`wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js`, `wiki-lead.js`), generated from the wiki's offline copy by `tools/wikidata/`, and the icon and link-preview pictures.

## Docs

| Page | What's in it |
| --- | --- |
| [How to play](docs/how-to-play.md) | Every game, rule and setting, for players |
| [How it works](docs/how-it-works.md) | The architecture, for developers |
| [The wiki snapshot](docs/wiki-data.md) | The offline copy of the wiki and the files built from it |
| [Development](docs/development.md) | The test suites, the pre-commit hook, release checks |
| [Hosting](docs/hosting.md) | Serving your own copy, custom themes |

[docs/internal/](docs/internal/) is the detailed reference for changing the code.

## License

[MIT](LICENSE). Article content shown in the game comes from [minecraft.wiki](https://minecraft.wiki), is licensed under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) unless noted otherwise on the wiki, and is not covered by this license. Neither are `wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js` and `wiki-lead.js`, whose titles, categories and links come from the wiki's offline copy under the same license. The game credits the wiki in the footer and with a link to each article it shows.

MC Wiki Race is not an official Minecraft product, and is not approved by or associated with Mojang, Microsoft or minecraft.wiki. Contact: [BryantF.xyz+mcwikirace@gmail.com](mailto:BryantF.xyz+mcwikirace@gmail.com).
