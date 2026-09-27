// js/core/count.js: the exhaustive counter behind "解数 = 1". Everything here is checked against
// either a hand-derived expectation (test/fixture.mjs) or an independent brute-force enumerator.
import { test, run, eq, ok } from '../tools/harness.mjs';
import { countSolutions, theSolution, propagate, pickSlot } from '../js/core/count.js';
import { compile, checkSpec, withoutClue, rootsOf, degreesOf, handshake } from '../js/core/model.js';
import { LOTS } from '../js/data/lots.js';
import { SQUARE_A, SQUARE_X, SQUARE_F, SQUARE_T, SQUARE_Z, COMB_B, TIPS_C, WILD_PAIR, naiveCounts } from './fixture.mjs';

const vecs = (r) => r.solutions.map((s) => Array.from(s)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const sorted = (list) => list.map((v) => Array.from(v).join(',')).sort().join(' | ');

test('fixture A is unique with connectivity and three-way ambiguous without it', () => {
  const on = countSolutions(SQUARE_A, 2);
  eq(on.count, SQUARE_A.expect.withConnectivity);
  eq(on.unique, true);
  eq(Array.from(on.solutions[0]), SQUARE_A.expect.solution);
  const off = countSolutions(SQUARE_A, 9, { connected: false, collect: true });
  eq(off.count, SQUARE_A.expect.withoutConnectivity);
  eq(sorted(off.solutions), sorted([[1, 1, 1, 1], [2, 2, 0, 0], [0, 0, 2, 2]]));
  eq(off.unique, false, 'a search that ignored connectivity would have to lie about uniqueness');
});

test('the split board is a degree-exact, on-target, rejected assignment', () => {
  const comp = compile(SQUARE_A);
  const split = Uint8Array.from(SQUARE_A.expect.split);
  eq(Array.from(degreesOf(comp, split)), Array.from(comp.p));
  eq(rootsOf(split), handshake(comp).target);
  const sols = countSolutions(SQUARE_A, 9, { collect: true }).solutions.map((s) => Array.from(s).join(','));
  ok(!sols.includes(SQUARE_A.expect.split.join(',')), 'the counter does not count it');
  ok(sols.length === 1, 'and it is the only thing the counter would have over-counted');
});

test('fixtures X and B come out with their hand-derived answers', () => {
  const x = countSolutions(SQUARE_X, 2);
  eq(x.unique, true);
  eq(Array.from(x.solutions[0]), SQUARE_X.expect.solution);
  const b = countSolutions(COMB_B, 2);
  eq(b.unique, true);
  eq(Array.from(b.solutions[0]), COMB_B.expect.solution);
  eq(rootsOf(Uint8Array.from(COMB_B.expect.solution)), COMB_B.expect.target);
});

test('erasing one load-bearing clue turns 解数=1 into exactly 2, both hand-derived', () => {
  const erased = withoutClue(COMB_B, COMB_B.expect.eraseIsland);
  ok(checkSpec(erased).ok, 'the clue-free spec is still legal');
  const r = countSolutions(erased, 3, { collect: true });
  eq(r.count, 2);
  eq(r.unique, false);
  eq(r.stopped, null, 'a full search, not an early return');
  eq(sorted(r.solutions), sorted(COMB_B.expect.erasedSolutions));
  const naive = naiveCounts(erased);
  eq(naive.count, 2, 'the independent enumerator agrees');
});

test('limit=2 returns early instead of enumerating the whole space', () => {
  const erased = withoutClue(COMB_B, COMB_B.expect.eraseIsland);
  const early = countSolutions(erased, 2);
  eq(early.count, 2);
  eq(early.stopped, 'limit');
  eq(early.unique, false);
  eq(early.solutions.length, 1, 'only the first placement is kept in memory');
  const full = countSolutions(erased, 100, { collect: true });
  ok(early.nodes <= full.nodes, `early ${early.nodes} nodes vs full ${full.nodes} nodes`);
  // A spec with 3+ solutions stops at 2, proving "not unique" without counting to 3.
  const wide = withoutClue(withoutClue(COMB_B, 2), 0);
  const w = countSolutions(wide, 2);
  eq(w.count, 2);
  eq(w.stopped, 'limit');
  ok(naiveCounts(wide).count > 2, 'the real number is bigger than what the search visited');
});

test('a legal spec can still have no solution at all (fixture C)', () => {
  ok(checkSpec(TIPS_C).ok);
  const r = countSolutions(TIPS_C, 2);
  eq(r.count, TIPS_C.expect.solutions);
  eq(r.unique, false);
  eq(r.stopped, null, 'exhausted the space honestly');
});

test('an over-budget search reports that it was cut off and never claims uniqueness', () => {
  const big = LOTS.find((l) => l.tier === 'ocean');
  const cut = countSolutions(big.spec, 2, { nodes: 1 });
  eq(cut.stopped, 'nodes');
  eq(cut.truncated, true);
  eq(cut.unique, false);
  const room = countSolutions(big.spec, 2, { nodes: 300000 });
  eq(room.unique, true);
  eq(room.stopped, null);
  const late = countSolutions(big.spec, 2, { deadline: Date.now() - 1000 });
  ok(late.stopped === 'time' || late.stopped === null, `deadline honoured or the search finished anyway: ${late.stopped}`);
  if (late.stopped === 'time') eq(late.unique, false);
});

test('the square family: exhaustive counts hand-computed on paper, vectors and all', () => {
  // Four islands at the corners of a 3x3 field, so the whole puzzle is four equations in four
  // unknowns and the number of solutions is something a person can count. Expectations are in
  // test/fixture.mjs, derived in the comment there; `naiveCounts` is a second program that shares
  // no search code with the counter.
  const cases = [
    ['SQUARE_F p=[4,4,4,4]', SQUARE_F],
    ['SQUARE_T p=[3,3,3,3]', SQUARE_T],
    ['SQUARE_Z p=[2,3,3,2]', SQUARE_Z],
  ];
  for (const [label, spec] of cases) {
    const on = countSolutions(spec, 1 << 20, { collect: true, raw: true });
    const off = countSolutions(spec, 1 << 20, { collect: true, raw: true, connected: false });
    const naive = naiveCounts(spec);
    eq(on.count, spec.expect.withConnectivity, `${label}: connected count`);
    eq(off.count, spec.expect.withoutConnectivity, `${label}: count with connectivity switched off`);
    eq(naive.count, spec.expect.solutions, `${label}: the independent enumerator agrees`);
    eq(on.stopped, null, `${label}: a finished search, so the count is the truth and not a budget`);
    eq(checkSpec(spec).ok, true, `${label}: the spec is legal even where the answer is ${spec.expect.solutions}`);
    const hs = handshake(compile(spec));
    eq(hs.sumP, spec.expect.sumP, `${label}: sum(p)`);
    eq(hs.target, spec.expect.target, `${label}: the identity puts the root target at sum(p)/2`);
    const answers = spec.expect.vectors || (spec.expect.vector ? [spec.expect.vector] : []);
    for (const v of answers) {
      eq(rootsOf(Uint8Array.from(v)), hs.target, `${label}: roots counted off the answer itself agree with the identity`);
    }
    if (spec.expect.vectors) eq(sorted(on.solutions), sorted(spec.expect.vectors), `${label}: the exact list of placements`);
    if (spec.expect.vector) eq(Array.from(on.solutions[0]), spec.expect.vector, `${label}: the single placement`);
  }
  // The three together are the discriminating triple: identical geometry, all three legal specs,
  // and 解数 1 / 2 / 0 between them. `limit = 2` has to answer "is it unique?" without finishing:
  // 1 for the unique board, an early stop the moment it has seen two on the ambiguous one, and an
  // honest exhaustion of the inconsistent one.
  const limited = [SQUARE_F, SQUARE_T, SQUARE_Z].map((s) => countSolutions(s, 2));
  eq(limited.map((r) => r.count), [1, 2, 0], 'limit=2 counts, it does not guess');
  eq(limited.map((r) => r.stopped), [null, 'limit', null], 'and says which of the two ways it stopped');
  eq(limited.map((r) => r.unique), [true, false, false], 'only the unique board is certified');
  eq([SQUARE_F, SQUARE_T, SQUARE_Z].map((s) => theSolution(s) !== null), [true, false, false], 'only the unique one gets a solution handed back');
});

test('the counter and an independent brute force agree on every shipped puzzle', () => {
  let checked = 0;
  let leaves = 0;
  const mismatches = [];
  for (const row of LOTS) {
    const mine = countSolutions(row.spec, 1 << 20, { collect: true, raw: true });
    const naive = naiveCounts(row.spec);
    leaves += naive.leaves;
    checked++;
    if (mine.count !== naive.count) mismatches.push([row.id, 'count', mine.count, naive.count]);
    else if (mine.count === 1 && mine.solutions[0].join(',') !== row.solution.join(',')) mismatches.push([row.id, 'vector']);
  }
  eq(mismatches, [], `${checked} specs, ${leaves} naive leaves`);
  ok(checked === LOTS.length);
});

test('a slot whose two endpoints are both wildcards is still branched (regression)', () => {
  // Found by the cross-check below, which is the whole reason an independent enumerator exists:
  // `pickSlot` ranked slots by how tight their *numbered* endpoint was, so a slot with no
  // numbered endpoint scored Infinity, lost every comparison, and the search quietly returned 0
  // solutions for a spec that has some. Hand-derived answer: 2 connected, 3 in total.
  const on = countSolutions(WILD_PAIR, 9, { collect: true, raw: true });
  eq(on.count, WILD_PAIR.expect.withConnectivity);
  eq(sorted(on.solutions), sorted([[1], [2]]));
  eq(on.stopped, null, 'a full search, and it found the leaves');
  const off = countSolutions(WILD_PAIR, 9, { collect: true, raw: true, connected: false });
  eq(off.count, WILD_PAIR.expect.withoutConnectivity);
  eq(off.solutions.length, 3);
  eq(naiveCounts(WILD_PAIR).count, 2, 'the naive enumerator agrees');
  const comp = compile(WILD_PAIR);
  eq(pickSlot(comp, new Uint8Array(comp.nSlots).fill(7)), 0, 'and it names the slot it must branch on');
});

test('every single-clue erasure of the shipped pool: the two engines agree, 251 variants', () => {
  const mismatches = [];
  const byTier = {};
  let variants = 0;
  let multi = 0;
  let maxCount = 0;
  for (const row of LOTS) {
    const comp = compile(row.spec);
    const st = (byTier[row.tier] = byTier[row.tier] || { variants: 0, multi: 0 });
    for (let i = 0; i < comp.n; i++) {
      const spec = withoutClue(row.spec, i);
      const mine = countSolutions(spec, 1 << 20, { collect: true, raw: true });
      const naive = naiveCounts(spec);
      variants++;
      st.variants++;
      if (naive.count > 1) {
        multi++;
        st.multi++;
      }
      maxCount = Math.max(maxCount, naive.count);
      if (mine.count !== naive.count) mismatches.push([row.id, i, 'count', mine.count, naive.count]);
      else if (naive.count > 1 && naive.count <= 8 && sorted(mine.solutions) !== sorted(naive.solutions)) {
        mismatches.push([row.id, i, 'set']);
      }
      // Erasing a clue only ever relaxes the puzzle, so the shipped placement must survive it.
      const shipped = row.solution.join(',');
      if (!mine.solutions.some((v) => v.join(',') === shipped)) mismatches.push([row.id, i, 'lost']);
    }
  }
  eq(mismatches, [], `${variants} variants, ${multi} of them multi-solution (max ${maxCount})`);
  eq(variants, LOTS.reduce((a, r) => a + compile(r.spec).n, 0), 'one variant per island in the pool');
  // Measured, and it is a statement about the generator rather than about luck: positive
  // construction verifies uniqueness but never *minimises*, so in the two easiest tiers no single
  // number is load-bearing (deleting one still leaves 解数 == 1), while in the upper tiers 31 of
  // 164 erasures do break uniqueness. DESIGN.md §6 carries this as a known limitation.
  eq(byTier.shoal, { variants: 33, multi: 0 }, 'shoal clues are redundant by construction');
  eq(byTier.sound, { variants: 54, multi: 0 }, 'so are sound');
  ok(byTier.archipelago.multi >= 10, `archipelago has load-bearing numbers: ${byTier.archipelago.multi}`);
  ok(byTier.ocean.multi >= 10, `ocean too: ${byTier.ocean.multi}`);
  eq(multi, 31, 'measured pool-wide; rerun this file to reproduce');
});

test('the ≥2 counter-proof on shipped data: erase two clues of a shoal or sound level', () => {
  const mismatches = [];
  const hist = {};
  let pairs = 0;
  let multi = 0;
  let maxCount = 0;
  let everyPair = [];
  for (const row of LOTS.filter((l) => l.tier === 'shoal' || l.tier === 'sound')) {
    const comp = compile(row.spec);
    let m = 0;
    let c = 0;
    for (let i = 0; i < comp.n; i++) {
      for (let j = i + 1; j < comp.n; j++) {
        const spec = withoutClue(withoutClue(row.spec, i), j);
        const mine = countSolutions(spec, 1 << 20, { collect: true, raw: true });
        const naive = naiveCounts(spec);
        pairs++;
        c++;
        hist[naive.count] = (hist[naive.count] || 0) + 1;
        if (!mine.solutions.some((v) => v.join(',') === row.solution.join(','))) mismatches.push([row.id, i, j, 'lost']);
        if (mine.count !== naive.count) mismatches.push([row.id, i, j, 'count', mine.count, naive.count]);
        else if (naive.count > 1 && naive.count <= 8 && sorted(mine.solutions) !== sorted(naive.solutions)) {
          mismatches.push([row.id, i, j, 'set']);
        }
        if (naive.count > 1) {
          multi++;
          m++;
          maxCount = Math.max(maxCount, naive.count);
          // "Not unique" must be provable without enumerating the space.
          const early = countSolutions(spec, 2);
          if (early.count !== 2 || early.stopped !== 'limit') mismatches.push([row.id, i, j, 'limit', early.count, early.stopped]);
        }
      }
    }
    if (m === c && c) everyPair.push(row.id);
  }
  eq(mismatches, [], `${pairs} double erasures`);
  eq(multi, 142, 'measured: 142 of the 208 pairs of erased clues admit a second layout');
  eq(pairs, 208);
  // A counter-proof that only ever produced 2 would be weak: the same search space really does
  // hold 3, 4 and 5 layouts for the right erasures.
  ok(maxCount >= 5, `most ambiguous variant has ${maxCount} solutions`);
  eq(everyPair, ['shoal-05', 'shoal-07'], 'levels where *every* pair of clues is load-bearing together');
});

test('theSolution hands back the single placement with its identity numbers', () => {
  for (const spec of [SQUARE_A, SQUARE_X, COMB_B]) {
    const s = theSolution(spec);
    ok(s, 'unique by hand');
    eq(s.roots, handshake(compile(spec)).target);
    eq(s.degrees, Array.from(compile(spec).p));
  }
  eq(theSolution(TIPS_C), null, 'nothing to hand back for an unsolvable spec');
  eq(theSolution(withoutClue(COMB_B, 2)), null, 'and nothing for a non-unique one');
});

test('pickSlot and propagate are deterministic: same spec, same node count, every time', () => {
  for (const row of LOTS) {
    const a = countSolutions(row.spec, 2);
    const b = countSolutions(row.spec, 2);
    eq([a.nodes, a.count, a.stopped], [b.nodes, b.count, b.stopped], row.id);
  }
  const comp = compile(SQUARE_A);
  const dom = new Uint8Array(comp.nSlots).fill(7);
  eq(pickSlot(comp, dom), 0, 'an untouched board branches at the first slot');
  const trace = [];
  const r = propagate(comp, dom, { trace });
  ok(r.ok, JSON.stringify(r));
});

test('the counter does not mutate the spec it is given', () => {
  const spec = JSON.parse(JSON.stringify(COMB_B));
  const before = JSON.stringify(spec);
  countSolutions(spec, 5, { collect: true });
  theSolution(spec);
  eq(JSON.stringify(spec), before);
});

run();
