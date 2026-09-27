// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9341), BASE_URL (page to attach to, default
//      http://127.0.0.1:5181/)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot'         # | @play | @routes | @save | @pointer
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so tools/verify.sh
// aggregates node suites and browser suites on one line. The @pointer suite is the only one that
// cannot be an in-page script: it drives Chrome's own mouse.
const PORT = process.env.CDP_PORT || 9341;
// Which page to attach to. Hard-coding the dev-server port silently evaluates against a fresh
// about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5181/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Test-only helper, injected into the page before the suites run: hunt for a bridge assignment
// that meets **every number** and lands exactly on Σp/2 roots while leaving the islands in two
// pieces. It is written here rather than in js/ because it exists only to hand the suites a
// counterexample, and because the thing under test is the shipped validator — a helper living
// next to the code it attacks would let a bug in one excuse the other.
//
// Exhaustive over the slot domains with two prunes (capacity, already-standing crossing), so "not
// found" is a real result rather than "my heuristic gave up".
const FIND_SPLIT = `window.__findSplit = function __findSplit(cap) {
  const g = window.hashi;
  const slots = g.slots();
  const p = g.numbers();
  const n = p.length, m = slots.length;
  const val = new Array(m).fill(0);
  const deg = new Array(n).fill(0);
  let nodes = 0;
  const limit = cap || 200000;
  const walk = (k) => {
    if (++nodes > limit) return null;
    if (k === m) {
      for (let i = 0; i < n; i++) if (deg[i] !== p[i]) return null;
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (const s of slots) if (val[s.i]) { const ra = find(s.a), rb = find(s.b); if (ra !== rb) parent[ra] = rb; }
      const parts = new Set(Array.from({ length: n }, (_, i) => find(i))).size;
      return parts > 1 ? val.slice() : null;
    }
    const s = slots[k];
    for (const v of [2, 1, 0]) {
      if (deg[s.a] + v > p[s.a] || deg[s.b] + v > p[s.b]) continue;
      if (v && s.crosses.some((o) => val[o])) continue;
      val[s.i] = v; deg[s.a] += v; deg[s.b] += v;
      const hit = walk(k + 1);
      deg[s.a] -= v; deg[s.b] -= v; val[s.i] = 0;
      if (hit) return hit;
    }
    return null;
  };
  return { vector: walk(0), nodes, islands: n, slots: m, target: window.hashi.state.target };
}; 'ok'`;

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network: a
  // fixed sleep is long enough for a localhost server and too short for GitHub Pages, where it
  // made an innocent deployment look broken (`window.hashi` still undefined, canvas still the
  // unstyled 300x150 default). The floor keeps the local case as fast as it was.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.hashi && window.hashi.state && window.hashi.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      await runJS(FIND_SPLIT);
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS);
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
//
// @boot imports the shipped engine modules *inside the page* and recomputes the numbers the panel
// is showing. That is the point: the browser is not asked to trust a fixture, it is asked to re-run
// the same two theorem checkers the node suites run.
const SCENARIOS = {
  boot: `(async () => {
    const g = window.hashi;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const model = await import('/js/core/model.js');
    const count = await import('/js/core/count.js');
    const logic = await import('/js/core/logic.js');
    const data = await import('/js/data/lots.js');

    rec('the shell boots straight into a game', g && g.version === 1 && g.state && g.state.mode === 'campaign', g && g.state);
    const c = document.getElementById('sea');
    rec('the canvas has real pixels', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    const lit = (() => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    })();
    rec('the sea was actually painted', lit > 50, { litSamples: lit });

    const pool = g.pool;
    rec('the shipped pool loaded', pool && pool.puzzles === data.LOTS.length, { stats: pool && pool.puzzles, lots: data.LOTS.length });
    rec('every band reports a measured, non-empty range', Object.values(pool.byTier).every((t) => t.n > 0 && t.kMin <= t.kMax && t.islMin >= 4 && t.rootsMin >= 1), pool.byTier);
    const bands = Object.values(pool.byTier);
    rec('the bands do not overlap in reasoning depth', bands.every((t, i) => i === 0 || t.kMin > bands[i - 1].kMax), bands.map((t) => [t.kMin, t.kMax]));
    rec('the bands do not overlap in island count', bands.every((t, i) => i === 0 || t.islMin > bands[i - 1].islMax), bands.map((t) => [t.islMin, t.islMax]));

    const st = g.state;
    rec('Σp is even on the level on screen', st.sumP % 2 === 0, { sumP: st.sumP });
    rec('the bridge count the panel prints is exactly Σp ÷ 2', st.target * 2 === st.sumP, { target: st.target, sumP: st.sumP });
    rec('a fresh board has no bridges standing', st.roots === 0 && st.drags === 0 && !st.connected, st);
    rec('the grid on screen matches the grid in the spec', st.grid === g.lot().w + '×' + g.lot().h, { grid: st.grid, spec: [g.lot().w, g.lot().h] });

    // 解数 = 1 is a claim about the puzzle on screen, so the browser recomputes it here instead of
    // reading the number off the panel.
    const own = count.countSolutions(g.lot(), 2);
    rec('the browser re-proves 解数 = 1 for the open puzzle', own.unique && own.count === 1, { count: own.count, nodes: own.nodes, stopped: own.stopped });
    let proved = 0, maxNodes = 0;
    const unproved = [];
    for (const row of data.LOTS) {
      const r = count.countSolutions(row.spec, 2);
      if (r.unique) proved++; else unproved.push(row.id);
      maxNodes = Math.max(maxNodes, r.nodes);
    }
    rec('the browser re-proves 解数 = 1 for every shipped puzzle', proved === data.LOTS.length, { proved, of: data.LOTS.length, unproved, maxCounterNodes: maxNodes });
    const badSol = data.LOTS.filter((row) => !model.validate(row.spec, row.solution)).map((row) => row.id);
    rec('the shipped validator accepts every baked solution', badSol.length === 0, { of: data.LOTS.length, badSol });
    const overBound = [];
    let handshakeAgrees = 0;
    for (const row of data.LOTS) {
      const comp = model.compile(row.spec);
      if (comp.islands.some((_, i) => comp.p[i] > model.boundOf(comp, i))) overBound.push(row.id);
      if (model.rootsOf(row.solution) === model.handshake(comp).target) handshakeAgrees++;
    }
    rec('no shipped clue breaks the structural bound p ≤ 2×方向数', overBound.length === 0, { of: data.LOTS.length, overBound });
    rec('每关的根数都等于 Σp÷2，两处独立数过', handshakeAgrees === data.LOTS.length, { handshakeAgrees, of: data.LOTS.length });

    const rs = logic.reason(g.lot());
    rec('the printed 推理深度 is reproducible in the browser', rs.ok && rs.depth === g.state.k, { depth: rs.depth, printed: g.state.k, guesses: rs.guesses });
    let depthOk = 0;
    for (const row of data.LOTS) if (logic.reason(row.spec).depth === row.k) depthOk++;
    rec('every printed 推理深度 is reproducible in the browser', depthOk === data.LOTS.length, { depthOk, of: data.LOTS.length });

    const readout = document.getElementById('readout').textContent;
    rec('the panel prints Σp, 桥数, 解数 and 推理深度', /Σp/.test(readout) && /桥数/.test(readout) && /解数/.test(readout) && /推理深度/.test(readout), readout);
    return { rows };
  })()`,

  play: `(async () => {
    const g = window.hashi;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const asEdges = (vector) => { const s = g.slots(); return vector.map((n, i) => ({ a: s[i].a, b: s[i].b, n })).filter((e) => e.n > 0); };

    g.store.reset();
    g.load('#/lot/shoal-04'); await sleep(120);
    const slots = g.slots();
    const sol = g.solution();
    const solutionEdges = asEdges(sol);
    const st0 = g.state;

    rec('the level starts empty and the identity already fixes the goal', st0.roots === 0 && st0.target === st0.sumP / 2 && st0.satisfied === 0, { target: st0.target, sumP: st0.sumP, satisfied: st0.satisfied });
    const applied = g.play(solutionEdges);
    rec('every root of the certified solution lands as exactly one drag', applied === st0.target && g.state.drags === applied, { applied, drags: g.state.drags, target: st0.target });
    rec('the board is connected and every number is met', g.state.done && g.state.connected && g.state.satisfied === g.state.islands, g.state);
    rec('the shipped validator agrees with the game state', g.isValid() && g.check().ok, g.check().errors);
    // Two code paths to the same fact: state.done asks js/core/game.js's won(), while state.flag
    // is the latch the drag loop set. A win card on a board the rules reject — or the reverse —
    // shows up here rather than as a player who cannot work out why nothing happened.
    rec('the win latch and the independent validator say the same thing', g.state.done === g.state.flag && g.state.done === g.isValid(), { done: g.state.done, flag: g.state.flag, valid: g.isValid() });
    rec('the win card goes up with three stars', g.state.curtain && D('stars').textContent === '★★★' && D('verdict').textContent === '一次到位', { stars: D('stars').textContent, verdict: D('verdict').textContent });
    D('restart').click(); await sleep(80);
    g.play(solutionEdges.slice(0, 1));
    const mid = { ...g.state };
    rec('partway through, the roots counted are the roots placed', mid.roots === solutionEdges[0].n && mid.drags === solutionEdges[0].n && !mid.connected, mid);

    // The 0 -> 1 -> 2 -> 0 cycle, and what it does to the drag count.
    D('restart').click(); await sleep(80);
    const dbl = slots.map((s, i) => ({ s, i })).find((x) => sol[x.i] === 2);
    g.play([{ a: dbl.s.a, b: dbl.s.b, n: 1 }]);
    const one = g.state.roots;
    g.play([{ a: dbl.s.a, b: dbl.s.b, n: 1 }]);
    const two = g.bridges()[dbl.i];
    g.play([{ a: dbl.s.a, b: dbl.s.b, n: 1 }]);
    const three = g.state.roots;
    rec('a third drag on the same pair clears it instead of adding a third root',
      one === 1 && two === 2 && three === 0 && g.state.drags === 3, { one, two, three, drags: g.state.drags });

    // Refused drags are not play: they must not move the counter.
    g.load('#/lot/archipelago-01'); await sleep(120);
    const s2 = g.slots();
    const crossed = s2.flatMap((x) => x.crosses.filter((o) => o > x.i).map((o) => [x, s2[o]]))[0];
    g.play([{ a: crossed[1].a, b: crossed[1].b, n: 1 }]);
    const beforeCross = g.state;
    g.play([{ a: crossed[0].a, b: crossed[0].b, n: 1 }]);
    const afterCross = g.state;
    rec('a bridge that would cross another is refused and costs nothing',
      afterCross.drags === beforeCross.drags && afterCross.roots === beforeCross.roots && /交叉/.test(D('hintline').textContent),
      { pair: [crossed[0].a, crossed[0].b, crossed[1].a, crossed[1].b], drags: [beforeCross.drags, afterCross.drags], line: D('hintline').textContent });
    const num = g.numbers();
    const poor = num.findIndex((p, i) => p === 1 && s2.filter((s) => s.a === i || s.b === i).length >= 2);
    const touch = s2.filter((s) => s.a === poor || s.b === poor);
    D('restart').click(); await sleep(80);
    g.play([{ a: touch[0].a, b: touch[0].b, n: 1 }]);
    const c1 = g.state.drags;
    g.play([{ a: touch[1].a, b: touch[1].b, n: 1 }]);
    rec('a drag that would push an island past its number is refused and costs nothing',
      g.state.drags === c1 && /数字/.test(D('hintline').textContent), { island: poor, drags: [c1, g.state.drags] });
    const offGrid = g.state;
    g.play([{ a: 0, b: num.length - 1, n: 1 }]);
    rec('two islands that share no line cannot be joined, and it is not billed',
      g.state.drags === offGrid.drags && /桥不能那样架|不成立/.test(D('hintline').textContent), { pair: [0, num.length - 1], drags: [offGrid.drags, g.state.drags], line: D('hintline').textContent });

    // The one a hashi implementation forgets: every number met, roots on target, still not a win.
    g.load('#/lot/sound-02'); await sleep(120);
    const split = window.__findSplit();
    rec('a split-but-exact configuration exists in this puzzle to test against', !!split.vector, split);
    if (split.vector) {
      const got = g.play(asEdges(split.vector));
      const s = g.state;
      const chk = g.check();
      rec('numbers all met and every root in place, yet the game does not declare a win',
        s.satisfied === s.islands && s.roots === s.target && got === s.roots && !s.connected && !s.done,
        { satisfied: s.satisfied, islands: s.islands, roots: s.roots, target: s.target, connected: s.connected, done: s.done });
      rec('the validator rejects it and names connectivity, nothing else',
        !chk.ok && chk.errors.length === 1 && chk.errors[0].startsWith('disconnected'), chk.errors);
      rec('no win card appears for a split sea', !s.curtain && D('curtain').hidden, { curtain: D('curtain').hidden });
      rec('the panel warns that the sea is not one piece yet', /还没连成一片/.test(D('hintline').textContent), D('hintline').textContent);
    }

    // Undo, restart, hint billing.
    g.load('#/lot/shoal-04'); await sleep(120);
    g.play(solutionEdges.slice(0, 2));
    const pre = g.state.roots;
    const preDrags = g.state.drags;
    D('undo').click(); await sleep(80);
    rec('撤销 takes exactly one root off and one drag off',
      pre - g.state.roots >= 1 && g.state.drags === preDrags - 1, { pre, roots: g.state.roots, drags: g.state.drags });
    D('restart').click(); await sleep(80);
    rec('重开 empties the board, the card and the counter', g.state.roots === 0 && g.state.drags === 0 && D('curtain').hidden, g.state);
    const h = g.hintOnce();
    rec('the hint names a real pair of islands and bills itself',
      h.hints === 1 && /架到/.test(h.line) && !!h.hint && slots.some((s) => (s.a === h.hint.a && s.b === h.hint.b) || (s.a === h.hint.b && s.b === h.hint.a)), h);
    g.play(solutionEdges);
    rec('a hinted run at the minimum still wins, one star short of 一次到位',
      g.state.done && D('stars').textContent === '★★☆' && D('verdict').textContent === '桥路通畅', { stars: D('stars').textContent, verdict: D('verdict').textContent });
    return { rows };
  })()`,

  routes: `(async () => {
    const g = window.hashi;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const data = await import('/js/data/lots.js');
    const N = g.pool.puzzles;

    g.load('#/c/7'); await sleep(140);
    rec('#/c/7 is level seven', g.state.index === 7 && g.state.mode === 'campaign', g.state);
    g.load('#/c/99999'); await sleep(140);
    rec('a huge index clamps to the last level', g.state.index === N && g.state.id === data.LOTS[N - 1].id, { index: g.state.index, N });
    g.load('#/c/0'); await sleep(140);
    rec('index zero clamps up to one', g.state.index === 1, g.state.index);
    g.load('#/c/3'); await sleep(140);
    const s = g.slots();
    g.play([{ a: s[0].a, b: s[0].b, n: 1 }]);
    g.load('#/c/4'); await sleep(140);
    rec('moving between levels hands over a clean board', g.state.drags === 0 && g.state.roots === 0, g.state);

    g.load('#/daily'); await sleep(140);
    const daily = g.state.id;
    g.load('#/c/1'); await sleep(140);
    g.load('#/daily'); await sleep(140);
    rec('the daily route is the same puzzle twice', g.state.mode === 'daily' && g.state.id === daily, { first: daily, again: g.state.id });
    rec('the daily label carries the date', /^每日数桥 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);

    for (const tier of Object.keys(g.pool.byTier)) {
      g.load('#/random/' + tier + '/fixedseed'); await sleep(140);
      const first = g.state.id;
      g.load('#/c/1'); await sleep(140);
      g.load('#/random/' + tier + '/fixedseed'); await sleep(140);
      rec('#/random/' + tier + ' stays in its band and repeats itself',
        g.state.tier === tier && g.state.id === first, { tier: g.state.tier, id: g.state.id, first });
    }
    g.load('#/random'); await sleep(240);
    rec('a bare #/random mints a token into the URL', /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);

    g.load('#/c/5'); await sleep(140);
    const sample = g.state.id;
    g.load('#/c/1'); await sleep(140);
    g.load('#/lot/' + sample); await sleep(140);
    rec('#/lot/<id> opens that puzzle', g.state.id === sample && g.state.mode === 'lot', { want: sample, got: g.state.id });
    g.load('#/lot/not-a-real-island'); await sleep(140);
    rec('an unknown puzzle id falls back instead of blanking the sea', !!g.state.id && g.state.target >= 1 && g.state.sumP === g.state.target * 2, g.state);
    return { rows };
  })()`,

  save: `(async () => {
    const g = window.hashi;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    // The key is read off the shell, not repeated here: g.store.reset() deletes whatever
    // js/core/storage.js owns, and a rig that hard-codes a stale string would report "the save is
    // gone" while the real key was still in localStorage. The literal is pinned once, separately.
    const KEY = g.saveKey;
    const asEdges = (vector) => { const s = g.slots(); return vector.map((n, i) => ({ a: s[i].a, b: s[i].b, n })).filter((e) => e.n > 0); };
    const solve = () => g.play(asEdges(g.solution()));

    rec('the shell publishes the save key that storage.js owns', KEY === 'hashi.save.v1', { fromHook: KEY });
    g.store.reset();
    g.load('#/c/1'); await sleep(140);
    rec('a wiped save is empty', Object.keys(g.store.records).length === 0 && g.store.unlocked === 1, { unlocked: g.store.unlocked });

    const target = g.state.target;
    solve();
    const id = g.state.id;
    await sleep(140);
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records[id] && raw.records[id].best === target), raw && Object.keys(raw.records || {}));
    rec('clearing the first level unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });
    const shelf2 = D('shelf').querySelector("button[data-index='2']");
    rec('the shelf lets level two be clicked', shelf2 && !shelf2.disabled, shelf2 && shelf2.outerHTML);
    rec('the totals line counts the win', /已通/.test(D('totals').textContent) && /<b>1<\\/b>/.test(D('totals').innerHTML), D('totals').innerHTML);

    // A sloppier second run must not damage the record: best only goes down, the flag only sticks.
    D('restart').click(); await sleep(120);
    const s = g.slots();
    const sol = g.solution();
    const dbl = sol.map((n, i) => ({ n, i })).find((x) => x.n >= 1);
    g.play([{ a: s[dbl.i].a, b: s[dbl.i].b, n: 1 }, { a: s[dbl.i].a, b: s[dbl.i].b, n: 1 }, { a: s[dbl.i].a, b: s[dbl.i].b, n: 1 }]);
    g.play(asEdges(sol));
    await sleep(140);
    const again = g.store.record(id);
    rec('a sloppier repeat leaves the best alone and keeps the flag',
      again.best === target && again.perfect === true && again.plays === 2, again);
    rec('the readout shows the record, not the fumble', new RegExp('最佳').test(D('readout').textContent), D('readout').textContent);

    g.load('#/daily'); await sleep(140);
    const day = g.state.label.split(' · ')[1];
    solve();
    await sleep(140);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.id, { day, mark });
    rec('the shelf says today is done', /已通过/.test(D('shelf').textContent), D('shelf').textContent);

    // The wipe is the only destructive control, so it arms on the first click.
    D('wipe').click(); await sleep(80);
    const armed = Object.keys(g.store.records).length;
    rec('the first click only arms it', armed > 0, { armed });
    D('wipe').click(); await sleep(200);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, key: localStorage.getItem(KEY) });
    return { rows };
  })()`,
};

// The one suite a page-side script cannot run: real input. Everything below goes through Chrome's
// own mouse and keyboard over CDP, so what gets asserted is the pointer-to-bridge wiring in
// js/view.js rather than the rules behind it.
async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
  }, sessionId);
  const key = (k) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', text: k, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  }, sessionId);

  // A press on `from`, six interpolated moves, a release on `to`: the same event sequence a
  // trackpad produces, so js/view.js's axis/dominance logic is what is being tested here.
  async function drag(from, to) {
    const steps = 6;
    await mouse('mousePressed', from.x, from.y, 1);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', Math.round(from.x + ((to.x - from.x) * i) / steps), Math.round(from.y + ((to.y - from.y) * i) / steps), 1);
    }
    await mouse('mouseReleased', to.x, to.y, 0);
    await sleep(80);
  }
  const beyond = (from, to, times) => ({
    x: Math.round(to.x + (to.x - from.x) * times),
    y: Math.round(to.y + (to.y - from.y) * times),
  });

  const state = (expr) => runJS(`(() => { const g = window.hashi; return ${expr}; })()`);
  const text = (id) => state(`document.getElementById('${id}').textContent`);
  const hidden = (id) => state(`document.getElementById('${id}').hidden`);
  const click = (id) => runJS(`document.getElementById('${id}').click(); 'ok'`);
  const point = (i) => runJS(`window.hashi.islandPoint(${i})`);

  await runJS(`window.hashi.load('#/lot/shoal-04'); 'ok'`);
  await sleep(250);

  const ids = await runJS(`['sea','modes','undo','hint','restart','share','curtain','stars','verdict','tally','shelf','hintline','wipe','next','again','readout','crumbs','totals','toast'].map((i) => [i, !!document.getElementById(i)])`);
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  const geo = await state(`({
    box: (() => { const b = document.getElementById('sea').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })(),
    pts: window.hashi.numbers().map((_, i) => window.hashi.islandPoint(i)),
    slots: window.hashi.slots(),
    sol: window.hashi.solution(),
  })`);
  rec('islandPoint puts every island inside the canvas, at a pressable size',
    geo.pts.every((p) => p && p.x >= geo.box.x && p.x <= geo.box.x + geo.box.w && p.y >= geo.box.y && p.y <= geo.box.y + geo.box.h) && geo.pts.every((p) => p.cell >= 20),
    { box: geo.box, pts: geo.pts });

  // The 0 -> 1 -> 2 -> 0 cycle with a real pointer on a real double bridge (shoal-04 slot 1).
  const dbl = geo.slots.map((s, i) => ({ s, i })).find((x) => geo.sol[x.i] === 2);
  const A = geo.pts[dbl.s.a];
  const B = geo.pts[dbl.s.b];
  await drag(A, B);
  const r1 = await state(`({ drags: window.hashi.state.drags, roots: window.hashi.state.roots, at: window.hashi.bridges()[${dbl.i}] })`);
  rec('one real drag lays exactly one root', r1.drags === 1 && r1.roots === 1 && r1.at === 1, r1);
  await drag(A, B);
  const r2 = await state(`({ drags: window.hashi.state.drags, roots: window.hashi.state.roots, at: window.hashi.bridges()[${dbl.i}] })`);
  rec('the same drag again lays the second root', r2.drags === 2 && r2.at === 2 && r2.roots === 2, r2);
  await drag(A, B);
  const r3 = await state(`({ drags: window.hashi.state.drags, roots: window.hashi.state.roots, at: window.hashi.bridges()[${dbl.i}] })`);
  rec('a third drag clears the pair rather than exceeding two', r3.drags === 3 && r3.at === 0 && r3.roots === 0, r3);

  // Over-drag: the release point is two island-spacings past the target island.
  await drag(A, beyond(A, B, 2));
  const clamped = await state(`({ roots: window.hashi.state.roots, at: window.hashi.bridges()[${dbl.i}], drags: window.hashi.state.drags })`);
  rec('pulling far past the target island still joins that island', clamped.at === 1 && clamped.roots === 1 && clamped.drags === 4, clamped);
  await click('restart'); await sleep(120);

  // An island pressed and dragged toward empty water: no island on that ray, so no target, no
  // bridge and nothing billed.
  const ray = await state(`(() => {
    const g = window.hashi, spec = g.lot();
    const pts = g.numbers().map((_, i) => g.islandPoint(i));
    const sorted = spec.islands.slice().sort((a, b) => a.r - b.r || a.c - b.c);
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const clearRay = (i, d) => !sorted.some((x, j) => j !== i && (d[1] !== 0
      ? x.r === sorted[i].r && (x.c - sorted[i].c) * d[1] > 0
      : x.c === sorted[i].c && (x.r - sorted[i].r) * d[0] > 0));
    for (let i = 0; i < sorted.length; i++) {
      for (const d of dirs) {
        const r = sorted[i].r + d[0], c = sorted[i].c + d[1];
        if (r < 0 || c < 0 || r >= spec.h || c >= spec.w) continue;
        if (!clearRay(i, d)) continue;
        return { from: pts[i], to: g.cellPoint(r, c), island: i, cell: [r, c] };
      }
    }
    return null;
  })()`);
  if (ray) {
    await drag(ray.from, ray.to);
    const s = await state('({ drags: window.hashi.state.drags, roots: window.hashi.state.roots })');
    rec('dragging an island toward open water lays nothing and bills nothing', s.drags === 0 && s.roots === 0, { ray, s });
  } else {
    rec('dragging an island toward open water lays nothing and bills nothing', false, 'every island direction in this puzzle is blocked by another island');
  }

  // Pressing water grabs nothing at all.
  const wet = await state(`(() => {
    const g = window.hashi, spec = g.lot();
    const pts = g.numbers().map((_, i) => g.islandPoint(i));
    for (let r = 0; r < spec.h; r++) {
      for (let c = 0; c < spec.w; c++) {
        const p = g.cellPoint(r, c);
        if (pts.every((q) => Math.abs(q.x - p.x) > q.r * 2 || Math.abs(q.y - p.y) > q.r * 2)) return { cell: [r, c], p };
      }
    }
    return null;
  })()`);
  if (wet) {
    await drag(wet.p, { x: wet.p.x + Math.round(wet.p.cell * 2), y: wet.p.y });
    rec('pressing open water and dragging starts no bridge', (await state('window.hashi.state.drags')) === 0, { wet, drags: await state('window.hashi.state.drags') });
  } else {
    rec('pressing open water and dragging starts no bridge', false, 'this grid has no cell far enough from every island');
  }

  // A press and release with no travel is not a drag.
  await click('restart'); await sleep(120);
  await drag(A, { x: A.x + 1, y: A.y + 1 });
  rec('a press and release in place is not a drag', (await state('window.hashi.state.drags')) === 0, await state('window.hashi.state'));

  // Play the whole 4-island level with the mouse.
  await click('restart'); await sleep(120);
  const plan = await state(`(() => {
    const g = window.hashi, s = g.slots();
    const out = [];
    g.solution().forEach((n, i) => { for (let k = 0; k < n; k++) out.push({ a: s[i].a, b: s[i].b, slot: i }); });
    return { moves: out, target: g.state.target };
  })()`);
  let played = 0;
  const log = [];
  for (const m of plan.moves) {
    const pa = await point(m.a);
    const pb = await point(m.b);
    await drag(pa, pb);
    const after = await state('({ drags: window.hashi.state.drags, roots: window.hashi.state.roots, done: window.hashi.state.done })');
    played++;
    log.push(after);
    if (after.drags !== played) break;
  }
  const won = await state('({ done: window.hashi.state.done, drags: window.hashi.state.drags, roots: window.hashi.state.roots, target: window.hashi.state.target, connected: window.hashi.state.connected, valid: window.hashi.isValid() })');
  rec('the mouse plays the whole certified solution, one drag per root',
    played === plan.target && won.done && won.valid && won.drags === won.target && won.roots === won.target && won.connected, { played, target: plan.target, log, won });
  rec('the win card goes up with three stars', (await hidden('curtain')) === false && (await text('stars')) === '★★★' && (await text('verdict')) === '一次到位', { stars: await text('stars'), verdict: await text('verdict') });
  rec('the tally quotes the identity, not a feeling', /恒等式最少/.test(await text('tally')), await text('tally'));
  await click('again'); await sleep(120);
  rec('再来一次 clears the card as well as the count', (await state('window.hashi.state.drags')) === 0 && (await hidden('curtain')) === true, await state('window.hashi.state'));

  // The nearest-island rule, geometrically. archipelago-01 has three islands on row 1, so a drag
  // aimed at the far one has to stop at the near one — that is the third-island rule enforced by
  // the pointer instead of by a rule table.
  await runJS(`window.hashi.load('#/lot/archipelago-01'); 'ok'`);
  await sleep(220);
  const trio = await state(`(() => {
    const g = window.hashi, s = g.slots();
    const pts = g.numbers().map((p, i) => ({ i, p: g.islandPoint(i) }));
    const joinable = (x, y) => s.findIndex((v) => (v.a === x && v.b === y) || (v.a === y && v.b === x));
    for (const a of pts) for (const b of pts) for (const c of pts) {
      if (a.i === b.i || b.i === c.i || a.i === c.i) continue;
      if (Math.abs(a.p.y - b.p.y) > 1 || Math.abs(b.p.y - c.p.y) > 1) continue;
      if (!((a.p.x < b.p.x && b.p.x < c.p.x) || (a.p.x > b.p.x && b.p.x > c.p.x))) continue;
      const ab = joinable(a.i, b.i);
      const ac = joinable(a.i, c.i);
      if (ab >= 0 && ac < 0) return { a: a.i, b: b.i, c: c.i, ab, ac };
    }
    return null;
  })()`);
  if (trio) {
    await drag(await point(trio.a), await point(trio.c));
    const hit = await state(`({ at: window.hashi.bridges()[${trio.ab}], drags: window.hashi.state.drags, roots: window.hashi.state.roots })`);
    rec('a drag at a far island stops at the island in between', hit.at === 1 && hit.drags === 1 && hit.roots === 1, { trio, hit });
    await click('restart'); await sleep(120);
  } else {
    rec('a drag at a far island stops at the island in between', false, 'no three collinear islands in that puzzle');
  }

  // Crossing and over-supply, refused by the mouse and not billed.
  const arch = await state(`(() => {
    const g = window.hashi, s = g.slots();
    const cross = s.flatMap((x) => x.crosses.filter((o) => o > x.i).map((o) => [x.i, o]))[0];
    const num = g.numbers();
    let over = null;
    for (let i = 0; i < num.length && !over; i++) {
      if (num[i] !== 1) continue;
      const touch = s.filter((x) => x.a === i || x.b === i);
      if (touch.length >= 2) over = { island: i, pair: touch.map((t) => t.i) };
    }
    return { cross, over, pts: num.map((_, i) => g.islandPoint(i)) };
  })()`);
  if (arch.cross) {
    const hs = await state(`window.hashi.slots()[${arch.cross[0]}]`);
    const vs = await state(`window.hashi.slots()[${arch.cross[1]}]`);
    await drag(arch.pts[vs.a], arch.pts[vs.b]);
    const before = await state('window.hashi.state');
    await drag(arch.pts[hs.a], arch.pts[hs.b]);
    const after = await state('window.hashi.state');
    rec('a real drag across a standing bridge is refused and costs nothing',
      after.drags === before.drags && after.roots === before.roots && /交叉/.test(await text('hintline')),
      { before: before.drags, after: after.drags, line: await text('hintline') });
    await click('restart'); await sleep(120);
  } else {
    rec('a real drag across a standing bridge is refused and costs nothing', false, 'this puzzle has no crossing pair');
  }
  if (arch.over) {
    const sx = await state(`window.hashi.slots()[${arch.over.pair[0]}]`);
    const sy = await state(`window.hashi.slots()[${arch.over.pair[1]}]`);
    await drag(arch.pts[sx.a], arch.pts[sx.b]);
    const before = await state('window.hashi.state');
    await drag(arch.pts[sy.a], arch.pts[sy.b]);
    const after = await state('window.hashi.state');
    rec('a real drag that would out-supply a number is refused and costs nothing',
      after.drags === before.drags && after.roots === before.roots && /数字/.test(await text('hintline')),
      { island: arch.over.island, before: before.drags, after: after.drags, line: await text('hintline') });
  } else {
    rec('a real drag that would out-supply a number is refused and costs nothing', false, 'no 1-clue island with two directions here');
  }
  await click('restart'); await sleep(120);

  // Numbers met, islands split — reached with the mouse too, so no clamp can be blamed for it.
  const split = await state(`(() => {
    const g = window.hashi;
    const f = window.__findSplit();
    if (!f.vector) return null;
    const s = g.slots();
    return f.vector.map((n, i) => ({ a: s[i].a, b: s[i].b, n }));
  })()`);
  if (split) {
    for (const e of split) {
      if (!e.n) continue;
      const pa = await point(e.a);
      const pb = await point(e.b);
      for (let k = 0; k < e.n; k++) await drag(pa, pb);
    }
    const s = await state('({ satisfied: window.hashi.state.satisfied, islands: window.hashi.state.islands, roots: window.hashi.state.roots, target: window.hashi.state.target, connected: window.hashi.state.connected, done: window.hashi.state.done })');
    rec('every number met with the mouse, islands split: still no win',
      s.satisfied === s.islands && s.roots === s.target && !s.connected && !s.done && (await hidden('curtain')) === true, s);
    await click('restart'); await sleep(120);
  } else {
    rec('every number met with the mouse, islands split: still no win', false, 'findSplit found nothing on this level');
  }

  // Keyboard shortcuts the panel advertises.
  await runJS(`window.hashi.load('#/lot/shoal-04'); 'ok'`);
  await sleep(180);
  const first = await state(`(() => { const s = window.hashi.slots(), sol = window.hashi.solution(); const i = sol.findIndex((n) => n > 0); return { a: s[i].a, b: s[i].b }; })()`);
  await drag(await point(first.a), await point(first.b));
  const kMoves = await state('window.hashi.state.drags');
  await key('u');
  await sleep(150);
  rec('the u key undoes', (await state('window.hashi.state.drags')) === kMoves - 1, { before: kMoves, after: await state('window.hashi.state.drags') });
  await key('h');
  await sleep(150);
  rec('the h key asks for a hint', (await state('window.hashi.state.hints')) === 1, await state('window.hashi.state.hints'));
  await key('r');
  await sleep(150);
  rec('the r key restarts', (await state('window.hashi.state.drags')) === 0 && (await state('window.hashi.state.roots')) === 0, await state('window.hashi.state'));

  return { rows };
}

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
