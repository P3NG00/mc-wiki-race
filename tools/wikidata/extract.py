"""Reads a minecraft.wiki ZIM (from Kiwix, made by mwoffliner) into a snapshot: one gzipped JSON line per page or redirect.

    .venv/bin/python -I tools/wikidata/extract.py minecraft.wiki_en_all_2026-08.zim [-o snapshot.jsonl.gz]

The first line is {"meta": …} (the ZIM's file name, sha256, date and scraper) with "namespaces" (number to name, from
the pages' body classes). Then {"page": title, "ns", "cats", "body", "lead", "boxes"} for every page, where body is the
titles it links to outside navbox tables, lead those of them above its first heading (the intro, its infobox and
hatnotes: the whole page if it has no heading), for Top links only, and boxes its navboxes, each the titles it links to. A
navbox shows the page it is on as plain text, so that title is added back: every copy of a navbox then has the same
titles, and build.py stores each once. An advancement's or achievement's list of what it asks for (div.hlist.searchaux:
"Kill one of these 41 monsters", "Eat each of these foods", folded behind [show] on most pages) counts as a navbox too:
the same list on every page it concerns, it would otherwise put every mob one click from every other. Links in what the
page hides (style="display:none") count nowhere, since nobody can click them, but for what the wiki's calculator gadget
shows, which the game's frame runs.
Then {"redirect": title, "to": title} for every redirect. Titles are in display form (spaces, no fragment). build.py and
report.py read this file, so the ZIM is only scanned once, which takes about a minute.
"""
import argparse, gzip, hashlib, html, json, os, posixpath, re, sys
from urllib.parse import unquote
from libzim.reader import Archive

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')

NS = re.compile(r'<body[^>]*\bclass="[^"]*\bns-(-?\d+)\b')
REFRESH = re.compile(r'<meta http-equiv="refresh" content="0;URL=\'([^\']*)\'')
# Table and div starts and ends, and links (image maps have <area> links), in document order.
TOKEN = re.compile(r'<(/?)(table|a|area|div)\b([^>]*)>')
CLASS = re.compile(r'\bclass="([^"]*)"')
HREF = re.compile(r'\bhref="([^"]*)"')
CATEGORY = re.compile(r'\btitle="Category:([^"]+)"')
# A section heading: MediaWiki wraps each in div.mw-heading; a bare h2 to h6 counts too. The game's frame finds the same.
HEADING = re.compile(r'<div class="mw-heading\b|<h[2-6]\b')
# An element the page hides, or what stands in for the calculator gadget without JavaScript, and the elements with
# nothing inside them.
HIDDEN = re.compile(r'<([a-z][a-z0-9]*)\b(?=[^>]*(?:\sstyle="[^"]*\bdisplay:\s*none|\sclass="[^"]*\bcalculatorgadget-fallback\b))[^>]*>')
OWN_CLASS = re.compile(r'\sclass="([^"]*)"')
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


def link_title(href, page):
    """The title a link on the page at path page leads to, or None for external, same-page and query links. Links are
    relative to the page's path, as on a web server: a subpage such as Advancement/Conditions/block links to ../../Block."""
    href = html.unescape(href)
    if not href or href.startswith(('#', '/', 'http:', 'https:', 'mailto:')) or '?' in href or re.match(r'[a-z][a-z0-9+.-]*:', href):
        return None
    path = posixpath.normpath(posixpath.join(posixpath.dirname(page), unquote(href.split('#')[0])))
    return None if path == '.' or path.startswith('..') else path.replace('_', ' ')


def drop_hidden(region):
    """The region without what nobody sees in the game's frame, so can't click: the elements it hides
    (style="display:none"), such as blocks editors hid, but not those the wiki's calculator gadget shows
    (.calculatorgadget-enabled: the options under a breaking-time table, the calculators' own fields), since the frame
    runs it, and what the gadget hides (.calculatorgadget-fallback)."""
    kept, at = [], 0
    while m := HIDDEN.search(region, at):
        cls = OWN_CLASS.search(m.group(0))
        if cls and 'calculatorgadget-enabled' in cls.group(1).split():
            kept.append(region[at:m.end()])
            at = m.end()
            continue
        kept.append(region[at:m.start()])
        tag, at = m.group(1), m.end()
        if tag in VOID or m.group(0).endswith('/>'):
            continue
        depth = 1
        for t in re.compile(rf'<(/?){tag}\b[^>]*>').finditer(region, at):
            depth += -1 if t.group(1) else 1
            if not depth:
                at = t.end()
                break
        else:
            at = len(region)
    return ''.join(kept) + region[at:]


def page_links(doc, page):
    """Titles linked outside navbox tables, those of them above the first heading, and each navbox (an outermost .navbox
    table, nested tables included, or a requirement list, div.hlist.searchaux, outside one) as the titles it links to
    plus the page's own. From the parser output only, not the page's header or footer, and not what it hides."""
    start = doc.find('mw-parser-output')
    end = doc.find('id="catlinks"')
    region = drop_hidden(doc[max(start, 0):end if end >= 0 else len(doc)])
    heading = HEADING.search(region)
    lead_end = heading.start() if heading else len(region)
    body, lead, boxes, tables = set(), set(), [], []   # tables: for each open table, whether it or one around it is a navbox
    listed = 0   # how many divs deep inside a requirement list, 0 outside one
    for m in TOKEN.finditer(region):
        close, tag, attrs = m.groups()
        if tag == 'div':
            if listed:
                listed += -1 if close else 1
            elif not close and not (tables and tables[-1]):
                cls = CLASS.search(attrs)
                if cls and {'hlist', 'searchaux'} <= set(cls.group(1).split()):
                    listed = 1
                    boxes.append({page.replace('_', ' ')})
            continue
        if tag == 'table':
            if close:
                if tables:
                    tables.pop()
            else:
                cls = CLASS.search(attrs)
                inside, navbox = bool(tables and tables[-1]), bool(cls and 'navbox' in cls.group(1).split())
                if navbox and not inside:
                    boxes.append({page.replace('_', ' ')})
                tables.append(inside or navbox)
            continue
        if close:
            continue
        cls = CLASS.search(attrs)
        href = HREF.search(attrs)
        if not href or (cls and 'new' in cls.group(1).split()):
            continue
        title = link_title(href.group(1), page)
        if title:
            if listed or (tables and tables[-1]):
                boxes[-1].add(title)
            else:
                body.add(title)
                if m.start() < lead_end:
                    lead.add(title)
    return body, lead, boxes


def page_categories(doc):
    """Visible categories (the hidden ones aren't links in mwoffliner's output, and nothing here needs them)."""
    start = doc.find('id="catlinks"')
    if start < 0:
        return []
    hidden = doc.find('mw-hidden-catlinks', start)
    return sorted(set(CATEGORY.findall(doc[start:hidden if hidden >= 0 else len(doc)])))


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(1 << 22):
            h.update(chunk)
    return h.hexdigest()


def extract(zim_path, out_path):
    zim = Archive(zim_path)
    info = lambda k: bytes(zim.get_metadata(k)).decode() if k in zim.metadata_keys else None
    meta = {'file': os.path.basename(zim_path), 'sha256': sha256(zim_path), 'date': info('Date'), 'scraper': info('Scraper')}
    pages, redirects, namespaces = [], [], {}
    for i in range(zim.entry_count):
        entry = zim._get_entry_by_id(i)
        title = entry.path.replace('_', ' ')
        if entry.is_redirect:
            to = entry.get_redirect_entry().path
            redirects.append({'redirect': title, 'to': to.split('#')[0].replace('_', ' ')})
            continue
        item = entry.get_item()
        if item.mimetype != 'text/html':
            continue
        doc = bytes(item.content).decode('utf-8', 'replace')
        # A redirect to a section is a page that forwards to it.
        refresh = REFRESH.search(doc[:1000])
        if refresh:
            to = link_title(refresh.group(1), entry.path)
            if to:
                redirects.append({'redirect': title, 'to': to})
            continue
        ns = NS.search(doc)
        if not ns:
            continue   # mwoffliner's own pages, such as the partial lists of big categories
        ns = int(ns.group(1))
        if ns:
            namespaces.setdefault(ns, title.split(':')[0])
        body, lead, boxes = page_links(doc, entry.path)
        pages.append({'page': title, 'ns': ns, 'cats': page_categories(doc), 'body': sorted(body), 'lead': sorted(lead),
                      'boxes': sorted(sorted(b) for b in boxes)})
    pages.sort(key=lambda p: p['page'])
    redirects.sort(key=lambda r: r['redirect'])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    # No name or time in the gzip header, so the same ZIM always gives the same bytes.
    with open(out_path, 'wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as gz:
        line = lambda o: gz.write((json.dumps(o, ensure_ascii=False, sort_keys=True) + '\n').encode())
        line({'meta': meta, 'namespaces': {str(k): v for k, v in sorted(namespaces.items())}})
        for o in pages + redirects:
            line(o)
    return meta, len(pages), len(redirects)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('zim')
    ap.add_argument('-o', '--out', help='default: tools/wikidata/cache/<zim name>.jsonl.gz')
    args = ap.parse_args()
    out = args.out or os.path.join(DEFAULT_OUT, os.path.basename(args.zim).removesuffix('.zim') + '.jsonl.gz')
    meta, pages, redirects = extract(args.zim, out)
    print(f'{out}: {pages} pages, {redirects} redirects, snapshot {meta["date"]}', file=sys.stderr)


if __name__ == '__main__':
    main()
