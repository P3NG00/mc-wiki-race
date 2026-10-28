// What both suites drive Firefox with: a WebDriver BiDi session on the given port, its first tab, and the checks. Usage:
//   const { send, ev, until, ... } = await connect(port, { wait, poll })
// wait and poll are until's default timeout and how often it looks, in ms.

export async function connect(port, { wait, poll }) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  let id = 0;
  const pending = new Map(), listeners = new Set();
  // Uncaught errors and rejections in the page and the article frame, reported by a preload script (below) and checked at
  // the end. Its listeners are on the window, so failed images, fonts and requests, which Firefox also logs, don't count.
  const jsErrors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'script.message' && d.params.channel === 'mwr-errors') jsErrors.push(d.params.data.value);
    else if (d.method) for (const fn of listeners) fn(d);
  };
  const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // Calls fn with every other event the session subscribes to, until the function it returns is called.
  const listen = fn => (listeners.add(fn), () => listeners.delete(fn));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let failures = 0;
  const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!ok) failures++;
  };

  await new Promise(r => ws.onopen = r);
  await send('session.new', { capabilities: {} });
  await send('session.subscribe', { events: ['script.message'] });
  await send('script.addPreloadScript', { functionDeclaration: `report => {
    addEventListener('error', e => report(String(e.message)));
    addEventListener('unhandledrejection', e => report('Unhandled rejection: ' + (e.reason?.message ?? e.reason)));
  }`, arguments: [{ type: 'channel', value: { channel: 'mwr-errors' } }] });
  const ctx = (await send('browsingContext.getTree', {})).result.contexts[0].context;

  // An expression's value in the page, or in another browsing context (the article frame's, from frameCtx).
  const ev = async (expr, c = ctx) => {
    const r = await send('script.evaluate', { target: { context: c }, expression: expr, awaitPromise: true });
    return r.result?.result?.value ?? JSON.stringify(r.error || r.result?.exceptionDetails?.text);
  };
  const frameCtx = async () => (await send('browsingContext.getTree', {})).result.contexts[0].children[0]?.context;
  // A wait that runs out is recorded by the line that waited, and fails the last check: one whose condition never comes
  // true costs its whole timeout even where the checks after it pass.
  const timedOut = [];
  const until = async (expr, ms = wait, c = ctx) => {
    const t = Date.now(), from = new Error();
    while (Date.now() - t < ms) { if (await ev(expr, c) === true) return true; await sleep(poll); }
    timedOut.push(from.stack.match(/\w+\.mjs:\d+/g)?.[1]);   // [0] is this file
    return false;
  };

  // The last checks, then the summary, and the exit code says whether any check failed.
  const end = async () => {
    check('no uncaught errors', jsErrors.length === 0, jsErrors.slice(0, 5).join(' | '));
    check('no wait timed out', !timedOut.length, timedOut.join(', '));
    await send('session.end', {});
    console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
    process.exit(failures ? 1 : 0);
  };

  return { send, listen, sleep, check, ctx, ev, frameCtx, until, end };
}
