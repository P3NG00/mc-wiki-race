// End-to-end test: drives headless Firefox over WebDriver BiDi against index.html opened from file://.
// Hits the live minecraft.wiki API. Usage: test/run-e2e.sh (starts Firefox), or
//   node test/e2e.mjs <bidi-port> <file-url> [screenshot-dir]
import fs from 'node:fs';

const [port, fileUrl, shotDir] = process.argv.slice(2);
const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
let id = 0;
const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
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

let f = await frameCtx();
const links = JSON.parse(await ev("JSON.stringify({ live: document.querySelectorAll('a.mwg-live').length, tutorial: document.querySelectorAll('a[href^=\"/w/Tutorial:\"]').length, tutorialLive: document.querySelectorAll('a.mwg-live[href^=\"/w/Tutorial:\"]').length, sheets: document.styleSheets.length })", f));
check('article links are clickable', links.live > 100, `live=${links.live}`);
check('Tutorial: links are disabled', links.tutorial > 0 && links.tutorialLive === 0, `tutorial=${links.tutorial}`);
check('wiki stylesheets loaded', links.sheets >= 4, `sheets=${links.sheets}`);

await ev("[...document.querySelectorAll('a.mwg-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
check('clicking a link navigates', await until("game.path.length === 2 && !game.loading"), await ev("game.path.map(p => p.title).join(' > ')"));

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

// Random rolls in both modes.
await ev("document.querySelector('#mNew').click()");
check('Classic roll', await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
for (const m of ['balanced', 'even', 'chaos']) {
  await ev(`document.querySelector('input[value=${m}]').click()`);
  await sleep(500);
  check(`${m} roll`, await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
}

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
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Crafting&rules=nohubs', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
check('No hubs game loads', await until("game.path.length === 1 && !game.loading"));
check('hub redirects are known', await ev("hubTitles().then(m => m.get('Blocks') === 'Block' && m.get('Mining') === 'Breaking')"));
f = await frameCtx();
const hubLinks = JSON.parse(await ev(`JSON.stringify(Object.fromEntries(['Item', 'Java_Edition', 'Crafting', 'Pickaxe'].map(t =>
  [t, [...document.querySelectorAll('a[href^="/w/' + t + '"]')].filter(a => a.getAttribute('href').split('#')[0] === '/w/' + t).map(a => a.classList.contains('mwg-live') ? 'live' : 'dead')])))`, f));
const allAre = (t, s) => hubLinks[t].length > 0 && hubLinks[t].every(x => x === s);
check('No hubs disables hub links', allAre('Item', 'dead') && allAre('Java_Edition', 'dead'), JSON.stringify(hubLinks));
check('No hubs keeps the target and other links live', allAre('Crafting', 'live') && allAre('Pickaxe', 'live'));

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

await send('session.end', {});
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
