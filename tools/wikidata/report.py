"""Writes a Markdown report on a snapshot: pool sizes, link counts, shortest routes between rolls, and hub candidates.

    .venv/bin/python -I tools/wikidata/report.py tools/wikidata/cache/minecraft.wiki_en_all_2026-08.jsonl.gz [-o report.md]

Shortest routes are sampled (--pairs start articles, each to --pairs targets) with a fixed seed, so a report is
repeatable. "No hubs" removes the config's hubs from the graph, as the No hubs rule does. Pool means the articles
build.py puts in the pool categories, and wide means every article linked from enough articles to be a target.
"""
import argparse, os, random, statistics, sys
from collections import Counter, deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for common.py and build.py under python -I
from common import Snapshot, load_config
from build import build

MIN_BACKLINKS = 5   # as in index.html: a target needs this many linking articles outside navboxes


def distances(adj, start, skip):
    dist = {start: 0}
    queue = deque([start])
    while queue:
        u = queue.popleft()
        for v in adj[u]:
            if v not in dist and v not in skip:
                dist[v] = dist[u] + 1
                queue.append(v)
    return dist


def route_table(rng, adj, starts, targets, skip, pairs):
    hist, total = Counter(), 0
    for s in rng.sample(starts, min(pairs, len(starts))):
        dist = distances(adj, s, skip)
        for t in rng.sample(targets, min(pairs, len(targets))):
            if t != s:
                hist[dist.get(t)] += 1
                total += 1
    share = lambda n: f'{n / total:.0%}' if n else ''
    return [share(hist[k]) for k in range(1, 7)] + [share(sum(v for k, v in hist.items() if k and k >= 7)), share(hist[None])]


def quartiles(values):
    return ' / '.join(f'{q:g}' for q in statistics.quantiles(values, n=4)) if len(values) > 1 else '–'


def report(snap, config, pairs):
    data, sizes = build(snap, config)
    index, body, nav = snap.graph()
    full_adj = [b | n for b, n in zip(body, nav)]
    full_in, outside_in = snap.backlinks()
    rows = {r[0]: r for r in data['articles']}
    pool = sorted(index[t] for t, r in rows.items() if r[3])
    wide = sorted(index[t] for t, r in rows.items() if t in index and r[2] >= MIN_BACKLINKS)
    hubs = {index[h] for h in config['hubs']}
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
    w(f'| In pool categories | {len(pool):,} |')
    w(f'| Possible targets (linked from {MIN_BACKLINKS}+ articles outside navboxes) | {len(wide):,} |')
    w(f'| Article links | {sum(map(len, full_adj)):,} ({sum(map(len, body)):,} outside navboxes) |')
    w(f'| Articles no article links to | {sum(1 for c in full_in if not c):,} |\n')

    w('## Pool categories\n')
    w('| Category | In pool | Left out | Under 5 links outside navboxes |\n|---|--:|--:|--:|')
    for c in config['pool_categories']:
        members = [t for t in snap.articles if c in snap.pages[t]['cats'] and '/' not in t]
        dropped = sum(1 for t in members if c not in rows[t][3])
        weak = sum(1 for t in members if c in rows[t][3] and rows[t][2] < MIN_BACKLINKS)
        w(f'| {c} | {sizes[c]} | {dropped} | {weak} |')
    left = Counter(f for t in snap.articles if set(snap.pages[t]['cats']) & set(config['pool_categories']) for f in rows[t][4])
    w('\nMoved to a Content family: ' + ', '.join(f'{k} {n}' for k, n in sorted(left.items())) + '.\n')

    w('## Content families and spin-offs\n')
    w('What a ticked Content or Spin-offs checkbox adds to a pool-mode roll. A spin-off\'s pages all count in Chaos.\n')
    w('| Content | Pages | Possible targets |\n|---|--:|--:|')
    for k in [*config['families'], *config['spinoffs']]:
        members = [r for r in data['articles'] if k in r[4]]
        w(f'| {k} | {len(members):,} | {sum(r[2] >= MIN_BACKLINKS for r in members):,} |')
    w('')

    w('## Links to pool articles\n')
    w('| | Quartiles |\n|---|---|')
    w(f'| Linking articles | {quartiles([full_in[i] for i in pool])} |')
    w(f'| Outside navboxes | {quartiles([outside_in[i] for i in pool])} |\n')

    w('## Shortest routes\n')
    w(f'Share of sampled pairs ({pairs}×{pairs} per row) by fewest clicks. "None" means no route at all.\n')
    w('| Graph | Pairs | 1 | 2 | 3 | 4 | 5 | 6 | 7+ | None |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|')
    rng = random.Random(1)
    for label, adj, skip in (('All links', full_adj, set()), ('No navboxes', body, set()),
                             ('No hubs', full_adj, hubs), ('No navboxes, no hubs', body, hubs)):
        for plabel, targets in (('pool → pool', pool), ('pool → wide', wide)):
            starts = [i for i in pool if i not in skip]
            w(f'| {label} | {plabel} | ' + ' | '.join(route_table(rng, adj, starts, [t for t in targets if t not in skip], skip, pairs)) + ' |')

    w('\n## Hub candidates\n')
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
    ap.add_argument('--pairs', type=int, default=100)
    args = ap.parse_args()
    text = report(Snapshot(args.snapshot), load_config(), args.pairs)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text)
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
