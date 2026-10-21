"""Builds wiki-data.js, the game's data about minecraft.wiki, from a snapshot made by extract.py and config.json.

    .venv/bin/python -I tools/wikidata/build.py tools/wikidata/cache/minecraft.wiki_en_all_2026-08.jsonl.gz [-o wiki-data.js]

The output defines WIKI_DATA, which index.html loads with a script tag (a JSON file couldn't be fetched from file://):
  snapshot, file, sha256  where it came from
  namespaces              names of the wiki's non-article namespaces, whose links the game disables
  topics                  the pool's topics, in config order
  families                the Content families' keys, in config order
  spinoffs                each spin-off namespace's name and number, in config order
  articles                every article and every spin-off page: [title, linked from, linked from outside navboxes,
                          topic, families, tiers]
  hubs                    for the No hubs rule, every hub and every redirect to one, mapped to the hub
A pool-mode roll may only pick content: a page that isn't a subpage, a disambiguation page, a version page (in a
category ending in "versions") or in the config's not-content categories or titles. Content in a family's categories, or
in a spin-off namespace, has that family. Other content in a topic's categories is in the pool, with that topic, and
its tiers say whether it is Popular (the config's best-linked share of the pool) or in Deep cuts (the least-linked share
of its topic, among articles linked well enough to be a target). Everything else has neither topic nor family, so only
Chaos rolls it.
Links are counted per linking page, through redirects. An article's count only has links from articles. A spin-off
page's count also has links from its own namespace, since those links are live when its spin-off is on. The same
snapshot always gives the same bytes, one entry per line, so a new snapshot reads as a normal git diff (diff.py
summarises it).
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for common.py under python -I
from common import CONFIG, HERE, MIN_BACKLINKS, Snapshot, load_config, spinoff_backlinks

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
    not_content = {*config['disambiguation_categories'], *config['not_content_categories']}
    return ('/' not in title and title not in config['not_content_titles'] and not cats & not_content
            and not any(c.endswith(' versions') for c in cats))


def topic_of(cats, config):
    return next((k for k, topic in config['topics'].items() if cats & set(topic)), '')


def tiers(rows, config, popular_share, deep_share):
    """The titles of the pool's Popular and Deep cuts articles, from rows with a topic."""
    pool = sorted((r for r in rows if r[3]), key=lambda r: r[2])
    popular = pool[len(pool) - round(len(pool) * popular_share):]
    deep = []
    for topic in config['topics']:
        aims = [r for r in pool if r[3] == topic and r[2] >= MIN_BACKLINKS]
        deep += aims[:round(len(aims) * deep_share)]
    return {r[0] for r in popular}, {r[0] for r in deep}


def build(snap, config):
    families = config['families']
    full, outside = snap.backlinks()
    rows = []
    for i, title in enumerate(snap.articles):
        cats = set(snap.pages[title]['cats'])
        content = is_content(title, cats, config)
        fams = [k for k, family in families.items() if content and cats & set(family)]
        rows.append([title, full[i], outside[i], topic_of(cats, config) if content and not fams else '', fams, []])
    popular, deep = tiers(rows, config, config['popular_share'], config['deep_cuts_share'])
    for r in rows:
        r[5] = [k for k, members in (('popular', popular), ('deep', deep)) if r[0] in members]

    by_name = {name: ns for ns, name in snap.namespaces.items()}
    missing = [n for n in config['spinoffs'] if n not in by_name]
    if missing:
        sys.exit(f'Spin-off namespaces not in this snapshot: {", ".join(missing)}')
    spinoffs = {n: by_name[n] for n in config['spinoffs']}
    name_of = {ns: n for n, ns in spinoffs.items()}
    spin_full, spin_outside = spinoff_backlinks(snap, set(name_of))
    for title in spin_full:
        p = snap.pages[title]
        rows.append([title, spin_full[title], spin_outside[title], '',
                     [name_of[p['ns']]] if is_content(title, set(p['cats']), config) else [], []])
    rows.sort(key=lambda r: r[0])

    sizes = {k: sum(k == r[3] or k in r[4] or k in r[5] for r in rows) for k in [*config['topics'], 'popular', 'deep', *families, *spinoffs]}
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
        'namespaces': ns_names, 'topics': list(config['topics']), 'families': list(families), 'spinoffs': spinoffs, 'articles': rows,
        'hubs': dict(sorted(hubs.items())),
    }, sizes


def render(data):
    j = lambda v: json.dumps(v, ensure_ascii=False)
    lines = [
        f'// minecraft.wiki as of {data["snapshot"]}, for MC Wiki Race: made by tools/wikidata/build.py from {data["file"]}.',
        '// Its titles, categories and link counts come from minecraft.wiki (https://minecraft.wiki), licensed under CC BY-NC-SA 3.0',
        '// (https://creativecommons.org/licenses/by-nc-sa/3.0/), not under the game\'s MIT license.',
        '// Don\'t edit it by hand; rebuild it from a newer ZIM (see CLAUDE.md, "Wiki data").',
    ]
    # One entry per line, and no trailing commas, so what follows the = is JSON (diff.py reads it back).
    block = lambda items, open_, close: open_ + '\n' + ',\n'.join(f'    {i}' for i in items) + '\n  ' + close
    fields = [f'  {j(k)}: {j(data[k])}' for k in ('snapshot', 'file', 'sha256', 'namespaces', 'topics', 'families', 'spinoffs')]
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
