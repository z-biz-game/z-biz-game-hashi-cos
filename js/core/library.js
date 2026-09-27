// The shipped pool. The game picks puzzles from here; it never generates them, and that is a
// measured decision (see tools/bake.mjs and DESIGN.md §5).
//
// Everything below is a pure lookup over js/data/lots.js, which is why the daily puzzle and a
// shared link are reproducible with no state: the pool is fixed and the seed only chooses an
// index. Each row's `k` (reasoning depth) and `roots` (= sum(p)/2) were computed from the
// serialised spec by the build, and test/library.test.mjs recomputes them on every run — a
// hand-edit to a number in js/data/lots.js fails there, not in someone's face.

import { LOTS, TIERS_META } from '../data/lots.js';
import { compile, handshake } from './model.js';
import { hashSeed } from './rng.js';

// Display-side tier list (label / blurb / band). The generation ladder with its search budgets
// lives in make.js and is not needed once the pool is baked.
export const TIERS = TIERS_META;

const prepared = LOTS.map((row) => {
  // Compiled from the *serialised* spec: nothing downstream re-measures it, so a stale bake
  // shows up as a wrong number rather than as a lucky coincidence.
  const comp = compile(row.spec);
  return {
    id: row.id,
    tier: row.tier,
    k: row.k,
    islands: row.islands,
    roots: row.roots,
    sumP: row.sumP,
    nodes: row.nodes,
    spec: row.spec,
    solution: row.solution,
    comp,
    target: handshake(comp).target,
  };
});

export const ALL = prepared;

function pick(list, seed, salt) {
  if (!list.length) return null;
  return list[hashSeed(`${salt}|${seed}`) % list.length];
}

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}

export function lotsIn(key) {
  return prepared.filter((l) => l.tier === key);
}

export function byId(id) {
  return prepared.find((l) => l.id === id) || null;
}

// The campaign: every baked puzzle, easiest band first and within a band by (k, roots) — the
// order tools/bake.mjs wrote them in.
export function campaign() {
  return prepared;
}

export function levelAt(index) {
  return prepared[((index % prepared.length) + prepared.length) % prepared.length];
}

// Endless play inside one band. A seed picks, so `#/random/…/<token>` links stay honest.
export function randomPuzzle(seed, tierKey) {
  const list = tierKey ? lotsIn(tierKey) : prepared;
  return pick(list, seed, 'random');
}

// One puzzle per calendar day, the same for everyone.
export function dailyPuzzle(dateKey) {
  return pick(prepared, dateKey, 'daily');
}

function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

// What the pool actually contains, measured rather than claimed. The harness prints this so a
// re-bake that quietly loses depth shows up as a changed band, and the docs quote it instead of
// copying a feeling.
export function stats() {
  const byTier = {};
  for (const l of prepared) {
    const s = byTier[l.tier] || (byTier[l.tier] = {
      n: 0, kMin: Infinity, kMax: -Infinity, islMin: Infinity, islMax: 0,
      rootsMin: Infinity, rootsMax: 0, nodesMax: 0, ks: [], roots: [],
    });
    s.n++;
    s.kMin = Math.min(s.kMin, l.k);
    s.kMax = Math.max(s.kMax, l.k);
    s.islMin = Math.min(s.islMin, l.islands);
    s.islMax = Math.max(s.islMax, l.islands);
    s.rootsMin = Math.min(s.rootsMin, l.roots);
    s.rootsMax = Math.max(s.rootsMax, l.roots);
    s.nodesMax = Math.max(s.nodesMax, l.nodes);
    s.ks.push(l.k);
    s.roots.push(l.roots);
  }
  for (const s of Object.values(byTier)) {
    s.ks.sort((a, b) => a - b);
    s.roots.sort((a, b) => a - b);
    s.kMed = median(s.ks);
    s.rootsMed = median(s.roots);
    delete s.ks;
    delete s.roots;
  }
  return { puzzles: prepared.length, byTier };
}
