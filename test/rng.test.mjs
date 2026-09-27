// js/core/rng.js and the two things that have to be the same on every device because of it: the
// daily puzzle and a shared #/lot/<id> link.
//
// The expectations below are hand-written on purpose, in two independent ways:
//
//   1. A literal vector table. `hashSeed('')` is the published FNV-1a 32-bit offset basis
//      (2166136261 = 0x811c9dc5), which is a fact about the outside world and not about this repo.
//      The other entries were computed off-line from the *definition* written in the comment below
//      — FNV-1a 32 over the UTF-16 code units of the string, little-endian, i.e. two mixing rounds
//      per code unit — with a second program that does its modular arithmetic in 64-bit integers
//      rather than with Math.imul. Neither number was read out of js/core/rng.js.
//   2. `fnv1a16le` in this file, a from-scratch reimplementation on BigInt. It shares no line with
//      the module under test, so agreement between the two is evidence and not tautology.
//
// If the module's arithmetic changes, these vectors fail — and so does every puzzle id in
// js/data/lots.js that a #/lot/ link already points at, which is exactly the coupling worth
// pinning: a moved hash silently reshuffles the daily puzzle on other people's screens.
import { test, run, eq, ok } from '../tools/harness.mjs';
import { hashSeed, mulberry32, rngFrom, todayKey } from '../js/core/rng.js';
import { LOTS } from '../js/data/lots.js';
import { dailyPuzzle, randomPuzzle, ALL, campaign, byId } from '../js/core/library.js';

const MASK = 0xffffffffn;
const PRIME = 16777619n;
const BASIS = 0x811c9dc5n;

// FNV-1a 32, one mixing round per UTF-16 code unit byte, low byte first. Independent of the module.
function fnv1a16le(str) {
  let h = BASIS;
  for (let i = 0; i < str.length; i++) {
    const cu = str.charCodeAt(i);
    for (const byte of [cu & 0xff, cu >> 8]) {
      h ^= BigInt(byte);
      h = (h * PRIME) & MASK;
    }
  }
  return Number(h);
}

const VECTORS = [
  ['', 2166136261],
  ['a', 723832900],
  ['ab', 2174188438],
  ['hashi', 3302897302],
  ['2024-01-01', 252560449],
  ['2026-09-27', 1753841231],
  ['daily|2024-01-01', 1871590572],
  ['daily|2026-09-27', 2210448354],
  ['桥', 991583256],
  ['数桥', 2920611723],
];

test('hashSeed hits the published FNV-1a offset basis on the empty string', () => {
  eq(hashSeed(''), 2166136261, 'no input means no mixing round at all');
  eq(hashSeed(''), 0x811c9dc5, 'and that constant is the one FNV-1a documents');
});

test('hashSeed matches a hand-written vector table, dead-coded', () => {
  const wrong = [];
  for (const [str, want] of VECTORS) {
    const got = hashSeed(str);
    if (got !== want) wrong.push([str, got, want]);
  }
  eq(wrong, [], `${VECTORS.length} vectors`);
});

test('the vector table agrees with an independent 64-bit reimplementation', () => {
  const wrong = [];
  for (const [str] of VECTORS) {
    if (hashSeed(str) !== fnv1a16le(str)) wrong.push(str);
  }
  for (const extra of ['#/lot/shoal-01', 'daily|1999-12-31', 'random|ocean|abc123', 'shoal|2026-09-27']) {
    if (hashSeed(extra) !== fnv1a16le(extra)) wrong.push(extra);
  }
  eq(wrong, [], 'Math.imul and BigInt modular arithmetic land on the same number');
});

test('the two-byte split is real: non-ASCII seeds are hashed, not truncated', () => {
  // Pure-ASCII input only ever exercises the second mixing round with a zero byte. '桥' (U+6865)
  // and 'q' (U+0071) share a low byte pattern only by accident, so if the high byte were dropped
  // these two would collide with their own ASCII twins and the CJK route names would cluster.
  const high = hashSeed('桥');
  const low = hashSeed('q');
  ok(high !== low, 'the high byte has to reach the mixer');
  eq(high, fnv1a16le('桥'));
  eq(hashSeed('数桥'), hashSeed(String.fromCharCode(0x6570) + String.fromCharCode(0x6865)), 'one char at a time, in order');
  const distinct = new Set(['a', 'b', 'c', 'q', 'r', 's', '桥', '榻', '数'].map((s) => hashSeed(s)));
  eq(distinct.size, 9, 'nine seeds, nine different buckets');
});

test('hashSeed is a total function on uint32: deterministic, integral, never negative', () => {
  const bad = [];
  for (const s of ['', 'x', 'daily|2026-09-27', '数桥', 'a'.repeat(200)]) {
    const a = hashSeed(s);
    const b = hashSeed(s);
    if (a !== b) bad.push([s, 'not deterministic']);
    if (!Number.isInteger(a) || a < 0 || a > 0xffffffff) bad.push([s, a]);
  }
  eq(bad, []);
});

test('mulberry32 reproduces four hand-computed draws for two seeds', () => {
  // Raw uint32 outputs of the first four calls, computed off-line from Tommy Ettinger's published
  // mulberry32 recurrence (state += 0x6d2b79f5, two imul/xor-shift rounds, then t ^ (t >>> 14)) in a
  // program using 64-bit masks instead of Math.imul. Written dead here; the float form is /2^32.
  const RAW = {
    0: [1144304738, 1416247, 958946056, 627933444],
    7: [50271532, 266108690, 4195786334, 3002305430],
  };
  for (const [seed, want] of Object.entries(RAW)) {
    const rng = mulberry32(Number(seed));
    const got = [rng(), rng(), rng(), rng()];
    const wantFloat = want.map((x) => x / 4294967296);
    for (let i = 0; i < 4; i++) {
      ok(Math.abs(got[i] - wantFloat[i]) < 1e-15, `seed ${seed} draw ${i}: ${got[i]} vs ${wantFloat[i]}`);
      ok(got[i] >= 0 && got[i] < 1, `draw ${i} is a half-open unit float`);
    }
  }
  // The same reference arithmetic again, this time in the file, so the table cannot quietly rot:
  // a state update expressed with BigInt masks shares no operator with Math.imul.
  const ref = (seed, n) => {
    let s = BigInt(seed >>> 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      s = (s + 0x6d2b79f5n) & MASK;
      let t = s;
      t = ((t ^ (t >> 15n)) * (t | 1n)) & MASK;
      t = (t ^ ((t + (((t ^ (t >> 7n)) * (t | 61n)) & MASK)) & MASK)) & MASK;
      out.push(Number((t ^ (t >> 14n)) & MASK) / 4294967296);
    }
    return out;
  };
  const drift = [];
  for (const seed of [0, 7, 4294967295, 12345]) {
    const rng = mulberry32(seed);
    const mine = ref(seed, 6);
    for (const m of mine) {
      if (Math.abs(rng() - m) > 1e-15) drift.push([seed, m]);
    }
  }
  eq(drift, [], 'six draws, four seeds, two implementations');
  eq(mulberry32(0)().toFixed(17), mulberry32(0)().toFixed(17), 'the same seed restarts the same stream');
  ok(mulberry32(0)() !== mulberry32(1)(), 'different seeds, different streams');
});

test('mulberry32 helpers stay inside their contract over a long run', () => {
  const rng = mulberry32(hashSeed('daily|2026-09-27'));
  const draws = [];
  const octiles = new Array(8).fill(0);
  const bad = [];
  for (let i = 0; i < 4000; i++) {
    const v = rng();
    draws.push(v);
    if (!(v >= 0 && v < 1)) bad.push(['range', v]);
    octiles[Math.floor(v * 8)]++;
    const n = rng.int(7);
    if (!Number.isInteger(n) || n < 0 || n > 6) bad.push(['int', n]);
    const r = rng.range(3, 5);
    if (![3, 4, 5].includes(r)) bad.push(['range3_5', r]);
  }
  eq(bad.slice(0, 5), [], '4000 draws inside their bounds');
  eq(new Set(draws).size, 4000, 'every draw is its own value: no short cycle');
  ok(octiles.every((c) => c > 300), `all eight octiles populated, saw ${octiles.join(',')}`);
  const arr = [1, 2, 3, 4, 5, 6];
  const shuffled = rngFrom('shuffle-seed').shuffle(arr.slice());
  eq(shuffled.slice().sort((a, b) => a - b), arr, 'shuffle permutes, it does not invent or lose');
  eq(rngFrom('shuffle-seed').shuffle([1, 2, 3, 4, 5, 6]), shuffled, 'and the same seed gives the same permutation');
});

test('rngFrom is one door with three shapes: string seed, number seed, or a live rng', () => {
  eq(rngFrom('abc')(), rngFrom(hashSeed('abc'))(), 'a string seed is exactly its hash');
  eq(rngFrom('abc')(), mulberry32(fnv1a16le('abc'))(), 'recomputed independently');
  const live = mulberry32(11);
  eq(rngFrom(live), live, 'a function with .int passes straight through, so a stream is never restarted');
  eq(rngFrom(4294967296 + 5)(), rngFrom(5)(), 'a number is masked into uint32');
});

test('todayKey is the local calendar date, zero-padded, and rolls over correctly', () => {
  const at = (y, m, d) => new Date(y, m, d, 12, 0, 0);
  eq(todayKey(at(2026, 8, 27)), '2026-09-27', 'month is 0-based in the Date ctor and 1-based in the key');
  eq(todayKey(at(2026, 0, 1)), '2026-01-01', 'single digits get their zero');
  eq(todayKey(at(2025, 11, 31)), '2025-12-31');
  eq(todayKey(at(2024, 1, 29)), '2024-02-29', 'a leap day is still a key');
  eq(todayKey(at(2024, 2, 1)), '2024-03-01', 'and the day after it is not');
  eq(todayKey(at(999, 9, 5)), '999-10-05', 'the year is not padded — nobody plays this in 999');
  eq(todayKey().split('-').length, 3, 'no argument means today, in the same shape');
});

test('the daily puzzle is a pure function of the date key, recomputed by hand', () => {
  const idx = (key) => fnv1a16le(`daily|${key}`) % LOTS.length;
  const wrong = [];
  for (const key of ['2024-01-01', '2025-12-31', '2000-01-01', '2026-09-27', '1999-12-31']) {
    const want = LOTS[idx(key)].id;
    const a = dailyPuzzle(key);
    const b = dailyPuzzle(key);
    if (a.id !== want) wrong.push([key, a.id, want]);
    if (JSON.stringify(a.spec) !== JSON.stringify(b.spec)) wrong.push([key, 'unstable spec']);
  }
  eq(wrong, [], 'the hash picks the row, index by index, with the salt "daily"');
  eq(hashSeed('daily|2026-09-27'), fnv1a16le('daily|2026-09-27'), 'the salted string js/core/library.js hashes is the one this test recomputes');
  eq(dailyPuzzle('2026-09-27').id, LOTS[fnv1a16le('daily|2026-09-27') % 32].id);
  ok(byId(dailyPuzzle('2026-09-27').id) !== null, 'and that id is a real row in the pool');
});

test('a year of dailies is reproducible, varied, and never leaves the pool', () => {
  const ids = new Set();
  const tiers = new Set();
  const drift = [];
  const day = 86400000;
  let t = new Date(2026, 0, 1, 12, 0, 0).getTime();
  for (let i = 0; i < 365; i++, t += day) {
    const key = todayKey(new Date(t));
    const once = dailyPuzzle(key);
    const twice = dailyPuzzle(key);
    if (once.id !== twice.id) drift.push(key);
    if (!LOTS.some((l) => l.id === once.id)) drift.push(`${key}: not in the pool`);
    ids.add(once.id);
    tiers.add(once.tier);
  }
  eq(drift, [], '365 dates, each one stable across calls');
  eq(ids.size, 32, 'and a year walks the whole shipped pool, so the daily is not one puzzle on repeat');
  eq([...tiers].sort(), ['archipelago', 'ocean', 'shoal', 'sound'], 'every band shows up');
});

test('#/random/<tier>/<token> picks inside its band and the token decides which', () => {
  const wrong = [];
  for (const tier of ['shoal', 'sound', 'archipelago', 'ocean']) {
    const a = randomPuzzle(`${tier}|fixedseed`, tier);
    const b = randomPuzzle(`${tier}|fixedseed`, tier);
    if (!a || a.tier !== tier) wrong.push([tier, a && a.tier]);
    if (a !== b) wrong.push([tier, 'unstable']);
    const expect = ALL.filter((l) => l.tier === tier);
    if (a !== expect[fnv1a16le(`random|${tier}|fixedseed`) % expect.length]) wrong.push([tier, 'index']);
  }
  eq(wrong, [], 'the salt is "random", the seed is "<tier>|<token>", and the list is the tier');
  const spread = new Set();
  for (const token of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) spread.add(randomPuzzle(`ocean|${token}`, 'ocean').id);
  ok(spread.size >= 2, `eight tokens reach ${spread.size} different ocean puzzles`);
  eq(campaign(), ALL, 'the campaign is the pool in baked order');
});

run();
