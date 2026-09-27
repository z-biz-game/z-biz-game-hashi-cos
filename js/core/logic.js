// The reasoning solver, and with it the game's second measured number: 推理深度 k.
//
// k is defined here, in one sentence, and every number the UI prints about difficulty inherits
// that definition: **the smallest number of nested "let me suppose this bridge is 2" guesses
// that a solver restricted to the rule set below needs in order to finish the puzzle.** It is
// found by iterative deepening, so it is a minimum rather than a trace of one lucky path, and
// it is reproducible because both the rule order and the branching order are fixed.
//
// Anything that changes k: the rule set, the branching heuristic, and whether connectivity is
// used as a deduction. See DESIGN.md §4 — the rule set is listed there verbatim, and a different
// (larger) rule set — e.g. the classic "a group of islands cannot be cut off" rule — would print
// smaller numbers for the same puzzles. k is only comparable inside this repo.
//
// Rules (each has its own test in test/logic.test.mjs, all shared with js/core/count.js so the
// counter and this solver cannot disagree by construction):
//   R-impossible, R-maxed, R-minned, R-satisfied, R-single, R-forced, R-crossing
//
// Notably absent: the "p == 方向数 -> 全 1 根" rule that circulates in Hashi strategy guides. It
// is **unsound** — an island with 4 directions and p=4 can carry 2+2 — and test/logic.test.mjs
// ships the counterexample. Deduction rules that are wrong would make k a lie, so it is dropped.

import { compile, components } from './model.js';
import { propagate, pickSlot, valueOf } from './count.js';

const V0 = 1;
const V1 = 2;
const V2 = 4;
const BITS = [V0, V1, V2];

export const RULES = [
  { key: 'R-impossible', text: '剩余需求超出（或低于）空闲方向能给的根数 -> 矛盾，退回' },
  { key: 'R-maxed', text: 'p == 2 x 可用方向数 -> 全部定 2 根（含度已满时的上界情形）' },
  { key: 'R-minned', text: 'p 恰好等于各空闲方向的下限之和 -> 各方向定在其下限' },
  { key: 'R-satisfied', text: '某岛度已满 -> 其余方向定空' },
  { key: 'R-single', text: 'p == 1 -> 只剩一根可分，任何方向都不能放 2 根' },
  { key: 'R-forced', text: '只剩一个空闲方向 -> 该方向承接全部剩余根数' },
  { key: 'R-crossing', text: '某 slot 至少要一根 -> 与它交叉的 slot 定空' },
];

function domains(comp) {
  const dom = new Uint8Array(comp.nSlots);
  dom.fill(V0 | V1 | V2);
  return dom;
}

function valuesOf(dom) {
  const out = new Uint8Array(dom.length);
  for (let i = 0; i < dom.length; i++) out[i] = valueOf(dom[i]);
  return out;
}

export function reason(spec, opts = {}) {
  const comp = spec.comp || compile(spec);
  const maxDepth = opts.maxDepth === undefined ? 4 : opts.maxDepth;
  const cap = opts.nodes || 60000;
  // What the *whole* iterative-deepening run cost, including the budgets that failed. The
  // success path reports the winning iteration (`nodes`), because that is the number the pool
  // rows carry; the failure path has no winning iteration, and reporting 0 there would hide the
  // one measurement that makes k meaningful: exhausting every smaller budget is what proves the
  // puzzle does not yield to fewer guesses.
  let spent = { nodes: 0, guesses: 0 };

  for (let budget = 0; budget <= maxDepth; budget++) {
    const st = { nodes: 0, guesses: 0, stopped: null, trace: [], want: opts.trace ? [] : null };
    const attempt = (left, dom, trail) => {
      if (st.stopped) return null;
      st.nodes++;
      if (st.nodes > cap) {
        st.stopped = 'nodes';
        return null;
      }
      const local = [];
      const r = propagate(comp, dom, st.want ? { trace: local } : undefined);
      if (st.want) {
        for (const step of local) st.trace.push({ depth: budget - left, rule: step.rule, detail: step.note });
      }
      if (!r.ok) return null;
      if (r.complete) {
        // A complete assignment that splits the islands is not a Hashi solution: the guess tree
        // has to keep going (or back up) until it finds the connected one.
        const sol = valuesOf(dom);
        return components(comp, sol) === 1 ? sol : null;
      }
      if (left === 0) return null;
      const s = pickSlot(comp, dom);
      if (s < 0) return null;
      st.guesses++;
      trail.push({ depth: budget - left + 1, slot: s, domain: dom[s] });
      if (st.want) st.trace.push({ depth: budget - left + 1, rule: 'guess', detail: `假设 slot ${s} 有一根以上，往下看` });
      const m = dom[s];
      for (const v of [1, 2, 0]) {
        if (!(m & BITS[v])) continue;
        const next = Uint8Array.from(dom);
        next[s] = BITS[v];
        const found = attempt(left - 1, next, trail);
        if (found) return found;
      }
      trail.pop();
      return null;
    };
    const solution = attempt(budget, domains(comp), []);
    spent.nodes += st.nodes;
    spent.guesses += st.guesses;
    if (st.stopped) {
      return { ok: false, depth: -1, guesses: spent.guesses, nodes: spent.nodes, stopped: st.stopped, solution: null };
    }
    if (solution) {
      return {
        ok: true,
        depth: budget,
        k: budget,
        guesses: st.guesses,
        nodes: st.nodes,
        solution,
        steps: st.trace.length,
        trace: st.want ? st.trace : null,
        stopped: null,
      };
    }
  }
  return {
    ok: false,
    depth: -1,
    guesses: 0,
    nodes: 0,
    stopped: 'depth',
    solution: null,
    message: `needs more than ${maxDepth} guess layers`,
  };
}

// Does this puzzle yield to pure deduction? Used by the generator to place lots in the k=0 band
// and by test/logic.test.mjs to pin "推理与穷举同解".
export function deductive(spec) {
  const r = reason(spec, {});
  return !!(r.ok && r.depth === 0);
}
