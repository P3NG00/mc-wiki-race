# Testing

For people: [development.md](../development.md).

## Live suite (`test/e2e.mjs`)

`test/run-e2e.sh [--offline] [screenshot-dir]` starts headless Firefox with WebDriver BiDi and runs `test/e2e.mjs`.
The test opens `index.html` from `file://` and plays a real game against the live wiki, saving screenshots to `screenshot-dir` if one is given (`shot`), made if it isn't there.
What it checks, by area:

### Loading, sounds and textures

- Challenge-hash load
- Every sound the game plays being a file on the wiki (a renamed one would quietly fall back to the synthesized sound)
- The note block's window getting a picture for every block and head
- The note and Minecraft's GUI textures (`:root.gui-textured`, which a renamed file would quietly leave plain)

### Rendering and navigation

- Rendering, with the wiki's stylesheets loaded
- Link classification
- The hover tint on live links (a real pointer move over BiDi)
- Links to visited articles being marked
- Navigation
- The crafting grid:
  - the crafting grid's slots cycling and holding still under the pointer, and with motion reduced holding still
  - the button beside the grid, Show the next picture, moving the slots on
  - the slot under the pointer showing its item in a Minecraft-style tooltip that goes with the pointer
  - a slot linking an article on the path saying so in its tooltip
- The infobox's tabs showing one panel and switching
- Back served from the parse cache
- Switching the article's theme in place (also mid-load)
- Collapsing the path sidebar (the credit stays, remembered across reloads)
- The phone layout at 390 px:
  - header and "what is it?" not overlapping
  - the path on one line
  - no sideways page scroll
  - a wide wiki table scrolling within itself
- The win condition
- The result scoring the win against par and showing a route
- Escape handling

### Rules and difficulty

- The No Back rule: in the challenge link and the result, and kept out of the personal best of games without it
- The difficulty:
  - a link's rules giving its difficulty
  - none being Relaxed and No hubs alone Hard
  - the extra rules without its two rules
  - Normal by default
  - the settings text naming it unless Normal
- The No hubs rule:
  - every hub link and redirect in the article text dead
  - a hub target live
- Links to left-out pages dead
- The Blind target rule: a link's target held unseen on the card with par hidden, then named in the HUD with no picture there or behind the path
- The Six clicks rule: lost on the sixth click, recorded as `outOfClicks`
- The No navboxes rule
- The Checkpoint rule with one checkpoint:
  - card shown and hidden
  - the target not counting before the checkpoint
  - the target passed before it not marked as seen
  - the HUD and the picture behind the path switching objective
  - reaching it being celebrated
  - the checkpoint in the link, the record and the personal-best key
- Scavenger: a real article coming with its live categories, and a member of a kind being a find
- Top links only on a real article:
  - the bar over the first section heading, outside the live wiki's table of contents, which the ZIM lacks
  - the rest folded away
  - every live link above the bar

### Rolls and pools

- Random rolls in all four pools (asking the wiki only for page info)
- The request limit (ten requests sent at once, with no more than `API_CONCURRENCY` in flight)
- Descriptions taken from the intro's first paragraph rather than an infobox caption
- Book and comic objects
- Joke and removed features being left out of the pool
- Each pool keeping to its tier with the start and target from different topics (with `planGroups` and `candidate` called directly)
- A Chaos target linked well enough to be reached (`MIN_BACKLINKS`)
- A topic target (recorded with the result)
- The daily's cards from different topics

### Content and Spin-offs

Content and Spin-offs:

- Everyday rolling Dungeons pages only with Dungeons on
- Chaos fixing the Content boxes as ticked and giving them back
- All's dash and switching every spin-off
- Links into a spin-off dead when it is off, and live, its version pages aside, when it is on or a card's page is in it
- A challenge link starting on a spin-off page
- The record and its settings text
- History with an unknown Content key being left out

### The daily pair and rule

- Deterministic
- Its checkpoints on a Checkpoint day
- Overriding the hash's rules
- Recorded, marked in the history
- Left by New game without a notice, and by changing a rule or the difficulty, swapping the cards or rerolling one, with the same notice each time
- Normal plus one rule; No hubs making it Hard
- A Six clicks day's par 4 or less

### Images and article markup

- A failed image being retried and one that fails twice hiding its alt text (requests intercepted over BiDi)
- A link fragment that opens an HTML comment and a script tag (the wiki renders one from `[[X#&lt;!--&lt;script&gt;]]`) not stopping the next article's scripts
- Interwiki titles
- The same-article guard
- Image-map links
- On Beacon:
  - Beacon's layered blueprint (choosing a layer hides the ones above it)
  - calculator placeholders being hidden
  - a speaker in its Sounds table playing and stopping (with a real click, since the browser only plays sound after one)
- Folding boxes on Bastion Remnant:
  - its File structure and a table of block links starting folded with `[show]`
  - a sortable table and a navbox open with `[hide]`, and a group inside the navbox folded
  - each toggle folding or opening its box without a click
  - the links inside working once opened

### Setup screen, history and challenge links

- A host-page theme (injected with a BiDi preload script) becoming the default
- Clear history (Cancel keeps it, confirming empties it)
- Challenge links carrying awkward titles (`&`, `+`, `?`, `%`, `/`, `:`, quotes, accents) intact through the sealed link, a real load of it and the frame's link reading
- Damaged history in storage (not a list, or entries that aren't records) being left out without stopping the setup screen

### Faked API failures

Faked API failures, by an intercept on `api.php` that fails a request or answers it with a made-up reply:

- a network error, HTTP 500, a MediaWiki error, a reply that isn't JSON and one with no article each offer Retry with the clock stopped
- Cancel on a failed start returns to setup
- a failed roll says so and the next one works

### Leaving the page and random play

- Leaving the page asking first during a game and not after it (Start pressed with a real click, since browsers only ask after one; BiDi accepts the dialog and reports it as `browsingContext.userPromptOpened`)
- Random play (below)

### Live pages it depends on

The test starts by asking the wiki itself for what its checks take from live pages by name:

- the pages it loads by title being articles under those titles (not redirects, since the checks compare the title shown)
- de:Diamant an interwiki title
- the links it clicks:
  - Diamond to Pickaxe and Diamond Pickaxe
  - Pickaxe to Diamond, Iron Pickaxe and Diamond Pickaxe
  - Diamond Pickaxe to Pickaxe
  - Blaze Rod to Blaze
- Diamond's link counts, Tutorial links, navboxes and text links to hubs and the Crafting hub
- Pickaxe's crafting output slot, a crafting slot linking Diamond and infobox tabs
- Beacon's layered blueprint, calculator and sounds
- Bastion Remnant's folded File structure, folded table of links, open `mw-collapsible` table and folded navbox groups
- Icons.png's image map
- Minecraft Dungeons' and Dungeons:Creeper's Dungeons links
- Blaze in Nether mobs
- Zombified Piglin's intro

An edit on the wiki that changes one fails there by name, so a check further down failing with it means picking another page that has it, not a bug in the game.

### Errors

The test also fails on any uncaught error or rejection in the page or the article frame, reported by a BiDi preload script whose listeners are on the window, so failed images, fonts and requests, which Firefox also logs as errors, don't count.

## Offline suite (`test/offline.mjs`)

`test/run-e2e.sh --offline` runs `test/offline.mjs` instead, in about three and a half minutes without network: every request to minecraft.wiki is answered by the test.

### Made-up replies

- Page info is made up, with the namespace number from `wiki-data.js` for spin-off pages (a title starting "No such " is missing).
- Every article is the same short page with:
  - a link in the text
  - a hub
  - a redirect to a hub
  - the target hub
  - a Tutorial page
  - a Dungeons page
  - a version page, and a redirect to one
  - a list page
  - a navbox link
- Stylesheets come back empty and images fail, and so do the articles a check names (`failParse`), as with no connection.
- A made-up redirect, Crafting recipe, leads to Crafting (`REDIRECTS`).
- Page info marks a title ending in "(disambiguation)" as a disambiguation page, as the wiki's does.

It checks the game's own logic, by area:

### The snapshot

The snapshot still holding what the checks take from it by name:

- Block and Crafting hubs, Blocks a redirect to Block
- the pages used being articles and not hubs
- Minecraft Dungeons an article, Dungeons:Creeper a Dungeons page
- Blaze, Sharpness and Potion of Swiftness in their kinds
- Chicken left out of Nether mobs
- Java Edition version history, Pocket Edition version history (a redirect to one) and Closed captions left out
- the made-up pages absent

So a new snapshot that changes one fails there by name rather than leaving a check passing without testing anything.

### Difficulty and the Timer

- Links by difficulty:
  - version and list pages and redirects to them dead in Relaxed and Hard, titled as off limits
  - a link to a page that doesn't exist, without the red link's class, dead and titled so, by the reply's links
  - hubs and redirects to them dead in Hard, titled as Hard's overview pages, the target's hub live
  - a navbox's and a requirement list's links dead in Hard, titled as counting as a navbox
  - no left-out page in the data
- A reroll, or the daily, while a typed-in title is looked up winning
- A left-out page typed in or named in a challenge link not taken, a typed-in one saying the game leaves it out, as it does a page that isn't an article, and one that doesn't exist saying there's no article by that name
- A disambiguation page typed in taken, with a heads-up
- A challenge link saying it's loaded, with its rules unless it's Normal with none
- A failure saying whose it is: the wiki's (an error it sent back, or no answer at all), the link data's (a graph file that doesn't load) or the game's (a card none of whose draws exists)
- The difficulty a link's rules give
- The Timer box:
  - on by default
  - off:
    - no clock in the header
    - no time in the result, Share or the record
    - a dash in the history
    - a win without a time beating another only on clicks

### Rolls

Rolls in every pool:

- tiers
- different topics
- the link minimum
- a target topic
- a card joining the web of links:
  - tried on pages the snapshot is searched for by their links, so a new one can't leave the check passing on a page that has changed, and failing if the snapshot has no page of a kind:
    - one whose links all go to hubs: a start on Normal but not Hard
    - one with no links: no start
    - one nothing links to: no target
  - the heart reaching and reached from almost all of the pool

### Live links and dead ends

- An article that fails to load mid-game: Cancel keeping the page you were on with the clock going again and Give up on, and Retry, once the wiki answers, loading it
- An article whose frame never says it's ready (the ready message dropped, the 15 s wait shortened) loading with the clock held and Give up off until then, then going on with both and no stuck banner
- Give up asking first, saying the time is paused, which it is; Keep going going on with the clock running; Give up ending the game given up; and without the Timer saying nothing of time
- A link redirecting to the target winning, its title seen as the target's
- A win headed You made it!, with the shortest route and its par
- A live link pressed with the mouse being asked for at the press and its click taking that request (one pressed and let go elsewhere asked for once, its later click asking no more)
- A page with no live links (a made-up page linking two hubs, on Hard) getting a banner that stays, to go Back or give up, or only give up on the start, and none on Normal
- Rerolls from the Pool row

### Items

The items:

- the hotbar's buttons showing TNT's picture or saying TNT
- the files waiting for the hotbar
- an item in hand following the pointer over a layer taking the clicks
- the article readied
- every click placing one until Escape
- TNT placed unlit
- a crystal hit blowing up the page around it and the article's pieces
- the game going on with Rebuild and Give up at the bottom and the clock running
- the blast lighting the TNT near it and not the far one
- breaking a bed and leaving a respawn anchor standing
- the lit TNT going off in a chain reaction
- a click lighting a placed TNT
- Rebuild putting every piece back, the article's too, and play going on to a win
- a bed slept in blowing at once
- Give up giving up with the page whole under the result, headed You gave up in grey
- the respawn anchor's four charges and its blast on the fifth click leaving the footer whole
- the pieces coming to rest on what is left of the page rather than the bottom of the window
- scrolled down, a blast breaking the page there too, its shake leaving what is fixed on the screen where it is
- an item in hand splitting the text in view without moving anything
- blasts all down the page and again on its pieces leaving it no longer, nor any wider (its pieces clipped, so a phone doesn't lay it out wider) and still scrolling down
- the page made narrower in pieces taking the new width and ending about where it would whole, and wide again ending as before
- a drag and fast clicks on the page in pieces or with an item in hand selecting nothing (real pointer input), and selecting again once it is put back and the item put down
- a blast's sparks staying on the page and the article as they scroll
- a firework rocket going up from a click on the page and breaking nothing
- on the TNT article a blast lighting its picture of TNT, which hisses as long as its fuse (the game's own hiss, the wiki's sound not being in) and goes off bigger and earns Light Reading (and not on another article)
- with motion reduced the pieces only fading
- the ✕ on the tip and picking it again in the hotbar putting the item away
- with a finger the item in hand not shown and the tip saying tap
- the ghast:
  - the ghast coming with the fireball
  - waiting while its fireball flies once it is put away, then leaving
  - a ghast on the right leaving off the right, facing it
  - coming back when taken up again
  - a blast reaching it on its way off
  - a blast out of its reach as it floats in leaving it where it floats to
  - knocked aside, coming back to its place for its next shot
  - a fireball taken up again coming from the ghast that is there, not one floating off
  - a fireball hit in flight going back and blowing up on the ghast, earning Return to Sender
- the creeper: hit while it hisses, knocked back and earning Shoo!, and left to hiss, blowing up
- while an item is in hand, a click on Rebuild being Rebuild's
- a blast while the pieces fly back breaking nothing and marking nothing broken
- a placed block scrolling with the page, and with the article, out of sight once scrolled out of the frame
- a blast on a scrolled article leaving it scrolled where it was and unable to scroll sideways, the wheel scrolling it while it is in pieces, and Rebuild giving it its own overflow back
- a broken page taking no clicks but on the hotbar's button, and taking them again once rebuilt
- a click to another article taking the blocks on this one with it
- the item advancements earned

### Advancements

The advancements:

- a par 3+ pair's first game won at par from a challenge link earning the firsts, Accepted, Par for the Course and the speed ones
- their toasts three at a time
- the arrivals counted
- no skill one for the same pair again or a par 1 pair
- Cake and Full Circle on arrival with the toast once the article shows
- a personal best: none noted on a pair's first win, a win in fewer clicks noted as a new best earning Self-Improvement with Recent games' Best tag moving to it, and a win in more saying the best, which keeps the tag
- the button's count
- the panel's tiles, gold and ??? ones
- a count's progress and a secret's detail saying nothing
- stored advancements keeping only what would be written
- Clear history leaving them, as the panel's foot says, and Reset forgetting them
- a toast headed by its tier (Advancement Made!, Goal Reached!, Challenge Complete!), those shown together playing the highest tier's sound
- after Reset, what earns the rest, each game its pair's first:
  - the counts from one short of each, nothing earned until the next blast (Demolition Expert), arrivals (Tourist, Bookworm, Cartographer) or win (Regular, Veteran, Wiki Legend) reaches them, and Around the World on the last topic arriving
  - a Hard game with No Back, Blind target and Six clicks won at par: Hardcore, No Take-Backs, Blindfolded, Full Kit, Six Shooter
  - Top links only won by a click straight to the target, under the snapshot's par: Top Notch, Birdie
  - Distance's cheers: not On a Roll after two in a row, On a Roll after three, and Hot Streak for a par 4 win cheered every click
  - Exact clicks at par + 5: Measure Twice, Long Way Round
  - a Round trip Relay of three checkpoints: Relay Racer, There and Back Again, Grand Tour
  - a hunt of kinds: Treasure Hunter, Kind Collector
  - Dirt to Diamond in 15 clicks by Herobrine, an April Fools page and a spin-off: Rags to Riches, Scenic Route, He Is Watching, April Fools!, Spin Doctor
  - out of Six clicks one click from the target: So Close

### Effects

The effects:

- a click's sparks flying into the click count
- the canvas taking no clicks
- the count bumping as they land
- a win sending fireworks up over the result, each bursting into its sparks

### Distance

Distance:

- par shown on the setup screen and in the header with it or without
- the start at par
- a step along a shortest route a click closer and going back a click further, in the header and on the path
- the closer one cheered and the further one not
- `gotCloser` never for a checkpoint, a find, Exact clicks or an unknown count
- a dead end with no route
- a page the snapshot lacks unknown
- the result's path with each page's count and the clicks that got no closer in red
- the missed shortcut:
  - the costliest detour's, folded away
  - none along a shortest route
  - on made-up paths only a detour of two or more
  - a checkpoint ending one
  - none from the start or a checkpoint
  - none for Exact clicks
  - its page's visits counted toward the same objective and how many clicks quicker it was
  - a game played there and back and there again saying so in the result
- Share's path with each page's count
- the target reached before the checkpoint counting to the checkpoint
- without the rule every arrival still measured and in the result but nothing shown in play

### Blind target

Blind target:

- a Relay round trip's checkpoints and target held unseen from a link, each card saying when it shows, then shown one stop at a time in the HUD
- Scavenger's kinds hidden until the start
- an ordinary roll leaving them unpicked with no Reroll, Swap or par
- Start picking them from different topics
- Copy challenge link picking them unseen
- a copy the browser refuses saying so, with the link to copy by hand
- a copy that works saying so
- turning the rule off dropping them and rolling new ones, and on again dropping them
- Exact clicks's count hidden and Start picking a target with a route of exactly par + 2
- with no target of exactly its count, Start saying so and not starting
- a held card the same as the start keeping Start from starting, saying so
- a target par holding
- a Blind target daily held unseen, and turning the rule off leaving it with a new target

### Relay

- A relay of two checkpoints from a link:
  - numbered cards
  - a later one or the target reached early not counting
  - the HUD and the banner naming the next
  - the record keeping both
  - par over the whole chain
- Swap reversing the chain
- A third checkpoint rolling a card
- Reroll all at one dropping the others
- The count hiding with the rule

### Round trips

A round trip:

- a Race with the Round trip box
- the setup screen marking it
- its par
- the HUD naming the target and then the start
- reaching the target clearing Back and showing the banner
- the way there dead, titled as part of the way there, with other links live
- Back working again on the way back
- the peek on the way back headed "Back to Diamond"
- the win recorded by its cards
- a target with no way back saying so
- with a checkpoint still to come on the way back, no way on to it

A Relay round trip:

- the target between the checkpoints on the setup screen and in the link's `back=`
- the banners and the HUD in order around the loop
- a checkpoint of the way back passed on the way there staying live
- the record with its split
- par over the loop
- one checkpoint on either side
- Swap starting the loop from the target
- three keeping one each way
- Reroll all rolling the split
- the target back at the end without Round trip

Scavenger's round trip:

- the peek going back to the hunt
- the last find heading home
- the win and its record, headed You made it!

### Exact clicks

Exact clicks:

- a route of exactly par + 2 on no page twice found before Start
- the header's count, shown only by the clicks, with the rule beside the labels and the target's chip saying just Target
- Back gone
- visited pages dead, titled as already visited
- the target too soon losing as Too soon
- the history giving a loss's clicks of the count, and par
- on the count winning with no golf score and its path counted with no click marked as getting no closer
- the history marking the win as the pair's best, played Today; a game from yesterday saying Yesterday, and one before that its day
- a link's `extra=4`:
  - making the count par + 4 with a route of it
  - the challenge link carrying it
  - under Blind target held unseen (the strip and the line above the cards saying Random) and played
- par + 4 and par + 2 being two games for personal bests
- a pair with no route of exactly its count keeping Start off, the strip saying to reroll or pick another number of clicks
- Random rolling par + 1 to 5 with each roll, and the line above the cards saying only "par + random"
- running out losing, headed in orange
- Six clicks: the target on the sixth click winning, and running out saying what was left (no target yet, something still to find on a hunt, the way back on a round trip)
- Share saying how a loss ended: out of clicks with the time, too soon with Exact clicks's count, the clicks with the Timer off
- Six clicks and Round trip greyed out with the reason and left out even if ticked, and back with another game
- a link with several games' rules playing Exact clicks only

### Top links only

Top links only:

- Six clicks greyed out with its reason, Exact clicks's reason first when both are on
- its graph being the links above the first heading and a part of those outside navboxes
- par going by it
- the links below the made-up article's heading dead with the bar over it, and the table of contents' own heading not counting
- the rest and the table of contents folded away with Show and Hide working
- a link to a section in it opening it
- its navbox links dead in Relaxed too
- a pair with no route under it saying so where par goes
- a roll with it having a route

### Scavenger

Scavenger with kinds:

- a link's kinds on the hunt card, with no Swap
- par through a member of each
- the HUD listing them
- an excluded page in the live category not counting
- a page only the live wiki puts in the category counting
- a page of two kinds finding both
- the start no find, coming back to it either, though the live wiki puts it in a kind's category
- the win recorded by its kinds and named in the history
- rolled kinds from three topics with none holding the start
- a new start in one of them rolling them again

And with articles:

- three Find cards joined by +, with Swap
- par the best of the orders
- Distance counting to the nearest
- finds in any order winning, headed You found them all!, with the shortest hunt and its par
- the record

Also:

- switching between them
- picking Relay leaving Scavenger

### The daily

The daily:

- a link playing only a real day that has come, a sealed link holding no daily, and a record keeping only a real day
- a daily with no pair saying to pick another day or play your own game, the cards left as they were
- the same on every load
- Normal plus its rule
- its cards from different topics
- a month of them all with a route:
  - Six clicks days at par 4 or less
  - Checkpoint days with one or two checkpoints
  - Round trip days going there and back
  - Exact clicks days with a route of exactly par + 2 to 4
  - Scavenger days with three kinds or three articles
- a Round trip day as a Race there and back, an Exact clicks day (its par + number in the status line and the strip) and Scavenger days of both kinds loading ready to start
- left by a difficulty change
- left by a card typed in
- the streak counting only days won on their day, up to today or to yesterday while today's is due, with the best run
- a day's best win kept
- a loss or a later win not mending a streak
- a malformed day left out
- the stats line
- giving up a daily keeping its day as played
- playing one earning Daily Bread
- a daily won to the end, whatever the day's rule, by its par route (Exact clicks's of its count):
  - yesterday's, won today, kept as won but not on its day, mending no streak, and marked won later in Past dailies
  - today's, after a loss on it, joining the streak of the two days before, earning Habit, with 10 XP for its first win and none for winning it again
  - the daily box then saying it's done in how many clicks, and the streak
- streaks of 7 and 30 earning Week Streak and Devoted
- Past dailies:
  - opening on this month with today marked and the days to come off
  - going back to `DAILY_FIRST`'s month and no further
  - a day loading its daily in place of a challenge link's cards, and no longer a challenge's game, for Accepted
- Clear history asking first, counting the games (the 1 recorded game for one), Cancel keeping them
- Clear history emptying the dailies

### Content and the target par

- Content and Spin-offs

The target par:

- every start's pars, worked out at once, matching a search from it to the targets that join the web: with Top links only in Deep cuts with spin-offs (Dungeons:Multishot, whose only par 2 target in Magic doesn't), in a Round trip, in Relaxed and in Hard
- Par 1, 2 and 3 in Normal, Par 3 in Relaxed, Par 4 in Hard and Par 5+ in Normal with every family and spin-off on giving a pair at exactly that par
- Par 3 in Popular on Relaxed, where only six starts have a target at that par, rolling five times at that par, and so does a Relay of three with its checkpoints round the start's topic
- a start whose only target at the par is a checkpoint kept (Charcoal and Stony Shore) getting one at the nearest par, saying so
- rerolling only the start keeping the target at the par, or with none at it the nearest par and saying so
- rerolling the target while the start rolls, or with no start, giving a pair at the par
- rerolling the start, or typing one in, while all roll giving a pair at the par
- Popular Blocks targets on Relaxed, which have no pair at par 3, rolling at par 2, saying why and disabling the option until the topic changes
- a topic changed while that roll searches leaving the option on for it, the mark going to the topic searched
- a typed-in start with none at the par kept with a target at the nearest par
- a typed-in start that reaches nothing saying so
- the record and the history keeping it
- a game finished before its par is worked out keeping it, unless the par turns out off it
- Recent games showing the newest 15 games of the 50 the browser keeps

### The record and par

- The record

Par:

- routes follow the graph files
- Relaxed's are never longer than Normal's nor Normal's than Hard's
- Hard's avoid hubs
- Normal's go through content alone when a route that does is as short
- a spin-off page needs its spin-off on
- a route goes through one checkpoint and through two in order
- a round trip goes there and back with the way back off the way there, almost always at the lower bound
- a Relay round trip goes round its loop in order
- Scavenger's goes home after the hunt
- a page missing from the snapshot named in the result's par line, a start with no route saying so, and the line otherwise naming the offline copy and its date as the footer does, and a search that fails saying why
- the setup screen, the header, the result, the record and the history show par, with golf's names for the score

### Report link, sealed links, Share and Random game

- The footer's report link filling a mail in with the game on the cards and the offline copy's date
- The footer naming the offline copy's date as the page's other dates are, with its year, and linking where it comes from
- Sealed challenge links:
  - no title in the URL
  - two links to one game differing
  - one opening to its game held unseen
  - a damaged or overlong blob rolling new cards and saying so
  - a made-up blob with a good hash (titles that try to add keys, every first byte, runaway and unknown rule bits, every tag byte, UTF-8 cut short, random bytes) opening to nothing or to a challenge's keys only with its titles as sealed
  - a made-up sealed link's missing article not named and a hand-made one's named
  - a sealed link of markup and script titles with junk rules played through every place a title shows without anything running or being added: the made-up replies escape titles in their HTML as the wiki does
  - its peek at a checkpoint going back to the article
- Share:
  - the game, the result, the path and a link that opens to the game
  - under Blind target only the start, with no path
  - a refused copy, Share's or Copy challenge link's, showing its text under the buttons, selected, to copy by hand, and a copy that works putting it away
  - a daily's naming its day with the year, as the result names it without, and with its setup screen's challenge link linking its day
- Random game:
  - eight clicks each filling the cards its settings use, the start alone under Blind target, with the line above the cards naming the game
  - not all coming out the same

### The background

The background:

- its defaults and its box showing them
- Auto the constellation on a wide screen and the redstone map at a phone's width
- the sky laid out the same every time
- the facts line starting with the snapshot's pages and getting how far apart articles are on the difficulty
- Roll by itself:
  - marking pairs of its own
  - staying on through a change in its box and turning off, saved, at a change on the page
  - rolling on after Reduce motion is ticked and unticked while a roll waits for the graph
  - then the cards marked
- the wave counting clicks as par does
- the route only as a spoiler
- only the start under Blind target with no route and no fact about the target
- saved settings loading with junk left out
- Reduce motion:
  - beside Effects, saved
  - leaving Roll by itself on
  - stopping the effects and playing them again unticked
  - ticked and held, saying why, with Effects held too, while the system asks for reduced motion, the saved box left as it was
- Effects unticked:
  - saved
  - stopping the game's effects but not the items'
  - held unticked by Reduce motion and as it was after
- a moving picture caught to be stilled with motion reduced and put back after
- XP on Minecraft's levels
- a win listing its XP in the result and filling the bar
- a game given up listing only its new articles' XP
- in the advancements' games: 2 × par for the win, 3 at par, 6 under par and not 3, 2 for each rule that makes it harder (Hard for No hubs) and none for Distance, an XP for each new article, each advancement its tier's, and the total their sum
- stored XP only a whole number of none or more, and Reset advancements clearing it
- the note block:
  - a pick saved and what a click and Back play, as the window's foot says
  - a mob head on top its mob once at its own pitch, the creeper's too, named under the note block with the blocks greyed out
  - a click's sparks in its note's colour
  - Sound of Music on the 20th instrument heard and only instruments kept toward it
  - Nothing taking it off
  - every pick leaving the window the same size with its label unclipped
  - a click outside closing the window
  - a saved pick that isn't one being the harp with nothing on top
- with Sound off no sound fetched
- the header's sound button muting and unmuting, saved, the Sound box following and the button saying which, and the box doing the same
- with motion reduced a still frame drawn, the wave already passed
- hidden during play and back on the setup screen
- Off hiding it and the facts line
- the cursor:
  - a touch ignored
  - the stars near the mouse making way and the nearest named
  - a card's star under it named only by its marker
  - leaving the window putting them back
  - a torch warming the map's blocks around it
  - nothing under reduce motion
- Background only:
  - the corner button hiding the setup screen but the box, open, the facts line and itself, and saying it goes back to the setup screen
  - the picture stronger and Roll by itself left on
  - Escape and the button bringing the screen back
  - Off leaving it and hiding the button

### The setup screen holding still

The setup screen holding still:

- a choice in Articles clicked at the bottom of the page, where its help under it gets shorter, not moving while the cards roll, measured by a ResizeObserver made after the game's
- a real click on a rule's text with its box above the window not scrolling to the box
- scrolling with the wheel letting go

### Requests

The suite checks that only page info, the advancements' pictures and articles are asked for.

### Left to the live suite

Rendering real articles is left to `e2e.mjs`, so run that before a release; the offline test is for when the wiki is down, or for a quick check.

## Random play

Random play is a seeded run of 30 steps on one pair, started again after each win:

- link clicks (sometimes a second while the first loads)
- Back (sometimes during a load)
- theme switches
- peeks
- path toggles

After each step the game has to settle with the click count, the path list, the Back stack, the article shown and the clock agreeing.
The seed is printed with the result, and `MWR_SEED=<seed> test/run-e2e.sh` replays the same choices, though the wiki may have changed since.

## Running the live suite

The live suite needs `firefox` and Node ≥ 22 (for the global `WebSocket`), plus network access.
Headless Firefox has no pointer device and matches `(hover: none)`, so `run-e2e.sh` sets `ui.primaryPointerCapabilities` to report a mouse, as a desktop browser does.
It runs as a single script; to focus on one behavior, edit or comment out checks in `e2e.mjs`.
Code inside the article iframe is evaluated in the frame's own browsing context (`frameCtx()`).

## Pre-commit hook

The offline suite runs before every commit as a git pre-commit hook, unless the commit has only docs, pictures or `tools/`, `.githooks/pre-commit`, turned on once per clone with `git config core.hooksPath .githooks`.

First, when the commit changes `tools/check-docs.mjs` or its test, the hook runs `tools/check-docs.test.mjs`, which runs the check on a made-up repo, on the working tree and on what is staged, with one of each mistake it should catch and one of each thing it should let pass. It runs git without the hook's `GIT_*` variables, which would otherwise point the made-up repo's git commands at the real index. Then, on every commit, the hook runs `tools/check-docs.mjs --staged`, which checks what is staged, as the commit will have it, and stops the commit if a doc has gone stale:

- every relative link in a Markdown file must lead to a file that exists, and its `#fragment` to a heading in it (a link starting with `/` starts at the repo's root, as on GitHub); inline links, with or without a title or brackets in the address, and reference definitions (not footnotes) are read, percent-encoding decoded; headings are # lines or lines underlined with = or -
- every code span in `docs/internal/` that holds a name by itself (an id, a function, a key, a class, with or without a call's brackets: `navigate(title)` checks `navigate`) must still be in the code: `index.html`, `test/`, `tools/` and `.githooks/`, but not the check and its test, whose own names would otherwise pass as the game's, nor the `wiki-*.js` data files, whose article titles would (the keys in them are `build.py`'s)
- a `data-*` name also passes as its `dataset` key, a dotted name when each part is in the code, a hyphenated one when it starts a name in the code
- so it catches a name gone from the code entirely; one still in a comment or a test passes
- a word in backticks that is about the code rather than a name in it is written so the check doesn't read it as one (`ns-<N>`), or left out of backticks
- every `docs/….md` path from the repo's root that a comment in the code names must exist, but not one at the end of a URL (`build.py` writes the `wiki-*.js` files' comment, so it is checked there)
- links in code spans, and anything in a fenced code block (fenced with backticks or tildes, indented ones too), are examples and aren't checked; a block marked only by a four-space indent can't be told from a list item's text, so it is checked like prose

Run by hand without `--staged`, it checks the working tree, untracked files too.

The check runs on code commits too, since removing a name the docs mention breaks them as surely as a docs change can. Both print only when they fail. Each file is read once, and the check takes under a tenth of a second.

A commit that changes the wiki snapshot (`wiki-data.js`, `wiki-links.js`, `wiki-navboxes.js`, `wiki-lead.js` or the ZIM's `.sha256`) gets a reminder to run the live suite by hand too.

A commit of only Markdown files (anywhere), pictures (`.png`, `.ico`), `LICENSE`, `.gitignore` or files under `docs/` or `tools/` skips the offline suite, since none of them changes what the suite runs; any other file, a new kind of file too, runs it.

The hook tests the working tree, prints only the failures and the summary, and stops the commit if a check fails (`git commit --no-verify` skips it, for a commit that can't run Firefox).

It uses port 9335, so a live suite running at the same time keeps its Firefox.

## Before a release

The live suite runs only by hand, and there is no CI, so the live wiki can change between runs unnoticed.

Before a release, run it, then check by hand what neither suite can:

- the game in Chrome (the suites only drive Firefox)
- the game in Safari on an iPhone:
  - the 16 px inputs not zooming
  - the `100dvh` layout under the toolbars
  - no leave-page dialog there
- how real articles look (glance at the screenshots `run-e2e.sh <dir>` saves, and a few articles in both themes for a new wiki widget that needs the wiki's own script, as the calculators did)
- that the sounds play and the mute works
- the items by hand (see [items.md](items.md)):
  - a blast on a scrolled setup screen and article
  - the pieces resting on the page and none of it growing or scrolling sideways
  - the page untouchable but scrollable while broken
  - the shake leaving the buttons and toys in place
  - Rebuild smooth
  - the creeper and ghast facing their way
  - the textures and toasts
- a game or two on a real phone, upright and on its side
