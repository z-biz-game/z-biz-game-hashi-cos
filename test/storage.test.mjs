// js/core/storage.js. The save layer is the one "core" module allowed to touch a browser global,
// and the reason it may is that it has to survive that global *throwing*: a private window makes
// `window.localStorage` itself raise, it does not hand back null. So the contract's 存档 anchors
// are mostly about degradation, and node can test them by installing a fake window.
//
// Each case gets its own instance of the module (`?i=N` defeats the ESM cache), because the layer
// keeps a module-level `cache`: one shared instance would let the first case's state leak into
// every later one, which is exactly the bug class this file is checking for.
import { test, run, eq, ok } from '../tools/harness.mjs';

let seq = 0;

// A localStorage stand-in. `mode` picks which kind of hostile browser to pretend to be:
//   'ok'      a normal, working store
//   'throw'   reading `window.localStorage` itself raises (private mode / storage disabled)
//   'blocked' the object is there but every method raises (quarantine, quota, policy)
function makeWindow(raw, mode = 'ok') {
  const mem = new Map();
  if (raw !== null && raw !== undefined) mem.set('hashi.save.v1', raw);
  const calls = { get: 0, set: 0, remove: 0 };
  const win = {
    calls,
    dump: (k) => (mem.has(k) ? mem.get(k) : null),
    keys: () => [...mem.keys()],
  };
  if (mode === 'ok') {
    win.localStorage = {
      getItem(k) { calls.get++; return mem.has(k) ? mem.get(k) : null; },
      setItem(k, v) { calls.set++; mem.set(k, String(v)); },
      removeItem(k) { calls.remove++; mem.delete(k); },
    };
  } else if (mode === 'blocked') {
    win.localStorage = {
      getItem() { calls.get++; throw new Error('SecurityError'); },
      setItem() { calls.set++; throw new Error('QuotaExceededError'); },
      removeItem() { calls.remove++; throw new Error('SecurityError'); },
    };
  } else if (mode === 'throw') {
    Object.defineProperty(win, 'localStorage', {
      get() { throw new Error('SecurityError: storage is disabled'); },
    });
  }
  return win;
}

// Import a private instance of the save layer, wired to one fake window.
async function open({ raw = null, mode = 'ok' } = {}) {
  const win = makeWindow(raw, mode);
  globalThis.window = win;
  const mod = await import(`../js/core/storage.js?i=${seq++}`);
  return { store: mod.store, SAVE_KEY: mod.SAVE_KEY, win };
}

// The layer looks `window` up on every call, so a test has to say which browser it is playing in
// before it touches a store — otherwise an earlier case's writes land in a later case's storage.
const use = (c) => {
  globalThis.window = c.win;
  return c;
};

// Built up front and in sequence: the harness runs its test bodies synchronously, so a case that
// needed `await` inside its body would report as passing without ever having run.
const blankCase = await open();
const corruptCase = await open({ raw: '{not json at all' });
const stringCase = await open({ raw: '"a string"' });
const futureCase = await open({ raw: JSON.stringify({ v: 2, records: { a: 1 } }) });
const partialCase = await open({ raw: JSON.stringify({ records: { 'shoal-01': { solved: true, best: 4, plays: 1, perfect: true } } }) });
const numbersCase = await open({ raw: JSON.stringify({ unlocked: '3', stats: { solves: 5 }, daily: null, records: null }) });
const throwCase = await open({ mode: 'throw' });
const blockedCase = await open({ mode: 'blocked' });
const solveCase = await open();
const perfectCase = await open();
const unlockCase = await open();
const dailyCase = await open();
const persistCase = await open();
const resetCase = await open({
  raw: JSON.stringify({
    unlocked: 9,
    records: { x: { solved: true } },
    stats: { solves: 3, perfect: 1, drags: 12, hints: 2 },
    daily: { '2026-09-27': { id: 'x', at: 1 } },
  }),
});
// The no-`window` shape is what `node --test` itself sees, so build this one with the global gone.
delete globalThis.window;
const noWindowMod = await import(`../js/core/storage.js?i=${seq++}`);
const noWindow = { store: noWindowMod.store, SAVE_KEY: noWindowMod.SAVE_KEY, win: null };
globalThis.window = makeWindow(null, 'ok');

test('the save key is one published constant, not a string every caller retypes', () => {
  use(blankCase);
  eq(blankCase.SAVE_KEY, 'hashi.save.v1');
  ok(/^hashi\.save\.v\d+$/.test(blankCase.SAVE_KEY), 'and it carries a version, so an old save is recognisable');
  eq(throwCase.SAVE_KEY, blankCase.SAVE_KEY, 'the same constant from an instance that cannot reach storage');
  eq(noWindow.SAVE_KEY, blankCase.SAVE_KEY, 'and from the one that has no window at all');
  eq(blankCase.win.keys(), [], 'nothing has been written yet');
  eq(blankCase.store.unlock(2), 2);
  eq(blankCase.win.keys(), [blankCase.SAVE_KEY], 'one key, and it is the published one');
  use(persistCase);
  eq(persistCase.win.keys(), [], 'which is per-window: a different browser starts empty');
});

test('with no window at all — the node case — the layer still answers, in memory', () => {
  // This instance was imported with the global missing, and every call below also runs without it:
  // `window.localStorage` raises a ReferenceError, which the guards have to swallow.
  delete globalThis.window;
  eq(noWindow.store.records, {}, 'a blank save file is an empty record set, not undefined');
  eq(noWindow.store.stats, { solves: 0, perfect: 0, drags: 0, hints: 0 });
  eq([noWindow.store.unlocked, noWindow.store.daily], [1, {}], 'the campaign starts at level 1');
  eq(noWindow.store.record('shoal-01'), null, 'unsolved is null, not a missing key');
  // Every mutation has to work anyway: the shell never branches on "is there storage".
  eq(noWindow.store.solve('shoal-01', { drags: 3, target: 3, hints: 0 }).best, 3);
  eq(noWindow.store.record('shoal-01'), { solved: true, best: 3, plays: 1, perfect: true });
  eq(noWindow.store.unlock(4), 4);
  eq(noWindow.store.stats, { solves: 1, perfect: 1, drags: 3, hints: 0 });
  noWindow.store.markDaily('2026-09-27', 'ocean-03');
  eq(noWindow.store.dailyDone('2026-09-27').id, 'ocean-03', 'and the daily log works without a browser');
  eq(noWindow.store.dailyDone('2026-09-26'), null, 'a day nobody played is not a record');
  noWindow.store.reset();
  eq([noWindow.store.unlocked, noWindow.store.stats.solves], [1, 0], 'reset worked with nothing to remove');
  globalThis.window = makeWindow(null, 'ok');
});

test('a localStorage that throws on *access* degrades to memory instead of crashing the shell', () => {
  // The case the brief calls out: private mode raises when you read `window.localStorage`, so a
  // truthiness test would have thrown in exactly the place it was meant to defend.
  use(throwCase);
  eq(throwCase.win.calls.get, 0, 'nothing has looked at storage yet');
  eq(throwCase.store.records, {}, 'reads answered');
  eq(throwCase.store.solve('sound-02', { drags: 6, target: 6, hints: 0 }).solved, true, 'writes answered');
  eq(throwCase.store.unlock(7), 7, 'and the unlock pointer moved');
  eq(throwCase.store.stats.solves, 1);
  eq(throwCase.win.keys(), [], 'a throwing window kept no keys');
  throwCase.store.reset();
  eq([throwCase.store.unlocked, throwCase.store.stats.solves], [1, 0], 'reset worked with nothing to remove');
});

test('a localStorage that throws on every *call* is the same story', () => {
  use(blockedCase);
  eq(blockedCase.store.record('shoal-08'), null);
  eq(blockedCase.store.solve('shoal-08', { drags: 5, target: 5, hints: 1 }).perfect, false, 'hinted, so not 一次到位');
  eq(blockedCase.store.unlock(3), 3);
  eq(blockedCase.win.calls.set > 0, true, 'it really did try to write');
  eq(blockedCase.win.keys(), [], 'and the writes went nowhere; the session kept them instead');
  eq(blockedCase.store.stats, { solves: 1, perfect: 0, drags: 5, hints: 1 }, 'the tally is still the played one');
});

test('a corrupt save is discarded, not trusted and not fatal', () => {
  use(corruptCase);
  eq(corruptCase.store.records, {}, 'unparseable JSON reads as blank');
  eq([corruptCase.store.unlocked, corruptCase.store.stats.solves], [1, 0]);
  eq(corruptCase.store.solve('shoal-04', { drags: 4, target: 4, hints: 0 }).plays, 1, 'and play continues');
  eq(JSON.parse(corruptCase.win.dump(corruptCase.SAVE_KEY)).records['shoal-04'].best, 4, 'overwritten by the first real write');
  corruptCase.store.reset();
  eq(corruptCase.win.dump(corruptCase.SAVE_KEY), null, 'reset removed the save it inherited');
  use(stringCase);
  eq(stringCase.store.records, {}, 'valid JSON that is not an object is equally useless');
  eq(stringCase.store.unlocked, 1);
  eq(stringCase.store.stats.solves, 0);
});

test('an unknown shape is taken field by field rather than trusted wholesale', () => {
  use(futureCase);
  eq(futureCase.store.records, { a: 1 }, 'records is records, whatever version the writer meant');
  eq(futureCase.store.unlocked, 1, 'a save without a pointer starts at level 1');
  eq(futureCase.store.stats, { solves: 0, perfect: 0, drags: 0, hints: 0 }, 'and missing stats are zeroed, not NaN');
  eq(futureCase.store.daily, {});
});

test('a partial save is normalised, and a string number is still a number', () => {
  use(partialCase);
  eq(partialCase.store.records, { 'shoal-01': { solved: true, best: 4, plays: 1, perfect: true } }, 'what was there survives');
  eq([partialCase.store.unlocked, partialCase.store.daily], [1, {}], 'what was not there falls back');
  eq(partialCase.store.stats, { solves: 0, perfect: 0, drags: 0, hints: 0 });
  eq(partialCase.win.calls.set, 0, 'reading a save does not rewrite it');
  use(numbersCase);
  eq(numbersCase.store.unlocked, 3, '"3" is the third island chain, not a NaN');
  eq(numbersCase.store.stats, { solves: 5, perfect: 0, drags: 0, hints: 0 }, 'a partial stats block is merged, not replaced');
  eq([numbersCase.store.records, numbersCase.store.daily], [{}, {}], 'null objects read as empty ones');
});

test('best only goes down, plays only goes up, and perfect never comes back off', () => {
  use(solveCase);
  const s = solveCase.store;
  eq(s.solve('sound-01', { drags: 6, target: 6, hints: 0 }), { solved: true, best: 6, plays: 1, perfect: true });
  eq(s.solve('sound-01', { drags: 9, target: 6, hints: 2 }), { solved: true, best: 6, plays: 2, perfect: true },
    'a worse hinted run cannot undo a personal best or the flag it earned');
  eq(s.solve('sound-01', { drags: 4, target: 6, hints: 1 }), { solved: true, best: 4, plays: 3, perfect: true },
    'a shorter run with a peek lowers `best` but cannot claim 一次到位');
  eq(s.solve('sound-01', { drags: 4, target: 6, hints: 0 }), { solved: true, best: 4, plays: 4, perfect: true },
    'equal to the best is not better than it, and needs no demotion');
  eq(s.stats, { solves: 4, perfect: 2, drags: 23, hints: 3 }, 'Σdrags 6+9+4+4, Σhints 0+2+1+0, two perfect runs');
  eq(s.solve('archipelago-01', { drags: 12, target: 11, hints: 0 }), { solved: true, best: 12, plays: 1, perfect: false },
    'one wasted drag off the identity floor is not 一次到位');
  eq(s.record('no-such-puzzle'), null, 'and an id that was never played is still null');
});

test('the perfect flag needs both halves of its definition: the floor and no hints', () => {
  use(perfectCase);
  const s = perfectCase.store;
  eq(s.solve('shoal-02', { drags: 3, target: 3, hints: 1 }).perfect, false, 'at the floor, but it looked');
  eq(s.solve('shoal-02', { drags: 2, target: 3, hints: 0 }).perfect, true, 'under the floor counts, even though play cannot get there');
  eq(s.solve('shoal-03', { drags: 3, target: 3 }).perfect, true, 'a caller that bills no hints gets the same answer');
  eq(s.stats, { solves: 3, perfect: 2, drags: 8, hints: 1 }, 'and `hints: undefined` added 0 rather than NaN');
  eq(s.record('shoal-03'), { solved: true, best: 3, plays: 1, perfect: true });
  eq(s.record('shoal-02'), { solved: true, best: 2, plays: 2, perfect: true }, 'the earlier hinted run is still inside `plays`');
});

test('the unlock pointer is monotone, because replaying chapter 1 must not lock chapter 3', () => {
  use(unlockCase);
  const s = unlockCase.store;
  eq(s.unlock(1), 1);
  eq(s.unlock(9), 9);
  eq(s.unlock(2), 9, 'a replay of an early level cannot rewind the campaign');
  eq(s.unlock(9), 9, 'and replaying the same level is a no-op');
  s.reset();
  eq(s.unlocked, 1, 'reset does put it back, deliberately');
  eq(s.unlock(0), 1, 'unlock(0) is not a way to hide level 1 either');
  eq(s.unlock(-5), 1);
  eq(s.unlock(4), 4, 'the pointer stores what it is given; main.js only ever sends integers');
});

test('the daily log remembers per day, and overwrites the same day', () => {
  use(dailyCase);
  const s = dailyCase.store;
  eq(s.dailyDone('2026-09-27'), null, 'nobody has played today yet');
  s.markDaily('2026-09-27', 'ocean-05');
  const first = s.dailyDone('2026-09-27');
  eq(first.id, 'ocean-05');
  ok(typeof first.at === 'number' && first.at > 0, `timestamped (${first.at})`);
  s.markDaily('2026-09-27', 'shoal-01');
  eq(s.dailyDone('2026-09-27').id, 'shoal-01', 'one entry per day, last write wins');
  eq(Object.keys(s.daily).length, 1, 'and re-solving today did not add a second row');
  s.markDaily('2026-09-28', 'sound-04');
  eq(Object.keys(s.daily).sort(), ['2026-09-27', '2026-09-28']);
  eq(s.stats.solves, 0, 'marking a day solved does not bill a solve: those are separate calls');
});

test('persist writes exactly the shape the header promises, and only on a write', () => {
  use(persistCase);
  const s = persistCase.store;
  eq(persistCase.win.calls.set, 0, 'nothing yet');
  s.solve('shoal-01', { drags: 3, target: 3, hints: 0 });
  eq([s.unlock(4), persistCase.win.calls.set], [4, 2], 'one write per mutation, none per read');
  const raw = persistCase.win.dump(persistCase.SAVE_KEY);
  ok(typeof raw === 'string' && raw.length > 0, 'a string landed in storage');
  const parsed = JSON.parse(raw);
  eq(Object.keys(parsed).sort(), ['daily', 'records', 'stats', 'unlocked'], 'the four fields, and no leftovers');
  eq(parsed.records['shoal-01'], { solved: true, best: 3, plays: 1, perfect: true });
  eq(parsed.unlocked, 4);
  eq(parsed.stats, { solves: 1, perfect: 1, drags: 3, hints: 0 });
  eq(parsed.daily, {});
  s.markDaily('2026-09-27', 'shoal-01');
  eq(JSON.parse(persistCase.win.dump(persistCase.SAVE_KEY)).daily['2026-09-27'].id, 'shoal-01');
});

test('reset clears memory and storage, and leaves a playable session behind', () => {
  use(resetCase);
  const s = resetCase.store;
  eq(s.unlocked, 9, 'the inherited save said 9');
  eq(s.stats, { solves: 3, perfect: 1, drags: 12, hints: 2 }, 'and its tally');
  eq(s.record('x'), { solved: true }, 'and one record');
  eq(s.dailyDone('2026-09-27').id, 'x');
  eq([resetCase.win.calls.set, resetCase.win.calls.remove], [0, 0], 'reading does not write');
  s.reset();
  eq(s.unlocked, 1);
  eq(s.stats, { solves: 0, perfect: 0, drags: 0, hints: 0 });
  eq([s.records, s.daily], [{}, {}], 'all four fields blank');
  eq(resetCase.win.calls.remove, 1, 'the key was removed once, by name');
  eq(resetCase.win.dump(resetCase.SAVE_KEY), null, 'and it is gone from storage too');
  eq(s.solve('ocean-01', { drags: 14, target: 13, hints: 3 }), { solved: true, best: 14, plays: 1, perfect: false });
  ok(resetCase.win.dump(resetCase.SAVE_KEY) !== null, 'play resumes and persists normally after a wipe');
});

test('one window is not another: no state crosses a browser instance', () => {
  use(persistCase);
  eq(persistCase.store.record('shoal-01').best, 3, 'the case above wrote it into its own window');
  use(blankCase);
  eq(blankCase.store.record('shoal-01'), null, 'and this window never heard of it');
  eq([unlockCase.store.record('shoal-01'), solveCase.store.record('shoal-01')], [null, null],
    'nor did the other two, whose stores are separate module instances');
});

run();
