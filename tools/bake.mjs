// The content pipeline: this is where the game's puzzles come from, and the browser never
// generates anything, it only picks one.
//
// Why offline: test/balance.mjs measures the generator (acceptance rate, per-puzzle milliseconds,
// search nodes). Reconstructing a board and then *proving* it unique is a build-step cost, and a
// tap on the screen must never wait for a proof.
//
//   node tools/bake.mjs
//   PER_TIER=12 node tools/bake.mjs
//
// A puzzle only enters js/data/lots.js if re-reading it out of JSON reproduces all four printed
// numbers: solution count == 1, the connected-and-legal verdict, sum(p)/2 == bridge roots, and
// the reasoning depth k. Nothing unmeasured ships, and nothing hand-editable ships without a test
// that would notice the edit.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIERS, makePuzzle } from '../js/core/make.js';
import { countSolutions } from '../js/core/count.js';
import { reason } from '../js/core/logic.js';
import { serialize, compile, validate, checkSpec, handshake, boundOf } from '../js/core/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PER_TIER = Number(process.env.PER_TIER || 8);
const SEED_LIMIT = Number(process.env.SEED_LIMIT || PER_TIER * 60);

const out = [];
const acceptance = [];
for (const tier of TIERS) {
  const seen = new Set();
  const picked = [];
  const stats = {};
  const t0 = Date.now();
  for (let s = 0; picked.length < PER_TIER && s < SEED_LIMIT; s++) {
    const puzzle = makePuzzle(`bake-${tier.key}-${s}`, tier, stats);
    if (!puzzle) continue;
    const spec = JSON.parse(JSON.stringify(puzzle.spec)); // force the JSON shape the file will hold
    const sig = serialize(spec);
    if (seen.has(sig)) {
      stats.duplicate = (stats.duplicate || 0) + 1;
      continue;
    }
    const comp = compile(spec);
    // Four re-checks, all from the serialised spec rather than from the generator's memory.
    const bad = checkSpec(spec);
    if (!bad.ok) throw new Error(`${tier.key}: generator emitted an invalid spec: ${bad.errors[0]}`);
    for (let i = 0; i < comp.n; i++) {
      if (comp.p[i] > boundOf(comp, i)) throw new Error(`${tier.key}: island ${i} breaks the structural bound`);
    }
    const again = countSolutions(spec, 2);
    if (!again.unique) {
      throw new Error(`${tier.key}: count ${again.count} (stopped=${again.stopped}) — uniqueness not reproducible`);
    }
    const solution = Array.from(again.solutions[0]);
    if (!validate(spec, solution)) throw new Error(`${tier.key}: the counted solution fails validate`);
    const hs = handshake(comp);
    const roots = solution.reduce((a, b) => a + b, 0);
    if (roots !== hs.target || hs.target !== puzzle.rating.roots) {
      throw new Error(`${tier.key}: handshake ${roots} vs ${hs.target} vs ${puzzle.rating.roots}`);
    }
    const reasoned = reason(spec);
    if (!reasoned.ok || reasoned.depth !== puzzle.rating.k) {
      throw new Error(`${tier.key}: depth ${puzzle.rating.k} not reproducible (got ${reasoned.depth})`);
    }
    seen.add(sig);
    picked.push({
      tier: tier.key,
      k: reasoned.depth,
      islands: comp.n,
      roots: hs.target,
      sumP: hs.sumP,
      slots: comp.nSlots,
      nodes: again.nodes,
      spec,
      solution,
    });
    process.stdout.write(`\r${tier.key}: ${picked.length}/${PER_TIER}  ${((Date.now() - t0) / 1000).toFixed(1)}s   `);
  }
  process.stdout.write(`\n`);
  if (picked.length < PER_TIER) console.error(`warn: ${tier.key} only reached ${picked.length} puzzles`);
  picked.sort((a, b) => a.k - b.k || a.roots - b.roots || a.islands - b.islands);
  picked.forEach((p, i) => { p.id = `${tier.key}-${String(i + 1).padStart(2, '0')}`; });
  out.push(...picked);
  const unique = stats.unique || 0;
  const notUnique = stats.notUnique || 0;
  acceptance.push({
    tier: tier.key,
    ships: picked.length,

    acceptOfCandidates: unique + notUnique ? `${((100 * unique) / (unique + notUnique)).toFixed(0)}%` : 'n/a',
    unique,
    notUnique,
    offBand: stats.offBand || 0,
    noTree: stats.noTree || 0,
    ms: picked.length ? (Date.now() - t0) / picked.length : 0,
    maxNodes: Math.max(0, ...picked.map((p) => p.nodes)),
  });
}

// The bands the UI prints are measured off the puzzles that actually shipped, not copied from
// the generator's wish list, so a re-bake that lands lighter or heavier says so.
const meta = TIERS.map((t) => {
  const mine = out.filter((l) => l.tier === t.key);
  const ks = mine.map((l) => l.k);
  const isl = mine.map((l) => l.islands);
  const roots = mine.map((l) => l.roots);
  return {
    key: t.key,
    label: t.label,
    min: Math.min(...ks),
    max: Math.max(...ks),
    islMin: Math.min(...isl),
    islMax: Math.max(...isl),
    rootsMin: Math.min(...roots),
    rootsMax: Math.max(...roots),
    blurb: `${t.w}×${t.h} · ${Math.min(...isl)}-${Math.max(...isl)} 岛 · 深度 ${Math.min(...ks)}-${Math.max(...ks)}`,
  };
});

const lines = [
  '// Generated by tools/bake.mjs — the puzzles in this game are measurements, not opinions.',
  '// `k` is the reasoning depth js/core/logic.js reaches and `roots` is sum(p)/2 for the spec on',
  '// the same line. Re-run `node tools/bake.mjs` instead of hand-editing; `node',
  '// test/library.test.mjs` re-counts and re-reasons every line and fails on a disagreement.',
  `export const TIERS_META = ${JSON.stringify(meta)};`,
  'export const LOTS = [',
  ...out.map((l) => `  ${JSON.stringify(l)},`),
  '];',
  '',
];
const path = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, lines.join('\n'));

const byTier = {};
for (const l of out) byTier[l.tier] = (byTier[l.tier] || 0) + 1;
console.log(`wrote ${out.length} puzzles (${Object.entries(byTier).map(([k, n]) => `${k}:${n}`).join(' ')}) -> js/data/lots.js`);
console.log('tier      ships  unique  notUnique  offBand  noTree  accept  ms/puzzle  maxNodes');
for (const a of acceptance) {
  console.log(
    a.tier.padEnd(12)
    + String(a.ships).padStart(5)
    + String(a.unique).padStart(9)
    + String(a.notUnique).padStart(10)
    + String(a.offBand).padStart(9)
    + String(a.noTree).padStart(8)
    + ` ${String(a.acceptOfCandidates).padStart(6)}`
    + ` ${a.ms.toFixed(1).padStart(9)}`
    + String(a.maxNodes).padStart(10),
  );
}
