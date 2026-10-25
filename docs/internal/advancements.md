# Advancements

For people: [how-to-play.md](../how-to-play.md#advancements).

Part of the architecture, which is all in `index.html` (the Advancements section, after Effects).

Advancements are earned once each and kept across games, in the manner of Minecraft's.

## Defining one

Each is in `ADVANCEMENTS`, by key:
- its group (`ADV_GROUPS`: Getting started, Skill, Speed, Keeping at it, Exploring, Items, Secret),
- name,
- how to get it,
- tier (`ADV_TIERS`: a task, goal or challenge), which gives:
  - its toast's heading, "Advancement Made!", "Goal Reached!" or "Challenge Complete!",
  - its sound, the checkpoint chime, the win fanfare or the personal-best one,
  - and its frame;
- the article whose picture is its icon,
- an emoji for when that picture hasn't loaded,
- and for a count its goal (`of`), what it counts (`tally`) and the unit.

A secret one (`secret`) shows as ??? in the panel until earned: the Secret group, Birdie among the skill ones and Light Reading among the item ones.

Adding one is an entry there and its check; it is earned from then on.

## What earns them

- *As a page arrives* (`advArrive`, from `navigate` right after the arrival is recorded, past its `try`, so it swallows its own errors):
  - every arrival is counted (`visits`),
  - its title joins the different pages visited (`pages`)
  - and its topic the topics seen (`topics`).
  - Then:
    - First Click (any arrival after the start but Back),
    - Herobrine and Cake (by title),
    - Spin Doctor (a page in a spin-off's namespace),
    - April Fools! (a page in the joke family),
    - Around the World (every topic seen)
    - and Full Circle (clicking back onto the start, not with Back, outside a Round trip).
- *As a game ends* (`advFinish`, from `finish`, given whether the pair had a game in the history before (`recordKey`, any rules) and whether it is a new personal best):
  - a win counts (`wins`),
  - then `advFinish` waits for par (`game.parReady`, if the record doesn't have it yet) and every arrival's count (`measured`).
  - What it needs of the game it reads before waiting, since Retry this pair can start another game in the meantime.
  - Skill ones need a win at par `ADV_PAR` (3) or more on the pair's first game, so a typed easy pair or Retry this pair doesn't earn them, and speed ones the Timer too:
    - Par for the Course (at par),
    - Birdie (under par, which only a live edit making a route the offline copy lacks can do),
    - Hardcore (`nohubs`, so Hard),
    - No Take-Backs, Blindfolded, Six Shooter, Top Notch (each its rule),
    - Long Way Round (Exact clicks at par + 5 or more),
    - Grand Tour (a Round trip with three checkpoints),
    - Kind Collector (a Scavenger hunt of kinds),
    - Full Kit (Hard, No Back and Blind target together),
    - Quick Thinker, Speedrunner and Sprinter (under 60 s, 30 s, and 45 s at par 4+).
  - The rest:
    - Hello, Wiki (a win),
    - Daily Bread (any daily finished),
    - Relay Racer, Treasure Hunter, Measure Twice and There and Back Again (a win at each game),
    - Accepted (a win from a challenge link: `setup.challenge`, set when a link's cards load and cleared by `leaveDaily`, so by any change to them, and copied to `game.challenge`),
    - Self-Improvement (a new personal best),
    - Hot Streak (a win at par 4+ with Distance on, every click but those reaching a checkpoint or find, and the last, getting closer: `gotCloser`),
    - Rags to Riches (a Race from Dirt to Diamond),
    - So Close (out of Six clicks with the last page one click away)
    - and Scenic Route (a win in 15 clicks or more).
- *As Distance cheers* (`cheer`): `game.cheerRun` counts the cheers in a row, set back by an arrival that didn't get closer, and three earn On a Roll.
- *Items* (see [items.md](items.md)): earned as the items are used, and Picking Up the Pieces at a game's end (a win with `game.rebuilt`).
- *As the note block plays* (`note`, see [ui.md](ui.md#note-block)): each of its instruments heard for the first time, from its window or a game's clicks and Back, joins `instruments` (`advHeard`), not a mob head's sound nor the synthesized harp played while one isn't in, and the 20th earns Sound of Music.
- *Counts* are checked with every earning (`advEarn`):
  - Regular, Veteran and Wiki Legend (`wins`),
  - Bookworm (`visits`),
  - Demolition Expert (`blasts`),
  - Tourist and Cartographer (`pages`),
  - Sound of Music (`instruments`, of all of `NOTE_UNDER`),
  - and Habit, Week Streak and Devoted (`streak`: the daily streak now, `dailyStreaks`, so Clear history ends it).

## Toasts

`advEarn` queues each new one (`advQueue`), and `advPump` shows them in `#advToasts`, top right:
- up to `ADV_SHOWN` (3) at once,
- each for `ADV_MS` (5 s),
- the rest waiting for a place,
- with one sound for those shown together, the highest tier's.

### Look

- Each is Minecraft's own toast box (`Toast advancement.png`, at twice its 160 × 32) in every theme, with the item alone beside the heading, as in Minecraft.
- The heading is yellow, a challenge's purple, and a challenge's toast gets a firework, bursting below it (see [items.md](items.md#fireworks)).
- Until the box is in, a dark box like it.

### When and where

- While playing they sit under the game header, so Back and Give up stay clear, and wait while an article loads (`frameReady` pumps them once it shows).
- A game's end shows its own `ADV_AFTER_RESULT` (1.2 s) after the result opens, once its fanfare has played, over the result.
- They slide in from the right, and with Reduce motion fade in instead.
- Above the effects' canvas and the result window, they take no clicks.

## Pictures

Each icon is its article's picture:
- asked for once with every other icon's, 50 titles a request (the API's limit) (`advPictures`, `prop=pageimages` at 96 px), when a toast or the panel first needs them,
- and kept in `advPics` by the title asked for (through the reply's normalisations and redirects).

Until then, or if the request fails (it is asked again next time), the frame shows the emoji; when they come, every frame on the page (`.adv-frame[data-adv]`) is redrawn.

## The panel

The 🏆 Advancements button at the right of the Recent games heading (`#btnAdv`, with the count earned of all, `#advCount`) opens it (`openAdvancements`).

Recent games shows when there are games or advancements earned; with advancements but no games (after Clear history), only its heading and the button.

### Head

The panel's head stays at the top while the rest scrolls:
- the count and a bar,
- then the one picked (`advPicked`, `advDetail`):
  - its frame, name and tier,
  - how to get it,
  - and when it was earned, or a count's progress ("7 of 50 wins");
  - an unearned secret says only "A secret. Keep playing.".

### Groups

Then each group's grid with its count and, for Skill and Speed, their rules: each advancement a tile with its frame and name, gold once earned, greyed out otherwise, with a small bar for a count.

### Frames

- The frames are Minecraft's own (`Advancement-plain`, `-oval` and `-fancy`, for a task, a goal and a challenge), grey (`-raw`) until earned and gold (`-worn`) once it is.
- `advTextures` asks the wiki for them and the toast box with the pictures, and sets them as CSS variables (`--adv-plain-raw` … `--adv-toast`, and `adv-textured` on `:root` once the toast box is in).
- Until then the icons show with no frame.

### Reset

At the foot, Reset advancements (`#aReset`) asks first, then forgets everything in `mwr.advancements` (`advEmpty`).

## XP

XP is Minecraft's: earned at each game's end and with each advancement, never taken away, toward levels on Minecraft's own curve:
- `xpStep`:
  - 7 XP to level 1,
  - then 2 more each level to 16,
  - then 5 more each to 31,
  - then 9 more each;
- `xpLevel`.

XP is kept with the advancements (`adv.xp`), so Clear history leaves it and Reset advancements clears it, and it starts at nothing, as they do.

- *A win*: 2 × par (2 with no par), at par 3 more and under par 6 (not with Exact clicks, whose count isn't par), and 2 for each rule that makes it harder (`XP_RULES`: Round trip, No Back, Blind target, Top links only, Six clicks, and Hard; not Distance, which helps). The day's daily, won for the first time (nothing won in `mwr.dailies` before), is 10 more.
- *Any game*, won or not: 1 for each article seen for the first time (`game.fresh`, counted in `advArrive` against `adv.pages`).
- *An advancement*: a task 5, a goal 10, a challenge 25 (`ADV_XP`), once, as it is earned (`advEarn`), the items' too.
- Losses, giving up, the items themselves, Rebuild and fireworks give none. Clicks give none, nor does getting closer, so playing faster or wandering never pays.

### A game's XP

A game collects its XP as it goes (`game.xp`, each `[what, xp, an advancement's]`, captured by `advFinish` before it waits, so Retry this pair can't take it).

`advFinish` adds the game's own once par is in and shows it (`showXp`): in the result, under the tiles, what earned it (the game's first, then its advancements), its total and the bar. Outside a game an advancement's XP goes straight to the bar.

### The bar

- The bar is Minecraft's own (`Experience bar background` and `progress`, 182 × 5, at twice that, by `advTextures`; until they are in, a dark bar with a green fill), with the level in green over it and a tooltip of the XP to the next level and in all.
- It shows in the result and, half as big, beside the Advancements button (`#xpSetup`) once there is any XP; Recent games shows for XP alone too.

### Orbs

- In the result the game's XP flies from the total into the bar as Minecraft's orbs (`EFFECTS.xp`):
  - split as Minecraft splits them, at most 12,
  - each the orb's picture for its value from its sheet, `xpOrbs`,
  - tinted green to yellow and back as it shimmers, `xpFrames`,
  - each landing with Minecraft's pickup (the arrow's ding at random pitch, `SOUNDS.orb`) and filling the bar.
- `drawXp` draws every bar at the XP not still flying (`xpFlying`), so the bar fills as they land and can't fall behind:
  - with motion reduced or Effects off it fills at once,
  - and Reduce motion ticked while they fly lands them.
- A new level plays Minecraft's level-up (`Random levelup`) and bumps the number.

## Storage

`mwr.advancements` holds:
- `got` (each earned key and when, in ms),
- `wins`, `visits`, `blasts`, `xp`,
- `pages` (titles, so a new snapshot keeps them),
- `topics` (`WIKI_DATA.topics` keys)
- and `instruments` (`NOTE_UNDER` keys).

It is read once at load through `savedAdvancements`, which keeps only what `advEarn` would write: known keys with a number, whole counts of zero or more, strings, known topics and instruments.

`adv` holds it, `pages` and `instruments` as Sets (`advTally` counts a Set by its size), and `saveAdv` writes it back.

Clear history leaves it. It starts empty: nothing is worked out from games played before.
