# Docs

Pages for people, a few screens each:

| Page | For | What's in it |
| --- | --- | --- |
| [How to play](how-to-play.md) | Players | Every game, rule and setting, the daily, results, items and advancements. Spoilers included. |
| [How it works](how-it-works.md) | Developers | What's in the repo, how a game runs through `index.html`, how articles are fetched and shown, par. |
| [The wiki snapshot](wiki-data.md) | Developers | The offline copy of the wiki, the files built from it, and how to update them. |
| [Development](development.md) | Contributors | Running the game, the two test suites, the pre-commit hook, the docs check, release checks. |
| [Hosting](hosting.md) | Hosts | Serving your own copy, custom themes, Content-Security-Policy. |

## The internal reference

[internal/](internal/) is the detailed reference, one file per part of the game, naming the functions, ids and keys involved. It's written for whoever changes the code (people and coding agents alike), so it's dense rather than friendly. Each page above but How to play links to the parts of it that go deeper.

A change to the game updates the internal doc that covers it, and the page here too when players, hosts or contributors would notice. `tools/check-docs.mjs` runs before every commit and fails on a broken link between docs or a name in `internal/` that's no longer in the code; see [the docs check](development.md#the-docs-check).
