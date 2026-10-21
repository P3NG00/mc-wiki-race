// Offline test: drives headless Firefox over WebDriver BiDi against index.html opened from file://, with every request to
// minecraft.wiki answered here (made-up page info and one made-up article), so it runs without the wiki. It checks the
// game's own logic: what rolls pick, the daily, Content and Spin-offs, difficulty, and which links are live. Rendering
// real articles is left to e2e.mjs. Usage: test/run-e2e.sh --offline (starts Firefox), or
//   node test/offline.mjs <bidi-port> <file-url>
import fs from 'node:fs';

const [port, fileUrl] = process.argv.slice(2);
// Spin-off namespace numbers, from wiki-data.js, so a page in one gets the ns the live API would give it.
const dataText = fs.readFileSync(new URL('../wiki-data.js', import.meta.url), 'utf8'), marker = 'const WIKI_DATA = ';
const SPINOFFS = JSON.parse(dataText.slice(dataText.indexOf(marker) + marker.length, dataText.lastIndexOf(';'))).spinoffs;
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

// Every article is this one: a link in the text, links to a hub, to a redirect to a hub, to the target hub Crafting, to a
// Tutorial and to a Dungeons page, and one link in a navbox.
const ARTICLE = title => `<div class="mw-parser-output"><p>${title}: <a href="/w/Diamond_Pickaxe">pickaxe</a> <a href="/w/Block">Block</a>
  <a href="/w/Blocks">Blocks</a> <a href="/w/Crafting">Crafting</a> <a href="/w/Tutorial:Mining">tutorial</a> <a href="/w/Dungeons:Creeper">dungeons</a></p>
  <table class="navbox"><tr><td><a href="/w/Creeper">Creeper</a></td></tr></table></div>`;
const reply = (request, body, type = 'application/json') => send('network.provideResponse', { request, statusCode: 200, body: { type: 'string', value: body },
  headers: [['Access-Control-Allow-Origin', '*'], ['Content-Type', type]].map(([name, value]) => ({ name, value: { type: 'string', value } })) });
function answer(request, url) {
  const u = new URL(url), p = u.searchParams;
  if (u.pathname === '/load.php') return reply(request, '', 'text/css');
  if (u.pathname !== '/api.php') return send('network.failRequest', { request });   // images
  const kind = [p.get('action'), ...['list', 'generator', 'prop'].filter(k => p.has(k)).map(k => `${k}=${p.get(k)}`)].join(' ');
  requests.set(kind, (requests.get(kind) || 0) + 1);
  if (p.get('action') === 'parse') return reply(request, JSON.stringify({ parse: { title: p.get('page'), displaytitle: p.get('page'), text: ARTICLE(p.get('page')) } }));
  if (p.get('action') === 'query' && p.has('titles')) {
    return reply(request, JSON.stringify({ query: { pages: p.get('titles').split('|').map(t => ({ title: t, ns: nsOf(t), pageprops: {}, extract: `About ${t}.` })) } }));
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

// Links by difficulty. A challenge link without rules is Relaxed: everything but other namespaces is live. No hubs alone
// (from an older link) is Hard: hubs and redirects to them are dead, the target hub stays live, and so are navboxes' links.
check('the data loads', await open('#start=Diamond&target=Crafting') && await ev("WIKI_DATA.snapshot.length === 10 && POOL.size === 5 && HUB_TITLES.get('Blocks') === 'Block'"));
check('a challenge link without rules is Relaxed', await ev("level() === 'relaxed' && rules().length === 0"));
await play();
let links = await linkStates();
check('Relaxed: hubs and navboxes live, other namespaces dead', links.Block === 'live' && links.Creeper === 'live' && links['Tutorial:Mining'] === 'dead' &&
  links['Dungeons:Creeper'] === 'dead', JSON.stringify(links));
await open('#start=Diamond&target=Crafting&rules=nohubs');
check('No hubs alone is Hard', await ev("level() === 'hard' && rules().join() === 'nohubs,nonav'"));
// Golf: par shows beside Start once the link graph has loaded, and in the header while playing.
check('the setup screen shows par', await until("/^Par \\d+$/.test(document.querySelector('#setupPar').textContent)"), await ev("document.querySelector('#setupPar').textContent"));
await play();
check('the header shows par', await until("/^\\d+$/.test(document.querySelector('#hudPar').textContent)"), await ev("document.querySelector('#hudPar').textContent"));
links = await linkStates();
check('Hard: hubs, redirects to them and navboxes dead; the target hub and other links live',
  links.Block === 'dead' && links.Blocks === 'dead' && links.Creeper === 'dead' && links.Crafting === 'live' && links.Diamond_Pickaxe === 'live', JSON.stringify(links));
await ev('finish(false)');
check('the result shows par and a route', await until("/^Par \\d+, going by the wiki on .* One way: Diamond → .*Crafting\\.$/.test(document.querySelector('#par')?.textContent)"),
  await ev("document.querySelector('#par')?.textContent"));
check('the record keeps par, and the history shows it', await ev("Number.isInteger(savedGames()[0].par)") && await until(
  "toSetup(), document.querySelector('#history tbody tr td:nth-child(5)').textContent === 'par ' + savedGames()[0].par"),
  await ev("document.querySelector('#history tbody tr td:nth-child(5)').textContent"));
check('golf names a win against par', await ev("[[1, 1], [2, 2], [3, 2], [4, 2], [5, 2], [9, 2], [1, 2], [1, 3]].map(([c, p]) => golfScore(c, p)).join('|')")
  === 'Hole in one!|Par|Bogey (+1)|Double bogey (+2)|Triple bogey (+3)|7 over par|Birdie (−1)|Eagle (−2)');
await ev('closeModal(); toSetup()');
check('difficulty from a link\'s rules, and its words', await ev(`(() => {
  const got = [[], ['nonav'], ['nonav', 'nohubs'], ['noback', 'nonav']].map(r => (setRules(r), level() + ':' + rulesText(rules()))).join(' ');
  setRules([]);
  return got;
})()`) === 'relaxed:Relaxed normal: hard:Hard normal:No Back');

// Hot/cold: after a click, a hint says whether the page is closer to the objective than the one before, by the link graph,
// shown over the article and kept on the path; a page the snapshot lacks gets no hint, and a game without the rule none.
// A start two or more clicks from Crafting (Relaxed): the first step of its shortest route is warmer, going back colder.
const far = JSON.parse(await ev(`(async () => {
  for (const start of POOL_TITLES) {
    const route = await parRoute({ start, goal: 'Crafting', rules: [] });
    if (route?.length >= 3) return JSON.stringify(route);
  }
})()`));
await open(`#start=${encodeURIComponent(far[0])}&target=Crafting&rules=hotcold`);
await play();
await ev(`navigate(${JSON.stringify(far[1])}, null)`);
check('Hot/cold: a step along a shortest route is warmer, shown over the article and on the path', await until("game.path.at(-1).hint === 'warmer' && !game.loading") &&
  await ev("!document.querySelector('#toast').classList.contains('hidden') && document.querySelector('#toast').textContent === HINTS.warmer.text") &&
  await ev("document.querySelector('#pathList li.cur').textContent.endsWith(HINTS.warmer.icon)"), far.join(' → '));
await ev(`navigate(${JSON.stringify(far[0])}, null)`);
check('Hot/cold: going back is colder', await until("game.path.at(-1).hint === 'colder' && !game.loading"), await ev('game.path.at(-1).hint'));
// A dead end, a page with no route anywhere (no links outside navboxes, no navboxes), counts as farthest: colder.
const deadEnd = await ev(`linkGraph(true).then(g => WIKI_DATA.articles.map(([t]) => t).find(t => !spinoffOf(t) && !g.links[PAGE_IDS.get(t)].length && !g.carries[PAGE_IDS.get(t)].length))`);
await ev(`navigate(${JSON.stringify(deadEnd)}, null)`);
check('Hot/cold: walking into a dead end is colder', await until("game.path.at(-1).hint === 'colder' && !game.loading"), `${deadEnd}: ${await ev('game.path.at(-1).hint')}`);
await ev("navigate('Brand New Mob', null)");
check('Hot/cold has no hint for a page the snapshot lacks', await until("game.path.at(-1).hint === 'unknown' && !game.loading"));
check('the rule is in the game\'s rules and its challenge link', await ev("game.rules.includes('hotcold') && challengeLink().includes('hotcold')"));
await ev("finish(false); closeModal(); toSetup()");
// With a checkpoint, the target reached before it isn't the objective yet, so it gets a hint too.
await open('#start=Diamond&via=Creeper&target=Crafting&rules=hotcold');
await play();
await ev("navigate('Crafting', null)");
check('Hot/cold hints the target reached before the checkpoint', await until("game.active && !!game.path.at(-1).hint && !game.loading"), await ev('game.path.at(-1).hint'));
await ev("finish(false); closeModal(); toSetup()");
await open('#start=Diamond&target=Crafting');
await play();
await ev("navigate('Diamond Pickaxe', null)");
await until('game.path.length === 2 && !game.loading');
await sleep(300);
check('no hints without the rule', await ev('game.path.every(p => !p.hint)'));
await ev("finish(false); closeModal(); toSetup()");

// Relay: two checkpoints from a challenge link, reached in order. One reached early doesn't count, the banner and the HUD
// name the next one, the record keeps both, and par goes through both.
const setCount = n => ev(`(s => { s.value = ${n}; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#viaCount'))`);
const hud = "document.querySelector('#hudLbl').textContent + ' ' + document.querySelector('#hudGoal').textContent";
const toast = "document.querySelector('#toast').textContent";
await open('#start=Diamond&via=Creeper&via=Zombie&target=Crafting');
check('a link with two checkpoints shows two numbered cards in order', await until(ready) && await ev(`viaCount() === 2 && document.querySelector('.pair').dataset.vias === '2'
  && ['via0', 'via1'].map(w => setup[w].title + ' ' + document.querySelector('#card-' + w + ' .tag').textContent).join() === 'Creeper Checkpoint 1,Zombie Checkpoint 2'
  && document.querySelector('#slot-via2').classList.contains('hidden') && challengeLink().includes('&via=Creeper&via=Zombie&')`));
await play();
check('the HUD names the first checkpoint', await ev(hud) === 'Checkpoint 1 Creeper', await ev(hud));
await ev("navigate('Zombie', null)");
await until('game.path.length === 2 && !game.loading');
check('the second checkpoint reached first doesn\'t count', await ev('game.viaNext === 0 && !game.path[1].via') && await ev(hud) === 'Checkpoint 1 Creeper');
await ev("navigate('Creeper', null)");
await until('game.path.length === 3 && !game.loading');
check('reaching the first checkpoint names the second', await ev(`game.path[2].via === 1 && ${toast} === '✓ Checkpoint 1 of 2 reached! Now find Zombie'`) &&
  await ev(hud) === 'Checkpoint 2 Zombie', await ev(toast));
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
await ev("document.querySelector('#rules input[value=checkpoint]').click()");
check('the count hides with the rule', await ev("document.querySelector('#viaCount').classList.contains('hidden') && document.querySelector('.pair').dataset.vias === '0'"));

// Round trip: the target, then back to the start. Reaching the target starts Back again from there, and with No
// retracing every page of the way there goes dead. Checkpoint and Round trip untick each other.
await open('#start=Diamond&target=Zombie&rules=roundtrip,noretrace');
check('a round trip shows the start as the finish, ⇄ and No retracing', await until(ready) && await ev(`document.querySelector('#cardStart .tag').textContent === 'Start and finish'
  && document.querySelector('#pairArrow').textContent === '⇄' && !document.querySelector('#rules label[data-rule=noretrace]').classList.contains('hidden')
  && rules().join() === 'roundtrip,noretrace' && challengeLink().endsWith('&rules=roundtrip,noretrace')`));
const rtPar = await ev("cardsRoute(['Diamond', 'Zombie'], rules()).then(r => r.length - 1)");
check('setup par is the round trip\'s', await until(`document.querySelector('#setupPar').textContent === 'Par ${rtPar}'`), `par ${rtPar}`);
await play();
check('the HUD names the target first', await ev(hud) === 'Target Zombie', await ev(hud));
await ev("navigate('Crafting', null)");
await until('game.path.length === 2 && !game.loading');
await ev("navigate('Zombie', null)");
await until('game.path.length === 3 && !game.loading');
check('reaching the target turns back: the banner, the HUD, Back starting again', await ev(`${toast} === '✓ Target reached! Now head back to Diamond'
  && game.stack.join() === 'Zombie' && document.querySelector('#btnBack').disabled && game.path[2].via === 1`) && await ev(hud) === 'Back to Diamond', await ev(toast));
const liveLinks = async () => JSON.parse(await ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.classList.contains('mwr-live')])))`, await frameCtx()));
let rtLinks = await liveLinks();
check('No retracing: the way there is dead, other links live', rtLinks['/w/Crafting'] === false && rtLinks['/w/Diamond_Pickaxe'] === true, JSON.stringify(rtLinks));
await ev("navigate('Diamond Pickaxe', null)");
await until('game.path.length === 4 && !game.loading');
check('Back works again on the way back', await ev("!document.querySelector('#btnBack').disabled"));
await ev("navigate('Diamond', null)");
check('back at the start wins, recorded by its cards', await until('!game.active') && await ev(`(r => r.won && r.goal === 'Zombie' && !r.vias
  && r.rules.join() === 'roundtrip,noretrace')(store.get('mwr.history', [])[0]) && document.querySelector('#modal').textContent.includes('Diamond → Zombie → Diamond')`));
await ev("closeModal(); toSetup()");
await open('#start=Diamond&target=Zombie&rules=roundtrip');
await until(ready);
await play();
await ev("navigate('Crafting', null)");
await until('game.path.length === 2 && !game.loading');
await ev("navigate('Zombie', null)");
await until('game.path.length === 3 && !game.loading');
rtLinks = await liveLinks();
check('without No retracing the way there stays live, and Back still starts again', rtLinks['/w/Crafting'] === true && await ev("game.stack.join() === 'Zombie'"));
await ev("finish(false); closeModal(); toSetup()");
await ev("document.querySelector('#rules input[value=checkpoint]').click()");
check('Checkpoint unticks Round trip and hides No retracing', await until(ready) && await ev(`!document.querySelector('#rules input[value=roundtrip]').checked
  && rules().join() === 'checkpoint' && document.querySelector('#rules label[data-rule=noretrace]').classList.contains('hidden')
  && document.querySelector('#cardStart .tag').textContent === 'Start' && document.querySelector('#pairArrow').textContent === '➜'`));
await ev("document.querySelector('#rules input[value=roundtrip]').click()");
check('Round trip unticks Checkpoint', await until(ready) && await ev("rules().join() === 'roundtrip' && cardKeys().join() === 'start,goal'"));
// A target with no way back that doesn't retrace (a dead end has no way back at all) says so as it is reached.
await open(`#start=Diamond&target=${encodeURIComponent(deadEnd)}&rules=roundtrip,noretrace`);
await until(ready);
await play();
await ev(`navigate(${JSON.stringify(deadEnd)}, null)`);
check('a target with no way back says so', await until("game.path.at(-1).hint === 'stranded' && !game.loading") &&
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
check('the header counts toward it and Back is gone', await ev(`document.querySelector('#hudClicks').textContent === '0/${n}' && document.querySelector('#btnBack').classList.contains('hidden')`));
await ev("navigate('Crafting', null)");
await until('game.path.length === 2 && !game.loading');
rtLinks = await liveLinks();
check('visited pages are dead links', rtLinks['/w/Crafting'] === false && rtLinks['/w/Diamond_Pickaxe'] === true, JSON.stringify(rtLinks));
await ev("navigate('Zombie', null)");
check('reaching the target sooner loses: Too soon', await until('!game.active') && await ev(`(r => r.tooSoon && !r.won && r.exact === ${n})(store.get('mwr.history', [])[0])
  && document.querySelector('#modal h2').textContent === 'Too soon' && document.querySelector('#modal').textContent.includes('it had to be exactly ${n}')`));
await ev("closeModal(); toSetup()");
check('the history says too soon', await ev("document.querySelector('#history tbody tr').textContent.includes('too soon')"));
await open('#start=Diamond&target=Zombie&rules=exact');
await until(ready);
await play();
for (const [i, t] of exact.route.slice(1).entries()) {
  await ev(`navigate(${JSON.stringify(t)}, null)`);
  await until(`game.path.length === ${i + 2} && !game.loading || !game.active`);
}
check('on the count wins, with no golf score', await until('!game.active') && await ev(`(r => r.won && r.clicks === ${n} && r.exact === ${n})(store.get('mwr.history', [])[0])`) &&
  await until("document.querySelector('#par').textContent.startsWith('Par ')") && await ev("!/bogey|Par\\./.test(document.querySelector('#par').textContent.split(', going')[0])"),
  await ev("document.querySelector('#par')?.textContent"));
await ev("closeModal(); toSetup()");
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
await ev("document.querySelector('#rules input[value=limit]').click()");
check('Six clicks unticks Exact clicks', await ev("rules().join() === 'limit' && !document.querySelector('#rules input[value=exact]').checked"));
await ev("document.querySelector('#rules input[value=checkpoint]').click()");
await ev("document.querySelector('#rules input[value=exact]').click()");
check('Exact clicks unticks Checkpoint and Six clicks', await until(ready) && await ev("rules().join() === 'exact' && cardKeys().join() === 'start,goal'"));
check('a link with both plays Exact clicks only', await ev("(setRules(['checkpoint', 'roundtrip', 'noretrace', 'exact', 'limit']), rules().join()) === 'exact'"));
await ev("setRules([])");

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
await open('#daily=2026-01-02');
check('a Round trip daily (2026-01-02) goes without No retracing', await until(ready) && await ev(`rules().join() === 'nonav,roundtrip'
  && cardKeys().join() === 'start,goal' && document.querySelector('#setupStatus').textContent.includes('with Round trip')`), await ev(pairOf));
// Every daily can be done: a route under its rules, and on a Six clicks day par 4 or less. A month of them.
const dailies = JSON.parse(await ev(`(async () => {
  const out = [];
  for (let d = 1; d <= 31; d++) {
    const p = await dailyPair('2026-01-' + String(d).padStart(2, '0'));
    const route = await parRoute({ start: p.start.title, vias: p.vias.map(v => v.title), goal: p.goal.title, rules: ['nonav', p.rule] });
    out.push({ rule: p.rule, vias: p.vias.length, par: route ? route.length - 1 : null });
  }
  return JSON.stringify(out);
})()`));
check('a month of dailies all have a route, Six clicks days par 4 or less, Checkpoint days one or two checkpoints, Round trip days there and back',
  dailies.length === 31 && dailies.every(d => d.par >= (d.rule === 'roundtrip' ? 2 : 1) && (d.rule !== 'limit' || d.par <= 4)
    && (d.rule === 'checkpoint' ? d.vias === 1 || d.vias === 2 : !d.vias)) && dailies.some(d => d.rule === 'roundtrip') &&
  dailies.some(d => d.rule === 'limit'), dailies.map(d => `${d.rule}${d.vias > 1 ? '×' + d.vias : ''}:${d.par}`).join(' '));
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
// in, Relaxed's are never longer than Normal's nor Normal's than Hard's, Hard's avoid hubs but the target, a spin-off page
// is only reachable with its spin-off on, and a checkpoint's route goes through it.
const par = JSON.parse(await ev(`(async () => {
  const relaxed = await linkGraph(true), id = t => PAGE_IDS.get(t);
  const linked = (g, a, b) => g.links[id(a)].includes(id(b)) || (g.carries?.[id(a)] ?? []).some(x => g.boxes[x].includes(id(b)));
  const follows = (g, route) => route.every((t, i) => i === 0 || linked(g, route[i - 1], t));
  const hubs = new Set(HUB_TITLES.values()), bad = [];
  for (let i = 0; i < 30; i++) {
    const start = pick(POOL_TITLES), goal = pick(POOL_TITLES);
    if (start === goal) continue;
    const [r, n, h] = await Promise.all([[], ['nonav'], ['nohubs', 'nonav']].map(rules => parRoute({ start, goal, rules })));
    if (!r || !n || !follows(relaxed, r) || !follows({ links: relaxed.links }, n) || r.length > n.length || (h && (h.length < n.length
      || h.slice(1).some(t => hubs.has(t) && t !== goal)))) bad.push(start + ' -> ' + goal);
  }
  const off = await parRoute({ start: 'Minecraft Dungeons', goal: 'Dungeons:Creeper', rules: ['nonav'] });
  const on = await parRoute({ start: 'Minecraft Dungeons', goal: 'Dungeons:Creeper', rules: ['nonav'], content: ['Dungeons'] });
  // Round trips: there and back, each way as short as it goes; with No retracing the way back keeps off the way there.
  const roundTrips = [];
  for (let i = 0; i < 20; i++) {
    const start = pick(POOL_TITLES), goal = pick(POOL_TITLES);
    if (start === goal) continue;
    const [there, back, rt, rtn] = await Promise.all([[start, goal, []], [goal, start, []], [start, goal, ['roundtrip']], [start, goal, ['roundtrip', 'noretrace']]]
      .map(([s, g, r]) => parRoute({ start: s, goal: g, rules: ['nonav', ...r] })));
    const turn = rtn?.indexOf(goal), way = rtn?.slice(1, turn), home = rtn?.slice(turn + 1, -1);
    if (!rt || rt.length !== there.length + back.length - 1 || rt[0] !== start || rt.at(-1) !== start || !follows({ links: relaxed.links }, rt)
      || !rtn || rtn.length < rt.length || rtn.at(-1) !== start || !follows({ links: relaxed.links }, rtn) || home.some(t => way.includes(t))) roundTrips.push(start + ' -> ' + goal);
  }
  const via = await parRoute({ start: 'Diamond', vias: ['Creeper'], goal: 'Bamboo', rules: ['nonav'] });
  const relay = await parRoute({ start: 'Diamond', vias: ['Creeper', 'Zombie'], goal: 'Bamboo', rules: ['nonav'] });
  return JSON.stringify({ bad, roundTrips, spinoff: off === null && on?.at(-1) === 'Dungeons:Creeper', via: via?.includes('Creeper') && via.at(-1) === 'Bamboo',
    relay: relay?.indexOf('Creeper') > 0 && relay.indexOf('Zombie') > relay.indexOf('Creeper') && relay.at(-1) === 'Bamboo' });
})()`));
check('par routes follow the graph, Relaxed ≤ Normal ≤ Hard, Hard without hubs', par.bad.length === 0, par.bad.slice(0, 3).join(', '));
check('par reaches a spin-off page only with its spin-off on', par.spinoff);
check('par goes through the checkpoint, and through two in order', par.via && par.relay);
check('round trip par goes there and back, and with No retracing keeps off the way there', par.roundTrips.length === 0, par.roundTrips.join(', '));
await open('#start=Brand%20New%20Mob&target=Diamond');
await play();
await ev('finish(false)');
check('par names a card\'s page that isn\'t in the snapshot', await until("document.querySelector('#par')?.textContent.startsWith('“Brand New Mob” isn’t in the wiki')"),
  await ev("document.querySelector('#par')?.textContent"));
await ev('closeModal(); toSetup()');

check('only page info and articles are asked for', [...requests.keys()].every(k => k === 'query prop=pageprops|pageimages|extracts' || k === 'parse prop=text|displaytitle'),
  JSON.stringify(Object.fromEntries(requests)));
check('no uncaught errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
