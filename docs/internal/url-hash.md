# URL hash keys

For people: [how-to-play.md](../how-to-play.md#challenge-links), [how-it-works.md](../how-it-works.md#challenge-links).

The game reads these keys from the URL hash (`init`), and leaves any other out.

## `g=<blob>`: sealed challenge links

`g=<blob>`: a sealed challenge link, what "Copy challenge link" (`challengeLink`, through `gameLink`) makes, on the setup screen and in the result, for any game but a daily, whose link is its `daily=`.

It is the query the keys below would make (`challengeQuery`), sealed (`sealLink`) so the URL doesn't give the pair, or Blind target's hidden cards, away at a glance, and packed into bytes so the link stays short (about 30 characters for a Race):
- a byte of `back=` (times 8) and `extra=`;
- the rules as a bitmask over `RULES`' keys in 7-bit groups (one byte for Normal and Hard games).
  The bitmask goes by a rule's place in `RULES`, so a new rule goes at the end;
- then each title in the query's order as its UTF-8 after a byte naming its key (`LINK_TITLES`, from 0xf8, which UTF-8 never uses);
- then the top 16 bits of their `hash32`.

All XORed with a mulberry32 keystream seeded by `LINK_KEY` and a random 2-byte nonce ahead of it, in base64url.

Titles go as text, never as numbers from the snapshot's lists, so a link opens the same after a snapshot update.

### Opening one

That sealing only hides it from a glance, since the key is in the page. So:
- `openLink` builds the plain query from the bytes, in `challengeQuery`'s order and of a challenge's keys only, which `init` reads with the same code and checks as a hand-made link;
- the blob holds the setup only (never a daily, par or result).

A made-up blob can do nothing a plain link can't.

A `#g=` hash is read on its own, leaving anything beside it out.

A blob longer than `LINK_MAX` (room for five titles of MediaWiki's longest), not base64url, failing its hash (a link a chat app cut short) or not unpacking rolls new cards and says the link is damaged.

## `start=` and `target=`: a fixed pair

- `start=<Title>` with `target=<Title>` (or `kind=`): a fixed pair, handy for testing a specific route.
- A `start` with neither is no challenge, and a pair is rolled.
- Every title is looked up live, and if one doesn't exist or is left out of the game (`toInfo`, see [rules.md](rules.md)) new cards are rolled instead.
- A sealed link's missing article isn't named in the message, since anyone can seal any text in a link and titles are otherwise only shown once the wiki has them; a hand-made link's is, its titles being in the URL to read.

## `via=`: checkpoints

`via=<Title>`: a checkpoint, in order, up to three, which turns the Checkpoint rule on with that count.

With Scavenger in `rules`, the target and the `via=` titles are its three articles instead.

## `back=`: Round trip

`back=N`: with Round trip, how many of the checkpoints come after the target, on the way back (missing or out of range, it is moved to the nearest that fits).

## `extra=`: Exact clicks

`extra=N`: with Exact clicks, how many clicks over par the count is (one of `EXACT_EXTRAS`, 1 to 5; others are left out, and without one the strip keeps par + 2).

- It holds the number, never the count, which comes from par, and a Random game's link holds the number it rolled.
- Under Blind target a challenge's number is held unseen like its cards: the strip shows Random, since the opener can't know it, with the link's number in `setup.extra`, and the next roll of the cards rolls a new one.
- Like `rules`, it is read for a rolled pair too, where it is shown.

## `kind=`: Scavenger's kinds

`kind=<Category>`: in place of `target` (a link with both plays the kinds), one of Scavenger's kinds (a `KINDS` key; others are left out), up to three, which turns Scavenger on with kinds.

## `rules=`: the rules

`rules=<key>,<key>`: rule keys (`RULES`; others are left out), the difficulty included (`setRules`: `nonav` is Normal, `nonav,nohubs` or `nohubs` alone Hard).

- A challenge link always sets them, so one without `rules` is Relaxed.
- They are applied even if the pair fails to load.
- On its own, `#rules=…` sets them for a rolled pair.

## `daily`: the daily

`daily` and `daily=YYYY-MM-DD`: today's daily pair and rule, or a past day's (a challenge pair beside it wins, and the day's rule replaces `rules`).

Only a real day that has come plays (`dailyDate`, by the player's local date): one that is malformed, doesn't exist (`realDate`: 2026-02-31, or a year below 100, which `Date.UTC` reads as 19xx) or hasn't come yet loads today's instead, so nobody can practise a daily before its day.
