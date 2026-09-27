// Exhaustive solution counter. This is the engine behind the two claims the game prints as
// facts rather than opinions: "解数 = 1 (已证明)" and, through it, the difficulty band.
//
// Search: pick an undecided slot, try every value it can still take, recurse. Pruning is a
// constraint-propagation closure over per-slot *domains* (which of {0,1,2} are still possible):
//
//   R-impossible  need > max(free) or need < min(free)   -> this branch is dead
//   R-maxed       need == max(free)                      -> every free slot takes its maximum
//                 (the classic "p == 2 x directions -> all doubles" is the all-open case)
//   R-minned      need == min(free)                      -> every free slot takes its floor
//   R-satisfied   need == 0                              -> every free slot goes empty
//   R-single      need == 1                              -> no free slot can hold 2
//   R-forced      exactly one free slot left             -> it holds all `need` roots
//   R-crossing    a slot that must carry >= 1 root       -> every crossing slot is empty
//
// Every rule there is sound, and they are shared with js/core/logic.js on purpose: the
// "solution count" and the "reasoning depth" can then only disagree if one of them has a bug,
// never because they see different worlds.
//
// A Hashi solution is *connected* by definition, so a leaf is only counted when all islands form
// one component. `opts.connected === false` switches that off and exists solely for the
// counter-proof in test/count.test.mjs, which shows a puzzle that looks non-unique until
// connectivity is applied — the clearest available evidence the check is not decorative.
//
// `countSolutions(spec, limit)` returns as soon as `limit` solutions are on the books: proving
// "not unique" must not enumerate the whole solution space.

import { compile, degreesOf, components, rootsOf } from './model.js';

const V0 = 1; // bit meaning "0 roots still allowed"
const V1 = 2;
const V2 = 4;
const FULL = V0 | V1 | V2;
const BITS = [V0, V1, V2];
const NO_DOUBLE = V0 | V1;

function popcount(m) {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
}

function lowOf(m) {
  if (m & V0) return 0;
  if (m & V1) return 1;
  return 2;
}

function highOf(m) {
  if (m & V2) return 2;
  if (m & V1) return 1;
  return 0;
}

export function valueOf(m) {
  if (m & V2) return 2;
  if (m & V1) return 1;
  return 0;
}

// Apply the closure to `dom` in place. `opts.trace` collects each rule application, which is
// what js/core/logic.js reports as the reasoning steps and what the hint line quotes.
// Returns { ok, complete, forced } or { ok: false, reason }.
export function propagate(comp, dom, opts = {}) {
  const { inc, slots, p } = comp;
  const trace = opts.trace || null;
  let forced = 0;
  const note = (step) => {
    if (trace) trace.push(step);
  };
  for (;;) {
    let changed = false;
    for (let i = 0; i < comp.n; i++) {
      const want = p[i];
      if (want < 0) continue; // wildcard: this island states nothing
      let fixed = 0;
      let max = 0;
      let min = 0;
      let free = null;
      for (const s of inc[i]) {
        const m = dom[s];
        if (!m) return { ok: false, reason: `island ${i}: slot ${s} has an empty domain`, forced };
        if (popcount(m) === 1) fixed += valueOf(m);
        else {
          if (!free) free = [];
          free.push(s);
          min += lowOf(m);
          max += highOf(m);
        }
      }
      const need = want - fixed;
      if (need > max || need < min) {
        return { ok: false, reason: `island ${i}: still needs ${need}, free directions can only do ${min}..${max}`, forced };
      }
      if (!free) continue;
      if (need === 0) {
        for (const s of free) {
          if (dom[s] !== V0) {
            dom[s] = V0;
            changed = true;
            forced++;
          }
        }
        note({ rule: 'R-satisfied', island: i, note: `p=${want} 已满足，${free.length} 个方向定为空` });
        continue;
      }
      if (need === max) {
        for (const s of free) {
          const next = BITS[highOf(dom[s])];
          if (dom[s] !== next) {
            dom[s] = next;
            changed = true;
            forced++;
          }
        }
        note({ rule: 'R-maxed', island: i, note: `p=${want} 要用尽 ${free.length} 个方向的最大值` });
        continue;
      }
      if (need === min) {
        for (const s of free) {
          const next = BITS[lowOf(dom[s])];
          if (dom[s] !== next) {
            dom[s] = next;
            changed = true;
            forced++;
          }
        }
        note({ rule: 'R-minned', island: i, note: `p=${want} 只够每个空闲方向各取其下限` });
        continue;
      }
      if (free.length === 1) {
        const s = free[0];
        const next = BITS[need];
        if (!(dom[s] & next)) {
          return { ok: false, reason: `island ${i}: last direction ${s} cannot hold ${need} roots`, forced };
        }
        if (dom[s] !== next) {
          dom[s] = next;
          changed = true;
          forced++;
        }
        note({ rule: 'R-forced', island: i, note: `p=${want} 只剩方向 ${s}，${need} 根全押上去` });
        continue;
      }
      if (need === 1) {
        for (const s of free) {
          const next = dom[s] & NO_DOUBLE;
          if (dom[s] !== next) {
            dom[s] = next;
            changed = true;
            forced++;
          }
        }
        note({ rule: 'R-single', island: i, note: `p=${want}：只剩一根可分，任何方向都不能放 2 根` });
      }
    }
    // Crossing: any slot that cannot be empty forbids every slot that crosses it.
    for (const s of slots) {
      if (!dom[s.i] || lowOf(dom[s.i]) === 0) continue;
      for (const o of s.crosses) {
        if (dom[o] !== V0) {
          dom[o] = V0;
          changed = true;
          forced++;
          note({ rule: 'R-crossing', slot: s.i, note: `slot ${s.i} 至少要一根，交叉的 slot ${o} 定空` });
        }
      }
    }
    if (!changed) break;
  }
  let complete = true;
  for (let s = 0; s < comp.nSlots; s++) {
    if (!dom[s]) return { ok: false, reason: `slot ${s} emptied`, forced };
    if (popcount(dom[s]) > 1) complete = false;
  }
  return { ok: true, complete, forced };
}

function initialDomains(comp) {
  const dom = new Uint8Array(comp.nSlots);
  dom.fill(FULL);
  return dom;
}

function valuesOf(dom) {
  const out = new Uint8Array(dom.length);
  for (let i = 0; i < dom.length; i++) out[i] = valueOf(dom[i]);
  return out;
}

// The branching slot: the one whose island is nearest to being impossible. Deterministic, so
// `nodes` is a reproducible measurement rather than an artefact of iteration order.
// A slot between two *wildcards* carries no numeric constraint at all, so its score stays
// Infinity: such slots are branched last, but they still have to be branched. The `best < 0`
// arm and the lowest-index tie-break make the choice total (any non-complete domain vector
// yields a slot) and order-independent; without it a wildcard-vs-wildcard slot was never picked
// and the search quietly reported 0 solutions for a puzzle that had some.
export function pickSlot(comp, dom) {
  let best = -1;
  let bestScore = Infinity;
  for (const s of comp.slots) {
    if (popcount(dom[s.i]) <= 1) continue;
    let score = Infinity;
    for (const i of [s.a, s.b]) {
      if (comp.p[i] < 0) continue;
      let fixed = 0;
      let max = 0;
      for (const t of comp.inc[i]) {
        const m = dom[t];
        if (popcount(m) === 1) fixed += valueOf(m);
        else max += highOf(m);
      }
      const slack = max - (comp.p[i] - fixed);
      if (slack < score) score = slack;
    }
    if (best < 0 || score < bestScore || (score === bestScore && s.i < best)) {
      bestScore = score;
      best = s.i;
    }
  }
  return best;
}

export function countSolutions(spec, limit = 2, opts = {}) {
  const comp = spec.comp || compile(spec);
  const maxNodes = opts.nodes || 300000;
  const deadline = opts.deadline || 0;
  const wantConnected = opts.connected !== false;
  const solutions = [];
  let count = 0;
  let nodes = 0;
  let stopped = null;

  const walk = (dom) => {
    if (stopped) return;
    nodes++;
    if (nodes > maxNodes) {
      stopped = 'nodes';
      return;
    }
    // A wall-clock guard next to the node cap: the generator must be able to reject an
    // over-budget candidate rather than stall a bake, and a *rejected* candidate is never shipped.
    if (deadline && (nodes & 8191) === 0 && Date.now() > deadline) {
      stopped = 'time';
      return;
    }
    const r = propagate(comp, dom);
    if (!r.ok) return;
    if (r.complete) {
      const bridges = valuesOf(dom);
      if (!wantConnected || components(comp, bridges) === 1) {
        count++;
        if (count < limit || opts.collect) {
          solutions.push(opts.raw ? Array.from(bridges) : bridges);
        }
        if (count >= limit) {
          stopped = 'limit';
          return;
        }
      }
      return;
    }
    const s = pickSlot(comp, dom);
    if (s < 0) {
      // `!complete` means some domain is still multi, and pickSlot is total over exactly that,
      // so this is unreachable. If it ever is reached the alternative is a silently wrong count.
      throw new Error('count: propagation left a multi domain with no slot to branch');
    }
    const m = dom[s];
    for (const v of [1, 2, 0]) {
      if (!(m & BITS[v])) continue;
      const next = Uint8Array.from(dom);
      next[s] = BITS[v];
      walk(next);
      if (stopped) return;
    }
  };

  walk(initialDomains(comp));
  return {
    count,
    solutions,
    nodes,
    truncated: stopped === 'nodes' || stopped === 'time',
    stopped,
    // "Proven unique" is a property of a finished search, not of a small count: a truncated
    // search knows nothing.
    unique: stopped === null && count === 1,
  };
}

// The single placement, proven unique, plus the numbers the pool row has to carry.
export function theSolution(spec, opts = {}) {
  const comp = spec.comp || compile(spec);
  const r = countSolutions(spec, 2, opts);
  if (!r.unique) return null;
  const bridges = r.solutions[0];
  return {
    bridges,
    roots: rootsOf(bridges),
    degrees: Array.from(degreesOf(comp, bridges)),
    nodes: r.nodes,
  };
}
