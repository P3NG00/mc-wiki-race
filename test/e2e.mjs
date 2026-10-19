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
const until = async (expr, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await ev(expr) === true) return true; await sleep(300); }
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
const links = JSON.parse(await ev("JSON.stringify({ live: document.querySelectorAll('a.mwg-live').length, tutorialDead: [...document.querySelectorAll('a[href^=\"/w/Tutorial:\"]')].every(a => a.classList.contains('mwg-dead')), sheets: document.styleSheets.length })", f));
check('article links are clickable', links.live > 100, `live=${links.live}`);
check('Tutorial: links are disabled', links.tutorialDead);
check('wiki stylesheets loaded', links.sheets >= 4, `sheets=${links.sheets}`);

await ev("[...document.querySelectorAll('a.mwg-live')].find(a => a.getAttribute('href') === '/w/Pickaxe').click()", f);
check('clicking a link navigates', await until("game.path.length === 2 && !game.loading"), await ev("game.path.map(p => p.title).join(' > ')"));

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

// Random rolls in both modes.
await ev("document.querySelector('#mNew').click()");
check('Classic roll', await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
await ev("document.querySelector('input[value=chaos]').click()");
await sleep(500);
check('Chaos roll', await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));

// Same article as start and target must not be playable.
await ev("(() => { const i = document.querySelector('[data-custom=goal]'); i.value = setup.start.title; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()");
await sleep(3000);
check('identical start/target disables Play', await ev("setup.goal.title === setup.start.title && document.querySelector('#btnPlay').disabled"));

await send('session.end', {});
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
