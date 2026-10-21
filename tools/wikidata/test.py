"""Tests extract.py, build.py and diff.py on a small ZIM written here in the shape of mwoffliner's output, so they run
in a few seconds without the real ZIM:

    .venv/bin/python -I tools/wikidata/test.py
"""
import copy, filecmp, os, sys, tempfile
from libzim.writer import Creator, Hint, Item, StringProvider

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for the tools under python -I
from common import Snapshot, load_config, read_data
from extract import extract
from build import build, render
from diff import diff

failures = 0


def check(name, ok, extra=''):
    global failures
    print(f'{"PASS" if ok else "FAIL"}  {name}{"  " + str(extra) if extra and not ok else ""}')
    failures += not ok


def page(title, ns, content, cats=(), hidden=()):
    cl = ''.join(f'<li><a href="Category%3A{c.replace(" ", "_")}" title="Category:{c}">{c}</a></li>' for c in cats)
    hl = ''.join(f'<li>{c}</li>' for c in hidden)
    return (f'<!DOCTYPE html><html><head><title>{title}</title></head>'
            f'<body class="mediawiki ns-{ns} page-{title.replace(" ", "_")}"><div id="content"><h1>{title}</h1>'
            f'<a href="./Main_Page">header link</a>'
            f'<div class="mw-content-ltr mw-parser-output">{content}</div>'
            f'<div id="catlinks" class="catlinks"><div id="mw-normal-catlinks">Categories: <ul>{cl}</ul></div>'
            f'<div id="mw-hidden-catlinks">Hidden categories: <ul>{hl}</ul></div></div>'
            f'<div class="zim-footer"><a class="external text" href="https://minecraft.wiki/w/?title=X">Minecraft Wiki</a></div>'
            f'</div></body></html>')


NAVBOX = ('<table class="navbox hlist collapsible"><tr><td><a href="Creeper">Creeper</a>'
          '<table class="navbox-inner"><tr><td><a href="Block">Block</a></td></tr></table>'
          '<a href="Diamond_Pickaxe">again in a navbox</a></td></tr></table>')
PAGES = {
    'Diamond': (0, '<p><a href="Diamond_Pickaxe">pickaxe</a>, <a href="Iron_ingot#Uses">ingot</a> (a redirect), '
                   '<a href="Tutorial%3AMining">tutorial</a>, <a href="#Obtaining">same page</a>, '
                   '<a href="https://example.com/">external</a>, <a class="new" href="Nope">red link</a>, '
                   '<a href="Diamond">itself</a>, <a href="Village_%26_Pillage">encoded</a>, <a href="Village_&amp;_Pillage">escaped</a></p>'
                   '<map><area href="Breaking" shape="rect"></map>' + NAVBOX, ['Items'], ['Pages with sound tables']),
    'Diamond Pickaxe': (0, '<a href="Diamond">diamond</a> <a href="Block">block</a>', ['Items', 'Tools']),
    'Creeper': (0, '<a href="Diamond">diamond</a>', ['Hostile mobs', 'Entities']),
    'Iron Ingot': (0, '<a href="Diamond">diamond</a>', ['Items']),
    'Block': (0, '<a href="Diamond">diamond</a>', []),
    'Breaking': (0, '<a href="Block">block</a>', []),
    'Village & Pillage': (0, '', []),
    'Minecraft: Story Mode': (0, '<a href="Diamond">diamond</a>', []),
    'Ankle Monitor': (0, '<a href="Diamond">diamond</a>', ['Items', 'Joke features']),
    'Diamond (disambiguation)': (0, '<a href="Diamond">diamond</a>', ['Disambiguation pages']),
    'Diamond Pickaxe/Render': (0, '<a href="../Diamond">diamond</a> <a href="Old">sibling</a>', ['Items']),
    'Diamond Pickaxe/Old': (0, '', ['Items']),
    'Tutorial:Mining': (10010, '<a href="Diamond">diamond</a> <a href="Creeper">creeper</a>', []),
    'Category:Items': (14, '<a href="Diamond">diamond</a>', []),
}
REDIRECTS = {'Blocks': 'Block', 'Iron ingot': 'Iron Ingot'}
# mwoffliner writes a redirect to a section as a forwarding page, with a link relative to its own path.
SECTION_REDIRECTS = {'Mining': './Breaking#Speed', 'Breaking/Mining': '../Breaking#Speed'}


class Html(Item):
    def __init__(self, path, title, html):
        super().__init__()
        self.path, self.title, self.html = path, title, html

    def get_path(self): return self.path
    def get_title(self): return self.title
    def get_mimetype(self): return 'text/html'
    def get_contentprovider(self): return StringProvider(self.html)
    def get_hints(self): return {Hint.FRONT_ARTICLE: True}


def write_zim(path):
    with Creator(path).config_indexing(False, 'eng').config_verbose(False) as c:
        c.set_mainpath('Diamond')
        for k, v in {'Name': 'minecraft.wiki_en_all', 'Date': '2026-08-21', 'Scraper': 'mwoffliner test', 'Source': 'minecraft.wiki',
                     'Title': 'Test', 'Language': 'eng', 'Creator': 'test', 'Publisher': 'test', 'Description': 'test'}.items():
            c.add_metadata(k, v)
        for title, (ns, content, *cats) in PAGES.items():
            c.add_item(Html(title.replace(' ', '_'), title, page(title, ns, content, *cats)))
        for title, to in SECTION_REDIRECTS.items():
            c.add_item(Html(title, title, f'<html><head><title>{title}</title><meta http-equiv="refresh" content="0;URL=\'{to}\'" /></head>'
                                          f'<body><a href="{to}">{title}</a></body></html>'))
        for title, to in REDIRECTS.items():
            c.add_redirection(title.replace(' ', '_'), title, to.replace(' ', '_'), {Hint.FRONT_ARTICLE: True})


CONFIG = {**load_config(), 'pool_categories': ['Items', 'Tools', 'Hostile mobs'], 'hubs': ['Block', 'Breaking'],
          'core_namespaces': ['Special', 'File', 'Category']}

with tempfile.TemporaryDirectory() as tmp:
    zim = os.path.join(tmp, 'test.zim')
    write_zim(zim)
    snap_path, again = os.path.join(tmp, 'a.jsonl.gz'), os.path.join(tmp, 'b.jsonl.gz')
    meta, _, _ = extract(zim, snap_path)
    extract(zim, again)
    check('extracting twice gives the same bytes', filecmp.cmp(snap_path, again, shallow=False))
    check('the snapshot keeps the ZIM date and checksum', meta['date'] == '2026-08-21' and len(meta['sha256']) == 64, meta)

    snap = Snapshot(snap_path)
    d = snap.pages['Diamond']
    check('links outside navboxes, image maps included, the page header left out',
          d['body'] == ['Breaking', 'Diamond', 'Diamond Pickaxe', 'Iron ingot', 'Tutorial:Mining', 'Village & Pillage'], d['body'])
    check('links in navboxes, nested tables included', d['nav'] == ['Block', 'Creeper', 'Diamond Pickaxe'], d['nav'])
    check('visible categories only', d['cats'] == ['Items'], d['cats'])
    check('namespaces from body classes, not from colons in titles', snap.namespaces == {14: 'Category', 10010: 'Tutorial'}, snap.namespaces)
    check('a section redirect page is a redirect', snap.redirects.get('Mining') == 'Breaking' and 'Mining' not in snap.pages)
    check('links and section redirects on a subpage are relative to it',
          snap.pages['Diamond Pickaxe/Render']['body'] == ['Diamond', 'Diamond Pickaxe/Old'] and snap.redirects.get('Breaking/Mining') == 'Breaking',
          (snap.pages['Diamond Pickaxe/Render']['body'], snap.redirects.get('Breaking/Mining')))
    check('redirects resolve', snap.resolve('Iron ingot') == 'Iron Ingot' and snap.resolve('Diamond') == 'Diamond')
    # libzim drops looping redirects when writing, so this one is made up.
    looped = copy.copy(snap)
    looped.redirects = {**snap.redirects, 'Loop A': 'Loop B', 'Loop B': 'Loop A'}
    check('a redirect loop resolves to nothing', looped.resolve('Loop A') is None)

    data, sizes = build(snap, CONFIG)
    rows = {r[0]: r for r in data['articles']}
    check('every article is listed, and no page from another namespace', sorted(rows) == sorted(t for t, (ns, *_) in PAGES.items() if ns == 0), sorted(rows))
    check('the pool leaves out subpages, disambiguation pages and excluded categories',
          all(rows[t][3] == [] for t in ('Diamond Pickaxe/Render', 'Diamond (disambiguation)', 'Ankle Monitor')), sorted(rows))
    check('an article with a colon in its title is still an article', 'Minecraft: Story Mode' in rows)
    # Diamond: linked from Diamond Pickaxe, Creeper, Iron Ingot, Block and Minecraft: Story Mode, plus the subpage,
    # disambiguation page and joke article, which are articles even if rolls skip them. Not from Tutorial:Mining.
    check('links counted per article, through redirects', rows['Diamond'][1:3] == [8, 8], rows['Diamond'])
    check('navbox-only links counted apart', rows['Creeper'][1:3] == [1, 0] and rows['Diamond Pickaxe'][1:3] == [1, 1],
          (rows['Creeper'], rows['Diamond Pickaxe']))
    check('a link through a redirect counts', rows['Iron Ingot'][1:3] == [1, 1], rows['Iron Ingot'])
    check('pool categories per article, in config order', rows['Diamond Pickaxe'][3] == ['Items', 'Tools'] and rows['Block'][3] == [])
    check('pool sizes', sizes == {'Items': 3, 'Tools': 1, 'Hostile mobs': 1}, sizes)
    check('namespaces: core, then the ZIM\'s with their talk namespaces',
          data['namespaces'] == ['Special', 'File', 'Category', 'Category talk', 'Tutorial', 'Tutorial talk'], data['namespaces'])
    check('hubs and redirects to them, sections included',
          data['hubs'] == {'Block': 'Block', 'Blocks': 'Block', 'Breaking': 'Breaking', 'Breaking/Mining': 'Breaking', 'Mining': 'Breaking'},
          data['hubs'])

    out = os.path.join(tmp, 'wiki-data.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(render(data))
    check('rendering is stable and reads back', render(build(Snapshot(again), CONFIG)[0]) == render(data) and read_data(out) == data)

    newer = copy.deepcopy(data)
    newer['snapshot'] = '2026-11-21'
    newer['articles'] = [r for r in newer['articles'] if r[0] != 'Creeper'] + [['Copper Golem', 40, 30, ['Hostile mobs']]]
    newer['articles'][[r[0] for r in newer['articles']].index('Diamond')][2] = 30
    newer['hubs'].pop('Mining')
    report = diff(data, newer, min_links=5)
    check('diff lists added and removed articles, category moves, link changes and hubs',
          all(s in report for s in ('2026-08-21', '2026-11-21', 'added (1): Copper Golem', 'removed (1): Creeper',
                                    'Hostile mobs: 1 → 1', 'Diamond: 8 → 30', 'Hubs: +none; −Mining')), report)

print('all passed' if not failures else f'{failures} failed')
sys.exit(1 if failures else 0)
