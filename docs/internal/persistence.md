# Persistence

For people: [how-to-play.md](../how-to-play.md#whats-saved-in-your-browser), [how-it-works.md](../how-it-works.md#whats-kept-in-the-browser).

Part of the architecture, which is all in `index.html`.

## History (`mwr.history`)

`localStorage` key `mwr.history` holds the last 50 results and is used for the recent-games table and the per-pair personal best.

### Reading it back

Storage is shared with every page on the origin and open to the player, so it is read through `savedGames()`, which leaves out anything `isRecord` doesn't accept as a record `finish` would write:
- the wrong types,
- a rule, topic or Content key that doesn't exist,
- or a daily that isn't a real day, though one after today is kept, so a clock or time zone change doesn't drop it.

### Writing it back

`finish` and `showPar` write to the history as stored (`storedGames`), not to what `savedGames` reads, since a newer version of the game may have written it and a tab or cached copy of this one can outlive its release:
- entries that are objects stay, records `isRecord` doesn't take among them (a later rule, topic or field), and count towards the 50;
- history that is an object rather than a list, a newer format, is left alone, and the game isn't recorded;
- anything else, never a record of any version, goes.

The history carries no version marker: a record or list without one is format 1, the format of the first release. A later change that this version would misread adds one (an object around the list, or a field on each record) and a converter from the format before.

Clear history still writes an empty list, since that's what the player asked for.

### What a record holds

- A Scavenger record has `finds` (its articles) or `kinds` (their categories) in place of `goal`.
  - `isRecord` takes exactly one of the three, and `targetText` and `routeText` say them.
  - `recordKey` keys its personal best with its finds in any order.
- A lost record has the flag of its `LOSSES` key, `outOfClicks: true` (Six clicks or Exact clicks) or `tooSoon: true` (Exact clicks).
- An Exact clicks game has `exact` (its count).
- A Checkpoint game has `vias` (the checkpoints' titles, in order), with `back` on a round trip when some come after the target.
- Each record has `rules` (an array of rule keys).
- A rolled target's `topic` and `reach` are recorded too, and so is `game.content` as `content` when anything was on, and `par` once known.
  - A game finished before its par is worked out gets it from `showPar`, which drops `reach` then if the par is off it.
  - None of them are part of the personal-best key, since the cards already fix the game.
  - `isRecord` only accepts `TOPICS` and `CONTENT` keys and a whole number for `par`.

### Personal best

- The personal-best key is:
  - the whole `chain` (start, checkpoints, target, the checkpoints of the way back, and the start again for a round trip),
  - an Exact clicks game's count (par + 2 and par + 4 on one pair are two games)
  - and the rules.
- The personal best only compares records with the same rules (`sameRules`): the fewest clicks, then the fastest time (`beats`).
- A game played with the Timer off has no `ms`, so it beats another only on clicks, and Recent games shows a dash for its time.

### Result note

The result note shows the topic when it isn't Any and the Content as "Content: April Fools, Dungeons" (`settingsText`).

### Recent games

Recent games (`renderHistory`) always shows (with no records, "No games yet. Your last 15 show here.", `#historyNone`, in place of the table and Clear history), and shows the newest 15 of the 50 records, in five columns:
- the game as labels like the header's (the game, its extra rules, and a daily's day as a green "Daily 20 Oct"),
- the route (`routeText`) with the settings the labels don't say under it,
- the result: a badge, green for a win, orange for a loss, grey for giving up, with the golf name and par, or "Par 2" at par, under it, and Best on each pair's personal best,
- the time
- and the day (`whenText`: Today, Yesterday, then `shortDate`).

The Clear history link above the table empties it, dailies included, after a confirmation dialog.

The 🏆 Advancements button at the heading's right opens the advancements (see [advancements.md](advancements.md)).

## Dailies (`mwr.dailies`)

`mwr.dailies` keeps every daily played, by its date, apart from the history, so a streak outlasts the history's 50 games: `{ won, onDay, clicks, ms }`:
- whether it was won,
- whether on its own day (`onDay`, from `game.onDay`: the game started on the daily's day),
- and the best win's clicks and time (`beats`).

`finish` writes it for a daily through `saveDaily`:
- a loss or giving up keeping the day as played,
- a later game keeping the better win,
- and `onDay` once true staying so.

It is read through `savedDailies()`, which leaves out a day that isn't a real date and an entry `saveDaily` wouldn't write (`isDaily`).

The streak (`dailyStreaks`) is the days in a row won on their day, up to today, or up to yesterday while today's isn't won yet, so a past daily played from the calendar catches up without mending a streak.

`dailyStatsText` writes the streak with the best run and the days won of those played for the daily box.

Clear history empties `mwr.dailies` too.

## Other keys

- `mwr.advancements` holds the advancements earned, the XP and the counts toward them (see [advancements.md](advancements.md)); Clear history leaves it.
- `mwr.theme` holds the chosen theme.
- `mwr.sound` whether sound is on.
- `mwr.timer` whether the Timer is.
- `mwr.effects` whether Effects is ticked.
- `mwr.noteBlock` the note block's pick (`under` and `head`, see [ui.md](ui.md#note-block)).
- `mwr.reduceMotion` whether Reduce motion is ticked.
- `mwr.pathCollapsed` whether the path sidebar is collapsed (`setPathCollapsed`).
- `mwr.background` the background's settings (`bgSet`):
  - `style`, one of `BG_STYLES`,
  - and the booleans `wave`, `route` and `roll`;
  - anything else read from it is left out, so a field it lacks keeps its default.

Access goes through the `store` wrapper, which swallows storage errors.
