"""Writes a Markdown report on a snapshot: pool sizes, link counts, dead ends, Scavenger kinds with every member, pool designs
compared, and hub candidates.

    .venv/bin/python -I tools/wikidata/report.py tools/wikidata/cache/minecraft.wiki_en_all_2026-08.jsonl.gz [-o report.md]

The pool designs compared are the pools as built (Everyday, Popular, Deep cuts), the other Popular and Deep cuts shares
in the config's research section, and the Variants family on its own and added to Everyday (see RESEARCH.md for what the
first comparison found). Each is measured on
--pairs random pairs (200 by default, about 3 minutes in all) with a seed taken from its name, so a report is repeatable,
in three graphs, all without the version pages, which build.py leaves out: all links, without navboxes (the No navboxes
rule), and without navboxes or the config's hubs (both rules). Per design:
  1, 2, 3, 4+, none   share of pairs by fewest clicks (none: no route at all)
  good first clicks   how many links on the start page begin a shortest route (median)
  only one            share of pairs with exactly one good first click
  sweet spot          share of pairs taking 2+ clicks with a choice of good first clicks in the configured range
  ends                how many articles link to the start and to the target from outside navboxes (medians)
"""
import argparse, os, random, statistics, sys
from collections import Counter, deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for common.py and build.py under python -I
from common import MIN_BACKLINKS, Snapshot, load_config
from build import build, tiers, topic_of as topic_from


def reach(adj, start, skip=frozenset()):
    """Distance from start to every page it reaches in adj (pass the reversed graph for distances to start)."""
    dist = {start: 0}
    queue = deque([start])
    while queue:
        u = queue.popleft()
        for v in adj[u]:
            if v not in dist and v not in skip:
                dist[v] = dist[u] + 1
                queue.append(v)
    return dist


def reverse(adj):
    rev = [[] for _ in adj]
    for u, vs in enumerate(adj):
        for v in vs:
            rev[v].append(u)
    return rev


def quartiles(values):
    return ' / '.join(f'{q:g}' for q in statistics.quantiles(values, n=4)) if len(values) > 1 else '–'


def research_pools(config, data, topic_of):
    """The pools to compare, by name. topic_of: every article's topic by its categories, so variants (in no topic in the
    data, being a family) count in their topic too."""
    research, rows = config['research'], data['articles']
    everyday = [r[0] for r in rows if r[3]]
    variants = [r[0] for r in rows if 'variants' in r[4] and topic_of.get(r[0])]
    pools = {'Everyday': everyday, 'Everyday with variants': everyday + variants}
    for share in research['popular_shares']:
        pools[f'Popular {share:.0%}'] = sorted(tiers(rows, config, share, 0)[0])
    for share in research['deep_cuts_shares']:
        pools[f'Deep cuts {share:.0%} per topic'] = sorted(tiers(rows, config, 0, share)[1])
    pools['Variants only'] = variants
    return pools


def designs(pools, topic_of, rows, chaos):
    """(name, draw) for each pool with any pair and with different topics, then Chaos. draw(rng) gives (start, target)."""
    for name, pool in pools.items():
        targets = [t for t in pool if rows[t][2] >= MIN_BACKLINKS]
        if not targets:
            continue
        yield f'{name}, any pair', lambda rng, pool=pool, targets=targets: (rng.choice(pool), rng.choice(targets))
        groups = {}
        for t in pool:
            groups.setdefault(topic_of[t], []).append(t)
        aims = {k: [t for t in g if rows[t][2] >= MIN_BACKLINKS] for k, g in groups.items()}
        usable = [k for k in groups if aims[k]]
        if len(usable) >= 2:
            yield f'{name}, different topics', lambda rng, groups=groups, aims=aims, usable=usable: (
                lambda a, b: (rng.choice(groups[a]), rng.choice(aims[b])))(*rng.sample(usable, 2))
    chaos_targets = [t for t in chaos if rows[t][2] >= MIN_BACKLINKS]
    yield 'Chaos (every article)', lambda rng: (rng.choice(chaos), rng.choice(chaos_targets))


def measure(draw, seed, graph, index, rows, cache, pairs, sweet_range):
    adj, radj, skip = graph
    rng = random.Random(seed)
    hist, good, ends, sweet, n = Counter(), [], [], 0, 0
    for _ in range(pairs * 20):   # a tiny pool may keep drawing the same article twice
        if n == pairs:
            break
        s, t = draw(rng)
        si, ti = index[s], index[t]
        if s == t or si in skip or ti in skip:
            continue
        n += 1
        if ti not in cache:
            cache[ti] = reach(radj, ti, skip)
        back = cache[ti]
        clicks = back.get(si)
        hist[None if clicks is None else min(clicks, 4)] += 1
        if clicks:
            g = sum(1 for v in adj[si] if v not in skip and back.get(v) == clicks - 1)
            good.append(g)
            sweet += clicks >= 2 and sweet_range[0] <= g <= sweet_range[1]
        ends.append((rows[s][2], rows[t][2]))
    if not n:
        return None
    share = lambda k: f'{hist[k] / n:.0%}' if hist[k] else ''
    return [share(1), share(2), share(3), share(4), share(None), f'{statistics.median(good):.0f}' if good else '–',
            f'{sum(g == 1 for g in good) / len(good):.0%}' if good else '–', f'{sweet / n:.0%}',
            f'{statistics.median(e[0] for e in ends):.0f}/{statistics.median(e[1] for e in ends):.0f}']


def report(snap, config, pairs):
    data, sizes = build(snap, config)
    index, body, nav = snap.graph()
    full_adj = [b | n for b, n in zip(body, nav)]
    full_in, outside_in = snap.backlinks()
    rows = {r[0]: r for r in data['articles']}
    pool = sorted(index[t] for t, r in rows.items() if r[3])
    wide = sorted(index[t] for t, r in rows.items() if t in index and r[2] >= MIN_BACKLINKS)
    hubs = {index[h] for h in config['hubs']}
    full_rev, body_rev = reverse(full_adj), reverse(body)
    # Dead ends, measured from the most linked article: pages that can't reach it can't reach most of the wiki either.
    core = max(range(len(snap.articles)), key=lambda i: full_in[i])
    to_core, from_core = reach(full_rev, core), reach(full_adj, core)
    out = []
    w = out.append

    m = snap.meta
    w(f'# minecraft.wiki snapshot {m["date"]}\n')
    w(f'From `{m["file"]}` (sha256 `{m["sha256"][:16]}…`, {m["scraper"]}).\n')
    ns = Counter(p['ns'] for p in snap.pages.values())
    w('| | |\n|---|---|')
    w(f'| Articles (main namespace) | {len(snap.articles):,} |')
    w(f'| Other pages | ' + ', '.join(f'{snap.namespaces.get(k, k)} {v:,}' for k, v in sorted(ns.items()) if k) + ' |')
    w(f'| Redirects | {len(snap.redirects):,} |')
    w(f'| In the pool (a topic) | {len(pool):,} |')
    w(f'| Possible targets (linked from {MIN_BACKLINKS}+ articles outside navboxes) | {len(wide):,} |')
    w(f'| Article links | {sum(map(len, full_adj)):,} ({sum(map(len, body)):,} outside navboxes) |')
    w(f'| Articles no article links to | {sum(1 for c in full_in if not c):,} |')
    w(f'| Dead ends: articles with no route to {snap.articles[core]} (a game starting there can\'t be won) | '
      f'{len(snap.articles) - len(to_core):,} |')
    w(f'| Articles no route from {snap.articles[core]} reaches (can never be reached) | {len(snap.articles) - len(from_core):,} |\n')

    topic_of = {t: topic_from(set(snap.pages[t]['cats']), config) for t in snap.articles}   # by category, families too
    marked = [t for t in snap.articles if topic_of[t] and (t in config['not_content_titles']
                                                           or set(snap.pages[t]['cats']) & set(config['not_content_categories']))]
    w('## Topics\n')
    w('| Topic | In pool | Popular | Deep cuts | Moved to a family | Not content | Under 5 links outside navboxes |')
    w('|---|--:|--:|--:|--:|--:|--:|')
    for k in config['topics']:
        members = [t for t in snap.articles if topic_of[t] == k and '/' not in t]
        pooled = [t for t in members if rows[t][3] == k]
        w(f'| {k} | {sizes[k]} | {sum("popular" in rows[t][5] for t in pooled)} | {sum("deep" in rows[t][5] for t in pooled)} | '
          f'{sum(1 for t in members if rows[t][4])} | {sum(1 for t in members if t in marked)} | '
          f'{sum(1 for t in pooled if rows[t][2] < MIN_BACKLINKS)} |')
    left = Counter(f for t in snap.articles if topic_of[t] for f in rows[t][4])
    w('\nMoved to a Content family: ' + ', '.join(f'{k} {n}' for k, n in sorted(left.items())) + '.')
    w(f'Not game content ({len(marked)}): ' + (', '.join(marked) or 'none') + '.\n')

    w('## Content families and spin-offs\n')
    w('What a ticked Content or Spin-offs checkbox adds to a pool-mode roll. A spin-off\'s pages all count in Chaos.\n')
    w('| Content | Pages | Possible targets |\n|---|--:|--:|')
    for k in [*config['families'], *config['spinoffs']]:
        members = [r for r in data['articles'] if k in r[4]]
        w(f'| {k} | {len(members):,} | {sum(r[2] >= MIN_BACKLINKS for r in members):,} |')
    w('')

    w('## Scavenger kinds\n')
    w('Every member of every kind, to read through before shipping a new snapshot: the game counts these as finds (and a '
      'page the live wiki puts in the category, less the exclusions).\n')
    w('| Category | Shown as | Topic | Members | Excluded |\n|---|---|---|--:|---|')
    for cat, kind in data['kinds'].items():
        w(f'| {cat} | {kind["label"]} | {kind["topic"]} | {len(kind["members"])} | {", ".join(kind["exclude"]) or "–"} |')
    w('')
    for cat, kind in data['kinds'].items():
        w(f'- **{cat}:** ' + ', '.join(kind['members']))
    w('')

    w('## Links to pool articles\n')
    w('| | Quartiles |\n|---|---|')
    w(f'| Linking articles | {quartiles([full_in[i] for i in pool])} |')
    w(f'| Outside navboxes | {quartiles([outside_in[i] for i in pool])} |\n')

    research = config['research']
    pools = research_pools(config, data, topic_of)
    links = lambda t: rows[t][2]
    w('## Pool definitions\n')
    w('Variants by category: ' + ', '.join(f'{c} {sum(c in snap.pages[t]["cats"] for t in pools["Variants only"])}'
                                         for c in config['families']['variants']) + '.\n')
    w('| Pool | Articles | Links outside navboxes (median, range) | ' + ' | '.join(config['topics']) + ' |')
    w('|---|--:|---|' + '--:|' * len(config['topics']))
    for name, p in pools.items():
        tc = Counter(topic_of[t] for t in p)
        span = f'{statistics.median(map(links, p)):.0f} ({min(map(links, p))}–{max(map(links, p))})' if p else '–'
        w(f'| {name} | {len(p):,} | {span} | ' + ' | '.join(str(tc[k]) for k in config['topics']) + ' |')
    w('')
    for name, p in pools.items():
        if not p:
            continue
        edge = sorted(p, key=links)
        line = f'- **{name}:** least linked ' + ', '.join(f'{t} ({links(t)})' for t in edge[:5])
        if name.startswith('Popular'):
            line += '; best linked ' + ', '.join(f'{t} ({links(t)})' for t in edge[-3:])
        w(line + '; random ' + ', '.join(random.Random(name).sample(p, min(8, len(p)))) + '.')
    w('')

    w('## Pool designs\n')
    lo, hi = research['sweet_spot_first_clicks']
    w(f'{pairs} random pairs per row.\n')
    w('- **1, 2, 3, 4+, none:** share of pairs by fewest clicks (none: no route at all).')
    w('- **Good first clicks:** how many links on the start page begin a shortest route (median).')
    w('- **Only one:** share of pairs with exactly one good first click.')
    w(f'- **Sweet spot:** share of pairs taking 2+ clicks with {lo}–{hi} good first clicks.')
    w('- **Ends:** how many articles link to the start and to the target from outside navboxes (medians).\n')
    for gname, graph in (('All links', (full_adj, full_rev, frozenset())), ('No navboxes', (body, body_rev, frozenset())),
                         ('No navboxes, no hubs', (body, body_rev, frozenset(hubs)))):
        w(f'### {gname}\n')
        w('| Design | 1 | 2 | 3 | 4+ | none | good first clicks | only one | sweet spot | ends |')
        w('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|')
        cache = {}
        for name, draw in designs(pools, topic_of, rows, snap.articles):
            cells = measure(draw, name + gname, graph, index, rows, cache, pairs, (lo, hi))
            if cells:
                w(f'| {name} | ' + ' | '.join(cells) + ' |')
        w('')

    w('## Hub candidates\n')
    w('Articles with the most linking articles outside navboxes, times links out. ✓ marks the config\'s hubs.\n')
    w('| Article | Linked from | Outside navboxes | Links out | Hub |\n|---|--:|--:|--:|:-:|')
    score = sorted(range(len(snap.articles)), key=lambda i: -outside_in[i] * len(full_adj[i]))
    for i in score[:40]:
        w(f'| {snap.articles[i]} | {full_in[i]:,} | {outside_in[i]:,} | {len(full_adj[i]):,} | {"✓" if i in hubs else ""} |')
    missing = [snap.articles[i] for i in hubs if i not in score[:40]]
    if missing:
        w('\nHubs outside the top 40: ' + ', '.join(sorted(missing)) + '.')
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('snapshot')
    ap.add_argument('-o', '--out')
    ap.add_argument('--pairs', type=int, default=200)
    args = ap.parse_args()
    text = report(Snapshot(args.snapshot), load_config(), args.pairs)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text)
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
