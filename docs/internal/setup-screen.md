# The setup screen

For people: [how-to-play.md](../how-to-play.md#the-setup-screen).

The setup screen puts playing first.

## Beside the title and in the corner

- Beside the title are ⚙ Settings (`#setOpts`, a `<details>` holding Sound, Timer, Effects, Reduce motion and Theme) and the Background box (`#bgOpts`, see [ui.md](ui.md)), both opening over the page (`.drop`, `.drop-panel`; on a phone in the page, the whole width), and closed by a click elsewhere or Escape.
- In the bottom-right corner, above the background's button, is the items' hotbar button (see [items.md](items.md)), and above that the note block's, which picks what clicks play (see [ui.md](ui.md#note-block)).
- Where the window is too narrow for the corner's buttons to fit beside the page, `#setup`'s right padding grows (up to 64 px) to keep the page clear of them. At 720 px and below they sit in a row beside the title instead and scroll with the page (see [ui.md](ui.md#720-px-and-below)).

## Top to bottom

- The daily (`.daily-box`):
  - today's game in words, from `dailyText`, with what its rule asks in plain words under it (`dailyHow`, `#dailyHow`: "Reach the target in 6 clicks or fewer."; not on a phone, where it would push Start game off the first screen, but in the status line once the daily is loaded, on every screen), how you did if you won it, and a stats line, `#dailyStats`, with the streak, the best streak and the days won (see [persistence.md](persistence.md)), all from `renderDailyBox`, called by `renderHistory`
  - Play the daily is `#btnDaily`
  - Past dailies beside the stats, `#btnPastDailies`, opens a calendar, `openCalendar`:
    - a month at a time from `DAILY_FIRST`'s to this one
    - the week starting on the locale's first day
    - each day from `DAILY_FIRST` to today a button that loads its daily (`loadDaily`), named with its game and result in its tooltip, and marked won on its day, won later, not won or (plain) not played, with a key under the month naming all four.
- Your game (`#gameSum`, filled by `updateGameSum`): the game with its option, the extra rules, the articles and the difficulty.
- The cards.
  - Each article card says above its buttons what the offline copy has of its links (`cardFacts`): "Linked from 56 articles · links to 23 pages", the second once `wiki-links.js` is in (outside navboxes, as the facts line counts); nothing on a hidden card or a page the copy doesn't have.
  - A title typed into a card's box (`setCustom`) takes the card's roll (`setup.rolls`) as the lookup starts, so a reroll or the daily after it wins, and it wins over a roll going already.
  - One that `pageInfo` refuses says why: "No article named “X” on minecraft.wiki.", or for a page the game leaves out (see [rules.md](rules.md)) "“X” is on minecraft.wiki, but the game leaves it out (a version, list or non-article page)."
- Start game and par.
- Reroll all.
- Copy challenge link (`#btnCopy`): "Challenge link copied.", or when the browser refuses the copy, the link in the status line to copy by hand.
- Random game (`#btnRandom`, `randomGame`, 🔀, since the 🎲 buttons only roll cards):
  - every setting under the cards at random, each on its own, every box a coin flip and every choice as likely as the others, then `reroll('all')`
  - Sound, Timer, Theme and the background's settings stay as they are, but Roll by itself, which any change turns off.
- Then, below a divider (`.game-settings`), the settings of the game, under headings without numbers, since none has to be set before Start:
  - Choose a game:
    - the tiles, `GAMES`, a radio group named `game`, read by `gameMode()`, each its name and diagram, its line (`blurb`, or with Round trip its `trip`'s) its tooltip, since the strip says the picked game
    - the strip under them, `#gameHelp` plus the picked game's own options, `.game-opt`: the checkpoint count, What to find, and Exact clicks's clicks over par, `#exactExtra`, with its count beside it, `#exactInfo`, filled by `updateSetupPar`.
  - Extra rules (`EXTRA_RULES`, boxes in `#rules`, Round trip first), each saying its rule in a line (`RULES[k].blurb`, so the boxes stay short), the whole of it their tooltip (`help`).
  - Articles and difficulty (`#settings`, always shown): the pool, the difficulty, the target's topic and par, Content and Spin-offs.

On a phone the cards lose their minimum height and show two lines of description, so Start game fits on the first screen.

## Holding still

The screen holds still under the pointer: what was last clicked or changed on it (`keep`, set by a capture listener on `#setup`) stays where it is in the window.

- A ResizeObserver on its blocks and cards (`keepPlace`) scrolls the page, before it is drawn, by as much as anything above it changed size:
  - the line above the cards
  - the cards as they roll and their pictures come in
  - Start's row
  - the strip's help.
- When the page gets shorter under it at the bottom, room under the footer (`#setupRoom`) keeps it long enough, and that room goes as the page is scrolled up out of it.
- A click on a box's text when the box itself is above the window scrolls back to where the click was, undoing the browser's scroll to the focused box.
- A card emptied for a roll keeps its height until its article is in (`renderCard`, which marks it `.empty`).

## While a roll is under way

While a roll or lookup is under way (`withBusy` sets `#setup.busy`):

- the status line is bold with a spinner
- each emptied card has a spinner by its tag and says it is picking an article.

`reroll` lets the page be drawn that way (`painted`) before its searches, which can hold the page up for a moment.

If it fails, the status line says whose failure it was (`failText`):

- the wiki's, any `api` error (and `askParse`'s reply with no article), by whether it answered at all (`reached`):
  - none: "Couldn’t reach minecraft.wiki (Failed to fetch). Check your connection and try again."
  - an error: "minecraft.wiki sent back an error (HTTP 503). Try again in a moment."
- the link graph files', from `loadGraphFile`: "The game’s link data didn’t load (wiki-links.js). Reload the page."
- otherwise the game's own message: a card none of whose draws fit (`rollOne`: "Couldn’t find an article that fits. Try Reroll again.") or a daily with no pair (`DAILY_FAILED`: "Couldn’t make this day’s daily challenge. Pick another day from Past dailies, or play your own game.", since such a day would fail the same way every time; none does on the snapshot).

Par has its own spinner while it is worked out (see [par.md](par.md)).

The spinners are transform animations, so they keep turning while a search runs, and turn slowly with reduced motion.

## Letting go

- While something is held, the browser's own scroll anchoring is off (`#setup.keeping`), since it would hold a different element and its scrolling would read as the player's.
- Scrolling the page lets go (a scroll up at the bottom of the page is the browser clamping to a page that got shorter, so it is held again), and so do resizing the window and leaving the screen.

## Background view

A round button in the bottom right corner (`#btnBgView`, beside the title on a phone) hides it all but the background and its settings (see [ui.md](ui.md)).

## Facts line and footer

The setup screen ends with the facts line (`#bgFacts`, see [ui.md](ui.md)) and a footer:

- who runs the game
- a contact address and Discord profile
- where to report a bug or an idea:
  - an email link, `#feedbackMail`, whose click fills the mail's body in with the game on the cards as its link, `gameLink`, the last game played with its route, the offline copy's date and the browser
    - copied or opened some other way, the email link has only the subject
  - GitHub's new issue page
- the GitHub link
- MIT license
- credit for the wiki's CC BY-NC-SA 3.0 content
- the date of the wiki's offline copy the rolls and par go by, `#wikiCopy`, filled from `WIKI_DATA.snapshot` by `init` (`snapshotDay`: shown as the page's other dates are, `shortDate`, with its year) and linking Minecraft Wiki:Offline use, and that the articles themselves are live
- a non-affiliation notice.

## The licence during play

That licence, CC BY-NC-SA 3.0, asks reusers to link the pages they show, so:

- during play the bottom of the path sidebar (`#credit`, set in `navigate`) links the current article on minecraft.wiki (`wikiUrl`) and the licence
  - collapsing the sidebar leaves the credit in a small box over the article's corner, with the button that brings the sidebar back
- the result dialog links every page in the path.

## Without JavaScript

- A `<noscript>` style in `<head>` hides the setup controls and the footer's date line.
- A `<noscript>` notice under the intro explains why.
