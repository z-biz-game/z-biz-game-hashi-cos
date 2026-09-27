// The generator's numbers, measured. js/core/make.js builds a board and then *proves* it unique
// before handing it over, and tools/bake.mjs pays that price once at build time so a tap on the
// screen never waits for a proof. This file is where the cost of that decision is measured:
//
//   node test/balance.mjs                 # 8 seeds per tier
//   SEEDS=20 node test/balance.mjs        # more seeds, same table
//   TIERS=shoal,Sound node test/balance.mjs
//
// It is a measurement, not a test suite, so it is deliberately not named `*.test.mjs` and
// `node --test test/` does not pick it up. What it *does* fail on are the invariants a set of
// measurements has to satisfy to mean anything: every accepted puzzle must still be unique when
// re-counted from its own serialised spec, its printed depth must reproduce, and the drop counters
// must add up. A rate is only interesting if the accounting behind it is honest.
//
// The seeds are fixed strings, so the table below is reproducible: two runs print the same numbers.
import { TIERS, makePuzzle } from '../js/core/make.js';
import { compile, validate, checkSpec, handshake, boundOf, serialize, deserialize } from '../js/core/model.js';
import { countSolutions } from '../js/core/count.js';
import { reason } from '../js/core/logic.js';

const SEEDS = Math.max(1, Number(process.env.SEEDS || 8) || 8);
const WALL_MS = Math.max(1000, Number(process.env.WALL_MS || 120000) || 120000);
const wanted = (process.env.TIERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ladder = wanted.length ? TIERS.filter((t) => wanted.includes(t.key)) : TIERS;

const problems = [];
const rows = [];
const started = Date.now();

for (const tier of ladder) {
  const stats = {};
  const accepted = [];
  let nsTotal = 0n;
  let nsMax = 0n;
  for (let s = 0; s < SEEDS; s++) {
    if (Date.now() - started > WALL_MS) {
      problems.push(`${tier.key}: stopped after ${s} seeds at the ${WALL_MS}ms wall clock cap`);
      break;
    }
    // Nanoseconds, because a seed that costs 0.4 ms reads as "0" on an integer clock and a table
    // of zeros is not a measurement.
    const t0 = process.hrtime.bigint();
    const puzzle = makePuzzle(`balance-${tier.key}-${s}`, tier, stats);
    const ns = process.hrtime.bigint() - t0;
    nsTotal += ns;
    if (ns > nsMax) nsMax = ns;
    if (!puzzle) continue;
    accepted.push(puzzle);

    // Re-check everything the puzzle claims, from its own serialised bytes rather than from the
    // generator's in-memory object — the same gate tools/bake.mjs applies before it ships a line.
    const spec = deserialize(serialize(puzzle.spec));
    const comp = compile(spec);
    const bad = checkSpec(spec);
    if (!bad.ok) problems.push(`${tier.key}/${puzzle.seed}: invalid spec: ${bad.errors[0]}`);
    for (let i = 0; i < comp.n; i++) {
      if (comp.p[i] > boundOf(comp, i)) problems.push(`${tier.key}/${puzzle.seed}: island ${i} breaks the structural bound`);
    }
    const again = countSolutions(spec, 2);
    if (!again.unique) problems.push(`${tier.key}/${puzzle.seed}: 解数 ${again.count} (stopped=${again.stopped}), not 1`);
    const solution = Array.from(again.solutions[0] || []);
    if (solution.join(',') !== puzzle.solution.join(',')) problems.push(`${tier.key}/${puzzle.seed}: a different answer than the generator returned`);
    if (!validate(spec, solution)) problems.push(`${tier.key}/${puzzle.seed}: the counted answer fails the validator`);
    const hs = handshake(comp);
    if (hs.target !== puzzle.rating.roots) problems.push(`${tier.key}/${puzzle.seed}: roots ${puzzle.rating.roots} vs Σp/2 ${hs.target}`);
    const reasoned = reason(spec);
    if (!reasoned.ok || reasoned.depth !== puzzle.rating.k) {
      problems.push(`${tier.key}/${puzzle.seed}: depth ${puzzle.rating.k} not reproducible (got ${reasoned.depth})`);
    }
    if (puzzle.rating.k < tier.k[0] || puzzle.rating.k > tier.k[1]) {
      problems.push(`${tier.key}/${puzzle.seed}: depth ${puzzle.rating.k} outside the ladder band ${tier.k.join('-')}`);
    }
  }

  const tries = SEEDS * (tier.restarts || 40);
  const unique = stats.unique || 0;
  const notUnique = stats.notUnique || 0;
  const unsolvable = stats.unsolvable || 0;
  const gaveUp = stats.gaveUp || 0;
  const badSpec = Object.keys(stats).filter((k) => k.startsWith('badSpec:')).reduce((a, k) => a + stats[k], 0);
  // The counters are not one bucket per candidate: `candidate()` counts `unique` and can then drop
  // that same candidate for `offBand`, so the two groups below are accounted separately. The first
  // set is the mutually exclusive outcome of a candidate; `offBand` and `reasonBudget` are
  // sub-outcomes of `unique`, so each is bounded by it rather than by `tries`.
  const gate = unique + notUnique + unsolvable + (stats.searchBudget || 0)
    + (stats.noTree || 0) + (stats.noLayout || 0) + badSpec + (stats.builtBoardFailsValidate || 0);
  if (gaveUp + (stats.found || 0) !== SEEDS) problems.push(`${tier.key}: found+gaveUp ${(stats.found || 0) + gaveUp} != ${SEEDS} seeds`);
  if (gate > tries) problems.push(`${tier.key}: ${gate} candidate outcomes for at most ${tries} candidates`);
  if (unique + notUnique + unsolvable > tries) problems.push(`${tier.key}: ${unique + notUnique + unsolvable} uniqueness verdicts for at most ${tries} candidates`);
  if ((stats.offBand || 0) > unique) problems.push(`${tier.key}: ${stats.offBand} offBand without being unique first`);
  if ((stats.reasonBudget || 0) > unique) problems.push(`${tier.key}: ${stats.reasonBudget} reasonBudget without being unique first`);
  if (accepted.length !== (stats.found || 0)) problems.push(`${tier.key}: ${accepted.length} puzzles returned for ${stats.found || 0} 'found' counters`);
  rows.push({
    tier: tier.key,
    grid: `${tier.w}×${tier.h}`,
    band: `${tier.islands[0]}-${tier.islands[1]} 岛`,
    depth: `${tier.k[0]}-${tier.k[1]}`,
    seeds: SEEDS,
    restarts: tier.restarts || 40,
    accepted: stats.found || 0,
    gaveUp,
    unique,
    notUnique,
    acceptOfCandidates: unique + notUnique ? (100 * unique) / (unique + notUnique) : NaN,
    msPerSeed: SEEDS ? Number(nsTotal) / 1e6 / SEEDS : NaN,
    msMax: Number(nsMax) / 1e6,
    maxCountNodes: Math.max(0, ...accepted.map((p) => p.rating.countNodes)),
    maxReasonNodes: Math.max(0, ...accepted.map((p) => p.rating.reasonNodes)),
    maxGuesses: Math.max(0, ...accepted.map((p) => p.rating.guesses)),
    drops: Object.keys(stats).filter((k) => k !== 'unique' && k !== 'found' && k !== 'gaveUp')
      .sort((a, b) => stats[b] - stats[a])
      .map((k) => `${k}:${stats[k]}`)
      .join(' '),
  });
}

const head = ['tier', 'grid', 'band', 'depth', 'seeds', 'accept', 'gaveUp', 'unique', '解数>1', 'of cand.', 'ms/seed', 'ms max', 'maxNodes', 'maxGuess'];
const cell = (r) => [
  r.tier, r.grid, r.band, r.depth, r.seeds, r.accepted, r.gaveUp, r.unique, r.notUnique,
  Number.isNaN(r.acceptOfCandidates) ? 'n/a' : `${r.acceptOfCandidates.toFixed(0)}%`,
  r.msPerSeed.toFixed(1), r.msMax.toFixed(1), r.maxCountNodes, r.maxGuesses,
];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(cell(r)[i]).length)));
const line = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
console.log(line(head));
for (const r of rows) console.log(line(cell(r)));
console.log('');
for (const r of rows) console.log(`${r.tier}: dropped — ${r.drops || 'nothing'}`);
console.log(`\nwall: ${((Date.now() - started) / 1000).toFixed(1)}s for ${ladder.length} tiers × ${SEEDS} seeds`);
console.log('```json\n' + JSON.stringify({ env: { SEEDS, TIERS: ladder.map((t) => t.key), node: process.version }, rows }, null, 1) + '\n```');

if (rows.length && rows.every((r) => r.accepted === 0)) {
  problems.push('every tier accepted nothing: the ladder, not the measurement, is broken');
}
for (const p of problems) console.error(`FAIL ${p}`);
console.log(problems.length ? `balance: ${problems.length} problem(s)` : 'balance: measurements stand');
process.exit(problems.length ? 1 : 0);
