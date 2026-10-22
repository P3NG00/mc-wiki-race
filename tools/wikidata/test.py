"""Tests extract.py, build.py and diff.py on a small ZIM written here in the shape of mwoffliner's output, so they run
in a few seconds without the real ZIM:

    .venv/bin/python -I tools/wikidata/test.py
"""
import copy, filecmp, os, re, sys, tempfile
from libzim.writer import Creator, Hint, Item, StringProvider

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # for the tools under python -I
from common import Snapshot, load_config, read_data
from extract import extract
import build as build_module
from build import build, graph, render, render_graph
from diff import diff
from report import report

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
# A navbox both its pages carry, each showing itself as plain text, as mwoffliner does: build.py stores it once.
family = lambda own: '<table class="navbox"><tr><td>' + ' '.join(
    f'<b>{t}</b>' if t == own else f'<a href="{t.replace(" ", "_")}">{t}</a>' for t in ('Charcoal', 'Iron Ingot')) + '</td></tr></table>'
PAGES = {
    'Diamond': (0, '<p><a href="Diamond_Pickaxe">pickaxe</a>, <a href="Iron_ingot#Uses">ingot</a> (a redirect), '
                   '<a href="Tutorial%3AMining">tutorial</a>, <a href="#Obtaining">same page</a>, '
                   '<a href="https://example.com/">external</a>, <a class="new" href="Nope">red link</a>, '
                   '<a href="Diamond">itself</a>, <a href="Village_%26_Pillage">encoded</a>, <a href="Village_&amp;_Pillage">escaped</a></p>'
                   '<map><area href="Breaking" shape="rect"></map>' + NAVBOX, ['Items'], ['Pages with sound tables']),
    'Diamond Pickaxe': (0, '<a href="Diamond">diamond</a> <a href="Block">block</a>', ['Items', 'Tools']),
    'Creeper': (0, '<a href="Diamond">diamond</a> <a href="Dungeons%3ACreeper">in Dungeons</a> <a href="1.0">a version</a>',
                ['Hostile mobs', 'Entities']),
    'Iron Ingot': (0, '<a href="Diamond">diamond</a>' + family('Iron Ingot'), ['Items']),
    'Block': (0, '<a href="Diamond">diamond</a>', []),
    'Breaking': (0, '<a href="Block">block</a>', []),
    'Village & Pillage': (0, '', []),
    'Minecraft: Story Mode': (0, '<a href="Diamond">diamond</a>', []),
    'Ankle Monitor': (0, '<a href="Diamond">diamond</a>', ['Items', 'Joke features']),
    'Diamond (disambiguation)': (0, '<a href="Diamond">diamond</a>', ['Disambiguation pages']),
    'Diamond Pickaxe/Render': (0, '<a href="../Diamond">diamond</a> <a href="Old">sibling</a>', ['Items']),
    'Diamond Pickaxe/Old': (0, '', ['Items']),
    'Tutorial:Mining': (10010, '<a href="Diamond">diamond</a> <a href="Creeper">creeper</a>', []),
    # One page in each Content family, and a page only in the broad Education category, which stays in the pool.
    'Rose': (0, '', ['Items', 'Removed features']),
    'Frostgate': (0, '', ['Items', 'Fictional mods']),
    'Balloon': (0, '', ['Items', 'Minecraft Education', 'Minecraft Education items']),
    'Charcoal': (0, family('Charcoal'), ['Items', 'Minecraft Education']),
    'Oak Slab': (0, '', ['Items', 'Slabs']),
    'Breeding': (0, '', ['Gameplay']),
    'Dirt (Minecraft 4k)': (0, '', ['Items', 'Minecraft 4k']),
    # Version pages, left out: one by a category ending in " versions", one by a version category. A page in a family
    # stays, though it is in a version category too.
    'Java Edition 1.0': (0, '<a href="Diamond">diamond</a> <a href="Creeper">creeper</a>', ['Java Edition versions']),
    'Bedrock Edition exclusive features': (0, '<a href="Diamond">diamond</a>', ['Versions']),
    'Java Edition removed features': (0, '', ['Removed features', 'Versions']),
    # A spin-off: its pages link to articles (which don't count) and to each other (which do), and a version page.
    'Dungeons:Creeper': (10000, '<a href="Diamond">diamond</a> <a href="Dungeons%3AArch_Illager">arch illager</a>', ['Minecraft Dungeons entities']),
    'Dungeons:Arch Illager': (10000, '', ['Minecraft Dungeons entities']),
    'Dungeons:1.0.5.0': (10000, '<a href="Dungeons%3ACreeper">creeper</a>', ['Minecraft Dungeons versions']),
    'Category:Items': (14, '<a href="Diamond">diamond</a>', []),
}
# A redirect to a version page that a page links to, and one nothing links to.
REDIRECTS = {'Blocks': 'Block', 'Iron ingot': 'Iron Ingot', '1.0': 'Java Edition 1.0', 'JE 1.0': 'Java Edition 1.0'}
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


# Every Deep cuts share of the one item linked well enough to be a target (Diamond), as a third would round to nothing.
CONFIG = {**load_config(), 'topics': {'items': ['Items', 'Tools'], 'mobs': ['Hostile mobs']}, 'hubs': ['Block', 'Breaking'],
          'core_namespaces': ['Special', 'File', 'Category'], 'spinoffs': ['Dungeons'], 'deep_cuts_share': 1,
          # The config's categories and titles cut down to the fixture's, since the build stops on one it doesn't have.
          'families': {'joke': ['Joke features'], 'removed': ['Removed features'], 'education': ['Minecraft Education items'],
                       'fiction': ['Fictional mods'], 'variants': ['Slabs'], 'mechanics': ['Gameplay']},
          'not_content_categories': ['Minecraft 4k'], 'not_content_titles': ['Village & Pillage'], 'disambiguation_categories': ['Disambiguation pages'],
          'version_categories': ['Versions'],
          'kinds': {'Items': {'label': 'an item', 'exclude': ['Iron Ingot']}}}
build_module.MIN_KIND = 1   # the fixture's only item linked well enough to be a target is Diamond

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
    check('namespaces from body classes, not from colons in titles', snap.namespaces == {14: 'Category', 10000: 'Dungeons', 10010: 'Tutorial'},
          snap.namespaces)
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
    versions = ['Java Edition 1.0', 'Bedrock Edition exclusive features', 'Dungeons:1.0.5.0']
    check('every article and spin-off page is listed but the version pages, and nothing else',
          sorted(rows) == sorted(t for t, (ns, *_) in PAGES.items() if ns in (0, 10000) and t not in versions), sorted(rows))
    check('version pages and the redirects to them that pages link to', data['versions'] == sorted([*versions, '1.0']), data['versions'])
    # Minecraft Dungeons versions holds only a left-out page, which the config's check has to find all the same.
    dungeons_versions = {**CONFIG, 'version_categories': ['Versions', 'Minecraft Dungeons versions']}
    check('building again from the same snapshot gives the same', build(snap, CONFIG)[0] == data
          and build(snap, dungeons_versions)[0] == build(Snapshot(again), dungeons_versions)[0])
    check('the pool leaves out subpages, disambiguation pages, non-content pages and Content families',
          all(rows[t][3] == '' for t in ('Diamond Pickaxe/Render', 'Diamond (disambiguation)', 'Dirt (Minecraft 4k)', 'Ankle Monitor', 'Rose',
                                         'Frostgate', 'Balloon', 'Oak Slab', 'Breeding')), sorted(rows))
    check('Content families by category, Education by its exact categories only',
          [rows[t][4] for t in ('Ankle Monitor', 'Rose', 'Java Edition removed features', 'Balloon', 'Frostgate', 'Oak Slab', 'Breeding',
                                'Dirt (Minecraft 4k)', 'Diamond Pickaxe/Render')]
          == [['joke'], ['removed'], ['removed'], ['education'], ['fiction'], ['variants'], ['mechanics'], [], []] and rows['Charcoal'][3:5] == ['items', []],
          [rows[t][3:] for t in ('Ankle Monitor', 'Rose', 'Balloon', 'Frostgate', 'Oak Slab', 'Breeding', 'Charcoal')])
    check('spin-off pages are content of their spin-off',
          [rows[t][4] for t in ('Dungeons:Creeper', 'Dungeons:Arch Illager')] == [['Dungeons'], ['Dungeons']]
          and data['spinoffs'] == {'Dungeons': 10000} and data['families'] == list(CONFIG['families']))
    # Dungeons:Creeper: from Creeper; not from Dungeons:1.0.5.0, a version page.
    check('a spin-off page counts links from articles and its own namespace',
          rows['Dungeons:Creeper'][1:3] == [1, 1] and rows['Dungeons:Arch Illager'][1:3] == [1, 1], (rows['Dungeons:Creeper'], rows['Dungeons:Arch Illager']))
    check('an article with a colon in its title is still an article', 'Minecraft: Story Mode' in rows)
    # Diamond: linked from Diamond Pickaxe, Creeper, Iron Ingot, Block and Minecraft: Story Mode, plus the subpage,
    # disambiguation page and joke article, which are articles even if rolls skip them. Not from Tutorial:Mining or
    # Dungeons:Creeper, which are in other namespaces, nor from the version pages.
    check('links counted per article, through redirects', rows['Diamond'][1:3] == [8, 8], rows['Diamond'])
    check('navbox-only links counted apart', rows['Creeper'][1:3] == [1, 0] and rows['Diamond Pickaxe'][1:3] == [1, 1],
          (rows['Creeper'], rows['Diamond Pickaxe']))
    # Iron Ingot: from Diamond through a redirect, and from Charcoal's navbox.
    check('a link through a redirect counts', rows['Iron Ingot'][1:3] == [2, 1], rows['Iron Ingot'])
    check('a topic per pool article, the first in config order', [rows[t][3] for t in ('Diamond Pickaxe', 'Creeper', 'Block')] == ['items', 'mobs', ''])
    # Popular is the best-linked 30% of the five in the pool (rounded to 2: Diamond, then Iron Ingot before Diamond Pickaxe
    # on a tie, by title); Deep cuts, at a share of 1 here, every item linked well enough to be a target.
    check('tiers: Popular and Deep cuts', {t: r[5] for t, r in rows.items() if r[5]} == {'Diamond': ['popular', 'deep'], 'Iron Ingot': ['popular']},
          {t: r[5] for t, r in rows.items() if r[5]})
    check('sizes', sizes == {'items': 4, 'mobs': 1, 'popular': 2, 'deep': 1, 'joke': 1, 'removed': 2, 'education': 1, 'fiction': 1,
                             'variants': 1, 'mechanics': 1, 'Dungeons': 2}, sizes)
    check('namespaces: core, then the ZIM\'s with their talk namespaces',
          data['namespaces'] == ['Special', 'File', 'Category', 'Category talk', 'Dungeons', 'Dungeons talk', 'Tutorial', 'Tutorial talk'],
          data['namespaces'])
    check('hubs and redirects to them, sections included',
          data['hubs'] == {'Block': 'Block', 'Blocks': 'Block', 'Breaking': 'Breaking', 'Breaking/Mining': 'Breaking', 'Mining': 'Breaking'},
          data['hubs'])

    # Items: Diamond is in it and linked well enough; Iron Ingot is excluded; Charcoal isn't linked well enough.
    check('Scavenger kinds: pool members linked well enough, less the exclusions',
          data['kinds'] == {'Items': {'label': 'an item', 'topic': 'items', 'members': ['Diamond'], 'exclude': ['Iron Ingot']}}, data['kinds'])
    stops = lambda kinds: build(snap, {**CONFIG, 'kinds': kinds})
    try:
        stops({'Items': {'label': 'an item', 'exclude': ['Creeper']}})
        check('a kind whose excluded title left its category stops the build', False)
    except SystemExit as e:
        check('a kind whose excluded title left its category stops the build', 'Creeper' in str(e), e)
    try:
        stops({'Hostile mobs': {'label': 'a hostile mob', 'exclude': []}})
        check('a kind with too few members stops the build', False)
    except SystemExit as e:
        check('a kind with too few members stops the build', 'Hostile mobs: 0 members' in str(e), e)
    try:
        build(snap, {**CONFIG, 'families': {**CONFIG['families'], 'fiction': ['Fictional mods', 'Book objects']},
                     'not_content_titles': ['Village & Pillage', 'Iron ingot', 'Drinks']})
        check('a category no page is in and a not-content title that is gone or now redirects stop the build', False)
    except SystemExit as e:
        check('a category no page is in and a not-content title that is gone or now redirects stop the build',
              str(e).split('\n  ')[1:] == ['category no page is in: Book objects',
                                           'not-content title that is no longer an article: Iron ingot (now a redirect to Iron Ingot)',
                                           'not-content title that is no longer an article: Drinks'], e)

    text = report(snap, CONFIG, 20)
    check('the report runs, with its topics, kinds, pool definitions and designs',
          all(h in text for h in ('## Topics', '## Scavenger kinds', '- **Items:** Diamond', '## Pool definitions', '## Pool designs',
                                  '| Everyday, any pair |', 'Dead ends')), text[:400])

    out = os.path.join(tmp, 'wiki-data.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(render(data))
    check('rendering is stable and reads back', render(build(Snapshot(again), CONFIG)[0]) == render(data) and read_data(out) == data)

    links, boxes, carries = graph(snap, data)
    number = {r[0]: n for n, r in enumerate(data['articles'])}
    names = lambda ids: [data['articles'][n][0] for n in ids]
    check('the graph: links outside navboxes by page number, through redirects, other namespaces left out',
          names(links[number['Diamond']]) == ['Breaking', 'Diamond Pickaxe', 'Iron Ingot', 'Village & Pillage'], names(links[number['Diamond']]))
    check('the graph: a navbox two pages carry is stored once, with both',
          carries[number['Charcoal']] == carries[number['Iron Ingot']] and [names(boxes[b]) for b in carries[number['Charcoal']]] == [['Charcoal', 'Iron Ingot']]
          and [names(boxes[b]) for b in carries[number['Diamond']]] == [['Block', 'Creeper', 'Diamond', 'Diamond Pickaxe']], [names(b) for b in boxes])
    graph_files = render_graph(data, links, boxes, carries)
    check('the graph files are stable and carry the snapshot\'s sha256', render_graph(data, *graph(Snapshot(again), data)) == graph_files
          and all(f'"sha256": "{data["sha256"]}"' in text for text in graph_files) and 'const WIKI_LINKS = {' in graph_files[0]
          and 'const WIKI_NAVBOXES = {' in graph_files[1])

    newer = copy.deepcopy(data)
    newer['snapshot'] = '2026-11-21'
    newer['articles'] = [r for r in newer['articles'] if r[0] != 'Creeper'] + [['Copper Golem', 40, 30, 'mobs', [], []]]
    newer['articles'][[r[0] for r in newer['articles']].index('Diamond')][2] = 30
    newer['hubs'].pop('Mining')
    newer['versions'].remove('1.0')
    newer['kinds']['Items']['members'] = ['Charcoal']
    report = diff(data, newer, min_links=5)
    check('diff lists added and removed articles, category and kind moves, link changes, hubs and version pages',
          all(s in report for s in ('2026-08-21', '2026-11-21', 'added (1): Copper Golem', 'removed (1): Creeper',
                                    'mobs: 1 → 1', 'Kind Items: 1 → 1\n  joined: Charcoal\n  left: Diamond', 'Diamond: 8 → 30', 'Hubs: +none; −Mining', 'Versions: +none; −1.0')), report)

# The game labels every topic and family the data names; a key without a label stops the page from loading.
game = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html'), encoding='utf-8').read()
labels = lambda name: set(re.findall(r'^  (\w+): \{ label:', game[game.index(f'const {name} = {{'):].split('\n};')[0], re.M))
real = load_config()
check('index.html labels every topic and family in config.json',
      set(real['topics']) <= labels('TOPICS') and set(real['families']) <= labels('FAMILIES'), (labels('TOPICS'), labels('FAMILIES')))

print('all passed' if not failures else f'{failures} failed')
sys.exit(1 if failures else 0)
