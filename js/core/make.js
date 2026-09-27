// The generator. It runs at build time (tools/bake.mjs) and on tap it never runs — see that
// file and DESIGN.md §5 for the measured cost.
//
// The construction is *positive*: build a board that is already a solved Hashi, then read the
// numbers off it. That ordering matters twice over.
//
//   1. Connectivity and the structural bound cannot be violated by a puzzle from here, because
//      the bridge graph is connected by construction and every island's p is its own degree in
//      a graph where each direction holds at most 2 roots (p <= 2 x directions is then a
//      theorem about the output, not a filter — the validator still checks it independently).
//   2. The only thing left to test is the one thing that cannot be built in: uniqueness. So
//      acceptance rate is exactly "fraction of connected bridge graphs whose number layout has
//      one solution", which is the number test/balance.mjs prints.
//
// A random scatter with a uniqueness filter afterwards does not work either: most scatters
// leave islands with no direction at all (nothing aligned on their row or column), which is
// structurally invalid rather than merely hard. So the layout grows island by island, each new
// island landing on the row or the column of one already placed.

import { compile, validate, handshake, checkSpec } from './model.js';
import { countSolutions } from './count.js';
import { reason } from './logic.js';
import { rngFrom } from './rng.js';

// n distinct cells, connected through shared rows/columns.
function layout(rng, w, h, n) {
  const taken = new Set();
  const key = (r, c) => r * 1000 + c;
  const r0 = rng.int(h);
  const c0 = rng.int(w);
  taken.add(key(r0, c0));
  const cells = [{ r: r0, c: c0 }];
  let guard = 0;
  while (cells.length < n && guard++ < 400) {
    const from = cells[rng.int(cells.length)];
    const horizontal = rng.chance(0.5);
    const delta = rng.range(1, Math.max(1, (horizontal ? w : h) - 1));
    const sign = rng.chance(0.5) ? 1 : -1;
    const r = horizontal ? from.r : from.r + sign * delta;
    const c = horizontal ? from.c + sign * delta : from.c;
    if (r < 0 || c < 0 || r >= h || c >= w || taken.has(key(r, c))) continue;
    taken.add(key(r, c));
    cells.push({ r, c });
  }
  return cells.length === n ? cells : null;
}

// A connected bridge multigraph over the legal slots: a random spanning tree (each tree edge
// carrying 1 or 2 roots) plus extra edges for density. Slots that cross an accepted slot are
// never accepted, so constraint 2 holds by construction; union-find over the islands makes
// constraint 3 hold by construction.
function bridgeGraph(rng, comp, extraChance, doubleChance) {
  const parent = Int16Array.from({ length: comp.n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const order = rng.shuffle(comp.slots.map((s) => s.i));
  const chosen = new Map();
  const blocked = (s) => s.crosses.some((o) => chosen.has(o));
  for (const i of order) {
    const s = comp.slots[i];
    if (blocked(s)) continue;
    const ra = find(s.a);
    const rb = find(s.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    chosen.set(i, rng.chance(doubleChance) ? 2 : 1);
  }
  if (chosen.size !== comp.n - 1) return null; // crossings starved the tree
  for (const i of order) {
    if (chosen.has(i)) continue;
    const s = comp.slots[i];
    if (blocked(s)) continue;
    if (!rng.chance(extraChance)) continue;
    chosen.set(i, rng.chance(doubleChance) ? 2 : 1);
  }
  return chosen;
}

function specFrom(comp, chosen) {
  const deg = new Int16Array(comp.n);
  for (const [i, n] of chosen) {
    deg[comp.slots[i].a] += n;
    deg[comp.slots[i].b] += n;
  }
  return {
    w: comp.w,
    h: comp.h,
    islands: comp.islands.map((x, i) => ({ r: x.r, c: x.c, p: deg[i] })),
  };
}

// One candidate: layout -> graph -> numbers -> uniqueness proof -> reasoning depth.
// `stats` tallies every reason a candidate was dropped, so the accept rate is auditable.
function candidate(seed, tier, stats) {
  const hit = (k) => {
    if (stats) stats[k] = (stats[k] || 0) + 1;
  };
  const rng = rngFrom(`${tier.key}|${seed}`);
  const n = tier.islands ? rng.range(tier.islands[0], tier.islands[1]) : rng.range(5, 8);
  const cells = layout(rng, tier.w, tier.h, n);
  if (!cells) {
    hit('noLayout');
    return null;
  }
  const comp = compile({ w: tier.w, h: tier.h, islands: cells.map((x) => ({ ...x, p: 1 })) });
  const chosen = bridgeGraph(rng, comp, tier.extra, tier.double);
  if (!chosen) {
    hit('noTree');
    return null;
  }
  const spec = specFrom(comp, chosen);
  const bad = checkSpec(spec);
  if (!bad.ok) {
    hit('badSpec:' + bad.errors[0].split(':')[0]);
    return null;
  }
  const t0 = Date.now();
  const counted = countSolutions(spec, 2, { nodes: tier.probeNodes || 200000, deadline: t0 + (tier.probeMs || 4000) });
  const ms = Date.now() - t0;
  if (counted.stopped === 'nodes' || counted.stopped === 'time') {
    hit('searchBudget');
    return null;
  }
  if (counted.count !== 1) {
    hit(counted.count === 0 ? 'unsolvable' : 'notUnique');
    return null;
  }
  hit('unique');
  const solution = counted.solutions[0];
  // Belt and braces: the construction guarantees this, and if it ever stops being true the
  // generator is lying, so fail loudly instead of shipping.
  if (!validate(spec, solution)) {
    hit('builtBoardFailsValidate');
    return null;
  }
  const reasoned = reason(spec, { maxDepth: tier.k[1] + 1, nodes: tier.reasonNodes || 60000 });
  if (!reasoned.ok) {
    hit(reasoned.stopped === 'nodes' ? 'reasonBudget' : 'tooDeep');
    return null;
  }
  const k = reasoned.depth;
  if (k < tier.k[0] || k > tier.k[1]) {
    hit('offBand');
    return null;
  }
  const hs = handshake(compile(spec));
  return {
    spec,
    solution: Array.from(solution),
    rating: {
      k,
      islands: compile(spec).n,
      roots: hs.target,
      sumP: hs.sumP,
      countNodes: counted.nodes,
      reasonNodes: reasoned.nodes,
      guesses: reasoned.guesses,
      ms,
    },
    seed,
    tier: tier.key,
  };
}

// makePuzzle(seed, tier, stats?) -> puzzle | null, deterministic in the seed.
export function makePuzzle(seed, tier, stats) {
  const tries = tier.restarts || 40;
  for (let i = 0; i < tries; i++) {
    const out = candidate(`${seed}#${i}`, tier, stats);
    if (out) {
      if (stats) stats.found = (stats.found || 0) + 1;
      return out;
    }
  }
  if (stats) stats.gaveUp = (stats.gaveUp || 0) + 1;
  return null;
}

// The generation ladder. The *published* bands are measured off the baked pool
// (TIERS_META in js/data/lots.js); these numbers are the search budget and the acceptance gate.
export const TIERS = [
  {
    key: 'shoal', label: '浅滩', w: 4, h: 4,
    islands: [4, 5], k: [0, 0], extra: 0.25, double: 0.25, restarts: 40,
  },
  {
    key: 'sound', label: '内海', w: 5, h: 5,
    islands: [6, 7], k: [1, 1], extra: 0.35, double: 0.3, restarts: 40,
  },
  {
    key: 'archipelago', label: '群岛', w: 6, h: 6,
    islands: [8, 9], k: [2, 2], extra: 0.4, double: 0.35, restarts: 40,
  },
  {
    key: 'ocean', label: '远洋', w: 7, h: 7,
    islands: [10, 12], k: [3, 4], extra: 0.45, double: 0.4, restarts: 60,
  },
];

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}
