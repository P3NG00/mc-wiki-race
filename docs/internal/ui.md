# Themes, pictures, sounds, the background, the game header and phones

For people: [how-to-play.md](../how-to-play.md#settings), [hosting.md](../hosting.md#adding-a-theme), [how-it-works.md](../how-it-works.md#the-visual-layer).

Part of the architecture, which is all in `index.html`.

## Themes

### What a theme is

A theme is the set of CSS variables on `:root` (colours, `--font`, `--radius*`) plus `color-scheme`, which also decides the article's wiki theme (`themeIsDark()` reads the computed `color-scheme`, falling back to `prefers-color-scheme` when it is ambiguous).

### Built-in themes

Built in:

- Auto (no `data-theme` attribute, follows the OS)
- Light and Dark (`data-theme="light"`/`"dark"`).

Auto's dark rule is `:root:not([data-theme])`, so no other theme ever picks up the dark variables.

### Host themes

A page serving the game can add themes without editing this file:

- a `<link rel="stylesheet">` or `<style>` in `<head>` with `data-mwr-theme="Name"` that defines `:root[data-theme="Name"]`
- plus `data-mwr-default` to make it the default.

The names `auto`, `light` and `dark` belong to the built-ins (a host theme named `auto` could never apply).

### Applying a theme

The `#theme-boot` script at the top of `<body>` runs before first paint: it builds `THEMES` (used by the main script) from those `data-mwr-theme` elements and applies the saved theme if it still exists, else the default, else Auto.
It is not `<script>` followed by a newline on purpose, so the syntax-check regex still finds the main script.

The picker on the setup screen calls `setTheme()`.

### Background colours

The background behind the setup screen takes its colours from the theme too:

- `--viz-<topic>` for each topic (`--viz-blocks`, `--viz-items`, `--viz-mobs`, `--viz-world`, `--viz-magic`)
- `--viz-redstone` for the wave
- `--viz-opacity` for how strong it all is.

A host theme that leaves them out gets the light ones.

## Pictures

Thumbnails are requested at 400 px (`pithumbsize`).

Every setup card and the path sidebar also show a large faded copy (`.art`, at `--art-opacity`, which themes can set) behind their content and cut off by the box's edges:

- the card's article
- in the sidebar `objective()`.

A card's fades out toward the text at its top left (a diagonal mask in place of the radial one), so it shows in the card's empty corner. The sidebar's is hidden on narrow screens, and a card's where the card is 440 px wide or less (three Relay cards side by side, a tablet, a phone), where it would lie under the description and the box to type in.

Pictures are drawn with hard edges (`image-rendering: pixelated`), except ones whose URL has `/thumb/`: the wiki serves small sprites at their own size (Diamond is 160 px), so a thumbnail URL means it scaled down a bigger render or screenshot, and those are drawn smoothly.
A `/thumb/` `.art` also gets a radial mask, which softens a screenshot's rectangular edges.

## Sounds

### Fetching the sounds

Sounds are Minecraft's own, fetched from the wiki like its pictures and never copied here (`SOUND_FILES`, each key one or more files, one played at random as the game does), played through `play()` (`SOUNDS`).
Each is synthesized with Web Audio until it is in, or if it doesn't come (`wiki`).

Their addresses are asked for once, in one request, on the first sound with Sound on.
Each key's files are decoded the first time it is wanted (`loadSounds`):

- the game's on the first sound (`GAME_SOUNDS`)
- the items' when one is first taken in hand (`ITEM_SOUNDS`)
- the fireworks' with their pictures.

Nothing is fetched with Sound off, and one that fails is asked again a minute later, not at every sound.
`loadSounds` returns a promise that settles once its keys are in or have failed, which a pick in the note block's window waits on before its first note.

### The game's sounds

The game's:
- a link click is the note block's instrument, a harp unless another is picked (see [Note block](#note-block)), climbing a pentatonic scale from its middle F# with each click of the game (played when the navigation starts, so a slow load doesn't delay it); Back falls two notes, or with a mob head plays its sound once (the window's foot says so);
- a dead link is a villager's "hrmm" (`Villager deny`; the frame posts `{mwr:'dead'}`), and so is giving up;
- a checkpoint or find (`celebrateCheckpoint`) and a task's toast are an arrow's ding (`Successful hit`), at half its pitch, as heard in the game;
- a new personal best and a challenge's toast are Minecraft's challenge fanfare, not twice at once;
- a loss (the clicks running out, under Six clicks or Exact clicks) is a villager dying;
- an XP orb landing is Minecraft's pickup, the same ding at random pitch, and a new level Minecraft's level-up (`Random levelup`; see [advancements.md](advancements.md#xp));
- a win is a fanfare on the note block's instrument, the one under it even with a head on top (`chime`): up its middle F#'s major chord and the chord at the top;
- a goal's toast is Minecraft's toast coming in (`Toast.ogg`).

### Audio context and muting

The `AudioContext` is made on the first sound, which always follows a click or key press, as browsers require, and any audio error is swallowed.
Sound is on by default, muted with the Sound checkbox in ⚙ Settings or the speaker button in the game header (`setSound`).
With Distance on, a click that got closer also dings (`closer`), a step higher the fewer clicks are left: see Effects.

## Note block

### The buttons and the window

The note block's buttons:

- the round button above the items' in the setup screen's bottom-right corner (`#btnNotes`; it drops to the items' place when the background's button is hidden), or left of it in the row beside the title at 720 px and below
- the one beside the items' in the game header (`#hudNotes`), or in the path's line on a phone held upright (`placeHudToys`).

Each is the wiki's Note Block picture, or ♪ if it doesn't come.
They open a window like a Minecraft container (`openNoteBox`, in the screen showing, `itemsRoot`), which picks what the game's clicks play, as Minecraft's note block does.
The window opens:

- under the header's button
- under the title's row of buttons on a phone
- beside the corner's buttons, or over them where there is no room.

### Underneath

*Underneath* picks the block the note block stands on, which picks the instrument (`NOTE_UNDER`):

- dirt for the harp (any other block)
- oak planks for the bass
- stone the bass drum
- sand the snare drum
- glass the hat
- and the block of gold, clay, packed ice, white wool, bone block, block of iron, soul sand, pumpkin, block of emerald, hay bale, glowstone and the four ages of copper for the bell, flute, chime, guitar, xylophone, iron xylophone, cow bell, didgeridoo, bit, banjo, pling and the four trumpets.

Each is the wiki's `Note block <sound>.ogg`, which is its instrument's middle F# at its own pitch, so the clicks' scale is the same on any.

### On top

*On top* puts nothing or a mob head there (`NOTE_HEADS`: the skeleton's and wither skeleton's skulls, the zombie's, creeper's, piglin's and dragon's heads), which, as in Minecraft, plays its mob's sound (the wiki's idle sounds, and the creeper's hiss, `Creeper fuse.ogg`, which a creeper plays at half its pitch) at its own pitch whatever the note, so a click plays it once and so does Back.
With a head on top, the blocks below grey out; picking a block takes the head off.

### The window's look

The window is the large chest's panel and its slots the chest's, at twice their size, cut from the wiki's `Generic 54 gui.png` (`guiTextures`, with the hotbar's, see [items.md](items.md)), what is picked in the hotbar's selection frame.
Until they are in, the window is a plain grey box with plain grey slots, the pick framed white.

Each slot is named in the hotbar's tooltip on hover (not with a finger, where what is picked shows under the note block), a head's saying it plays at one pitch.

What is picked, under the note block (`.nb-what`), is always as tall, two 18 px lines for its name and two for what it is on or plays (a line each on a narrow screen, where it is the window's width), so no pick changes the window's size or moves its slots.

### Ringing a note

The note block stands on the block picked, the head on it (the dragon's moved down and right by its `shift`, its picture being shorter than wide and its snout reaching forward), and dropping in when picked.

A click on the note block, or a pick, plays the next note of the clicks' scale (`ringNote`), once its sound is in, with Minecraft's note (`Note (texture) JE1 BE1.png`, tinted the pitch's colour from the Note Block article's table, `NOTE_COLORS`) rising over it, none for a head, as in Minecraft, nor with Effects off or motion reduced.

### Loading

The window's pictures are asked for when it first opens, and the instruments' sounds with Sound on (a head's when it is picked).
With Sound off the window says so, with a button that turns it on.

### Saving the pick

The pick (`noteBlock`) is saved as `mwr.noteBlock`, read through `noteChoice`, which keeps each half only if it is a key of its table.

### Closing

A click outside the window or in the article, Escape or ✕ closes it, and so do opening the hotbar and a game's start or end (`itemsReset`).
A page in pieces leaves it working, kept whole as the items' buttons are.

### What else a pick does

A pick leaves Roll by itself on, as the items do.
Distance's cheer stays on the pling, a sound of its own.
A click's sparks are its note's colour (`noteColor`), and each instrument heard counts toward Sound of Music (see [advancements.md](advancements.md)).

## Effects

### Sparks

Sparks are drawn over everything on `#fx`, a canvas the size of the window above the result window that takes no clicks, hidden while nothing is drawn.
`effect(name, from)` plays one of `EFFECTS` from a point on the page, and `fxFrame` draws them, a square each, with a frame only while there are any.
A spark from a point on something that scrolls (`from.on`, the page or the article, for the items' explosions) goes with it.

### What each event plays

- A link click (`navigate`'s `from`, from the frame's click point, or Back's button) sends seven sparks curving into the click count, in the colour of the note it played (Back's last; the game's own colours with a mob head on the note block, see [Note block](#note-block)), which bumps (`.bump`) as the first lands.
- A navigation with no click, as Retry, just bumps the click count.
- A dead link puffs grey where it was clicked.
- A checkpoint or find bursts from its banner (`celebrateCheckpoint`).
- A win sends Minecraft's fireworks up around the result's heading, a new personal best more and in gold, and a daily's first win more again (`celebrate`, see [items.md](items.md#fireworks)).
- A loss and giving up have none.

### Distance's cheer

None of these effects says how a game is going.
Distance's cheer (`cheer`, from `frameReady`) does: once the article shows and both counts are measured, a click that got closer (`gotCloser`: as `noCloser` asks, to the same objective, so never one reaching a checkpoint or a find, and never under Exact clicks) dings, sparkles from the count and lights it (`.hint.closer`) until the next click.

A click that didn't gets nothing, no colder sound or colour: Hot/cold's warnings were dropped for feeling like being told off, and the result's path is where those clicks are marked.

### Reduce motion and errors

Reduce motion draws no sparks and stops the bumps; the sounds still play.
Every effect swallows its errors like `play()`, since they run inside `navigate` and `finish`.

### The Effects checkbox

The Effects checkbox beside Timer (`#effectsToggle`, remembered as `mwr.effects`, on by default) stops the game's own effects when unticked (`effectsOn`):

- the click's sparks (the count still bumps)
- a result's XP orbs (the bar fills at once)
- the dead link's puff
- the checkpoint's and find's bursts
- Distance's sparkle
- every firework of a celebration, those already waiting too.

The items' stay (`ITEM_EFFECTS`: a blast's explosion and a thing's puff, and the Firework Rocket's firework), since using an item asks for them.
Sounds are the Sound box's.
While motion is reduced the Effects checkbox shows unticked and can't be changed, with a tooltip saying why, and comes back as it was set.

## Timer

The Timer checkbox beside Sound (`#timerToggle`, remembered as `mwr.timer`) is for relaxed play.
It is on by default, since the game is a race: clicks and time are its score, and the daily is meant for comparing results.
`startGame` copies it into `game.timed`, so a game is timed or not throughout, and there is no switch in the game header.

An untimed game hides the clock (`#hudTimeStat`, and no interval updating it), says nothing about time in the Give-up dialog or the peek, and its result has only the Clicks and Par tiles (`.tiles.untimed`).

The clock still runs underneath, which keeps `navigate` and the pauses as they are, but `finish` records no `ms`, so the result, its personal-best note, Share and the daily box say clicks alone (`wonText`), and Recent games shows a dash for its time.

## Reduce motion

### The setting

The Reduce motion checkbox beside Effects (`#motionToggle`, remembered as `mwr.reduceMotion`, off by default) stops everything that moves by itself.
It is on in effect while the system asks for reduced motion (`SYSTEM_CALM`), which ticks the box and holds it, with a tooltip saying why; `calm()` is either.
`setCalm` saves it and `syncCalm` sets the box and the `calm` class on `:root`, which turns off the banners', the checkpoint flash's and the bumps' animations and slows the busy dots.

### What stops

While it is on:

- there are no sparks (see Effects)
- the background draws still frames only, drawn on a change: no drift, pulses, rolling or cursor, the wave already passed, and the facts line doesn't change by itself.

Ticking it, or the system's setting changing, marks the cards again (`bgPair`).
It is the one setting on the setup screen outside the Background box that leaves Roll by itself on (the items and the note block's pick do too).

### Moving pictures

It also stills the game's own pictures that move (`stillPictures`): a GIF or WebP from the wiki shows its first frame instead. Those are:

- about one card picture in twelve (Chest, Campfire, Fire…)
- a few advancements' (Compass, Clock, End Crystal…)
- the end crystal and the ghast.

The first frame is drawn once into a canvas (`firstFrame`; the wiki's pictures allow it) and kept by address, with its own address kept (`data-moving`) to go back to when it is unticked.
While it is on, a watcher stills pictures as they come (a card rolled, a toast).

### In the article

In the article, the crafting grids and other boxes the game cycles (see [rendering.md](rendering.md)) hold still, each with a ↻ button beside it to move it on, since a click on a slot is its link's.
The wiki's own animated pictures in the article stay as the wiki shows them: some show a mechanic working, and the wiki doesn't stop them either.

## Background

Behind the setup screen is a picture of the wiki on a fixed canvas (`#bgCanvas`), picked in the Background box at the top right (`#bgOpts`, a `<details>` beside ⚙ Settings; on a phone it opens in the page).
All of it is worked out in the page from `wiki-data.js` and the link graph, which the setup screen loads for par anyway: no generated file holds any of it.

### The pictures

- *Constellation* (`buildSky`): the 64 best-linked pool articles of each topic as stars, sized by how many articles link to them, each joined by a line to the three it links with (either way) that share the most links with it.
  - Each topic is laid out on its own (Fruchterman-Reingold, seeded, so the sky is the same on every visit) into a disc with a faint nebula, the five discs around the screen (`SKY_DISCS`), so lines between topics cross it.
  - It is made in an idle moment the first time it shows once the graph is in (not for the map or Off), and turns a quarter on an upright screen.
  - The best-linked stars are named where the names don't overlap, and pulses (`skyPulse`) play games of their own along the links, from a star to one at least three clicks away, naming the star they start from and, once there, the one they reach.
  - A star shows one name at a time, always above it: a start or target marker's first, then the cursor's, then a pulse's, then its plain label, and the plain labels also keep clear of the markers' and pulses' names.
- On both pictures a name (a star's, a pulse's, the cursor's or a marker's label) that would be under what covers the background, even in part, or past the screen's edge, is left out (`bgClear`), as half a name reads as broken text; a marker keeps its ring.
  - What covers it (`bgCovers`, measured at each paint): the setup screen's cards, tiles, panels and buttons (`BG_COVERS`), and the lines of its text straight on the picture, as far as their words go (`BG_TEXT`); in Background only, its box, button and facts line.
  - With motion reduced the picture is painted again as the page scrolls (once a frame), since what covers it moved.
- *Redstone map* (`buildGrid`): every article but the subpages and spin-off pages (`MAP_PAGES`) as one block, laid along a Gilbert curve (a Hilbert curve for any rectangle) sized to the screen, in patches of about 40 of one group (each topic, the Content families together, the rest), with every group's patches spread along the curve, so it reads as a world map's biomes.
  - A block is brighter the more articles link to it.
- *Auto*, the default, is the constellation, and the redstone map at a phone's width (720 px and below, `BG_PHONE`), where the clusters are cramped.
- *Off* hides the canvas and the facts line.

### What it marks

What it marks (`bgPair`, called by `setupPar` whenever par is worked out again, so on any change of the cards, rules, difficulty or Content):

- the cards in use, each labelled with its card's tag (`cardBox`)
- nothing past the start under Blind target.

### Settings

Its settings, as checkboxes in the box:

- *Wave from the start* (off by default): every page lights at its clicks from the start (`distancesFrom`, so as the target par counts them, under the setup's difficulty and Content, with the cards marked kept as par keeps them, so a hub card on Hard is reached), spread a little within each click so it ripples (`makeWave`):
  - a flash as it arrives, then a glow that weakens with each click, like a redstone signal (`waveLight`).
  - A stop after the start shows faint until the wave reaches it.
- *Show the route (spoiler)* (off by default): the setup's par route (`setup.route`, kept by `setupPar`, and none under Blind target), dashed.
- *Roll by itself* (on by default): the background marks pool pairs of its own (`bgRoll`), in grey (`pair.rolled`), so only the cards' markers have their colours (the start's accent, the target's `--target`), at least two clicks apart on the setup's difficulty, with their wave and route as the settings say, a new one once the wave has settled. A roll given up for the cards (Reduce motion ticked while it waits for the graph) leaves the next to come as soon as it may.
  - Any change on the setup screen outside the Background box, Reduce motion and the items' button (a click on a button, link or control, a change, typing) turns it off (`bgSetting`), saved, so it stays off until it is ticked again.
  - The background then follows the cards.

### The cursor

The cursor, with a mouse or pen (by the pointer's own type, so a mouse on a touch screen counts too; a touch is ignored) and motion not reduced (`bgFollows`):

- on the constellation the stars within 120 px make way, the more the nearer (`bgLens`), and the nearest within 60 px brightens and shows its name (its plain label or a pulse's name giving way, and a marked star keeping its marker's label instead), with its lines lit in its topic's colour (`bgNamed`)
- on the redstone map a torch lights the blocks around it, light 8 on its block and a level less each block away, counted along the rows and columns as the game counts light (`TORCH_DARK`, `TORCH_LIGHT`).

The cursor follows the pointer anywhere on the page (the canvas lets clicks through, so the document tracks it), which only shows where the background does, and goes when the pointer leaves the window.
`bg.glow` eases it in and out, and each star eases its own push and name (`bgEase`), so nothing jumps.

### The facts line

The facts line (`#bgFacts`, above the footer, `bgNextFact`) changes every 7 seconds, and waits while it is hidden (in play, or Off).

The wiki's facts (`bgFacts`):

- the snapshot's pages and date
- the most linked page
- each topic's size and best-linked article
- once the graph is in:
  - the links between the pages
  - the page linking to the most
  - how many have no link to them outside a navbox
- how far apart pool articles are on the setup's difficulty (`bgSample`: from 40 seeded starts to every pool article, a start in each idle moment, kept per difficulty, and not worked out while the background is Off):
  - the average
  - the share 2 clicks or fewer apart
  - the farthest pair.

Once the cards are known their facts take turns with those (`bgPairFacts`):

- the start's links each way and how many pages are 1 and 2 clicks from it
- the target's links, never under Blind target.

### Background only

*Background only* (`bgView`): the round button fixed in the setup screen's bottom right corner (`#btnBgView`, ✦, hidden with Off; beside the title on a phone, but back in the corner while the background shows, clear of the Background box) hides everything on the setup screen but:

- the Background box, open and fixed at the top right
- the facts line, fixed along the bottom
- itself, now ✕.

This is class `bg-view` on `<body>`: `visibility`, unlike `display`, lets those three show inside the hidden screen, and the page doesn't scroll.

The picture is 1.6 times as strong there, up to full strength (`bgTheme`), with nothing to read in front of it.
The button again (its tooltip "Back to the setup screen (Esc)"), or Escape, brings the screen back, and so does picking Off, or a game starting (`bgShow`).
The button sits under a modal (`z-index` 5).
Neither the button nor the box counts as a change for Roll by itself, so the background keeps showing pairs of its own.

### Drawing

The background draws about 30 frames a second (`bgFrame`) while the setup screen shows and the page is in view: `startGame` and `toSetup` call `bgShow`.

Each frame costs a few milliseconds even where the canvas has no GPU:

- the constellation's nebulae, where its stars sit when still, are drawn once for the canvas's size and the theme and copied in (`skyNebulae`)
- the constellation's links are a device pixel wide, as strong as two, since wider lines and the gradients took several times the rest of a frame there.

The canvas has as many pixels as the screen, up to twice the page's (`bgDpr`), checked at every frame, since a window moved to another screen may keep its size.

Text straight on the background on the setup screen has a halo of `--bg`, so the picture never cuts into it, but not while the page is in pieces (see [items.md](items.md)).

## The game header

### Labels

The game header (`renderObjective`, redrawn when the objective changes) has the game and its extra rules as labels (`#hudTags`) with how far along it is ("1 of 2 checkpoints reached", "Found 1 of 3", "On the way back", Exact clicks's "Land on the target with your last click, not before"), and with Distance on the latest arrival's count beside them (`#hudHint`, from `renderHud`).

### The route

Under them is the route (`#hudRoute`): every stop as a chip, joined by arrows:

- done (✓, a button)
- now (the objective, holding `#hudImg`, `#hudLbl` and `#hudGoal`)
- or ahead (dashed).

For Scavenger the things to find, found ones ticked with what found them.

A route of more than `ROUTE_FULL` (3) stops shrinks the done chips to their ✓ (their names stay in a tooltip), and a click on one opens them all (`.route.open`).
A long name (Chaos rolls titles of 60 letters) ends in … at 18em or 40% of the window, whichever is less, so a start and a target fit the row on a wide screen; every chip's tooltip has the whole of it (`full`), but a Blind target's ?.
The row scrolls sideways when it still doesn't fit, kept on the objective by `scrollRouteToNow` (also on resize).
The ? button beside it is the peek: the objective's picture and description under its label and name ("Target: Zombie", or "Back to Diamond" on a round trip's way home), or Scavenger's list of what is left. Its button says "Back to the hunt" in Scavenger and "Back to the article" otherwise.

### The right side

On the right are:

- the clicks (with a limit, "of 6" or "of exactly 4" and a dot a click)
- par (`#hudParStat`; see [par.md](par.md))
- time (unless the Timer is off)
- sound
- Back
- Give up.

## Phones

### 720 px and below

At 720 px and below:

- the setup cards stack
- the options at the top wrap
- the corner's buttons (the note block's, the items' and Background only's) sit in a row beside the title, scrolling with the page, since there is no room for them beside it
- the Background box opens in the page
- Auto's background is the redstone map
- Start game spans the width
- Recent games shows each game as a card (the labels and the day, the route, the result and time) instead of table columns.

### Upright and short screens

On a phone held upright (also taller than 500 px):

- the game header puts the labels, with the progress and Distance's hint after them on one line, and the route on their own rows, above one row of clicks, par, time, sound, Back and Give up, a little smaller; the items' and the note block's buttons move into the path's line beside Hide (`placeHudToys`, by `PHONE_UPRIGHT`, and back when the screen turns), so that row fits a 360 px phone with Six clicks's dots and a two-digit count
- Back shows only its arrow
- the path sidebar becomes one line of breadcrumbs that scrolls sideways, kept at its newest entry by `scrollPathToEnd` (also on resize, as turning the phone switches layouts), with a faded left edge while there is more to the left (`markPathScroll`), the items' and note block's buttons and Hide beside it and the credit under it.

Any screen 500 px tall or less, such as a phone on its side, keeps the sidebar at 160 px instead.

### Touch screens and height

On touch screens (`pointer: coarse`) inputs use 16 px text so iOS doesn't zoom on focus and the small controls are bigger.
The game is `100dvh` tall so phone toolbars don't cover it.

### Inside the frame

Inside the frame the article's padding narrows below 600 px, and the hover tint only applies with `(hover: hover)`, since on a touch screen it would stay on the tapped link.
The wiki's own CSS already makes wide tables scroll sideways.
