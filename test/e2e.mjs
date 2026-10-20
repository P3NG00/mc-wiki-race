// End-to-end test: drives headless Firefox over WebDriver BiDi against index.html opened from file://.
// Hits the live minecraft.wiki API. Usage: test/run-e2e.sh (starts Firefox), or
//   node test/e2e.mjs <bidi-port> <file-url> [screenshot-dir]
import fs from 'node:fs';

const [port, fileUrl, shotDir] = process.argv.slice(2);
const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
let id = 0;
const pending = new Map();
let onEvent = () => {};
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) onEvent(d); };
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

await new Promise(r => ws.onopen = r);
await send('session.new', { capabilities: {} });
const ctx = (await send('browsingContext.getTree', {})).result.contexts[0].context;
await send('browsingContext.setViewport', { context: ctx, viewport: { width: 1280, height: 860 } });

const ev = async (expr, c = ctx) => {
  const r = await send('script.evaluate', { target: { context: c }, expression: expr, awaitPromise: true });
  return r.result?.result?.value ?? JSON.stringify(r.error || r.result?.exceptionDetails?.text);
};
const frameCtx = async () => (await send('browsingContext.getTree', {})).result.contexts[0].children[0]?.context;
const until = async (expr, ms = 30000, c = ctx) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await ev(expr, c) === true) return true; await sleep(300); }
  return false;
};
const shot = async name => {
  if (!shotDir) return;
  const r = await send('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};

// Challenge link → play → two clicks → win.
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe', wait: 'complete' });
check('challenge pair loads', await until("!document.querySelector('#btnPlay').disabled"),
  await ev("setup.start?.title + ' -> ' + setup.goal?.title"));
await shot('1-setup');

await ev("document.querySelector('#btnPlay').click()");
check('start article renders', await until("document.querySelector('#overlay').classList.contains('hidden') && game.path.length === 1"));
await sleep(2000);
await shot('2-game');

// Collapsing the path keeps the credit in view, widens the article and is remembered (a reload is checked with the
// Blind target game below).
const frameWidth = () => ev("document.querySelector('#frame').clientWidth");
const wide = await frameWidth();
await ev("document.querySelector('#btnPath').click()");
const shown = sel => `!!document.querySelector('${sel}').offsetParent`;
check('collapsing the path hides it and keeps the credit', await ev(`!${shown('#pathList')} && ${shown('#credit')} && store.get('mwg.pathCollapsed') === true`) &&
  await frameWidth() > wide, `frame ${wide} -> ${await frameWidth()}`);
await shot('2b-collapsed');
await ev("document.querySelector('#btnPath').click()");
check('expanding the path shows it again', await ev(`${shown('#pathList')} && store.get('mwg.pathCollapsed') === false`) && await frameWidth() === wide);

// At phone size: the objective's name and "what is it?" don't overlap, the path is one line, nothing scrolls the page
// sideways, and a wide wiki table scrolls within itself so its links stay reachable.
await send('browsingContext.setViewport', { context: ctx, viewport: { width: 390, height: 844 } });
await sleep(500);
const overlap = (a, b) => `(r => (s => r.right > s.left && s.right > r.left && r.bottom > s.top && s.bottom > r.top)(document.querySelector('${b}').getBoundingClientRect()))(document.querySelector('${a}').getBoundingClientRect())`;
const phone = JSON.parse(await ev(`JSON.stringify({ labelOverPeek: ${overlap('#hudLbl', '#btnPeek')}, nameOverPeek: ${overlap('#hudGoal', '#btnPeek')},
  nameCut: document.querySelector('#hudGoal').scrollWidth > document.querySelector('#hudGoal').clientWidth,
  pathLine: document.querySelector('#pathList').getBoundingClientRect().height, pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth })`));
const phoneCtx = await frameCtx();
const phoneFrame = JSON.parse(await ev(`JSON.stringify({ pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  tableScrolls: (t => !!t && (t.scrollLeft = 50, t.scrollLeft > 0))([...document.querySelectorAll('table')].find(t => t.scrollWidth > t.clientWidth + 20 && /auto|scroll/.test(getComputedStyle(t).overflowX))) })`, phoneCtx));
check('phone: the objective and "what is it?" fit without overlapping', !phone.labelOverPeek && !phone.nameOverPeek && !phone.nameCut, JSON.stringify(phone));
check('phone: the path is one line and nothing scrolls the page sideways', phone.pathLine < 30 && phone.pageScroll <= 0 && phoneFrame.pageScroll <= 0,
  JSON.stringify({ ...phone, frame: phoneFrame }));
check('phone: a wide wiki table scrolls within itself', phoneFrame.tableScrolls);
await shot('2c-phone');
await send('browsingContext.setViewport', { context: ctx, viewport: { width: 1280, height: 860 } });
await sleep(300);

let f = await frameCtx();
const links = JSON.parse(await ev("JSON.stringify({ live: document.querySelectorAll('a.mwg-live').length, tutorial: document.querySelectorAll('a[href^=\"/w/Tutorial:\"]').length, tutorialLive: document.querySelectorAll('a.mwg-live[href^=\"/w/Tutorial:\"]').length, sheets: document.styleSheets.length })", f));
check('article links are clickable', links.live > 100, `live=${links.live}`);
check('Tutorial: links are disabled', links.tutorial > 0 && links.tutorialLive === 0, `tutorial=${links.tutorial}`);
check('wiki stylesheets loaded', links.sheets >= 4, `sheets=${links.sheets}`);
// Hovering a live link tints it. The pointer moves to the link itself (an element origin, which works inside the frame)
// and back to the page's corner, so no later link stays hovered.
const pickaxeLink = "[...document.querySelectorAll('a.mwg-live')].find(a => a.getAttribute('href') === '/w/Pickaxe')";
const linkRef = (await send('script.evaluate', { target: { context: f }, expression: `(a => (a.scrollIntoView({ block: 'center' }), a))(${pickaxeLink})`, awaitPromise: false })).result?.result?.sharedId;
const linkBg = () => ev(`getComputedStyle(${pickaxeLink}).backgroundColor`, f);
const plainBg = await linkBg();
const moveTo = origin => send('input.performActions', { context: f, actions: [{ type: 'pointer', id: 'mouse', actions: [{ type: 'pointerMove', x: 0, y: 0, origin }] }] });
const moved = await moveTo({ type: 'element', element: { sharedId: linkRef } });
await sleep(300);
const hoverBg = await linkBg();
check('hovering a live link tints it', !!linkRef && !moved.error && /\/ 0\.14\)$/.test(hoverBg) && hoverBg !== plainBg, `${plainBg} -> ${hoverBg} ${moved.error || ''}`);
await moveTo('viewport');
await send('input.releaseActions', { context: ctx });

await ev("[...document.querySelectorAll('a.mwg-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
check('clicking a link navigates', await until("game.path.length === 2 && !game.loading"), await ev("game.path.map(p => p.title).join(' > ')"));
f = await frameCtx();
const seenLinks = JSON.parse(await ev(`JSON.stringify(['Diamond', 'Iron_Pickaxe'].map(t =>
  [...document.querySelectorAll('a.mwg-live')].filter(a => a.getAttribute('href').split('#')[0] === '/w/' + t).map(a => a.classList.contains('mwg-seen'))))`, f));
check('links to articles on the path are marked', seenLinks[0].length > 0 && seenLinks[0].every(Boolean) &&
  seenLinks[1].length > 0 && !seenLinks[1].some(Boolean), JSON.stringify(seenLinks));

// Back reuses the cached article instead of calling the API again.
await ev("window.apiCalls = 0; { const orig = api; window.api = Object.assign(p => (apiCalls++, orig(p)), { orig }); }");
await ev("document.querySelector('#btnBack').click()");
check('Back loads from cache', await until("game.path.length === 3 && !game.loading") && await ev('apiCalls === 0'),
  `${await ev("game.path.map(p => p.title).join(' > ')")} apiCalls=${await ev('apiCalls')}`);
await ev("window.api = window.api.orig");

// Switching theme restyles the loaded article in place: same document, wiki dark/light body class swapped.
f = await frameCtx();
await ev("window.mwgMarker = 1", f);
const frameTheme = "(window.mwgMarker === 1 ? '' : 'reloaded ') + (document.body.classList.contains('wgl-theme-dark') ? 'dark' : 'light') + ' ' + getComputedStyle(document.documentElement).backgroundColor";
await ev("setTheme('dark')");
check('dark theme switches the article in place', await until(`${frameTheme} === 'dark rgb(18, 18, 18)'`, 5000, f) && await ev("themeIsDark()") === true, await ev(frameTheme, f));
await ev("setTheme('light')");
check('light theme switches the article in place', await until(`${frameTheme} === 'light rgb(255, 255, 255)'`, 5000, f) && await ev("themeIsDark()") === false, await ev(frameTheme, f));
// A theme change made while the article is still loading reaches it once the frame reports ready.
await ev("renderArticle(parseCache.get('Diamond'), null, game.navToken); setTheme('dark')");
check('theme change during load is applied', await until("window.mwgMarker === undefined && document.body.classList.contains('wgl-theme-dark')", 15000, f),
  await ev(frameTheme, f));
await ev("setTheme('auto')");

f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwg-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
check('reaching the target wins', await until("!game.active && !document.querySelector('#modalBg').classList.contains('hidden')"),
  `clicks=${await ev('clicks()')}`);
await shot('3-win');

// Escape pressed inside the iframe must not dismiss the win modal.
f = await frameCtx();
await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))", f);
await sleep(500);
check('Escape keeps the win modal open', await ev("!document.querySelector('#modalBg').classList.contains('hidden')"));

// No Back: the button is gone and goBack() does nothing. The rule goes into the challenge link and the result, and the
// earlier 3-click win without rules must not count as this pair's best (2 clicks would otherwise be a new best).
await ev("document.querySelector('#rules input[value=noback]').click()");
check('challenge link carries rules', await ev("challengeLink().endsWith('&rules=noback')"), await ev('challengeLink()'));
await ev("document.querySelector('#mSame').click()");
await until("game.path.length === 1 && !game.loading");
check('No Back hides Back', await ev("document.querySelector('#btnBack').classList.contains('hidden')"));
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwg-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
await until("game.path.length === 2 && !game.loading");
await ev("goBack()");
await sleep(1000);
check('No Back blocks goBack()', await ev("game.path.length === 2 && !game.loading"), await ev("game.path.map(p => p.title).join(' > ')"));
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwg-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
check('No Back game wins', await until("!game.active && !document.querySelector('#modalBg').classList.contains('hidden')"), `clicks=${await ev('clicks()')}`);
const modal = await ev("document.querySelector('#modal').textContent");
check('result records the rules', await ev("JSON.stringify(store.get('mwg.history', [])[0].rules) === '[\"noback\"]'") && modal.includes('No Back'),
  await ev("JSON.stringify(store.get('mwg.history', [])[0].rules)"));
check('personal best ignores games with other rules', !/personal best|Your best/.test(modal));
await ev("document.querySelector('#rules input[value=noback]').click()");

// Six clicks: the HUD counts down to the limit and the game is lost on the last click that misses the target.
// Pickaxe and Back alternate, so every article after the first comes from the parse cache.
await ev("document.querySelector('#rules input[value=limit]').click()");
await ev("document.querySelector('#mSame').click()");
await until("game.path.length === 1 && !game.loading");
check('Six clicks shows the limit', await ev("document.querySelector('#hudClicks').textContent === '0/6'"), await ev("document.querySelector('#hudClicks').textContent"));
for (let i = 1; i <= 6; i++) {
  await ev(i % 2 ? "navigate('Pickaxe', null)" : 'goBack()');
  await until(`game.path.length === ${i + 1} && !game.loading`);
}
check('running out of clicks ends the game', await until("!game.active && document.querySelector('#modal h2').textContent === 'Out of clicks'", 5000),
  await ev("game.path.map(p => p.title).join(' > ')"));
check('result records running out of clicks', await ev("(([r]) => r.outOfClicks === true && !r.won && r.clicks === 6)(store.get('mwg.history', []))"));
await ev("document.querySelector('#rules input[value=limit]').click()");

// Random rolls in both modes.
await ev("document.querySelector('#mNew').click()");
check('Classic roll', await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
// Balanced fetches every category at once, so it also checks that no more than API_CONCURRENCY requests are in flight.
await ev(`window.inFlight = 0; window.maxInFlight = 0; window.fetch = Object.assign(async (...a) => {
  maxInFlight = Math.max(maxInFlight, ++inFlight);
  try { return await fetch.orig(...a); } finally { inFlight--; }
}, { orig: fetch.bind(window) })`);
for (const m of ['balanced', 'even', 'chaos']) {
  await ev(`document.querySelector('input[value=${m}]').click()`);
  await sleep(500);
  check(`${m} roll`, await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
}
await ev('window.fetch = fetch.orig');
check('Chaos rolls get descriptions', await ev('chaosQueue.some(i => i.desc)'));
// pageprops' description on infobox pages is the infobox caption ("Java Edition"); the intro's first paragraph is used.
const zpDesc = await ev("pageInfo('Zombified Piglin').then(i => i.desc)");
check('description is the first paragraph', zpDesc.startsWith('Zombified piglins are') && !zpDesc.includes('\n'), zpDesc);
check('at most API_CONCURRENCY requests at once', await ev('maxInFlight === API_CONCURRENCY'), `max=${await ev('maxInFlight')}`);

// Difficulty rerolls only the target. Easy and Hard keep the best- or least-linked of five candidates, Any takes the first.
// candidate() is stubbed with known counts, so this tests the selection rather than the wiki's link graph.
await ev("document.querySelector('input[name=diff][value=hard]').click()");
await sleep(500);
check('Hard roll (Chaos)', await until("!document.querySelector('#btnPlay').disabled", 60000) && await ev('setup.goal.backlinks >= 5'),
  await ev("setup.goal.title + ' ' + setup.goal.backlinks"));
const startBefore = await ev('setup.start.title');
await ev(`window.candidate = Object.assign(async limit => {
  const i = candidate.n++;
  return { title: 'Fake ' + i, desc: '', img: '', disambig: false, backlinks: [300, 50, 500, 500, 120][i % 5], limit };
}, { orig: candidate, n: 0 })`);
for (const [diff, want] of [['easy', 'Fake 2 500 500 easy'], ['hard', 'Fake 1 50 500 hard'], ['any', 'Fake 0 300 5 any']]) {
  await ev(`candidate.n = 0; document.querySelector('input[name=diff][value=${diff}]').click()`);
  await sleep(300);
  await until("!document.querySelector('#btnPlay').disabled", 15000);
  const got = await ev("[setup.goal.title, setup.goal.backlinks, setup.goal.limit, setup.goal.difficulty].join(' ')");
  check(`${diff} target selection`, got === want && await ev('setup.start.title') === startBefore, got);
}
await ev('window.candidate = candidate.orig');

// A topic rerolls only the target, from the topic's categories, even in Chaos.
await ev("(s => { s.value = 'mobs'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#topic'))");
await sleep(500);
check('Mobs topic target', await until("!document.querySelector('#btnPlay').disabled", 60000) && await ev('setup.start.title') === startBefore &&
  await ev("Promise.all(TOPICS.mobs.cats.map(categoryMembers)).then(l => l.flat().includes(setup.goal.title))"), await ev("setup.goal.title"));
// The result keeps how its target was rolled, and shows the topic.
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
await ev("document.querySelector('#btnGiveUp').click()");
await ev("document.querySelector('#gQuit').click()");
const rolled = await ev("(([r]) => r.difficulty + ' ' + r.topic)(store.get('mwg.history', []))");
check('result records difficulty and topic', rolled === 'any mobs' && await ev("document.querySelector('#modal .note').textContent.endsWith('· Mobs')"),
  `${rolled} | ${await ev("document.querySelector('#modal .note').textContent")}`);
await ev("document.querySelector('#mNew').click()");
await until("!document.querySelector('#btnPlay').disabled", 60000);
await ev("(s => { s.value = 'any'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#topic'))");
await sleep(500);
await until("!document.querySelector('#btnPlay').disabled", 60000);

// Ticking Checkpoint shows the checkpoint card with a third, different article; unticking hides it.
const viaCard = "!document.querySelector('#cardVia').classList.contains('hidden')";
await ev("document.querySelector('#rules input[value=checkpoint]').click()");
check('Checkpoint adds a distinct checkpoint', await until(`${viaCard} && !document.querySelector('#btnPlay').disabled`, 60000) &&
  await ev("new Set([setup.start.title, setup.via.title, setup.goal.title]).size === 3"), await ev("setup.via?.title"));
await ev("document.querySelector('#rules input[value=checkpoint]').click()");
check('unticking Checkpoint hides it', await ev(`!(${viaCard}) && !document.querySelector('#btnPlay').disabled`));

// An interwiki title has no page in the API response; it must read as "not found", not a network error.
await ev("(() => { const i = document.querySelector('[data-custom=start]'); i.value = 'de:Diamant'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()");
check('interwiki title reports not found', await until("document.querySelector('#setupStatus').textContent.startsWith('No article named')", 15000),
  await ev("document.querySelector('#setupStatus').textContent"));

// Same article as start and target must not be playable.
await ev("(() => { const i = document.querySelector('[data-custom=goal]'); i.value = setup.start.title; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()");
await sleep(3000);
check('identical start/target disables Play', await ev("setup.goal.title === setup.start.title && document.querySelector('#btnPlay').disabled"));

// Image-map <area> links must be intercepted like <a> links.
// A hash-only change would not reload the page, so go through about:blank.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Icons.png&target=Diamond&rules=noback', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
check('challenge link sets the rules', await ev("rules().join() === 'noback' && document.querySelector('#rules input[value=noback]').checked && document.querySelector('#setupStatus').textContent.includes('with No Back')"));
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
await sleep(1000);
f = await frameCtx();
const areas = JSON.parse(await ev("JSON.stringify({ all: document.querySelectorAll('area').length, live: document.querySelectorAll('area.mwg-live').length })", f));
check('image-map links are clickable', areas.live > 0, `areas=${areas.all} live=${areas.live}`);

// No hubs: links to hubs and their redirects are dead, except a hub that is the target.
// Blind target: no target picture or description on the card or in the HUD, and no peek.
await ev("store.set('mwg.pathCollapsed', true)");   // stands in for collapsing it before the reload
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Crafting&rules=nohubs,blind', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
const blindCard = "document.querySelector('#cardGoal .desc').textContent + ' ' + [...document.querySelectorAll('#cardGoal img')].every(i => i.classList.contains('hidden'))";
check('Blind target hides the target card', await ev(blindCard) === 'Hidden: Blind target. true', await ev(blindCard));
await ev("document.querySelector('#rules input[value=blind]').click()");
check('turning Blind target off shows it again', !(await ev(blindCard)).startsWith('Hidden'), await ev(blindCard));
await ev("document.querySelector('#rules input[value=blind]').click()");
await ev("document.querySelector('#btnPlay').click()");
check('a collapsed path stays collapsed after a reload', await ev("document.querySelector('.main').classList.contains('collapsed') && document.querySelector('#btnPath').getAttribute('aria-expanded') === 'false'"));
await ev("document.querySelector('#btnPath').click()");
check('No hubs game loads', await until("game.path.length === 1 && !game.loading"));
check('Blind target hides the HUD and path pictures and peek', await ev("document.querySelector('#hudImg').classList.contains('hidden') && document.querySelector('#pathArt').classList.contains('hidden') && document.querySelector('#btnPeek').classList.contains('hidden')"));
check('hub redirects are known', await ev("hubTitles().then(m => m.get('Blocks') === 'Block' && m.get('Mining') === 'Breaking')"));
f = await frameCtx();
const hubLinks = JSON.parse(await ev(`JSON.stringify(Object.fromEntries(['Item', 'Java_Edition', 'Crafting', 'Pickaxe'].map(t =>
  [t, [...document.querySelectorAll('a[href^="/w/' + t + '"]')].filter(a => a.getAttribute('href').split('#')[0] === '/w/' + t).map(a => a.classList.contains('mwg-live') ? 'live' : 'dead')])))`, f));
const allAre = (t, s) => hubLinks[t].length > 0 && hubLinks[t].every(x => x === s);
check('No hubs disables hub links', allAre('Item', 'dead') && allAre('Java_Edition', 'dead'), JSON.stringify(hubLinks));
check('No hubs keeps the target and other links live', allAre('Crafting', 'live') && allAre('Pickaxe', 'live'));

// No navboxes: the navbox tables (and their Navigation heading) are hidden and their links dead; links in the text still work.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe&rules=nonav', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
f = await frameCtx();
const nav = JSON.parse(await ev(`JSON.stringify({ boxes: document.querySelectorAll('.navbox').length,
  shown: [...document.querySelectorAll('.navbox, #Navigation')].filter(e => e.checkVisibility()).length,
  liveInBox: document.querySelectorAll('.navbox a.mwg-live').length, live: document.querySelectorAll('a.mwg-live').length })`, f));
check('No navboxes hides navboxes and kills their links', nav.boxes > 0 && nav.shown === 0 && nav.liveInBox === 0 && nav.live > 50, JSON.stringify(nav));

// A failed image is loaded again once; one that fails twice gets mwg-broken, which keeps its box and hides its alt text.
// Two icons are added to the article and their requests intercepted: the first fails once and then goes through to the
// wiki, the second always fails.
const icon = k => `https://minecraft.wiki/images/Invicon_Nether_Wart.png?mwg-${k}`;
const tries = {};
onEvent = d => {
  if (d.method !== 'network.beforeRequestSent' || !d.params.isBlocked) return;
  const { request, url } = d.params.request;
  tries[url] = (tries[url] || 0) + 1;
  send(tries[url] === 1 || url === icon('broken') ? 'network.failRequest' : 'network.continueRequest', { request });
};
await send('session.subscribe', { events: ['network.beforeRequestSent'] });
const intercept = (await send('network.addIntercept', { phases: ['beforeRequestSent'],
  urlPatterns: ['retry', 'broken'].map(k => ({ type: 'string', pattern: icon(k) })) })).result.intercept;
await ev(`for (const k of ['retry', 'broken']) {
  const img = document.createElement('img');
  img.id = 'test-' + k;
  img.alt = 'A long alt text that would run far out of a 32 pixel inventory slot';
  img.width = img.height = 32;
  document.body.prepend(img);
  img.src = '/images/Invicon_Nether_Wart.png?mwg-' + k;
}`, f);
const retried = "document.getElementById('test-retry')", broken = "document.getElementById('test-broken')";
check('a failed image is retried and loads', await until(`${retried}.naturalWidth > 0 && !${retried}.classList.contains('mwg-broken')`, 15000, f)
  && tries[icon('retry')] === 2, `tries=${JSON.stringify(tries)}`);
const brokenLook = `(r => r.width + 'x' + r.height + ' ' + getComputedStyle(${broken}).color)(${broken}.getBoundingClientRect())`;
check('an image that fails twice keeps its box and hides its alt text', await until(`${broken}.classList.contains('mwg-broken')`, 15000, f)
  && await ev(`${brokenLook} === '32x32 rgba(0, 0, 0, 0)'`, f) && tries[icon('broken')] === 2,
  `${await ev(brokenLook, f)} tries=${JSON.stringify(tries)}`);
await shot('5-broken-image');
await send('network.removeIntercept', { intercept });
await send('session.unsubscribe', { events: ['network.beforeRequestSent'] });
onEvent = () => {};

// Daily: #daily=<date> loads that day's pair and rule, the same on every call, a different pair the next day. 2026-01-02's
// rule is Checkpoint, so it also fixes the checkpoint; 2026-01-01's is No Back, which picks none. The result records it.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#daily=2026-01-02&rules=limit', wait: 'complete' });
check('daily pair loads', await until("!document.querySelector('#btnPlay').disabled && setup.daily === '2026-01-02'", 60000),
  await ev("setup.start?.title + ' -> ' + setup.goal?.title"));
check('daily sets its rule and checkpoint', await ev("rules().join() === 'checkpoint' && !!setup.via && !document.querySelector('#cardVia').classList.contains('hidden') && document.querySelector('#setupStatus').textContent.includes('with Checkpoint')"));
const pairOf = p => `${p}.start.title + ' -> ' + ${p}.via?.title + ' -> ' + ${p}.goal.title`;
const daily = await ev(pairOf('setup'));
check('daily pair is deterministic', await ev(`dailyPair('2026-01-02').then(p => p.rule === 'checkpoint' && ${pairOf('p')})`) === daily &&
  await ev(`dailyPair('2026-01-01').then(p => p.rule === 'noback' && !p.via && ${pairOf('p')} !== ${JSON.stringify(daily)})`), daily);
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
await ev("document.querySelector('#btnGiveUp').click()");
await ev("document.querySelector('#gQuit').click()");
check('daily result is recorded', await ev("(r => r.daily === '2026-01-02' && r.via === setup.via.title && r.rules.join() === 'checkpoint')(store.get('mwg.history', [])[0]) && document.querySelector('#modal').textContent.includes('Daily 2026-01-02')"));
await ev("document.querySelector('#mNew').click()");
check('rerolling leaves the daily pair', await ev('setup.daily === null'));
check('history marks the daily', await ev("document.querySelector('#history tbody tr').textContent.includes('Daily 2026-01-02, Checkpoint')"));
await ev("loadDaily('2026-01-02')");
await until("setup.daily === '2026-01-02' && setup.busy === 0", 60000);
await ev("document.querySelector('#rules input[value=limit]').click()");
check('another rule leaves the daily', await ev("setup.daily === null && document.querySelector('#setupStatus').textContent.includes('no longer counts')"));
await ev("document.querySelector('#rules input[value=limit]').click()");

// Checkpoint game: reaching the target before the checkpoint doesn't count. A best with another checkpoint is not this
// pair's best (the seeded 1-click game would otherwise make it "Your best").
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&via=Pickaxe&target=Diamond%20Pickaxe&rules=checkpoint', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
check('challenge link sets the checkpoint', await ev(`setup.via?.title === 'Pickaxe' && rules().includes('checkpoint') && ${viaCard} && challengeLink().includes('&via=Pickaxe&')`),
  await ev('challengeLink()'));
await ev(`(h => { h.unshift({ start: 'Diamond', goal: 'Diamond Pickaxe', via: 'Zombie', rules: ['checkpoint'], won: true, clicks: 1, ms: 1000, at: Date.now(), path: [] });
  store.set('mwg.history', h); })(store.get('mwg.history', []))`);
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
const hudLbl = "document.querySelector('#hudLbl').textContent + ' ' + document.querySelector('#hudGoal').textContent";
check('HUD shows the checkpoint first', await ev(hudLbl) === 'Checkpoint Pickaxe', await ev(hudLbl));
check('the path picture is the checkpoint', await ev("document.querySelector('#pathArt').src === game.via.img && !!game.via.img"));
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwg-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
await until("game.path.length === 2 && !game.loading");
check('target before the checkpoint does not win', await ev("game.active") === true && await ev(hudLbl) === 'Checkpoint Pickaxe');
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwg-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
await until("game.path.length === 3 && !game.loading");
check('reaching the checkpoint switches to the target', await ev(hudLbl) === 'Target Diamond Pickaxe' && await ev('game.path[2].via === true') &&
  await ev("document.querySelector('#pathArt').src === game.goal.img && !!game.goal.img"), await ev(hudLbl));
check('reaching the checkpoint is celebrated', await ev("!document.querySelector('#toast').classList.contains('hidden') && document.querySelector('#toast').textContent.includes('Diamond Pickaxe') && document.querySelector('.hud .goal').classList.contains('reached') && document.querySelector('#pathList li.via')?.textContent.includes('Pickaxe')"));
f = await frameCtx();
check('the target passed before the checkpoint is not marked as seen', await ev(`(links => links.length > 0 && !links.some(a => a.classList.contains('mwg-seen')))(
  [...document.querySelectorAll('a.mwg-live')].filter(a => /^\\/w\\/Diamond_Pickaxe(#|$)/i.test(a.getAttribute('href'))))`, f));
await shot('6-checkpoint');
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwg-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
check('checkpoint game wins', await until("!game.active && !document.querySelector('#modalBg').classList.contains('hidden')"), `clicks=${await ev('clicks()')}`);
const viaModal = await ev("document.querySelector('#modal').textContent");
check('checkpoint is recorded and kept out of other bests', await ev("store.get('mwg.history', [])[0].via === 'Pickaxe'") &&
  viaModal.includes('Diamond → Pickaxe → Diamond Pickaxe') && !/personal best|Your best/.test(viaModal));

// A theme stylesheet added by the host page shows up in the picker and, marked data-mwg-default, wins over a saved
// theme that no longer exists. A preload script stands in for the host page injecting it into <head>.
await ev("localStorage.setItem('mwg.theme', JSON.stringify('Gone'))");
const preload = (await send('script.addPreloadScript', { functionDeclaration: `() => {
  const add = () => document.head.insertAdjacentHTML('beforeend', '<style data-mwg-theme="Test" data-mwg-default>:root[data-theme="Test"] { --bg: #000; color-scheme: dark; }</style>');
  if (document.head) add(); else new MutationObserver((_, o) => { if (document.head) { o.disconnect(); add(); } }).observe(document, { childList: true, subtree: true });
}` })).result.script;
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl, wait: 'complete' });
const injected = await ev("[...document.querySelectorAll('#themeSelect option')].map(o => o.value).join(',') + ' ' + document.querySelector('#themeSelect').value + ' ' + document.documentElement.dataset.theme + ' ' + themeIsDark() + ' ' + getComputedStyle(document.body).backgroundColor");
check('host-page theme is listed and used as the default', injected === 'auto,light,dark,Test Test Test true rgb(0, 0, 0)', injected);
await send('script.removePreloadScript', { script: preload });
await ev("localStorage.removeItem('mwg.theme')");

// Clear history asks first: Cancel keeps the games, confirming removes them and hides the table.
const histLen = "store.get('mwg.history', []).length";
await ev("document.querySelector('#btnClearHistory').click()");
await shot('4-clear-history');
await ev("document.querySelector('#hKeep').click()");
check('cancelling Clear history keeps it', await ev(`${histLen} > 0 && !document.querySelector('#history').classList.contains('hidden')`), await ev(histLen));
await ev("document.querySelector('#btnClearHistory').click()");
await ev("document.querySelector('#hClear').click()");
check('Clear history empties it', await ev(`${histLen} === 0 && document.querySelector('#history').classList.contains('hidden') && document.querySelector('#modalBg').classList.contains('hidden')`),
  await ev(histLen));

await send('session.end', {});
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
