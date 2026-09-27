// The Hashi model: islands, the bridge slots they admit, and a validator that is written
// to be read as a list of rules rather than as a fast incremental engine.
//
//   spec    = { w, h, islands: [{ r, c, p }] }
//   bridges = Uint8Array(nSlots)  // 0 | 1 | 2 roots per slot, indexed by comp.slots
//             | [{ a, b, n }]     // sparse edge form; lets a *test* express an illegal
//                                 // bridge that the array form cannot even represent
//
// Two islands are joinable when they share a row or a column **and no third island sits
// between them on that line** — so the slot list is exactly "consecutive pairs per row and
// per column", which makes the third-island rule structural instead of checked.
//
// Four constraints, and js/core/count.js is not allowed to be the thing that verifies them
// (see validate below):
//   1. every island's degree equals its number
//   2. bridges do not cross, and one pair of islands carries at most 2 roots
//   3. all islands are mutually connected by positive bridges
//   4. p <= 2 x (number of directions the island actually has) — the structural bound
// plus the free external theorem that comes with 1: sum(p) is even and the total number of
// bridge *roots* is exactly sum(p)/2 (handshake). Constraints 1+2+4 are local; 3 is global,
// and it is the one every hashi implementation forgets, so it has its own predicate
// (`connected`) and its own dedicated negative test.

// Slot kinds.
export const HOR = 0;
export const VER = 1;

export function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function cellKey(r, c) {
  return `${r},${c}`;
}

// Islands sorted by (r, c): the slot list, the degree order and every index a test hard-codes
// all key off this order, so a spec written by hand and one written by the generator meet the
// same normalisation. Returns a new array; the input spec is never touched (see purity test).
function ordered(spec) {
  return spec.islands.map((isl, i) => ({ r: isl.r, c: isl.c, p: isl.p, src: i }));
}

// Build the compiled form. Assumes `checkBasics` already passed (unique cells inside the grid),
// which is what `compileSafe` guarantees for callers that want to look at errors instead of
// catching throws.
export function compile(spec) {
  if (!spec || !Number.isInteger(spec.w) || !Number.isInteger(spec.h) || !Array.isArray(spec.islands)) {
    throw new Error('spec must be { w, h, islands: [] } with integer w/h');
  }
  const list = ordered(spec).sort((x, y) => x.r - y.r || x.c - y.c);
  const n = list.length;
  const at = new Map();
  list.forEach((isl, i) => {
    const k = cellKey(isl.r, isl.c);
    if (at.has(k)) throw new Error(`two islands on ${k}`);
    at.set(k, i);
  });

  const slots = [];
  // Consecutive islands per row, then per column: "no third island in between" for free.
  const byRow = new Map();
  const byCol = new Map();
  list.forEach((isl, i) => {
    if (!byRow.has(isl.r)) byRow.set(isl.r, []);
    if (!byCol.has(isl.c)) byCol.set(isl.c, []);
    byRow.get(isl.r).push(i);
    byCol.get(isl.c).push(i);
  });
  for (const arr of byRow.values()) {
    arr.sort((x, y) => list[x].c - list[y].c);
    for (let k = 0; k + 1 < arr.length; k++) {
      const a = arr[k];
      const b = arr[k + 1];
      slots.push({
        a, b, kind: HOR,
        r: list[a].r, c1: list[a].c, c2: list[b].c,
        x1: list[a].c, y1: list[a].r, x2: list[b].c, y2: list[a].r,
        crosses: [],
      });
    }
  }
  for (const arr of byCol.values()) {
    arr.sort((x, y) => list[x].r - list[y].r);
    for (let k = 0; k + 1 < arr.length; k++) {
      const a = arr[k];
      const b = arr[k + 1];
      slots.push({
        a, b, kind: VER,
        c: list[a].c, r1: list[a].r, r2: list[b].r,
        x1: list[a].c, y1: list[a].r, x2: list[a].c, y2: list[b].r,
        crosses: [],
      });
    }
  }
  slots.sort((s, t) => s.kind - t.kind || s.x1 - t.x1 || s.y1 - t.y1 || s.x2 - t.x2 || s.y2 - t.y2);

  const slotOf = new Map();
  slots.forEach((s, i) => {
    s.i = i;
    slotOf.set(pairKey(s.a, s.b), i);
  });

  // Crossing: a horizontal and a vertical slot whose interiors meet at a cell that belongs to
  // neither island endpoint. Strict inequality on both axes is the whole rule — sharing an
  // island (an endpoint) is not a crossing, and collinear overlap cannot happen because slots
  // are consecutive pairs.
  for (const h of slots) {
    if (h.kind !== HOR) continue;
    for (const v of slots) {
      if (v.kind !== VER) continue;
      if (h.x1 < v.x1 && v.x1 < h.x2 && v.y1 < h.y1 && h.y1 < v.y2) {
        h.crosses.push(v.i);
        v.crosses.push(h.i);
      }
    }
  }

  const inc = list.map(() => []);
  for (const s of slots) {
    inc[s.a].push(s.i);
    inc[s.b].push(s.i);
  }

  const comp = {
    w: spec.w,
    h: spec.h,
    n,
    islands: list.map((x) => ({ r: x.r, c: x.c, p: x.p, src: x.src })),
    p: Int16Array.from(list.map((x) => (x.p === null || x.p === undefined ? -1 : x.p))),
    at,
    slots,
    nSlots: slots.length,
    slotOf,
    inc,
    dirs: Int8Array.from(inc.map((x) => x.length)),
    // Wildcard = a deliberate clue removal (the uniqueness counter-proof). Never in shipped data.
    wildcard: list.some((x) => x.p === null || x.p === undefined),
  };
  return comp;
}

// A compile that reports instead of throwing, for the validator and the UI.
export function compileSafe(spec) {
  try {
    return { comp: compile(spec), errors: [] };
  } catch (err) {
    return { comp: null, errors: [String(err && err.message)] };
  }
}

export function blankBridges(comp) {
  return new Uint8Array(comp.nSlots);
}

// Accept either representation and return a dense Uint8Array plus the list of problems found
// while reading it. Keeping the two forms in one place is what lets a test write
// "a bridge that jumps over a third island" at all — the dense form cannot name such a thing.
export function toBridges(comp, bridges) {
  const out = new Uint8Array(comp.nSlots);
  const errors = [];
  if (bridges === null || bridges === undefined) {
    return { bridges: out, errors: [`shape: no bridge state given`] };
  }
  const rows = Array.isArray(bridges) || ArrayBuffer.isView(bridges) ? bridges : null;
  if (rows !== null && rows.length && typeof rows[0] === 'object' && rows[0] !== null) {
    const seen = new Map();
    for (const e of rows) {
      const n = e && e.n;
      if (!e || !Number.isInteger(e.a) || !Number.isInteger(e.b) || !Number.isInteger(n) || n < 1 || n > 2) {
        errors.push(`value: edge ${JSON.stringify(e)}`);
        continue;
      }
      const idx = comp.slotOf.get(pairKey(e.a, e.b));
      if (idx === undefined) {
        errors.push(`illegal: islands ${pairKey(e.a, e.b)} have no slot (not aligned, or an island between)`);
        continue;
      }
      const next = (seen.get(idx) || 0) + n;
      if (next > 2) errors.push(`over2: pair ${pairKey(e.a, e.b)} asked for ${next} roots`);
      seen.set(idx, Math.min(next, 2));
    }
    for (const [idx, v] of seen) out[idx] = v;
    return { bridges: out, errors };
  }
  if (rows === null) {
    return { bridges: out, errors: ['shape: bridges must be an array of counts or of {a,b,n} edges'] };
  }
  if (rows.length !== comp.nSlots) {
    errors.push(`shape: ${rows.length} counts for ${comp.nSlots} slots`);
  }
  for (let i = 0; i < Math.min(rows.length, comp.nSlots); i++) {
    const v = rows[i];
    if (v !== 0 && v !== 1 && v !== 2) {
      errors.push(`value: slot ${i} holds ${JSON.stringify(v)}, must be 0|1|2`);
      continue;
    }
    out[i] = v;
  }
  return { bridges: out, errors };
}

export function degreesOf(comp, bridges) {
  const deg = new Int16Array(comp.n);
  for (const s of comp.slots) {
    const v = bridges[s.i];
    if (!v) continue;
    deg[s.a] += v;
    deg[s.b] += v;
  }
  return deg;
}

export function rootsOf(bridges) {
  let sum = 0;
  for (let i = 0; i < bridges.length; i++) sum += bridges[i];
  return sum;
}

// Union-find over positive bridges. Connectivity is judged on the *island graph*: every island
// must be in one component. An island with degree 0 can never be, so a partially built board is
// simply "not connected yet" rather than an error — which is exactly what the UI needs.
export function components(comp, bridges) {
  const parent = Int16Array.from({ length: comp.n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const s of comp.slots) {
    if (!bridges[s.i]) continue;
    const ra = find(s.a);
    const rb = find(s.b);
    if (ra !== rb) parent[ra] = rb;
  }
  const roots = new Set();
  for (let i = 0; i < comp.n; i++) roots.add(find(i));
  return roots.size;
}

export function connected(comp, bridges) {
  return components(comp, bridges) === 1;
}

export function sumP(comp) {
  let sum = 0;
  for (let i = 0; i < comp.n; i++) if (comp.p[i] >= 0) sum += comp.p[i];
  return sum;
}

// The external theorem the whole UI is checked against: sum(p) is even, and the number of
// bridge *roots* is exactly sum(p)/2. This is an identity, not an estimate — if the two halves
// ever disagree, something in the engine is computing the wrong thing.
export function handshake(comp) {
  const total = sumP(comp);
  return {
    sumP: total,
    even: total % 2 === 0,
    target: total / 2,
    wildcard: comp.wildcard,
  };
}

// Structural bound: p <= 2 x directions. Corners have 2 directions (so p <= 4), edge islands 3
// (p <= 6), interior 4 (p <= 8). A puzzle that violates it is rejected here, before any search.
export function boundOf(comp, i) {
  return 2 * comp.dirs[i];
}

// Spec-level checks, independent of any bridge placement.
export function checkSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['shape: no spec'] };
  const { w, h, islands } = spec;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) errors.push('shape: w/h must be positive integers');
  if (!Array.isArray(islands)) errors.push('shape: islands must be an array');
  if (errors.length) return { ok: false, errors };
  if (islands.length < 2) errors.push('shape: a puzzle needs at least two islands');
  for (const isl of islands) {
    if (!Number.isInteger(isl.r) || !Number.isInteger(isl.c)) {
      errors.push('shape: island coordinates must be integers');
      break;
    }
    if (isl.r < 0 || isl.r >= h || isl.c < 0 || isl.c >= w) {
      errors.push('bounds: island ' + cellKey(isl.r, isl.c) + ' outside the grid');
      break;
    }
  }
  const seen = new Set();
  for (const isl of islands) {
    const k = cellKey(isl.r, isl.c);
    if (seen.has(k)) {
      errors.push(`duplicate: two islands on ${k}`);
      break;
    }
    seen.add(k);
  }
  if (errors.length) return { ok: false, errors };

  const { comp, errors: ce } = compileSafe(spec);
  if (!comp) return { ok: false, errors: ce };
  for (let i = 0; i < comp.n; i++) {
    const p = comp.p[i];
    if (p === -1) continue; // wildcard: deliberately unconstrained, only legal in a proof
    if (p <= 0) {
      errors.push(`degree: island ${i} at ${cellKey(comp.islands[i].r, comp.islands[i].c)} has p=${p}, must be > 0`);
    } else if (p > boundOf(comp, i)) {
      errors.push(`bound: island ${i} asks p=${p} but only has ${comp.dirs[i]} directions (max ${boundOf(comp, i)})`);
    }
  }
  const hs = handshake(comp);
  if (!hs.wildcard && !hs.even) errors.push(`parity: sum(p)=${hs.sumP} is odd, no bridge placement can satisfy it`);
  return { ok: errors.length === 0, errors };
}

// The full validator: rules 1-4 plus the spec-level ones. Deliberately re-derives degrees,
// crossings and components from the raw bridge state instead of trusting anything the solver
// accumulated, so a solver bug cannot hide behind a passing validate.
export function checkBridges(spec, bridges) {
  const spec_ = checkSpec(spec);
  if (!spec_.ok) return { ok: false, errors: spec_.errors, degrees: null, roots: 0, components: 0 };
  const comp = compile(spec);
  const read = toBridges(comp, bridges);
  const errors = read.errors.slice();
  const deg = degreesOf(comp, read.bridges);
  for (let i = 0; i < comp.n; i++) {
    const p = comp.p[i];
    if (p >= 0 && deg[i] !== p) {
      errors.push(`degree: island ${i} has ${deg[i]} roots, number says ${p}`);
    }
  }
  for (const s of comp.slots) {
    if (!read.bridges[s.i]) continue;
    for (const o of s.crosses) {
      // Each pair once: the crossing list is symmetric, and a duplicated message makes the
      // error panel lie about how many conflicts there are.
      if (o > s.i && read.bridges[o]) errors.push(`crossing: slot ${s.i} x slot ${o}`);
    }
  }
  const full = comp.n > 1 && errors.every((e) => !e.startsWith('degree'));
  const parts = components(comp, read.bridges);
  if (full && parts !== 1) errors.push(`disconnected: ${parts} components, the islands must form one`);
  return {
    ok: errors.length === 0,
    errors,
    degrees: Array.from(deg),
    roots: rootsOf(read.bridges),
    components: parts,
    target: handshake(comp).target,
  };
}

export function validate(spec, bridges) {
  return checkBridges(spec, bridges).ok;
}

// Readable form for the panel and the tests: which rule class each error belongs to.
export function errorKinds(result) {
  return [...new Set(result.errors.map((e) => e.split(':')[0]))];
}

export function toEdges(comp, bridges) {
  const out = [];
  for (const s of comp.slots) {
    if (bridges[s.i]) out.push({ a: s.a, b: s.b, n: bridges[s.i] });
  }
  return out;
}

// Spec is the save format and the wire format, so it must survive JSON unchanged.
export function serialize(spec) {
  return JSON.stringify({
    w: spec.w,
    h: spec.h,
    islands: ordered(spec)
      .sort((x, y) => x.r - y.r || x.c - y.c)
      .map((x) => ({ r: x.r, c: x.c, p: x.p })),
  });
}

export function deserialize(text) {
  const raw = JSON.parse(text);
  return { w: raw.w, h: raw.h, islands: raw.islands.map((x) => ({ r: x.r, c: x.c, p: x.p })) };
}

// A clue-removal view of a spec: `p` becomes a wildcard on purpose. Used by the uniqueness
// counter-proof — a puzzle whose every number is truly load-bearing stops being unique the
// moment one is erased.
export function withoutClue(spec, i) {
  const islands = ordered(spec).sort((x, y) => x.r - y.r || x.c - y.c).map((x) => ({ ...x }));
  if (!Number.isInteger(i) || i < 0 || i >= islands.length) throw new Error(`no island ${i}`);
  islands[i].p = null;
  return { w: spec.w, h: spec.h, islands };
}
