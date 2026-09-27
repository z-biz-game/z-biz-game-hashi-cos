// A puzzle in progress: the bridge state plus the rules that touch it. No DOM in here, which is
// what lets test/game.test.mjs and tools/playtest.mjs drive the same object the screen does.
//
// The one interaction is a drag from island A to island B, and its meaning is a 3-cycle:
//
//   0 -> 1 -> 2 -> 0
//
// That cycle is a product decision with a consequence the README states out loud: the third drag
// on a pair *clears* it, so "the fewest drags that can finish a puzzle" is exactly the number of
// bridge roots, sum(p)/2. Every drag that adds a root adds one root; nothing else can add one.
// A rejected drag (illegal pair, would over-supply an island, already-crossed) is not counted at
// all, so the drag count is a measure of play, not of fumbling.

import { compile, checkBridges, validate, handshake, components, degreesOf, rootsOf, pairKey, blankBridges } from './model.js';

// The reason a drag was refused. The view turns these into a shake; the tests assert on them.
export const REJECT = {
  NO_SLOT: 'no-slot', // not the same row/column, or a third island sits between
  CROSSING: 'crossing', // a bridge already crosses this line
  OVER: 'over-number', // one island would end up with more roots than its number
  FULL: 'full', // unreachable guard: the 3-cycle means a slot never needs a 4th value
  DONE: 'already-solved', // the board is finished; drags are ignored rather than silently mutating
};

export function createGame(lot) {
  const spec = lot.spec;
  const comp = lot.comp || compile(spec);
  const hs = handshake(comp);
  return {
    id: lot.id,
    tier: lot.tier,
    k: lot.k,
    spec,
    comp,
    solution: lot.solution ? Uint8Array.from(lot.solution) : null,
    // One owner for "an empty board": `blankBridges` is the model's own answer for the shape a
    // bridge state has to have, so the game layer cannot drift from it (a board sized to the wrong
    // slot count reads as a `shape:` validator error rather than as a puzzle that will not win).
    bridges: blankBridges(comp),
    target: hs.target,
    sumP: hs.sumP,
    drags: 0,
    history: [],
    hints: 0,
    done: false,
    lastReject: null,
  };
}

export function slotFor(game, a, b) {
  const idx = game.comp.slotOf.get(pairKey(a, b));
  return idx === undefined ? -1 : idx;
}

// The only mutation entry point. Returns { ok, action, reason, slot }.
export function dragBridge(game, a, b) {
  if (game.done) return { ok: false, reason: REJECT.DONE, slot: -1 };
  const { comp, bridges } = game;
  const slot = slotFor(game, a, b);
  if (slot < 0 || a === b || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= comp.n || b >= comp.n) {
    game.lastReject = REJECT.NO_SLOT;
    return { ok: false, reason: REJECT.NO_SLOT, slot: -1 };
  }
  const s = comp.slots[slot];
  const cur = bridges[slot];
  const next = cur >= 2 ? 0 : cur + 1;
  if (next > cur) {
    const deg = degreesOf(comp, bridges);
    // Would this over-supply either island?
    for (const i of [s.a, s.b]) {
      const p = comp.p[i];
      if (p >= 0 && deg[i] + (next - cur) > p) {
        game.lastReject = REJECT.OVER;
        return { ok: false, reason: REJECT.OVER, slot };
      }
    }
    // Would it cross a bridge already standing?
    for (const o of s.crosses) {
      if (bridges[o]) {
        game.lastReject = REJECT.CROSSING;
        return { ok: false, reason: REJECT.CROSSING, slot };
      }
    }
  }
  if (next === cur) {
    game.lastReject = REJECT.FULL;
    return { ok: false, reason: REJECT.FULL, slot };
  }
  game.history.push({ slot, from: cur, to: next });
  bridges[slot] = next;
  game.drags++;
  game.lastReject = null;
  if (validate(game.spec, bridges)) game.done = true;
  return { ok: true, action: next > cur ? 'add' : 'clear', slot, at: next };
}

export function undo(game) {
  const last = game.history.pop();
  if (!last) return false;
  game.bridges[last.slot] = last.from;
  game.drags--;
  game.done = false;
  return true;
}

export function reset(game) {
  game.bridges.fill(0);
  game.drags = 0;
  game.history = [];
  game.hints = 0;
  game.done = false;
  game.lastReject = null;
}

// Everything the panel prints, derived here rather than in the shell so the tests can read the
// same numbers the canvas user sees.
export function progress(game) {
  const { comp, bridges } = game;
  const deg = degreesOf(comp, bridges);
  let satisfied = 0;
  let over = 0;
  for (let i = 0; i < comp.n; i++) {
    if (comp.p[i] >= 0 && deg[i] === comp.p[i]) satisfied++;
    if (comp.p[i] >= 0 && deg[i] > comp.p[i]) over++;
  }
  return {
    roots: rootsOf(bridges),
    target: game.target,
    sumP: game.sumP,
    satisfied,
    over,
    islands: comp.n,
    connected: components(comp, bridges) === 1,
    crossings: checkBridges(game.spec, bridges).errors.filter((e) => e.startsWith('crossing')).length,
  };
}

export function won(game) {
  return validate(game.spec, game.bridges);
}

// The next root of the baked unique solution that is not on the board yet. Because the solution
// is *the* solution, following these never walks the player into a dead end, and it never
// over-supplies an island either.
export function hint(game) {
  if (game.done || !game.solution) return null;
  const { comp, bridges, solution } = game;
  let left = 0;
  let pick = -1;
  for (const s of comp.slots) {
    const gap = solution[s.i] - bridges[s.i];
    if (gap > 0) {
      left += gap;
      if (pick < 0) pick = s.i;
    } else if (gap < 0) {
      left += -gap; // a root that has to come back off; still work remaining
    }
  }
  if (pick < 0) return null;
  const s = comp.slots[pick];
  game.hints++;
  return { slot: pick, a: s.a, b: s.b, add: solution[pick], left };
}

// Drags spent against the identity-derived minimum. Three grades, defined in code so both the
// win card and the tests read the same rule.
export function grade(game) {
  const over = game.drags - game.target;
  if (over <= 0 && !game.hints) return { key: 'perfect', label: '一次到位', stars: 3 };
  if (over <= 2) return { key: 'clean', label: '桥路通畅', stars: 2 };
  return { key: 'scenic', label: '绕了远路', stars: 1 };
}
