# Items

For people: [how-to-play.md](../how-to-play.md#items).

Part of the architecture, which is all in `index.html` (the Items section, after Advancements).

Items are toys that act on the real page: they blow it up, all but the Firework Rocket, which puts on a show (see [Fireworks](#fireworks)).

A blast throws the pieces of the page around it, the article's included, and plays Minecraft's explosion. Things near it go off, break or are knocked away, as they would in Minecraft.

The rest of the page goes on working, and several blasts can follow one another. Rebuild puts the pieces back, and in a game Give up is beside it. Using items never counts against the player.

## The hotbar and holding an item

### The buttons

- The hotbar's button is `#hudItems` in the game header, and `#btnItems` on the setup screen.
- `#btnItems` is fixed above the background's button `#btnBgView`, or in its place when that is hidden (the background Off), with the note block's button above it (see [ui.md](ui.md#note-block)).
- Both show the wiki's TNT picture, or say TNT if it doesn't come.

### The hotbar

`openHotbar` opens Minecraft's hotbar under or over the button with the seven `ITEMS`.
- Each is named in Minecraft's tooltip on hover or focus, which also lights its slot white as a container's does.
- The item in hand is in the hotbar's selection frame.

The hotbar is drawn in the hotbar's pixels, 3 px each (2 px on a phone), and its textures are the wiki's:
- `Hotbar.png` (twice the hotbar's size there, drawn back at its own)
- `Hotbar selection.png`
- `Tooltip background.png`
- `Tooltip frame.png`

The textures are asked for with the note block window's (`GUI_FILES`, `guiTextures`) when either first opens, and set as CSS variables once all are in (`:root.gui-textured`).

Until then, or if any doesn't come (asked again at the next opening), the hotbar is a plain dark bar, the item in hand framed white and the tooltips plain dark boxes.

### Holding an item

Picking one calls `holdItem`.

The item follows a mouse or pen (`.ghost`), but not a finger, which has no pointer to follow between taps (`items.touch`, from the last pointer's type), over a layer (`.hold`) that takes every click anywhere, the article included.

- Each click uses the item there (`ITEM_USE`), so TNT can be placed again and again.
- A click on something already placed uses that instead: it lights a TNT, hits a crystal or a fireball, sleeps in a bed or charges an anchor.
- A line at the top (`.hold-tip`, under the game header in play) says what clicks do, taps with a finger.

A right click or Escape, in the page or the article (the frame posts its keys), puts the item away (`dropItem`), as do:
- the ✕ at the end of the line, for a finger, which has neither;
- picking it again in the hotbar, which frames the one in hand (`.held`) as Minecraft's does.

Taking an item in hand also gets ready for a blast:
- the text in view is split into pieces now (`breaker.prepare`, and in the frame `{mwr:'arm'}`), which a blast would otherwise have to do first;
- the explosion's frames and sounds start loading.

The layer covers the bar and the hotbar's buttons, so a click over one of them is passed to it, and goes no further, or the hotbar it opens would close at once.

A thing scrolled out of the article (out of sight) takes no clicks and no blasts.

## The items

### Things on the page

Things placed on the page are fixed over it (`placeThing`, `items.things`, each `{ el, kind, p }`, `p` its middle on the screen).

- They can't be selected or dragged however often they are clicked: `user-select: none`, and `pointerdown` is cancelled.
- `moveThing` moves one (knocked away, drifting off) and removes it once it is off the screen, unless moved again first.
- While it moves, where it is is read off the screen (`whereNow`), so a blast reaches it where it has got to, not where it is going, and one out of its reach leaves it going there.

A placed block (TNT, crystal, bed, anchor) sits on what it was placed on (`anchorThing`, `t.anchor`), so a blast starts where it is seen:
- On the setup screen it scrolls with the page.
- Over the article it scrolls with the article in its frame, which reports its scroll a frame at a time (`{mwr:'scroll', x, y}`, `items.frameScroll`).
  - Scrolled out of the frame, it is out of sight.
  - A click to another article takes the blocks on this one with it, lit TNT and all.
- Elsewhere (the game header, the path) it stays on the screen.

`positionThings` puts them in place on each scroll. Creatures and fireballs move about the screen.

While an item is in hand or the page is in pieces, the article can't get the wheel itself, so the page passes it on (`{mwr:'scrollBy', x, y}`).

### Each item

- *TNT*: placed unlit. A click lights it (`lightTnt`): it flashes and hisses, and goes off 4 s later.
- *End crystal*: the wiki's animated picture of it turning above its bedrock base. It goes off the moment it is hit, the biggest blast.
- *Ghast fireball*: taking it in hand brings a ghast in from the side of the screen away from the pointer (`spawnGhast`), and each click is where it aims, or a new ghast comes if the last one died.
  - The fireball flies at 900 px a second, so a near aim lands sooner.
  - Hit in flight, it goes back to the ghast at 1200 px a second and blows up on it ("Return to sender!").
  - The ghast faces the page it fires at, and turns left to leave.
  - Putting the fireball away sends the ghast off its own side of the screen, facing the way it goes (`ghastLeaves`). It waits first while any fireball is in flight, so one sent back still finds it, and 1.5 s after its last shot. Then it floats off at 160 px a second until it is gone.
  - Taking the fireball up again before then calls it back to its place, and a blast it is knocked back by leaves it on its way again.
  - Taking a fireball in hand again keeps it.
- *Creeper*: walks in from the far side, facing the way it walks (its picture faces left, so it is flipped going right), and follows the pointer (`items.pointer`; over the article the frame reports it, `{mwr:'move', x, y}`, at most every 40 ms).
  - Within 70 px it hisses, swells and flashes for 1.5 s unless the pointer gets more than 150 px away, then blows.
  - A hit knocks it back and stops the fuse.
- *Bed*: clicked, "You can't sleep here", and it blows at once.
- *Respawn anchor*: each click charges it, with the wiki's picture for its charge (0 to 4). Full, the next click sets your spawn, "in the Overworld", and it blows at once.
- *Firework Rocket*: each click launches a firework from there, 220 to 360 px up (over the article, no higher than shows its burst whole inside the frame).
  - It breaks nothing: no blast, no Rebuild.
  - With motion reduced, only its sounds.

## A blast

### Sound, flash and shake

`blast(p, power)` plays one of Minecraft's explosion sounds (`SOUNDS.explode`, see [ui.md](ui.md)), with Minecraft's explosion on the effects canvas (`EFFECTS.blast`), a white flash (`.blast-flash`) and a shake (`.blast-shake`).

The shake moves the page's own content, the screen's children that aren't fixed, not the body: a moved element holds the fixed ones in it to itself, so the toys, the buttons, the bar and the explosion would jump to the top of a scrolled page while it shook.

### The explosion

The explosion is made the way Minecraft's emitter makes it: puffs around the blast for 8 ticks, each playing the 16 frames once in 6 to 10 ticks (a tick is 50 ms), with grey debris.

- The frames are the wiki's explosion textures, drawn at 16 px in four greys (`boomFrames`), since Minecraft tints each puff a random grey.
- Without them there is only the debris.

The explosion, and a thing's puff as it dies or breaks, stays on what it went off on (`anchorOf`, as placed blocks do, above): the setup page, or the article where it is over its frame, drawn only over the frame.

Each of its sparks keeps that scroll as it was (`fxOn`) and `fxFrame` draws it moved by as much as it has scrolled since.

With motion reduced there is none of this but the sound, and the lit TNT and a hissing creeper don't flash.

### What a blast reaches

Its reach is `BLAST_REACH` (220 px) × power. What it reaches reacts as in Minecraft, more strongly the nearer it is:
- Unlit TNT is lit, with a fuse of 0.3 s at the blast to 1.8 s at the edge of its reach. Lit TNT is knocked away.
- A crystal goes off at once.
- A bed breaks, in a puff of its colours.
- A creeper dies if near (within 60% of the reach), else it is knocked back.
- A ghast dies unless at the very edge.
- A respawn anchor stands, since it is blast proof.

### The TNT article's easter egg

An easter egg: on the TNT article a blast that reaches the infobox's big picture of TNT lights it, as a blast lights TNT in Minecraft (the frame's `tntEgg`, told it is the TNT article by `{mwr:'boom', egg}`).

- It hisses and flashes where it is, kept whole (`.mwr-lit`, with motion reduced not flashing), for 0.5 to 1.5 s: the frame posts `{mwr:'tntEgg', lit, ms}` with the fuse it picked, and the page hisses that long.
- Then the frame posts `{mwr:'tntEgg', x, y}` and the page blows it up at power 2.6, bigger than any item, earning Light Reading.
- Once, until Rebuild puts it back, unlit if its fuse is still burning.

### Counting blasts

Every blast counts toward the advancements (`adv.blasts`), and the times of the latest are kept (`items.recent`) for Chain Reaction.

The first blast on a whole page shows `#rebuildBar` at the bottom of the screen (`items.broken`).

## Breaking the page

`pageBreaker()` makes the code that breaks a page up. It is one function, so the article's frame gets the same code as its source text (`renderArticle` writes `(${pageBreaker})()` into the frame script) and runs it on its own pieces when the page posts it a blast (`{mwr:'boom', x, y, power, still}`, in the frame's coordinates).

### Finding the pieces: `prepare`

`prepare(root, keep, region)` finds the pieces in a region, a circle on the screen.
- Taking an item in hand prepares what is in view, so its text is split ahead of a blast.
- Each blast finds its own pieces around it (its reach and 40 px more), wherever the page is scrolled.

It goes from the root down:
- A box bigger than 160 × 80 px gives its children, and its own text as pieces of up to four words, each on one line (`.brk-word`).
- An inline element with text that goes over a line's end does the same, since as an inline block it couldn't break there and the text would be laid out anew.
- A piece already thrown stays one piece (turned, it can measure as big, and its own pieces would fly on top of its throw, far off the page), and a box holding one gives its other pieces rather than taking it along.
- The spaces between pieces are left out of them, since a piece's own edge spaces would collapse once it is an inline block.
- In a flex or grid box each run of text is one item, so its pieces go in an element of their own (`.brk-run`) that takes its place, or each piece would be an item of its own.
- The pieces are elements of our own (`<brk-word>`, `<brk-run>`), inline as a span is but out of reach of any style the page has for spans: the setup screen's rules make theirs columns, which made the page longer as soon as an item was in hand.

`prepare` stops at `MAX` (700) pieces.

Every box, and every word's line, is measured before any text is split, so the page is laid out once. That, and splitting the text in view ahead of the blast, is what lets the pieces fly the moment it goes off.

### Throwing the pieces: `breakApart`

`breakApart` throws the pieces the blast reaches, by their nearest edge, and throws again those already thrown that it reaches. Each piece:
- flies harder the nearer it is, as the shockwave gets to it (6 px a millisecond),
- falls under gravity onto what is left of the page below it, by its extent as it is turned so not even a corner goes in (nor, turning as it rises off a bounce, below the page's end),
- bounces and comes to rest.

Pieces at rest fall further when a later blast takes away what they rest on.

With motion reduced (`still`) the pieces fade where they are instead.

#### Surfaces

- A surface is any intact element with text of its own, or a picture or control (but not a faded picture behind things).
- Surfaces are found again at every blast (`findSurfaces`), in the page's own coordinates so they hold however it is scrolled, by columns 32 px wide with each column's tops sorted, so a falling piece checks only its own columns (`landing`).
- Below them all is the bottom of the page as it was before the first blast, so pieces can't make it longer.

#### No sideways scrolling

The first blast also stops the page scrolling sideways (`overflow-x`, `sideways`), so pieces flying off the side can't make it wider. It goes on what scrolls the page:
- `<html>` if it has an overflow of its own,
- else the body if it has (the wiki's pages, whose body scrolls),
- else (the game's own page) `<html>`, with the body clipping the pieces besides (`clip`, which makes no scrolling box).

Hidden alone, they would still count as the page's content, and a phone, or a browser's phone view, lays the page out as wide as that.

That goes on what decides the page's scrolling: the body when `<html>` has no overflow of its own, as on the wiki's pages, since one on `<html>` would make the body a scrolling box of its own, back at the top and out of the wheel's reach.

Rebuild gives both back.

#### Thrown pieces

- Thrown pieces carry `brk-thrown`.
- A thrown piece takes no clicks, and loses its text shadow, which is costly to repaint as it moves (the setup screen's made Rebuild drop to a few frames a second).
- While anything is broken the setup screen's text loses its halo too (`html.broken`), since the halo drawn again around every piece falling past held the fall to about 33 frames a second, with frames of up to 130 ms.
- An inline piece is made an inline block to be turned.
  - Unless it is a picture or a control, it keeps the height of all it holds, with its line inside no taller, so its text doesn't hang out past where it lands.
  - If it sat on the line, it goes to the line's top, since as a block its own line could be taller than the one it is on.

Once all this is set, where each piece now is is measured again, so it lands where it should even if it moved.

#### Boxes around thrown pieces

- A box any of whose pieces are thrown keeps the size it had (`frozen`), so nothing after it on the page moves.
  - Not a box shown inline, which has no size of its own, nor a table's, whose sizes are only the least it may be: setting them lays it out anew.
- The window made wider or narrower while the page is in pieces (`relayout`, from a `resize` that changes the width, 200 ms after the last; a change of height alone, as a phone's address bar showing or hiding, changes nothing):
  - the kept boxes go back to their own sizes, an emptied one clamped and clipping as it was, and keep the size they have then.
  - The page's end is noted again: where its root's children end now (`end`, which pieces thrown past them don't move), and what was below them at the first blast (`tail`).
  - Then every piece falls again onto what is there now (`settle`), the page and the article alike, each running its own.
  - Laid out narrower, a page in pieces can end a little lower than it would whole, since its pieces of four words can't break where its words would.
- Such a box also stops clipping or scrolling (`overflow`, `contain`, `clip-path`), so the infobox can't keep its pieces in a scrolling box of its own.
  - A block that was a layout of its own only by clipping, like the wiki's `overflow-x: auto` boxes around its tables, becomes a `flow-root`, or its children's margins would go through it and move what is below.
- A box all of whose pieces are thrown also loses its background, border, outline and shadow, so no empty shell is left (`emptied`).
  - It stops being clamped, so a setup card's ellipsis doesn't stay behind.
  - A table's collapsed borders are drawn by the table where its cells were, so its rows and cells lose theirs too.
- All of these are set as important styles, since some of the wiki's are.
- A piece the page re-renders since (the path list, the header's route) simply comes back whole.

### Putting the pieces back: `putBack`

`putBack` puts every piece back, flying, or at once, and makes the text whole again.
- Only the pieces that moved fly, and everything is restored together once they are in, so the page is laid out once rather than hundreds of times.
- A blast while they fly back breaks nothing.

### What stays whole

What stays whole (`keepWhole`, a selector, so a box holding one of them gives its other pieces rather than going as one):
- the article's frame,
- the checkpoint banner,
- the loading overlay,
- the hotbar's buttons,
- the background's button,
- the facts line.

## Rebuild, or Give up

While pieces are down the page takes no clicks (`html.broken`), the article included.

Nor does it select anything, while pieces are down or an item is in hand, however fast it is clicked or dragged on (`user-select: none` on the body), but in a window (`.overlay`), and a blast clears what was selected, so it doesn't fly highlighted.

The exceptions are the hotbar's buttons and the article's loading overlay (Retry, Cancel); the things on the page, the hotbar and the bar are outside it and work as usual.

A game goes on, its clock running, and the page and the article can still be scrolled with the wheel.

Once Rebuild's pieces are in place, the page takes clicks again. Until then (`items.mending`), a blast breaks nothing, so a TNT going off during it can't leave a whole page marked broken.

`#rebuildBar` at the bottom of the screen has Rebuild, and in a game Give up (`#btnBrokenGiveUp`).

- *Rebuild* (`rebuild`) puts every piece back, flying, to an anvil's repair (`Anvil use.ogg`), and the article's too (`{mwr:'rebuild'}`). In a game it marks `game.rebuilt`, for an advancement.
- *Give up* ends the game as giving up would (`finish(false)`), without asking first, since the bar is the choice.

The bar is 16 px above the bottom of the window, 32 px on a phone, clear of a browser's own bar there, and of the home bar where there is one (`env(safe-area-inset-bottom)`).

`itemsReset` clears everything on the page and puts any pieces back at once whenever a game ends or starts, or the setup screen comes back.

## Advancements

The Items group (see [advancements.md](advancements.md)):
- Kaboom! is any blast.
- Intentional Game Design is a bed's or a full respawn anchor's.
- Return to Sender is a fireball sent back.
- Shoo! is a hissing creeper knocked back.
- Chain Reaction is three blasts within 3 s.
- Good as New is a Rebuild.
- Demolition Expert is 50 blasts.
- Picking Up the Pieces is a win after a Rebuild.
- Light Reading, a secret, is the TNT article's own TNT set off (see [A blast](#a-blast)).

## Fireworks

Fireworks are Minecraft's, as its rockets and firework stars make them.

### The rocket and its burst

`launchFirework(from, to, stars, on)` sends a rocket (the wiki's picture of it) from one point of the window to another, rising faster and faster (30 px a second, then 450 px a second more each second), on a trail of white sparks thrown down at half its speed.

There it bursts into each of its stars (`fwBurst`, `{ shape, colors, trail, twinkle }`), with Minecraft's blast sound, or its large blast for a large ball.

The sparks are thrown as Minecraft throws them (`FW_SHAPES`, in blocks a tick, `FW_SPEED` px a second each):
- a small or a large ball, on a cube's shell pulled round (`fwBall`);
- a star or a creeper's face, along its outline, mirrored, three times turned a little about its middle (`fwShape`, `FW_STAR`, `FW_CREEPER`), facing the window more or less;
- a burst, thrown up like a fountain.

### Sparks

- Each spark is one of the star's colours, from the dyes' firework colours but those too dark to see (`FW_COLORS`).
- A spark slows as Minecraft's do (0.91 a tick), drifts down, and lives 2.4 to 3 s, shrinking through the spark texture's 7 frames, which are white and grey and tinted by multiplying them by its colour, once for each colour (`fwFrames`).
- A twinkling one flickers from a third of its way, and its burst twinkles 1.2 s after (Minecraft's twinkle).
- A trailing one leaves a still copy of itself every 100 ms through the first half of its life (`fwTrail`), while there are fewer than 2,500 sparks.

The sparks are all on the effects canvas (see [ui.md](ui.md)), a rocket's sparks on what it went up from.

### Celebrations

`celebrate` launches a volley from below the window, bursting around a point, spread to the sides, a rocket every 300 ms:
- three for a win, around the result's heading;
- six for a new best, large balls and stars in yellow, orange and white, all twinkling;
- and after either, for a daily's first win (none before in `mwr.dailies`), a lime creeper in the middle with two small ones.

A challenge's toast gets one, bursting below it (see [advancements.md](advancements.md)).

Each waits up to 1.5 s for the pictures, and none goes up with motion reduced by then.

## Pictures and sounds from the wiki

### Pictures and files

`itemPictures` asks once, in an idle moment after the page loads, for the items' pictures (`prop=pageimages`, as the cards ask), since the hotbar's buttons show TNT's.

`itemAssets` asks, when the hotbar first opens, for the addresses of `ITEM_FILES` (`prop=imageinfo`). The files are:
- the end crystal's animation,
- the respawn anchor at each charge,
- the explosion's 16 textures,
- for fireworks, the rocket and the spark's 7 frames.

The textures and sounds themselves only load when an item is first taken in hand, or for fireworks when one is first wanted (`fireworkAssets`), which a win asks for with the files' addresses alone (`itemFileUrls`), not the hotbar's pictures.

### Sounds

The items' sounds are Minecraft's, from the wiki with the game's (see [ui.md](ui.md)):
- the explosion's four, pitched down at random,
- TNT's fuse (a creeper's half as high),
- a block placed by its own sound at 0.8 (TNT's grass, a bed's wood, an anchor's stone),
- the ghast's warning and its shot,
- a weak hit for a crystal, a fireball or a creeper hit,
- an anchor charging,
- a creeper's or ghast's death or a bed breaking (wood),
- a firework's launch, blast, large blast and twinkle,
- Rebuild's anvil.

An end crystal is placed without a sound, as in Minecraft.

### When one doesn't come

A picture that doesn't come shows its emoji (`ITEM_EMOJI`), and a sound that doesn't a synthesized rumble, whoosh or pop.

Without the spark's frames, fireworks are squares of their colours.
