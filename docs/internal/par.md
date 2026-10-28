# Par, golf and the result window

For people: [how-to-play.md](../how-to-play.md#par-and-golf-scores), [how-it-works.md](../how-it-works.md#par-and-route-searches).

Part of the architecture, which is all in `index.html`.

## Par and Golf

Par is the fewest clicks for a pair, going by the snapshot.

### Working it out

- The setup screen works it out beside Start (`updateSetupPar`, run from every `renderCard`, so the first card rendered starts loading the graph and it is ready by the time a game starts).
- The search can hold the page up for a moment, a round trip's or Scavenger's most, so `setupPar` first shows `Par …` with a spinner (`.working`) and waits for the page to be drawn (`painted`).
  - Of the runs started meanwhile (a change of rules renders every card) only the last one searches.
- `startGame` works it out for the game (`game.parReady`, then `game.par`, for the header), taking the route the setup screen has just found.
  - `cardsRoute` keeps its last search by everything it went by (`lastRoute`), so Start and Play again don't search again, and drops one that fails.
- Both show par in every game, so a player knows the score to aim for from the start; only Blind target holds it until the game starts.

### Golf scores

The result scores a win against par as golf does, each name with what it means for anyone who doesn't play golf.

`golfScore` gives `{ name, note, over }`:
- Hole in one! (par 1 in one click),
- Par (even with par),
- Bogey (1 over par),
- Double bogey,
- Triple bogey,
- then just "N over par";
- under par, possible only where par isn't the live fewest clicks (see below):
  - Birdie (1 under par),
  - Eagle,
  - Albatross,
  - then just "N under par".

`golfText` writes it in one line for the copied result.

The result also shows one shortest route. `showPar` fills, once it knows, unless that result has been closed:
- the score badge `#mScore`, orange when over par,
- the Par tile,
- the shortest route column `#mBest`
- and the wiki-date line `#par`.

## The result window

The result window (`finish`, `.result`) goes:
1. the outcome as the heading (a loss orange, with its reason under it, and giving up grey, as Recent games marks them) and the golf score beside it;
2. the game and its extra rules as labels, like the header's, with a daily's day (`shortDate`), the route and the settings the labels don't say;
3. four tiles (clicks, or for a loss under Six clicks or Exact clicks the clicks of the count, "6 of 6" or "2 of 4"; par, time, time per click);
4. the personal best (a green bar when it is a new one);
5. your path;
6. the missed shortcut, with the shortest route beside it;
7. then Share, Copy challenge link, Play again and New game.

### Your path

- Each page is marked with what it was (back, a checkpoint, a find, the target, stranded).
- Each page is marked with how many clicks it was from what was next as it arrived (`togo`, filled in once every arrival is measured, `measured`; see Distance in [rules.md](rules.md)).
- A page is in the target colour (`worse`) where a click got no closer to the same objective, but for Exact clicks, which has to take detours.
- The path has a note under it saying what the numbers are, once something could be measured.

### The missed shortcut

Then, folded away under "Show a shortcut you missed" (`#mShortcut`, a `<details>`, so it is there for whoever looks for it rather than one more mark against the game, and both columns start level), comes the shortcut the costliest detour missed (`missedShortcut`).

- The costliest detour is, of the clicks that got no closer (`noCloser`), the one that took the most clicks more than the page's own shortcut would have (its `next`, see Distance in [rules.md](rules.md)) until a page as close as that was reached, or a checkpoint or find, or else to the end.
- It is shown only for a detour of `SHORTCUT_MIN` (2) or more.
- It is never shown from the start or a checkpoint, whose way on the shortest route beside it already shows.
- It is never shown for Exact clicks, and never in Share.
- It is the tip the shortest route can't give, a page the player was actually on, so it can be one inside the start's own detour.
- It says why that page:
  - how many times the player was on it going for the same objective (`times`, when more than once)
  - and how many clicks quicker it was (`quicker`, left out when nothing as close was reached again).
- Examples:
  - "From Mob (visited 3 times), Achievement was 1 click from Cooked Cod: 4 clicks quicker."
  - "From Dirt, Bone Meal was 1 click from Crafting: 3 clicks quicker."
  - "Dirt linked straight to Crafting."

Beside it, the shortest route (for Exact clicks, a route of its count).

Then Share, Copy challenge link, Play again and New game.

### Share and the challenge link

- A copy the browser refuses turns its button to "Copy failed" and shows the text under the buttons (`#mCopyBox`), selected, to copy by hand, until a copy works.
- Share and Copy challenge link both copy `game.link`, made at `startGame` from the setup that started the game by `gameLink`, which the setup screen's Copy challenge link uses too.
  - `game.link` is the sealed challenge link, or for a daily `#daily=<date>`, since the blob never holds a daily and its game wouldn't count as one.
- Share (`shareText`) copies:
  - a daily's day with its year, the game's labels and settings,
  - the route,
  - the result with par and its golf name,
  - your path with each page's count in brackets (from the result's own path entries, `steps`, so a record from the history alone has none)
  - and that link.
- Under Blind target Share names only the start (`shareRouteText`, the rest as ?) and leaves the path out, so the text gives away nothing the link holds unseen.

### Narrow screens and the record

- On a narrow screen the tiles go two across and New game takes the full width above the others.
- The record keeps `par`, added afterwards to a record saved before it was known, and the history and Share show it.

## Route searches

### The graph and the search

- `parRoute` loads the graph the game was played on (`linkGraph`):
  - `wiki-links.js`, and `wiki-navboxes.js` for Relaxed,
  - or `wiki-lead.js` alone for Top links only,
  - each the first time it is needed, refused if its sha256 isn't `WIKI_DATA`'s.
- `parRoute` searches it breadth-first (`shortestRoute`), opening each navbox once, the first and nearest time it is reached.
- Of the routes with the fewest clicks it takes one through the fewest pages that aren't content (`CONTENT_PAGES`: no topic and no family), then the first by page number, by taking each level of the search in that order.
  - Pages that aren't content, such as Minecraft Dungeons, Particles or Minecraft.net, link to much of the wiki, and by page number alone nearly 1 in 5 routes shown on this snapshot went through one.
  - Now 1 in 30 do, the rest having no route through content alone as short.
  - Par is the same either way.

### Following the game's settings

The search follows the game's settings:
- navbox links only count in Relaxed,
- hubs are dead in Hard but the target's and the checkpoints' (`routeUsable`),
- a spin-off's pages only count when it is on,
- and the checkpoints split the route into legs (`legsRoute`).

### Round trips

- A round trip is the way there plus the way back, each through its own checkpoints (`roundTripRoute`).
- The way back can't use a page of the way there but the stops still ahead, which makes the fewest clicks a shortest loop through given pages, NP-hard in general.
- So it tries the shortest way there with the shortest way back around it and the other way about, then again with each page of those banned in turn (up to `ROUND_TRIP_TRIES`), stopping at the lower bound, the shortest way there plus the shortest way back.
- On this snapshot it reached that bound in all of 898 pairs tried in Normal, Relaxed and Hard and all of 398 with a checkpoint each way, so par is exact in practice.

### Scavenger

Scavenger's par is exact too:
- for articles the shortest over every order (`huntRoute`, `orders`), since revisits are allowed,
- and for kinds a breadth-first search over (page, kinds found) (`kindsRoute`), which goes by the snapshot's members only, so a live-only find can beat it.

With Round trip each goes home from its last find around the hunt:
- articles through `roundTripRoute` for each order, the orders taken by their lower bound,
- and kinds from each finished hunt in turn, nearest first, skipping those whose shortest way home at all (`distancesTo`) can't win,
- so these two are no longer exact.

### Live edits

Live edits since the snapshot can make the real fewest clicks lower or higher, so the wiki-date line `#par` names the snapshot's date, as the footer shows it (`snapshotDay`): "Going by the wiki’s offline copy from 21 Aug 2026.", or that a page isn't in that copy, or that it has no route with these settings. It also shows one route that takes that many.
