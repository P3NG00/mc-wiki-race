// End-to-end test: drives headless Firefox over WebDriver BiDi against index.html opened from file://.
// Hits the live minecraft.wiki API, for what only real pages can show: how articles render and which of their links are
// live. The game's own logic is checked in offline.mjs. Usage: test/run-e2e.sh (starts Firefox), or
//   node test/e2e.mjs <bidi-port> <file-url> [screenshot-dir]
import fs from 'node:fs';
import { connect } from './harness.mjs';

const [port, fileUrl, shotDir] = process.argv.slice(2);
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });   // made if it isn't there
const { send, listen, sleep, check, ctx, ev, frameCtx, until, end } = await connect(port, { wait: 30000, poll: 300 });
await send('browsingContext.setViewport', { context: ctx, viewport: { width: 1280, height: 860 } });
const shot = async name => {
  if (!shotDir) return;
  const r = await send('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};

// Challenge link → play → two clicks → win.
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe', wait: 'complete' });
// What the checks below take from the live wiki by name, asked for here apart from the game. An edit that changes any of
// these fails here, by name, so a check further down failing with it means picking another page, not a bug in the game.
// Pages loaded by title must not have become redirects, since the checks compare the title the game shows.
const liveOff = JSON.parse(await ev(`(async () => {
  const titles = ['Diamond', 'Diamond Pickaxe', 'Pickaxe', 'Iron Pickaxe', 'Crafting', 'Beacon', 'Icons.png', 'Minecraft Dungeons',
    'Dungeons:Creeper', 'Blaze Rod', 'Blaze', 'Zombified Piglin', 'Iron Ingot', 'Oxygène', 'Bastion Remnant'];
  // A request that fails leaves its pages null, which fails the facts about them.
  const info = await api({ action: 'query', prop: 'info', titles: [...titles, 'de:Diamant'].join('|') }).then(d => d.query, () => null);
  const doc = t => api({ action: 'parse', page: t, prop: 'text|categories', redirects: '1' }).then(({ parse: p }) =>
    Object.assign(new DOMParser().parseFromString(p.text, 'text/html'), { cats: p.categories.map(c => c.category) }), () => null);
  const [diamond, pickaxe, diamondPickaxe, ironIngot, beacon, icons, dungeons, creeper, blazeRod, blaze, bastion] = await Promise.all(
    ['Diamond', 'Pickaxe', 'Diamond Pickaxe', 'Iron Ingot', 'Beacon', 'Icons.png', 'Minecraft Dungeons', 'Dungeons:Creeper', 'Blaze Rod', 'Blaze',
      'Bastion Remnant'].map(doc));
  const zpDesc = await pageInfo('Zombified Piglin').then(i => i?.desc, () => null);
  const hrefs = (d, sel = 'a[href^="/w/"]') => [...d.querySelectorAll(sel)].map(a => a.getAttribute('href'));
  const linksTo = (d, t) => hrefs(d).some(h => h.split('#')[0] === '/w/' + t);
  const textTitles = d => [...d.querySelectorAll('a[href^="/w/"]')].filter(a => !a.closest('.navbox'))
    .map(a => decodeURIComponent(a.getAttribute('href').slice(3).split('#')[0]).replace(/_/g, ' '));
  const facts = {
    'the pages loaded by title are articles under those titles, de:Diamant an interwiki title': () => titles.every(t =>
      (p => p && !p.missing && !p.redirect)(info.pages.find(p => p.title === t))) && info.interwiki?.some(i => i.title === 'de:Diamant'),
    'Diamond links Pickaxe (plain), Diamond Pickaxe and Tutorial: pages, 100+ links in all, 50+ outside its navboxes': () =>
      hrefs(diamond).includes('/w/Pickaxe') && linksTo(diamond, 'Diamond_Pickaxe') && hrefs(diamond).some(h => h.startsWith('/w/Tutorial:')) &&
      hrefs(diamond).length > 100 && textTitles(diamond).filter(t => !t.includes(':')).length > 50 && !!diamond.querySelector('.navbox'),
    'Diamond’s text links hubs, the Crafting hub, Pickaxe and left-out pages': () => (ts => ts.some(t => HUB_TITLES.has(t) && HUB_TITLES.get(t) !== 'Crafting') &&
      ts.some(t => HUB_TITLES.get(t) === 'Crafting') && ts.includes('Pickaxe') && ts.some(t => LEFT_OUT.has(t)))(textTitles(diamond)),
    'Pickaxe links Diamond, Iron Pickaxe and Diamond Pickaxe, and Diamond Pickaxe links Pickaxe (plain)': () =>
      ['Diamond', 'Iron_Pickaxe', 'Diamond_Pickaxe'].every(t => linksTo(pickaxe, t)) && hrefs(diamondPickaxe).includes('/w/Pickaxe'),
    'Pickaxe has a crafting output slot of two or more items, a crafting slot linking Diamond and infobox tabs of three or more panels': () =>
      new Set([...pickaxe.querySelector('.mcui .invslot-large.animated').children].map(f => f.querySelector('a')?.title)).size > 1 &&
      !!pickaxe.querySelector('.invslot-item a[href="/w/Diamond"]') && pickaxe.querySelectorAll('.infobox .tabber > .tabbertab[data-title]').length > 2,
    'Iron Ingot has 50+ links': () => hrefs(ironIngot).length > 50,
    'Beacon has a layered blueprint of three or more layers, a calculator and sounds': () =>
      !!beacon.querySelector('.sound .sound-title + .sound-audio audio') && beacon.querySelectorAll('.layered-blueprint .layered-blueprint-layer').length > 2 &&
      beacon.querySelectorAll('.layered-blueprint .layered-blueprint-tab').length > 1 && !!beacon.querySelector('.mcw-calc'),
    'Bastion Remnant has a folded File structure box, a folded table of article links, an open mw-collapsible table and folded navbox groups': () =>
      !!bastion.querySelector('table.collapsible.collapsed[data-description="File structure"]') &&
      [...bastion.querySelectorAll('table.wikitable.collapsible.collapsed')].some(t => t.querySelector('tr + tr a[href^="/w/"]')) &&
      !!bastion.querySelector('table.mw-collapsible:not(.mw-collapsed)') && !!bastion.querySelector('.navbox .collapsible.collapsed'),
    'Icons.png has image-map links': () => hrefs(icons, 'area[href^="/w/"]').length > 0,
    'Minecraft Dungeons and Dungeons:Creeper link Dungeons: pages': () => [dungeons, creeper].every(d => hrefs(d).some(h => h.startsWith('/w/Dungeons:'))),
    'Blaze Rod links Blaze (plain), which the live wiki puts in Nether mobs': () => hrefs(blazeRod).includes('/w/Blaze') && blaze.cats.includes('Nether_mobs'),
    'Zombified Piglin’s intro starts “Zombified piglins are”': () => zpDesc.startsWith('Zombified piglins are'),
  };
  return JSON.stringify(Object.keys(facts).filter(f => { try { return facts[f]() !== true; } catch { return true; } }));
})()`));
check('the live wiki still has what the checks lean on', !liveOff.length, liveOff.length ? 'changed: ' + liveOff.join('; ') : '');

check('challenge pair loads', await until("!document.querySelector('#btnPlay').disabled"),
  await ev("setup.start?.title + ' -> ' + setup.goal?.title"));
await shot('1-setup');

// Every sound the game names is a file on the wiki (a renamed one would quietly play the synthesized one instead), and
// the note block's window gets a picture for every block and head, the note, and Minecraft's GUI (a renamed texture
// would quietly leave the window and the hotbar plain).
const noSound = JSON.parse(await ev(`(async () => {
  const files = [...new Set(Object.values(SOUND_FILES).flat())].map(f => 'File:' + f);
  const ds = await Promise.all(Array.from({ length: Math.ceil(files.length / 50) }, (_, i) =>
    api({ action: 'query', titles: files.slice(i * 50, i * 50 + 50).join('|'), prop: 'imageinfo', iiprop: 'url' })));
  const named = new Map(ds.flatMap(d => d.query?.normalized ?? []).map(n => [n.from, n.to]));
  const have = new Set(ds.flatMap(d => d.query?.pages ?? []).filter(p => p.imageinfo).map(p => p.title));
  return JSON.stringify(files.filter(f => !have.has(named.get(f) ?? f)));
})()`));
check('every sound the game plays is a file on the wiki', !noSound.length, noSound.join(', '));
await ev("document.querySelector('#btnNotes').click()");
const noteBoxIn = "[document.querySelectorAll('.note-box .nb-slots img:not(.hidden)').length, !!noteTexture, document.documentElement.classList.contains('gui-textured')]";
check('the note block\'s window has a picture for every block and head, the note, and the GUI textures', await until(`JSON.stringify(${noteBoxIn}) === '[26,true,true]'`),
  await ev(`JSON.stringify(${noteBoxIn})`));
await ev("document.body.click()");

await ev("document.querySelector('#btnPlay').click()");
check('start article renders', await until("document.querySelector('#overlay').classList.contains('hidden') && game.path.length === 1"));
await sleep(2000);
await shot('2-game');

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
// By its link, since hovering a slot takes the titles away for the Minecraft-style tooltip.
const shownItem = `${outputSlot}?.querySelector(':scope > .animated-active a')?.getAttribute('href')`;
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
// The slot under the pointer shows its item in a Minecraft-style tooltip instead of the browser's, which goes when the
// pointer does. A link to an article already on the path says so on a line of its own.
const tipText = "document.querySelector('#minetip-tooltip')?.innerText";
const slotTip = JSON.parse(await ev(`JSON.stringify([${tipText}, getComputedStyle(document.querySelector('#minetip-tooltip')).fontFamily,
  ${outputSlot}.querySelector(':scope > .animated-active').dataset.minetipTitle, !!${outputSlot}.querySelector(':scope > .animated-active [title]')])`, f));
await moveTo('viewport');
const tipGone = await ev(`${tipText} === undefined`, f);
await ev(`(s => s.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 })))([...document.querySelectorAll('.invslot-item')].find(s => s.querySelector('a.mwr-seen[href="/w/Diamond"]')))`, f);
const seenTip = await ev(`[${tipText}, document.querySelector('#minetip-tooltip .format-d')?.textContent].join('|')`, f);
check('a hovered slot shows a Minecraft-style tooltip, with a note on a link to the path', !!slotTip[2] && slotTip[0]?.split('\n')[0] === slotTip[2] &&
  slotTip[1].startsWith('Minecraft') && !slotTip[3] && tipGone && seenTip === 'Diamond\nAlready on your path|Already on your path', JSON.stringify([...slotTip, tipGone, seenTip]));
await ev("document.querySelector('#minetip-tooltip')?.remove()", f);
await send('input.releaseActions', { context: ctx });
// With motion reduced the slots don't cycle by themselves, and the button beside the grid moves them on once.
await ev('setCalm(true)');
const calmFrom = await ev(shownItem, f);
await sleep(4500);
const calmStill = await ev(shownItem, f);
const stepTip = await ev(`(s => (b => (b.click(), b.title === 'Show the next picture' && b.getAttribute('aria-label') === b.title))(s.closest('.animated-container, .mcui').querySelector(':scope > .mwr-step') ?? s.nextElementSibling))(${outputSlot})`, f);
await sleep(200);
const calmStepped = await ev(shownItem, f);
await ev('setCalm(false)');
check('with motion reduced the slots hold still, and the button beside the grid, Show the next picture, moves them on', stepTip && !!calmFrom && calmStill === calmFrom && calmStepped !== calmFrom
  && await until("!document.querySelector('.mwr-step')", 2000, f), `${calmFrom} -> ${calmStill} -> ${calmStepped}`);
// The infobox's tabs (Wooden, Golden, Stone…) show one picture at a time, and clicking a tab switches to it.
const tabState = `JSON.stringify((t => ({ tabs: [...t.querySelectorAll('.tabbernav li')].map(li => (li.classList.contains('tabberactive') ? '*' : '') + li.textContent),
  shown: [...t.querySelectorAll(':scope > .tabbertab')].filter(p => p.offsetHeight).map(p => p.dataset.title) }))(document.querySelector('.infobox .tabber')))`;
const tabsBefore = JSON.parse(await ev(tabState, f));
await ev("document.querySelectorAll('.infobox .tabbernav a')[1].click()", f);
const tabsAfter = JSON.parse(await ev(tabState, f));
check('infobox tabs show one panel and switch', tabsBefore.tabs.length > 2 && tabsBefore.tabs[0] === '*' + tabsBefore.shown[0] && tabsBefore.shown.length === 1 &&
  tabsAfter.tabs[1] === '*' + tabsAfter.shown[0] && tabsAfter.shown.length === 1 && await ev('game.path.length === 2 && !game.loading'), JSON.stringify([tabsBefore, tabsAfter]));

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
// took 2 clicks, for a pair linked directly or nearly.
const shortest = "[...document.querySelectorAll('#mBest li')].map(li => li.textContent).join(' → ')";
check('the result scores the win against par and shows a route', await until(`document.querySelector('#par').textContent === 'Going by the wiki’s offline copy from ' + shortDate(localDay(WIKI_DATA.snapshot), true) + '.'
  && document.querySelector('#mScore').textContent.startsWith(golfScore(clicks(), game.par).name) && document.querySelector('#mBestTitle').textContent === 'Shortest route · par ' + game.par
  && (r => r.startsWith('Diamond → ') && r.endsWith(' → Diamond Pickaxe'))(${shortest})`) &&
  await ev("game.par >= 1 && game.par <= 2 && savedGames()[0].par === game.par && document.querySelector('#mPar').textContent === String(game.par)"),
  `${await ev("document.querySelector('#mScore').textContent")} | ${await ev(shortest)}`);
await shot('3-win');

// Random rolls in every pool.
await ev("document.querySelector('#mNew').click()");
check('Everyday roll', await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
for (const m of ['popular', 'deep', 'chaos']) {
  await ev(`document.querySelector('input[value=${m}]').click()`);
  await sleep(500);
  check(`${m} roll`, await until("!document.querySelector('#btnPlay').disabled", 60000), await ev("setup.start.title + ' -> ' + setup.goal.title"));
}
// pageprops' description on infobox pages is the infobox caption ("Java Edition"); the intro's first paragraph is used.
const zpDesc = await ev("pageInfo('Zombified Piglin').then(i => i.desc)");
check('description is the first paragraph', zpDesc.startsWith('Zombified piglins are') && !zpDesc.includes('\n'), zpDesc);

// An interwiki title has no page in the API response; it must read as "not found", not a network error.
await ev("(() => { const i = document.querySelector('[data-custom=start]'); i.value = 'de:Diamant'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()");
check('interwiki title reports not found', await until("document.querySelector('#setupStatus').textContent.startsWith('No article named')", 15000),
  await ev("document.querySelector('#setupStatus').textContent"));

// Image-map <area> links must be intercepted like <a> links.
// A hash-only change would not reload the page, so go through about:blank.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Icons.png&target=Diamond', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
await until("game.active && game.path.length === 1 && !game.loading");
await sleep(1000);
f = await frameCtx();
const areas = JSON.parse(await ev("JSON.stringify({ all: document.querySelectorAll('area').length, live: document.querySelectorAll('area.mwr-live').length })", f));
check('image-map links are clickable', areas.live > 0, `areas=${areas.all} live=${areas.live}`);

// Beacon's layered blueprint: its layer names become buttons, and choosing one hides the layers above it.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Beacon&target=Diamond', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
await until("game.active && game.path.length === 1 && !game.loading");
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
// The wiki's calculator gadget, its own script from the wiki: Beacon's breaking-time table gets its options, Efficiency
// and Haste sliders whose labels are links the snapshot counts, and the times follow the sliders.
const calcRan = await until("document.documentElement.classList.contains('mwr-calc')", 20000, f);
const hasteLink = "[...document.querySelectorAll('.calculatorgadget-enabled a.mwr-live')].find(a => a.getAttribute('href') === '/w/Haste')";
const breakTime = "document.querySelector('.breakingrow-breakingtime-value')?.textContent";
const calcBefore = JSON.parse(await ev(`JSON.stringify((a => ({ link: !!a && a.checkVisibility(), sliders: a?.closest('tr').querySelectorAll('input[type=range]').length ?? 0, time: ${breakTime} }))(${hasteLink}))`, f));
await ev(`(r => { r.value = 2; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })(${hasteLink}.closest('tr').querySelector('input[type=range]'))`, f);
const calcAfter = await until(`${breakTime} !== ${JSON.stringify(calcBefore.time)}`, 3000, f);
check('the calculator gadget runs: the breaking-time options show, their labels live links, and the times follow the sliders',
  calcRan && calcBefore.link && calcBefore.sliders === 1 && calcAfter, `${JSON.stringify(calcBefore)} -> ${await ev(breakTime, f)}`);
// The sound gadget: a speaker plays its sound when clicked and stops it when clicked again, and that isn't a click. A real
// click, since the browser only lets a page play sound after one.
const sound = "document.querySelector('.sound')";
const speaker = await ev(`(s => [getComputedStyle(s.querySelector('.sound-title'), '::after').width !== '0px', !s.querySelector('audio').checkVisibility(), s.title].join())(${sound})`, f);
const soundRef = (await send('script.evaluate', { target: { context: f }, expression: `(s => (s.scrollIntoView({ block: 'center' }), s))(${sound})`, awaitPromise: false })).result?.result?.sharedId;
await send('input.performActions', { context: f, actions: [{ type: 'pointer', id: 'mouse', actions: [
  { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: soundRef } } }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
await send('input.releaseActions', { context: ctx });
const playing = await until(`${sound}.classList.contains('sound-playing') && ${sound}.title === 'Click to stop'`, 5000, f);
await ev(`${sound}.click()`, f);
const stopped = await until(`!${sound}.classList.contains('sound-playing') && ${sound}.querySelector('audio').paused && ${sound}.title === 'Click to play'`, 5000, f);
check('a speaker plays its sound and stops it', speaker === 'true,true,Click to play' && playing && stopped && await ev('game.path.length === 1'),
  `${speaker} playing=${playing} stopped=${stopped}`);
await ev(`${hasteLink}.click()`, f);
check('an option\'s link goes to its article', await until("game.path.length === 2 && game.path.at(-1).title === 'Haste' && !game.loading"), await ev("game.path.map(p => p.title).join(' > ')"));

// The wiki's folding boxes fold as on the wiki: Bastion Remnant's File structure and the tables of its parts' blocks start
// folded with a [show] toggle, its sortable tables start open with a [hide] button, and so do its navboxes, with groups
// inside them folded (in Relaxed, which shows navboxes). Toggling one isn't a click.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Bastion%20Remnant&target=Diamond', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
await until("game.active && game.path.length === 1 && !game.loading");
f = await frameCtx();
await ev("window.mwrPart = [...document.querySelectorAll('table.wikitable.collapsible.collapsed')].find(t => t.querySelector('tr + tr .mwr-live'))", f);
const folds = `JSON.stringify({
  file: (b => [b.classList.contains('collapsed'), b.querySelector('.jslink').textContent, b.rows[1].offsetHeight > 0])(document.querySelector('.collapsible[data-description="File structure"]')),
  part: (b => [b.classList.contains('collapsed'), b.querySelector('.jslink').textContent, [...b.querySelectorAll('.mwr-live')].some(a => a.offsetHeight > 0)])(window.mwrPart),
  mw: (b => [b.querySelector('.mw-collapsible-toggle').textContent, b.tBodies[0].rows[1].offsetHeight > 0])(document.querySelector('table.mw-collapsible')),
  nav: [document.querySelector('.navbox.collapsible:not(.collapsed) .jslink')?.textContent,
    (b => [b?.querySelector('.jslink').textContent, b?.rows[1].offsetHeight > 0])(document.querySelector('.navbox .collapsible.collapsed'))] })`;
const foldsBefore = await ev(folds, f);
check('folded boxes start as on the wiki', foldsBefore === '{"file":[true,"show",false],"part":[true,"show",false],"mw":["hide",true],"nav":["hide",["show",false]]}', foldsBefore);
await ev(`document.querySelector('.collapsible[data-description="File structure"] .jslink').click(); window.mwrPart.querySelector('.jslink').click();
  document.querySelector('table.mw-collapsible .mw-collapsible-toggle').click()`, f);
const foldsAfter = await ev(folds, f);
check('their toggles open and fold them, and the links inside work', foldsAfter === '{"file":[false,"hide",true],"part":[false,"hide",true],"mw":["show",false],"nav":["hide",["show",false]]}' &&
  await ev('game.path.length === 1 && clicks() === 0'), foldsAfter);

// Spin-offs on real pages: links into a spin-off are dead in a game without it, and live once a card's page is in it.
// The rest of Content and Spin-offs is in offline.mjs.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Minecraft%20Dungeons&target=Diamond', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
// Links to Dungeons pages, but its version pages, which are left out.
const dungeonsLinks = async () => JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('a[href^=\"/w/Dungeons:\"]')].filter(a => a.title !== 'Off limits: a version or list page').map(a => a.classList.contains('mwr-live')))", await frameCtx()));
await ev("document.querySelector('#btnPlay').click()");
await until("game.active && game.path.length === 1 && !game.loading");
const offLinks = await dungeonsLinks();
check('links into a spin-off that is off are dead', offLinks.length > 0 && offLinks.every(l => !l), `${offLinks.length} links`);
await ev("finish(false); closeModal(); toSetup()");
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Dungeons:Creeper&target=Diamond', wait: 'complete' });
check('a challenge link can start on a spin-off page', await until("!document.querySelector('#btnPlay').disabled && setup.start?.title === 'Dungeons:Creeper'"),
  await ev("setup.start?.title"));
await ev("document.querySelector('#btnPlay').click()");
await until("game.active && game.path.length === 1 && !game.loading");
check('a card in a spin-off turns its links on without the checkbox', await ev("JSON.stringify(game.content) === '[\"Dungeons\"]'") &&
  (links => links.length > 0 && links.every(l => l))(await dungeonsLinks()), await ev("JSON.stringify(game.content)"));
await ev("finish(false); closeModal(); toSetup()");

// No hubs: links to hubs and their redirects are dead, except a hub that is the target. The left-out pages are dead too.
// Blind target: the target named in the HUD with no picture, and no peek. Its cards and picking at Start are in offline.mjs.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Crafting&rules=nohubs,blind', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
check('No hubs game loads', await until("game.active && game.path.length === 1 && !game.loading"));
check('Blind target names the target once the game starts, but hides the HUD and path pictures and peek', await ev("document.querySelector('#hudGoal').textContent === 'Crafting' && document.querySelector('#hudImg').classList.contains('hidden') && document.querySelector('#pathArt').classList.contains('hidden') && document.querySelector('#btnPeek').classList.contains('hidden')"));
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
const leftOut = new Set(JSON.parse(await ev('JSON.stringify(WIKI_DATA.left_out)'))), toLeftOut = liveness(t => leftOut.has(t));
check('links to left-out pages are dead', toLeftOut.length > 0 && toLeftOut.every(live => !live), `${toLeftOut.length} left-out links, ${toLeftOut.filter(Boolean).length} live`);

// No navboxes: the navbox tables (and their Navigation heading) are hidden and their links dead; links in the text still work.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Diamond%20Pickaxe&rules=nonav', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled");
await ev("document.querySelector('#btnPlay').click()");
await until("game.active && game.path.length === 1 && !game.loading");
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
const stopRetrying = listen(d => {
  if (d.method !== 'network.beforeRequestSent' || !d.params.isBlocked) return;
  const { request, url } = d.params.request;
  tries[url] = (tries[url] || 0) + 1;
  send(tries[url] === 1 || url === icon('broken') ? 'network.failRequest' : 'network.continueRequest', { request });
});
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
stopRetrying();

// A link fragment that would open an HTML comment and a script inside the frame's script (the wiki renders
// [[X#&lt;!--&lt;script&gt;]] as one) must not stop the next article's scripts from running.
await ev(`(a => { a.href = '/w/Iron_Ingot#<!--<script>x'; a.textContent = 'x'; document.body.prepend(a); a.click(); })(document.createElement('a'))`, f);
check('a fragment with <!--<script> still renders the article', await until("game.path.at(-1)?.title === 'Iron Ingot' && !game.loading", 10000) &&
  await ev("document.querySelectorAll('a.mwr-live').length > 50", await frameCtx()), await ev("game.path.at(-1)?.title + ' loading=' + game.loading"));

// Checkpoint game: reaching the target before the checkpoint doesn't count. A best with another checkpoint is not this
// pair's best (the seeded 1-click game would otherwise make it "Your best").
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&via=Pickaxe&target=Diamond%20Pickaxe&rules=checkpoint', wait: 'complete' });
const viaCard = "!document.querySelector('#slot-via0').classList.contains('hidden')";
await until("!document.querySelector('#btnPlay').disabled");
check('challenge link sets the checkpoint', await ev(`setup.via0?.title === 'Pickaxe' && rules().includes('checkpoint') && ${viaCard} && openLink(new URL(challengeLink()).hash.slice(3)).includes('&via=Pickaxe&')`),
  await ev('openLink(new URL(challengeLink()).hash.slice(3))'));
await ev(`(h => { h.unshift({ start: 'Diamond', goal: 'Diamond Pickaxe', vias: ['Zombie'], rules: ['checkpoint'], won: true, clicks: 1, ms: 1000, at: Date.now(), path: [] });
  store.set('mwr.history', h); })(store.get('mwr.history', []))`);
await ev("document.querySelector('#btnPlay').click()");
await until("game.active && game.path.length === 1 && !game.loading");
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
await until("game.active && game.path.length === 1 && !game.loading", 60000);
f = await frameCtx();
await ev("[...document.querySelectorAll('a.mwr-live')].find(a => a.getAttribute('href') === '/w/Blaze').click()", f);
check('Scavenger: the article comes with its live categories, and a member of a kind is a find', await until("game.path.length === 2 && !game.loading", 60000) &&
  await ev("parseCache.get('Blaze')?.categories.some(c => c.category === 'Nether_mobs') && game.path[1].found?.join() === 'a mob found in the Nether'"),
  await ev("JSON.stringify(game.path.at(-1))"));
await ev("finish(false); closeModal()");

// Top links only on a real article: the live wiki has a table of contents (with a heading of its own) that the ZIM lacks,
// so the dashed line has to go over the first section heading, outside it, and every live link has to come before it.
await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
await send('browsingContext.navigate', { context: ctx, url: fileUrl + '#start=Diamond&target=Ghast&rules=nonav,lead', wait: 'complete' });
await until("!document.querySelector('#btnPlay').disabled && setup.busy === 0");
await ev("document.querySelector('#btnPlay').click()");
const leadOk = `(() => {
  const folds = document.querySelectorAll('.mwr-fold'), fold = folds[0], live = [...document.querySelectorAll('.mwr-live')];
  return folds.length === 1 && fold.nextElementSibling.matches('.mw-heading, h2') && !fold.nextElementSibling.checkVisibility() && !fold.closest('.toc, #toc') && live.length > 3
    && live.every(a => fold.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING)
    && [...document.querySelectorAll('.mw-parser-output a.mwr-dead')].some(a => a.title === 'Off limits: Top links only');
})()`;
check('Top links only: on a real article the line is over the first section heading, outside the contents, with the rest folded away and every live link above it',
  await until('game.active && !game.loading') && await until(leadOk, 15000, await frameCtx()), await ev("document.querySelectorAll('.mwr-live').length + ' live'", await frameCtx()));
await ev('finish(false); closeModal(); toSetup()');

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
  await until("game.active && game.path.length === 1 && !game.loading");
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
  overlay: !document.querySelector('#overlay').classList.contains('hidden') && document.querySelector('#overlay').textContent.trim().replace(/\\s+/g, ' '), running: !!game.runningSince, now: now() })`;
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
  const bad = [!settled && 'stuck loading', s.overlay && `overlay still shown ("${s.overlay}")`, s.hud !== String(s.path.length - 1) && 'HUD clicks',
    s.listed !== s.path.length && 'path list', s.stack.at(-1) !== s.path.at(-1) && 'Back stack', heading !== expected && `heading "${heading}"`,
    s.now < lastNow && 'clock went back', !s.running && 'clock stopped'].filter(Boolean);
  if (bad.length) problems.push(`step ${i + 1} (${action[1]}): ${bad.join(', ')} at ${s.path.at(-1)}`);
  lastNow = s.now;
}
check(`random play stays consistent (seed ${seed})`, problems.length === 0, `${steps.join(', ')}; ${wins} win(s)${problems.length ? '; ' + problems[0] : ''}`);
await ev("localStorage.removeItem('mwr.theme'); localStorage.removeItem('mwr.pathCollapsed')");

await end();
