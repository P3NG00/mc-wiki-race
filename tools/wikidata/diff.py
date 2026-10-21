"""Summarises what changed between two wiki-data.js files: pages, topic, tier, Content and Scavenger kind members added and
removed, link counts that moved a lot, and hub and namespace changes. Compare with the committed one by reading it from git:

    .venv/bin/python -I tools/wikidata/diff.py <(git show HEAD:wiki-data.js) wiki-data.js
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for common.py under python -I
from common import read_data


def listing(titles, limit=60):
    titles = sorted(titles)
    more = f' … and {len(titles) - limit} more' if len(titles) > limit else ''
    return ', '.join(titles[:limit]) + more


def diff(old, new, moved=0.5, min_links=20):
    out = []
    w = out.append
    w(f'{old["snapshot"]} ({old["file"]}) → {new["snapshot"]} ({new["file"]})')
    a, b = {r[0]: r for r in old['articles']}, {r[0]: r for r in new['articles']}
    w(f'Pages: {len(a):,} → {len(b):,}')
    if b.keys() - a.keys():
        w(f'  added ({len(b.keys() - a.keys())}): {listing(b.keys() - a.keys())}')
    if a.keys() - b.keys():
        w(f'  removed ({len(a.keys() - b.keys())}): {listing(a.keys() - b.keys())}')
    keys = lambda d: [*d['topics'], 'popular', 'deep', *d['families'], *d['spinoffs']]
    member = lambda r, k: k == r[3] or k in r[4] or k in r[5]
    for cat in dict.fromkeys(keys(old) + keys(new)):
        was = {t for t, r in a.items() if member(r, cat)}
        now = {t for t, r in b.items() if member(r, cat)}
        if was != now:
            w(f'{cat}: {len(was)} → {len(now)}')
            if now - was:
                w(f'  joined: {listing(now - was)}')
            if was - now:
                w(f'  left: {listing(was - now)}')
    kinds = [d.get('kinds', {}) for d in (old, new)]   # none in a file from before Scavenger
    for cat in dict.fromkeys([*kinds[0], *kinds[1]]):
        was, now = (set(k.get(cat, {}).get('members', [])) for k in kinds)
        if was != now:
            w(f'Kind {cat}: {len(was)} → {len(now)}')
            if now - was:
                w(f'  joined: {listing(now - was)}')
            if was - now:
                w(f'  left: {listing(was - now)}')
    # Counts outside navboxes, which decide whether an article can be a target.
    changed = sorted(((t, a[t][2], b[t][2]) for t in a.keys() & b.keys()
                      if max(a[t][2], b[t][2]) >= min_links and abs(b[t][2] - a[t][2]) >= moved * max(a[t][2], 1)),
                     key=lambda x: -abs(x[2] - x[1]))
    if changed:
        w(f'Links from outside navboxes moved by {moved:.0%} or more ({len(changed)}):')
        for t, x, y in changed[:40]:
            w(f'  {t}: {x} → {y}')
    for key in ('hubs', 'namespaces'):
        x, y = set(old[key]), set(new[key])
        if x != y:
            w(f'{key.capitalize()}: +{listing(y - x) or "none"}; −{listing(x - y) or "none"}')
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('old')
    ap.add_argument('new')
    args = ap.parse_args()
    sys.stdout.write(diff(read_data(args.old), read_data(args.new)))


if __name__ == '__main__':
    main()
