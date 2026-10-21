"""Loading a snapshot (from extract.py) and the link graph built from it, shared by build.py and report.py."""
import gzip, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, 'config.json')
MIN_BACKLINKS = 5   # as in index.html: a target needs this many linking articles outside navboxes


def load_config(path=CONFIG):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


class Snapshot:
    def __init__(self, path):
        self.pages, self.redirects = {}, {}
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            head = json.loads(f.readline())
            self.meta = head['meta']
            self.namespaces = {int(k): v for k, v in head['namespaces'].items()}
            for line in f:
                o = json.loads(line)
                if 'page' in o:
                    self.pages[o['page']] = o
                else:
                    self.redirects[o['redirect']] = o['to']
        self.articles = sorted(t for t, p in self.pages.items() if p['ns'] == 0)
        self._graph = None

    def resolve(self, title):
        """The page a title leads to, through any chain of redirects (None for a loop)."""
        seen = set()
        while title in self.redirects:
            if title in seen:
                return None
            seen.add(title)
            title = self.redirects[title]
        return title

    def graph(self):
        """Article-to-article links, through redirects: (index of titles, links outside navboxes, links in navboxes only).
        Each is a list of sets of target indices, one per article in self.articles."""
        if self._graph is None:
            index = {t: i for i, t in enumerate(self.articles)}
            body, nav = [], []
            for i, t in enumerate(self.articles):
                p = self.pages[t]
                b = {index[r] for r in map(self.resolve, p['body']) if r in index} - {i}
                n = {index[r] for r in map(self.resolve, p['nav']) if r in index} - {i} - b
                body.append(b)
                nav.append(n)
            self._graph = index, body, nav
        return self._graph

    def backlinks(self):
        """For every article, how many other articles link to it at all, and how many outside navboxes."""
        _, body, nav = self.graph()
        full, outside = [0] * len(self.articles), [0] * len(self.articles)
        for b, n in zip(body, nav):
            for j in b:
                full[j] += 1
                outside[j] += 1
            for j in n:
                full[j] += 1
        return full, outside


def spinoff_backlinks(snap, namespaces):
    """For every page in these namespaces, how many pages link to it at all and how many outside navboxes. Only links
    from articles and from pages in its own namespace count: the pages a player can be on when that spin-off is on."""
    ns_of = {t: p['ns'] for t, p in snap.pages.items() if p['ns'] in namespaces}
    full, outside = dict.fromkeys(ns_of, 0), dict.fromkeys(ns_of, 0)
    for src, p in snap.pages.items():
        if p['ns'] != 0 and p['ns'] not in namespaces:
            continue
        body = {r for r in map(snap.resolve, p['body']) if r in ns_of} - {src}
        nav = {r for r in map(snap.resolve, p['nav']) if r in ns_of} - {src} - body
        for r in body | nav:
            if p['ns'] in (0, ns_of[r]):
                full[r] += 1
                outside[r] += r in body
    return full, outside


def read_data(path):
    """The WIKI_DATA object from a wiki-data.js written by build.py."""
    with open(path, encoding='utf-8') as f:
        text = f.read()
    return json.loads(text[text.index('const WIKI_DATA = ') + len('const WIKI_DATA = '):text.rindex(';')])
