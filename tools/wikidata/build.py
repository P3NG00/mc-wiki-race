"""Builds wiki-data.js, the game's data about minecraft.wiki, and the link graph files beside it, from a snapshot made by
extract.py and config.json.

    .venv/bin/python -I tools/wikidata/build.py tools/wikidata/cache/minecraft.wiki_en_all_2026-08.jsonl.gz [-o folder]

The output defines WIKI_DATA, which index.html loads with a script tag (a JSON file couldn't be fetched from file://):
  snapshot, file, sha256  where it came from
  namespaces              names of the wiki's non-article namespaces, whose links the game disables
  topics                  the pool's topics, in config order
  families                the Content families' keys, in config order
  spinoffs                each spin-off namespace's name and number, in config order
  articles                every article and every spin-off page: [title, linked from, linked from outside navboxes,
                          topic, families, tiers]
  hubs                    for the No hubs rule, every hub and every redirect to one, mapped to the hub
  kinds                   for Scavenger, each of the config's kinds (a category): the name the game shows, its members'
                          commonest topic, its members (pool articles in the category linked well enough to be a
                          target, less the config's exclusions) and the exclusions, which the game also applies to a
                          page's live categories
A pool-mode roll may only pick content: a page that isn't a subpage, a disambiguation page, a version page (in a
category ending in "versions") or in the config's not-content categories or titles. Content in a family's categories, or
in a spin-off namespace, has that family. Other content in a topic's categories is in the pool, with that topic, and
its tiers say whether it is Popular (the config's best-linked share of the pool) or in Deep cuts (the least-linked share
of its topic, among articles linked well enough to be a target). Everything else has neither topic nor family, so only
Chaos rolls it.
The link graph, for par, numbers pages by their place in articles and goes through redirects:
  wiki-links.js           WIKI_LINKS: for every page, the pages it links to outside navboxes
  wiki-navboxes.js        WIKI_NAVBOXES: every distinct navbox, as the pages it links to (the copies of a navbox only
                          differ by which page shows as plain text, which extract.py adds back), and for every page the
                          navboxes it carries. Stored once each, they are a tenth of the size of every page's own list.
Both have the sha256 of wiki-data.js's ZIM, and the game only uses them with a wiki-data.js that has the same.
Links are counted per linking page, through redirects. An article's count only has links from articles. A spin-off
page's count also has links from its own namespace, since those links are live when its spin-off is on. The same
snapshot always gives the same bytes, one entry per line, so a new snapshot reads as a normal git diff (diff.py
summarises it).
"""
import argparse, collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for common.py under python -I
from common import CONFIG, HERE, MIN_BACKLINKS, Snapshot, load_config, spinoff_backlinks

DEFAULT_OUT = os.path.join(HERE, '..', '..')
MIN_KIND = 5   # a Scavenger kind needs this many members


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


def check_config(snap, config):
    """Stops if the config names a category no page is in, or a not-content title that is no longer an article: a
    rename on the wiki would otherwise move articles out of their topic, family or kind, or let a list page under its
    new title into the pool, without a word."""
    named = dict.fromkeys([*(c for topic in config['topics'].values() for c in topic), *(c for family in config['families'].values() for c in family),
                           *config['not_content_categories'], *config['disambiguation_categories'], *config['kinds']])
    seen = {c for p in snap.pages.values() for c in p['cats']}
    problems = [f'category no page is in: {c}' for c in named if c not in seen]
    problems += [f'not-content title that is no longer an article: {t}' + (f' (now a redirect to {snap.resolve(t)})' if t in snap.redirects else '')
                 for t in config['not_content_titles'] if snap.pages.get(t, {}).get('ns') != 0]
    if problems:
        sys.exit('To look at in config.json:\n  ' + '\n  '.join(problems))


def kinds(snap, config, rows):
    """Scavenger kinds, by category (see the docstring). Stops if an excluded title has left its category or a kind has
    too few members, so a new snapshot gets the hand-picked list looked at again."""
    aims = {r[0]: r[3] for r in rows if r[3] and r[2] >= MIN_BACKLINKS}
    out, problems = {}, []
    for cat, kind in config['kinds'].items():
        in_cat = {t for t, p in snap.pages.items() if p['ns'] == 0 and cat in p['cats']}
        members = sorted(t for t in aims if t in in_cat and t not in kind['exclude'])
        gone = [t for t in kind['exclude'] if t not in in_cat]
        if gone:
            problems.append(f'{cat}: excluded, but no longer in it: {", ".join(gone)}')
        if len(members) < MIN_KIND:
            problems.append(f'{cat}: {len(members)} members')
        topic = collections.Counter(aims[t] for t in members).most_common(1)[0][0] if members else ''
        out[cat] = {'label': kind['label'], 'topic': topic, 'members': members, 'exclude': sorted(kind['exclude'])}
    if problems:
        sys.exit('Scavenger kinds to look at in config.json:\n  ' + '\n  '.join(problems))
    return out


def build(snap, config):
    check_config(snap, config)
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
        'hubs': dict(sorted(hubs.items())), 'kinds': kinds(snap, config, rows),
    }, sizes


def graph(snap, data):
    """The link graph between data's pages, by their index in its articles: for each page the pages it links to outside
    navboxes, the distinct navboxes (each the pages it links to, sorted), and for each page the navboxes it carries."""
    titles = [r[0] for r in data['articles']]
    index = {t: i for i, t in enumerate(titles)}
    ids = lambda ts: tuple(sorted({index[r] for r in map(snap.resolve, ts) if r in index}))
    links = [[i for i in ids(snap.pages[t]['body']) if i != index[t]] for t in titles]
    carried = [[k for k in map(ids, snap.pages[t]['boxes']) if k] for t in titles]
    boxes = sorted({k for ks in carried for k in ks})
    box_id = {k: i for i, k in enumerate(boxes)}
    return links, boxes, [sorted({box_id[k] for k in ks}) for ks in carried]


def encode(ids):
    """Sorted numbers as the gaps between them, from -1, in base 36, joined with commas."""
    digits, out, prev = '0123456789abcdefghijklmnopqrstuvwxyz', [], -1
    for i in ids:
        gap, s = i - prev, ''
        while gap:
            gap, d = divmod(gap, 36)
            s = digits[d] + s
        out.append(s)
        prev = i
    return ','.join(out)


# One entry per line, and no trailing commas, so what follows the = is JSON (common.read_data reads it back).
j = lambda v: json.dumps(v, ensure_ascii=False)
field = lambda key, value: f'  {j(key)}: {value}'
block = lambda items, open_, close: open_ + '\n' + ',\n'.join(f'    {i}' for i in items) + '\n  ' + close


def js_file(data, what, holds, name, fields):
    """A generated file: where it comes from and its license, then const name = {fields}."""
    return '\n'.join([
        f'// {what} as of {data["snapshot"]}, for MC Wiki Race: made by tools/wikidata/build.py from {data["file"]}.',
        f'// Its {holds} come from minecraft.wiki (https://minecraft.wiki), licensed under CC BY-NC-SA 3.0',
        '// (https://creativecommons.org/licenses/by-nc-sa/3.0/), not under the game\'s MIT license.',
        '// Don\'t edit it by hand; rebuild it from a newer ZIM (see docs/wiki-data.md).',
        f'const {name} = {{', ',\n'.join(fields), '};']) + '\n'


def render(data):
    """wiki-data.js."""
    fields = [field(k, j(data[k])) for k in ('snapshot', 'file', 'sha256', 'namespaces', 'topics', 'families', 'spinoffs')]
    fields.append(field('articles', block(map(j, data['articles']), '[', ']')))
    fields.append(field('hubs', block((f'{j(k)}: {j(v)}' for k, v in data['hubs'].items()), '{', '}')))
    fields.append(field('kinds', block((f'{j(k)}: {j(v)}' for k, v in data['kinds'].items()), '{', '}')))
    return js_file(data, 'minecraft.wiki', 'titles, categories and link counts', 'WIKI_DATA', fields)


def render_graph(data, links, boxes, carries):
    """wiki-links.js and wiki-navboxes.js."""
    sha = field('sha256', j(data['sha256']))
    entries = lambda lists: block((j(encode(ids)) for ids in lists), '[', ']')
    return (js_file(data, 'Links between minecraft.wiki\'s pages outside navboxes', 'links', 'WIKI_LINKS', [sha, field('links', entries(links))]),
            js_file(data, 'minecraft.wiki\'s navboxes', 'links', 'WIKI_NAVBOXES',
                    [sha, field('navboxes', entries(boxes)), field('carries', entries(carries))]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('snapshot')
    ap.add_argument('-o', '--out', default=DEFAULT_OUT, help='folder for wiki-data.js, wiki-links.js and wiki-navboxes.js')
    ap.add_argument('--config', default=CONFIG)
    args = ap.parse_args()
    snap = Snapshot(args.snapshot)
    data, sizes = build(snap, load_config(args.config))
    links, boxes, carries = graph(snap, data)
    for name, text in zip(('wiki-data.js', 'wiki-links.js', 'wiki-navboxes.js'), (render(data), *render_graph(data, links, boxes, carries))):
        with open(os.path.join(args.out, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    print(f'{os.path.normpath(args.out)}: {len(data["articles"])} pages, {len(data["hubs"])} hub titles, {len(data["kinds"])} kinds, {sum(map(len, links)):,} links outside '
          f'navboxes, {len(boxes)} navboxes ({sum(map(len, boxes)):,} links); content ' + ', '.join(f'{c} {n}' for c, n in sizes.items()), file=sys.stderr)


if __name__ == '__main__':
    main()
