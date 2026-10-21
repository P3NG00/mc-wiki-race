"""Builds wiki-data.js, the game's data about minecraft.wiki, from a snapshot made by extract.py and config.json.

    .venv/bin/python -I tools/wikidata/build.py tools/wikidata/cache/minecraft.wiki_en_all_2026-08.jsonl.gz [-o wiki-data.js]

The output defines WIKI_DATA, which index.html loads with a script tag (a JSON file couldn't be fetched from file://):
  snapshot, file, sha256  where it came from
  namespaces              names of the wiki's non-article namespaces, whose links the game disables
  categories              the pool categories, in config order
  families                the Content families' keys, in config order
  spinoffs                each spin-off namespace's name and number, in config order
  articles                every article and every spin-off page: [title, linked from, linked from outside navboxes,
                          pool categories, families]
  hubs                    for the No hubs rule, every hub and every redirect to one, mapped to the hub
A pool-mode roll may only pick content: a page that isn't a subpage, a disambiguation page or a version page (in a
category ending in "versions"). Content in a family's categories, or in a spin-off namespace, has that family instead of
pool categories. Everything else has neither, so only Chaos rolls it.
Links are counted per linking page, through redirects. An article's count only has links from articles. A spin-off
page's count also has links from its own namespace, since those links are live when its spin-off is on. The same
snapshot always gives the same bytes, one entry per line, so a new snapshot reads as a normal git diff (diff.py
summarises it).
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for common.py under python -I
from common import CONFIG, HERE, Snapshot, load_config, spinoff_backlinks

DEFAULT_OUT = os.path.join(HERE, '..', '..', 'wiki-data.js')


def namespaces(snap, config):
    names = list(config['core_namespaces'])
    for ns, name in sorted(snap.namespaces.items()):
        # MediaWiki pairs every namespace with a talk namespace, numbered one higher, which the ZIM doesn't hold.
        for n in (name, name + ' talk'):
            if n not in names:
                names.append(n)
    return names


def is_content(title, cats, config):
    return '/' not in title and not cats & set(config['disambiguation_categories']) and not any(c.endswith(' versions') for c in cats)


def build(snap, config):
    pool, families = config['pool_categories'], config['families']
    full, outside = snap.backlinks()
    rows = []
    for i, title in enumerate(snap.articles):
        cats = set(snap.pages[title]['cats'])
        content = is_content(title, cats, config)
        fams = [k for k, family in families.items() if content and cats & set(family)]
        rows.append([title, full[i], outside[i], [c for c in pool if c in cats] if content and not fams else [], fams])

    by_name = {name: ns for ns, name in snap.namespaces.items()}
    missing = [n for n in config['spinoffs'] if n not in by_name]
    if missing:
        sys.exit(f'Spin-off namespaces not in this snapshot: {", ".join(missing)}')
    spinoffs = {n: by_name[n] for n in config['spinoffs']}
    name_of = {ns: n for n, ns in spinoffs.items()}
    spin_full, spin_outside = spinoff_backlinks(snap, set(name_of))
    for title in spin_full:
        p = snap.pages[title]
        rows.append([title, spin_full[title], spin_outside[title], [],
                     [name_of[p['ns']]] if is_content(title, set(p['cats']), config) else []])
    rows.sort(key=lambda r: r[0])

    sizes = {k: sum(k in r[3] or k in r[4] for r in rows) for k in [*pool, *families, *spinoffs]}
    empty = [k for k, n in sizes.items() if not n]
    if empty:
        sys.exit(f'No content in: {", ".join(empty)}')

    ns_names = namespaces(snap, config)
    prefixes = tuple(n + ':' for n in ns_names)
    hubs = {}
    for hub in config['hubs']:
        if snap.pages.get(hub, {}).get('ns') != 0:
            sys.exit(f'Hub {hub!r} is not an article in this snapshot')
        hubs[hub] = hub
    for title in snap.redirects:
        to = snap.resolve(title)
        if to in hubs and not title.startswith(prefixes):
            hubs.setdefault(title, to)

    return {
        'snapshot': snap.meta['date'], 'file': snap.meta['file'], 'sha256': snap.meta['sha256'],
        'namespaces': ns_names, 'categories': pool, 'families': list(families), 'spinoffs': spinoffs, 'articles': rows,
        'hubs': dict(sorted(hubs.items())),
    }, sizes


def render(data):
    j = lambda v: json.dumps(v, ensure_ascii=False)
    lines = [
        f'// minecraft.wiki as of {data["snapshot"]}, for MC Wiki Race: made by tools/wikidata/build.py from {data["file"]}.',
        '// Don\'t edit it by hand; rebuild it from a newer ZIM (see CLAUDE.md, "Wiki data").',
    ]
    # One entry per line, and no trailing commas, so what follows the = is JSON (diff.py reads it back).
    block = lambda items, open_, close: open_ + '\n' + ',\n'.join(f'    {i}' for i in items) + '\n  ' + close
    fields = [f'  {j(k)}: {j(data[k])}' for k in ('snapshot', 'file', 'sha256', 'namespaces', 'categories', 'families', 'spinoffs')]
    fields.append('  "articles": ' + block(map(j, data['articles']), '[', ']'))
    fields.append('  "hubs": ' + block((f'{j(k)}: {j(v)}' for k, v in data['hubs'].items()), '{', '}'))
    lines.append('const WIKI_DATA = {\n' + ',\n'.join(fields) + '\n};')
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('snapshot')
    ap.add_argument('-o', '--out', default=DEFAULT_OUT)
    ap.add_argument('--config', default=CONFIG)
    args = ap.parse_args()
    data, sizes = build(Snapshot(args.snapshot), load_config(args.config))
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(render(data))
    print(f'{os.path.normpath(args.out)}: {len(data["articles"])} pages, {len(data["hubs"])} hub titles; content '
          + ', '.join(f'{c} {n}' for c, n in sizes.items()), file=sys.stderr)


if __name__ == '__main__':
    main()
