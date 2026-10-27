# Hosting

How to serve your own copy of the game. It's all static files: no server code, no build step.

## Files to serve

Serve these side by side, from the same folder:

| File | What it's for | Without it |
| --- | --- | --- |
| `index.html` | The whole game. | Nothing to serve. |
| `wiki-data.js` | What rolls pick from: the pool, link counts, hub redirects, left-out pages, namespaces. | The game doesn't start. |
| `wiki-links.js` | The link graph, for every game but Top links only. | No par, no [Distance or Target par](how-to-play.md#extra-rules), and the daily fails to load. Rolls skip their check that the cards are linked up, and the background has no constellation. |
| `wiki-navboxes.js` | The navboxes' links, for Relaxed. | On Relaxed: no par, no Distance or Target par, and rolls skip their check that the cards are linked up. |
| `wiki-lead.js` | The links above each first heading, for Top links only. | Under Top links only: no par, no Distance or Target par, and rolls skip their check that the cards are linked up. |
| `favicon.ico`, `apple-touch-icon.png` | The icon. | No icon. |
| `og-image.png` | The link-preview picture. | Nothing on your copy: the page names the one at mcwikirace.com. |

All four data files load by script tag. `wiki-links.js` loads as soon as the page opens, for the background and the cards' par; the other two the first time Relaxed or Top links only needs them.
Articles, pictures and sounds come live from minecraft.wiki, so there's nothing else to serve.

Details: [internal/wiki-data.md](internal/wiki-data.md#the-link-graph-files)

## Caching

The four data files change together with each new snapshot of the wiki, so serve them without long caching.
Each link graph file carries the snapshot's checksum, and the game refuses one that doesn't match `wiki-data.js`'s, since it would give wrong routes.
A graph file cached from an older snapshot beside a newer `wiki-data.js` would turn off par, Distance, Target par and the daily until the cache runs out.

Details: [internal/wiki-data.md](internal/wiki-data.md#the-link-graph-files)

## The canonical address

The page's `canonical` link and its Open Graph tags point at https://mcwikirace.com/, so every copy names that address as the original, and search engines treat other copies as duplicates of it.
The link-preview picture (`og:image`) is named there too.

## Adding a theme

You can add themes to the **Theme** picker without touching the game's code. Put a stylesheet in the `<head>` of `index.html`, marked with `data-mwr-theme`; a `<style>` element with the same attribute works too.
The name you give it shows up in the picker, and `data-mwr-default` makes it the default:

```html
<link rel="stylesheet" href="my-theme.css" data-mwr-theme="My site" data-mwr-default>
```

The stylesheet sets the theme's variables on `:root[data-theme="<name>"]`:

```css
:root[data-theme="My site"] {
  --bg: #101010; --panel: #202020; --ink: #fff; --muted: #aaa; --line: #333;
  --accent: #fff; --accent-ink: #000; --accent-soft: #333; --target: #f87;
  --shadow: none; --font: monospace; --radius: 0; --radius-lg: 0; --radius-pill: 0;
  color-scheme: dark;   /* the article uses the wiki's dark theme */
}
```

- Any variable you leave out keeps its light-theme value, so a dark theme should also set `--warm` and `--warm-soft` (a loss, and a score over par) and `--art-opacity` (the faded picture behind the cards and the path). That includes the background's colours (`--viz-blocks`, `--viz-items`, `--viz-mobs`, `--viz-world`, `--viz-magic`, `--viz-redstone` and `--viz-opacity`).
- `color-scheme` decides whether the article shows in the wiki's light or dark theme.
- The names `auto`, `light` and `dark` are taken by the built-in themes.
- A player's choice is remembered. If that theme is gone on their next visit, they get your default, or Auto without one.

Details: [internal/ui.md](internal/ui.md#host-themes)

## Content-Security-Policy

If your server sends a Content-Security-Policy, it has to allow:

| Directive | Needs |
| --- | --- |
| `connect-src` | `https://minecraft.wiki` (the API, and the sounds) |
| `img-src` | `https://minecraft.wiki`, `data:` (the textures of the hotbar, tooltips and windows, and Reduce motion's still pictures, which the game draws itself), and your own origin for the icon |
| `style-src` | `https://minecraft.wiki`, inline styles, and your own origin for a theme stylesheet |
| `font-src` | `https://minecraft.wiki` |
| `media-src` | `https://minecraft.wiki` (sounds played in an article) |
| `base-uri` | `https://minecraft.wiki` (the article frame sets its base there) |
| `script-src` | inline scripts, and your own origin for the data files |

The article frame is filled from the page itself, so it inherits the page's policy.

Details: [internal/rendering.md](internal/rendering.md#api-access), [internal/rendering.md](internal/rendering.md#rendering-articles), [internal/ui.md](internal/ui.md#fetching-the-sounds)
