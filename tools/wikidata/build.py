"""Builds wiki-data.js, the game's data about minecraft.wiki, and the link graph files beside it, from a snapshot made by
extract.py and config.json.

    .venv/bin/python -I tools/wikidata/build.py tools/wikidata/cache/minecraft.wiki_en_all_2026-08.jsonl.gz [-o folder]

The output defines WIKI_DATA, which index.html loads with a script tag (a JSON file couldn't be fetched from file://):
  snapshot, file, sha256  where it came from
  namespaces              names of the wiki's non-article namespaces, whose links the game disables
  topics                  the pool's topics, in config order
  families                the Content families' keys, in config order
  spinoffs                each spin-off namespace's name and number, in config order
  articles                every article and every spin-off page but the left-out pages: [title, linked from, linked
                          from outside navboxes, topic, families, tiers]
  hubs                    for the No hubs rule, every hub and every redirect to one, mapped to the hub
  left_out                the left-out pages and the redirects to them that pages link to, whose links the game kills
  kinds                   for Scavenger, each of the config's kinds: the name the game shows, its members' commonest
                          topic, its members (the config's fixed list of the pages that count, which par goes by) and
                          any also (pages that count too, which par doesn't go by)
The left-out pages are the version pages, the config's list pages (even those in a family) and the subpages of either.
Version pages are the articles and spin-off pages in a category ending in " versions" or in the config's version
categories, but those with a topic or a family. Both link to much of the pool and many articles link to them, so a route
through one is a cheat. They are left out altogether: they aren't listed, their links don't count, and the graph
doesn't go through them.
A pool-mode roll may only pick content: a page that isn't a subpage, a disambiguation page or in the config's
not-content categories or titles. Content in a family's categories, or in a spin-off namespace, has that family. Other
content in a topic's categories is in the pool, with that topic, and its tiers say whether it is Popular (the config's
best-linked share of the pool) or in Deep cuts (the least-linked share of its topic, among articles linked well enough
to be a target). Everything else has neither topic nor family, so only Chaos rolls it.
The link graph, for par, numbers pages by their place in articles and goes through redirects:
  wiki-links.js           WIKI_LINKS: for every page, the pages it links to outside navboxes
  wiki-navboxes.js        WIKI_NAVBOXES: every distinct navbox, as the pages it links to (the copies of a navbox only
                          differ by which page shows as plain text, which extract.py adds back), and for every page the
                          navboxes it carries. Stored once each, they are a ninth of the size of every page's own list.
  wiki-lead.js            WIKI_LEAD: for every page, the pages it links to above its first heading, for Top links only
All have the sha256 of wiki-data.js's ZIM, and the game only uses them with a wiki-data.js that has the same.
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


def left_out(snap, config, spinoff_ns, prefixes):
    """Leaves the left-out pages out of snap (see the docstring), if they aren't already, and returns their titles with
    the redirects to them that another article or spin-off page links to, sorted. Redirects nothing links to are left
    out, like pages newer than the snapshot: the list goes into every article the game shows."""
    extra, families = set(config['version_categories']), [set(f) for f in config['families'].values()]
    played = {t: p for t, p in (*snap.pages.items(), *snap.left_out.items()) if p['ns'] == 0 or p['ns'] in spinoff_ns}
    pages = set(config['list_titles'])
    for title, p in played.items():
        cats = set(p['cats'])
        if any(c.endswith(' versions') or c in extra for c in cats) and not (
                is_content(title, cats, config) and (p['ns'] or topic_of(cats, config) or any(cats & f for f in families))):
            pages.add(title)
    pages |= {t for t in played if any('/'.join(t.split('/')[:i]) in pages for i in range(1, t.count('/') + 1))}   # subpages
    linked = {t for title, p in played.items() if title not in pages for t in (*p['body'], *p['nav'])}
    snap.leave_out(pages - snap.left_out.keys())
    return sorted(pages | {t for t in snap.redirects if t in linked and snap.resolve(t) in pages and not t.startswith(prefixes)})


def check_config(snap, config):
    """Stops if the config names a category no page is in, or a not-content or list title that is no longer an article:
    a rename on the wiki would otherwise move articles out of their topic or family, or let a list page under its
    new title into the pool or the game, without a word."""
    named = dict.fromkeys([*(c for topic in config['topics'].values() for c in topic), *(c for family in config['families'].values() for c in family),
                           *config['not_content_categories'], *config['disambiguation_categories'], *config['version_categories']])
    seen = {c for p in (*snap.pages.values(), *snap.left_out.values()) for c in p['cats']}   # the left-out pages from a build before
    problems = [f'category no page is in: {c}' for c in named if c not in seen]
    problems += [f'{what} title that is no longer an article: {t}' + (f' (now a redirect to {snap.resolve(t)})' if t in snap.redirects else '')
                 for what, key in (('not-content', 'not_content_titles'), ('list', 'list_titles'))
                 for t in config[key] if snap.pages.get(t, snap.left_out.get(t, {})).get('ns') != 0]
    if problems:
        sys.exit('To look at in config.json:\n  ' + '\n  '.join(problems))


def kinds(snap, config, rows):
    """Scavenger kinds, from the config's fixed lists (see the docstring). Stops if a member or also page is no longer an
    article, as the game would never find it, a page is on both, a member is in a Content family (a route could end on a
    page its box hides) or an also page in none (par should go by it), or a kind has too few members, so a new snapshot
    gets the lists looked at again."""
    topics, families = {r[0]: r[3] for r in rows}, {r[0]: r[4] for r in rows}
    out, problems = {}, []
    for name, kind in config['kinds'].items():
        members, also = sorted(kind['members']), sorted(kind.get('also', []))
        problems += [f'{name}: on both members and also: {t}' for t in members if t in also]
        for what, titles in (('member', members), ('also page', also)):
            for t in titles:
                if snap.pages.get(t, {}).get('ns') != 0:
                    problems.append(f'{name}: {what} that is no longer an article: {t}' + (f' (now a redirect to {snap.resolve(t)})' if t in snap.redirects else ' (now left out)' if t in snap.left_out else ''))
        problems += [f'{name}: member in a Content family: {t}' for t in members if families.get(t)]
        problems += [f'{name}: also page in no Content family: {t}' for t in also if t in families and not families[t]]
        if len(members) < MIN_KIND:
            problems.append(f'{name}: {len(members)} members')
        found = [topics[t] for t in members if topics.get(t)]
        out[name] = {'label': kind['label'], 'topic': collections.Counter(found).most_common(1)[0][0] if found else '', 'members': members, **({'also': also} if also else {})}
    if problems:
        sys.exit('Scavenger kinds to look at in config.json:\n  ' + '\n  '.join(problems))
    return out


def build(snap, config):
    """The data for wiki-data.js and the content sizes. Leaves the left-out pages out of snap, for graph() and report.py."""
    check_config(snap, config)
    by_name = {name: ns for ns, name in snap.namespaces.items()}
    missing = [n for n in config['spinoffs'] if n not in by_name]
    if missing:
        sys.exit(f'Spin-off namespaces not in this snapshot: {", ".join(missing)}')
    spinoffs = {n: by_name[n] for n in config['spinoffs']}
    name_of = {ns: n for n, ns in spinoffs.items()}
    ns_names = namespaces(snap, config)
    left_out_titles = left_out(snap, config, set(name_of), tuple(n + ':' for n in ns_names if n not in spinoffs))
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
        'hubs': dict(sorted(hubs.items())), 'left_out': left_out_titles, 'kinds': kinds(snap, config, rows),
    }, sizes


def graph(snap, data):
    """The link graph between data's pages, by their index in its articles: for each page the pages it links to outside
    navboxes, the distinct navboxes (each the pages it links to, sorted), for each page the navboxes it carries, and for
    each page the pages it links to above its first heading."""
    titles = [r[0] for r in data['articles']]
    index = {t: i for i, t in enumerate(titles)}
    ids = lambda ts: tuple(sorted({index[r] for r in map(snap.resolve, ts) if r in index}))
    links = [[i for i in ids(snap.pages[t]['body']) if i != index[t]] for t in titles]
    carried = [[k for k in map(ids, snap.pages[t]['boxes']) if k] for t in titles]
    boxes = sorted({k for ks in carried for k in ks})
    box_id = {k: i for i, k in enumerate(boxes)}
    lead = [[i for i in ids(snap.pages[t]['lead']) if i != index[t]] for t in titles]
    return links, boxes, [sorted({box_id[k] for k in ks}) for ks in carried], lead


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
    fields.append(field('left_out', block(map(j, data['left_out']), '[', ']')))
    fields.append(field('kinds', block((f'{j(k)}: {j(v)}' for k, v in data['kinds'].items()), '{', '}')))
    return js_file(data, 'minecraft.wiki', 'titles, categories and link counts', 'WIKI_DATA', fields)


def render_graph(data, links, boxes, carries, lead):
    """wiki-links.js, wiki-navboxes.js and wiki-lead.js."""
    sha = field('sha256', j(data['sha256']))
    entries = lambda lists: block((j(encode(ids)) for ids in lists), '[', ']')
    return (js_file(data, 'Links between minecraft.wiki\'s pages outside navboxes', 'links', 'WIKI_LINKS', [sha, field('links', entries(links))]),
            js_file(data, 'minecraft.wiki\'s navboxes', 'links', 'WIKI_NAVBOXES',
                    [sha, field('navboxes', entries(boxes)), field('carries', entries(carries))]),
            js_file(data, 'Links above the first heading of minecraft.wiki\'s pages', 'links', 'WIKI_LEAD', [sha, field('links', entries(lead))]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('snapshot')
    ap.add_argument('-o', '--out', default=DEFAULT_OUT, help='folder for wiki-data.js and the graph files')
    ap.add_argument('--config', default=CONFIG)
    args = ap.parse_args()
    snap = Snapshot(args.snapshot)
    data, sizes = build(snap, load_config(args.config))
    links, boxes, carries, lead = graph(snap, data)
    for name, text in zip(('wiki-data.js', 'wiki-links.js', 'wiki-navboxes.js', 'wiki-lead.js'), (render(data), *render_graph(data, links, boxes, carries, lead))):
        with open(os.path.join(args.out, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    print(f'{os.path.normpath(args.out)}: {len(data["articles"])} pages, {len(data["hubs"])} hub titles, {len(data["left_out"])} left-out titles, {len(data["kinds"])} kinds, {sum(map(len, links)):,} links outside '
          f'navboxes, {len(boxes)} navboxes ({sum(map(len, boxes)):,} links), {sum(map(len, lead)):,} links above first headings; content ' + ', '.join(f'{c} {n}' for c, n in sizes.items()), file=sys.stderr)


if __name__ == '__main__':
    main()
