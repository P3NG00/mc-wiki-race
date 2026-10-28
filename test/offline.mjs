// Offline test: drives headless Firefox over WebDriver BiDi against index.html opened from file://, with every request to
// minecraft.wiki answered here (made-up page info and one made-up article), so it runs without the wiki. It checks the
// game's own logic: what rolls pick, the daily, Content and Spin-offs, difficulty, and which links are live. Rendering
// real articles is left to e2e.mjs. Usage: test/run-e2e.sh --offline (starts Firefox), or
//   node test/offline.mjs <bidi-port> <file-url>
import fs from 'node:fs';

const [port, fileUrl] = process.argv.slice(2);
// Spin-off namespace numbers, from wiki-data.js, so a page in one gets the ns the live API would give it, and the hubs.
const dataText = fs.readFileSync(new URL('../wiki-data.js', import.meta.url), 'utf8'), marker = 'const WIKI_DATA = ';
const { spinoffs: SPINOFFS, hubs } = JSON.parse(dataText.slice(dataText.indexOf(marker) + marker.length, dataText.lastIndexOf(';')));
const HUBS = [...new Set(Object.values(hubs))];
const nsOf = title => title.startsWith('Category:') ? 14 : SPINOFFS[Object.keys(SPINOFFS).find(n => title.startsWith(n + ':'))] ?? 0;

const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
let id = 0;
const pending = new Map();
const jsErrors = [], requests = new Map();   // requests: API request kinds ("action prop=…") and how many of each
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

// The wiki escapes a title in its HTML, so the made-up replies do too: the injection check below needs a page to be
// what the wiki would send.
const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Every article is this one: a link in the text, links to a hub, to a redirect to a hub, to the target hub Crafting, to a
// Tutorial and to a Dungeons page, to a version page, to a redirect to one and to a list page, to a page that doesn't exist
// written as a template can, without the red link's class (the reply's links say it doesn't), a table of contents as the
// live wiki has (with a heading of its own) and a link after it, then a section heading with a link under it, and one link
// in a navbox.
// Hubs Only, which isn't in the snapshot, links only two hubs (as Bee Our Guest does on the wiki), so on Hard nothing on
// it works.
const HUBS_ONLY = 'Hubs Only';
const ARTICLE = title => title === HUBS_ONLY
  ? `<div class="mw-parser-output"><p>${HUBS.slice(0, 2).map(h => `<a href="/w/${encodeURIComponent(h.replace(/ /g, '_'))}">${escHtml(h)}</a>`).join(' and ')}.</p></div>` : `<div class="mw-parser-output"><p>${escHtml(title)}: <a href="/w/Diamond_Pickaxe">pickaxe</a> <a href="/w/Block">Block</a>
  <a href="/w/Blocks">Blocks</a> <a href="/w/Crafting">Crafting</a> <a href="/w/Tutorial:Mining">tutorial</a> <a href="/w/Dungeons:Creeper">dungeons</a>
  <a href="/w/Java_Edition_version_history">versions</a> <a href="/w/Pocket_Edition_version_history">old versions</a>
  <a href="/w/Closed_captions">captions</a> <a href="/w/No_such_page">gone</a></p>
  <div id="toc" class="toc"><div class="toctitle"><h2 id="mw-toc-heading">Contents</h2></div><ul><li><a href="#Uses">Uses</a></li></ul></div>
  <p><a href="/w/Gold_Ingot">gold</a></p>
  <div class="mw-heading mw-heading2"><h2 id="Uses">Uses</h2></div><p><a href="/w/Iron_Ingot">iron</a></p>
  <table class="navbox"><tr><td><a href="/w/Creeper">Creeper</a></td></tr></table></div>`;
// The live categories a parse reply gives, as the API writes them: Brand New Mob is only in the live wiki's Nether mobs,
// and Chicken is in it too but excluded from the kind.
const REACH_LABEL = { p1: 'Par 1', p2: 'Par 2', p3: 'Par 3', p4: 'Par 4', p5: 'Par 5+' };
const failParse = new Set();   // articles whose requests fail, as with no connection
const REDIRECTS = { 'Crafting recipe': 'Crafting' };   // titles a parse follows to another article, as the wiki's redirects do
const LIVE_CATEGORIES = { 'Brand New Mob': ['Nether_mobs', 'Verify'], Chicken: ['Nether_mobs', 'Passive_mobs'] };
const reply = (request, body, type = 'application/json') => send('network.provideResponse', { request, statusCode: 200, body: { type: 'string', value: body },
  headers: [['Access-Control-Allow-Origin', '*'], ['Content-Type', type]].map(([name, value]) => ({ name, value: { type: 'string', value } })) });
function answer(request, url) {
  const u = new URL(url), p = u.searchParams;
  if (u.pathname === '/load.php') return reply(request, '', 'text/css');
  if (u.pathname !== '/api.php') return send('network.failRequest', { request });   // images
  const kind = [p.get('action'), ...['list', 'generator', 'prop'].filter(k => p.has(k)).map(k => `${k}=${p.get(k)}`)].join(' ');
  requests.set(kind, (requests.get(kind) || 0) + 1);
  if (p.get('action') === 'parse') {
    const t = REDIRECTS[p.get('page')] ?? p.get('page');
    if (failParse.has(t)) return send('network.failRequest', { request });
    return reply(request, JSON.stringify({ parse: { title: t, displaytitle: escHtml(t), text: ARTICLE(t),
      categories: (LIVE_CATEGORIES[t] ?? []).map(category => ({ sortkey: '', category })), links: [{ ns: 0, title: 'No such page', exists: false }, { ns: 0, title: 'Diamond Pickaxe', exists: true }] } }));
  }
  if (p.get('action') === 'query' && p.has('titles')) {
    return reply(request, JSON.stringify({ query: { pages: p.get('titles').split('|').map(t => t.startsWith('No such ') ? { title: t, missing: true } : { title: t, ns: nsOf(t), pageprops: {}, extract: `About ${t}.` }) } }));
  }
  return reply(request, JSON.stringify({ error: { code: 'offline', info: 'Not answered offline: ' + kind } }));
}

ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === 'script.message') jsErrors.push(d.params.data.value);
  else if (d.method === 'network.beforeRequestSent' && d.params.isBlocked) answer(d.params.request.request, d.params.request.url);
};
await new Promise(r => ws.onopen = r);
await send('session.new', { capabilities: {} });
await send('session.subscribe', { events: ['script.message', 'network.beforeRequestSent'] });
await send('script.addPreloadScript', { functionDeclaration: `report => {
  addEventListener('error', e => report(String(e.message)));
  addEventListener('unhandledrejection', e => report('Unhandled rejection: ' + (e.reason?.message ?? e.reason)));
}`, arguments: [{ type: 'channel', value: { channel: 'mwr-errors' } }] });
await send('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', hostname: 'minecraft.wiki' }] });
const ctx = (await send('browsingContext.getTree', {})).result.contexts[0].context;
const ev = async (expr, c = ctx) => {
  const r = await send('script.evaluate', { target: { context: c }, expression: expr, awaitPromise: true });
  return r.result?.result?.value ?? JSON.stringify(r.error || r.result?.exceptionDetails?.text);
};
const until = async (expr, ms = 15000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await ev(expr) === true) return true; await sleep(200); }
  return false;
};
const frameCtx = async () => (await send('browsingContext.getTree', {})).result.contexts[0].children[0]?.context;
const ready = "!document.querySelector('#btnPlay').disabled && setup.busy === 0";   // a pair on the cards, nothing rolling
// A hash change alone wouldn't reload the page, so go through about:blank.
const open = async hash => {
  await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
  await send('browsingContext.navigate', { context: ctx, url: fileUrl + hash, wait: 'complete' });
  return until(ready);
};
// How each link in the article is classified: live, or dead.
const linkStates = async () => JSON.parse(await ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('a')].map(a =>
  [a.getAttribute('href').slice(3), a.classList.contains('mwr-live') ? 'live' : 'dead'])))`, await frameCtx()));
const play = async () => {
  await ev("document.querySelector('#btnPlay').click()");
  return until('game.active && game.path.length === 1 && !game.loading');
};
// Opens a link and plays its route, each title after the start by a click, to the last arrival.
const playRoute = async (hash, route) => {
  await open(hash);
  await play();
  for (const t of route.slice(1)) {
    await ev(`navigate(${JSON.stringify(t)}, null)`);
    await until(`game.path.at(-1).title === ${JSON.stringify(t)} && !game.loading`);
  }
};

// Links by difficulty. A challenge link without rules is Relaxed: everything but other namespaces and the left-out pages
// is live. No hubs alone (from an older link) is Hard: hubs and redirects to them are dead, the target hub stays live,
// and so are navboxes' links.
check('the data loads', await open('#start=Diamond&target=Crafting') && await ev("WIKI_DATA.snapshot.length === 10 && POOL.size === 5"));
check('the footer names the offline copy\'s date as the page\'s other dates, with its year, and links where it comes from', await ev(`$('#wikiCopyDate').textContent === shortDate(localDay(WIKI_DATA.snapshot), true)
  && $('#wikiCopyDate').textContent.includes(WIKI_DATA.snapshot.slice(0, 4)) && $('#wikiCopy a').href === 'https://minecraft.wiki/w/Minecraft_Wiki:Offline_use'`), await ev("$('#wikiCopy').textContent"));
// The report link fills the mail in when clicked (the navigation is stopped, so no mail app opens).
check('the footer\'s report link fills a mail in with the game on the cards and the offline copy\'s date', await ev(`(() => {
  const a = $('#feedbackMail');
  a.addEventListener('click', e => e.preventDefault(), { once: true });
  a.click();
  const body = decodeURIComponent(a.href.split('&body=')[1] ?? '');
  return a.href.startsWith('mailto:BryantF.xyz+mcwikirace@gmail.com?subject=MC%20Wiki%20Race%20feedback&body=') &&
    body.includes('Game on the cards: ' + location.href.split('#')[0] + '#g=') && body.includes('Wiki copy: ' + WIKI_DATA.snapshot);
})()`));
// What the checks below take from the snapshot by name. A new one that changes any of these fails here, by name, rather
// than leaving a check further down passing without testing anything (Crafting no longer a hub would leave "the target hub
// stays live" true of any link, and Blaze in no kind would leave "a start in a kind rolls them again" nothing to roll).
const SNAPSHOT_FACTS = {
  'Block and Crafting are hubs, Blocks a redirect to Block': "HUB_TITLES.get('Block') === 'Block' && HUB_TITLES.get('Crafting') === 'Crafting' && HUB_TITLES.get('Blocks') === 'Block'",
  'the pages used are articles in it, not hubs': "['Diamond', 'Diamond Pickaxe', 'Zombie', 'Creeper', 'Bamboo', 'Ghast', 'Sharpness'].every(t => ARTICLES.has(t) && !spinoffOf(t) && !HUB_TITLES.has(t))",
  'Minecraft Dungeons is an article, Dungeons:Creeper a Dungeons page': "ARTICLES.has('Minecraft Dungeons') && !spinoffOf('Minecraft Dungeons') && spinoffOf('Dungeons:Creeper') === 'Dungeons' && ARTICLES.has('Dungeons:Creeper')",
  'Blaze is a hostile and a flying mob, Sharpness an enchantment, Potion of Swiftness a potion': "KIND_MEMBERS.get('Hostile mobs')?.has('Blaze') && KIND_MEMBERS.get('Flying mobs')?.has('Blaze') && KIND_MEMBERS.get('Enchantments')?.has('Sharpness') && KIND_MEMBERS.get('Potions')?.has('Potion of Swiftness')",
  'Chicken is left out of Nether mobs': "KINDS['Nether mobs']?.exclude.includes('Chicken')",
  'Java Edition version history, Pocket Edition version history (a redirect to one) and Closed captions are left out': "['Java Edition version history', 'Pocket Edition version history', 'Closed captions'].every(t => LEFT_OUT.has(t) && !ARTICLES.has(t))",
  'the made-up pages aren’t in it': `![${JSON.stringify(HUBS_ONLY)}, 'Brand New Mob'].some(t => ARTICLES.has(t))`,
};
const factsOff = [];
for (const [fact, expr] of Object.entries(SNAPSHOT_FACTS)) if (await ev(expr) !== true) factsOff.push(fact);
check('the snapshot still has what the checks lean on', !factsOff.length, factsOff.length ? 'changed: ' + factsOff.join('; ') : '');
check('a challenge link without rules is Relaxed', await ev("level() === 'relaxed' && rules().length === 0"));
check('the data has no left-out page', await ev("WIKI_DATA.articles.every(([t]) => !LEFT_OUT.has(t))"));
await ev("setCustom('start', 'Java Edition version history')");
check('a left-out page typed in isn’t taken, saying the game leaves it out', await until("setup.busy === 0 && document.querySelector('#setupStatus').textContent === '“Java Edition version history” is on minecraft.wiki, but the game leaves it out (a version, list or non-article page).'")
  && await ev("setup.start.title === 'Diamond'"), await ev("document.querySelector('#setupStatus').textContent"));
await ev("setCustom('start', 'Category:Blocks')");
check('so is a page that isn’t an article', await until("setup.busy === 0 && document.querySelector('#setupStatus').textContent === '“Category:Blocks” is on minecraft.wiki, but the game leaves it out (a version, list or non-article page).'")
  && await ev("setup.start.title === 'Diamond'"), await ev("document.querySelector('#setupStatus').textContent"));
await ev("setCustom('start', 'No such page')");
check('and one that doesn’t exist says there’s no article by that name', await until("setup.busy === 0 && document.querySelector('#setupStatus').textContent === 'No article named “No such page” on minecraft.wiki.'")
  && await ev("setup.start.title === 'Diamond'"), await ev("document.querySelector('#setupStatus').textContent"));
// What comes last wins: a card rerolled, or the daily loaded, while a title typed in is being looked up.
await ev("setCustom('start', 'Creeper'); reroll('start')");
check('a reroll while a typed-in title is looked up wins', await until(ready, 30000) && await ev("!setup.start.typed"), await ev('JSON.stringify(setup.start)'));
await ev("setCustom('start', 'Creeper'); loadDaily()");
check('and so does the daily', await until(ready, 30000) && await ev("setup.daily === today() && !setup.start.typed"), await ev('JSON.stringify([setup.daily, setup.start])'));
await open('#start=Diamond&target=Crafting');   // the Relaxed challenge again, which the checks below play
// A failure says whose it is: the wiki's (here a request the suite doesn't answer), the link data's, or the game's own
// (a card none of whose draws exists).
const failSays = async fn => ev(`withBusy(${fn}).then(() => document.querySelector('#setupStatus').textContent)`);
const failMessages = [await failSays("() => api({ action: 'query', prop: 'pageimages' })"), await failSays("() => loadGraphFile('no-such-file.js', () => null)"),
  await failSays("() => rollOne('goal', null, undefined, ['No such page'])"),
  await failSays("() => (window.realFetch = fetch, fetch = () => Promise.reject(new TypeError('Failed to fetch.')), api({ action: 'query' }).finally(() => fetch = realFetch))")];
check('a failure says whose it is: the wiki’s (an error it sent back, or no answer), the link data’s or the game’s',
  failMessages[0] === 'minecraft.wiki sent back an error (Not answered offline: query prop=pageimages). Try again in a moment.'
  && failMessages[3] === 'Couldn’t reach minecraft.wiki (Failed to fetch). Check your connection and try again.'
  && failMessages[1] === 'The game’s link data didn’t load (no-such-file.js). Reload the page.' && failMessages[2] === 'Couldn’t find an article that fits. Try Reroll again.',
  failMessages.join(' | '));
await ev("setStatus('')");
// An article that fails to load mid-game offers Retry and Cancel: Cancel keeps the page you were on, with the clock
// going again and Give up on; Retry, once the wiki answers, loads it.
await play();
await ev("navigate('Gold Ingot', null)");
await until("game.path.length === 2 && !game.loading");
failParse.add('Iron Ingot');
await ev("navigate('Iron Ingot', null)");
const failedShown = await until("!!document.querySelector('#btnCancelNav') && !game.loading");
await ev("document.querySelector('#btnCancelNav').click()");
const cancelledAt = await ev('now()');
await sleep(600);
check('Cancel on an article that failed mid-game keeps the page you were on, the clock going again', failedShown && await ev(`game.path.length === 2
  && game.path.at(-1).title === 'Gold Ingot' && $('#overlay').classList.contains('hidden') && !$('#btnGiveUp').disabled && now() > ${cancelledAt} + 400`),
  await ev("JSON.stringify([game.path.map(p => p.title), $('#overlay').className, now()])"));
await ev("navigate('Iron Ingot', null)");
await until("!!document.querySelector('#btnRetry') && !game.loading");
failParse.delete('Iron Ingot');
await ev("document.querySelector('#btnRetry').click()");
check('and Retry, once the wiki answers, loads it', await until("game.path.length === 3 && game.path.at(-1).title === 'Iron Ingot' && !game.loading"));
// A link that redirects to the target reaches it and wins, the link's title and the target's both counted as seen.
await ev("navigate('Crafting recipe', null)");
check('a link redirecting to the target wins, its title seen as the target\'s', await until('!game.active') && await ev(`game.path.at(-1).title === 'Crafting'
  && game.seen.get('Crafting recipe') === 'Crafting' && game.seen.get('Crafting') === 'Crafting' && store.get('mwr.history', [])[0].won === true`),
  await ev("JSON.stringify([game.path.map(p => p.title), [...game.seen]])"));
await ev('closeModal(); toSetup()');
await play();
let links = await linkStates();
const leftOut = "['Java_Edition_version_history', 'Pocket_Edition_version_history', 'Closed_captions'].every(t => document.querySelector(`a[href='/w/${t}']`).title === 'Off limits: a version or list page')";
check('Relaxed: hubs and navboxes live, other namespaces, version and list pages and redirects to them dead', links.Block === 'live' && links.Creeper === 'live'
  && links['Tutorial:Mining'] === 'dead' && links['Dungeons:Creeper'] === 'dead' && links.Java_Edition_version_history === 'dead'
  && links.Pocket_Edition_version_history === 'dead' && links.Closed_captions === 'dead' && await ev(leftOut, await frameCtx()), JSON.stringify(links));
check('a link to a page that doesn’t exist, though without the red link’s class, is dead, saying so', links.No_such_page === 'dead' && links.Diamond_Pickaxe === 'live'
  && await ev("document.querySelector('a[href=\"/w/No_such_page\"]').title === 'Off limits: this page doesn’t exist'", await frameCtx()), JSON.stringify(links));
await open('#start=Diamond&target=Crafting&rules=nohubs');
check('No hubs alone is Hard', await ev("level() === 'hard' && rules().join() === 'nohubs,nonav'"));
// Golf: par shows beside Start once the link graph has loaded, and in the header while playing.
check('the setup screen shows par', await until("/^Par \\d+$/.test(document.querySelector('#setupPar').textContent)"),
  await ev("document.querySelector('#setupPar').textContent"));
await ev("document.querySelector('input.rule[value=distance]').click()");   // for Share's labels below
await play();
check('the header shows par', await until("/^\\d+$/.test(document.querySelector('#hudPar').textContent)") && await ev("!document.querySelector('#hudParStat').classList.contains('hidden')"),
  await ev("document.querySelector('#hudPar').textContent"));
links = await linkStates();
check('Hard: hubs, redirects to them, navboxes and left-out pages dead; the target hub and other links live',
  links.Block === 'dead' && links.Blocks === 'dead' && links.Creeper === 'dead' && links.Java_Edition_version_history === 'dead' && links.Closed_captions === 'dead'
  && links.Crafting === 'live' && links.Diamond_Pickaxe === 'live' && await ev("document.querySelector('a[href=\"/w/Block\"]').title === 'Off limits on Hard: a big overview page'", await frameCtx())
  && await ev("HUB_TITLES.get('Crafting') === 'Crafting'"), JSON.stringify(links));   // else Crafting live would test nothing
// A navbox's links, and a requirement list's (div.hlist.searchaux, which stays in sight), say why they are dead.
check('Hard: a navbox\'s and a requirement list\'s links say they count as a navbox', await ev(`(d => (d.className = 'hlist searchaux', d.innerHTML = '<a href="/w/Ghast">Ghast</a>',
  document.body.append(d), (c => (d.remove(), c?.kind === 'blocked' && c.note === 'Off limits on Normal and Hard: this list counts as a navbox'))(classify(d.firstChild))))(document.createElement('div'))
  && document.querySelector('.navbox a[href="/w/Creeper"]').title === 'Off limits on Normal and Hard: this list counts as a navbox'`, await frameCtx()));
await ev('finish(false)');
const shortest = "[...document.querySelectorAll('#mBest li')].map(li => li.textContent).join(' → ')";
check('the result shows par and a shortest route beside your path', await until(`/^Shortest route · par \\d+$/.test(document.querySelector('#mBestTitle').textContent)
  && /^Diamond → .*Crafting$/.test(${shortest}) && document.querySelector('#par').textContent === 'Going by the wiki’s offline copy from ' + shortDate(localDay(WIKI_DATA.snapshot), true) + '.'`),
  await ev(shortest));
// Share copies the game, its result, the path and a link that plays it; Copy challenge link that link alone.
const shared = "shareText(savedGames()[0], game.link)";
check('Share gives the game, the result, the path and the game\'s link', await ev(`(t => document.querySelector('#mShare') && document.querySelector('#mLink')
  && t.startsWith('MC Wiki Race\\nRace · Distance · Hard\\nDiamond → Crafting\\n❌ Gave up after ') && t.includes('\\nMy path: Diamond\\n') && t.endsWith('\\nPlay it: ' + game.link)
  && openLink(new URL(game.link).hash.slice(3)) === 'start=Diamond&target=Crafting&rules=nohubs,nonav,distance')(${shared})`), await ev(shared));
// A copy the browser refuses shows the text under the buttons, selected, to copy by hand.
await ev("navigator.clipboard.writeText = () => Promise.reject(new Error('Refused')); $('#mShare').click()");
const byHand = "(b => [$('#mShare').textContent, !$('#mCopyBox').classList.contains('hidden'), b.value.startsWith('MC Wiki Race\\n') && b.value.endsWith('\\nPlay it: ' + game.link), b.selectionStart === 0 && b.selectionEnd === b.value.length].join())($('#mCopyText'))";
check('a refused Share says Copy failed and shows the text, selected, to copy by hand', await until(`${byHand} === 'Copy failed,true,true,true'`), await ev(byHand));
await ev("$('#mLink').click()");
check('and so does Copy challenge link, with the link alone', await until("$('#mLink').textContent === 'Copy failed' && $('#mCopyText').value === game.link"), await ev("$('#mCopyText').value"));
await ev("navigator.clipboard.writeText = () => Promise.resolve(); $('#mShare').click()");
check('a copy that works then puts the box away', await until("$('#mShare').textContent === 'Copied!' && $('#mCopyBox').classList.contains('hidden')"), await ev("$('#mShare').textContent"));
await ev("delete navigator.clipboard.writeText");
check('the record keeps par, and the history shows it', await ev("Number.isInteger(savedGames()[0].par)") && await until(
  "toSetup(), document.querySelector('#history tbody tr .h-result .note').textContent.endsWith('par ' + savedGames()[0].par)"),
  await ev("document.querySelector('#history tbody tr .h-result')?.textContent"));
check('golf names a win against par, saying what each means', await ev("[[1, 1], [2, 2], [3, 2], [4, 2], [5, 2], [9, 2], [1, 2], [1, 3], [1, 4], [1, 6]].map(([c, p]) => golfText(golfScore(c, p))).join('|')")
  === 'Hole in one! (par 1 in one click)|Par (even with par)|Bogey (1 over par)|Double bogey (2 over par)|Triple bogey (3 over par)|7 over par|Birdie (1 under par)|Eagle (2 under par)|Albatross (3 under par)|5 under par');
await ev('closeModal(); toSetup()');
// The Timer box, on by default: off, the header has no clock, the result and Share say nothing of time, the record has
// none and the history shows a dash. A game without a time beats another only on clicks.
check('the Timer box is on by default', await ev("$('#timerToggle').checked && store.get('mwr.timer', true) === true"));
await ev("$('#timerToggle').click()");
await play();
check('with the Timer off the header has no clock', await ev("!game.timed && store.get('mwr.timer') === false && !$('#hudTimeStat').checkVisibility()"));
await ev('finish(false)');
check('and the result, Share and the record have no time', await ev(`(r => r.ms === undefined && isRecord(r) && $('.tiles.untimed').children.length === 2
  && shareText(r, game.link).includes('\\n❌ Gave up after 0 clicks · par '))(savedGames()[0])`), await ev(shared));
check('the history shows a dash for its time', await ev("closeModal(), toSetup(), $('#history tbody tr .h-time').textContent === '–'"));
check('a game without a time beats another only on clicks', await ev(`(t => beats({ clicks: 2 }, { ...t, clicks: 3 }) && !beats({ clicks: 2 }, t)
  && beats(t, { clicks: 2 }) && !beats({ clicks: 2 }, { clicks: 2 }))({ clicks: 2, ms: 9e9 })`));
await ev("$('#timerToggle').click()");
check('difficulty from a link\'s rules, and its words', await ev(`(() => {
  const got = [[], ['nonav'], ['nonav', 'nohubs'], ['noback', 'nonav']].map(r => (setRules(r), level() + ':' + rulesText(rules()))).join(' ');
  setRules([]);
  return got;
})()`) === 'relaxed:Relaxed normal: hard:Hard normal:No Back');

// Distance: every arrival is measured, the fewest clicks from it to what is next by the link graph, and the result's path
// shows each page's, marking in red a click that got no closer; with the rule on, the header and the path list show them
// during play. A start two or more clicks from Crafting (Relaxed): a step along its shortest route is a click closer.
const far = JSON.parse(await ev(`(async () => {
  for (const start of POOL_TITLES) {
    const route = await parRoute({ start, goal: 'Crafting', rules: [] });
    if (route?.length >= 3) return JSON.stringify(route);
  }
  return 'null';
})()`));
check('the snapshot has a start two or more clicks from Crafting', !!far);
const farPar = far.length - 1, hudHint = "document.querySelector('#hudHint')";
await open(`#start=${encodeURIComponent(far[0])}&target=Crafting&rules=distance`);
await play();
check('Distance: the start is par away, in the header', await until(`game.path[0].togo === ${farPar} && !game.loading`) &&
  await ev(`!${hudHint}.classList.contains('hidden') && ${hudHint}.textContent === '${farPar} clicks to go'`), await ev(`${hudHint}.textContent`));
// A click's sparks fly from where it was into the click count, which bumps as they land.
check('a click sends its sparks to the click count, which takes no clicks', await ev(`(navigate(${JSON.stringify(far[1])}, null, { from: { x: 300, y: 300 } }), fx.parts.length === 7
  && fx.parts.every(p => p.to) && getComputedStyle($('#fx')).pointerEvents === 'none')`));
check('the click count bumps as they land', await until("$('#hudClicks').classList.contains('bump')"));
check('Distance: a step along a shortest route is a click closer, in the header and on the path', await until(`game.path.at(-1).togo === ${farPar - 1} && !game.loading`) &&
  await ev(`${hudHint}.textContent === clicksText(${farPar - 1}) + ' to go' && document.querySelector('#pathList li.cur').textContent.endsWith(' ${farPar - 1} to go')`), far.join(' → '));
check('Distance: a click closer is cheered, its count lit', await until(`${hudHint}.classList.contains('closer')`));
await ev(`navigate(${JSON.stringify(far[0])}, null)`);
check('Distance: going back is a click further', await until(`game.path.at(-1).togo === ${farPar} && !game.loading`), await ev('game.path.at(-1).togo'));
await sleep(300);
check('Distance: a click further gets no cheer', await ev(`!${hudHint}.classList.contains('closer')`));
check('a checkpoint, a find or Exact clicks gets no cheer', await ev(`(p => gotCloser(p, 1, false) && !gotCloser(p, 1, true) && !gotCloser([p[0], { ...p[1], via: 1 }], 1, false)
  && !gotCloser([p[0], { ...p[1], found: ['Ghast'] }], 1, false) && !gotCloser([p[0], { togo: undefined }], 1, false))([{ togo: 3 }, { togo: 2 }])`));
// A dead end, a page with no route anywhere (no links outside navboxes, no navboxes), has no route.
const deadEnd = await ev(`linkGraph([]).then(g => WIKI_DATA.articles.map(([t]) => t).find(t => !spinoffOf(t) && !g.links[PAGE_IDS.get(t)].length && !g.carries[PAGE_IDS.get(t)].length))`);
check('the snapshot has a dead end', typeof deadEnd === 'string' && await ev(`PAGE_IDS.has(${JSON.stringify(deadEnd)})`), String(deadEnd));
await ev(`navigate(${JSON.stringify(deadEnd)}, null)`);
check('Distance: a dead end has no route', await until(`game.path.at(-1).togo === null && !game.loading`) && await ev(`${hudHint}.textContent === 'No route from here'`),
  `${deadEnd}: ${await ev('game.path.at(-1).togo')}`);
await ev("navigate('Brand New Mob', null)");
check('Distance: a page the snapshot lacks is unknown', await until("'togo' in game.path.at(-1) && game.path.at(-1).togo === undefined && !game.loading") &&
  await ev(`${hudHint}.textContent.startsWith('Distance unknown')`));
check('the rule is in the game\'s rules and its challenge link', await ev("game.rules.includes('distance') && openLink(new URL(challengeLink()).hash.slice(3)).includes('distance')"));
await ev('finish(false)');
const counts = "JSON.stringify([...document.querySelectorAll('#mPath li')].map(li => [li.querySelector('.togo')?.textContent, li.querySelector('.togo.worse') ? 'worse' : '']))";
const expected = JSON.stringify([[`${farPar} to go`, ''], [`${farPar - 1} to go`, ''], [`${farPar} to go`, 'worse'], ['no route', 'worse'], ['?', '']]);
check('the result shows each page\'s count, and the clicks that got no closer in red', await until(`${counts} === ${JSON.stringify(expected)}`) &&
  await ev(`${hudHint}.classList.contains('hidden') && !document.querySelector('#mPathNote').classList.contains('hidden')`), await ev(counts));
// The shortcut missed: going back from the second page, a click that never got closer again, folded away until asked for.
const shortcut = "(s => [s.classList.contains('hidden'), s.open, document.querySelector('#mShortcutText').textContent])(document.querySelector('#mShortcut'))";
const shortcutText = await ev(`(p => p.togo > 1 ? \`From ${far[1]}, \${p.next} was \${clicksText(p.togo - 1)} from Crafting.\` : \`${far[1]} linked straight to \${p.next}.\`)(game.path[1])`);
check('the result has the shortcut the costliest detour missed, folded away', await ev(`JSON.stringify(${shortcut})`) === JSON.stringify([false, false, shortcutText]),
  await ev(`JSON.stringify(${shortcut})`));
const sharedPath = "shareText(savedGames()[0], game.link, game.path).split('\\n').find(l => l.startsWith('My path: '))";
check('Share gives each page\'s count on the path', await ev(sharedPath)
  === `My path: ${far[0]} (${farPar} to go) → ${far[1]} (${farPar - 1} to go) → ${far[0]} (${farPar} to go) → ${deadEnd} (no route) → Brand New Mob (?)`, await ev(sharedPath));
await ev('closeModal(); toSetup()');
// With a checkpoint, the target reached before it counts to the checkpoint.
await open('#start=Diamond&via=Creeper&target=Crafting&rules=distance');
await play();
const toCreeper = await ev("parRoute({ start: 'Crafting', goal: 'Creeper', rules: [] }).then(r => r.length - 1)");
await ev("navigate('Crafting', null)");
check('Distance counts to the checkpoint from the target reached before it', await until(`game.active && game.path.at(-1).togo === ${toCreeper} && !game.loading`),
  `${await ev('game.path.at(-1).togo')}, expected ${toCreeper}`);
await ev("finish(false); closeModal(); toSetup()");
await open('#start=Diamond&target=Crafting');
await play();
await ev("navigate('Diamond Pickaxe', null)");
check('without the rule every arrival is still measured, but not shown in play, while par still is', await until("game.path.length === 2 && !game.loading && game.path.every(p => Number.isInteger(p.togo))") &&
  await ev(`${hudHint}.classList.contains('hidden') && !document.querySelector('#pathList .note') && !document.querySelector('#hudParStat').classList.contains('hidden')`));
await ev('finish(false)');
check('and the result shows them', await until("document.querySelectorAll('#mPath .togo').length === 2"));
await ev("closeModal(); toSetup()");
// A game along a shortest route: no shortcut missed.
await open(`#start=${encodeURIComponent(far[0])}&target=Crafting`);
await play();
await ev(`navigate(${JSON.stringify(far[1])}, null)`);
await until('game.path.length === 2 && !game.loading');
await ev('finish(false)');
check('a path where every click got closer has no shortcut', await until("document.querySelectorAll('#mPath .togo').length === 2")
  && await ev("!document.querySelector('#mPath .worse') && document.querySelector('#mShortcut').classList.contains('hidden')"), await ev("document.querySelector('#mPath').textContent"));
await ev("closeModal(); toSetup()");
// A detour that got as close again, there and back and there again, then the shortcut: the result says how often its
// page was visited and how many clicks quicker the shortcut was. On a pair at par 3 or more, so the shortcut is a page on
// the way rather than the target itself.
const deep = JSON.parse(await ev(`(async () => {
  for (const start of POOL_TITLES) for (const goal of POOL_TITLES) {
    const route = await parRoute({ start, goal, rules: [] });
    if (route?.length >= 4) return JSON.stringify(route);
  }
  return 'null';
})()`));
check('the snapshot has a pair at par 3 or more', !!deep, String(deep));
await open(`#start=${encodeURIComponent(deep[0])}&target=${encodeURIComponent(deep.at(-1))}`);
await play();
for (const [n, title] of [deep[1], deep[0], deep[1]].entries()) {
  await ev(`navigate(${JSON.stringify(title)}, null)`);
  await until(`game.path.length === ${n + 2} && 'togo' in game.path.at(-1) && !game.loading`);
}
const missedNext = await ev('game.path.at(-1).next'), deepPar = deep.length - 1;
await ev(`navigate(${JSON.stringify(missedNext)}, null)`);
await until("game.path.length === 5 && 'togo' in game.path.at(-1) && !game.loading");
await ev('finish(false)');
const quickerText = `From ${deep[1]} (visited 2 times), ${missedNext} was ${deepPar - 2} click${deepPar === 3 ? '' : 's'} from ${deep.at(-1)}: 2 clicks quicker.`;
check('the shortcut of a detour that got as close again says how often its page was visited and how many clicks quicker it was',
  await until(`document.querySelector('#mShortcutText').textContent === ${JSON.stringify(quickerText)}`), await ev("document.querySelector('#mShortcutText').textContent"));
// Which detour's shortcut shows: the one that took the most clicks more than the shortcut would have, from two up, a
// checkpoint reached counting as getting there, none from the start or a checkpoint, and none for Exact clicks.
check('the shortcut is the costliest detour of two clicks or more, a checkpoint ending one, not from the start', await ev(`(() => {
  const at = (title, togo, more) => ({ title, togo, next: title + '+', aim: 'T', ...more }), names = (path, exact) => missedShortcut(path, exact)?.from ?? null;
  const sideways = [at('A', 3), at('B', 3), at('C', 2), at('D', 1), at('T', 0)];
  const long = [at('A', 3), at('B', 2), at('C', 2), at('D', 3), at('E', 1), at('T', 0)];
  const viaEnds = [at('A', 2), at('B', 2), at('V', 4, { via: 1 }), at('X', 3), at('Y', 4), at('Z', 5), at('W', 4)];
  const s = missedShortcut(long);
  return names(sideways) === null && s.from === 'B' && s.next === 'B+' && s.togo === 1 && names(long, true) === null
    && names(viaEnds) === 'X' && names([at('A', 1), at('B', 2), at('C', 3)]) === null && names([at('S', 2), at('A', 1), at('B', 2), at('C', 3)]) === 'A'
    && names([at('S', 2), at('V', 1, { via: 1 }), at('B', 2), at('C', 3)]) === null;
})()`));
// Its page's visits are counted going for the same objective, a checkpoint starting a new count, and inside the start's
// own detour the next costliest shows (a game played, Zoglin to Cooked Cod).
check('the shortcut says how many clicks quicker it was and how often its page was visited', await ev(`(() => {
  const at = (title, togo, more) => ({ title, togo, next: title + '+', aim: 'T', ...more }), pick = path => (s => s && [s.from, s.times, s.quicker])(missedShortcut(path));
  const zoglin = [at('Zoglin', 2), at('Mob', 2), at('Mob (disambiguation)', 3), at('Mob', 2), at('Entity', 2), at('Mob', 2), at('Cod', 1), at('Cooked Cod', 0)];
  const legs = [at('S', 3), at('B', 3), at('V', 2, { via: 1 }), at('B', 2), at('C', 2), at('D', 3), at('E', 4), at('F', 5)];
  return JSON.stringify([pick(zoglin), pick(legs)]) === JSON.stringify([['Mob', 3, 4], ['B', 1, null]]);
})()`));
await ev("closeModal(); toSetup()");

// Relay: two checkpoints from a challenge link, reached in order. One reached early doesn't count, the banner and the HUD
// name the next one, the record keeps both, and par goes through both.
const setCount = n => ev(`(s => { s.value = ${n}; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#viaCount'))`);
const hud = "document.querySelector('#hudLbl').textContent + ' ' + document.querySelector('#hudGoal').textContent";
const toast = "document.querySelector('#toast').textContent";
await open('#start=Diamond&via=Creeper&via=Zombie&target=Crafting');
check('a link with two checkpoints shows two numbered cards in order', await until(ready) && await ev(`viaCount() === 2 && document.querySelector('.pair').dataset.vias === '2'
  && ['via0', 'via1'].map(w => setup[w].title + ' ' + document.querySelector('#card-' + w + ' .tag').textContent).join() === 'Creeper Checkpoint 1,Zombie Checkpoint 2'
  && document.querySelector('#slot-via2').classList.contains('hidden') && openLink(new URL(challengeLink()).hash.slice(3)).includes('&via=Creeper&via=Zombie&')`));
await play();
check('the HUD names the first checkpoint', await ev(hud) === 'Checkpoint 1 Creeper', await ev(hud));
await ev("navigate('Zombie', null)");
await until('game.path.length === 2 && !game.loading');
check('the second checkpoint reached first doesn\'t count', await ev('game.viaNext === 0 && !game.path[1].via') && await ev(hud) === 'Checkpoint 1 Creeper');
await ev("navigate('Creeper', null)");
await until('game.path.length === 3 && !game.loading');
check('reaching the first checkpoint names the second', await ev(`game.path[2].via === 1 && ${toast} === '✓ Checkpoint 1 of 2 reached! Now find Zombie.'`) &&
  await ev(hud) === 'Checkpoint 2 Zombie', await ev(toast));
// The header's route: four stops, so the two done shrink to their ✓ until one is clicked, which opens them all.
const routeState = "[...document.querySelectorAll('#hudRoute .chip')].map(c => c.className.replace('chip ', '') + ':' + c.querySelector('.n').textContent).join(' | ')";
check('the route shows every stop, done, now or ahead, the done ones shrunk', await ev(`${routeState} === 'done short:Diamond | done short:Creeper | now:Zombie | ahead:Crafting'
  && !document.querySelector('#hudRoute .chip.done .n').checkVisibility() && document.querySelector('#hudTags').textContent.includes('1 of 2 checkpoints reached')`), await ev(routeState));
await ev("document.querySelector('#hudRoute .chip.done').click()");
check('a click on a stop done shows them all in full', await ev("document.querySelector('#hudRoute').classList.contains('open') && document.querySelector('#hudRoute .chip.done .n').checkVisibility()"));
await ev("navigate('Crafting', null)");
await until('game.path.length === 4 && !game.loading');
check('the target before the last checkpoint doesn\'t win', await ev('game.active'));
await ev("navigate('Zombie', null)");
await until('game.path.length === 5 && !game.loading');
check('reaching the last checkpoint names the target', await ev(`game.path[4].via === 2 && ${toast} === '✓ Checkpoint 2 of 2 reached! Now find Crafting.'`) &&
  await ev(hud) === 'Target Crafting', await ev(toast));
const relayPar = await ev("parRoute({ start: 'Diamond', vias: ['Creeper', 'Zombie'], goal: 'Crafting', rules: [] }).then(r => r.length - 1)");
await ev("navigate('Crafting', null)");
check('the relay is won and recorded with both checkpoints, par over the whole chain', await until('!game.active') &&
  await ev(`(r => r.won && r.vias.join() === 'Creeper,Zombie' && r.par === ${relayPar})(store.get('mwr.history', [])[0])`), `par ${relayPar}`);
check('a win sends fireworks up over the result', await until("fx.parts.filter(p => p.land).length >= 1 && !$('#fx').hidden", 3000), await ev('fx.parts.length'));
await ev("for (const p of fx.parts) if (p.land) p.life = 0");   // bursting now
check('and each bursts into its sparks', await until("fx.parts.filter(p => p.life >= 2400).length >= 70", 2000), await ev('fx.parts.length'));
// Its XP in the result: 2 × par, and more for the rest, flying into the bar, on Minecraft's levels.
check('XP levels are Minecraft\'s', await ev("xpLevel(6).L === 0 && xpLevel(7).L === 1 && xpLevel(7).into === 0 && xpLevel(352).L === 16 && xpLevel(353).into === 1"));
check('a win lists its XP in the result, filling the bar', await until("!!document.querySelector('#mXp:not(.hidden) .xp')", 5000)
  && await ev(`$('#mXp').textContent.includes('Win (par ' + ${relayPar} + ')') && $('#mXp').textContent.includes('+' + 2 * ${relayPar}) && adv.xp > 0`), await ev("$('#mXp').textContent"));
await ev("closeModal(); toSetup()");
// Swap reverses the whole chain. A third checkpoint rolls a third card; back to one, Reroll all drops the other two.
await ev("document.querySelector('#btnSwap').click()");
check('Swap plays the chain backwards', await ev("cardKeys().map(w => setup[w].title).join() === 'Crafting,Zombie,Creeper,Diamond'"),
  await ev("cardKeys().map(w => setup[w]?.title).join()"));
await setCount(3);
check('a third checkpoint rolls a third card', await until(ready) && await ev(`!!setup.via2 && document.querySelector('.pair').dataset.vias === '3' &&
  document.querySelector('#card-via2 .tag').textContent === 'Checkpoint 3'`), await ev('setup.via2?.title'));
await setCount(1);
await ev("reroll('all')");
check('back to one checkpoint, Reroll all drops the others', await until(ready) &&
  await ev("cardKeys().join() === 'start,via0,goal' && !setup.via1 && !setup.via2 && document.querySelector('#card-via0 .tag').textContent === 'Checkpoint'"));
await ev("document.querySelector('input[name=game][value=race]').click()");
check('the count hides with the Relay', await ev("document.querySelector('.game-opt[data-game=relay]').classList.contains('hidden') && document.querySelector('.pair').dataset.vias === '0'"));

// Round trip, an extra rule: the target, then back to the start. Reaching the target starts Back again from there, and
// every page of the way there goes dead.
const visibleCards = "[...document.querySelectorAll('.pair .card')].filter(c => c.checkVisibility()).map(c => c.querySelector('.title').textContent).join()";
await open('#start=Diamond&target=Zombie&rules=roundtrip');
check('a round trip is a Race with the Round trip box, the start as the finish and ⇄', await until(ready) && await ev(`gameMode() === 'race' && rules().join() === 'roundtrip'
  && document.querySelector('input.rule[value=roundtrip]').checked && document.querySelector('#cardStart .tag').textContent === 'Start and finish'
  && document.querySelector('#pairArrow').textContent === '⇄' && document.querySelector('#games input[value=race]').parentElement.querySelector('.diagram').textContent === 'A ⇄ B'
  && openLink(new URL(challengeLink()).hash.slice(3)).endsWith('&rules=roundtrip') && document.querySelector('#gameSum').textContent.startsWith('Race · Round trip')`), await ev("document.querySelector('#gameSum').textContent"));
const rtPar = await ev("cardsRoute(['Diamond', 'Zombie'], rules()).then(r => r.length - 1)");
check('setup par is the round trip\'s', await until(`document.querySelector('#setupPar').textContent === 'Par ${rtPar}'`), `par ${rtPar}`);
await play();
check('the HUD names the target first', await ev(hud) === 'Target Zombie' && await ev("document.querySelector('#hudTags').textContent.includes('On the way there')"), await ev(hud));
await ev("navigate('Crafting', null)");
await until('game.path.length === 2 && !game.loading');
await ev("navigate('Zombie', null)");
await until('game.path.length === 3 && !game.loading');
check('reaching the target turns back: the banner, the HUD, Back starting again', await ev(`${toast} === '✓ Target reached! Now head back to Diamond.'
  && game.stack.join() === 'Zombie' && document.querySelector('#btnBack').disabled && game.path[2].via === 1`) && await ev(hud) === 'Back to Diamond', await ev(toast));
const liveLinks = async () => JSON.parse(await ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.classList.contains('mwr-live')])))`, await frameCtx()));
let rtLinks = await liveLinks();
check('the way there is dead, saying why, other links live', rtLinks['/w/Crafting'] === false && rtLinks['/w/Diamond_Pickaxe'] === true
  && await ev("document.querySelector('a[href=\"/w/Crafting\"]').title === 'Off limits: part of your way there (Round trip)'", await frameCtx()), JSON.stringify(rtLinks));
await ev("navigate('Diamond Pickaxe', null)");
await until('game.path.length === 4 && !game.loading');
check('Back works again on the way back', await ev("!document.querySelector('#btnBack').disabled"));
await ev("document.querySelector('#btnPeek').click()");
check('the peek on the way back is headed Back to the start, with no colon', await ev("document.querySelector('#modal h2').textContent === 'Back to Diamond'"),
  await ev("document.querySelector('#modal h2')?.textContent"));
await ev('closeModal()');
await ev("navigate('Diamond', null)");
check('back at the start wins, recorded by its cards', await until('!game.active') && await ev(`(r => r.won && r.goal === 'Zombie' && !r.vias && !r.back
  && r.rules.join() === 'roundtrip')(store.get('mwr.history', [])[0]) && document.querySelector('#modal').textContent.includes('Diamond → Zombie → Diamond')`));
await ev("closeModal(); toSetup()");
// A Relay with Round trip: the checkpoints go around the target, here one each way, and the setup screen shows the target
// between them. A checkpoint of the way back passed on the way there stays live when the way there goes dead.
await open('#start=Diamond&via=Creeper&via=Zombie&target=Crafting&back=1&rules=checkpoint,roundtrip');
check('a Relay round trip shows the target between the checkpoints', await until(ready) && await ev(`gameMode() === 'relay' && rules().join() === 'checkpoint,roundtrip'
  && backCount() === 1 && ${visibleCards} === 'Diamond,Creeper,Crafting,Zombie' && document.querySelector('#pairArrow').textContent === '➜'
  && document.querySelector('#goalArrow').checkVisibility() && !document.querySelector('#slot-via1 .arrow').checkVisibility()
  && document.querySelector('#gameHelp').textContent.includes('there and back') && document.querySelector('#gameSum').textContent.includes('2 checkpoints, 1 on the way back')
  && openLink(new URL(challengeLink()).hash.slice(3)).includes('&via=Creeper&via=Zombie&back=1&rules=checkpoint,roundtrip')`), await ev(visibleCards));
const tripPar = await ev("cardsRoute(['Diamond', 'Creeper', 'Zombie', 'Crafting'], rules(), null, 1).then(r => r.length - 1)");
await play();
check('the HUD names the first checkpoint', await ev(hud) === 'Checkpoint 1 Creeper', await ev(hud));
await ev("navigate('Creeper', null)");
await until('game.path.length === 2 && !game.loading');
check('the first checkpoint names the target', await ev(`${toast} === '✓ Checkpoint 1 of 2 reached! Now find Crafting.'`) && await ev(hud) === 'Target Crafting', await ev(toast));
await ev("navigate('Zombie', null)");
await until('game.path.length === 3 && !game.loading');
await ev("navigate('Crafting', null)");
await until('game.path.length === 4 && !game.loading');
check('the target names the checkpoint of the way back, which stays live', await ev(`${toast} === '✓ Target reached! Now find Zombie.'
  && game.path[3].via === 2 && game.dead.has('Creeper') && game.dead.has('Crafting') && !game.dead.has('Zombie') && !game.dead.has('Diamond')`)
  && await ev(hud) === 'Checkpoint 2 Zombie' && (await liveLinks())['/w/Creeper'] === false, await ev(toast));
await ev("navigate('Zombie', null)");
await until('game.path.length === 5 && !game.loading');
check('the last checkpoint heads home', await ev(`${toast} === '✓ Checkpoint 2 of 2 reached! Now head back to Diamond.'
  && document.querySelector('#hudTags').textContent.includes('2 of 2 checkpoints reached · On the way back')`) && await ev(hud) === 'Back to Diamond', await ev(toast));
await ev("navigate('Diamond', null)");
check('the Relay round trip is won, recorded with its split, par over the loop', await until('!game.active') && await ev(`(r => r.won && r.goal === 'Crafting'
  && r.vias.join() === 'Creeper,Zombie' && r.back === 1 && r.par === ${tripPar})(store.get('mwr.history', [])[0])
  && document.querySelector('#modal').textContent.includes('Diamond → Creeper → Crafting → Zombie → Diamond')`), `par ${tripPar}`);
await ev("closeModal(); toSetup()");
// Blind target hides every card but the start until the game starts, and then each stop of a Relay until the one before
// it is reached, here round a loop with the target between the checkpoints. The start a round trip goes back to stays named.
const blindCards = "[...document.querySelectorAll('.pair .card')].filter(c => c.checkVisibility()).map(c => c.querySelector('.title').textContent + ': ' + c.querySelector('.desc').textContent).join(' | ')";
const route = "[...document.querySelectorAll('#hudRoute .n')].map(n => n.textContent).join()";
await open('#start=Diamond&via=Creeper&via=Zombie&target=Crafting&back=1&rules=checkpoint,roundtrip,blind');
check('Blind target holds a link\'s checkpoints and target unseen until the start, saying when each shows', await ev(blindCards) === 'Diamond: About Diamond. | '
  + 'Hidden: Blind target: picked and shown when you start. | Hidden: Blind target: picked and shown when you reach checkpoint 1. | Hidden: Blind target: picked and shown when you reach the target.', await ev(blindCards));
await play();
check('then the HUD names only the first checkpoint and the start', await ev(route) === 'Diamond,Creeper,?,?,Diamond', await ev(route));
await ev("navigate('Creeper', null)");
await until('game.path.length === 2 && !game.loading');
check('reaching it shows the target', await ev(route) === 'Diamond,Creeper,Crafting,?,Diamond' && await ev(hud) === 'Target Crafting', await ev(route));
await ev("navigate('Crafting', null)");
await until('game.path.length === 3 && !game.loading');
check('and the target the checkpoint of the way back', await ev(route) === 'Diamond,Creeper,Crafting,Zombie,Diamond', await ev(route));
await ev("finish(false); closeModal(); toSetup()");
await open('#start=Diamond&kind=Nether%20mobs&kind=Enchantments&kind=Potions&rules=scavenger,blind');
check('Blind target hides Scavenger\'s kinds until the start', await ev("document.querySelector('#cardHunt .kinds').textContent.startsWith('3 hidden kinds')"));
await play();
check('then shows them all', await ev(route) === 'a mob found in the Nether,an enchantment,a potion', await ev(route));
await ev("finish(false); closeModal(); toSetup()");
// An ordinary roll under Blind target picks only the start: the rest wait for Start, with no Reroll, Swap or par to give
// them away. Copy challenge link picks them and holds them unseen; any change drops them, turning the rule off included.
await open('#rules=nonav,checkpoint,blind');
check('Blind target leaves the hidden cards unpicked, with no Reroll, Swap or par', await ev(`!!setup.start && !setup.via0 && !setup.goal
  && !document.querySelector('#cardGoal .actions').checkVisibility() && !document.querySelector('#btnSwap').checkVisibility()
  && document.querySelector('#setupPar').textContent === 'Par shows when you start' && ${visibleCards} === setup.start.title + ',Hidden,Hidden'`), await ev(visibleCards));
await play();
check('Start picks them from different topics, showing the checkpoint only', await ev(`(cs => cs.every(Boolean) && new Set(cs.map(c => groupOf(c.title))).size === 3)([game.start, ...game.vias, game.goal])`)
  && await ev(route) === await ev("[game.start.title, game.vias[0].title, '?'].join()"), await ev(route));
await ev("finish(false)");
check('Share under Blind target names only the start, with no path, and the link holds the rest', await ev(`(t => t.includes('\\n' + game.start.title + ' → ? → ?\\n')
  && !t.includes(game.vias[0].title) && !t.includes(game.goal.title) && !t.includes('My path')
  && openLink(new URL(game.link).hash.slice(3)).includes('&via=' + encodeURIComponent(game.vias[0].title)))(${shared})`), await ev(shared));
await ev("closeModal(); toSetup()");
await ev("reroll('all')");
await until(ready);
await ev("document.querySelector('#btnCopy').click()");
check('Copy challenge link picks them and holds them unseen', await until('!!setup.goal && setup.busy === 0') && await ev(`openLink(new URL(challengeLink()).hash.slice(3)).includes('&target=') && ${visibleCards}.endsWith(',Hidden,Hidden')`));
// A copy the browser refuses leaves the link in the status line to copy by hand (each sealing differs, so compared opened).
await ev("navigator.clipboard.writeText = () => Promise.reject(new Error('Refused')); document.querySelector('#btnCopy').click()");
check('a refused copy says so, with the link to copy by hand', await until(`(([, link]) => link && openLink(new URL(link).hash.slice(3)) === openLink(new URL(gameLink()).hash.slice(3)))
  (document.querySelector('#setupStatus').textContent.split('Couldn’t copy, so copy the link from here: '))`),
  await ev("document.querySelector('#setupStatus').textContent"));
await ev("delete navigator.clipboard.writeText");
await ev("window.held = [setup.via0, setup.goal]; document.querySelector('#rules input[value=blind]').click()");
check('turning Blind target off drops them and rolls new ones to show', await until(ready)
  && await ev(`!${visibleCards}.includes('Hidden') && !!setup.via0 && !!setup.goal && setup.via0 !== held[0] && setup.goal !== held[1]`), await ev(visibleCards));
await ev("document.querySelector('#rules input[value=blind]').click()");
check('and turning it on drops them again', await ev(`!setup.goal && !setup.via0 && ${visibleCards}.endsWith(',Hidden,Hidden')`));
// Exact clicks under Blind target: the count waits for the game, and Start picks a target that can be done in it.
await ev("document.querySelector('input[name=game][value=exact]').click()");
check('Blind target hides Exact clicks\'s count', await until(ready) && await ev(`!setup.goal && document.querySelector('#exactInfo').textContent.startsWith('Blind target')`));
await play();
check('Start picks a target with a route of exactly par + 2', await ev(`!!game.exact && game.exact.at(-1) === game.goal.title && game.limit === game.exact.length - 1`)
  && await until(`game.par !== null && game.limit === game.par + 2`), await ev('JSON.stringify([game.par, game.limit])'));
await ev("finish(false); closeModal(); toSetup()");
// A target topic and par under Blind target: the start is rolled with a target at that par, which Start then picks.
await ev("document.querySelector('input[name=game][value=race]').click()");
await ev("document.querySelector('#topic').value = 'blocks'; (s => { s.value = 'p3'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#reach'))");
await until(ready, 30000);
await play();
check('Start picks a target from the topic at the par chosen', await until('game.par !== null') && await ev("game.par === 3 && game.goal.reach === 'p3' && groupOf(game.goal.title) === 'blocks'"),
  await ev("game.par + ' ' + game.goal.title"));
await ev("finish(false); closeModal(); toSetup(); document.querySelector('#reach').value = 'any'; document.querySelector('#topic').value = 'any'");
// A Blind target daily is held unseen, the same for everyone, and leaving it drops its cards.
const blindDay = await ev("(() => { for (let d = new Date(today()); ; d.setDate(d.getDate() - 1)) { const s = d.toISOString().slice(0, 10); if (dailyRule(s) === 'blind') return s; } })()");
await open('#daily=' + blindDay);
check(`a Blind target daily (${blindDay}) holds its target unseen`, await ev(`setup.daily === '${blindDay}' && !!setup.goal && ${visibleCards}.endsWith(',Hidden')`), await ev(visibleCards));
check('a daily\'s challenge link is its day', await ev(`gameLink().endsWith('#daily=${blindDay}')`), await ev('gameLink()'));
await play();
await ev("finish(false)");
check('a daily\'s share and result name its day and only its start', await ev(`(t => game.link.endsWith('#daily=${blindDay}') && t.startsWith('MC Wiki Race · Daily ' + shortDate(localDay('${blindDay}'), true) + '\\n')
  && $('.result-game .note').textContent.startsWith('Daily ' + shortDate(localDay('${blindDay}')) + ': ')
  && t.includes('\\n' + game.start.title + ' → ?\\n') && !t.includes(game.goal.title))(${shared})`), await ev(shared));
await ev("closeModal(); toSetup()");
await ev("window.held = setup.goal; document.querySelector('#rules input[value=blind]').click()");
check('turning Blind target off leaves it, saying so, and drops the target', await until(ready) && await ev(`setup.daily === null && !!setup.goal && setup.goal !== held
  && document.querySelector('#setupStatus').textContent === LEFT_DAILY
  && !${visibleCards}.includes('Hidden')`), await ev(visibleCards));
// Swap goes round the same loop from the target. Of one checkpoint either side will do; of three, at least one each way.
await open('#start=Diamond&via=Creeper&target=Crafting&rules=checkpoint,roundtrip');
check('one checkpoint may come before the target', await until(ready) && await ev(`backCount() === 0 && ${visibleCards} === 'Diamond,Creeper,Crafting'`));
await ev("document.querySelector('#btnSwap').click()");
check('Swap starts the loop from the target', await ev(`backCount() === 1 && ${visibleCards} === 'Crafting,Diamond,Creeper'`), await ev(visibleCards));
await setCount(3);
check('three checkpoints keep one each way', await until(ready) && await ev(`backCount() >= 1 && backCount() <= 2`), await ev('backCount()'));
const splits = new Set();
for (let i = 0; i < 6; i++) { await ev("reroll('all')"); await until(ready); splits.add(await ev('backCount()')); }
check('Reroll all rolls the split', [...splits].every(b => b === 1 || b === 2), [...splits].join());
await ev("(b => { b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('input.rule[value=roundtrip]'))");
check('without Round trip the target goes back to the end', await ev(`backCount() === 0 && ${visibleCards}.split(',').at(-1) === setup.goal.title
  && !document.querySelector('#goalArrow').checkVisibility() && document.querySelector('#gameHelp').textContent.includes('before the target counts')`));
// Scavenger's round trip finds everything, then heads home.
await open('#start=Diamond&via=Creeper&via=Zombie&target=Crafting&rules=roundtrip,scavenger');
await play();
check('the peek at the finds goes back to the hunt', await ev("(document.querySelector('#btnPeek').click(), document.querySelector('#pClose').textContent === 'Back to the hunt')"));
await ev('closeModal()');
for (const [i, t] of ['Creeper', 'Zombie', 'Crafting'].entries()) {
  await ev(`navigate('${t}', null)`);
  await until(`game.path.length === ${i + 2} && !game.loading`);
}
check('the last find heads home', await ev(`game.active && ${toast} === '✓ Found Crafting (3 of 3)! Now head back to Diamond.' && game.dead.has('Creeper')`)
  && await ev(hud) === 'Back to Diamond', await ev(toast));
await ev("navigate('Diamond', null)");
check('back home wins the hunt, recorded with the way home', await until('!game.active') && await ev(`(r => r.won && r.finds.length === 3 && r.rules.join() === 'roundtrip,scavenger')(store.get('mwr.history', [])[0])
  && document.querySelector('#modal').textContent.includes('Diamond → Creeper, Zombie, Crafting (any order) → Diamond')`));
await ev("closeModal(); toSetup()");
// A target with no way back that doesn't retrace (a dead end has no way back at all) says so as it is reached.
await open(`#start=Diamond&target=${encodeURIComponent(deadEnd)}&rules=roundtrip`);
await until(ready);
await play();
await ev(`navigate(${JSON.stringify(deadEnd)}, null)`);
check('a target with no way back says so', await until("game.path.at(-1).stranded && !game.loading") &&
  await ev(`${toast} === '✓ Target reached, but there’s no way back to Diamond that doesn’t retrace your steps.'`), await ev(toast));
await ev("finish(false); closeModal(); toSetup()");

// Exact clicks: Start waits for a route of exactly par + 2 that is on no page twice; the header counts toward it, Back
// and visited pages are gone, reaching the target sooner loses, on the count wins, and running out loses. It unticks the
// rules it can't be played with, and they untick it.
await open('#start=Diamond&target=Zombie&rules=exact');
const exact = JSON.parse(await ev(`(async () => {
  const par = (await cardsRoute(['Diamond', 'Zombie'], rules())).length - 1, g = await linkGraph([]), id = t => PAGE_IDS.get(t);
  const step = (a, b) => g.links[id(a)].includes(id(b)) || g.carries[id(a)].some(x => g.boxes[x].includes(id(b)));
  return JSON.stringify({ par, route: setup.exact, ok: !!setup.exact && setup.exact.length - 1 === par + 2 && new Set(setup.exact).size === setup.exact.length
    && setup.exact[0] === 'Diamond' && setup.exact.at(-1) === 'Zombie' && setup.exact.every((t, i) => i === 0 || step(setup.exact[i - 1], t)) });
})()`));
check('Exact clicks: setup finds a route of exactly par + 2 on no page twice, and shows the count', await until(ready) && exact.ok &&
  await ev(`document.querySelector('#setupPar').textContent === 'Par ${exact.par} · exactly ${exact.par + 2}'`), exact.route?.join(' → '));
const n = exact.par + 2;
await play();
check('the header counts toward it, saying the count only there, and Back is gone', await ev(`document.querySelector('#hudClicks').textContent === '0' && document.querySelector('#hudClicksK').textContent === 'of exactly ${n}' && document.querySelectorAll('#hudMeter i').length === ${n} && document.querySelector('#btnBack').classList.contains('hidden')
  && document.querySelector('#hudTags').textContent.endsWith('Land on the target with your last click, not before') && document.querySelector('#hudLbl').textContent === 'Target'`),
  await ev("[document.querySelector('#hudTags').textContent, document.querySelector('#hudLbl').textContent].join(' | ')"));
await ev("navigate('Crafting', null)");
await until('game.path.length === 2 && !game.loading');
rtLinks = await liveLinks();
check('visited pages are dead links, saying why', rtLinks['/w/Crafting'] === false && rtLinks['/w/Diamond_Pickaxe'] === true
  && await ev("document.querySelector('a[href=\"/w/Crafting\"]').title === 'Off limits: already visited (Exact clicks)'", await frameCtx()), JSON.stringify(rtLinks));
await ev("navigate('Zombie', null)");
check('reaching the target sooner loses: Too soon', await until('!game.active') && await ev(`(r => r.tooSoon && !r.won && r.exact === ${n})(store.get('mwr.history', [])[0])
  && document.querySelector('#modal h2').textContent === 'Too soon' && document.querySelector('#modal').textContent.includes('it had to be exactly ${n}')`));
await ev("closeModal(); toSetup()");
check('the history says too soon, under the game\'s label', await ev("document.querySelector('#history tbody tr .res.lost').textContent === '✗ Too soon' && document.querySelector('#history tbody tr .tag.game').textContent === 'Exact clicks'"));
await open('#start=Diamond&target=Zombie&rules=exact');
await until(ready);
await play();
for (const [i, t] of exact.route.slice(1).entries()) {
  await ev(`navigate(${JSON.stringify(t)}, null)`);
  await until(`game.path.length === ${i + 2} && !game.loading || !game.active`);
}
check('on the count wins, with no golf score', await until('!game.active') && await ev(`(r => r.won && r.clicks === ${n} && r.exact === ${n})(store.get('mwr.history', [])[0])`) &&
  await until("document.querySelector('#par').textContent.startsWith('Going by')") && await ev(`document.querySelector('#mScore').classList.contains('hidden')
  && document.querySelector('#mBestTitle').textContent === 'One way in exactly ${n}' && document.querySelectorAll('#mBest li').length === ${n + 1}`),
  await ev("document.querySelector('#mBestTitle')?.textContent"));
// Par + 2 clicks means at least two that get no closer, which Exact clicks needs, so none is marked.
check('its path has each page\'s count but marks no click that got no closer', await until(`document.querySelectorAll('#mPath .togo').length === ${n}`)
  && await ev("!document.querySelector('#mPath .worse') && !document.querySelector('#mPathNote').textContent.includes('red')"),
  await ev("document.querySelector('#mPath').textContent"));
await ev("closeModal(); toSetup()");
check('the history marks the win as the pair\'s best, played today', await ev(`(tr => tr.querySelector('.res.won').textContent === '✓ ${n} clicks' && !!tr.querySelector('.best-tag')
  && tr.querySelector('.h-when').textContent === 'Today' && tr.querySelector('.h-route').textContent.startsWith('Diamond → Zombie'))(document.querySelector('#history tbody tr'))`),
  await ev("document.querySelector('#history tbody tr').textContent.replace(/\\s+/g, ' ').trim()"));
// The count: a link's extra= sets it, and a challenge link carries it, so par + 4 needs a route of exactly that many and
// is a game of its own for personal bests. Random rolls one of par + 1 to 5 with every roll of the cards.
await open('#start=Diamond&target=Zombie&rules=exact&extra=4');
check('a link\'s extra=4 makes the count par + 4, and the challenge link carries it', await until(ready) && await ev(`document.querySelector('#exactExtra').value === '4'
  && setup.exact.length - 1 === ${exact.par + 4} && new Set(setup.exact).size === setup.exact.length && document.querySelector('#exactInfo').textContent === 'This pair: par ${exact.par} + 4, so exactly ${exact.par + 4} clicks.'
  && document.querySelector('#gameSum').textContent.startsWith('Exact clicks (par + 4)') && openLink(new URL(challengeLink()).hash.slice(3)).includes('&extra=4&')`),
  await ev("setup.exact?.join(' → ')"));
check('par + 4 and par + 2 are two games for personal bests', await ev(`(r => recordKey({ ...r, exact: ${exact.par + 4} }) !== recordKey({ ...r, exact: ${n} }))({ start: 'Diamond', goal: 'Zombie', rules: ['exact'] })`));
// With no route of exactly the count (here the search made to find none), Start stays off and the strip says what to do.
await ev("window.realExactRoute = exactRoute; exactRoute = async () => null; updateSetupPar()");
check('a pair with no route of exactly its count keeps Start off, saying to reroll or pick another count',
  await until(`document.querySelector('#exactInfo').textContent === 'This pair can’t be done in exactly ${exact.par + 4} clicks: reroll, or pick another number of clicks.'`)
  && await ev(`document.querySelector('#btnPlay').disabled && document.querySelector('#setupPar').textContent === 'Par ${exact.par} · no way in exactly ${exact.par + 4}'`),
  await ev("document.querySelector('#exactInfo').textContent"));
await ev("exactRoute = realExactRoute; updateSetupPar()");
// Under Blind target a link's number is held unseen like its cards: the strip and the line above them say Random.
await open('#start=Diamond&target=Zombie&rules=exact,blind&extra=4');
check('under Blind target a link\'s extra=4 is held unseen, and Start plays par + 4', await until('!!setup.exact') && await ev(`document.querySelector('#exactExtra').value === 'random'
  && document.querySelector('#gameSum').textContent.startsWith('Exact clicks (par + random)') && document.querySelector('#exactInfo').textContent.startsWith('Blind target')
  && document.querySelector('#cardGoal .title').textContent === 'Hidden'`) && await play() && await ev(`game.goal.title === 'Zombie' && game.limit === ${exact.par + 4}`),
  await ev("JSON.stringify([document.querySelector('#exactExtra').value, game.limit])"));
await ev("finish(false); closeModal(); toSetup()");
await open('#start=Diamond&target=Zombie&rules=exact');
await ev("(s => { s.value = 'random'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#exactExtra'))");
const randomCounts = [];
for (let i = 0; i < 8; i++) {
  if (i) await ev("reroll('all')");
  await until(ready);
  randomCounts.push(JSON.parse(await ev(`(async () => JSON.stringify([setup.extra, setup.exact.length - 1 - (await cardsRoute(cardKeys().map(w => setup[w].title), rules())).length + 1]))()`)));
}
check('Random rolls a count of par + 1 to 5 with each roll, and says only the count', randomCounts.every(([x, over]) => x === over && x >= 1 && x <= 5)
  && new Set(randomCounts.map(([x]) => x)).size > 1 && await ev("document.querySelector('#gameSum').textContent.startsWith('Exact clicks (par + random)')"),
  JSON.stringify(randomCounts));
await open('#start=Diamond&target=Zombie&rules=exact');
await until(ready);
await play();
const wander = JSON.parse(await ev(`JSON.stringify(POOL_TITLES.filter(t => t !== 'Zombie' && t !== 'Diamond').slice(0, ${n}))`));
for (const [i, t] of wander.entries()) {
  await ev(`navigate(${JSON.stringify(t)}, null)`);
  await until(`game.path.length === ${i + 2} && !game.loading || !game.active`);
}
check('running out loses: Out of clicks, headed in orange as Recent games marks a loss', await until('!game.active') && await ev(`store.get('mwr.history', [])[0].outOfClicks === true && document.querySelector('#modal h2').textContent === 'Out of clicks'
  && (probe => (document.body.append(probe), probe.style.color = 'var(--warm)', (c => (probe.remove(), c))(getComputedStyle(probe).color)))(document.createElement('i')) === getComputedStyle(document.querySelector('#modal h2')).color`));
await ev("closeModal(); toSetup()");
// Six clicks: the target on the sixth click wins; running out says what was left: no target yet, something still to find
// on a hunt, or the way back on a round trip. The detours are made-up pages, no target or find. Share says how a loss
// ended: out of clicks with the time, too soon with Exact clicks's count, the clicks with the Timer off.
const detours = Array.from({ length: 6 }, (_, i) => `Detour ${i + 1}`);
await playRoute('#start=Diamond&target=Zombie&rules=nonav,limit', ['Diamond', ...detours.slice(0, 5), 'Zombie']);
check('Six clicks: the target on the sixth click wins', await until('!game.active') && await ev("(r => r.won && r.clicks === 6 && !r.outOfClicks)(store.get('mwr.history', [])[0])"),
  await ev("JSON.stringify(store.get('mwr.history', [])[0])"));
await ev('closeModal(); toSetup()');
const outReasons = [];
for (const hash of ['#start=Diamond&target=Zombie&rules=nonav,limit', '#start=Diamond&kind=Hostile%20mobs&kind=Enchantments&kind=Potions&rules=nonav,scavenger,limit',
  '#start=Diamond&target=Zombie&rules=nonav,roundtrip,limit']) {
  await playRoute(hash, ['Diamond', ...detours]);
  outReasons.push(await until('!game.active') && await ev("document.querySelector('#modal .reason')?.textContent"));
  await ev('closeModal(); toSetup()');
}
check('running out says what was left: the target, something to find, or the way back', outReasons.join('|')
  === 'All 6 clicks used, and no target yet.|All 6 clicks used, with something still to find.|All 6 clicks used, and not back at Diamond yet.', outReasons.join(' | '));
check('Share says how a loss ended: out of clicks with the time, too soon with Exact clicks\'s count, the clicks with the Timer off', await ev(`(r => [
  { outOfClicks: true, clicks: 6, ms: 83000 }, { tooSoon: true, exact: 5, clicks: 3, ms: 12000 }, { clicks: 4, ms: undefined }]
  .map(x => shareText({ ...r, won: false, par: undefined, outOfClicks: undefined, tooSoon: undefined, ...x }, '#').split('\\n').find(l => l.startsWith('❌'))).join('|'))(store.get('mwr.history', [])[0])`)
  === '❌ Out of clicks after 1:23|❌ Too soon after 3 of 5 clicks, 0:12|❌ Gave up after 4 clicks');
await open('#start=Diamond&target=Zombie&rules=exact');   // the Exact clicks game again, which the checks below change
check('Exact clicks greys out Six clicks and Round trip and says why', await ev(`gameMode() === 'exact' && ['limit', 'roundtrip'].every(k =>
  document.querySelector(\`input.rule[value=\${k}]\`).disabled && document.querySelector(\`[data-desc=\${k}]\`).textContent.startsWith('Off: Exact clicks'))`));
await ev("['limit', 'roundtrip'].forEach(k => (b => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector(`input.rule[value=${k}]`)))");
check('ticked anyway, Six clicks and Round trip aren\'t played with Exact clicks, though the other tiles say the trip', await ev(`rules().join() === 'exact'
  && document.querySelector('#games input[value=race]').parentElement.querySelector('.diagram').textContent === 'A ⇄ B'`));
await ev("document.querySelector('input[name=game][value=relay]').click()");
check('another game takes them back', await until(ready) && await ev("rules().join() === 'checkpoint,roundtrip,limit' && !document.querySelector('input.rule[value=limit]').disabled"));
check('a link with several games plays Exact clicks only', await ev("(setRules(['checkpoint', 'roundtrip', 'exact', 'limit']), rules().join()) === 'exact' && gameMode() === 'exact'"));
await ev("setRules([])");

// Top links only: Six clicks is off with it, its graph is the links above each page's first heading, and in the article
// the links below the first heading and in navboxes are dead, with a line where the live ones end.
const withRules = keys => `(setRules(${JSON.stringify(keys)}), syncVia(), rules().join())`;
check('Top links only greys out Six clicks and says why, and Exact clicks still gives its own reason', await ev(`${withRules(['lead', 'limit'])} === 'lead'
  && $('input.rule[value=limit]').disabled && $('[data-desc=limit]').textContent.startsWith('Off: with Top links only')
  && ${withRules(['exact', 'lead', 'limit'])} === 'lead,exact' && $('[data-desc=limit]').textContent.startsWith('Off: Exact clicks')
  && ${withRules(['limit'])} === 'limit' && !$('input.rule[value=limit]').disabled`));
await ev("setRules([]); syncVia()");
check('its graph is the links above the first heading, a part of the links outside navboxes', await ev(`Promise.all([linkGraph(['lead']), linkGraph(['nonav'])]).then(([lead, body]) => {
  const d = PAGE_IDS.get('Diamond'), names = ids => ids.map(i => WIKI_DATA.articles[i][0]);
  return graphFiles.has('wiki-lead.js') && names(lead.links[d]).includes('Armor') && lead.links[d].length < body.links[d].length
    && lead.links.every((ids, i) => ids.every(v => body.links[i].includes(v)));
})`));
await open('#start=Diamond&target=Crafting&rules=nonav,lead');
check('par goes by it', await until("/^Par \\d+$/.test(document.querySelector('#setupPar').textContent)") && await ev(`parRoute({ start: 'Diamond', goal: 'Crafting', rules: ['nonav', 'lead'] })
  .then(r => r.length - 1 === +document.querySelector('#setupPar').textContent.slice(4))`), await ev("document.querySelector('#setupPar').textContent"));
await play();
links = await linkStates();
check('links above the first section heading are live, the contents\' heading aside, those below it dead, with a line over it', links.Diamond_Pickaxe === 'live'
  && links.Gold_Ingot === 'live' && links.Iron_Ingot === 'dead' && await ev(`document.querySelector('a[href="/w/Iron_Ingot"]').title === 'Off limits: Top links only'
    && document.querySelector('.mw-heading').previousElementSibling.className === 'mwr-fold' && document.querySelectorAll('.mwr-fold').length === 1`, await frameCtx()), JSON.stringify(links));
const shown = "[...document.querySelectorAll('#toc, .mw-heading, a[href=\"/w/Iron_Ingot\"]')].map(e => e.checkVisibility()).join() + '|' + document.querySelector('.mwr-fold button').textContent";
check('the rest of the article and the table of contents are folded away under the line, Show opens them and Hide folds them again', await ev(`(() => {
  const before = ${shown};
  document.querySelector('.mwr-fold button').click();
  const open = ${shown};
  document.querySelector('.mwr-fold button').click();
  return [before, open, ${shown}].join(' / ');
})()`, await frameCtx()) === 'false,false,false|Show it / true,true,true|Hide it / false,false,false|Show it', await ev(shown, await frameCtx()));
check('a link to a section in it opens it', await ev(`(document.querySelector('a[href="#Uses"]').click(), document.querySelector('#Uses').checkVisibility())`, await frameCtx()));
await ev("finish(false); closeModal(); toSetup()");
await open('#start=Diamond&target=Crafting&rules=lead');
await play();
links = await linkStates();
check('in Relaxed its navbox links are dead too', links.Creeper === 'dead' && links.Block === 'live' && links.Iron_Ingot === 'dead', JSON.stringify(links));
await ev("finish(false); closeModal(); toSetup()");
// About one pool target in nine has no route under it; such a pair says so where par goes.
const unreached = await ev(`(async () => { for (const t of POOL_TITLES) if (t !== 'Diamond' && !await parRoute({ start: 'Diamond', goal: t, rules: ['nonav', 'lead'] })) return t; })()`);
await open(`#start=Diamond&target=${encodeURIComponent(unreached)}&rules=nonav,lead`);
check('a pair with no route under it says so', await until("document.querySelector('#setupPar').textContent === 'No route with these rules'")
  && await ev("!document.querySelector('#btnPlay').disabled"), `${unreached}: ${await ev("document.querySelector('#setupPar').textContent")}`);
await open('#rules=nonav,lead');
check('a roll with it has a route', await until(ready) && await until("/^Par \\d+$/.test(document.querySelector('#setupPar').textContent)"),
  await ev("document.querySelector('#setupPar').textContent"));

// Scavenger, kinds: a link's kinds go on the hunt card, par is a route through a member of each, and a find ticks its
// kind: a snapshot member, or a page the live wiki puts in the category less the kind's exclusions (Chicken). Finding
// one of each wins, and the record keeps the kinds.
await open('#start=Diamond&kind=Nether%20mobs&kind=Enchantments&kind=Potions&rules=scavenger');
check('Scavenger: a kinds link puts its kinds on the hunt card in place of the target', await until(ready) && await ev(`huntMode() === 'kinds'
  && setup.kinds.join() === 'Nether mobs,Enchantments,Potions' && !document.querySelector('#cardHunt').classList.contains('hidden')
  && document.querySelector('#cardGoal').classList.contains('hidden') && document.querySelector('#cardHunt .kinds').textContent.includes('a mob found in the Nether')
  && openLink(new URL(challengeLink()).hash.slice(3)) === 'start=Diamond&kind=Nether%20mobs&kind=Enchantments&kind=Potions&rules=scavenger'`));
const kindsPar = JSON.parse(await ev(`cardsRoute(['Diamond'], rules(), setup.kinds).then(r => JSON.stringify({ route: r,
  each: setup.kinds.every(k => r.slice(1).some(t => KIND_MEMBERS.get(k).has(t))) }))`));
check('its par is a route through a member of each kind', kindsPar.each && await until(`document.querySelector('#setupPar').textContent === 'Par ${kindsPar.route.length - 1}'`),
  kindsPar.route.join(' → '));
await play();
const hunt = "[...document.querySelectorAll('#hudRoute .chip')].map(c => (c.classList.contains('done') ? '✓ ' : '') + c.textContent.replace(/\\s+/g, ' ').trim()).join(', ')";
check('the header lists the kinds to find', await ev(hunt) === 'a mob found in the Nether, an enchantment, a potion' && await ev("document.querySelector('#hudTags').textContent.includes('Found 0 of 3')"), await ev(hunt));
await ev("navigate('Chicken', null)");
await until('game.path.length === 2 && !game.loading');
check('an excluded page in the live category isn\'t a find', await ev('!game.path[1].found && game.hunt.every(h => !h.found)'));
await ev("navigate('Brand New Mob', null)");
await until('game.path.length === 3 && !game.loading');
check('a page only the live wiki puts in the category is a find', await ev(`game.path[2].found?.join() === 'a mob found in the Nether'
  && ${toast} === '✓ Found a mob found in the Nether: Brand New Mob (1 of 3)'`) && await ev(hunt) === '✓ a mob found in the Nether (Brand New Mob), an enchantment, a potion', await ev(hunt));
await ev("navigate('Sharpness', null)");
await until('game.path.length === 4 && !game.loading');
await ev("navigate('Potion of Swiftness', null)");
check('one of each wins, recorded by its kinds', await until('!game.active') && await ev(`(r => r.won && r.kinds.join() === 'Nether mobs,Enchantments,Potions' && r.goal === undefined
  && isRecord(r))(store.get('mwr.history', [])[0]) && document.querySelector('#modal').textContent.includes('Diamond → a mob found in the Nether, an enchantment, a potion')`));
await ev("closeModal(); toSetup()");
check('the history names the kinds', await ev("document.querySelector('#history tbody tr').textContent.includes('a mob found in the Nether, an enchantment, a potion')"));
await open('#start=Diamond&kind=Hostile%20mobs&kind=Flying%20mobs&kind=Potions&rules=scavenger');
await until(ready);
await play();
await ev("navigate('Blaze', null)");
check('a page of two kinds finds both', await until("game.path.length === 2 && !game.loading") &&
  await ev(`game.path[1].found.join() === 'a hostile mob,a flying mob' && ${toast} === '✓ Found a hostile mob and a flying mob: Blaze (2 of 3)'`), await ev(toast));
await ev("finish(false); closeModal(); toSetup()");
// The start is no find, coming back to it either, though the live wiki puts it in a kind's category.
await open('#start=Brand%20New%20Mob&kind=Nether%20mobs&kind=Enchantments&kind=Potions&rules=scavenger');
await until(ready);
await play();
await ev("navigate('Diamond', null)");
await until('game.path.length === 2 && !game.loading');
await ev("navigate('Brand New Mob', null)");
check('the start is no find, coming back to it either', await until('game.path.length === 3 && !game.loading') && await ev('game.hunt.every(h => !h.found) && !game.path[2].found'),
  await ev('JSON.stringify(game.path.map(e => e.found ?? null))'));
await ev("finish(false); closeModal(); toSetup()");
const rolled = JSON.parse(await ev(`(() => {
  setup.start = { title: 'Blaze' };
  const rolls = Array.from({ length: 40 }, rollKinds);
  return JSON.stringify(rolls.filter(ks => ks.length !== 3 || new Set(ks.map(k => KINDS[k].topic)).size !== 3 || ks.some(k => KIND_MEMBERS.get(k).has('Blaze'))));
})()`));
check('rolled kinds are three from three topics, none holding the start', rolled.length === 0, JSON.stringify(rolled.slice(0, 2)));
await open('#start=Diamond&kind=Hostile%20mobs&kind=Enchantments&kind=Potions&rules=scavenger');
await until(ready);
await ev("setCustom('start', 'Blaze')");
check('a start in one of the kinds rolls them again', await ev("KIND_MEMBERS.get('Hostile mobs').has('Blaze')") && await until("setup.start?.title === 'Blaze' && setup.busy === 0") &&
  await ev("setup.kinds.length === 3 && !setup.kinds.some(k => KIND_MEMBERS.get(k).has('Blaze'))"), await ev('setup.kinds.join()'));

// Scavenger, articles: three Find cards joined by +, par the best order, any order wins, Distance counts to the nearest.
await open('#start=Diamond&target=Bamboo&via=Ghast&via=Sharpness&rules=scavenger,distance');
check('Scavenger: an articles link shows three Find cards joined by +', await until(ready) && await ev(`huntMode() === 'articles' && cardKeys().join() === 'start,via0,via1,goal'
  && ['#card-via0', '#card-via1', '#cardGoal'].every(c => document.querySelector(c + ' .tag').textContent === 'Find')
  && document.querySelector('#slot-via0 .arrow').textContent === '+' && openLink(new URL(challengeLink()).hash.slice(3)).endsWith('&target=Bamboo&via=Ghast&via=Sharpness&rules=distance,scavenger')`),
  await ev('openLink(new URL(challengeLink()).hash.slice(3))'));
const best = JSON.parse(await ev(`Promise.all(orders(['Ghast', 'Sharpness', 'Bamboo']).map(o => parRoute({ start: 'Diamond', vias: o.slice(0, -1), goal: o.at(-1), rules: ['nonav'] })))
  .then(rs => JSON.stringify([Math.min(...rs.map(r => r.length - 1)), document.querySelector('#setupPar').textContent]))`));
check('its par is the best of the orders', await until(`document.querySelector('#setupPar').textContent === 'Par ${best[0]}'`), best.join(' / '));
await play();
// The expected count, from the fewest clicks to each find on its own (Relaxed, as the link plays).
const nearestFind = t => `Promise.all(['Ghast', 'Sharpness', 'Bamboo'].map(f => parRoute({ start: '${t}', goal: f, rules: [] })))
  .then(rs => Math.min(...rs.map(r => r?.length ?? Infinity)))`;
const [fromDiamond, fromCrafting] = [await ev(nearestFind('Diamond')), await ev(nearestFind('Crafting'))];
await ev("navigate('Crafting', null)");
check('Distance counts to the nearest find', await until(`game.path.length === 2 && !game.loading && game.path[1].togo === ${fromCrafting - 1}`) && await ev(`game.path[0].togo === ${fromDiamond - 1}`),
  `${await ev('JSON.stringify(game.path.map(p => p.togo))')}, expected the nearest find ${fromDiamond - 1} clicks from Diamond, ${fromCrafting - 1} from Crafting`);
for (const [i, t] of ['Sharpness', 'Bamboo', 'Ghast'].entries()) {
  await ev(`navigate(${JSON.stringify(t)}, null)`);
  await until(`game.path.length === ${i + 3} && !game.loading || !game.active`);
  if (i === 0) check('a find in any order', await ev(`${toast} === '✓ Found Sharpness (1 of 3)' && game.path[2].found.join() === 'Sharpness'`), await ev(toast));
}
check('all three in any order wins, recorded by its articles', await until('!game.active') && await ev(`(r => r.won && r.finds.join() === 'Ghast,Sharpness,Bamboo'
  && r.goal === undefined)(store.get('mwr.history', [])[0]) && document.querySelector('#modal').textContent.includes('Diamond → Ghast, Sharpness, Bamboo (any order)')`));
await ev("closeModal(); toSetup()");
await ev("(s => { s.value = 'kinds'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#huntMode'))");
check('switching to kinds rolls them onto the hunt card', await until(ready) && await ev(`setup.kinds?.length === 3 && cardKeys().join() === 'start'
  && !document.querySelector('#cardHunt').classList.contains('hidden') && document.querySelector('#slot-via0').classList.contains('hidden')`));
await ev("document.querySelector('input[name=game][value=relay]').click()");
check('picking Relay leaves Scavenger, giving the target back', await until(ready) && await ev(`!rules().includes('scavenger') && document.querySelector('.game-opt[data-game=scavenger]').classList.contains('hidden')
  && !document.querySelector('#cardGoal').classList.contains('hidden') && document.querySelector('#cardGoal .tag').textContent === 'Target'`));
await ev("setRules([])");

// Target par: each par rolls a start and a target at exactly that par from it: Par 3 in Relaxed too, where only about a
// third of starts have one, Par 4 in Hard, where few have one, and Par 5+ with every family and spin-off on, the only
// way to have one. The record and the history keep it.
await open('');
await until(ready);
for (const [level, value, ok, content = []] of [['normal', 'p1', p => p === 1], ['normal', 'p2', p => p === 2], ['normal', 'p3', p => p === 3],
  ['relaxed', 'p3', p => p === 3], ['hard', 'p4', p => p === 4], ['normal', 'p5', p => p >= 5, 'all']]) {
  await ev(`document.querySelector('input[name=level][value=${level}]').click(); setContent(${content === 'all' ? '[...CONTENT.keys()]' : '[]'})`);
  await ev(`document.querySelector('#reach').value = '${value}'`);
  await ev("reroll('all')");
  const got = await until(ready, 30000) && JSON.parse(await ev(`cardsRoute([setup.start.title, setup.goal.title], rules()).then(r =>
    JSON.stringify({ par: r && r.length - 1, reach: setup.goal.reach, pair: setup.start.title + ' -> ' + setup.goal.title }))`));
  check(`target par ${REACH_LABEL[value]} in ${level}: the target is at that par`, got && ok(got.par) && got.reach === value && await until(`document.querySelector('#setupPar').textContent === 'Par ${got?.par}'`),
    got ? `${got.pair}: par ${got.par}` : await ev("document.querySelector('#setupStatus').textContent"));
}
await ev('setContent([])');
// Every start's pars, worked out at once with bitsets (startPars), match a search from each start to the targets that join
// the web of links, as only those roll: with Top links only in Deep cuts with spin-offs, where Dungeons:Multishot's only
// par 2 target in Magic, Piercing, doesn't; in a Round trip, whose target has to get back to the web too; in Relaxed,
// through navboxes; and in Hard, around hubs, which the heart's search goes around too, so none is a par roll's target.
const parsOff = JSON.parse(await ev(`(async () => {
  const off = [], was = [rules(), mode(), document.querySelector('#topic').value];
  for (const [level, more, topic, picks, also] of [['relaxed', ['lead'], 'magic', ['joke', 'removed', 'variants', 'Dungeons', 'Legends', 'Story Mode'], ['Dungeons:Multishot']],
    ['normal', ['roundtrip'], null, [], []], ['relaxed', null, null, [], []], ['hard', null, null, [], []]]) {
    if (more) {
      setRules([...LEVELS[level].rules, ...more]);
      document.querySelector('input[name=mode][value=' + (picks.length ? 'deep' : was[1]) + ']').checked = true;
      setContent(picks);
    } else {
      setRules(was[0]); document.querySelector('input[name=mode][value=' + was[1] + ']').checked = true; setContent([]);
      document.querySelector('input[name=level][value=' + level + ']').click();
    }
    document.querySelector('#topic').value = topic ?? 'any';   // the table's key, which startPars reads from the select
    const pars = await startPars(topic), graph = await linkGraph(rules()), joined = await joinsWeb('goal'), web = distancesFrom(graph, WEB_HEART);
    for (const s of [...also, ...Array.from({ length: 25 }, () => pick(candidates(null, false)))]) {
      const d = distancesFrom(graph, s);
      let m = 0;
      for (const t of candidates(topic, true)) {
        const p = d[PAGE_IDS.get(t)];
        if (p !== 0 && (topic || groupOf(t) !== groupOf(s)) && joined(t) && web[PAGE_IDS.get(t)] >= 0) m |= p >= 1 && p < PAR_TOP ? 1 << p - 1 : 1 << PAR_TOP - 1;
      }
      if (m !== pars.get(s)) off.push(level + (more ? '+' + more : '') + ': ' + s);
    }
  }
  document.querySelector('#topic').value = was[2];
  return JSON.stringify(off);
})()`));
check('every start\'s pars, worked out at once, match a search from it to the targets that join the web, with Top links only and spin-offs, in a Round trip, in Relaxed and Hard',
  !parsOff.length, parsOff.slice(0, 3).join(', '));
await until(ready, 30000);
// A topic with no start at the par gives way to another: in Popular on Relaxed only six starts have a target at par 3,
// none of them Blocks or Mobs, so stopping at the planned topic would often give up.
const pool = await ev("mode()"), status = "document.querySelector('#setupStatus').textContent";
await ev("document.querySelector('input[name=mode][value=popular]').click(); document.querySelector('input[name=level][value=relaxed]').click()");
await until(ready, 30000);
await ev("document.querySelector('#reach').value = 'p3'; document.querySelector('#topic').value = 'any'");
const pairAtPar = `setup.start && setup.goal && $('#reach').value === 'p3' ? cardsRoute([setup.start.title, setup.goal.title], rules().filter(k => k !== 'checkpoint'))
  .then(r => setup.start.title + ' -> ' + setup.goal.title + ': par ' + (r.length - 1)) : ${status}`;
const popularRolls = [];
for (let i = 0; i < 5; i++) {
  await ev("reroll('all')");
  await until(ready, 30000);
  popularRolls.push(await ev(pairAtPar));
}
check('target par Par 3 in Popular on Relaxed tries the other topics', popularRolls.every(r => / -> .*: par 3$/.test(r)), popularRolls.join(' | '));
// In a Relay the start rolls first and the checkpoints take the topics it leaves: rolled after them, three checkpoints
// took the one topic with a start on most rolls.
await ev("setRules(['checkpoint'])");
await setCount(3);
await until(ready, 30000);
await ev("document.querySelector('#reach').value = 'p3'");
const relayRolls = [];
for (let i = 0; i < 5; i++) {
  await ev("reroll('all')");
  await until(ready, 30000);
  relayRolls.push(await ev(pairAtPar) + (await ev("viaKeys().some(w => groupOf(setup[w]?.title) === groupOf(setup.start?.title))") ? ' (a checkpoint in its topic)' : ''));
}
check('and in a Relay of three, the checkpoints go round the start\'s topic', relayRolls.every(r => / -> .*: par 3$/.test(r)), relayRolls.join(' | '));
// Charcoal has one target at par 3 here, Stony Shore: with Stony Shore a checkpoint kept, a new target is the nearest par
// it has, saying so, rather than giving up.
await ev("setCustom('via0', 'Stony Shore')"); await until(ready, 30000);
await ev("setCustom('start', 'Charcoal')"); await until(ready, 30000);
await ev("reroll('goal')"); await until(ready, 30000);
check('a start whose only target at the par is a checkpoint kept gets one at the nearest par, saying so', await ev(`setup.via0?.title === 'Stony Shore' && !!setup.goal && setup.goal.title !== 'Stony Shore'
  && ${status}.startsWith('Charcoal has no other target at par 3')`), await ev(`JSON.stringify([setup.start?.title, setup.via0?.title, setup.goal?.title, ${status}])`));
await ev("setRules([])");
await until(ready, 30000);
// Rerolling only the start keeps the target, with a start at the par from it, or at the nearest par if none has it (in
// Popular on Relaxed no start has a mob 3 clicks away).
await ev("document.querySelector('#reach').value = 'p3'; reroll('all')");
await until(ready, 30000);
const keptGoal = await ev('setup.goal.title'), oldStart = await ev('setup.start.title');
await ev("reroll('start')");
check('rerolling only the start keeps the target at the par', await until(ready, 30000) && await ev(`setup.goal.title === ${JSON.stringify(keptGoal)}`)
  && / -> .*: par 3$/.test(await ev(pairAtPar)), `${oldStart} then ${await ev(pairAtPar)}`);
// The target rerolled while the start's roll is still going, or after one failed, has no start to draw from: the start
// rolls again with it, giving a pair at the par.
await ev("reroll('start'); reroll('goal')");
check('rerolling the target while the start rolls gives a pair at the par', await until(ready, 30000) && / -> .*: par 3$/.test(await ev(pairAtPar)), await ev(pairAtPar));
await ev("setup.start = null; renderCard('start'); reroll('goal')");
check('and so does rerolling it with no start', await until(ready, 30000) && / -> .*: par 3$/.test(await ev(pairAtPar)), await ev(pairAtPar));
// A start rerolled, or typed in, while Reroll all searches takes the cards that roll left empty with it.
await ev("reroll('all'); reroll('start')");
check('rerolling the start while all roll gives a pair at the par', await until(ready, 30000) && / -> .*: par 3$/.test(await ev(pairAtPar)), await ev(pairAtPar));
await ev("reroll('all'); setCustom('start', 'Diamond')");
check('and so does typing one in, with a target from it', await until(ready, 30000) && await ev("setup.start.title === 'Diamond' && !!setup.goal"),
  await ev('JSON.stringify([setup.start?.title, setup.goal?.title, document.querySelector("#setupStatus").textContent])'));
await ev("setCustom('goal', 'Zombie')");
await until("setup.goal?.title === 'Zombie' && setup.busy === 0");
await ev("reroll('start')");
const keptPar = await until(ready, 30000) && await ev("cardsRoute([setup.start.title, 'Zombie'], rules()).then(r => r.length - 1)");
check('and with none at the par, one at the nearest par', await ev(`setup.goal.title === 'Zombie' && ${status} === 'With Popular articles on Relaxed, no start has Zombie at par 3, so this one is par ${keptPar}.'`)
  && keptPar === 2, `${await ev(status)} (par ${keptPar})`);
// Settings with no pair at the par (in Popular on Relaxed no start has a Blocks target at par 3) roll at the nearest par
// that has one, the lower first, saying why, and the option is off until they change.
await ev("document.querySelector('#topic').value = 'blocks'; document.querySelector('#reach').value = 'p3'");
await ev("reroll('all')");
const p3Off = "(document.querySelector('#reach').dispatchEvent(new Event('focus')), document.querySelector('#reach option[value=p3]').disabled)";
const nearPar = await until(ready, 30000) && await ev(`cardsRoute([setup.start.title, setup.goal.title], rules()).then(r => r.length - 1)`);
check('settings with no pair at the par roll at the nearest par, saying why, and the option is off', await ev(`${status} === 'With Popular articles on Relaxed, no start has a target at par 3 in Blocks, so this one is par 2.'
    && $('#reach').value === 'p2' && groupOf(setup.goal.title) === 'blocks' && ${p3Off}`) && nearPar === 2, `${await ev(status)} (par ${nearPar})`);
check('until the settings change', await ev(`(document.querySelector('#topic').value = 'world', !${p3Off})`));
// A setting changed while the roll searches leaves the option on for it: the mark goes to the settings searched.
await ev("noPair.clear(); document.querySelector('#topic').value = 'blocks'; document.querySelector('#reach').value = 'p3'");
const searched = await ev("pairKey('p3')");
await ev("window.realStartPars = startPars; startPars = topic => { const p = realStartPars(topic); document.querySelector('#topic').value = 'world'; return p; }; reroll('all')");
check('a setting changed while a roll searches leaves the option on, marking the settings searched', await until(ready, 30000)
  && await ev(`noPair.has(${JSON.stringify(searched)}) && !${p3Off}`), await ev('JSON.stringify([...noPair])'));
await ev('startPars = realStartPars');
// A start typed in is kept when a par is picked, and with no target at it (in Popular on Relaxed no start has a Mobs
// target at par 3) gets one at the nearest par it has.
await ev("document.querySelector('input[name=level][value=relaxed]').click()");
await ev("setCustom('start', 'Diamond')");
await until("setup.start?.title === 'Diamond' && setup.busy === 0");
await ev("document.querySelector('#topic').value = 'mobs'; document.querySelector('#reach').value = 'p3'; document.querySelector('#target').dispatchEvent(new Event('change'))");
const nearest = await until(ready, 30000) && await ev(`cardsRoute(['Diamond', setup.goal.title], rules()).then(r => r.length - 1)`);
check('a typed-in start with no target at the par is kept, with one at the nearest par', await ev(`setup.start.title === 'Diamond' && groupOf(setup.goal.title) === 'mobs'
  && ${status} === 'Diamond has no target at par 3, so this one is par ${nearest}.'`) && nearest === 2, `${await ev(status)} (par ${nearest})`);
// A start typed in isn't checked to join the web of links, so its target comes from its whole search: from a dead end
// nothing can be reached, where the quicker search the rolled starts get would count every target the web reaches.
await ev(`setCustom('start', ${JSON.stringify(deadEnd)})`);
await until(`setup.start?.title === ${JSON.stringify(deadEnd)} && setup.busy === 0`);
await ev("reroll('goal')");
check('a typed-in start that reaches nothing says so', await until(`setup.busy === 0 && ${status}.startsWith('No target can be reached from ')`), await ev(status));
await ev(`document.querySelector('input[name=mode][value=${pool}]').click()`);
await until(ready, 30000);
await ev("document.querySelector('#topic').value = 'any'; document.querySelector('#reach').value = 'p3'");
await ev("reroll('all')");
await until(ready, 30000);
await play();
await until('game.par !== null');
await ev("finish(false); closeModal(); toSetup()");
check('the record and the history keep the target par, when the game is at it', await ev("store.get('mwr.history', [])[0].reach === 'p3' && document.querySelector('#history tbody tr').textContent.includes('Par 3')"));
// Finished before the par is worked out, the game keeps the target par, and drops it if the par turns out off it.
const parLater = [];
for (const route of ['game.parReady', "Promise.resolve(['A', 'B'])"]) {
  await play();
  await until('game.par !== null');
  await ev(`game.parReady = ${route}; game.par = null; finish(false)`);
  await until("store.get('mwr.history', [])[0].par !== undefined", 3000);
  parLater.push(await ev("JSON.stringify((r => [r.par, r.reach ?? null])(store.get('mwr.history', [])[0]))"));
  await ev('closeModal(); toSetup()');
}
check('finished before its par is known, a game keeps the target par, unless the par is off it', parLater.join() === '[3,"p3"],[1,null]', parLater.join(' '));
await ev("document.querySelector('#reach').value = 'any'; setRules(['nonav'])");
// Recent games shows the newest 15 games of the 50 the browser keeps (the history put back after).
await ev("window.histWas = localStorage.getItem('mwr.history'); (r => store.set('mwr.history', Array.from({ length: 55 }, (_, i) => ({ ...r, at: r.at - i - 1 }))))(store.get('mwr.history', [])[0]); renderHistory()");
check('Recent games shows the newest 15 games', await ev("document.querySelectorAll('#history tbody tr').length === 15"), await ev("document.querySelectorAll('#history tbody tr').length"));
await play();
await ev('finish(false); closeModal(); toSetup()');
check('of the 50 the browser keeps', await ev("store.get('mwr.history', []).length === 50"), await ev("store.get('mwr.history', []).length"));
await ev("localStorage.setItem('mwr.history', histWas); renderHistory()");

// Rolls: each pool keeps to its tier, starts and targets come from different topics (Chaos aside), and targets are linked
// well enough to be reached. planGroups and rollOne are called directly, with the pool's button set without a change event.
check('a page without a hash rolls a pair on Normal', await open('') && await ev("level() === 'normal' && mode() === 'everyday'"));
const rolls = JSON.parse(await ev(`(async () => {
  const out = {};
  for (const m of ['popular', 'everyday', 'deep', 'chaos']) {
    document.querySelector('input[value=' + m + ']').checked = true;
    const tier = m === 'popular' || m === 'deep' ? m : null, pairs = [];
    for (let i = 0; i < 40; i++) {
      const plan = planGroups(['start', 'goal']);
      pairs.push([(await rollOne('start', plan.start)).title, (await rollOne('goal', plan.goal)).title]);
    }
    out[m] = {
      ok: pairs.every(([s, g]) => ARTICLES.get(g).body >= MIN_BACKLINKS && (m === 'chaos' ? [s, g].every(t => CHAOS_TITLES.includes(t))
        : groupOf(s) !== groupOf(g) && [s, g].every(t => POOL_TITLES.includes(t) && (!tier || ARTICLES.get(t).tiers.includes(tier))))),
      body: pairs.reduce((sum, [, g]) => sum + ARTICLES.get(g).body, 0) / pairs.length, sample: pairs.slice(0, 2).map(p => p.join(' -> ')),
    };
  }
  document.querySelector('input[value=everyday]').checked = true;
  document.querySelector('#topic').value = 'mobs';
  const mobs = [];
  for (let i = 0; i < 20; i++) { const plan = planGroups(['start', 'goal']); mobs.push([(await rollOne('start', plan.start)).title, (await rollOne('goal', plan.goal)).title]); }
  out.mobs = mobs.every(([s, g]) => ARTICLES.get(g).topic === 'mobs' && groupOf(s) !== 'mobs');
  document.querySelector('#topic').value = 'any';
  return JSON.stringify(out);
})()`));
for (const m of ['popular', 'everyday', 'deep', 'chaos'])
  check(`${m} rolls keep to their pool`, rolls[m].ok, `targets' links outside navboxes ${Math.round(rolls[m].body)} on average; ${rolls[m].sample.join(', ')}`);
check('Popular targets are better linked than Everyday\'s, Everyday\'s than Deep cuts\'', rolls.popular.body > rolls.everyday.body && rolls.everyday.body > rolls.deep.body);
check('a target topic pins the target, and the start comes from another', rolls.mobs);
// A card must join the wiki's web of links. Its examples are found in the snapshot by their links alone, so a new one
// can't turn a check into a pass on a page that has since changed: a page whose links all go to hubs (Bee Our Guest on
// 2026-08's) can start a game on Normal but not on Hard, a page with no links can't start one, and a page nothing links
// to can't be a target. The heart has to reach, and be reached from, almost all of the pool, or rolls would refuse most.
const joins = JSON.parse(await ev(`(async () => {
  const graph = await linkGraph(['nonav']), titles = WIKI_DATA.articles.map(([t]) => t), linked = new Set(graph.links.flat());
  const pages = titles.map((t, i) => [t, i]).filter(([t]) => !spinoffOf(t) && !HUB_TITLES.has(t));
  const find = test => pages.find(([, i]) => test(graph.links[i], i))?.[0] ?? null;
  const examples = {
    hubsOnly: find(vs => vs.length && vs.every(v => HUB_TITLES.has(titles[v]))), noLinks: find(vs => !vs.length), unlinked: find((vs, i) => !linked.has(i)),
    known: POOL_TITLES.filter(t => t !== WEB_HEART && !HUB_TITLES.has(t)).reduce((a, b) => ARTICLES.get(b).body > ARTICLES.get(a).body ? b : a),
  };
  setRules(['nonav', 'nohubs']);
  const hard = (await joinsWeb('start'))(examples.hubsOnly);
  setRules(['nonav']);
  const start = await joinsWeb('start'), goal = await joinsWeb('goal'), via = await joinsWeb('via0');
  const got = [hard, start(examples.hubsOnly), start(examples.noLinks), goal(examples.unlinked), goal(examples.known), via(examples.known), start('No such page')];
  const from = distancesFrom(graph, WEB_HEART), to = distancesTo(graph, PAGE_IDS.get(WEB_HEART), routeUsable({ keep: [], rules: rules() }));
  const web = POOL_TITLES.filter(t => from[PAGE_IDS.get(t)] >= 0 && to[PAGE_IDS.get(t)] >= 0).length / POOL_TITLES.length;
  const ms = async () => { const t = performance.now(); (await joinsWeb('via0'))(examples.known); return Math.round(performance.now() - t); };
  const normal = await ms();
  setRules([]);
  const relaxed = await ms();
  setRules(['nonav']);
  return JSON.stringify({ examples, got, web, normal, relaxed });
})()`));
const missing = Object.keys(joins.examples).filter(k => !joins.examples[k]);
check('the snapshot has a page of each kind the links check is tried on', !missing.length, missing.length ? `none found: ${missing.join(', ')}` : Object.values(joins.examples).join(', '));
check('a card needs a route to or from the heart of the wiki’s links', !missing.length && joins.got.join() === 'false,true,false,false,true,true,true',
  `${joins.got.join()}; a checkpoint's check ${joins.normal} ms in Normal, ${joins.relaxed} ms in Relaxed`);
check(`the heart (${await ev('WEB_HEART')}) reaches, and is reached from, almost all of the pool`, joins.web >= 0.98, `${(joins.web * 100).toFixed(1)}% on Normal`);
// A page with no live link (Hubs Only on Hard) gets a banner that stays until the next navigation: go Back, or with no
// Back only give up. On Normal its links work.
const stuck = `[game.stuck, ${toast}, document.querySelector('#toast').matches('.stay:not(.hidden)')].join('|')`;
await open('#start=Diamond&target=Zombie&rules=nonav,nohubs');
await until(ready);
await play();
check('a page with live links has no stuck banner', await ev(stuck) === 'false||false', await ev(stuck));
await ev(`navigate('${HUBS_ONLY}', null)`);
await until('game.path.length === 2 && !game.loading');
check('a page with no live links says to go Back or give up, and the banner stays',
  await ev(stuck) === 'true|⛔ No live links on this page. Go Back, or give up.|true' && await ev("getComputedStyle(document.querySelector('#toast')).animationName === 'toast-in'"), await ev(stuck));
await ev('goBack()');
await until('game.path.length === 3 && !game.loading');
check('leaving it takes the banner away', await ev(stuck) === 'false|⛔ No live links on this page. Go Back, or give up.|false', await ev(stuck));
await ev("finish(false); closeModal(); toSetup()");
await open(`#start=${encodeURIComponent(HUBS_ONLY)}&target=Diamond&rules=nonav,nohubs`);
await until(ready);
await play();
check('a start with no live links leaves only giving up', await ev(stuck) === 'true|⛔ No live links on this page, and no going Back: only giving up is left.|true', await ev(stuck));
await ev("finish(false); closeModal(); toSetup()");
await open(`#start=${encodeURIComponent(HUBS_ONLY)}&target=Diamond&rules=nonav`);
await until(ready);
await play();
check('on Normal its hub links work, so no banner', await ev(stuck) === 'false||false', await ev(stuck));
await ev("finish(false); closeModal(); toSetup()");
for (const m of ['popular', 'deep', 'chaos', 'everyday']) {
  await ev(`document.querySelector('input[value=${m}]').click()`);
  check(`rerolling in ${m} from the Pool row`, await until(ready), await ev("setup.start?.title + ' -> ' + setup.goal?.title"));
}

// The daily: the same pair every time, its cards from different topics, Normal plus its rule.
const pairOf = "JSON.stringify([...cardKeys().map(w => setup[w].title), rules()])";
await open('#daily=2026-01-06');
const daily = await ev(pairOf);
await open('#daily=2026-01-06');
check('the daily is the same on every load', await ev(pairOf) === daily, daily);
check('the daily is Normal with Checkpoint on 2026-01-06, its cards from different topics',
  await ev("rules().join() === 'nonav,checkpoint' && new Set(cardKeys().map(w => groupOf(setup[w].title))).size === cardKeys().length"), daily);
// A daily link only plays a real day that has come; any other gives today's. A sealed link can't hold a daily. A record
// only keeps a real day.
const dayLoaded = async hash => await open(hash) && await ev('setup.daily');
const todayIs = await ev('today()'), tomorrow = await ev("(d => (d.setDate(d.getDate() + 1), d.toLocaleDateString('sv')))(new Date())");
const loadedDays = [];
for (const d of ['2024-02-29', tomorrow, '2999-01-01', '2026-02-31', '2025-02-29', '2026-13-01', '0050-01-01', '2026-1-02', 'x', '']) loadedDays.push(await dayLoaded('#daily=' + d));
loadedDays.push(await dayLoaded('#daily'));
check('a daily link only plays a real day that has come', JSON.stringify(loadedDays) === JSON.stringify(['2024-02-29', ...Array(10).fill(todayIs)]), JSON.stringify(loadedDays));
check('a sealed link holds no daily', await ev(`openLink(sealLink('daily=2026-01-06&start=Diamond&target=Crafting')) === 'start=Diamond&target=Crafting'`));
check('a record only keeps a real day', await ev(`(r => isRecord(r) && isRecord({ ...r, daily: '2026-01-06' }) && !isRecord({ ...r, daily: '2026-02-31' }) && !isRecord({ ...r, daily: 'x' }))
  ({ start: 'Diamond', goal: 'Crafting', rules: [], won: true, clicks: 1, ms: 1, at: 1 })`));
await open('#daily=2026-01-02');
check('a Round trip daily (2026-01-02) is a Race there and back', await until(ready) && await ev(`rules().join() === 'nonav,roundtrip'
  && gameMode() === 'race' && cardKeys().join() === 'start,goal' && document.querySelector('#setupStatus').textContent.includes(': Round trip.')`), await ev(pairOf));
// A daily with no pair (here no page looked up exists) says so and points elsewhere, the cards left as they were.
await ev("window.realPageInfo = pageInfo; window.cardsBefore = cardKeys().map(w => setup[w]?.title).join(); pageInfo = async () => null; loadDaily('2026-01-03')");
check('a daily with no pair says to pick another day or play your own game', await until("setup.busy === 0 && document.querySelector('#setupStatus').textContent === DAILY_FAILED")
  && await ev("DAILY_FAILED === 'Couldn’t make this day’s daily challenge. Pick another day from Past dailies, or play your own game.' && cardKeys().map(w => setup[w]?.title).join() === cardsBefore"),
  await ev("document.querySelector('#setupStatus').textContent"));
await ev('pageInfo = realPageInfo');
// Every daily can be done: a route under its rules, and on a Six clicks day par 4 or less. A month of them.
const dailies = JSON.parse(await ev(`(async () => {
  const out = [];
  for (let d = 1; d <= 31; d++) {
    const p = await dailyPair('2026-01-' + String(d).padStart(2, '0'));
    const rules = ['nonav', p.rule], route = await parRoute({ start: p.start.title, vias: p.vias.map(v => v.title), goal: p.goal?.title, kinds: p.kinds, rules });
    const date = '2026-01-' + String(d).padStart(2, '0'), extra = p.rule === 'exact' ? dailyExtra(date) : null;
    const exact = p.rule === 'exact' && route && !!await exactRoute([p.start.title, p.goal.title], rules, route.length - 1 + extra, []);
    out.push({ rule: p.rule, hunt: p.hunt, vias: p.vias.length, kinds: p.kinds?.length ?? 0, par: route ? route.length - 1 : null, exact, extra });
  }
  return JSON.stringify(out);
})()`));
check('a month of dailies all have a route: Six clicks days par 4 or less, Checkpoint days one or two checkpoints, Round trip days there and back, Exact clicks days one of exactly par + 2 to 4, Scavenger days three kinds or three articles',
  dailies.length === 31 && dailies.every(d => d.par >= (d.rule === 'roundtrip' ? 2 : 1) && (d.rule !== 'limit' || d.par <= 4)
    && (d.rule === 'checkpoint' ? d.vias === 1 || d.vias === 2 : d.hunt === 'articles' ? d.vias === 2 : !d.vias) && (d.rule !== 'exact' || d.exact && d.extra >= 2 && d.extra <= 4)
    && (d.hunt === 'kinds' ? d.kinds === 3 : !d.kinds)) && ['roundtrip', 'limit', 'exact', 'scavenger'].every(r => dailies.some(d => d.rule === r)),
  dailies.map(d => `${d.rule}${d.hunt ? '/' + d.hunt : d.vias > 1 ? '×' + d.vias : d.extra ? '+' + d.extra : ''}:${d.par}`).join(' '));
// Exact clicks and Scavenger days load with their rule, ready to start.
const exactDay = await ev("`: Exact clicks, par + ${dailyExtra('2026-01-24')}.`");
for (const [date, rules, cards, what] of [['2026-01-24', 'nonav,exact', 'start,goal', exactDay], ['2026-01-08', 'nonav,scavenger', 'start', ': Scavenger hunt, 3 kinds.'],
  ['2026-01-10', 'nonav,scavenger', 'start,via0,via1,goal', ': Scavenger hunt, 3 articles.']]) {
  await open('#daily=' + date);
  check(`the ${date} daily loads as${what.slice(1, -1)}`, await until(ready, 30000) && await ev(`rules().join() === '${rules}' && cardKeys().join() === '${cards}'
    && document.querySelector('#setupStatus').textContent.includes('${what}') && (huntMode() !== 'kinds' || setup.kinds.length === 3)
    && (!rules().includes('exact') || !!setup.exact && setup.extra === dailyExtra('${date}') && document.querySelector('#exactExtra').value === String(setup.extra))`),
    await ev("document.querySelector('#setupStatus').textContent"));
}
await ev("document.querySelector('input[name=level][value=hard]').click()");
check('another difficulty leaves the daily', await ev("setup.daily === null && document.querySelector('#setupStatus').textContent === LEFT_DAILY"));

// The daily streak and stats, from mwr.dailies: only days won on their day make a streak, which lasts until today's is
// due, and anything finish wouldn't write is left out.
const ago = k => `(d => (d.setDate(d.getDate() - ${k}), dateKey(d)))(new Date())`;
await ev(`(() => {
  const win = { won: true, onDay: true, clicks: 3, ms: 60000 }, all = {};
  for (const k of [1, 2, 3, 5, 6, 7, 8, 9]) all[${ago('k')}] = win;
  all[${ago(4)}] = { won: true, onDay: false, clicks: 5 };
  all[${ago(10)}] = { won: false, onDay: false };
  Object.assign(all, { x: win, '2026-02-31': win, [${ago(11)}]: { won: false, onDay: true }, [${ago(12)}]: { won: true, onDay: true } });
  localStorage.setItem('mwr.dailies', JSON.stringify(all));
})()`);
await open('');
check('a streak counts days won on their day up to yesterday, with the best run and every day played', await ev(`(s => s.now === 3 && s.best === 5 && !s.today
  && Object.keys(savedDailies()).length === 10)(dailyStreaks(savedDailies()))`), await ev('JSON.stringify(dailyStreaks(savedDailies()))'));
check('the daily box says the streak, the best and the days won', await ev("document.querySelector('#dailyStats').textContent")
  === '🔥 3-day streak, play today to keep it · Best 5 · Won 9 of 10 days', await ev("document.querySelector('#dailyStats').textContent"));
// A daily's games keep the day's best win, and only a win on its day counts.
check('finishing a daily keeps its best win and joins the streak only when won on its day', await ev(`(() => {
  const day = today(), rec = (won, clicks, ms) => ({ daily: day, won, clicks, ms });
  saveDaily(rec(false, 2, 1000), true);
  const lost = savedDailies()[day];
  saveDaily(rec(true, 4, 9000), false);
  const later = dailyStreaks(savedDailies()).now;
  saveDaily(rec(true, 4, 5000), true); saveDaily(rec(true, 5, 1000), true); saveDaily(rec(false, 1, 1), true);
  const d = savedDailies()[day], s = dailyStreaks(savedDailies());
  return !lost.won && !lost.onDay && later === 3 && d.won && d.onDay && d.clicks === 4 && d.ms === 5000 && s.now === 4 && s.today;
})()`), await ev('JSON.stringify(savedDailies()[today()])'));
check('a loss after a win keeps the win, and a missed day ends a streak', await ev(`(() => {
  saveDaily({ daily: ${ago(1)}, won: false, clicks: 1, ms: 1 }, true);
  const a = { [${ago(3)}]: { won: true, onDay: true, clicks: 1 } }, b = { [${ago(2)}]: { won: true, onDay: true, clicks: 1 } };
  return dailyStreaks(savedDailies()).now === 4 && dailyStreaks(a).now === 0 && dailyStreaks(a).best === 1 && dailyStatsText(a) === 'Streak over · Best 1 · Won 1 of 1 day'
    && dailyStreaks(b).now === 0 && dailyStatsText({}) === '';
})()`));
// A daily played to the end is recorded for its day, a loss as played.
await ev("localStorage.removeItem('mwr.dailies')");
await open('#daily');
await play();
await ev("finish(false); closeModal(); toSetup()");
check('giving up a daily keeps its day as played', await ev("JSON.stringify(savedDailies()) === JSON.stringify({ [today()]: { won: false, onDay: false } })"), await ev("JSON.stringify(savedDailies())"));
check('the daily box counts it', await ev("document.querySelector('#dailyStats').textContent === 'Won 0 of 1 day'"), await ev("document.querySelector('#dailyStats').textContent"));
// Past dailies: this month, today marked, later days off, back to DAILY_FIRST's month and no further, a day loading its
// daily in place of a challenge link's cards.
await ev(`localStorage.setItem('mwr.dailies', JSON.stringify({ [${ago(1)}]: { won: true, onDay: true, clicks: 2 }, [today()]: { won: false, onDay: false } }))`);
await open('#start=Diamond&target=Diamond%20Pickaxe');
const wasChallenge = await ev('setup.challenge');
await ev("document.querySelector('#btnPastDailies').click()");
const calOk = `(() => { const c = document.querySelector('#modal .cal'), b = [...c.querySelectorAll('button')], t = c.querySelector('.today');
  return !document.querySelector('#modalBg').classList.contains('hidden') && t?.dataset.day === today() && t.classList.contains('played')
    && b.every(x => x.disabled === (x.dataset.day > today() || x.dataset.day < DAILY_FIRST)) && b.length === new Date(+today().slice(0, 4), +today().slice(5, 7), 0).getDate()
    && (y => !y || y.classList.contains('streak') || y.dataset.day.slice(0, 7) !== today().slice(0, 7))(c.querySelector('[data-day="' + ${ago(1)} + '"]'))
    && document.querySelector('#calNext').disabled && t.title.includes(dailyText(today())); })()`;
check('Past dailies opens on this month, today marked, the days to come off', await ev(calOk), await ev("document.querySelector('#modal').textContent"));
check('it goes back to the first daily\'s month and no further', await ev(`(() => {
  for (let i = 0; i < 240 && !document.querySelector('#calPrev').disabled; i++) document.querySelector('#calPrev').click();
  return [...document.querySelectorAll('#modal .cal button')].every(b => b.dataset.day.startsWith(DAILY_FIRST.slice(0, 7)) && b.disabled === (b.dataset.day < DAILY_FIRST || b.dataset.day > today()))
    && document.querySelector('#calNext').disabled === (DAILY_FIRST.slice(0, 7) === today().slice(0, 7));
})()`));
await ev("document.querySelector('#modal .cal button:not(:disabled)').click()");
check('a day loads its daily', await until("setup.daily !== null && setup.daily < today() && document.querySelector('#modalBg').classList.contains('hidden')") && await until(ready)
  && await ev("document.querySelector('#setupStatus').textContent.startsWith('Daily challenge for ' + shortDate(localDay(setup.daily)) + ': ')"), await ev('setup.daily'));
check('and is no challenge link\'s game then, for Accepted', wasChallenge === true && await ev('setup.challenge === false'), await ev('setup.challenge'));
check('Clear history empties the dailies too', await ev(`(() => {
  document.querySelector('#btnClearHistory').click(); document.querySelector('#hClear').click();
  return localStorage.getItem('mwr.dailies') === '{}' && document.querySelector('#dailyStats').textContent === '';
})()`));

// Content and Spin-offs. A spin-off's links work when it is on, or when a card's page is in it.
await open('#start=Minecraft%20Dungeons&target=Diamond');
check('Everyday rolls Dungeons pages only with Dungeons on', await ev(`(() => {
  const sample = () => Array.from({ length: 300 }, () => candidate(planGroups(['start']).start, false));
  const off = sample().every(t => !spinoffOf(t));
  setContent(['Dungeons']);
  const on = sample().some(t => t.startsWith('Dungeons:'));
  setContent([]);
  return off && on;
})()`));
await ev("document.querySelector('input[value=chaos]').click()");
check('Chaos shows the Content families ticked and fixed', await ev("[...document.querySelectorAll('#content input')].every(b => b.checked && b.disabled) && content().length === 0"));
await ev("document.querySelector('input[value=everyday]').click()");
check('leaving Chaos gives the Content boxes back', await ev("[...document.querySelectorAll('#content input')].every(b => !b.checked && !b.disabled)"));
await until(ready);
await ev("document.querySelector('#spinoffs input[value=Legends]').click()");
check('All shows a dash when only some spin-offs are on', await ev("(a => a.indeterminate && !a.checked)(document.querySelector('#spinAll'))"));
await ev("document.querySelector('#spinAll').click()");
check('All turns every spin-off on', await ev("spinoffBoxes().every(b => b.checked)"));
await until(ready);
await open('#start=Minecraft%20Dungeons&target=Diamond');
await play();
check('links into a spin-off that is off are dead', (await linkStates())['Dungeons:Creeper'] === 'dead');
await ev("finish(false); closeModal(); toSetup(); document.querySelector('#spinoffs input[value=Dungeons]').checked = true");
await play();
check('links into a spin-off that is on work', (await linkStates())['Dungeons:Creeper'] === 'live');
await ev("finish(false)");
check('the result records the Content and names it', await ev("(([r]) => r.content.join() === 'Dungeons' && settingsText(r) === 'Content: Dungeons, Relaxed')(savedGames())"),
  await ev("settingsText(savedGames()[0])"));
await open('#start=Dungeons:Creeper&target=Diamond');
await play();
check('a card in a spin-off turns its links on without the checkbox', await ev("game.content.join() === 'Dungeons'") && (await linkStates())['Dungeons:Creeper'] === 'live');
await ev("finish(false); closeModal(); toSetup()");
check('history entries with an unknown Content key are left out', await ev("(r => isRecord(r) && !isRecord({ ...r, content: ['Nope'] }))(savedGames()[0])"));

// Par: routes go by the graph files and keep to the game's settings. Each step must be a link in the graph it was found
// in, Relaxed's are never longer than Normal's nor Normal's than Hard's, Hard's avoid hubs but the target, Normal's only
// goes through a page that isn't content when no route through content alone is as short, a spin-off page is only
// reachable with its spin-off on, and a checkpoint's route goes through it.
const par = JSON.parse(await ev(`(async () => {
  const relaxed = await linkGraph([]), id = t => PAGE_IDS.get(t);
  const linked = (g, a, b) => g.links[id(a)].includes(id(b)) || (g.carries?.[id(a)] ?? []).some(x => g.boxes[x].includes(id(b)));
  const follows = (g, route) => route.every((t, i) => i === 0 || linked(g, route[i - 1], t));
  const hubs = new Set(HUB_TITLES.values()), bad = [], offContent = [];
  let throughContent = 0;
  for (let i = 0; i < 30; i++) {
    const start = pick(POOL_TITLES), goal = pick(POOL_TITLES);
    if (start === goal) continue;
    const [r, n, h] = await Promise.all([[], ['nonav'], ['nohubs', 'nonav']].map(rules => parRoute({ start, goal, rules })));
    if (!r || !n || !follows(relaxed, r) || !follows({ links: relaxed.links }, n) || r.length > n.length || (h && (h.length < n.length
      || h.slice(1).some(t => hubs.has(t) && t !== goal)))) bad.push(start + ' -> ' + goal);
    const pure = n && shortestRoute({ links: relaxed.links }, start, goal, v => CONTENT_PAGES[v]);
    if (pure?.length === n.length) {
      throughContent++;
      if (n.some(t => !CONTENT_PAGES[id(t)])) offContent.push(n.join(' → '));
    }
  }
  const off = await parRoute({ start: 'Minecraft Dungeons', goal: 'Dungeons:Creeper', rules: ['nonav'] });
  const on = await parRoute({ start: 'Minecraft Dungeons', goal: 'Dungeons:Creeper', rules: ['nonav'], content: ['Dungeons'] });
  // Round trips: there and back, never shorter than the shortest ways there and back, and the way back off the way there
  // (but the stops still ahead). Most reach that lower bound.
  const roundTrips = [], offWay = (route, turn, ahead) => route.slice(turn + 1).every(t => ahead.includes(t) || !route.slice(0, turn + 1).includes(t));
  let atBound = 0;
  for (let i = 0; i < 20; i++) {
    const start = pick(POOL_TITLES), goal = pick(POOL_TITLES);
    if (start === goal) continue;
    const [there, back, rt] = await Promise.all([[start, goal, []], [goal, start, []], [start, goal, ['roundtrip']]]
      .map(([s, g, r]) => parRoute({ start: s, goal: g, rules: ['nonav', ...r] })));
    if (!there || !back) continue;
    if (rt?.length === there.length + back.length - 1) atBound++;
    if (rt && (rt.length < there.length + back.length - 1 || rt[0] !== start || rt.at(-1) !== start || !follows({ links: relaxed.links }, rt)
      || !offWay(rt, rt.indexOf(goal), [start]))) roundTrips.push(start + ' -> ' + goal);
  }
  const via = await parRoute({ start: 'Diamond', vias: ['Creeper'], goal: 'Bamboo', rules: ['nonav'] });
  const relay = await parRoute({ start: 'Diamond', vias: ['Creeper', 'Zombie'], goal: 'Bamboo', rules: ['nonav'] });
  // A Relay round trip with one checkpoint each way, and Scavenger's kinds home again.
  const loop = await parRoute({ start: 'Diamond', vias: ['Creeper', 'Zombie'], goal: 'Bamboo', back: 1, rules: ['nonav', 'roundtrip'] });
  const kinds = ['Nether mobs', 'Enchantments', 'Potions'];
  const [hunt, huntHome] = await Promise.all([[], ['roundtrip']].map(r => parRoute({ start: 'Diamond', kinds, rules: ['nonav', 'scavenger', ...r] })));
  return JSON.stringify({ bad, offContent, throughContent, roundTrips, atBound, spinoff: off === null && on?.at(-1) === 'Dungeons:Creeper', via: via?.includes('Creeper') && via.at(-1) === 'Bamboo',
    relay: relay?.indexOf('Creeper') > 0 && relay.indexOf('Zombie') > relay.indexOf('Creeper') && relay.at(-1) === 'Bamboo',
    loop: loop?.indexOf('Creeper') > 0 && loop.indexOf('Bamboo') > loop.indexOf('Creeper') && loop.lastIndexOf('Zombie') > loop.indexOf('Bamboo') && loop.at(-1) === 'Diamond'
      && follows({ links: relaxed.links }, loop) && offWay(loop, loop.indexOf('Bamboo'), ['Zombie', 'Diamond']),
    kinds: !!hunt && huntHome?.at(-1) === 'Diamond' && huntHome.length > hunt.length && follows({ links: relaxed.links }, huntHome) });
})()`));
check('par routes follow the graph, Relaxed ≤ Normal ≤ Hard, Hard without hubs', par.bad.length === 0, par.bad.slice(0, 3).join(', '));
check('par shows a route through content alone when one is as short', par.offContent.length === 0 && par.throughContent >= 10,
  `${par.throughContent} of 30 had one; ${par.offContent.slice(0, 3).join(', ')}`);
check('par reaches a spin-off page only with its spin-off on', par.spinoff);
check('par goes through the checkpoint, and through two in order', par.via && par.relay);
check('round trip par goes there and back, the way back off the way there', par.roundTrips.length === 0 && par.atBound >= 15, `${par.atBound} at the bound; ${par.roundTrips.join(', ')}`);
check('a Relay round trip\'s par goes round the loop, the way back off the way there', par.loop);
check('Scavenger\'s round trip par goes home after the hunt', par.kinds);
await open('#start=Brand%20New%20Mob&target=Diamond');
await play();
await ev('finish(false)');
check('par names a card\'s page that isn\'t in the snapshot', await until("document.querySelector('#par')?.textContent === '“Brand New Mob” isn’t in the wiki’s offline copy from ' + shortDate(localDay(WIKI_DATA.snapshot), true) + ', so the fewest clicks are unknown.'"),
  await ev("document.querySelector('#par')?.textContent"));
await ev('closeModal(); toSetup()');
// From a dead end there is no route at all.
await open(`#start=${encodeURIComponent(deadEnd)}&target=Diamond`);
await play();
await ev('finish(false)');
check('par says when the offline copy has no route', await until("document.querySelector('#par')?.textContent === 'No route in the wiki’s offline copy from ' + shortDate(localDay(WIKI_DATA.snapshot), true) + ' with these settings.'"),
  await ev("document.querySelector('#par')?.textContent"));
await ev('closeModal(); toSetup()');

// Challenge links are sealed: the URL holds none of the titles, two links to one game differ, and each opens to the same
// game. A damaged or overlong blob rolls a random pair and says so. A made-up sealed link's missing article isn't named,
// and a hand-made one's is, since its titles are in the URL.
const cardsAndRules = "[setup.start?.title, setup.via0?.title, setup.goal?.title, rules().join()].join()";
await open('#start=Diamond&via=Creeper&target=Crafting&rules=checkpoint,blind');
const sealed = JSON.parse(await ev('JSON.stringify([challengeLink(), challengeLink()])')), sealedGame = await ev(cardsAndRules);
check('a challenge link holds no title and differs each time', sealed.every(l => /#g=[\w-]+$/.test(l) && !/Diamond|Creeper|Crafting|blind/.test(l))
  && sealed[0] !== sealed[1], sealed[0]);
await open(new URL(sealed[0]).hash);
check('a sealed link opens to its game, held unseen', sealedGame === 'Diamond,Creeper,Crafting,blind,checkpoint' && await ev(cardsAndRules) === sealedGame
  && await ev(visibleCards) === 'Diamond,Hidden,Hidden', await ev(cardsAndRules));
const damaged = "document.querySelector('#setupStatus').textContent.startsWith('The challenge link is damaged')";
const flipped = sealed[0].slice(0, -8) + (sealed[0].at(-8) === 'A' ? 'B' : 'A') + sealed[0].slice(-7);
check('a damaged link rolls a random pair and says so', await open(new URL(flipped).hash) && await until(damaged),
  await ev("document.querySelector('#setupStatus').textContent"));
check('an overlong blob is not opened', await open('#g=' + 'A'.repeat(9000)) && await until(damaged));
// The key is in the page, so a made-up blob can pass its hash. Whatever its bytes, it opens to nothing or to a
// challenge's keys only, with known rules, numbers for back and extra, and a title back as sealed: titles that try to
// add keys, every first byte, runaway and unknown rule bits, every tag byte, UTF-8 cut short and random bytes.
const madeUp = JSON.parse(await ev(`(() => {
  const utf8 = s => [...new TextEncoder().encode(s)], keys = [...LINK_TITLES, 'back', 'extra', 'rules'], bad = [];
  const tryBytes = (bytes, title) => {
    const q = openLink(sealBytes(bytes)), h = new URLSearchParams(q ?? '');
    if (![...h].every(([k, v]) => keys.includes(k) && (k !== 'rules' || v.split(',').every(r => isKey(RULES, r)))
      && (k !== 'back' && k !== 'extra' || /^\\d+$/.test(v))) || title !== undefined && h.get('start') !== title) bad.push(q);
  };
  for (const t of ['&daily=2026-01-01', 'x&rules=__proto__', '=&=&', '%26daily%3D1', '?start=Evil&target=x', '<script>', '\\u2028\\0']) {
    tryBytes([0, 0, 0xf8, ...utf8(t)], t);
  }
  for (let b = 0; b < 256; b++) tryBytes([b, 0, 0xf8, 65], 'A');
  for (const m of [[255, 255, 255, 255, 255, 255, 127], [128], [255, 255, 255, 255, 255], [127, 255]]) tryBytes([0, ...m, 0xf8, 65]);
  for (let t = 0xf8; t < 256; t++) tryBytes([0, 0, t, 65]);
  tryBytes([0, 0, 0xf8, 0xe2, 0x82]);
  const byte = () => Math.random() < 0.15 ? 0xf8 + (Math.random() * 8 | 0) : Math.random() * 256 | 0;
  for (let n = 0; n < 20000; n++) tryBytes(Array.from({ length: 2 + Math.random() * 40 | 0 }, byte));
  return JSON.stringify([bad.slice(0, 3), openLink(sealBytes([0, 0, 0xf8, ...utf8('&daily=2026-01-01')])), openLink(sealBytes([0, 0, 0xfc, 65]))]);
})()`));
check('a made-up blob with a good hash opens only to a challenge, its titles as sealed', !madeUp[0].length
  && madeUp[1] === 'start=%26daily%3D2026-01-01' && madeUp[2] === null, JSON.stringify(madeUp));
await open('#g=' + await ev("sealLink('start=No%20such%20page%2C%20visit%20example.com&target=Diamond')"));
check('a sealed link\'s missing article isn\'t named', await until("document.querySelector('#setupStatus').textContent.startsWith('One of the challenge link’s articles doesn’t exist or is left out of the game')")
  && !await ev("document.querySelector('#setupStatus').textContent.includes('example')"), await ev("document.querySelector('#setupStatus').textContent"));
await open('#start=No%20such%20page&target=Diamond');
check('a hand-made link\'s missing article is named', await until("document.querySelector('#setupStatus').textContent.startsWith('The challenge link’s article “No such page” doesn’t exist or is left out of the game')"),
  await ev("document.querySelector('#setupStatus').textContent"));
await open('#start=Java%20Edition%20version%20history&target=Diamond');
check('so is a left-out page', await until("document.querySelector('#setupStatus').textContent.startsWith('The challenge link’s article “Java Edition version history” doesn’t exist or is left out of the game')"),
  await ev("document.querySelector('#setupStatus').textContent"));

// Random game: every setting at random, then new cards for them. Eight clicks each fill the cards the settings use (the
// start only under Blind target), with the line above the cards naming the game, and they don't all come out the same.
const randomDone = `setup.busy === 0 && (isBlind() ? ['start'] : cardKeys()).every(w => setup[w]) && (huntMode() !== 'kinds' || isBlind() || setup.kinds?.length === 3)
  && document.querySelector('.pair').dataset.vias === String(viaKeys().length) && document.querySelector('#gameSum').textContent.startsWith(GAMES[gameMode()].label)`;
const randoms = [];
for (let i = 0; i < 8; i++) {
  await ev("document.querySelector('#btnRandom').click()");
  randoms.push(await until(randomDone) && await ev("[gameMode(), level(), mode(), rules().join(), content().join(), document.querySelector('#topic').value, document.querySelector('#reach').value].join('|')"));
}
check('Random game sets the settings at random and fills the cards they use', randoms.every(Boolean) && new Set(randoms).size > 4, randoms.join(' ; '));

// Items: one taken in hand gets the page and the article ready to break, and stays in hand, every click placing one,
// until Escape. TNT is placed unlit and lit by a click; a crystal hit blows up the page around it, the article too,
// leaving the rest working and the game going on, with Rebuild (and Give up) at the bottom; a blast lights TNT near it,
// sooner the nearer, sets off a crystal, breaks a bed and leaves a respawn anchor standing. Rebuild puts every piece back,
// Give up gives up. On the setup screen the anchor's four charges and its fifth click; with motion reduced the pieces
// only fade. The ghast leaves when the fireball is put away. The blasts and rebuilds earn the item advancements.
await ev("['mwr.history', 'mwr.dailies', 'mwr.advancements'].forEach(k => localStorage.removeItem(k)); adv = advEmpty()");
await open('#start=Diamond&target=Crafting&rules=nonav');
await play();
const frameBroken = async () => JSON.parse(await ev("JSON.stringify(document.querySelectorAll('[data-broke-style]').length)", await frameCtx()));
const viewer = "$('#frame').getBoundingClientRect()";
check('the hotbar buttons show TNT\'s picture, or say TNT without it, and the files wait for the hotbar', await until("!$('#hudItems span').classList.contains('hidden') || !$('#hudItems img').classList.contains('hidden')", 5000)
  && await ev("$('#hudItems span').textContent === 'TNT' && !filesAsked"));
await ev("holdItem('tnt')");
check('an item in hand follows the pointer over a layer that takes the clicks, the article ready to break', await ev("items.holding === 'tnt' && !!$('.hold') && !!$('.ghost') && !!$('.hold-tip')")
  && JSON.parse(await ev("JSON.stringify(document.querySelectorAll('.brk-word').length)", await frameCtx())) > 0);
await ev(`(r => { $('.hold').onclick({ clientX: r.left + 60, clientY: r.top + 60 }); $('.hold').onclick({ clientX: r.left + 160, clientY: r.top + 60 }); $('.hold').onclick({ clientX: r.right - 60, clientY: r.bottom - 60 }); })(${viewer})`);
check('each click places one, unlit, and it stays in hand', await ev("items.holding === 'tnt' && document.querySelectorAll('.thing.tnt').length === 3 && !document.querySelector('.thing.tnt.lit')"));
await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
check('Escape puts it away', await ev("!items.holding && !$('.hold')"));
await ev(`(r => { holdItem('bed'); $('.hold').onclick({ clientX: r.left + 110, clientY: r.top + 150 }); holdItem('anchor'); $('.hold').onclick({ clientX: r.left + 60, clientY: r.top + 170 });
  holdItem('crystal'); $('.hold').onclick({ clientX: r.left + 110, clientY: r.top + 110 }); dropItem(); })(${viewer})`);
const clockAt = await ev('now()');
await ev("$('.thing.crystal').click()");
check('hitting the crystal blows up the page around it, the article too, and the game goes on', await ev(`game.active && !$('#btnGiveUp').disabled && document.querySelectorAll('#game [data-broke-style]').length > 0 && !$('.thing.crystal')`)
  && await frameBroken() > 0 && await ev("!$('#rebuildBar').classList.contains('hidden') && !$('#btnBrokenGiveUp').classList.contains('hidden')"));
check('the blast lights the TNT near it, sooner the nearer, leaves the far one, breaks the bed and leaves the anchor standing', await ev(`(t => t.length === 3 && t.filter(x => x.lit).length === 2)([...items.things].filter(t => t.kind.startsWith('tnt')))
  && !$('.thing.bed') && !!$('.thing.anchor') && !!adv.got.kaboom`));
check('the clock runs on', await until(`now() > ${clockAt} + 500`, 3000));
await until("[...items.things].filter(t => t.kind.startsWith('tnt')).length === 1", 4000);
check('the lit TNT goes off, a chain reaction', await ev("!!adv.got.chain && adv.blasts === 3"), await ev('adv.blasts'));
await ev("$('.thing.tnt').click()");
check('a click lights a placed TNT', await ev("!!document.querySelector('.thing.tnt.lit')"));
await until("!$('.thing.tnt')", 6000);
await ev("$('#btnRebuild').click()");
// The article's are put back a moment after the page's, so both are waited for.
const frameWhole = async () => { for (let t = Date.now(); Date.now() - t < 3000; await sleep(200)) if (await frameBroken() === 0) return true; return false; };
check('Rebuild puts every piece back, the article\'s too', await until("!items.broken && !document.querySelector('#game [data-broke-style]')", 4000)
  && await frameWhole() && await ev("!!adv.got.rebuilder && game.rebuilt && $('#rebuildBar').classList.contains('hidden')"));
await ev("navigate('Crafting', null)");
check('and the game goes on to a win', await until('!game.active', 8000) && await ev("savedGames()[0].won && !!adv.got.pieces"), await ev('JSON.stringify(Object.keys(adv.got))'));
await ev('closeModal(); toSetup()');
await open('#start=Diamond&target=Crafting&rules=nonav');
await play();
await ev(`(r => { holdItem('bed'); $('.hold').onclick({ clientX: r.left + 100, clientY: r.top + 100 }); dropItem(); $('.thing.bed').click(); })(${viewer})`);
check('a bed slept in blows at once', await ev("items.broken && !!adv.got.intentional"));
await ev("$('#btnBrokenGiveUp').click()");
check('Give up gives up, the page whole again under the result', await until('!game.active', 3000)
  && await ev(`(r => !r.won && !Object.keys(LOSSES).some(k => r[k]))(savedGames()[0]) && !items.broken && !document.querySelector('#game [data-broke-style]') && $('.result-head h2').textContent === 'You gave up'
  && (probe => (document.body.append(probe), probe.style.color = 'var(--muted)', (c => (probe.remove(), c))(getComputedStyle(probe).color)))(document.createElement('i')) === getComputedStyle($('.result-head h2')).color`));
await ev('closeModal(); toSetup()');
// The setup screen: the respawn anchor's four charges, then its blast; Rebuild.
const pageHeight = await ev('document.documentElement.scrollHeight');
await ev("holdItem('anchor'); $('.hold').onclick({ clientX: 400, clientY: 300 }); dropItem(); for (let i = 0; i < 4; i++) $('.thing.anchor').click()");
check('a respawn anchor takes four charges', await ev("!!$('.thing.anchor') && !items.broken"));
await ev("$('.thing.anchor').click()");
check('and the fifth click blows up the setup screen around it, with no Give up', await ev("items.broken && document.querySelectorAll('#setup [data-broke-style]').length > 0 && $('#btnBrokenGiveUp').classList.contains('hidden')")
  && await ev("!!document.querySelector('#setup .site-foot') && !document.querySelector('#setup .site-foot[data-broke-style]')"));
await sleep(2500);
check('the pieces come to rest on what is left of the page below them, not the bottom of the window', await ev(`(els => els.length > 0 && els.some(el => el.getBoundingClientRect().bottom < innerHeight - 20)
  && els.every(el => el.getBoundingClientRect().bottom <= document.documentElement.scrollHeight - scrollY + 2))([...document.querySelectorAll('#setup .brk-thrown')])`));
check('and the page grows neither longer nor wider for them', await ev(`document.documentElement.scrollHeight <= ${pageHeight} + 1 && (scrollTo(600, scrollY), scrollX === 0)`),
  await ev(`JSON.stringify([document.documentElement.scrollHeight, ${pageHeight}, scrollX])`));
// Scrolled down, a blast there breaks the page there too.
await ev("scrollTo(0, document.documentElement.scrollHeight)");
await ev("holdItem('crystal'); $('.hold').onclick({ clientX: 300, clientY: innerHeight - 200 }); dropItem(); $('.thing.crystal').click()");
check('scrolled down, a blast breaks the page there too', await ev("[...document.querySelectorAll('#setup .brk-thrown')].some(el => el.closest('.site-foot, .history'))"));
check('and its shake leaves what is fixed on the screen where it is', await ev("getComputedStyle(document.body).translate === 'none' && !document.body.classList.contains('blast-shake') && Math.abs($('#btnItems').getBoundingClientRect().bottom - (innerHeight - 64)) < 2"),
  await ev("JSON.stringify([getComputedStyle(document.body).translate, $('#btnItems').getBoundingClientRect().bottom, innerHeight])"));
await ev('scrollTo(0, 0)');
await ev("$('#btnRebuild').click()");
check('Rebuild puts every piece back', await until("!items.broken && !document.querySelector('#setup [data-broke-style], #setup .brk-word, #setup .brk-run, #setup .brk-thrown')", 4000));
// Splitting the text into pieces lays nothing out anew (the rules' own spans are columns), and blasts all down the
// page, twice over, where pieces already lie, leave it ending where it did.
// Measured and split in one go, so nothing else on the page (a picture failing to its label) can move meanwhile.
await ev("$('#rules').scrollIntoView()");
check('taking an item in hand, the text in view split into pieces, moves nothing', await ev(`(() => {
  const sizes = new Map([...document.querySelectorAll('#setup *')].map(el => [el, el.getBoundingClientRect().height]));
  holdItem('crystal'); dropItem();
  return !!document.querySelector('#rules .brk-word') && [...sizes].every(([el, h]) => Math.abs(el.getBoundingClientRect().height - h) < .5);
})()`));
await send('browsingContext.setViewport', { context: ctx, viewport: { width: 800, height: 800 } }); await sleep(300);
const narrowHeight = await ev('document.documentElement.scrollHeight');   // the page whole at 800 px, for after
await send('browsingContext.setViewport', { context: ctx, viewport: null }); await sleep(300);
for (let round = 0; round < 2; round++) for (let y = 0; y < pageHeight; y += 400) {
  await ev(`scrollTo(0, ${y}); for (const x of [200, 500, 800]) { holdItem('crystal'); $('.hold').onclick({ clientX: x, clientY: Math.min(innerHeight - 20, ${y} + 300 - scrollY) }); dropItem(); $('.thing.crystal').click(); }`);
  await sleep(150);
}
await sleep(3000);
check('blasts all down the page and on its pieces leave it no longer', await ev(`document.documentElement.scrollHeight <= ${pageHeight} + 2 && document.querySelectorAll('#setup .brk-thrown').length > 100`),
  await ev(`JSON.stringify([document.documentElement.scrollHeight, ${pageHeight}, document.querySelectorAll('#setup .brk-thrown').length])`));
// Pieces thrown past the side are clipped, not hidden only, so a phone doesn't lay the page out wider; it still scrolls.
check('nor any wider, however far the pieces fly sideways, and it still scrolls down', await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth
  && getComputedStyle(document.body).overflowX === 'clip' && getComputedStyle(document.body).overflowY === 'visible' && (scrollTo(0, 500), scrollY === 500)`),
  await ev("JSON.stringify([document.documentElement.scrollWidth, document.documentElement.clientWidth, getComputedStyle(document.body).overflowX, scrollY])"));
// Made narrower in pieces, the page takes the new width and ends about where it would whole (its pieces of four words
// can't break where words would); back as it was, it ends as before.
const outside = "[...document.querySelectorAll('#setup *')].filter(el => !el.closest('.brk-thrown') && el.getBoundingClientRect().right > innerWidth + 1).length";
await send('browsingContext.setViewport', { context: ctx, viewport: { width: 800, height: 800 } }); await sleep(1500);
check('made narrower in pieces, the page takes the new width and ends about where it would whole', await ev(`document.documentElement.scrollHeight <= ${narrowHeight} * 1.05 && ${outside} === 0`),
  await ev(`JSON.stringify([document.documentElement.scrollHeight, ${narrowHeight}, ${outside}])`));
await send('browsingContext.setViewport', { context: ctx, viewport: null }); await sleep(1500);
check('and made wide again, where it did', await ev(`document.documentElement.scrollHeight <= ${pageHeight} + 2`), await ev('document.documentElement.scrollHeight'));
// Dragged across and clicked fast, in pieces and with an item in hand, the page selects nothing; put back, it does.
const drag = (x, y) => send('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
  { type: 'pointerMove', x: 5, y: 150 }, { type: 'pointerDown', button: 0 }, { type: 'pointerMove', x, y, duration: 150 }, { type: 'pointerUp', button: 0 },
  ...[0, 1, 2].flatMap(() => [{ type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }])] }] });
const selected = "getSelection().toString().length";
await ev('scrollTo(0, 0)'); await drag(700, 600);
check('dragged across and clicked fast, the page in pieces selects nothing', await ev(selected) === 0, await ev(selected));
await ev("$('#btnRebuild').click()");
await until("!items.broken && !document.querySelector('#setup [data-broke-style]')", 4000); await sleep(100);
await ev("holdItem('tnt')"); await drag(700, 600);   // placing a TNT and lighting it, taken away before it goes off
check('nor, put back, with an item in hand', await ev(selected) === 0, await ev(selected));
await ev("dropItem(); for (const t of [...items.things]) removeThing(t)"); await drag(700, 600);
check('and put down, it selects again', await ev(selected) > 0);
await ev('getSelection().removeAllRanges()');
await ev("setCalm(true); holdItem('bed'); $('.hold').onclick({ clientX: 400, clientY: 300 }); dropItem(); $('.thing.bed').click()");
check('with motion reduced the pieces fade where they are', await ev("(els => els.some(el => el.style.opacity === '0.12') && els.every(el => !el.style.transform))([...document.querySelectorAll('#setup [data-broke-style]')])"));
await ev("$('#btnRebuild').click(); setCalm(false)");
await until("!document.querySelector('#setup [data-broke-style]')", 4000);
await ev("holdItem('fireball')");
check('the fireball brings a ghast', await ev("[...items.things].some(t => t.kind === 'ghast')"));
await ev("$('.hold').onclick({ clientX: 300, clientY: 500 }); dropItem()");
await sleep(600);
check('put away, the ghast waits while its fireball flies and a moment after', await ev("(g => !!g && g.leaving && g.p.x > 0)([...items.things].find(t => t.kind === 'ghast'))"));
check('then floats off the page', await until("![...items.things].some(t => t.kind === 'ghast')", 15000));
// A ghast on the right floats off the right, facing that way; taken up again it comes back, the same one, and a blast
// reaches it where it has got to.
const ghasts = "[...items.things].filter(t => t.kind === 'ghast')";
await ev("items.pointer = { x: 100, y: 400 }; holdItem('fireball')"); await sleep(800);
await ev("dropItem()"); await sleep(500);
check('a ghast on the right floats off the right, facing it', await ev(`(gs => gs.length === 1 && gs[0].leaving && whereNow(gs[0]).x > innerWidth - 90 && gs[0].el.classList.contains('right'))(${ghasts})`),
  await ev(`JSON.stringify(${ghasts}.map(g => [whereNow(g).x, g.leaving]))`));
await ev("holdItem('fireball')"); await sleep(900);
check('taken up again it comes back, the same one', await ev(`(gs => gs.length === 1 && !gs[0].leaving && Math.abs(whereNow(gs[0]).x - (innerWidth - 90)) < 2)(${ghasts})`));
await ev("dropItem()"); await sleep(500);
await ev(`(p => blast({ x: p.x - 40, y: p.y }, 1.2))(whereNow(${ghasts}[0]))`);
check('and a blast reaches it on its way off', await ev(`${ghasts}.length === 0`));
await ev('itemsReset()');
await until("!document.querySelector('#setup [data-broke-style]')", 3000);
// A blast out of reach of a ghast floating in leaves it going where it was, where its fireballs come from.
// The blast goes off on the first frame it is well on its way, which a poll from here can miss.
const midway = await ev(`new Promise(ok => {
  items.pointer = { x: 100, y: 400 }; holdItem('fireball');
  const t0 = performance.now(), frame = () => {
    const g = ${ghasts}[0];
    if (g && performance.now() < (g.until ?? 0) && middleOf(g.el).x - g.p.x > 20) { blast({ x: 100, y: innerHeight - 40 }, 0.3); ok(true); }
    else if (performance.now() - t0 > 2000) ok(false);
    else requestAnimationFrame(frame);
  };
  frame();
})`);
await sleep(800);
check('a blast out of reach of a ghast floating in leaves it where it floats to', midway && await ev(`(gs => gs.length === 1 && gs[0].p.x === innerWidth - 90
  && Math.abs(middleOf(gs[0].el).x - gs[0].p.x) < 2)(${ghasts})`), await ev(`JSON.stringify([${midway}, ${ghasts}.map(g => [g.p.x, middleOf(g.el).x, innerWidth])])`));
// Knocked aside by a blast near the edge of its reach, it comes back to its place for its next shot.
await ev(`(g => blast({ x: g.p.x - 190, y: g.p.y }, 1))(${ghasts}[0])`); await sleep(500);
const knocked = await ev(`(g => g ? g.p.x - (innerWidth - 90) : null)(${ghasts}[0])`);   // how far from its place
await ev('spawnGhast()'); await sleep(700);
check('knocked aside, a ghast comes back to its place for its next shot', knocked > 5 && await ev(`(gs => gs.length === 1 && gs[0].p.x === innerWidth - 90
  && Math.abs(middleOf(gs[0].el).x - gs[0].p.x) < 2)(${ghasts})`), await ev(`JSON.stringify([${knocked}, ${ghasts}.map(g => [g.p.x, middleOf(g.el).x])])`));
await ev('itemsReset()');
await until("!document.querySelector('#setup [data-broke-style]')", 3000);
// A fireball hit in flight goes back and blows up on the ghast: Return to Sender.
await ev("items.pointer = { x: 100, y: 400 }; holdItem('fireball')"); await sleep(800);
await ev("$('.hold').onclick({ clientX: 120, clientY: innerHeight - 60 }); $('.thing.fireball').click()");
check('a fireball hit in flight goes back and blows up on the ghast: Return to Sender', await until(`!!adv.got.returnSender && ${ghasts}.length === 0 && !$('.thing.fireball')`, 4000),
  await ev(`JSON.stringify([!!adv.got.returnSender, ${ghasts}.length])`));
await ev('itemsReset()');
await until("!document.querySelector('#setup [data-broke-style]')", 3000);
// A creeper hisses once the pointer is near: hit then, it's knocked back (Shoo!); left to hiss, it blows up.
const creeper = "[...items.things].find(t => t.kind === 'creeper')", nearIt = `(c => items.pointer = { x: c.p.x + 40, y: c.p.y })(${creeper})`;
await ev("holdItem('creeper'); $('.hold').onclick({ clientX: 300, clientY: 300 }); dropItem()");
await ev(nearIt); await sleep(500);
await ev(`${creeper}.el.click()`);
check('hit while it hisses, a creeper is knocked back: Shoo!', await ev(`!!adv.got.shoo && (c => Math.hypot(c.p.x - items.pointer.x, c.p.y - items.pointer.y) > 150)(${creeper})`),
  await ev(`JSON.stringify([!!adv.got.shoo, ${creeper}?.p, items.pointer])`));
await ev(nearIt);
check('and left to hiss, it blows up', await until(`!${creeper} && items.broken`, 4000));
await ev('itemsReset()');
await until("!document.querySelector('#setup [data-broke-style]')", 3000);

// A blast while Rebuild puts the pieces back breaks nothing and marks nothing broken; while an item is in hand, a click
// on the bar is the bar's; a fireball taken up again comes from the ghast that is there, not one floating off.
await ev("holdItem('bed'); $('.hold').onclick({ clientX: 400, clientY: 300 }); dropItem(); $('.thing.bed').click()");
await ev("holdItem('tnt'); (r => $('.hold').onclick({ clientX: r.left + 5, clientY: r.top + 5, stopPropagation() {} }))($('#btnRebuild').getBoundingClientRect())");
check('while an item is in hand, a click on Rebuild is Rebuild\'s', await ev("!items.broken && items.holding === 'tnt' && !$('.thing.tnt')"));
await ev("dropItem(); blast({ x: 600, y: 300 }, 1.2)");
check('a blast while the pieces fly back breaks nothing and marks nothing broken', await ev("!items.broken && $('#rebuildBar').classList.contains('hidden')")
  && await until("!document.documentElement.classList.contains('broken')", 2000));
await until("!document.querySelector('#setup [data-broke-style]')", 3000);
await ev("holdItem('fireball')");
await ev("dropItem(); [...items.things].find(t => t.kind === 'ghast').shot = 0");
await sleep(400);
await ev("holdItem('fireball'); $('.hold').onclick({ clientX: 600, clientY: 600 })");
check('a fireball taken up again comes from the ghast that is there', await ev("(f => !!f && f.p.x > 0 && f.p.x < innerWidth)([...items.things].find(t => t.kind === 'fireball'))"),
  await ev("JSON.stringify([...items.things].map(t => [t.kind, Math.round(t.p.x)]))"));
await ev('itemsReset()');
await until("!document.querySelector('#setup [data-broke-style]')", 3000);
// The ✕ on the tip puts the item away (a finger has no right click or Escape), as does picking it again in the hotbar,
// opened over the layer; with a finger the item doesn't show where there is no pointer, and the tip says tap.
await ev("holdItem('tnt'); $('.hold-tip .put').click()");
check('the ✕ on the tip puts the item away', await ev("!items.holding && !$('.hold') && !$('.ghost')"));
await ev("holdItem('bed'); (r => $('.hold').dispatchEvent(new MouseEvent('click', { clientX: r.left + 5, clientY: r.top + 5, bubbles: true })))($('#btnItems').getBoundingClientRect())");
check('so does picking it again in the hotbar, opened over it, which frames it', await ev("$('.hotbar .held')?.dataset.item === 'bed'") && await ev("($('.hotbar .held').click(), !items.holding && !$('.hotbar'))"));
await ev("items.touch = true; holdItem('tnt')");
check('with a finger the item in hand isn\'t shown, and the tip says tap', await ev("$('.ghost').style.visibility === 'hidden' && $('.hold-tip').textContent.startsWith('Tap to place TNT, and tap')"));
await ev("dropItem(); items.touch = false; for (const t of [...items.things]) removeThing(t)");
// The Firework Rocket goes up from the click and bursts, on the page, breaking nothing.
await ev("fx.parts = []; holdItem('rocket'); $('.hold').onclick({ clientX: 400, clientY: 600 }); dropItem()");
check('a firework rocket goes up from the click, on the page, and breaks nothing', await until("fx.parts.some(p => p.land && p.on === 'page' && p.y <= 600)", 3000)
  && await ev("!items.broken && $('#rebuildBar').classList.contains('hidden') && !document.querySelector('#setup [data-broke-style]')"));

// Placed blocks sit on what they were placed on: the setup page as it scrolls, the article as it scrolls in its frame
// (out of sight once out of it), and go with the article on a click; a broken page takes no clicks but the hotbar's.
await ev("scrollTo(0, 0); holdItem('tnt'); $('.hold').onclick({ clientX: 300, clientY: 500 }); dropItem()");
await ev("scrollTo(0, 200)");
check('a block on the setup screen scrolls with the page', await until("(t => t.p.y === 300 && t.el.style.top === '300px')([...items.things][0])", 2000), await ev("[...items.things][0].p.y"));
// So do sparks: one on the page is drawn moved up as far as the page scrolled since.
const red = (x, y) => `(d => d[0] > 200 && d[1] < 60)(fxCtx.getImageData(${x} * fx.dpr, ${y} * fx.dpr, 1, 1).data)`;
await ev("fx.parts = [{ x: 100, y: 400, vx: 0, vy: 0, g: 0, size: 8, color: '#ff0000', born: performance.now(), life: 5000, ...fxOn({ on: 'page' }) }]; fx.last = performance.now(); fx.raf ||= requestAnimationFrame(fxFrame); scrollTo(0, 300)");
await ev("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
check('and a spark on it as well', await ev(`${red(100, 300)} && !${red(100, 400)}`));
await ev("fx.parts = []; holdItem('bed'); $('.hold').onclick({ clientX: 400, clientY: 300 }); dropItem(); $('.thing.bed').click()");
check('as a blast\'s are', await ev("fx.parts.length > 0 && fx.parts.every(p => p.on === 'page' && p.at.y === 300)"));
await ev("$('#btnRebuild').click()");
await until("!items.broken && !document.querySelector('#setup [data-broke-style]')", 4000);
await ev('scrollTo(0, 0); itemsReset()');
await open('#start=Diamond&target=Crafting&rules=nonav');
await play();
await ev(`(r => { holdItem('tnt'); $('.hold').onclick({ clientX: r.left + 100, clientY: r.top + 100 }); dropItem(); })($('#frame').getBoundingClientRect())`);
const fy = await ev("$('#frame').getBoundingClientRect().top + 100");
await ev("document.body.style.minHeight = '4000px'; scrollTo(0, 60)", await frameCtx());
check('a block on the article scrolls with it', await until(`(t => t.p.y === ${fy} - 60 && t.el.style.visibility === '')([...items.things][0])`, 2000), await ev("[...items.things][0].p.y"));
await ev("scrollTo(0, 400)", await frameCtx());
check('out of sight once scrolled out of the frame', await until("[...items.things][0].el.style.visibility === 'hidden'", 2000));
// The wiki's pages scroll through their body (overflow on it, none on <html>): a blast on a scrolled article leaves it
// where it was, and the wheel, passed on, scrolls it while it is in pieces.
await ev("document.body.style.overflowY = 'scroll'; scrollTo(0, 300)", await frameCtx());
// The frame tells its scroll on its next frame: the sparks take it as it is when the blast goes off.
await until(`items.frameScroll.y === ${await ev('scrollY', await frameCtx())}`, 2000);
await ev(`(r => { holdItem('crystal'); $('.hold').onclick({ clientX: r.left + 200, clientY: r.top + 200 }); dropItem(); $('.thing.crystal').click(); })($('#frame').getBoundingClientRect())`);
check('a blast on the article has its sparks go with the article', await ev("fx.parts.length > 0 && fx.parts.every(p => p.on === 'frame' && p.at.y === items.frameScroll.y)"));
await sleep(300);
check('a blast on a scrolled article leaves it scrolled where it was, and unable to scroll sideways', await ev("scrollY === 300 && document.scrollingElement.scrollHeight > innerHeight && getComputedStyle(document.body).overflowX === 'hidden'", await frameCtx()),
  await ev("JSON.stringify([scrollY, document.scrollingElement.scrollHeight, innerHeight])", await frameCtx()));
await ev("dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: $('#frame').getBoundingClientRect().left + 100, clientY: $('#frame').getBoundingClientRect().top + 100 }))");
check('and the wheel, passed on, scrolls it while it is in pieces', await ev("new Promise(r => setTimeout(() => r(scrollY === 420), 300))", await frameCtx()), await ev('scrollY', await frameCtx()));
await ev("$('#btnRebuild').click()");
await until("!document.documentElement.classList.contains('broken')", 3000);
check('Rebuild gives the article its own overflow back', await ev("!document.body.style.overflowX", await frameCtx()));
await ev("document.body.style.overflowY = ''; scrollTo(0, 0)", await frameCtx());
await ev("scrollTo(0, 0)", await frameCtx());
await ev("holdItem('crystal'); $('.hold').onclick({ clientX: 30, clientY: 30 }); dropItem(); $('.thing.crystal').click()");
check('a broken page takes no clicks but on the hotbar\'s button', await ev(`document.documentElement.classList.contains('broken') && getComputedStyle($('#game')).pointerEvents === 'none'
  && getComputedStyle($('#hudItems')).pointerEvents === 'auto'`));
await ev("$('#btnRebuild').click()");
check('and takes them again once rebuilt', await until("!document.documentElement.classList.contains('broken') && getComputedStyle($('#game')).pointerEvents === 'auto'", 3000));
// The TNT article's easter egg: a blast that reaches its infobox's picture lights it, hissing as long as its fuse (here
// the game's own hiss, the wiki's sounds not being in), and it goes off, bigger, earning Light Reading; on another
// article (egg false) the picture is only a picture.
const tntPic = JSON.parse(await ev(`(() => { document.body.insertAdjacentHTML('afterbegin', '<div class="infobox-imagearea"><img width="150" height="150" alt="" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></div>');
  const r = document.querySelector('.infobox-imagearea img').getBoundingClientRect(); return JSON.stringify({ x: r.left - 30, y: r.top + 20 }); })()`, await frameCtx()));
const boomAt = egg => `$('#frame').contentWindow.postMessage({ mwr: 'boom', x: ${tntPic.x}, y: ${tntPic.y}, power: 1.2, still: false, egg: ${egg} }, '*')`;
await ev("window.hisses = []; window.realNoise = noise; noise = (at, dur, o) => { if (o?.filter === 'highpass') hisses.push(dur); return realNoise(at, dur, o); }");
await ev(boomAt(true)); await sleep(200);
const lit = await ev("!!document.querySelector('img.mwr-lit')", await frameCtx()), hissed = await ev('JSON.stringify([soundOn, hisses])');
check('on the TNT article a blast lights its picture of TNT, which goes off bigger, earning Light Reading', lit
  && await until('!!adv.got.lightReading && items.broken', 3000) && await ev("!document.querySelector('img.mwr-lit')", await frameCtx()));
check('its hiss lasts its fuse', (([on, h]) => on && h.length === 1 && h[0] >= 0.5 && h[0] <= 1.5)(JSON.parse(hissed)), hissed);
await ev('noise = realNoise');
await ev("$('#btnRebuild').click()");
await until("!document.documentElement.classList.contains('broken') && !document.querySelector('#game [data-broke-style]')", 3000); await sleep(1200);
await ev(boomAt(false)); await sleep(200);
check('and on another article the picture is only a picture', await ev("!document.querySelector('img.mwr-lit')", await frameCtx()));
await ev("$('#btnRebuild').click()");
await until("!document.documentElement.classList.contains('broken')", 3000);
await ev("navigate('Diamond Pickaxe', null)");
check('a click to another article takes the blocks on this one with it', await until("game.path.length === 2 && !game.loading") && await ev("![...items.things].some(t => t.kind.startsWith('tnt'))"));
await ev('finish(false)');
check('a game given up lists only its new articles\' XP, or none', await until("!!document.querySelector('#mXp:not(.hidden) .xp')", 5000)
  && await ev("!$('#mXp').textContent.includes('Win') && ($('#mXp').textContent.includes('New articles seen') || $('#mXp').textContent.includes('No XP this time'))"), await ev("$('#mXp').textContent"));
await ev('closeModal(); toSetup()');

// Advancements: a par 3+ pair's first game, won at par from a challenge link, earns the firsts, Par for the Course,
// Accepted and the speed ones, with toasts; the same pair again earns no skill one, nor does a par 1 pair; landing on
// Cake and back on the start earn their secrets once the article shows; the panel, its counts and a count's progress;
// storage only keeping what advancements would write; Clear history leaving them and Reset clearing them.
await ev("['mwr.advancements', 'mwr.history', 'mwr.dailies'].forEach(k => localStorage.removeItem(k))");
const long = JSON.parse(await ev(`(async () => {
  const graph = await linkGraph(['nonav']), usable = routeUsable({ keep: [], rules: ['nonav'] });
  for (const start of POOL_TITLES) {
    const d = distancesFrom(graph, start, usable), goal = POOL_TITLES.find(t => d[PAGE_IDS.get(t)] >= 3);
    if (goal) return JSON.stringify(await parRoute({ start, goal, rules: ['nonav'] }));
  }
  return 'null';
})()`));
check('the snapshot has a pool pair three or more clicks apart on Normal', long?.length >= 4, JSON.stringify(long));
const earnedKeys = "JSON.stringify(Object.keys(adv.got).sort())";
await playRoute(`#start=${encodeURIComponent(long[0])}&target=${encodeURIComponent(long.at(-1))}&rules=nonav`, long);
const firsts = ['accepted', 'firstClick', 'hello', 'par', 'quick', 'speedrunner', ...long.length > 4 ? ['sprinter'] : []];
check('a par 3+ pair\'s first game, won at par from a challenge link, earns the firsts, Par for the Course and the speed ones',
  await until(`${JSON.stringify(firsts)}.every(k => adv.got[k]) && !adv.got.noTakeBacks && adv.wins === 1 && store.get('mwr.advancements').wins === 1`), await ev(earnedKeys));
check('their toasts show over the result, three at a time, the rest waiting', await until("document.querySelectorAll('#advToasts .adv-toast').length === 3")
  && await ev(`advQueue.length === ${firsts.length - 3} && $('#advToasts .adv-toast .t').textContent.endsWith('!')`), await ev("$('#advToasts').textContent"));
check('the arrivals are counted: every visit, the different pages and their topics', await ev(`adv.visits === ${long.length} && adv.pages.size === ${long.length}
  && adv.topics.every(t => WIKI_DATA.topics.includes(t))`), await ev('JSON.stringify([adv.visits, adv.pages.size, adv.topics])'));
await ev("closeModal(); toSetup()");
await playRoute(`#start=${encodeURIComponent(long[0])}&target=${encodeURIComponent(long.at(-1))}&rules=nonav,noback`, long);
await sleep(500);
check('the same pair again earns no skill advancement', await until('adv.wins === 2') && await ev('!adv.got.noTakeBacks'), await ev(earnedKeys));
await ev("closeModal(); toSetup()");
await playRoute('#start=Diamond&target=Diamond%20Pickaxe&rules=nonav,noback', ['Diamond', 'Diamond Pickaxe']);
await sleep(500);
check('nor does a par 1 pair\'s first game', await until('adv.wins === 3') && await ev('game.par === 1 && !adv.got.noTakeBacks'), await ev('game.par'));
await ev("closeModal(); toSetup()");
await open('#start=Diamond&target=Crafting&rules=nonav');
await play();
await ev("navigate('Cake', null)");
check('landing on Cake earns its secret, its toast once the article shows', await until("!game.loading && !!adv.got.cake && $('#advToasts').textContent.includes('The Cake Is Real')"),
  await ev("$('#advToasts').textContent"));
await ev("navigate('Diamond', null)");
check('and clicking back to the start, without Back, Full Circle', await until('!game.loading && !!adv.got.fullCircle'));
await ev('finish(false); closeModal(); toSetup()');
// A personal best: a pair's first win has no note; a win in fewer clicks is a new best, earning Self-Improvement, and
// Recent games' Best tag moves to it; a win in more says the best, which keeps the tag.
const bestPair = '#start=Diamond&target=Crafting&rules=nonav', bestNote = "document.querySelector('#modal .best')?.textContent ?? ''";
const bestTags = "JSON.stringify([...document.querySelectorAll('#history tbody tr')].slice(0, 3).map(tr => !!tr.querySelector('.best-tag')))";
await playRoute(bestPair, ['Diamond', 'Gold Ingot', 'Crafting']);
check('a pair\'s first win has no personal best note', await until('!game.active') && await ev(bestNote) === '' && await ev('!adv.got.selfImprovement'), await ev(bestNote));
await ev('closeModal(); toSetup()');
await playRoute(bestPair, ['Diamond', 'Crafting']);
check('a win in fewer clicks is a new personal best, earning Self-Improvement', await until('!game.active') && await ev(bestNote) === 'New personal best for this game!'
  && await until('!!adv.got.selfImprovement', 3000), await ev(bestNote));
await ev('closeModal(); toSetup()');
check('and Recent games\' Best tag moves to it', await ev(bestTags) === '[true,false,false]', await ev(bestTags));
await playRoute(bestPair, ['Diamond', 'Gold Ingot', 'Iron Ingot', 'Crafting']);
const moreNote = await until('!game.active') && await ev(bestNote);
await ev('closeModal(); toSetup()');
check('a win in more clicks says the best, which keeps the tag', `${moreNote}`.startsWith('Your best for this game: 1 click in ') && await ev(bestTags) === '[false,true,false]',
  `${moreNote} ${await ev(bestTags)}`);
const earnedN = await ev('advEarned()');
check('the button by Recent games counts them', await ev(`$('#advCount').textContent === '${earnedN} / ' + Object.keys(ADVANCEMENTS).length && !$('#btnAdv').closest('.hidden')`), await ev("$('#advCount').textContent"));
await ev("$('#btnAdv').click()");
check('the panel has every one in its group, the earned in gold and the unearned secrets as ???', await ev(`document.querySelectorAll('.adv-tile').length === Object.keys(ADVANCEMENTS).length
  && document.querySelectorAll('.adv-tile.got .adv-frame.got').length === ${earnedN} && document.querySelectorAll('.adv-group').length === Object.keys(ADV_GROUPS).length
  && [...document.querySelectorAll('.adv-tile .label')].filter(l => l.textContent === '???').length === Object.entries(ADVANCEMENTS).filter(([k, a]) => a.secret && !adv.got[k]).length
  && document.querySelector('.adv-tile[data-adv-key=cake]').textContent.includes('The Cake Is Real')`));
await ev("document.querySelector('.adv-tile[data-adv-key=regular]').click()");
check('picking a count shows how far along it is', await ev("$('#aDetail').textContent.includes('Win 10 games.') && adv.wins > 0 && adv.wins < 10 && $('#aDetail').textContent.includes(adv.wins + ' of 10 wins')"),
  await ev("$('#aDetail').textContent.replace(/\\s+/g, ' ')"));
await ev("document.querySelector('.adv-tile[data-adv-key=birdie]').click()");
check('and an unearned secret says nothing of itself', await ev("$('#aDetail').textContent.includes('???') && !$('#aDetail').textContent.includes('Birdie') && !$('#aDetail').textContent.includes('par')"),
  await ev("$('#aDetail').textContent"));
await ev('closeModal()');
await ev("localStorage.setItem('mwr.advancements', JSON.stringify({ got: { hello: 1, nope: 2, par: 'x' }, wins: -1, visits: 4, pages: ['A', 3], topics: ['mobs', 'zz'] }))");
check('stored advancements keep only what would be written', await ev(`(a => JSON.stringify([a.got, a.wins, a.visits, [...a.pages], a.topics]))(savedAdvancements())`)
  === JSON.stringify([{ hello: 1 }, 0, 4, ['A'], ['mobs']]), await ev(`(a => JSON.stringify([a.got, a.wins, a.visits, [...a.pages], a.topics]))(savedAdvancements())`));
check('and XP only as a whole number of none or more', await ev(`[-1, 2.5, 'x', 12].map(xp => (localStorage.setItem('mwr.advancements', JSON.stringify({ xp })), savedAdvancements().xp)).join() === '0,0,0,12'`));
await ev('saveAdv()');   // back to the earned ones
await ev("$('#btnClearHistory').click(); $('#hClear').click()");
check('Clear history leaves them, the heading and the button still there with no table', await ev(`advEarned() === ${earnedN} && savedGames().length === 0
  && !$('#history').classList.contains('hidden') && $('.history-wrap').classList.contains('hidden') && $('#btnClearHistory').classList.contains('hidden')`));
await ev("$('#btnAdv').click()");
check('the panel\'s foot says Clear history keeps them and XP', await ev("document.querySelector('.adv-foot .note').textContent === 'Clear history keeps your advancements and XP. Only Reset advancements clears them.'"),
  await ev("document.querySelector('.adv-foot .note').textContent"));
await ev("$('#aReset').click(); $('#aWipe').click()");
check('Reset advancements forgets them and the counts', await ev(`advEarned() === 0 && adv.wins === 0 && adv.xp === 0 && adv.pages.size === 0 && JSON.stringify(store.get('mwr.advancements').got) === '{}'
  && $('#advCount').textContent.startsWith('0 / ') && document.querySelectorAll('.adv-tile.got').length === 0 && $('#history').classList.contains('hidden')`));
await ev('closeModal()');

// The background: its settings and their defaults, Roll by itself turning off at a change on the page but not in its
// own box, the cards marked with the route only as a spoiler and nothing past the start under Blind target, the facts
// line, Off, play, Reduce motion (beside Timer), and Auto's map at a phone's width.
await ev("localStorage.removeItem('mwr.background'), localStorage.removeItem('mwr.reduceMotion')");
await open('#start=Diamond&target=Crafting');
check('the background is on by default: Auto, Roll by itself, the rest off, and its box says so', await ev(`JSON.stringify(bgSet) === '{"style":"auto","wave":false,"route":false,"roll":true}'
  && $('#bgStyle').value === 'auto' && $('#bgRoll').checked && !$('#bgWave').checked && !$('#bgRoute').checked && !$('#motionToggle').checked && !document.documentElement.classList.contains('calm')`), await ev('JSON.stringify(bgSet)'));
check('Auto is the constellation on a wide screen, drawn with the facts line shown', await ev("bgStyle() === 'constellation' && !$('#bgCanvas').hidden && !$('#bgFacts').hidden")
  && await until("!!bg.sky && bg.sky.nodes.length === WIKI_DATA.topics.length * 64"));
check('the sky is laid out the same every time', await ev("JSON.stringify(buildSky(bg.links).nodes.map(n => [n.x, n.y])) === JSON.stringify(bg.sky.nodes.map(n => [n.x, n.y]))"));
check('the facts line starts with the snapshot\'s pages, and gets how far apart articles are on the difficulty', await ev(`bg.facts[0].includes(fmtCount(WIKI_DATA.articles.length)) && bg.facts[0].includes(WIKI_DATA.snapshot)`)
  && await until("bg.sampled.has(level()) && bg.facts.some(f => f.startsWith('On ' + LEVELS[level()].label))", 30000), await ev('bg.facts.at(-1)'));
check('Roll by itself marks pairs of its own', await until("!!bg.pair && bg.pair.stops.length === 2 && !bg.pair.stops[0].label.startsWith('Start')"), await ev('JSON.stringify(bg.pair?.stops)'));
await ev("$('#bgWave').click()");
check('a change in the Background box leaves it on', await ev("bgSet.roll && bgSet.wave && store.get('mwr.background').wave === true"));
check('so does Reduce motion, which is saved and stops the effects', await ev(`($('#motionToggle').click(), effect('win', { x: 100, y: 100 }), bgSet.roll && fx.parts.length === 0
  && store.get('mwr.reduceMotion') === true && document.documentElement.classList.contains('calm'))`));
check('and lets them play again unticked', await ev(`($('#motionToggle').click(), effect('puff', { x: 100, y: 100 }), bgSet.roll && fx.parts.length === 7
  && store.get('mwr.reduceMotion') === false && !document.documentElement.classList.contains('calm'))`));
// Reduce motion ticked and unticked while a roll waits for the graph leaves it rolling pairs of its own (ticked, it
// marks the cards meanwhile).
await ev("window.pairBefore = bg.pair; bg.nextRoll = Infinity; bgRoll(); setCalm(true); setCalm(false)");
check('Reduce motion ticked and unticked while it rolls leaves it rolling', await until("bg.pair !== pairBefore && bg.pair.stops.length === 2 && !bg.pair.stops[0].label.startsWith('Start')", 5000),
  await ev('JSON.stringify([bg.nextRoll, bg.pair === pairBefore])'));
await ev("$('#btnRerollAll').click()");
check('a change on the page turns it off, saved, and the cards are marked', await until(`${ready} && !bgSet.roll && store.get('mwr.background').roll === false
  && bg.pair?.stops[0].label === 'Start · ' + setup.start.title && bg.pair.stops[1].label === 'Target · ' + setup.goal.title`), await ev('JSON.stringify(bg.pair?.stops)'));
check('the wave counts clicks from the start as par does', await until("!!bg.pair?.wave") && await ev(`linkGraph(rules()).then(g => (d => bg.pair.wave.dist.every((x, i) => x === d[i]))(distancesFrom(g, setup.start.title)))`));
check('the route only shows as a spoiler', await ev('bg.pair.route === null') && await ev("$('#bgRoute').click(), true")
  && await until("JSON.stringify(bg.pair?.route) === JSON.stringify(setup.route.map(t => PAGE_IDS.get(t)))"));
await ev("document.querySelector('#rules input[value=blind]').click()");
check('under Blind target only the start is marked, with no route, and the facts leave the target out', await until("bg.pair?.stops.length === 1 && bg.pair.stops[0].start && bg.pair.route === null && !!bg.pair.wave")
  && await until("bg.pairFacts.length === 2"), await ev('JSON.stringify(bg.pairFacts)'));
await ev("document.querySelector('#rules input[value=blind]').click()");
await until(ready);
await ev("localStorage.setItem('mwr.background', JSON.stringify({ style: 'redstone', wave: true, route: false, roll: false, junk: 1 })), localStorage.setItem('mwr.reduceMotion', 'true')");
await open('#start=Diamond&target=Crafting');
check('the settings load on a visit, and the box shows them', await ev(`JSON.stringify(bgSet) === '{"style":"redstone","wave":true,"route":false,"roll":false}'
  && $('#bgStyle').value === 'redstone' && $('#bgWave').checked && !$('#bgRoll').checked && $('#motionToggle').checked && document.documentElement.classList.contains('calm')`), await ev('JSON.stringify(bgSet)'));
check('reduce motion draws a still frame: no animation, the wave already passed', await until("!!bg.pair?.wave && !!bg.grid") && await ev("bg.raf === 0 && waveLight(bg.pair.wave, PAGE_IDS.get('Crafting'), 0) !== null"));
await play();
check('the background hides while you play', await ev("$('#bgCanvas').hidden && !bgLive()"));
await ev('toSetup()');
check('and comes back on the setup screen', await ev("!$('#bgCanvas').hidden && bgLive()"));
await ev("$('#bgStyle').value = 'off', $('#bgStyle').dispatchEvent(new Event('change'))");
check('Off hides the background and the facts line', await ev("$('#bgCanvas').hidden && $('#bgFacts').hidden && store.get('mwr.background').style === 'off'"));
await ev("bgSetting('style', 'auto'), setCalm(false)");
// Effects unticked stops the game's effects, not the items'; Reduce motion holds it unticked.
check('Effects unticked stops the game\'s effects but not the items\', and is saved', await ev(`($('#effectsToggle').click(), fx.parts = [], effect('burst', { x: 100, y: 100 }), effect('win', { x: 100, y: 100 }),
  fx.parts.length === 0 && store.get('mwr.effects') === false && (effect('poof', { x: 100, y: 100, colours: ['#ffffff'] }), fx.parts.length === 14))`));
check('Reduce motion holds it unticked, and back off leaves it as it was', await ev(`(() => { $('#effectsToggle').click(); setCalm(true); const held = $('#effectsToggle').disabled && !$('#effectsToggle').checked;
  setCalm(false); return held && $('#effectsToggle').checked && !$('#effectsToggle').disabled && store.get('mwr.effects') === true; })()`));
await ev('fx.parts = []');
check('with motion reduced a moving picture of the game\'s is caught to be stilled, and put back after', await ev(`(async () => {
  setCalm(true); const img = Object.assign(new Image(), { src: 'https://minecraft.wiki/images/Chest.gif' }); $('#cardStart').append(img);
  await new Promise(r => setTimeout(r, 50)); const caught = img.dataset.moving === img.src;
  setCalm(false); const back = img.getAttribute('src') === 'https://minecraft.wiki/images/Chest.gif' && !('moving' in img.dataset); img.remove(); return caught && back; })()`));
// The note block: a pick is saved and is what a click and Back play, a head its mob once at its own pitch; Nothing takes
// the head off; what is saved is kept only if it is a block and a head.
const notes = await ev(`(() => {
  const heard = [], was = sample; sample = (b, rate) => heard.push(b + ' ' + rate.toFixed(3));
  soundBank.set('bell', ['bell']); soundBank.set('zombieHead', ['zombie']); soundBank.set('creeperHead', ['creeper']);
  $('#btnNotes').click(); const slot = k => document.querySelector('.note-box [data-k="' + k + '"]');
  const foot = document.querySelector('.nb-foot').textContent === 'Links play it as you click them, a step up the scale each time; Back plays two notes going down, or a mob head’s sound once.';
  slot('bell').click(); heard.length = 0; SOUNDS.click(1); SOUNDS.back(); const bell = heard.join();
  const saved = JSON.stringify(store.get('mwr.noteBlock'));
  slot('zombie').click(); heard.length = 0; SOUNDS.click(3); SOUNDS.back(); const zombie = heard.join();
  const shown = document.querySelector('.nb-what').textContent.startsWith('Zombie Head') && document.querySelector('.nb-slots.unders.off') !== null;
  slot('creeper').click(); heard.length = 0; SOUNDS.click(0); const creeper = heard.join();
  slot('').click(); const off = noteBlock.head === null && document.querySelector('.nb-stage .head').classList.contains('hidden') && !document.querySelector('.nb-slots.unders.off');
  const sizes = new Set([...document.querySelectorAll('.note-box .nb-slots button')].map(b => (b.click(),
    [document.querySelector('.note-box').offsetHeight, document.querySelector('.unders').offsetTop, document.querySelector('.nb-what').scrollHeight <= document.querySelector('.nb-what').clientHeight].join())));
  slot('harp').click(); sample = was; ['bell', 'zombieHead', 'creeperHead'].forEach(k => soundBank.delete(k));
  document.body.click(); const closed = !document.querySelector('.note-box') && $('#btnNotes').getAttribute('aria-expanded') === 'false';
  return bell === 'bell 1.122,bell 1.335,bell 1.000' && saved === '{"under":"bell","head":null}' && zombie === 'zombie 1.000,zombie 1.000' && creeper === 'creeper 1.000'
    && shown && off && sizes.size === 1 && [...sizes][0].endsWith('true') && closed && foot || JSON.stringify([bell, saved, zombie, creeper, shown, off, [...sizes], closed, foot]);
})()`);
check('the note block picks what clicks and Back play, and a mob head on top plays its mob once, at its own pitch, as its foot says', notes === true, notes);
// A click's sparks take its note's colour (none for a mob head); Sound of Music is every instrument heard, counted, and
// the count is kept only for instruments.
check('a click\'s sparks are its note\'s colour, and with a mob head the game\'s own', await ev(`(() => {
  fx.parts = []; effect('orbs', { x: 100, y: 100, colors: [noteColor(scaleNote(1))] }); const one = [...new Set(fx.parts.map(p => p.color))].join();
  noteBlock.head = 'zombie'; const none = noteColor(0); noteBlock.head = null; fx.parts = [];
  return one === '#0606FF' && none === null; })()`));
const music = await ev(`(() => {
  const was = sample, under = noteBlock.under; sample = () => {}; adv.instruments.clear(); delete adv.got.soundOfMusic;
  const keys = Object.keys(NOTE_UNDER);
  for (const k of keys.slice(0, -1)) { soundBank.set(k, ['x']); noteBlock.under = k; note(0); note(0); }
  const before = !adv.got.soundOfMusic && advTally('instruments') === keys.length - 1;
  soundBank.set(keys.at(-1), ['x']); noteBlock.under = keys.at(-1); note(0);
  const after = !!adv.got.soundOfMusic && store.get('mwr.advancements').instruments.length === keys.length;
  keys.forEach(k => soundBank.delete(k)); noteBlock.under = under; sample = was;
  const s = store.get('mwr.advancements'); store.set('mwr.advancements', { ...s, instruments: ['bell', 'bell', 'steve', 7] });
  const kept = [...savedAdvancements().instruments].join(); store.set('mwr.advancements', s);
  return keys.length === 20 && before && after && kept === 'bell' || JSON.stringify([keys.length, before, after, kept]);
})()`);
check('Sound of Music is earned on hearing the 20th instrument, and only instruments are kept toward it', music === true, music);
check('a saved note block that isn\'t one is the harp with nothing on top', await ev(`[noteChoice({ under: 'bedrock', head: 'steve' }), noteChoice('x'), noteChoice({ under: 'bell', head: 'dragon' })].map(c => c.under + ' ' + c.head).join() === 'harp null,harp null,bell dragon'`));
check('with Sound off no sound is fetched', await ev("(() => { const was = soundOn; setSound(false); soundsAsked.clear(); play('click', 0); loadSounds(ITEM_SOUNDS); const none = soundsAsked.size === 0; setSound(was); return none; })()"));
await send('browsingContext.setViewport', { context: ctx, viewport: { width: 390, height: 844 } });
check('Auto is the redstone map at a phone\'s width', await until("bgStyle() === 'redstone' && bg.W <= 390 && bg.grid?.W === bg.W"), await ev('JSON.stringify([bgStyle(), bg.W, bg.grid?.W])'));
await send('browsingContext.setViewport', { context: ctx, viewport: null });
check('and the constellation again on a wide screen', await until("bgStyle() === 'constellation'"));
// The cursor (a mouse, by the pointer events' type): stars near it make way and the nearest is named,
// a touch does nothing, leaving the window takes it away, and on the map a torch lights the blocks around it, warmer (on a
// light theme the torch's orange is darker than the blocks, so it is told by how much redder than blue a block is).
const move = (x, y, type = 'mouse') => ev(`document.dispatchEvent(new PointerEvent('pointermove', { clientX: ${x}, clientY: ${y}, pointerType: '${type}', bubbles: true })), true`);
await until('!!bg.sky');
const star = JSON.parse(await ev("JSON.stringify((P => P.map((p, i) => [i, ...p]).find(([, x, y]) => x > 20 && x < innerWidth - 20 && y > 20 && y < innerHeight - 20))(bg.sky.nodes.map(n => skyStar(n, bgNow()))))"));
await move(star[1] + 200, star[2], 'touch');
check('a touch doesn\'t move the stars', await ev('!bg.cursor.in'));
await move(star[1] + 12, star[2] + 8);
check('the stars near the cursor make way, and the nearest is named', await until(`bg.sky.nodes[${star[0]}].lit > .5 && Math.hypot(bg.sky.nodes[${star[0]}].lx, bg.sky.nodes[${star[0]}].ly) > 5`),
  await ev(`JSON.stringify(bg.sky.nodes[${star[0]}])`));
// A star has one name at a time: hovering a card's star names it only by its marker, over a couple of frames.
const card = JSON.parse(await ev(`JSON.stringify((P => (bg.pair?.stops ?? []).map(st => bg.sky.at.get(st.page)).filter(i => i !== undefined)
  .map(i => [i, ...P[i]]).find(([, x, y]) => x > 20 && x < innerWidth - 20 && y > 40 && y < innerHeight - 20))(bg.sky.nodes.map(n => skyStar(n, bgNow()))) ?? null)`));
if (card) await move(card[1] + 6, card[2] + 4);
const cardNames = card && await until(`bg.sky.nodes[${card[0]}].lit > .5`) && JSON.parse(await ev(`new Promise(done => {
  const name = WIKI_DATA.articles[bg.sky.nodes[${card[0]}].page][0], seen = [], fill = bgCtx.fillText;
  bgCtx.fillText = function (text, ...a) { if (text === name || text.endsWith(' · ' + name)) seen.push(text); return fill.call(this, text, ...a); };
  setTimeout(() => { delete bgCtx.fillText; done(JSON.stringify(seen)); }, 300);
})`));
check('hovering a card\'s star leaves its marker\'s label its only name', !!cardNames?.length && cardNames.every(t => t.includes(' · ')), JSON.stringify(cardNames));
await ev("document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null })), true");
check('leaving the window puts them back', await until(`bg.glow < .02 && bg.sky.nodes[${star[0]}].lit < .02 && Math.hypot(bg.sky.nodes[${star[0]}].lx, bg.sky.nodes[${star[0]}].ly) < 1`));
await ev("bgSetting('style', 'redstone'), bgSetting('wave', false)");   // no wave lighting the blocks meanwhile
const corner = "(() => { const d = bg.dpr, p = bgCtx.getImageData(Math.round((innerWidth - 40) * d), Math.round((innerHeight - 40) * d), 1, 1).data; return p[0] - p[2]; })()";
await until('!!bg.grid');
const cold = await ev(corner);
await move('innerWidth - 40', 'innerHeight - 40');
check('on the map a torch lights the blocks around the cursor', await until('bg.glow > .95') && await ev(corner) > cold + 30, `${cold} → ${await ev(corner)}`);
await ev("setCalm(true)");
await move('innerWidth - 40', 'innerHeight - 40');
await ev('bgDraw(), true');   // a still frame drawn with the cursor in
check('reduce motion leaves the cursor alone', await ev(`bg.glow === 0 && ${corner} < ${cold} + 30`), await ev(`JSON.stringify([bg.glow, ${corner}, ${cold}])`));
await ev("setCalm(false), bgSetting('style', 'auto'), document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }))");
// Background only: the corner button hides the setup screen but the Background box (open), the facts line and itself,
// with the picture stronger, and doesn't turn Roll by itself off; Escape or the button brings the screen back, and Off
// leaves it and hides the button.
const seen = sel => `$('${sel}').checkVisibility({ visibilityProperty: true })`;
await ev("bgSetting('roll', true), $('#btnBgView').click()");
check('the corner button shows only the background, with its box open and stronger, and says it goes back to the setup screen', await ev(`bgViewing() && $('#bgOpts').open && bgSet.roll
  && $('#btnBgView').title === 'Back to the setup screen (Esc)' && $('#btnBgView').getAttribute('aria-label') === $('#btnBgView').title
  && !${seen('#btnPlay')} && !${seen('#cardStart')} && ${seen('#bgStyle')} && ${seen('#btnBgView')} && ${seen('#bgFacts')}
  && bg.colors.strength > parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--viz-opacity'))`));
await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
check('Escape brings the setup screen back', await ev(`!bgViewing() && ${seen('#btnPlay')} && !$('#bgOpts').open && bgSet.roll`));
await ev("$('#btnBgView').click(), $('#btnBgView').click()");
check('and so does the button', await ev(`!bgViewing() && ${seen('#btnPlay')}`));
await ev("$('#btnBgView').click(), $('#bgStyle').value = 'off', $('#bgStyle').dispatchEvent(new Event('change'))");
check('Off leaves it and hides the button', await ev("!bgViewing() && $('#btnBgView').hidden"));
await ev("bgSetting('style', 'auto'), bgSetting('roll', false)");

// The setup screen holds still: what was clicked stays where it is in the window while the cards above it roll and the
// help changes, at the bottom of the page too (the history hidden, so Articles' help, which gets shorter, is near it), and
// a click on a rule's text doesn't scroll to its box when the box is above the window. Scrolling the page lets go.
// holdsStill: the most a choice in Articles clicked at the bottom of the page moves as drawn until the cards are in,
// measured whenever something on the screen changes size, by an observer made after the game's, so it sees each change
// as the game left it.
const holdsStill = async value => {
  const label = `$('input[name=mode][value=${value}]').parentElement`;
  await ev(`(() => { scrollTo(0, 1e6); const t = ${label}.getBoundingClientRect().top;
    window.drift = 0; window.drifts = new ResizeObserver(() => { window.drift = Math.max(window.drift, Math.abs(${label}.getBoundingClientRect().top - t)); });
    document.querySelectorAll('#setup > *, .game-settings > *, #settings > *, #setup .card').forEach(el => window.drifts.observe(el));
    ${label}.click(); })()`);
  await sleep(100);
  await until(ready);
  await sleep(300);
  const drift = await ev('window.drifts.disconnect(), window.drift');
  return [drift < 1, `moved up to ${drift}px`];
};
await ev("$('#history').classList.add('hidden'), $('input[name=mode][value=everyday]').click()");
await until(ready);
check('a click on the setup screen holds what was clicked still, at the bottom of the page where the help under it gets shorter', ...await holdsStill('deep'));
const ruleAt = JSON.parse(await ev(`(() => { const l = $('input.rule[value=noback]').parentElement; scrollBy(0, l.getBoundingClientRect().top + 30);
  const r = l.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 10), scroll: scrollY }); })()`));
await send('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
  actions: [{ type: 'pointerMove', x: ruleAt.x, y: ruleAt.y }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
await sleep(300);
check('a click on a rule whose box is above the window doesn\'t scroll to the box', await ev(`$('input.rule[value=noback]').checked && Math.abs(scrollY - ${ruleAt.scroll}) < 1`),
  await ev(`JSON.stringify([$('input.rule[value=noback]').checked, ${ruleAt.scroll}, scrollY])`));
await ev("$('input.rule[value=noback]').click()");
await send('input.performActions', { context: ctx, actions: [{ type: 'wheel', id: 'wheel', actions: [{ type: 'scroll', x: 200, y: 400, deltaX: 0, deltaY: -300 }] }] });
check('scrolling lets go', await until("!keep && !$('#setup').classList.contains('keeping')"));
await ev('renderHistory()');

// A live link pressed with the mouse is asked for at the press, and its click takes that request rather than making
// another; one pressed and let go elsewhere is still asked for once when it is clicked later.
await open('#start=Diamond&target=Crafting');
await play();
const framePoint = async href => JSON.parse(await ev(`(() => { const r = document.querySelector('a[href="${href}"]').getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`, await frameCtx()));
const pointer = actions => send('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }] });
const frameAt = JSON.parse(await ev("(r => JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }))($('#frame').getBoundingClientRect())"));
const parses = () => requests.get('parse prop=text|displaytitle|categories|links') ?? 0;
let before = parses(), at = await framePoint('/w/Diamond_Pickaxe');
await pointer([{ type: 'pointerMove', x: frameAt.x + at.x, y: frameAt.y + at.y }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 120 }, { type: 'pointerUp', button: 0 }]);
check('a link pressed and clicked is asked for once, at the press, and arrives', await until("game.path.length === 2 && !game.loading") && parses() - before === 1,
  JSON.stringify([parses() - before, await ev('game.path.map(p => p.title).join()')]));
before = parses(); at = await framePoint('/w/Gold_Ingot');
await pointer([{ type: 'pointerMove', x: frameAt.x + at.x, y: frameAt.y + at.y }, { type: 'pointerDown', button: 0 }, { type: 'pointerMove', x: 5, y: 5, duration: 50 }, { type: 'pointerUp', button: 0 }]);
await sleep(300);
const pressedOnly = parses() - before;
await ev(`document.querySelector('a[href="/w/Gold_Ingot"]').click()`, await frameCtx());
check('one pressed and let go elsewhere is asked for at the press, and its later click asks no more', await until("game.path.length === 3 && !game.loading")
  && pressedOnly === 1 && parses() - before === 1, JSON.stringify([pressedOnly, parses() - before]));
await ev('closeModal(); toSetup()');

// Injection: a link can carry any text, so a sealed one whose titles are markup and script, with a junk kind (sealing
// leaves its junk rules and back out), is played through every place a title shows (cards, header, path, a frame link,
// the banner, the peek, the result, the history). The made-up wiki takes the titles as real pages, which the live one never would, so it is the stricter
// test. Nothing may run, add an element, or throw.
const payloads = ['<img src=x onerror="window.pwned=1">', '"><svg onload="window.pwned=2">', '</script><script>window.pwned=3</script>'];
const injected = "window.pwned === undefined && !document.querySelector('[onerror], [onload], svg')";
await open('#g=' + await ev(`sealLink(${JSON.stringify(`start=${encodeURIComponent(payloads[0])}&via=${encodeURIComponent(payloads[1])}&target=${encodeURIComponent(payloads[2])}`
  + `&start=Diamond&kind=${encodeURIComponent('<b>')}&back=1e999&rules=${encodeURIComponent('checkpoint,<img src=x onerror=window.pwned=4>,__proto__')}`)})`));
check('a link of markup titles loads them as text, with its junk rules left out', await ev(`setup.start.title === ${JSON.stringify(payloads[0])}
  && setup.goal.title === ${JSON.stringify(payloads[2])} && rules().join() === 'checkpoint' && ${injected}`), await ev('rules().join()'));
await play();
await ev(`document.querySelector('a[href="/w/Diamond_Pickaxe"]').click()`, await frameCtx());
await until("game.path.length === 2 && !game.loading");
await ev(`navigate(${JSON.stringify(payloads[1])}, null)`);
await until("game.viaNext === 1 && !game.loading");
await ev("document.querySelector('#btnPeek').click()");
const peeked = await ev(injected);
check('the peek at a checkpoint goes back to the article', await ev("document.querySelector('#pClose').textContent === 'Back to the article'"));
await ev(`closeModal(); navigate(${JSON.stringify(payloads[2])}, null)`);
await until("!document.querySelector('#modalBg').classList.contains('hidden') && !!document.querySelector('.result')");
const frameClean = await ev(injected, await frameCtx());
await ev('closeModal(); toSetup()');
check('markup titles run nothing anywhere a title shows', peeked === true && frameClean === true && await ev(injected)
  && await ev(`document.querySelector('#history tbody').textContent.includes(${JSON.stringify(payloads[2])})`), JSON.stringify([peeked, frameClean]));

check('only page info, the advancements\' and items\' pictures and articles are asked for', [...requests.keys()].every(k => ['query prop=pageprops|pageimages|extracts', 'query prop=pageimages', 'query prop=imageinfo', 'parse prop=text|displaytitle|categories|links'].includes(k)),
  JSON.stringify(Object.fromEntries(requests)));
check('no uncaught errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
