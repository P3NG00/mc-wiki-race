// End-to-end test: drives headless Firefox over WebDriver BiDi against index.html opened from file://.
// Hits the live minecraft.wiki API. Usage: test/run-e2e.sh (starts Firefox), or
//   node test/e2e.mjs <bidi-port> <file-url> [screenshot-dir]
import fs from 'node:fs';

const [port, fileUrl, shotDir] = process.argv.slice(2);
const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
let id = 0;
const pending = new Map();
let onEvent = () => {};
// Uncaught errors and rejections in the page and the article frame, reported by a preload script (below) and checked at
// the end. Its listeners are on the window, so failed images, fonts and requests, which Firefox also logs, don't count.
const jsErrors = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === 'script.message' && d.params.channel === 'mwr-errors') jsErrors.push(d.params.data.value);
  else if (d.method) onEvent(d);
};
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

await new Promise(r => ws.onopen = r);
await send('session.new', { capabilities: {} });
await send('session.subscribe', { events: ['script.message'] });
await send('script.addPreloadScript', { functionDeclaration: `report => {
  addEventListener('error', e => report(String(e.message)));
  addEventListener('unhandledrejection', e => report('Unhandled rejection: ' + (e.reason?.message ?? e.reason)));
}`, arguments: [{ type: 'channel', value: { channel: 'mwr-errors' } }] });
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
check('collapsing the path hides it and keeps the credit', await ev(`!${shown('#pathList')} && ${shown('#credit')} && store.get('mwr.pathCollapsed') === true`) &&
  await frameWidth() > wide, `frame ${wide} -> ${await frameWidth()}`);
await shot('2b-collapsed');
await ev("document.querySelector('#btnPath').click()");
check('expanding the path shows it again', await ev(`${shown('#pathList')} && store.get('mwr.pathCollapsed') === false`) && await frameWidth() === wide);

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
const links = JSON.parse(await ev("JSON.stringify({ live: document.querySelectorAll('a.mwr-live').length, tutorial: document.querySelectorAll('a[href^=\"/w/Tutorial:\"]').length, tutorialLive: document.querySelectorAll('a.mwr-live[href^=\"/w/Tutorial:\"]').length, sheets: document.styleSheets.length })", f));
check('article links are clickable', links.live > 100, `live=${links.live}`);
check('Tutorial: links are disabled', links.tutorial > 0 && links.tutorialLive === 0, `tutorial=${links.tutorial}`);
check('wiki stylesheets loaded', links.sheets >= 4, `sheets=${links.sheets}`);
// Hovering a live link tints it. The pointer moves to the link itself (an element origin, which works inside the frame)
// and back to the page's corner, so no later link stays hovered.
const pickaxeLink = "[...document.querySelectorAll('a.mwr-live')].find(a => a.getAttribute('href') === '/w/Pickaxe')";
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

await ev("[...document.querySelectorAll('a.mwr-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
check('clicking a link navigates', await until("game.path.length === 2 && !game.loading"), await ev("game.path.map(p => p.title).join(' > ')"));
f = await frameCtx();
const seenLinks = JSON.parse(await ev(`JSON.stringify(['Diamond', 'Iron_Pickaxe'].map(t =>
  [...document.querySelectorAll('a.mwr-live')].filter(a => a.getAttribute('href').split('#')[0] === '/w/' + t).map(a => a.classList.contains('mwr-seen'))))`, f));
check('links to articles on the path are marked', seenLinks[0].length > 0 && seenLinks[0].every(Boolean) &&
  seenLinks[1].length > 0 && !seenLinks[1].some(Boolean), JSON.stringify(seenLinks));
// The crafting grid's slots cycle through their frames (Wooden, Golden, Stone… Pickaxe) and hold still under the pointer.
const outputSlot = "document.querySelector('.mcui .invslot-large.animated')";
const shownItem = `${outputSlot}?.querySelector(':scope > .animated-active a')?.title`;
const firstItem = await ev(shownItem, f);
const slotRef = (await send('script.evaluate', { target: { context: f }, expression: `(s => (s.scrollIntoView({ block: 'center' }), s))(${outputSlot})`, awaitPromise: false })).result?.result?.sharedId;
check('crafting slots animate', !!firstItem && await until(`${shownItem} !== ${JSON.stringify(firstItem)}`, 5000, f),
  `${firstItem} -> ${await ev(shownItem, f)}`);
await moveTo({ type: 'element', element: { sharedId: slotRef } });
await sleep(300);
const heldItem = await ev(shownItem, f);
await sleep(4500);
const stillItem = await ev(shownItem, f);
check('crafting slots hold still under the pointer', !!heldItem && stillItem === heldItem, `${heldItem} -> ${stillItem}`);
await moveTo('viewport');
await send('input.releaseActions', { context: ctx });
// The infobox's tabs (Wooden, Golden, Stone…) show one picture at a time, and clicking a tab switches to it.
const tabState = `JSON.stringify((t => ({ tabs: [...t.querySelectorAll('.tabbernav li')].map(li => (li.classList.contains('tabberactive') ? '*' : '') + li.textContent),
  shown: [...t.querySelectorAll(':scope > .tabbertab')].filter(p => p.offsetHeight).map(p => p.dataset.title) }))(document.querySelector('.infobox .tabber')))`;
const tabsBefore = JSON.parse(await ev(tabState, f));
await ev("document.querySelectorAll('.infobox .tabbernav a')[1].click()", f);
const tabsAfter = JSON.parse(await ev(tabState, f));
check('infobox tabs show one panel and switch', tabsBefore.tabs.length > 2 && tabsBefore.tabs[0] === '*' + tabsBefore.shown[0] && tabsBefore.shown.length === 1 &&
  tabsAfter.tabs[1] === '*' + tabsAfter.shown[0] && tabsAfter.shown.length === 1 && await ev('game.path.length === 2 && !game.loading'), JSON.stringify([tabsBefore, tabsAfter]));

// Back reuses the cached article instead of calling the API again.
await ev("window.apiCalls = 0; { const orig = api; window.api = Object.assign(p => (apiCalls++, orig(p)), { orig }); }");
await ev("document.querySelector('#btnBack').click()");
check('Back loads from cache', await until("game.path.length === 3 && !game.loading") && await ev('apiCalls === 0'),
  `${await ev("game.path.map(p => p.title).join(' > ')")} apiCalls=${await ev('apiCalls')}`);
await ev("window.api = window.api.orig");

// Switching theme restyles the loaded article in place: same document, wiki dark/light body class swapped.
f = await frameCtx();
await ev("window.mwrMarker = 1", f);
const frameTheme = "(window.mwrMarker === 1 ? '' : 'reloaded ') + (document.body.classList.contains('wgl-theme-dark') ? 'dark' : 'light') + ' ' + getComputedStyle(document.documentElement).backgroundColor";
await ev("setTheme('dark')");
check('dark theme switches the article in place', await until(`${frameTheme} === 'dark rgb(18, 18, 18)'`, 5000, f) && await ev("themeIsDark()") === true, await ev(frameTheme, f));
await ev("setTheme('light')");
check('light theme switches the article in place', await until(`${frameTheme} === 'light rgb(255, 255, 255)'`, 5000, f) && await ev("themeIsDark()") === false, await ev(frameTheme, f));
// A theme change made while the article is still loading reaches it once the frame reports ready.
await ev("renderArticle(parseCache.get('Diamond'), null, game.navToken); setTheme('dark')");
check('theme change during load is applied', await until("window.mwrMarker === undefined && document.body.classList.contains('wgl-theme-dark')", 15000, f),
  await ev(frameTheme, f));
await ev("setTheme('auto')");

f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
check('reaching the target wins', await until("!game.active && !document.querySelector('#modalBg').classList.contains('hidden')"),
  `clicks=${await ev('clicks()')}`);
// Golf: the result scores the win against par, from the link graph files, and shows a shortest route. This Relaxed game
// took 3 clicks, Back included, for a pair linked directly or nearly.
const shortest = "[...document.querySelectorAll('#mBest li')].map(li => li.textContent).join(' → ')";
check('the result scores the win against par and shows a route', await until(`document.querySelector('#par').textContent === 'Going by the wiki’s copy from ' + WIKI_DATA.snapshot + '.'
  && document.querySelector('#mScore').textContent.startsWith(golfScore(clicks(), game.par).name) && document.querySelector('#mBestTitle').textContent === 'Shortest route · par ' + game.par
  && (r => r.startsWith('Diamond → ') && r.endsWith(' → Diamond Pickaxe'))(${shortest})`) &&
  await ev("game.par >= 1 && game.par <= 2 && savedGames()[0].par === game.par && document.querySelector('#mPar').textContent === String(game.par)"),
  `${await ev("document.querySelector('#mScore').textContent")} | ${await ev(shortest)}`);
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
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
await until("game.path.length === 2 && !game.loading");
await ev("goBack()");
await sleep(1000);
check('No Back blocks goBack()', await ev("game.path.length === 2 && !game.loading"), await ev("game.path.map(p => p.title).join(' > ')"));
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
check('No Back game wins', await until("!game.active && !document.querySelector('#modalBg').classList.contains('hidden')"), `clicks=${await ev('clicks()')}`);
const modal = await ev("document.querySelector('#modal').textContent");
check('result records the rules', await ev("JSON.stringify(store.get('mwr.history', [])[0].rules) === '[\"noback\"]'") && modal.includes('No Back'),
  await ev("JSON.stringify(store.get('mwr.history', [])[0].rules)"));
check('personal best ignores games with other rules', !/personal best|Your best/.test(modal));
await ev("document.querySelector('#rules input[value=noback]').click()");

// Six clicks: the HUD counts down to the limit and the game is lost on the last click that misses the target.
// Pickaxe and Back alternate, so every article after the first comes from the parse cache.
await ev("document.querySelector('#rules input[value=limit]').click()");
await ev("document.querySelector('#mSame').click()");
await until("game.path.length === 1 && !game.loading");
check('Six clicks shows the limit', await ev("document.querySelector('#hudClicks').textContent === '0' && document.querySelector('#hudClicksK').textContent === 'of 6' && document.querySelectorAll('#hudMeter i').length === 6"),
  await ev("document.querySelector('.hud .stat').textContent"));
for (let i = 1; i <= 6; i++) {
  await ev(i % 2 ? "navigate('Pickaxe', null)" : 'goBack()');
  await until(`game.path.length === ${i + 1} && !game.loading`);
}
check('running out of clicks ends the game', await until("!game.active && document.querySelector('#modal h2').textContent === 'Out of clicks'", 5000),
  await ev("game.path.map(p => p.title).join(' > ')"));
check('result records running out of clicks', await ev("(([r]) => r.outOfClicks === true && !r.won && r.clicks === 6)(store.get('mwr.history', []))"));
await ev("document.querySelector('#rules input[value=limit]').click()");

// Random rolls in every pool.
await ev("document.querySelector('#mNew').click()");
check('Everyday roll', await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
// Rolls take their titles and link counts from wiki-data.js, so the only requests they make are for page info. The fetch
// wrapper records them, and counts how many are in flight at once.
await ev(`window.inFlight = 0; window.maxInFlight = 0; window.requests = []; window.fetch = Object.assign(async (...a) => {
  requests.push(String(a[0]));
  maxInFlight = Math.max(maxInFlight, ++inFlight);
  try { return await fetch.orig(...a); } finally { inFlight--; }
}, { orig: fetch.bind(window) })`);
for (const m of ['popular', 'deep', 'chaos']) {
  await ev(`document.querySelector('input[value=${m}]').click()`);
  await sleep(500);
  check(`${m} roll`, await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
}
check('rolls only ask the wiki for page info', await ev("requests.length > 0 && requests.every(u => new URL(u).searchParams.get('prop') === INFO_PARAMS.prop && !/[?&](list|generator)=/.test(u))"),
  await ev("requests.filter(u => !u.includes('prop=pageprops')).slice(0, 2).join(' ')"));
// Ten at once: no more than API_CONCURRENCY are in flight, and the rest wait their turn.
await ev("Promise.all(['Stone', 'Dirt', 'Sand', 'Gravel', 'Clay', 'Snow', 'Ice', 'Obsidian', 'Glass', 'Wool'].map(t => pageInfo(t)))");
await ev('window.fetch = fetch.orig');
// pageprops' description on infobox pages is the infobox caption ("Java Edition"); the intro's first paragraph is used.
const zpDesc = await ev("pageInfo('Zombified Piglin').then(i => i.desc)");
check('description is the first paragraph', zpDesc.startsWith('Zombified piglins are') && !zpDesc.includes('\n'), zpDesc);
// Book and comic objects, joke and removed features are filed in game categories too: the pool leaves them out, Chaos doesn't.
check('fictional, joke and removed things are left out of the pool', await ev("['Frostgate', 'Ankle Monitor', 'Steppe dirt'].every(t => ARTICLES.has(t) && !POOL_TITLES.includes(t)) && POOL_TITLES.includes('Diamond')"));
check('at most API_CONCURRENCY requests at once', await ev('maxInFlight === API_CONCURRENCY'), `max=${await ev('maxInFlight')}`);

check('a Chaos target is linked well enough to be reached', await ev('ARTICLES.get(setup.goal.title)?.body >= MIN_BACKLINKS'),
  await ev("setup.goal.title + ' ' + JSON.stringify(ARTICLES.get(setup.goal.title))"));
// The pool modes draw a topic, then an article, and never take the start and target from the same topic (the navbox would
// put them one click apart). Popular and Deep cuts keep to their tier. planGroups and candidate are called directly with
// the mode's button set without a change event, so this makes no requests and leaves the cards alone.
check('each pool keeps to its tier, with the start and target from different topics', await ev(`(() => {
  const ok = [];
  for (const m of ['popular', 'everyday', 'deep']) {
    document.querySelector('input[value=' + m + ']').checked = true;
    const tier = { popular: 'popular', deep: 'deep' }[m];
    for (let i = 0; i < 50; i++) {
      const plan = planGroups(['start', 'goal']), s = candidate(plan.start, false), g = candidate(plan.goal, true);
      ok.push(groupOf(s) !== groupOf(g) && ARTICLES.get(g).body >= MIN_BACKLINKS && (!tier || [s, g].every(t => ARTICLES.get(t).tiers.includes(tier))));
    }
  }
  document.querySelector('input[value=chaos]').checked = true;
  return ok.every(Boolean);
})()`));
const startBefore = await ev('setup.start.title');

// A topic rerolls only the target (in Chaos, whatever the start's topic), from that topic.
await ev("(s => { s.value = 'mobs'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#topic'))");
await sleep(500);
check('Mobs topic target', await until("!document.querySelector('#btnPlay').disabled", 60000) && await ev('setup.start.title') === startBefore &&
  await ev("ARTICLES.get(setup.goal.title)?.topic === 'mobs'"), await ev("setup.goal.title"));
// The result keeps the target's topic, and shows it.
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
await ev("document.querySelector('#btnGiveUp').click()");
await ev("document.querySelector('#gQuit').click()");
const rolled = await ev("(([r]) => r.topic)(store.get('mwr.history', []))");
// That game came from a challenge link without rules, so it is Relaxed, which the note names too.
check('result records the topic', rolled === 'mobs' && await ev("document.querySelector('#modal .note').textContent.endsWith('· Mobs, Relaxed')"),
  `${rolled} | ${await ev("document.querySelector('#modal .note').textContent")}`);
await ev("document.querySelector('#mNew').click()");
await until("!document.querySelector('#btnPlay').disabled", 60000);
await ev("(s => { s.value = 'any'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#topic'))");
await sleep(500);
await until("!document.querySelector('#btnPlay').disabled", 60000);

// Picking Relay shows the checkpoint card with a third, different article; going back to Race hides it.
const viaCard = "!document.querySelector('#slot-via0').classList.contains('hidden')";
await ev("document.querySelector('input[name=game][value=relay]').click()");
check('Relay adds a distinct checkpoint', await until(`${viaCard} && !document.querySelector('#btnPlay').disabled`, 60000) &&
  await ev("new Set([setup.start.title, setup.via0.title, setup.goal.title]).size === 3"), await ev("setup.via0?.title"));
await ev("document.querySelector('input[name=game][value=race]').click()");
check('back to Race hides it', await ev(`!(${viaCard}) && !document.querySelector('#btnPlay').disabled`));

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
check('challenge link sets the rules', await ev("rules().join() === 'noback' && level() === 'relaxed' && document.querySelector('#rules input[value=noback]').checked && document.querySelector('#setupStatus').textContent.includes('with Relaxed, No Back')"));
// Difficulty sets No navboxes and No hubs: a link's rules give its difficulty (none is Relaxed, as every game was before
// difficulty; No hubs alone, from an older link, is Hard), the Rules row has neither box, Normal is the page's default,
// and the settings text names the difficulty unless it is Normal.
check('difficulty from a challenge link\'s rules', await ev(`(() => {
  const was = rules();
  const got = [[], ['nonav'], ['nonav', 'nohubs'], ['nohubs'], ['noback', 'nonav']].map(r => (setRules(r), level() + ':' + rules().join())).join(' ');
  setRules(was);
  return got;
})()`) === 'relaxed: normal:nonav hard:nohubs,nonav hard:nohubs,nonav normal:noback,nonav');
check('the Rules row leaves the difficulty\'s rules to the Difficulty row, Normal by default',
  await ev("!document.querySelector('#rules input[value=nonav]') && !document.querySelector('#rules input[value=nohubs]') && document.querySelector('input[name=level][value=normal]').defaultChecked"));
check('settings text names the difficulty unless it is Normal',
  await ev("[[], ['nonav'], ['nohubs', 'nonav', 'blind']].map(rulesText).join('|')") === 'Relaxed||Hard, Blind target');
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
await sleep(1000);
f = await frameCtx();
const areas = JSON.parse(await ev("JSON.stringify({ all: document.querySelectorAll('area').length, live: document.querySelectorAll('area.mwr-live').length })", f));
check('image-map links are clickable', areas.live > 0, `areas=${areas.all} live=${areas.live}`);

// Beacon's layered blueprint: its layer names become buttons, and choosing one hides the layers above it.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Beacon&target=Diamond', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
f = await frameCtx();
// The wiki fades layers in and out over 200 ms, so each state is waited for. Beacon's starts on its top layer, all shown.
const layers = "[...document.querySelector('.layered-blueprint').querySelectorAll('.layered-blueprint-layer')].map(l => getComputedStyle(l).visibility[0]).join('')";
const allShown = await until(`/^v{3,}$/.test(${layers})`, 3000, f);
const layersBefore = await ev(layers, f);
await ev("document.querySelector('.layered-blueprint label.layered-blueprint-tab:nth-of-type(2)').click()", f);
const aboveHidden = await until(`/^vvh+$/.test(${layers})`, 3000, f);
check('blueprint layers can be chosen', allShown && aboveHidden && await ev('game.path.length === 1'), `${layersBefore} -> ${await ev(layers, f)}`);
// A calculator only says it is loading without the wiki's script, so it is hidden.
check('calculator placeholders are hidden', await ev("(c => c.length > 0 && c.every(e => !e.offsetHeight))([...document.querySelectorAll('.mcw-calc')])", f));

// Content: the Content and Spin-offs rows. Rolls draw from what is on, and links into a spin-off work only in a game that
// has it on, by its checkbox or because a card's page is in it. The boxes are set without a change event where a reroll
// would replace the pair.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Minecraft%20Dungeons&target=Diamond', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
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
check('leaving Chaos gives the Content boxes back as they were', await ev("[...document.querySelectorAll('#content input')].every(b => !b.checked && !b.disabled)"));
await until("!document.querySelector('#btnPlay').disabled", 30000);
await ev("document.querySelector('#spinoffs input[value=Legends]').click()");
check('All shows a dash when only some spin-offs are on', await ev("(a => a.indeterminate && !a.checked)(document.querySelector('#spinAll'))"));
await ev("document.querySelector('#spinAll').click()");
check('All turns every spin-off on', await ev("spinoffBoxes().every(b => b.checked) && !document.querySelector('#spinAll').indeterminate"));
await ev("document.querySelector('#spinAll').click()");
await until("!document.querySelector('#btnPlay').disabled && setup.busy === 0", 30000);
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Minecraft%20Dungeons&target=Diamond', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
const dungeonsLinks = async () => JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('a[href^=\"/w/Dungeons:\"]')].map(a => a.classList.contains('mwr-live')))", await frameCtx()));
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
const offLinks = await dungeonsLinks();
check('links into a spin-off that is off are dead', offLinks.length > 0 && offLinks.every(l => !l), `${offLinks.length} links`);
await ev("finish(false)");
await ev("closeModal(); toSetup(); document.querySelector('#spinoffs input[value=Dungeons]').checked = true");
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
const onLinks = await dungeonsLinks();
check('links into a spin-off that is on work', onLinks.length > 0 && onLinks.every(l => l), `${onLinks.length} links`);
await ev("finish(false)");
check('the result records the Content that was on', await ev("(([r]) => JSON.stringify(r.content) === '[\"Dungeons\"]' && settingsText(r) === 'Content: Dungeons, Relaxed')(savedGames())"),
  await ev("JSON.stringify(savedGames()[0].content)"));
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Dungeons:Creeper&target=Diamond', wait: 'complete' });
check('a challenge link can start on a spin-off page', await until("!document.querySelector('#btnPlay').disabled && setup.start?.title === 'Dungeons:Creeper'"),
  await ev("setup.start?.title"));
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
check('a card in a spin-off turns its links on without the checkbox', await ev("JSON.stringify(game.content) === '[\"Dungeons\"]'") &&
  (await dungeonsLinks()).every(l => l), await ev("JSON.stringify(game.content)"));
await ev("finish(false); closeModal(); toSetup()");
check('history entries with unknown Content are left out', await ev(`(r => isRecord(r) && !isRecord({ ...r, content: ['Nope'] }))(savedGames()[0])`));

// No hubs: links to hubs and their redirects are dead, except a hub that is the target.
// Blind target: no target picture or description on the card or in the HUD, and no peek.
await ev("store.set('mwr.pathCollapsed', true)");   // stands in for collapsing it before the reload
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
check('hub redirects are known', await ev("HUB_TITLES.get('Blocks') === 'Block' && HUB_TITLES.get('Mining') === 'Breaking'"));
f = await frameCtx();
// No hubs on its own is Hard, so the navboxes are gone too; this looks at links in the article itself. Every link to a
// hub, or a redirect to one, is dead except those to the target's (Crafting).
const hubMap = JSON.parse(await ev('JSON.stringify(Object.fromEntries(HUB_TITLES))'));
const textLinks = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('a[href^="/w/"]')].filter(a => !a.closest('.navbox'))
  .map(a => [decodeURIComponent(a.getAttribute('href').slice(3).split('#')[0]).replace(/_/g, ' '), a.classList.contains('mwr-live')]))`, f));
const liveness = keep => textLinks.filter(([title]) => keep(title)).map(([, live]) => live);
const toHubs = liveness(t => hubMap[t] && hubMap[t] !== 'Crafting'), toTarget = liveness(t => hubMap[t] === 'Crafting'), toPickaxe = liveness(t => t === 'Pickaxe');
check('No hubs disables hub links', toHubs.length > 0 && toHubs.every(live => !live), `${toHubs.length} hub links, ${toHubs.filter(Boolean).length} live`);
check('No hubs keeps the target and other links live', toTarget.length > 0 && toTarget.every(Boolean) && toPickaxe.length > 0 && toPickaxe.every(Boolean));

// No navboxes: the navbox tables (and their Navigation heading) are hidden and their links dead; links in the text still work.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe&rules=nonav', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
f = await frameCtx();
const nav = JSON.parse(await ev(`JSON.stringify({ boxes: document.querySelectorAll('.navbox').length,
  shown: [...document.querySelectorAll('.navbox, #Navigation')].filter(e => e.checkVisibility()).length,
  liveInBox: document.querySelectorAll('.navbox a.mwr-live').length, live: document.querySelectorAll('a.mwr-live').length })`, f));
check('No navboxes hides navboxes and kills their links', nav.boxes > 0 && nav.shown === 0 && nav.liveInBox === 0 && nav.live > 50, JSON.stringify(nav));

// A failed image is loaded again once; one that fails twice gets mwr-broken, which keeps its box and hides its alt text.
// Two icons are added to the article and their requests intercepted: the first fails once and then goes through to the
// wiki, the second always fails.
const icon = k => `https://minecraft.wiki/images/Invicon_Nether_Wart.png?mwr-${k}`;
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
  img.src = '/images/Invicon_Nether_Wart.png?mwr-' + k;
}`, f);
const retried = "document.getElementById('test-retry')", broken = "document.getElementById('test-broken')";
check('a failed image is retried and loads', await until(`${retried}.naturalWidth > 0 && !${retried}.classList.contains('mwr-broken')`, 15000, f)
  && tries[icon('retry')] === 2, `tries=${JSON.stringify(tries)}`);
const brokenLook = `(r => r.width + 'x' + r.height + ' ' + getComputedStyle(${broken}).color)(${broken}.getBoundingClientRect())`;
check('an image that fails twice keeps its box and hides its alt text', await until(`${broken}.classList.contains('mwr-broken')`, 15000, f)
  && await ev(`${brokenLook} === '32x32 rgba(0, 0, 0, 0)'`, f) && tries[icon('broken')] === 2,
  `${await ev(brokenLook, f)} tries=${JSON.stringify(tries)}`);
await shot('5-broken-image');
await send('network.removeIntercept', { intercept });
await send('session.unsubscribe', { events: ['network.beforeRequestSent'] });
onEvent = () => {};

// A link fragment that would open an HTML comment and a script inside the frame's script (the wiki renders
// [[X#&lt;!--&lt;script&gt;]] as one) must not stop the next article's scripts from running.
await ev(`(a => { a.href = '/w/Iron_Ingot#<!--<script>x'; a.textContent = 'x'; document.body.prepend(a); a.click(); })(document.createElement('a'))`, f);
check('a fragment with <!--<script> still renders the article', await until("game.path.at(-1)?.title === 'Iron Ingot' && !game.loading", 10000) &&
  await ev("document.querySelectorAll('a.mwr-live').length > 50", await frameCtx()), await ev("game.path.at(-1)?.title + ' loading=' + game.loading"));

// Daily: #daily=<date> loads that day's pair and rule, the same on every call, a different pair the next day. 2026-01-06's
// rule is Checkpoint, so it also fixes the checkpoint; 2026-01-05's is No Back, which picks none. The result records it.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#daily=2026-01-06&rules=limit', wait: 'complete' });
check('daily pair loads', await until("!document.querySelector('#btnPlay').disabled && setup.daily === '2026-01-06'", 60000),
  await ev("setup.start?.title + ' -> ' + setup.goal?.title"));
check('the daily takes its start, checkpoints and target from different topics', await ev("new Set(cardKeys().map(w => groupOf(setup[w].title))).size === cardKeys().length"),
  await ev("cardKeys().map(w => setup[w].title + ' ' + groupOf(setup[w].title)).join(', ')"));
check('a daily is Normal with one more rule, No hubs making it Hard', await ev("dailyRule('2026-01-12') === 'nohubs' && !DAILY_RULES.includes('nonav')"));
// A daily can always be done: a route under its rules, and on a Six clicks day (2026-01-01) par 4 or less.
check('a Six clicks daily has par 4 or less', await ev(`dailyPair('2026-01-01').then(async p => p.rule === 'limit' &&
  (await parRoute({ start: p.start.title, goal: p.goal.title, rules: ['nonav', 'limit'] })).length - 1 <= DAILY_SIX_CLICKS_PAR)`));
check('daily sets its rule and checkpoint', await ev(`rules().join() === 'nonav,checkpoint' && !!setup.via0 && ${viaCard} && document.querySelector('#setupStatus').textContent.includes(': Relay.')`));
const pairOf = p => `[${p}.start, ...${p}.vias, ${p}.goal].map(c => c.title).join(' -> ')`;
const daily = await ev("cardKeys().map(w => setup[w].title).join(' -> ')");
check('daily pair is deterministic', await ev(`dailyPair('2026-01-06').then(p => p.rule === 'checkpoint' && ${pairOf('p')})`) === daily &&
  await ev(`dailyPair('2026-01-05').then(p => p.rule === 'noback' && !p.vias.length && ${pairOf('p')} !== ${JSON.stringify(daily)})`), daily);
// A #daily= date that is malformed, doesn't exist or hasn't come yet gives today's daily.
const dates = await ev(`JSON.stringify(['2026-01-06', '2024-02-29', today(), '2026-02-31', '2025-02-29', '2026-13-01', '2999-01-01',
  (d => (d.setDate(d.getDate() + 1), d.toLocaleDateString('sv')))(new Date()), '2026-1-02', 'x', null].map(dailyDate))`);
check('a daily link only gives a real day that has come', dates === JSON.stringify(['2026-01-06', '2024-02-29', ...Array(9).fill(await ev('today()'))]), dates);
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
await ev("document.querySelector('#btnGiveUp').click()");
await ev("document.querySelector('#gQuit').click()");
check('daily result is recorded', await ev("(r => r.daily === '2026-01-06' && r.vias.join() === setup.via0.title && r.rules.join() === 'nonav,checkpoint')(store.get('mwr.history', [])[0]) && document.querySelector('#modal').textContent.includes('Daily 2026-01-06')"));
await ev("document.querySelector('#mNew').click()");
await until('setup.busy === 0', 60000);
check('New game leaves the daily without the notice', await ev("setup.daily === null && document.querySelector('#setupStatus').textContent !== LEFT_DAILY"));
check('history marks the daily', await ev("document.querySelector('#history tbody tr').textContent.includes('Daily 2026-01-06, Relay')"));
await ev("loadDaily('2026-01-06')");
await until("setup.daily === '2026-01-06' && setup.busy === 0", 60000);
await ev("document.querySelector('#rules input[value=limit]').click()");
check('another rule leaves the daily', await ev("setup.daily === null && document.querySelector('#setupStatus').textContent === LEFT_DAILY"));
await ev("document.querySelector('#rules input[value=limit]').click()");
await ev("loadDaily('2026-01-06')");
await until("setup.daily === '2026-01-06' && setup.busy === 0", 60000);
await ev("document.querySelector('input[name=level][value=relaxed]').click()");
check('another difficulty leaves the daily', await ev("setup.daily === null && document.querySelector('#setupStatus').textContent === LEFT_DAILY && level() === 'relaxed'"));
await ev("document.querySelector('input[name=level][value=normal]').click()");
await ev("loadDaily('2026-01-06')");
await until("setup.daily === '2026-01-06' && setup.busy === 0", 60000);
await ev("document.querySelector('#btnSwap').click()");
check('swapping leaves the daily', await ev("setup.daily === null && document.querySelector('#setupStatus').textContent === LEFT_DAILY"));
await ev("loadDaily('2026-01-06')");
await until("setup.daily === '2026-01-06' && setup.busy === 0", 60000);
await ev("document.querySelector('[data-reroll=goal]').click()");
await until("setup.busy === 0 && !!setup.goal", 60000);
check('rerolling a card leaves the daily', await ev("setup.daily === null && document.querySelector('#setupStatus').textContent === LEFT_DAILY"));

// Checkpoint game: reaching the target before the checkpoint doesn't count. A best with another checkpoint is not this
// pair's best (the seeded 1-click game would otherwise make it "Your best").
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&via=Pickaxe&target=Diamond%20Pickaxe&rules=checkpoint', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
check('challenge link sets the checkpoint', await ev(`setup.via0?.title === 'Pickaxe' && rules().includes('checkpoint') && ${viaCard} && challengeLink().includes('&via=Pickaxe&')`),
  await ev('challengeLink()'));
await ev(`(h => { h.unshift({ start: 'Diamond', goal: 'Diamond Pickaxe', vias: ['Zombie'], rules: ['checkpoint'], won: true, clicks: 1, ms: 1000, at: Date.now(), path: [] });
  store.set('mwr.history', h); })(store.get('mwr.history', []))`);
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
const hudLbl = "document.querySelector('#hudLbl').textContent + ' ' + document.querySelector('#hudGoal').textContent";
check('HUD shows the checkpoint first', await ev(hudLbl) === 'Checkpoint Pickaxe', await ev(hudLbl));
check('the path picture is the checkpoint', await ev("document.querySelector('#pathArt').src === game.vias[0].img && !!game.vias[0].img"));
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
await until("game.path.length === 2 && !game.loading");
check('target before the checkpoint does not win', await ev("game.active") === true && await ev(hudLbl) === 'Checkpoint Pickaxe');
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
await until("game.path.length === 3 && !game.loading");
check('reaching the checkpoint switches to the target', await ev(hudLbl) === 'Target Diamond Pickaxe' && await ev('game.path[2].via === 1') &&
  await ev("document.querySelector('#pathArt').src === game.goal.img && !!game.goal.img"), await ev(hudLbl));
check('reaching the checkpoint is celebrated', await ev("!document.querySelector('#toast').classList.contains('hidden') && document.querySelector('#toast').textContent.includes('Diamond Pickaxe') && document.querySelector('.hud .goal').classList.contains('reached') && document.querySelector('#pathList li.via')?.textContent.includes('Pickaxe')"));
f = await frameCtx();
check('the target passed before the checkpoint is not marked as seen', await ev(`(links => links.length > 0 && !links.some(a => a.classList.contains('mwr-seen')))(
  [...document.querySelectorAll('a.mwr-live')].filter(a => /^\\/w\\/Diamond_Pickaxe(#|$)/i.test(a.getAttribute('href'))))`, f));
await shot('6-checkpoint');
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => /Diamond_Pickaxe/i.test(a.getAttribute('href'))).click()", f);
check('checkpoint game wins', await until("!game.active && !document.querySelector('#modalBg').classList.contains('hidden')"), `clicks=${await ev('clicks()')}`);
const viaModal = await ev("document.querySelector('#modal').textContent");
check('checkpoint is recorded and kept out of other bests', await ev("store.get('mwr.history', [])[0].vias.join() === 'Pickaxe'") &&
  viaModal.includes('Diamond → Pickaxe → Diamond Pickaxe') && !/personal best|Your best/.test(viaModal));

// Scavenger: the live wiki sends each article's categories with it, and a link from the start to a member of a kind finds it.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Blaze%20Rod&kind=Nether%20mobs&kind=Enchantments&kind=Potions&rules=scavenger', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled", 60000);
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading", 60000);
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => a.getAttribute('href') === '/w/Blaze').click()", f);
check('Scavenger: the article comes with its live categories, and a member of a kind is a find', await until("game.path.length === 2 && !game.loading", 60000) &&
  await ev("parseCache.get('Blaze')?.categories.some(c => c.category === 'Nether_mobs') && game.path[1].found?.join() === 'a mob found in the Nether'"),
  await ev("JSON.stringify(game.path.at(-1))"));
await ev("finish(false); closeModal()");

// A theme stylesheet added by the host page shows up in the picker and, marked data-mwr-default, wins over a saved
// theme that no longer exists. A preload script stands in for the host page injecting it into <head>.
await ev("localStorage.setItem('mwr.theme', JSON.stringify('Gone'))");
const preload = (await send('script.addPreloadScript', { functionDeclaration: `() => {
  const add = () => document.head.insertAdjacentHTML('beforeend', '<style data-mwr-theme="Test" data-mwr-default>:root[data-theme="Test"] { --bg: #000; color-scheme: dark; }</style>');
  if (document.head) add(); else new MutationObserver((_, o) => { if (document.head) { o.disconnect(); add(); } }).observe(document, { childList: true, subtree: true });
}` })).result.script;
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl, wait: 'complete' });
const injected = await ev("[...document.querySelectorAll('#themeSelect option')].map(o => o.value).join(',') + ' ' + document.querySelector('#themeSelect').value + ' ' + document.documentElement.dataset.theme + ' ' + themeIsDark() + ' ' + getComputedStyle(document.body).backgroundColor");
check('host-page theme is listed and used as the default', injected === 'auto,light,dark,Test Test Test true rgb(0, 0, 0)', injected);
await send('script.removePreloadScript', { script: preload });
await ev("localStorage.removeItem('mwr.theme')");

// Clear history asks first: Cancel keeps the games, confirming removes them and hides the table.
const histLen = "store.get('mwr.history', []).length";
await ev("document.querySelector('#btnClearHistory').click()");
await shot('4-clear-history');
await ev("document.querySelector('#hKeep').click()");
check('cancelling Clear history keeps it', await ev(`${histLen} > 0 && !document.querySelector('#history').classList.contains('hidden')`), await ev(histLen));
await ev("document.querySelector('#btnClearHistory').click()");
await ev("document.querySelector('#hClear').click()");
check('Clear history empties it', await ev(`${histLen} === 0 && document.querySelector('#history').classList.contains('hidden') && document.querySelector('#modalBg').classList.contains('hidden')`),
  await ev(histLen));

// Challenge links carry any title intact: ones with &, +, ?, %, =, /, :, quotes and accents survive challengeLink() and
// the hash, and the frame reads the same title back from a link to it as wikiUrl writes one. The first three are real
// articles, loaded through a link as start, checkpoint and target.
const tricky = ['Gravelly Mountains+', 'How did we get here? (block)', 'Village & Pillage', 'Oxygène',
  'Java Edition guides/Caves & Cliffs: Part I', '100% A=B; c+d', 'Steve\'s "quote"'];
const trip = JSON.parse(await ev(`(() => {
  const saved = { ...setup }, savedRules = rules(), savedCount = viaCount();
  const linkFor = (start, via, goal, r) =>
    (Object.assign(setup, { start: { title: start }, goal: { title: goal } }, setVias([{ title: via }])), setRules(r), challengeLink());
  const bad = ${JSON.stringify(tricky)}.filter(t => {
    const h = new URLSearchParams(new URL(linkFor(t, t + ' via', t + ' goal', ['noback', 'checkpoint'])).hash.slice(1));
    return h.get('start') !== t || h.get('via') !== t + ' via' || h.get('target') !== t + ' goal' || h.get('rules') !== rules().join();
  });
  const link = linkFor(...${JSON.stringify(tricky.slice(0, 3))}, ['checkpoint']);
  Object.assign(setup, saved);
  setRules(savedRules);
  document.querySelector('#viaCount').value = savedCount;
  return JSON.stringify({ bad, link });
})()`));
check('challenge links keep awkward titles intact', trip.bad.length === 0, JSON.stringify(trip.bad));
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: trip.link, wait: 'complete' });
const loaded = "[setup.start?.title, setup.via0?.title, setup.goal?.title].join(' | ')";
check('a challenge link with awkward titles loads them unchanged', await until("!document.querySelector('#btnPlay').disabled") &&
  await ev(loaded) === tricky.slice(0, 3).join(' | '), await ev(loaded));
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
const hrefs = await ev(`JSON.stringify(${JSON.stringify(tricky)}.map(t => wikiUrl(t).slice(WIKI.length)))`);
const read = await ev(`JSON.stringify(${hrefs}.map(h => { const a = document.createElement('a'); a.setAttribute('href', h); return classify(a)?.title; }))`, await frameCtx());
check('the frame reads awkward titles back from their links', read === JSON.stringify(tricky), read);

// API faults, made with a BiDi intercept on api.php: a request that fault.match accepts is failed outright, or given
// fault.reply ([status, body]) instead. A failed article offers Retry and Cancel with the clock stopped, and Retry loads
// it without counting the failed try. A failed roll says so, and the next roll works.
let fault = null;
onEvent = d => {
  if (d.method !== 'network.beforeRequestSent' || !d.params.isBlocked) return;
  const { request, url } = d.params.request;
  if (!fault?.match(url)) return send('network.continueRequest', { request });
  if (!fault.reply) return send('network.failRequest', { request });
  const [statusCode, body] = fault.reply;
  send('network.provideResponse', { request, statusCode, body: { type: 'string', value: body },
    headers: [['Access-Control-Allow-Origin', '*'], ['Content-Type', 'application/json']].map(([name, value]) => ({ name, value: { type: 'string', value } })) });
};
await send('session.subscribe', { events: ['network.beforeRequestSent'] });
const apiIntercept = (await send('network.addIntercept', { phases: ['beforeRequestSent'],
  urlPatterns: [{ type: 'pattern', hostname: 'minecraft.wiki', pathname: '/api.php' }] })).result.intercept;
const parseOf = t => url => url.includes('action=parse') && new URL(url).searchParams.get('page') === t;
const overlayText = "document.querySelector('#overlayBox').textContent.trim().replace(/\\s+/g, ' ')";

await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
fault = { match: parseOf('Diamond') };
await ev("document.querySelector('#btnPlay').click()");
const startFailed = await until("!!document.querySelector('#btnCancelNav') && !game.loading", 15000);
await ev("document.querySelector('#btnCancelNav').click()");
check('Cancel on a start article that failed returns to setup', startFailed &&
  await ev("!document.querySelector('#setup').classList.contains('hidden') && !game.active"), await ev(overlayText));
fault = null;
await ev("document.querySelector('#btnPlay').click()");
await until("game.path.length === 1 && !game.loading");
for (const [kind, reply, title, message] of [
  ['a network error', null, 'Iron Ingot', 'NetworkError'],
  ['HTTP 500', [500, 'oops'], 'Gold Ingot', 'HTTP 500'],
  ['a MediaWiki error', [200, '{"error":{"code":"maxlag","info":"Waiting for a database server"}}'], 'Coal', 'Waiting for a database server'],
  ['a reply that isn’t JSON', [200, '<html>'], 'Emerald', 'JSON'],
  ['a reply with no article', [200, '{}'], 'Redstone Dust', 'no article'],
]) {
  fault = { match: parseOf(title), reply };
  const before = await ev('game.path.length');
  await ev(`navigate(${JSON.stringify(title)})`);
  const offered = await until("!!document.querySelector('#btnRetry') && !game.loading", 15000);
  const shown = await ev(overlayText);
  const t0 = await ev('now()');
  await sleep(1000);
  const stopped = await ev(`now() === ${t0}`);
  fault = null;
  await ev("document.querySelector('#btnRetry')?.click()");
  check(`${kind} offers Retry with the clock stopped, and Retry loads the article`, offered && shown.includes(message) && stopped &&
    await until(`game.path.length === ${before + 1} && game.path.at(-1).title === ${JSON.stringify(title)} && !game.loading`, 20000), shown);
}

fault = { match: () => true };
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl, wait: 'complete' });
const status = "document.querySelector('#setupStatus').textContent";
check('a roll that fails says so', await until(`${status}.startsWith('Network error') && !${status}.includes('..') && setup.busy === 0`, 15000), await ev(status));
fault = null;
await ev("document.querySelector('#btnRerollAll').click()");
check('the next roll works', await until("!document.querySelector('#btnPlay').disabled", 30000), await ev(status));

await send('network.removeIntercept', { intercept: apiIntercept });
await send('session.unsubscribe', { events: ['network.beforeRequestSent'] });
onEvent = () => {};

// Storage is shared with the rest of the origin: history that isn't a list, or entries that aren't records, are left
// out instead of stopping the setup screen.
await ev(`localStorage.setItem('mwr.history', '{"oops":1}')`);
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe', wait: 'complete' });
check('history that isn’t a list doesn’t stop the setup screen', await until("!document.querySelector('#btnPlay').disabled") &&
  await ev("document.querySelector('#history').classList.contains('hidden')"));
const rec = JSON.stringify({ start: 'Diamond', goal: 'Iron Ingot', rules: [], won: true, clicks: 2, ms: 5000, at: Date.now() });
await ev(`store.set('mwr.history', [null, 5, { ...${rec}, clicks: '<b>2</b>' }, { ...${rec}, rules: ['nope'] }, { ...${rec}, topic: 'constructor' }, ${rec}]); renderHistory()`);
check('only real records are shown', await ev("document.querySelectorAll('#history tbody tr').length === 1 && !document.querySelector('#history tbody b')"),
  `rows=${await ev("document.querySelectorAll('#history tbody tr').length")}`);
await ev("localStorage.removeItem('mwr.history')");

// Leaving the page during a game asks first, and after the game it doesn't. Browsers only ask once the page has had a
// real click or key press, so Start is pressed with a real click. BiDi accepts the "Leave page?" dialog by default and
// reports it as browsingContext.userPromptOpened.
let prompts = [];
onEvent = d => { if (d.method === 'browsingContext.userPromptOpened') prompts.push(d.params.type); };
await send('session.subscribe', { events: ['browsingContext.userPromptOpened'] });
const leaveAfter = async giveUp => {
  await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
  await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe', wait: 'complete' });
  await until("!document.querySelector('#btnPlay').disabled");
  // A real click needs Start on screen; below the setup steps it may not be.
  const play = (await send('script.evaluate', { target: { context: ctx }, expression: "(b => (b.scrollIntoView({ block: 'center' }), b))(document.querySelector('#btnPlay'))", awaitPromise: false })).result?.result?.sharedId;
  await send('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', actions: [
    { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: play } } }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
  await send('input.releaseActions', { context: ctx });
  await until("game.path.length === 1 && !game.loading");
  if (giveUp) await ev("document.querySelector('#btnGiveUp').click(), document.querySelector('#gQuit').click()");
  prompts = [];
  await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
  await sleep(500);
  return prompts.join();
};
const during = await leaveAfter(false), after = await leaveAfter(true);
check('leaving the page during a game asks first', during === 'beforeunload', during);
check('leaving after the game doesn’t ask', after === '', after);
await send('session.unsubscribe', { events: ['browsingContext.userPromptOpened'] });
onEvent = () => {};

// Random play: a seeded run of link clicks (sometimes a second one while the first loads), Back (sometimes during a
// load), theme switches, peeks and path toggles. After each step the game must settle with the click count, the path
// list, the Back stack, the article shown and the clock agreeing. A win starts the pair again. The seed is printed;
// MWR_SEED=<seed> replays the same choices, though the wiki may have changed since.
const seed = Number(process.env.MWR_SEED) || Date.now() % 1e9;
let rngState = seed | 0;
const rand = () => {   // mulberry32
  let t = (rngState += 0x6D2B79F5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// The heading shows the article's display title, which can differ from its title (Commands/msg is shown as /msg).
const shownTitle = "(p => p && new DOMParser().parseFromString(p.displaytitle || p.title, 'text/html').body.textContent)(parseCache.get(game.path.at(-1).title))";
// Done once the game has stopped loading and stays stopped: a second click can start a load just after the first ends.
const settle = async () => {
  let ok;
  do { ok = await until('!game.loading', 20000); await sleep(500); } while (ok && await ev('game.loading'));
  return ok;
};
const playPair = async () => {
  await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
  await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Oxyg%C3%A8ne', wait: 'complete' });
  await until("!document.querySelector('#btnPlay').disabled");
  await ev("document.querySelector('#btnPlay').click()");
  await until("game.path.length === 1 && !game.loading");
};
const clickLink = async () => ev(`(ls => !!ls.length && (ls[Math.floor(${rand()} * ls.length)].click(), true))(document.querySelectorAll('.mwr-live'))`,
  await frameCtx());
const clickBack = () => ev("document.querySelector('#btnBack').click()");
const actions = [
  [40, 'link', clickLink],
  [15, 'two links', async () => { await clickLink(); await clickLink(); }],
  [15, 'back', clickBack],
  [10, 'link then back', async () => { await clickLink(); await clickBack(); }],
  [10, 'theme', () => ev(`setTheme(${JSON.stringify(['light', 'dark', 'auto'][Math.floor(rand() * 3)])})`)],
  [5, 'peek', () => ev("document.querySelector('#btnPeek').click(), closeModal()")],
  [5, 'path', () => ev("document.querySelector('#btnPath').click()")],
];
const state = `JSON.stringify({ active: game.active, path: game.path.map(p => p.title), stack: game.stack,
  hud: document.querySelector('#hudClicks').textContent, listed: document.querySelectorAll('#pathList li').length,
  overlay: !document.querySelector('#overlay').classList.contains('hidden'), running: !!game.runningSince, now: now() })`;
await playPair();
const steps = [], problems = [];
let wins = 0, lastNow = 0;
for (let i = 0; i < 30 && problems.length === 0; i++) {
  let r = rand() * 100, action = actions[0];
  for (const a of actions) if ((r -= a[0]) < 0) { action = a; break; }
  await action[2]();
  steps.push(action[1]);
  const settled = await settle();
  const s = JSON.parse(await ev(state));
  if (!s.active) { wins++; lastNow = 0; await playPair(); continue; }
  const heading = await ev("document.querySelector('#firstHeading')?.textContent", await frameCtx());
  const expected = await ev(shownTitle);
  const bad = [!settled && 'stuck loading', s.overlay && 'overlay still shown', s.hud !== String(s.path.length - 1) && 'HUD clicks',
    s.listed !== s.path.length && 'path list', s.stack.at(-1) !== s.path.at(-1) && 'Back stack', heading !== expected && `heading "${heading}"`,
    s.now < lastNow && 'clock went back', !s.running && 'clock stopped'].filter(Boolean);
  if (bad.length) problems.push(`step ${i + 1} (${action[1]}): ${bad.join(', ')} at ${s.path.at(-1)}`);
  lastNow = s.now;
}
check(`random play stays consistent (seed ${seed})`, problems.length === 0, `${steps.join(', ')}; ${wins} win(s)${problems.length ? '; ' + problems[0] : ''}`);
await ev("localStorage.removeItem('mwr.theme'); localStorage.removeItem('mwr.pathCollapsed')");

check('no uncaught script errors', jsErrors.length === 0, jsErrors.slice(0, 5).join(' | '));

await send('session.end', {});
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
