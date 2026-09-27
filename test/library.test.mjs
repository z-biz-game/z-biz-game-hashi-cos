// js/data/lots.js and js/core/library.js: the shipped pool is the only place this game stores an
// opinion, and every number in it is supposed to be a measurement. So this suite re-runs the
// measurement on the deserialised artifact and fails on any disagreement — which is also the
// reason a hand-edit to a difficulty number cannot survive a commit.
//
// Nothing here reads a value from the generator's memory: `row.spec` is pulled out of the file,
// turned back into JSON and parsed again, exactly as a browser would do it.
import { test, run, eq, ok } from '../tools/harness.mjs';
import { LOTS, TIERS_META } from '../js/data/lots.js';
import { ALL, byId, levelAt, lotsIn, campaign, dailyPuzzle, randomPuzzle, tierByKey, stats } from '../js/core/library.js';
// The *generation* ladder (search budget, board size), not the published bands: `TIERS` in
// js/core/library.js is TIERS_META, which is measured off the pool and carries no `w`/`h`. The
// blurb is the one string that mixes both sources — the grid from the ladder, the bands from the
// pool — so the test that checks it has to import the ladder from where it actually lives.
import { TIERS as GEN } from '../js/core/make.js';
import { compile, serialize, deserialize, validate, handshake, rootsOf, boundOf, checkSpec } from '../js/core/model.js';
import { countSolutions, theSolution } from '../js/core/count.js';
import { reason } from '../js/core/logic.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

// Re-derive everything a row prints, from the row's own serialised spec. Returns one string per
// disagreement, so the caller decides whether it wanted zero of them or a specific number.
function reverify(rows) {
  const bad = [];
  for (const row of rows) {
    const spec = deserialize(serialize(clone(row.spec))); // the file's bytes, through JSON and back
    const comp = compile(spec);
    const hs = handshake(comp);
    const counted = countSolutions(spec, 2);
    const reasoned = reason(spec);
    if (!checkSpec(spec).ok) bad.push(`${row.id}: spec invalid`);
    if (comp.n !== row.islands) bad.push(`${row.id}: islands ${comp.n} vs printed ${row.islands}`);
    if (comp.nSlots !== row.slots) bad.push(`${row.id}: slots ${comp.nSlots} vs printed ${row.slots}`);
    if (hs.sumP !== row.sumP) bad.push(`${row.id}: sumP ${hs.sumP} vs printed ${row.sumP}`);
    if (hs.target !== row.roots) bad.push(`${row.id}: roots ${hs.target} vs printed ${row.roots}`);
    if (rootsOf(Uint8Array.from(row.solution)) !== row.roots) {
      bad.push(`${row.id}: the printed answer itself holds ${rootsOf(Uint8Array.from(row.solution))} roots, not ${row.roots}`);
    }
    if (!counted.unique) bad.push(`${row.id}: count ${counted.count} stopped=${counted.stopped}`);
    if (counted.nodes !== row.nodes) bad.push(`${row.id}: counter nodes ${counted.nodes} vs printed ${row.nodes}`);
    if (!reasoned.ok || reasoned.depth !== row.k) bad.push(`${row.id}: depth ${reasoned.depth} vs printed ${row.k}`);
    if (!validate(spec, row.solution)) bad.push(`${row.id}: the answer fails the validator`);
    if (Array.from(reasoned.solution || []).join(',') !== row.solution.join(',')) {
      bad.push(`${row.id}: the reasoner found a different answer than the counter`);
    }
    for (let i = 0; i < comp.n; i++) {
      if (comp.p[i] > boundOf(comp, i)) bad.push(`${row.id}: island ${i} breaks p <= 2x方向数`);
    }
  }
  return bad;
}

test('every number printed on every shipped puzzle is reproduced from the serialised spec', () => {
  eq(LOTS.length, 32, 'four bands, eight puzzles each');
  eq(reverify(LOTS), [], 're-counted, re-reasoned, re-validated, digit by digit');
});

test('the re-verification is not a rubber stamp: five tampered rows, five complaints', () => {
  // The whole point of a build-time measurement is that someone can edit the artifact afterwards.
  // Each mutation below is one plausible hand-edit to js/data/lots.js, and each has to be caught by
  // the loop above rather than by an honour system.
  const tampers = [];

  const bumpedDepth = clone(LOTS);
  bumpedDepth[5].k += 1;
  tampers.push(['prints a deeper 推理深度 than the solver reaches', bumpedDepth, /depth/]);

  const bumpedRoots = clone(LOTS);
  bumpedRoots[9].roots += 1;
  tampers.push(['prints a root count the identity does not give', bumpedRoots, /roots/]);

  const cheaperNodes = clone(LOTS);
  cheaperNodes[17].nodes = 1;
  tampers.push(['claims the exhaustive counter needed fewer states', cheaperNodes, /counter nodes/]);

  const nudgedClue = clone(LOTS);
  const target = compile(nudgedClue[22].spec);
  nudgedClue[22].spec.islands[0].p = target.p[0] === 1 ? 2 : 1; // a legal clue, just the wrong one
  nudgedClue[22].solution = [];
  tampers.push(['edits one island number', nudgedClue, /./]);

  const swappedAnswer = clone(LOTS);
  const v = swappedAnswer[30].solution;
  v[v.indexOf(Math.max(...v))] = 0; // a root quietly removed from the printed answer
  tampers.push(['ships an answer that no longer meets the numbers', swappedAnswer, /fails the validator/]);

  const report = [];
  for (const [name, rows, pattern] of tampers) {
    const bad = reverify(rows).filter((m) => pattern.test(m));
    report.push({ name, caught: bad.length > 0, first: bad[0] || null });
  }
  eq(report.filter((r) => !r.caught).map((r) => r.name), [], 'every tamper produced at least one complaint');
  // ... and an untouched pool produces none, which is what makes the five above meaningful.
  eq(reverify(clone(LOTS)), []);
});

test('the printed answer is the unique one, by two routes that share no state', () => {
  const drift = [];
  for (const row of LOTS) {
    const spec = deserialize(serialize(row.spec));
    const certified = theSolution(spec);
    if (!certified) { drift.push([row.id, 'not unique']); continue; }
    if (certified.bridges.join(',') !== row.solution.join(',')) drift.push([row.id, 'different bridge']);
    if (certified.roots !== row.roots) drift.push([row.id, 'roots', certified.roots, row.roots]);
    if (certified.degrees.join(',') !== Array.from(compile(spec).p).join(',')) drift.push([row.id, 'degrees']);
  }
  eq(drift, [], 'Σp/2 counted off the placed bridges equals Σp/2 summed off the clues, on all 32');
});

test('解数 = 1 is a decision the generator made, not a wish: 31 load-bearing erasures', () => {
  // The counter-proof from the brief, run on shipped data rather than on a fixture. Erasing a
  // number can only relax a puzzle, so a row whose every number matters stops being unique the
  // moment one is erased. tools/bake.mjs never minimises, so in the two easiest bands no single
  // number is load-bearing (test/count.test.mjs measures that: 0 of 33 and 0 of 54); in the upper
  // two it happens often, and the whole pool admits it 31 times. Those are the rows that prove the
  // uniqueness test has teeth, and they are counted here rather than asserted away.
  //
  // This probe stops at the second solution (`limit`), while test/count.test.mjs enumerates the
  // same 164 variants to the end and reports 31 multi-solution ones. Two different engines, two
  // different stopping rules, one number — that agreement is the point of keeping both.
  let loadBearing = 0;
  const perTier = {};
  const neverUnique = [];
  for (const row of LOTS) {
    const comp = compile(row.spec);
    for (let i = 0; i < comp.n; i++) {
      const r = countSolutions({ w: row.spec.w, h: row.spec.h, islands: comp.islands.map((x, j) => ({ r: x.r, c: x.c, p: j === i ? null : x.p })) }, 2);
      if (!r.unique && r.stopped === 'limit') {
        loadBearing++;
        perTier[row.tier] = (perTier[row.tier] || 0) + 1;
      } else if (r.count !== 1) {
        neverUnique.push([row.id, i, r.count]);
      }
    }
  }
  eq(neverUnique, [], 'erasing a clue can never make a solved board unsolvable');
  eq(perTier, { archipelago: 13, ocean: 18 }, 'measured; `node test/library.test.mjs` recomputes it');
  eq(loadBearing, 31, 'and it is the same 31 that the exhaustive sweep in test/count.test.mjs lands on');
  ok(loadBearing > 0, 'a pool with no load-bearing number would not be testing the uniqueness gate');
});

test('a contradictory board is answered with 0, on shipped geometry too', () => {
  // Take a real baked spec and change one clue so the four equations of its own ring contradict:
  // the generator would have dropped this candidate, and the counter has to say "no solution"
  // rather than returning the nearest thing to one.
  const row = LOTS.find((l) => l.id === 'shoal-07');
  const comp = compile(row.spec);
  eq(countSolutions(row.spec, 2).count, 1, 'as printed, it is solvable and unique');
  const broken = deserialize(serialize(row.spec));
  broken.islands[0].p = comp.p[0] + 1; // odd sum(p): the handshake lemma alone rules it out
  eq(checkSpec(broken).ok, false, 'and the spec-level check notices before any search');
  const even = deserialize(serialize(row.spec));
  even.islands[1].p = comp.p[1] === 1 ? 2 : 1;
  if (handshake(compile(even)).even) {
    ok(countSolutions(even, 2).count <= 1, 'a parity-legal tamper is answered by the search, not by the parity filter');
  }
  eq(countSolutions(broken, 2).count, 0, 'the counter itself also returns zero, independently');
});

test('TIERS_META describes the pool that actually shipped', () => {
  const wrong = [];
  for (const meta of TIERS_META) {
    const mine = LOTS.filter((l) => l.tier === meta.key);
    const k = mine.map((l) => l.k);
    const isl = mine.map((l) => l.islands);
    const roots = mine.map((l) => l.roots);
    const gen = GEN.find((t) => t.key === meta.key);
    if (!gen) { wrong.push(`${meta.key}: no such generation tier`); continue; }
    if (meta.min !== Math.min(...k) || meta.max !== Math.max(...k)) wrong.push(`${meta.key}: depth band`);
    if (meta.islMin !== Math.min(...isl) || meta.islMax !== Math.max(...isl)) wrong.push(`${meta.key}: island band`);
    if (meta.rootsMin !== Math.min(...roots) || meta.rootsMax !== Math.max(...roots)) wrong.push(`${meta.key}: root band`);
    // The grid size is the only part of the string the pool cannot vouch for: every puzzle in a
    // tier shares it because the generator was told to draw on it.
    if (mine.every((l) => l.spec.w === gen.w && l.spec.h === gen.h) === false) wrong.push(`${meta.key}: not every row is ${gen.w}×${gen.h}`);
    if (meta.blurb !== `${gen.w}×${gen.h} · ${Math.min(...isl)}-${Math.max(...isl)} 岛 · 深度 ${Math.min(...k)}-${Math.max(...k)}`) {
      wrong.push(`${meta.key}: blurb "${meta.blurb}"`);
    }
  }
  eq(wrong, []);
  const bands = TIERS_META.map((t) => [t.min, t.max]);
  eq(bands, [[0, 0], [1, 1], [2, 2], [3, 3]], 'the four published bands are disjoint in reasoning depth');
  const islBands = TIERS_META.map((t) => [t.islMin, t.islMax]);
  eq(islBands.every((b, i) => i === 0 || b[0] > islBands[i - 1][1]), true, 'and disjoint in island count');
});

test('the library layer is a pure lookup over the pool, in the order the bake wrote it', () => {
  eq(ALL.length, LOTS.length);
  eq(ALL.map((l) => l.id), LOTS.map((l) => l.id), 'same order, so #/c/<n> means the same puzzle for everyone');
  eq(campaign(), ALL);
  eq(byId('ocean-08').id, 'ocean-08');
  eq(byId('no-such-lot'), null);
  eq(levelAt(0).id, LOTS[0].id);
  eq(levelAt(-1).id, LOTS[LOTS.length - 1].id, 'a negative index wraps, it does not crash');
  eq(levelAt(LOTS.length).id, LOTS[0].id, 'and the length wraps back to the first');
  let partition = 0;
  for (const t of TIERS_META) partition += lotsIn(t.key).length;
  eq(partition, LOTS.length, 'the bands partition the pool');
  eq(lotsIn('nope'), []);
  eq(tierByKey('nope').key, 'shoal', 'an unknown band falls back to the easiest one');
  for (const l of ALL) eq(l.target, handshake(l.comp).target, l.id);
});

test('stats() reports what the pool holds, and nothing is rounded into a claim', () => {
  const s = stats();
  eq(s.puzzles, LOTS.length);
  eq(Object.keys(s.byTier).length, 4);
  for (const [key, t] of Object.entries(s.byTier)) {
    const mine = LOTS.filter((l) => l.tier === key);
    eq(t.n, mine.length, key);
    eq([t.kMin, t.kMax], [Math.min(...mine.map((l) => l.k)), Math.max(...mine.map((l) => l.k))], key);
    eq(t.nodesMax, Math.max(...mine.map((l) => l.nodes)), `${key}: the deepest search the counter ran in this band`);
    ok(t.kMed >= t.kMin && t.kMed <= t.kMax, `${key}: the median sits inside the band`);
  }
  // The daily and the shared-link routes both go through this table, so a drift here is a drift in
  // what two players see. rng.test.mjs pins the hash; this pins the lookup.
  const day = dailyPuzzle('2026-09-27');
  eq(byId(day.id), day, 'the daily row is a row of the pool, not a copy');
  eq(JSON.stringify(dailyPuzzle('2026-09-27').spec), JSON.stringify(day.spec));
  eq(randomPuzzle('shoal|fixedseed', 'shoal').tier, 'shoal');
});

test('nothing in the pool is stale relative to the file it was baked from', () => {
  // serialize() is the wire format and the save format; the file must already be in it, otherwise a
  // round-trip could quietly reorder islands and invalidate every hard-coded slot index in the tests.
  const drift = [];
  for (const row of LOTS) {
    const text = serialize(row.spec);
    if (text !== JSON.stringify(deserialize(text))) drift.push(`${row.id}: not canonical`);
    const back = deserialize(text);
    if (JSON.stringify(back.islands.map((x) => [x.r, x.c])) !== JSON.stringify(compile(row.spec).islands.map((x) => [x.r, x.c]))) {
      drift.push(`${row.id}: the round-trip moved an island`);
    }
    if (back.islands.length !== row.spec.islands.length) drift.push(`${row.id}: lost an island`);
  }
  eq(drift, []);
  eq(LOTS.some((l) => l.spec.islands.some((x) => x.p === null)), false, 'no wildcard ever ships');
  eq(LOTS.every((l) => l.id === `${l.tier}-${String(LOTS.filter((m) => m.tier === l.tier).indexOf(l) + 1).padStart(2, '0')}`), true,
    'ids match the tier order the bake assigned');
});

run();
