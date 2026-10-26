# Game rules and state

For people: [how-to-play.md](../how-to-play.md#the-four-games), [how-it-works.md](../how-it-works.md#game-state-and-rules).

Part of the architecture, which is all in `index.html`. The state is the `game` object.

## Content in play

- `game.content` is the Content in play: what is on at `startGame`, plus the spin-off of any card's page (`spinoffOf`), whose links have to work to reach it, so a challenge link starting on `Dungeons:Creeper` needs no checkbox.
- `renderArticle` leaves its spin-offs out of the frame's dead namespaces.
- `toInfo` accepts a page in a spin-off's namespace by its number, taken from the ZIM's `ns-<N>` body classes, which match the live API's `ns`.
- It refuses a page that doesn't exist (null) and one the game leaves out (false): a left-out page (`LEFT_OUT`) or one in any other namespace (Tutorial:, Category:…), so a typed-in title can say which (see [setup-screen.md](setup-screen.md#top-to-bottom)).

## Difficulty

*Difficulty* (`LEVELS`, the Difficulty row) is the rules No navboxes and No hubs: Relaxed has neither, Normal (the default) No navboxes, Hard both.

The research behind it: with navboxes almost any sensible click gets closer ([RESEARCH.md](../../tools/wikidata/RESEARCH.md)).

- The two rules stay rule keys, so `game.rules`, the frame, the personal-best key and challenge links treat them like any other rule, but the extra rules don't list them.
- `rules()` adds the difficulty's to the ticked ones.
- `setRules` sets the difficulty from them (`levelOf`).
- `rulesText` names the difficulty unless it is Normal, so the Settings column shows "Hard" or "Relaxed".

## Rules

*Rules* are defined in `RULES`.

### Games and extra rules

- The games' rules (Checkpoint, which the screen calls Relay, Scavenger, Exact clicks) can't be played together, so the game tiles pick one (`GAMES`, `gameMode()`; a Race has none).
- The rest (`EXTRA_RULES`: Round trip, No Back, Blind target, Top links only, Six clicks, Distance) are checkboxes that go with any game, but a few rules play without some of them (`OFF_WITH`, `offWhy`):
  - Exact clicks without Six clicks (it has its own count) and Round trip (it never visits a page twice).
  - Top links only without Six clicks (its routes are often longer).
- There those boxes are disabled and say why, from the game's rule and the ticked boxes (`chosenRules`, in `syncVia`), and `rules()` leaves them out even if ticked.
- With Round trip on, each game's tile and strip say what it is then (`GAMES`' `trip`).
- All of these are `input.rule` checkboxes or the game radio, which `rules()` reads.
- `setRules` sets the game from a set of rules with `gameOf` (a hand-made link with several games' rules plays the first of Exact clicks, Scavenger and Relay).
- `startGame` copies `rules()` into `game.rules` (sorted in `RULES` order), and everything during play and in `finish` reads that, never the checkboxes.
- Changing a rule or the difficulty doesn't reroll, but leaves a daily.

### No Back

*No Back* hides the Back button and is also enforced in `goBack()`.

### No hubs

*No hubs* makes links to the hubs (`hubs` in `tools/wikidata/config.json`) dead:

- `HUB_TITLES` maps every hub and its redirects, those to sections included (about 1,000 titles, from `wiki-data.js`), to the hub.
- `navigate` passes all of them except the target's hub to `renderArticle` as `hubs`, whose links say "Off limits on Hard: a big overview page".
- Going Back to a hub start is allowed, and a hub that is a checkpoint stays live too.

### Blind target

*Blind target* keeps every card but the start, and Scavenger's kinds, off the setup screen (`hiddenKeys`).

On the setup screen:

- The hidden cards stay empty until Start picks them (`pickHidden`, through `reroll(…, true)`, with a target par holding as usual and for Exact clicks a target with a route of its count, waiting on the latest `updateSetupPar` run, `setup.parRun`).
- Or the hidden cards are held unseen when the game was fixed beforehand (the daily, a challenge link, and Copy challenge link, which picks them first since the link carries them, sealed).
- Their cards say Hidden and when each shows (`shownWhen`: when the game starts, or in a Relay when the stop before it in playing order is reached, the target among the checkpoints on a round trip), with no Reroll or custom box.
- Swap is hidden, and par and Exact clicks's count wait for the game.
- Any reroll, a new start, and any rule or difficulty change while Blind target is on or just turned off (`setup.blind`, set by `setRules` and the change listener) drops them (`dropHidden`), so turning it off rolls new ones rather than showing the held ones.
- `renderCard` and `renderKinds` read the checkbox, and changing any rule re-renders the cards.
- A target par under Blind target rerolls the start too, since only a start with a target at that par will do.

During play:

- Blind target hides the picture and description in the HUD, behind the path and through the peek button, which is hidden.
- In a Relay `renderObjective` shows a stop ahead as ? until the one before it is reached, all but the start a round trip goes back to.
- Scavenger's finds all show from the start, since they go in any order.

### Distance

*Distance*: every arrival, in every game, is measured as it arrives (`clicksToGo`, from `navigate`): the fewest clicks from the page to what is next, `objective()` or the nearest of what Scavenger still has to find, by the link graph under the game's settings (`routeUsable`, as par uses) and around `game.dead` as it is then, which is why it can't wait for `finish`.

The measure goes onto the path entry (`togo`: a number, null for no route, undefined when the snapshot lacks the page or what is next, 0 once nothing is), with the promise as `measured`, and with a route, its first click as `next` and where it ends as `aim`, for the result's missed shortcut (see [par.md](par.md)).

Showing the measure:

- The result's path shows them all (see [par.md](par.md)).
- With the Distance rule on, the header shows the latest beside the game's labels (`#hudHint`, from `renderHud`: "3 clicks to go", "No route from here", or that the page isn't in the offline copy) and the path list each page's.
- There is no banner over the article: the count waits in the header.
- A click that got closer is cheered once its article shows, with a ding, sparks and the count lit, and one that didn't gets nothing (`cheer`, see [ui.md](ui.md)).
- Distance isn't a daily rule, since it makes a game easier.

### Six clicks

- *Six clicks* shows the count as "of 6" under the clicks, with a dot a click (`#hudClicksK`, `#hudMeter`, from `game.limit`).
- `navigate` ends the game as lost (`finish(false, 'outOfClicks')`) when an arrival that isn't the target uses up the last click.

### Exact clicks

*Exact clicks* is a game too, and takes Six clicks's place: the target has to be reached in exactly par + a few clicks, on no page twice.

#### The count

- How many over par is picked in its strip (`#exactExtra`: par + 1 to 5, `EXACT_EXTRAS`, 2 at first, or Random).
- `setup.extra` holds the number in play (`setExtra`): Random rolls one when it is picked and again with every roll of the cards (`reroll`), so the setup screen always has a count to find a route of.
- Without Blind target the strip then says the count and the par + number it is made of; the line above the cards says "par + random".
- A daily or a challenge link sets the number (`extra=`, see [url-hash.md](url-hash.md)), so a link copied from a Random game plays the number it rolled.
- Under Blind target a challenge link's number is held unseen, the strip showing Random.
- The number plays no part in rolls (par, `startPars`, `pairKey`), only in the route the setup screen looks for.

#### No revisits

Revisits are out because a page almost always links back to the one before, which would make any count easy. So:

- Back is hidden (`canGoBack`).
- Every visited page is dead by every title that led to it (`game.dead`, renewed on each arrival), its links saying "Off limits: already visited (Exact clicks)".
- Reaching the target sooner loses (`tooSoon`), as does using up the count (`game.limit`, `outOfClicks`).
- The header shows the count only by the clicks ("of exactly 7" and its dots); beside the labels is "Land on the target with your last click, not before", and the target's chip says just Target.

#### A route of the count

The count can always be done: `updateSetupPar` finds a route of exactly that many clicks (`exactRoute`, `setup.exact`) and Start waits for it.

- That is NP-hard in general, so `exactRoute` searches depth first through pages the target can still be reached from in the clicks left (`distancesTo`, a breadth-first search back from the target over reverse edges made once per graph file), the farthest first, and gives up after `EXACT_BUDGET` pages.
- On this snapshot it found one for every pool pair tried in Normal, Relaxed and Hard, 150 each at par + 1 to 6 and 60 each at par + 8, 10, 15 and 20, in 18 ms at most, so the strip's choices could go much higher.
- Past par + 5 the game becomes wandering rather than planning.
- The result shows that route, and a win gets no golf score, since every win is par plus the number picked.

### Scavenger

*Scavenger* (the Scavenger hunt game): instead of a target there are `HUNT_SIZE` (3) things to find, in any order, chosen with `#huntMode` in its strip.

- *Articles* (`huntMode() === 'articles'`) puts them on the two checkpoint cards and the target card, labelled Find and joined by +.
- *Kinds* puts three kinds (`KINDS`, from `wiki-data.js`) on a card of their own (`#cardHunt`, `setup.kinds`, `setKinds`), each with its best-known members as examples.
  - `rollKinds` takes them from three topics, none holding the start (`firstKinds`, which the daily uses too), and a new start in one of them rolls them again (`renderCard`), since the start never counts.
- `startGame` puts them in `game.hunt` (`{ info }` or `{ kind }`, with a label), with `game.goal` null, so the code that reads the objective asks `game.hunt` first (`huntLeft`, `ahead`, `cardTitles`).
- An arrival finds (`huntFinds`) an article by its title and a kind by its snapshot members or the page's live categories (`parse.categories`, asked for with every article) less the kind's exclusions, so a page added to a category since the snapshot counts.
- A page can find several kinds at once.
- Each find gets the checkpoint's banner ("✓ Found a Nether mob: Blaze (2 of 3)") and its path entry `found`; finding all wins.
- Distance counts to the nearest of what is left.
- Swap reverses the articles, and is hidden for kinds.

### Top links only

*Top links only* (`lead`) leaves only the links above an article's first heading live: its opening text, its infobox and the hatnotes, the whole page if it has no heading, and never a navbox's.

- The frame kills the rest and folds it away under a bar with a button to read it anyway (see [rendering.md](rendering.md)).
- Par, rolls, Distance and Exact clicks go by `wiki-lead.js`, the same links from the snapshot (`linkGraph`, which picks the graph file by the rules).
- Text alone was too few links to play: [RESEARCH.md](../../tools/wikidata/RESEARCH.md) has the numbers.
- Its routes are mostly 4 to 6 clicks, so Six clicks is off with it.
- About one pool target in nine has no route under it:
  - rolls skip those (they don't join the web of links)
  - a pair kept from before, typed in or from a link says "No route with these rules" where par goes, with Start still on, since a live edit may have made one (a page newer than the offline copy, or a link graph that didn't load, leaves par blank instead).
- Top links only isn't a daily rule.

### No navboxes

*No navboxes* removes the navbox tables, which link most game content to the rest of its family (on Diamond, 1,984 live links drop to 829), and makes dead the lists of what an advancement or achievement asks for ("Kill one of these 41 monsters"), navboxes in all but looks.

- Popular and Deep cuts rank articles by their links from outside navboxes, and every target is linked from at least `MIN_BACKLINKS` articles outside them.

### Checkpoint

*Checkpoint* adds one to three cards between start and target (the count is `#viaCount`, in the Relay's strip; `syncVia` shows the cards in use, numbers them when there is more than one, and rolls the empty ones).

- A relay of two or three is the same rule.
- `game.vias` must be reached in order (`game.viaNext` counts them, set in `navigate` from the post-redirect title, with that path entry's `via` set to the checkpoint's number) before arriving at the target counts; a later one reached early is an ordinary page.
- The header's route and the picture behind the path follow `objective()`: the next checkpoint until all are reached, then the target.
- Reaching one sets `game.celebrate`, and once that article has rendered `frameReady` calls `celebrateCheckpoint()`:
  - a banner over the article naming what comes next (`#toast`, `showToast`, gone after 3 s, or 6 s when the way on is cut off (`stranded`), or on the next navigation; its animation runs as long as it shows, and with no time it stays)
  - a flash of the HUD objective.
- Swap reverses the whole chain.

### Round trip

*Round trip* goes with any game but Exact clicks: whatever the game asks, then back to the start, which the setup screen marks with "Start and finish" (and a ⇄ arrow when nothing stands between).

In a Relay the checkpoints go around the target:

- `setup.back` (`backCount()`) of them come after it, on the way back, rolled with the cards (`rollBack`: one checkpoint either side, of two or three at least one each way) and kept, or moved to the nearest that fits, when the count changes.
- `placeTarget` moves the target card among the checkpoint cards, with its own arrow (`#goalArrow`).
- Swap goes round the same loop from the target instead: the start and target change places and the checkpoints of the way back come first.

In play:

- `startGame` plays a round trip as a chain with the target as one more checkpoint (`game.turn`, its number among `game.vias`) and the start as `game.goal` (`game.roundTrip`), so the objective, the banner, Distance and the win check need little of their own.
- `viaName` and `checkpointNumber` number the checkpoints around the target.
- Scavenger's heads for the start once nothing is left to find (`hunting()`, which `objective()` is null during).
- `finish` records it by its cards: the target as `goal`, the checkpoints as `vias` and `back`.
- Reaching the target, or the last find (`turnBack`):
  - starts the Back stack again from there, so Back can't walk the way there backwards
  - makes every page of the way there dead, the target included, but those still ahead (`ahead()`: the checkpoints of the way back and the start): `game.dead` holds their titles and the link titles that led to them, which `navigate` passes to `renderArticle` as `dead` (their links say "Off limits: part of your way there (Round trip)") and Distance goes around.
- If the snapshot has no way on around them, that arrival is marked `stranded` (⛔ on the path), and the banner reaching it says only giving up is left, or `STRANDED` over the article if the banner has already gone. The path entry is marked in the accent colour.
- `CLICK_LIMIT` covers the whole route.

## Item blasts

An item's blast (see [items.md](items.md)) throws the pieces of the page around it, and the game goes on with the rest, its clock running; Rebuild puts them back, and Give up beside it ends the game as giving up.

## Leaving the page

- While a game is on (`startGame` until `finish` or `toSetup`), a `beforeunload` listener (`guardLeaving`) makes closing the tab, reloading, the browser's Back and any other way of leaving the page ask first with the browser's own dialog.
- It is added and removed rather than left on, since a page with one may be kept out of the back/forward cache.
- Browsers only show the dialog after a real click or key press, and a game only starts from one (Start or Play again).
- iOS Safari doesn't show it at all.

## Path, Back and the win check

- `path` records every visit in order and drives the click count (`path.length - 1`).
- `stack` is the navigation stack for Back. Going back is recorded in `path` and counts as a click.
- The win check compares `parse.title`, which is the title after redirects, against the target's resolved title. Following a redirect to the target therefore counts as arriving.

## The clock and loading

- The clock runs in every game, but with the Timer off (`game.timed`, see [ui.md](ui.md)) it is hidden and its time isn't recorded.
- It pauses while an article is loading and rendering, and while the Give-up confirmation is open.
- It keeps running while the player peeks at the target description.
- `game.loading` stays set until the frame posts `{mwr:'ready', token}`.
- That message comes from its own `<script>` after the main frame script, so it is sent only after the render-blocking stylesheets have loaded.
- A 15 s timeout calls `frameReady` anyway.
- An article that fails to load (a network or HTTP error, a MediaWiki error, a reply that isn't JSON or has no article) shows Retry and Cancel with the clock stopped, under what went wrong as the setup screen words it (`failText`, see [setup-screen.md](setup-screen.md#while-a-roll-is-under-way)).
- Everything that can fail has to fail inside `navigate`'s `try`: an error after it would leave the game loading, with Give up disabled.

## `navToken`

`navToken` throws away responses from navigations that have been superseded, and stale `ready` messages too.

## The parse cache

- `parseCache` keeps up to `PARSE_CACHE_MAX` (40) parse results, and articles of `PARSE_CACHE_TEXT` (10 million) characters in all, since a long one is over a million, the oldest going first but never the page just cached.
- They are stored under both the requested and the resolved title, and it is cleared on return to setup.
- Back and "Play again" don't refetch.
- The API marks parse responses uncacheable, so the browser's HTTP cache can't do this.
- A link pressed in the article (`{mwr:'press'}`) has its article asked for at the press (`pressLink`, through `askParse`, which `navigate` uses too), held in `pressed` until the next navigation:
  - one to that title waits for that request instead of making its own
  - any other drops it, and so does going back to setup.
- A failed one is the click's to show, with Retry asking again.
