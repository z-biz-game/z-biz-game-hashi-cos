// js/core/logic.js: the rule set behind 推理深度, and the reason k is a measurement rather than an
// opinion. The rules themselves are shared with js/core/count.js (one propagate() implementation),
// so this suite pins (a) that every rule fires when it should, (b) that nothing outside the printed
// rule set ever fires, and (c) that the depth number is reproducible.
import { test, run, eq, ok } from '../tools/harness.mjs';
import { RULES, reason, deductive } from '../js/core/logic.js';
import { propagate, countSolutions } from '../js/core/count.js';
import { compile, validate } from '../js/core/model.js';
import { LOTS } from '../js/data/lots.js';
import { SQUARE_A, SQUARE_X, COMB_B, TIPS_C } from './fixture.mjs';

const V0 = 1, V1 = 2, V2 = 4;
const ANY = V0 | V1 | V2;
const popcount = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
const blankish = (row) => new Uint8Array(compile(row.spec).nSlots).fill(ANY);

// Run the propagation closure on a hand-set domain and report which rules fired.
function fired(spec, setup) {
  const comp = compile(spec);
  const dom = new Uint8Array(comp.nSlots).fill(ANY);
  setup(dom, comp);
  const trace = [];
  const r = propagate(comp, dom, { trace });
  return { rules: new Set(trace.map((t) => t.rule)), r, comp, dom };
}

test('the printed rule set is exactly seven rules, and it is the one the engine uses', () => {
  eq(RULES.length, 7);
  eq(RULES.map((x) => x.key), ['R-impossible', 'R-maxed', 'R-minned', 'R-satisfied', 'R-single', 'R-forced', 'R-crossing']);
  ok(RULES.every((x) => /->/.test(x.text)), 'every rule is stated as an implication');
  ok(!RULES.some((x) => /全 ?1/.test(x.text)), 'no rule claims "p == 方向数 means every bridge is a single"');
});

test('R-impossible: a demand the free directions cannot meet contradicts the branch', () => {
  // Two flavours, both hand-checked on fixture A (p = [2,2,2,2], slots 0-1 / 2-3 / 0-2 / 1-3):
  // island 2's two directions both emptied -> it still needs 2 and can get none; island 0's two
  // directions over-supplied (2 + 1) -> its remaining demand goes negative.
  const starving = fired(SQUARE_A, (d) => { d[1] = V0; d[2] = V0; });
  eq(starving.r.ok, false);
  ok(/island 2/.test(starving.r.reason), starving.r.reason);
  ok(/needs 2, free directions can only do 0\.\.0/.test(starving.r.reason), starving.r.reason);
  const overfed = fired(SQUARE_A, (d) => { d[0] = V2; d[2] = V1; });
  eq(overfed.r.ok, false);
  ok(/island 0/.test(overfed.r.reason), overfed.r.reason);
  ok(/needs -1/.test(overfed.r.reason), overfed.r.reason);
  // R-impossible is a rejection, not a deduction step: it never appears in a trace, because a
  // branch that dies has nothing to show the player.
  eq([...starving.rules].includes('R-impossible'), false);
  eq([...overfed.rules], []);
});

test('R-maxed: p == 2 x 方向数 forces every direction to its ceiling', () => {
  const { rules, dom, comp } = fired(SQUARE_X, () => {});
  ok(rules.has('R-maxed'), [...rules].join(','));
  eq(dom[1], V2);
  eq(dom[2], V2);
  eq(comp.p[2], 4);
});

test('R-minned: p equal to the sum of the floors puts each direction at its floor', () => {
  const { rules, dom } = fired(SQUARE_A, (d) => { d[0] = V1 | V2; d[2] = V1 | V2; });
  ok(rules.has('R-minned'), [...rules].join(','));
  eq(dom[0], V1);
  eq(dom[2], V1);
});

test('R-satisfied: a full island clears its remaining directions', () => {
  const { rules, dom } = fired(SQUARE_A, (d) => { d[0] = V2; });
  ok(rules.has('R-satisfied'), [...rules].join(','));
  eq(dom[3], V0);
});

test('R-single: an island that wants one root cannot put two on any direction', () => {
  const { rules, dom } = fired(SQUARE_X, (d) => { d[0] = ANY; d[3] = ANY; });
  ok(rules.has('R-single'), [...rules].join(','));
  eq(dom[0] & V2, 0);
  eq(dom[3] & V2, 0);
});

test('R-forced: one free direction takes the whole remaining demand', () => {
  // Fixture A with slot 0 pinned to a single: island 0 now needs 1 out of its one remaining
  // direction, island 1 likewise, and the whole ring collapses. Only R-forced fires.
  const { rules, dom, r } = fired(SQUARE_A, (d) => { d[0] = V1; });
  eq([...rules], ['R-forced']);
  eq(r.complete, true, 'and it finishes the puzzle');
  eq(dom, [V1, V1, V1, V1]);
  // The other half of the rule: a lone direction whose domain cannot hold the demand — here a
  // hand-set domain of {0,2} with one root still needed — is a contradiction, not a guess.
  const dead = fired(SQUARE_A, (d) => { d[0] = V1; d[2] = V0 | V2; });
  eq(dead.r.ok, false, JSON.stringify(dead.r));
  ok(/last direction 2 cannot hold 1/.test(dead.r.reason), dead.r.reason);
});

test('R-crossing: a direction that must carry a root empties everything crossing it', () => {
  const { rules } = fired(TIPS_C, (d) => { d[0] = V1 | V2; d[1] = V1 | V2; });
  ok(rules.has('R-crossing'), [...rules].join(','));
});

test('nothing outside the printed rule set ever fires on the shipped pool', () => {
  const allowed = new Set(RULES.map((x) => x.key));
  const seen = new Set();
  const closureOnly = new Set();
  for (const row of LOTS) {
    const comp = compile(row.spec);
    const dom = new Uint8Array(comp.nSlots).fill(ANY);
    const trace = [];
    propagate(comp, dom, { trace });
    // The first node of `reason()` is exactly this call, so what the closure emits on its own is a
    // subset of what the solve emits — measuring the solve can only make this claim stronger.
    for (const t of trace) closureOnly.add(t.rule);
    // The shipped game runs the *solve*, not the bare closure: `k` is measured by iterative
    // deepening, and every guess that lands inside the search feeds the same propagate(). Reading
    // only the empty-board closure understates the engine and left three of the seven rules
    // looking dead when they are what decide the answer.
    const r = reason(row.spec, { trace: true });
    ok(r.ok, `${row.id}: the pool must be solvable, ${JSON.stringify(r)}`);
    for (const t of r.trace) if (t.rule !== 'guess') seen.add(t.rule);
  }
  eq([...seen].filter((x) => !allowed.has(x)), []);
  ok(seen.size >= 4, `the pool actually exercises several rules, saw ${[...seen].join(',')}`);
  for (const r of closureOnly) ok(seen.has(r), `the bare closure fires ${r}, so the solve must too`);
});

test('R-minned is the one printed rule no real search can reach, and the reason is hand-derived', () => {
  // Hand-derived, from the domain algebra rather than from a measurement:
  //   * the only masks with a choice left in them are {0,1}=3, {0,2}=5, {1,2}=6, {0,1,2}=7;
  //   * every mask `propagate` can write is either a singleton (V0, V1, V2) or `m & NO_DOUBLE`,
  //     and `NO_DOUBLE` keeps the V0 bit — so from an all-open board the only two-valued mask that
  //     ever appears is {0,1};
  //   * a domain that still allows 0 roots has floor 0, so the sum of floors over the free
  //     directions of every island is 0, so `need === min` means `need === 0`, and that is answered
  //     one branch earlier by R-satisfied.
  // R-minned is therefore sound-but-unreachable in the shipped engine. It stays (a rule set that
  // ever learned "this direction holds at least one" would need it at once), and DESIGN.md §4 says
  // so out loud instead of letting the rule look like dead code that nobody read.
  const TWO_VALUED = [V0 | V1, V0 | V2, V1 | V2, ANY];
  eq(TWO_VALUED.filter((m) => m & V0), [V0 | V1, V0 | V2, ANY], 'three of the four still allow an empty bridge');
  eq(TWO_VALUED.filter((m) => !(m & V0)), [V1 | V2], '{1,2} is the only floor-above-zero shape, and it is the one the closure cannot write');

  const shapes = new Set();
  const emptied = [];
  const whereMinnedFired = [];
  // Close the domain, look at every mask left open, then optionally pin one more slot (which is
  // what a guess does) and close again. `guessed` only names the pin in the failure report.
  const sweep = (comp, base, depth, guessed) => {
    const dom = Uint8Array.from(base);
    const trace = [];
    const r = propagate(comp, dom, { trace });
    if (trace.some((t) => t.rule === 'R-minned')) whereMinnedFired.push(guessed < 0 ? 'closure' : `after pinning slot ${guessed}`);
    for (const s of comp.slots) {
      const m = dom[s.i];
      if (!m) { emptied.push([guessed, s.i]); continue; }
      if (popcount(m) > 1) shapes.add(m);
    }
    if (!r.ok || depth === 0) return;
    for (const s of comp.slots) {
      for (const v of [V0, V1, V2]) {
        const next = Uint8Array.from(dom);
        next[s.i] = v;
        sweep(comp, next, depth - 1, s.i);
      }
    }
  };
  // Sample only the rows the closure cannot finish on its own — a fully-determined board leaves no
  // open domain to look at, and an empty sample would make the subset claim below vacuously true.
  const open = LOTS.filter((row) => {
    const comp = compile(row.spec);
    return !propagate(comp, new Uint8Array(comp.nSlots).fill(ANY)).complete;
  });
  ok(open.length >= 8, `${open.length} pool rows keep the player guessing, so there is a sample`);
  for (const row of open.slice(0, 10)) sweep(compile(row.spec), blankish(row), 1, -1);
  for (const row of open.slice(0, 3)) sweep(compile(row.spec), blankish(row), 2, -1);
  eq(emptied, [], 'no island deduction ever empties a domain: an empty domain would be a lost solution');
  eq([...shapes].sort((a, b) => a - b), [V0 | V1, ANY], 'the only two-valued masks the closure is ever seen to leave open');
  eq(whereMinnedFired, []);
  // ... while a hand-set floor does fire it, which is what the R-minned unit test above does.
  const floored = fired(SQUARE_A, (d) => { d[0] = V1 | V2; d[2] = V1 | V2; d[1] = V1 | V2; });
  ok([...floored.rules].includes('R-minned'), JSON.stringify([...floored.rules]));
});

test('a complete but split assignment is not a solution: fixture A answers the ring, not the doubles', () => {
  const r = reason(SQUARE_A);
  ok(r.ok, 'the ring is findable');
  eq(Array.from(r.solution), SQUARE_A.expect.solution);
  eq(validate(SQUARE_A, r.solution), true);
  ok(r.depth >= 1, `connectivity is not a deduction, so A costs at least one guess (got ${r.depth})`);
  eq(deductive(SQUARE_A), false);
});

test('fixture X yields to pure deduction, exactly as the hand derivation did', () => {
  eq(deductive(SQUARE_X), true);
  const r = reason(SQUARE_X);
  eq(r.depth, 0);
  eq(Array.from(r.solution), SQUARE_X.expect.solution);
});

test('fixture C has no solution and the solver says so instead of inventing one', () => {
  const r = reason(TIPS_C, { maxDepth: 2 });
  eq(r.ok, false);
  eq(r.solution, null);
});

test('推理深度 is reproducible: identical depth, guesses and nodes on a second run', () => {
  const drift = [];
  for (const row of LOTS) {
    const a = reason(row.spec);
    const b = reason(row.spec);
    if (a.depth !== b.depth || a.guesses !== b.guesses || a.nodes !== b.nodes) drift.push(row.id);
  }
  eq(drift, []);
});

test('every printed k is reproduced by the shipped solver, and every answer validates', () => {
  const wrong = [];
  for (const row of LOTS) {
    const r = reason(row.spec);
    if (!r.ok || r.depth !== row.k) wrong.push([row.id, row.k, r.depth]);
    else if (!validate(row.spec, r.solution)) wrong.push([row.id, 'invalid']);
    else if (Array.from(r.solution).join(',') !== row.solution.join(',')) wrong.push([row.id, 'different solution']);
  }
  eq(wrong, []);
});

test('on a k=0 puzzle the reasoner and the exhaustive counter agree exactly', () => {
  const zero = LOTS.filter((l) => l.k === 0);
  ok(zero.length >= 8, `the pool has a deduction-only band (${zero.length} rows)`);
  for (const row of zero) {
    eq(deductive(row.spec), true, row.id);
    const brute = countSolutions(row.spec, 2);
    eq(Array.from(reason(row.spec).solution), Array.from(brute.solutions[0]), row.id);
  }
});

test('guess counts grow with the band, which is what makes k a difficulty measurement', () => {
  const byTier = {};
  for (const row of LOTS) {
    const r = reason(row.spec);
    const t = (byTier[row.tier] = byTier[row.tier] || { depths: [], guesses: [], nodes: [] });
    t.depths.push(r.depth);
    t.guesses.push(r.guesses);
    t.nodes.push(r.nodes);
  }
  const order = ['shoal', 'sound', 'archipelago', 'ocean'];
  const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  const depths = order.map((t) => med(byTier[t].depths));
  eq(depths, [0, 1, 2, 3], JSON.stringify(byTier.ocean.depths));
  ok(depths.every((d, i) => i === 0 || d > depths[i - 1]), 'each band is deeper than the one before');
});

test('reason() does not mutate the spec', () => {
  const spec = JSON.parse(JSON.stringify(COMB_B));
  const before = JSON.stringify(spec);
  reason(spec, { trace: true });
  countSolutions(spec, 5, { collect: true });
  eq(JSON.stringify(spec), before);
});

run();
