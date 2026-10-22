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
const nsOf = title => SPINOFFS[Object.keys(SPINOFFS).find(n => title.startsWith(n + ':'))] ?? 0;

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
// Tutorial and to a Dungeons page, to a version page, to a redirect to one and to a list page, and one link in a navbox.
// Hubs Only, which isn't in the snapshot, links only two hubs (as Bee Our Guest does on the wiki), so on Hard nothing on
// it works.
const HUBS_ONLY = 'Hubs Only';
const ARTICLE = title => title === HUBS_ONLY
  ? `<div class="mw-parser-output"><p>${HUBS.slice(0, 2).map(h => `<a href="/w/${encodeURIComponent(h.replace(/ /g, '_'))}">${escHtml(h)}</a>`).join(' and ')}.</p></div>` : `<div class="mw-parser-output"><p>${escHtml(title)}: <a href="/w/Diamond_Pickaxe">pickaxe</a> <a href="/w/Block">Block</a>
  <a href="/w/Blocks">Blocks</a> <a href="/w/Crafting">Crafting</a> <a href="/w/Tutorial:Mining">tutorial</a> <a href="/w/Dungeons:Creeper">dungeons</a>
  <a href="/w/Java_Edition_version_history">versions</a> <a href="/w/Pocket_Edition_version_history">old versions</a>
  <a href="/w/Closed_captions">captions</a></p>
  <table class="navbox"><tr><td><a href="/w/Creeper">Creeper</a></td></tr></table></div>`;
// The live categories a parse reply gives, as the API writes them: Brand New Mob is only in the live wiki's Nether mobs,
// and Chicken is in it too but excluded from the kind.
const REACH_LABEL = { p1: 'Par 1', p2: 'Par 2', p3: 'Par 3', p4: 'Par 4', p5: 'Par 5+' };
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
    const t = p.get('page');
    return reply(request, JSON.stringify({ parse: { title: t, displaytitle: escHtml(t), text: ARTICLE(t),
      categories: (LIVE_CATEGORIES[t] ?? []).map(category => ({ sortkey: '', category })) } }));
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
  return until('game.path.length === 1 && !game.loading');
};

// Links by difficulty. A challenge link without rules is Relaxed: everything but other namespaces and the left-out pages
// is live. No hubs alone (from an older link) is Hard: hubs and redirects to them are dead, the target hub stays live,
// and so are navboxes' links.
check('the data loads', await open('#start=Diamond&target=Crafting') && await ev("WIKI_DATA.snapshot.length === 10 && POOL.size === 5"));
check('the footer names the offline copy\'s date and links where it comes from', await ev(`$('#wikiCopyDate').textContent === WIKI_DATA.snapshot && $('#wikiCopy a').href === 'https://minecraft.wiki/w/Minecraft_Wiki:Offline_use'`));
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
check('a left-out page typed in isn’t taken', await until("setup.busy === 0 && document.querySelector('#setupStatus').textContent === 'No article named “Java Edition version history” on minecraft.wiki.'")
  && await ev("setup.start.title === 'Diamond'"), await ev("document.querySelector('#setupStatus').textContent"));
await play();
let links = await linkStates();
const leftOut = "['Java_Edition_version_history', 'Pocket_Edition_version_history', 'Closed_captions'].every(t => document.querySelector(`a[href='/w/${t}']`).title === 'Off limits: a version or list page')";
check('Relaxed: hubs and navboxes live, other namespaces, version and list pages and redirects to them dead', links.Block === 'live' && links.Creeper === 'live'
  && links['Tutorial:Mining'] === 'dead' && links['Dungeons:Creeper'] === 'dead' && links.Java_Edition_version_history === 'dead'
  && links.Pocket_Edition_version_history === 'dead' && links.Closed_captions === 'dead' && await ev(leftOut, await frameCtx()), JSON.stringify(links));
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
  && links.Crafting === 'live' && links.Diamond_Pickaxe === 'live' && await ev("document.querySelector('a[href=\"/w/Block\"]').title === 'Off limits: No hubs'", await frameCtx())
  && await ev("HUB_TITLES.get('Crafting') === 'Crafting'"), JSON.stringify(links));   // else Crafting live would test nothing
await ev('finish(false)');
const shortest = "[...document.querySelectorAll('#mBest li')].map(li => li.textContent).join(' → ')";
check('the result shows par and a shortest route beside your path', await until(`/^Shortest route · par \\d+$/.test(document.querySelector('#mBestTitle').textContent)
  && /^Diamond → .*Crafting$/.test(${shortest}) && document.querySelector('#par').textContent.startsWith('Going by the wiki’s copy from ')`),
  await ev(shortest));
// Share copies the game, its result, the path and a link that plays it; Copy challenge link that link alone.
const shared = "shareText(savedGames()[0], game.link)";
check('Share gives the game, the result, the path and the game\'s link', await ev(`(t => document.querySelector('#mShare') && document.querySelector('#mLink')
  && t.startsWith('MC Wiki Race\\nRace · Distance · Hard\\nDiamond → Crafting\\n❌ Gave up after ') && t.includes('\\nMy path: Diamond\\n') && t.endsWith('\\nPlay it: ' + game.link)
  && openLink(new URL(game.link).hash.slice(3)) === 'start=Diamond&target=Crafting&rules=nohubs,nonav,distance')(${shared})`), await ev(shared));
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
await ev(`navigate(${JSON.stringify(far[1])}, null)`);
check('Distance: a step along a shortest route is a click closer, in the header and on the path', await until(`game.path.at(-1).togo === ${farPar - 1} && !game.loading`) &&
  await ev(`${hudHint}.textContent === clicksText(${farPar - 1}) + ' to go' && document.querySelector('#pathList li.cur').textContent.endsWith(' ${farPar - 1} to go')`), far.join(' → '));
await ev(`navigate(${JSON.stringify(far[0])}, null)`);
check('Distance: going back is a click further', await until(`game.path.at(-1).togo === ${farPar} && !game.loading`), await ev('game.path.at(-1).togo'));
// A dead end, a page with no route anywhere (no links outside navboxes, no navboxes), has no route.
const deadEnd = await ev(`linkGraph(true).then(g => WIKI_DATA.articles.map(([t]) => t).find(t => !spinoffOf(t) && !g.links[PAGE_IDS.get(t)].length && !g.carries[PAGE_IDS.get(t)].length))`);
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
check('and how many got no closer, in a line', await ev("document.querySelector('#mPathSum').textContent === '2 of your 4 clicks got no closer.'"),
  await ev("document.querySelector('#mPathSum').textContent"));
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
// A game along a shortest route: every click got closer.
await open(`#start=${encodeURIComponent(far[0])}&target=Crafting`);
await play();
await ev(`navigate(${JSON.stringify(far[1])}, null)`);
await until('game.path.length === 2 && !game.loading');
await ev('finish(false)');
check('a path where every click got closer says so', await until("document.querySelector('#mPathSum').textContent === 'Every click got closer.'"),
  await ev("document.querySelector('#mPathSum').textContent"));
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
check('reaching the first checkpoint names the second', await ev(`game.path[2].via === 1 && ${toast} === '✓ Checkpoint 1 of 2 reached! Now find Zombie'`) &&
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
check('reaching the last checkpoint names the target', await ev(`game.path[4].via === 2 && ${toast} === '✓ Checkpoint 2 of 2 reached! Now find Crafting'`) &&
  await ev(hud) === 'Target Crafting', await ev(toast));
const relayPar = await ev("parRoute({ start: 'Diamond', vias: ['Creeper', 'Zombie'], goal: 'Crafting', rules: [] }).then(r => r.length - 1)");
await ev("navigate('Crafting', null)");
check('the relay is won and recorded with both checkpoints, par over the whole chain', await until('!game.active') &&
  await ev(`(r => r.won && r.vias.join() === 'Creeper,Zombie' && r.par === ${relayPar})(store.get('mwr.history', [])[0])`), `par ${relayPar}`);
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
check('reaching the target turns back: the banner, the HUD, Back starting again', await ev(`${toast} === '✓ Target reached! Now head back to Diamond'
  && game.stack.join() === 'Zombie' && document.querySelector('#btnBack').disabled && game.path[2].via === 1`) && await ev(hud) === 'Back to Diamond', await ev(toast));
const liveLinks = async () => JSON.parse(await ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.classList.contains('mwr-live')])))`, await frameCtx()));
let rtLinks = await liveLinks();
check('the way there is dead, other links live', rtLinks['/w/Crafting'] === false && rtLinks['/w/Diamond_Pickaxe'] === true, JSON.stringify(rtLinks));
await ev("navigate('Diamond Pickaxe', null)");
await until('game.path.length === 4 && !game.loading');
check('Back works again on the way back', await ev("!document.querySelector('#btnBack').disabled"));
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
check('the first checkpoint names the target', await ev(`${toast} === '✓ Checkpoint 1 of 2 reached! Now find Crafting'`) && await ev(hud) === 'Target Crafting', await ev(toast));
await ev("navigate('Zombie', null)");
await until('game.path.length === 3 && !game.loading');
await ev("navigate('Crafting', null)");
await until('game.path.length === 4 && !game.loading');
check('the target names the checkpoint of the way back, which stays live', await ev(`${toast} === '✓ Target reached! Now find Zombie'
  && game.path[3].via === 2 && game.dead.has('Creeper') && game.dead.has('Crafting') && !game.dead.has('Zombie') && !game.dead.has('Diamond')`)
  && await ev(hud) === 'Checkpoint 2 Zombie' && (await liveLinks())['/w/Creeper'] === false, await ev(toast));
await ev("navigate('Zombie', null)");
await until('game.path.length === 5 && !game.loading');
check('the last checkpoint heads home', await ev(`${toast} === '✓ Checkpoint 2 of 2 reached! Now head back to Diamond'
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
check('a daily\'s share links its day and names only its start', await ev(`(t => game.link.endsWith('#daily=${blindDay}') && t.startsWith('MC Wiki Race · Daily ${blindDay}\\n')
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
for (const [i, t] of ['Creeper', 'Zombie', 'Crafting'].entries()) {
  await ev(`navigate('${t}', null)`);
  await until(`game.path.length === ${i + 2} && !game.loading`);
}
check('the last find heads home', await ev(`game.active && ${toast} === '✓ Found Crafting (3 of 3)! Now head back to Diamond' && game.dead.has('Creeper')`)
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
  const par = (await cardsRoute(['Diamond', 'Zombie'], rules())).length - 1, g = await linkGraph(true), id = t => PAGE_IDS.get(t);
  const step = (a, b) => g.links[id(a)].includes(id(b)) || g.carries[id(a)].some(x => g.boxes[x].includes(id(b)));
  return JSON.stringify({ par, route: setup.exact, ok: !!setup.exact && setup.exact.length - 1 === par + 2 && new Set(setup.exact).size === setup.exact.length
    && setup.exact[0] === 'Diamond' && setup.exact.at(-1) === 'Zombie' && setup.exact.every((t, i) => i === 0 || step(setup.exact[i - 1], t)) });
})()`));
check('Exact clicks: setup finds a route of exactly par + 2 on no page twice, and shows the count', await until(ready) && exact.ok &&
  await ev(`document.querySelector('#setupPar').textContent === 'Par ${exact.par} · exactly ${exact.par + 2}'`), exact.route?.join(' → '));
const n = exact.par + 2;
await play();
check('the header counts toward it and Back is gone', await ev(`document.querySelector('#hudClicks').textContent === '0' && document.querySelector('#hudClicksK').textContent === 'of exactly ${n}' && document.querySelectorAll('#hudMeter i').length === ${n} && document.querySelector('#btnBack').classList.contains('hidden')`));
await ev("navigate('Crafting', null)");
await until('game.path.length === 2 && !game.loading');
rtLinks = await liveLinks();
check('visited pages are dead links', rtLinks['/w/Crafting'] === false && rtLinks['/w/Diamond_Pickaxe'] === true, JSON.stringify(rtLinks));
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
  && await ev("!document.querySelector('#mPath .worse') && !document.querySelector('#mPathNote').textContent.includes('red') && !document.querySelector('#mPathSum').textContent"),
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
check('running out loses: Out of clicks', await until('!game.active') && await ev("store.get('mwr.history', [])[0].outOfClicks === true && document.querySelector('#modal h2').textContent === 'Out of clicks'"));
await ev("closeModal(); toSetup()");
check('Exact clicks greys out Six clicks and Round trip and says why', await ev(`gameMode() === 'exact' && ['limit', 'roundtrip'].every(k =>
  document.querySelector(\`input.rule[value=\${k}]\`).disabled && document.querySelector(\`[data-desc=\${k}]\`).textContent.startsWith('Off: Exact clicks'))`));
await ev("['limit', 'roundtrip'].forEach(k => (b => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector(`input.rule[value=${k}]`)))");
check('ticked anyway, Six clicks and Round trip aren\'t played with Exact clicks, though the other tiles say the trip', await ev(`rules().join() === 'exact'
  && document.querySelector('#games input[value=race]').parentElement.querySelector('.diagram').textContent === 'A ⇄ B'`));
await ev("document.querySelector('input[name=game][value=relay]').click()");
check('another game takes them back', await until(ready) && await ev("rules().join() === 'checkpoint,roundtrip,limit' && !document.querySelector('input.rule[value=limit]').disabled"));
check('a link with several games plays Exact clicks only', await ev("(setRules(['checkpoint', 'roundtrip', 'exact', 'limit']), rules().join()) === 'exact' && gameMode() === 'exact'"));
await ev("setRules([])");

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
  check(`target par ${REACH_LABEL[value]} in ${level}: the target is at that par`, got && ok(got.par) && got.reach === value && await ev(`document.querySelector('#setupPar').textContent === 'Par ${got?.par}'`),
    got ? `${got.pair}: par ${got.par}` : await ev("document.querySelector('#setupStatus').textContent"));
}
await ev('setContent([])');
// Every start's pars, worked out at once with bitsets (startPars), match a search from each start: in Relaxed, through
// navboxes, and in Hard, around hubs.
const parsOff = JSON.parse(await ev(`(async () => {
  const off = [];
  for (const level of ['relaxed', 'hard']) {
    document.querySelector('input[name=level][value=' + level + ']').click();
    const pars = await startPars(null), graph = await linkGraph(level === 'relaxed'), web = distancesFrom(graph, WEB_HEART);
    for (let i = 0; i < 25; i++) {
      const s = pick(candidates(null, false)), d = distancesFrom(graph, s);
      let m = 0;
      for (const t of candidates(null, true)) {
        const p = d[PAGE_IDS.get(t)];
        if (groupOf(t) !== groupOf(s)) m |= p >= 1 && p < PAR_TOP ? 1 << p - 1 : web[PAGE_IDS.get(t)] >= 0 ? 1 << PAR_TOP - 1 : 0;
      }
      if (m !== pars.get(s)) off.push(level + ': ' + s);
    }
  }
  return JSON.stringify(off);
})()`));
check('every start\'s pars, worked out at once, match a search from it, in Relaxed and Hard', !parsOff.length, parsOff.slice(0, 3).join(', '));
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
await ev("setCustom('goal', 'Zombie')");
await until("setup.goal?.title === 'Zombie' && setup.busy === 0");
await ev("reroll('start')");
const keptPar = await until(ready, 30000) && await ev("cardsRoute([setup.start.title, 'Zombie'], rules()).then(r => r.length - 1)");
check('and with none at the par, one at the nearest par', await ev(`setup.goal.title === 'Zombie' && ${status} === 'No Popular start has Zombie at par 3, so this one is par ${keptPar}.'`)
  && keptPar === 2, `${await ev(status)} (par ${keptPar})`);
// Settings with no pair at the par (in Popular on Relaxed no start has a Blocks target at par 3) roll at the nearest par
// that has one, the lower first, saying why, and the option is off until they change.
await ev("document.querySelector('#topic').value = 'blocks'; document.querySelector('#reach').value = 'p3'");
await ev("reroll('all')");
const p3Off = "(document.querySelector('#reach').dispatchEvent(new Event('focus')), document.querySelector('#reach option[value=p3]').disabled)";
const nearPar = await until(ready, 30000) && await ev(`cardsRoute([setup.start.title, setup.goal.title], rules()).then(r => r.length - 1)`);
check('settings with no pair at the par roll at the nearest par, saying why, and the option is off', await ev(`${status} === 'No Popular start has a Blocks target at par 3 on Relaxed, so this one is par 2.'
    && $('#reach').value === 'p2' && groupOf(setup.goal.title) === 'blocks' && ${p3Off}`) && nearPar === 2, `${await ev(status)} (par ${nearPar})`);
check('until the settings change', await ev(`(document.querySelector('#topic').value = 'world', !${p3Off})`));
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
await ev("document.querySelector('#reach').value = 'any'; setRules(['nonav'])");

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
  const graph = await linkGraph(false), titles = WIKI_DATA.articles.map(([t]) => t), linked = new Set(graph.links.flat());
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
// A daily link only plays a real day that has come, from a plain link or a sealed one; any other gives today's. A record
// only keeps a real day.
const dayLoaded = async hash => await open(hash) && await ev('setup.daily');
const todayIs = await ev('today()'), tomorrow = await ev("(d => (d.setDate(d.getDate() + 1), d.toLocaleDateString('sv')))(new Date())");
const loadedDays = [];
for (const d of ['2024-02-29', tomorrow, '2999-01-01', '2026-02-31', '2025-02-29', '2026-13-01', '0050-01-01', '2026-1-02', 'x', '']) loadedDays.push(await dayLoaded('#daily=' + d));
loadedDays.push(await dayLoaded('#daily'), await dayLoaded('#g=' + await ev(`sealLink('daily=${tomorrow}')`)));
check('a daily link only plays a real day that has come', JSON.stringify(loadedDays) === JSON.stringify(['2024-02-29', ...Array(11).fill(todayIs)]), JSON.stringify(loadedDays));
check('a record only keeps a real day', await ev(`(r => isRecord(r) && isRecord({ ...r, daily: '2026-01-06' }) && !isRecord({ ...r, daily: '2026-02-31' }) && !isRecord({ ...r, daily: 'x' }))
  ({ start: 'Diamond', goal: 'Crafting', rules: [], won: true, clicks: 1, ms: 1, at: 1 })`));
await open('#daily=2026-01-02');
check('a Round trip daily (2026-01-02) is a Race there and back', await until(ready) && await ev(`rules().join() === 'nonav,roundtrip'
  && gameMode() === 'race' && cardKeys().join() === 'start,goal' && document.querySelector('#setupStatus').textContent.includes(': Round trip.')`), await ev(pairOf));
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
  const relaxed = await linkGraph(true), id = t => PAGE_IDS.get(t);
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
check('par names a card\'s page that isn\'t in the snapshot', await until("document.querySelector('#par')?.textContent.startsWith('“Brand New Mob” isn’t in the wiki')"),
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
await open('#g=' + await ev("sealLink('start=No%20such%20page%2C%20visit%20example.com&target=Diamond')"));
check('a sealed link\'s missing article isn\'t named', await until("document.querySelector('#setupStatus').textContent.startsWith('One of the challenge link’s articles doesn’t exist')")
  && !await ev("document.querySelector('#setupStatus').textContent.includes('example')"), await ev("document.querySelector('#setupStatus').textContent"));
await open('#start=No%20such%20page&target=Diamond');
check('a hand-made link\'s missing article is named', await until("document.querySelector('#setupStatus').textContent.startsWith('The challenge link’s article “No such page” doesn’t exist')"),
  await ev("document.querySelector('#setupStatus').textContent"));
await open('#start=Java%20Edition%20version%20history&target=Diamond');
check('so is a left-out page', await until("document.querySelector('#setupStatus').textContent.startsWith('The challenge link’s article “Java Edition version history” doesn’t exist')"),
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

// Injection: a link can carry any text, so a sealed one whose titles are markup and script, with junk rules, kinds and
// back, is played through every place a title shows (cards, header, path, a frame link, the banner, the peek, the result,
// the history). The made-up wiki takes the titles as real pages, which the live one never would, so it is the stricter
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
await ev(`closeModal(); navigate(${JSON.stringify(payloads[2])}, null)`);
await until("!document.querySelector('#modalBg').classList.contains('hidden') && !!document.querySelector('.result')");
const frameClean = await ev(injected, await frameCtx());
await ev('closeModal(); toSetup()');
check('markup titles run nothing anywhere a title shows', peeked === true && frameClean === true && await ev(injected)
  && await ev(`document.querySelector('#history tbody').textContent.includes(${JSON.stringify(payloads[2])})`), JSON.stringify([peeked, frameClean]));

check('only page info and articles are asked for', [...requests.keys()].every(k => k === 'query prop=pageprops|pageimages|extracts' || k === 'parse prop=text|displaytitle|categories'),
  JSON.stringify(Object.fromEntries(requests)));
check('no uncaught errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
