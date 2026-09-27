// Hand-built fixtures. These are the few specs in this repo whose answers a human wrote down, so
// a failing test cannot be blamed on the engine having moved the goalposts: every expected number
// in here is derived on paper in the comments below, and test/count.test.mjs checks the paper
// against `naiveCounts`, which shares no search code with js/core/count.js.
//
// `compile` is imported for the slot list only — and the slot list itself is pinned by the
// hand-written `expect.slots` below, so reusing it does not make the cross-check circular.
import { compile } from '../js/core/model.js';

// SQUARE (fixtures A and X) — four islands at the four corners of a 3x3 field:
//
//     P . P          sorted: 0=(0,0) 1=(0,2) 2=(2,0) 3=(2,2)
//     . . .          slots:  i0 = 0-1 (row 0)  i1 = 2-3 (row 2)
//     P . P                 i2 = 0-2 (col 0)  i3 = 1-3 (col 2)
//
// Each island has exactly two directions, and no slot crosses another (the only horizontal and the
// only vertical in a row/column here always share an endpoint, and endpoints are not crossings), so
// the four slot values are the whole world:
//   island 0 = i0 + i2, island 1 = i0 + i3, island 2 = i1 + i2, island 3 = i1 + i3.
//
// With p = [2,2,2,2] (fixture A) the four equations leave one free parameter: i0 = t, i1 = t,
// i2 = 2-t, i3 = 2-t for t in {0,1,2}. t=1 is the ring [1,1,1,1]; t=0 gives [0,0,2,2] and t=2 gives
// [2,2,0,0], each of which is two separate double bridges. So:
//   * with connectivity: exactly ONE solution, [1,1,1,1];
//   * without connectivity: THREE — the same three assignments the naive enumerator finds;
//   * [2,2,0,0] meets every number and spends exactly Σp/2 = 4 roots, and is not a solution. That
//     vector is why `connected` exists in js/core/model.js at all.
export const SQUARE_A = {
  w: 3,
  h: 3,
  islands: [
    { r: 0, c: 0, p: 2 },
    { r: 0, c: 2, p: 2 },
    { r: 2, c: 0, p: 2 },
    { r: 2, c: 2, p: 2 },
  ],
  expect: {
    slots: ['0-1', '2-3', '0-2', '1-3'],
    sumP: 8,
    target: 4,
    solution: [1, 1, 1, 1],
    split: [2, 2, 0, 0],
    withConnectivity: 1,
    withoutConnectivity: 3,
  },
};

// The same field with p = [3,1,4,2] (fixture X). Hand-derived:
//   island 2 wants 4 out of its two directions -> i1 = i2 = 2 (each at its ceiling);
//   island 0 wants 3 and already has i2 = 2 -> i0 = 1;
//   island 1 wants 1 and already has i0 = 1 -> i3 = 0;
//   island 3 then has i1 + i3 = 2 + 0 = 2, exactly its number -> consistent, and nothing was free,
//   so uniqueness holds by hand: [1,2,2,0], roots 5 = Σp/2 = (3+1+4+2)/2.
// Now look at island 3: p = 2 with two directions, i.e. p == 方向数, and its bridge to island 2
// carries TWO roots. The rule that circulates in Hashi strategy guides — "p equals the number of
// directions means every one of them is a single" — is therefore unsound, and neither
// js/core/count.js nor js/core/logic.js contains it. (It is only valid when the island's other
// directions cannot absorb the difference, which is what R-maxed/R-minned encode properly.)
export const SQUARE_X = {
  w: 3,
  h: 3,
  islands: [
    { r: 0, c: 0, p: 3 },
    { r: 0, c: 2, p: 1 },
    { r: 2, c: 0, p: 4 },
    { r: 2, c: 2, p: 2 },
  ],
  expect: {
    slots: ['0-1', '2-3', '0-2', '1-3'],
    sumP: 10,
    target: 5,
    solution: [1, 2, 2, 0],
    equalDirsIsland: 3,
    equalDirsHasDouble: true,
  },
};

// COMB (fixture B) — five islands, one of which carries a clue that is load-bearing for uniqueness:
//
//     0 1 2            sorted: 0=(0,0) 1=(0,1) 2=(0,2) 3=(1,0) 4=(1,2)
//     3 . 4            slots:  i0 = 0-1  i1 = 3-4  i2 = 1-2  i3 = 0-3  i4 = 2-4
//
// Again no crossings. With p = [3,3,2,2,2] the five equations are
//   i0+i3=3, i0+i2=3, i2+i4=2, i1+i3=2, i1+i4=2
// -> from the last two i3 = i4; write i1 = a, then i3 = i4 = 2-a, i0 = 3-i3 = 1+a, i2 = 3-i0 = 2-a,
//   and the third equation says (2-a)+(2-a) = 2, so a = 1 and everything is forced:
//   [2,1,1,1,1], roots 6 = Σp/2 = 12/2.
// Erase island 2's clue and the third equation disappears, leaving a free a in {0,1,2}:
//   a=0 -> [1,0,2,2,2]: slots 0-1, 1-2, 0-3, 2-4 are all positive, so the five islands are one
//                        component, every *remaining* number is met, 7 roots
//   a=1 -> [2,1,1,1,1]: the original
//   a=2 -> i0 = 3, impossible on one slot
// so the clue-free-but-legal variant has exactly TWO connected solutions. This is the counter-proof
// the brief asks for: with every number printed 解数 == 1; delete one number and the same sea
// admits a second bridge layout. (SQUARE_A cannot show this: erasing a clue there does make two of
// its three degree-exact assignments, but connectivity kills both.)
export const COMB_B = {
  w: 3,
  h: 2,
  islands: [
    { r: 0, c: 0, p: 3 },
    { r: 0, c: 1, p: 3 },
    { r: 0, c: 2, p: 2 },
    { r: 1, c: 0, p: 2 },
    { r: 1, c: 2, p: 2 },
  ],
  expect: {
    slots: ['0-1', '3-4', '1-2', '0-3', '2-4'],
    sumP: 12,
    target: 6,
    solution: [2, 1, 1, 1, 1],
    eraseIsland: 2,
    erasedSolutions: [[1, 0, 2, 2, 2], [2, 1, 1, 1, 1]],
  },
};

// TIPS (fixture C) — four islands at the ends of a plus, in a 4x4 field:
//
//     . P . .          sorted: 0=(0,1) 1=(1,0) 2=(1,3) 3=(3,1)
//     P . . P          slots:  i0 = 1-2 (row 1)  i1 = 0-3 (col 1), and they CROSS at (1,1)
//     . . . .
//     . P . .
//
// The spec is perfectly legal: one direction each, p = 1 <= 2, Σp = 4 even. But satisfying the
// numbers means placing a bridge on both slots, and the two cross — so there are ZERO solutions.
// Kept around because an engine that never answers "no solution exists" is not validating anything.
export const TIPS_C = {
  w: 4,
  h: 4,
  islands: [
    { r: 0, c: 1, p: 1 },
    { r: 1, c: 0, p: 1 },
    { r: 1, c: 3, p: 1 },
    { r: 3, c: 1, p: 1 },
  ],
  expect: {
    slots: ['1-2', '0-3'],
    sumP: 4,
    target: 2,
    solutions: 0,
    crossing: [0, 1],
  },
};

// WILD_PAIR — the smallest spec with *two* wildcards, i.e. a bridge slot that neither endpoint
// constrains at all:
//
//     P P            sorted: 0=(0,0) 1=(0,1);  one slot i0 = 0-1, no crossings.
//
// With both clues erased nothing states a number, so the slot may take 0, 1 or 2 roots:
//   * ignoring connectivity: 3 placements;
//   * with connectivity: 2 — [0] leaves the two islands in separate components.
// Hand-derived in one line, and it is a regression test: `pickSlot` used to rank a slot by how
// tight its *numbered* endpoint was, so a slot with two unnumbered endpoints scored Infinity,
// was never picked, and the search returned 0 solutions for a puzzle with two.
export const WILD_PAIR = {
  w: 2,
  h: 1,
  islands: [
    { r: 0, c: 0, p: null },
    { r: 0, c: 1, p: null },
  ],
  expect: {
    slots: ['0-1'],
    sumP: 0,
    withConnectivity: 2,
    withoutConnectivity: 3,
  },
};

// THE SQUARE FAMILY, THREE MORE MEMBERS — same four corner islands (0=(0,0) 1=(0,2) 2=(2,0)
// 3=(2,2)), same four slots (i0 = 0-1, i1 = 2-3, i2 = 0-2, i3 = 1-3), only the numbers change.
// Subtracting the equations two at a time is the whole hand derivation, and it gives an exact
// solution *count* rather than just an answer, which is what 解数 has to be tested against:
//
//   island 0 = i0 + i2, island 1 = i0 + i3, island 2 = i1 + i2, island 3 = i1 + i3
//
//   p = [4,4,4,4] (SQUARE_F): eq0 says i0 = i2 = 2 (each direction is at its ceiling of 2), and
//     then everything else follows: exactly ONE placement, [2,2,2,2], connected. This is the pure
//     R-maxed case, k = 0.
//   p = [3,3,3,3] (SQUARE_T): eq0 - eq1 gives i2 = i3, eq2 - eq3 gives i1 = i0, and eq2 then says
//     i1 = 3 - i2, so the board is one free parameter t: i0 = i1 = t, i2 = i3 = 3 - t. Values are
//     capped at 2 per slot, so t is 1 or 2 and there are EXACTLY TWO placements, [1,1,2,2] and
//     [2,2,1,1]. Both have four positive slots, so both are connected: 解数 = 2 either way. This
//     is the hand-written ambiguous board the counter has to refuse to ship.
//   p = [2,3,3,2] (SQUARE_Z): eq1 - eq0 gives i3 - i2 = 1 while eq2 - eq3 gives i2 - i3 = 1. Both
//     cannot hold, so there are ZERO placements — and the spec is completely legal (every p <= 4,
//     sum(p) = 10 even). Fixture C is unsolvable because two bridges would have to cross; this one
//     is unsolvable because the numbers themselves are inconsistent. Two different ways for a
//     counter to answer "no", and the engine has to be able to say both.
export const SQUARE_F = {
  w: 3,
  h: 3,
  islands: [
    { r: 0, c: 0, p: 4 },
    { r: 0, c: 2, p: 4 },
    { r: 2, c: 0, p: 4 },
    { r: 2, c: 2, p: 4 },
  ],
  expect: {
    slots: ['0-1', '2-3', '0-2', '1-3'],
    sumP: 16,
    target: 8,
    solutions: 1,
    vector: [2, 2, 2, 2],
    withConnectivity: 1,
    withoutConnectivity: 1,
  },
};

export const SQUARE_T = {
  w: 3,
  h: 3,
  islands: [
    { r: 0, c: 0, p: 3 },
    { r: 0, c: 2, p: 3 },
    { r: 2, c: 0, p: 3 },
    { r: 2, c: 2, p: 3 },
  ],
  expect: {
    slots: ['0-1', '2-3', '0-2', '1-3'],
    sumP: 12,
    target: 6,
    solutions: 2,
    vectors: [[1, 1, 2, 2], [2, 2, 1, 1]],
    withConnectivity: 2,
    withoutConnectivity: 2,
  },
};

export const SQUARE_Z = {
  w: 3,
  h: 3,
  islands: [
    { r: 0, c: 0, p: 2 },
    { r: 0, c: 2, p: 3 },
    { r: 2, c: 0, p: 3 },
    { r: 2, c: 2, p: 2 },
  ],
  expect: {
    slots: ['0-1', '2-3', '0-2', '1-3'],
    sumP: 10,
    target: 5,
    solutions: 0,
    withConnectivity: 0,
    withoutConnectivity: 0,
  },
};

// Illegal specs, kept next to the fixtures they are variations of.
export const OVER_BOUND = {
  w: 3,
  h: 3,
  islands: [
    { r: 0, c: 0, p: 5 }, // two directions -> ceiling 4
    { r: 0, c: 2, p: 3 },
    { r: 2, c: 0, p: 2 },
    { r: 2, c: 2, p: 2 },
  ],
};

export const ODD_SUM = {
  w: 3,
  h: 3,
  islands: [
    { r: 0, c: 0, p: 3 },
    { r: 0, c: 2, p: 2 },
    { r: 2, c: 0, p: 2 },
    { r: 2, c: 2, p: 2 },
  ],
};

export const THREE_IN_A_ROW = {
  w: 3,
  h: 1,
  islands: [
    { r: 0, c: 0, p: 1 },
    { r: 0, c: 1, p: 2 },
    { r: 0, c: 2, p: 1 },
  ],
};

function ceiling(comp, i) {
  // A wildcard (p < 0 after `withoutClue`) states nothing.
  return comp.p[i] >= 0 ? comp.p[i] : Infinity;
}

function parts(comp, vals) {
  const parent = Array.from({ length: comp.n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const s of comp.slots) {
    if (!vals[s.i]) continue;
    const ra = find(s.a);
    const rb = find(s.b);
    if (ra !== rb) parent[ra] = rb;
  }
  return new Set(Array.from({ length: comp.n }, (_, i) => find(i))).size;
}

// An independent brute-force counter: walk the slots one at a time, keep a running hand-written
// degree table, and read the rules at the leaves. No domains, no propagation closure, no shared
// search code with js/core/count.js — the two agree because the model is right, not because they
// are the same program.
export function naiveCounts(spec, opts = {}) {
  const comp = compile(spec);
  const wantConnected = opts.connected !== false;
  const cap = opts.leaves || 20 * 1000 * 1000;
  const m = comp.nSlots;
  const vals = new Array(m).fill(0);
  const deg = new Array(comp.n).fill(0);
  let count = 0;
  let leaves = 0;
  const solutions = [];
  const legal = () => {
    leaves++;
    for (let i = 0; i < comp.n; i++) if (comp.p[i] >= 0 && deg[i] !== comp.p[i]) return false;
    for (const s of comp.slots) {
      if (!vals[s.i]) continue;
      for (const o of s.crosses) if (o > s.i && vals[o]) return false;
    }
    if (wantConnected && parts(comp, vals) !== 1) return false;
    return true;
  };
  const walk = (k) => {
    if (leaves > cap) throw new Error(`naive enumerator passed ${cap} leaves; this spec is too big for it`);
    if (k === m) {
      if (legal()) {
        count++;
        if (solutions.length < 8) solutions.push(vals.slice());
      }
      return;
    }
    const s = comp.slots[k];
    for (const v of [0, 1, 2]) {
      if (deg[s.a] + v > ceiling(comp, s.a) || deg[s.b] + v > ceiling(comp, s.b)) continue;
      if (v) {
        let crossed = false;
        for (const o of s.crosses) if (vals[o]) crossed = true;
        if (crossed) continue;
      }
      vals[k] = v;
      deg[s.a] += v;
      deg[s.b] += v;
      walk(k + 1);
      deg[s.a] -= v;
      deg[s.b] -= v;
      vals[k] = 0;
    }
  };
  walk(0);
  return { count, solutions, leaves };
}
