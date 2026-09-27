// js/core/game.js: the play layer. Every claim in here is a claim about what the player's one
// gesture does, so each expectation is derived by hand from the fixtures in test/fixture.mjs
// (whose own hand-derivations are pinned by test/model.test.mjs and test/count.test.mjs) plus the
// shipped pool. The contract's two load-bearing promises live in this file:
//
//   * the drag is a 0 -> 1 -> 2 -> 0 cycle, and a refused drag is *not billed*;
//   * "every number is met" is not the same statement as "won" — connectivity has to hold too.
//
// tools/playtest.mjs drives this exact object through real mouse events; this suite drives it
// directly, so a failure here says "the rule is wrong" rather than "the event never arrived".
import { test, run, eq, ok } from '../tools/harness.mjs';
import { createGame, dragBridge, undo, reset, hint, grade, progress, won, slotFor, REJECT } from '../js/core/game.js';
import { compile, blankBridges, validate, checkBridges, degreesOf, rootsOf, components, handshake } from '../js/core/model.js';
import { SQUARE_A, SQUARE_F, COMB_B, TIPS_C } from './fixture.mjs';
import { LOTS } from '../js/data/lots.js';

// A lot-shaped object from a raw fixture spec, so the game layer sees exactly what the shipped
// pool hands it: an id, a band, a serialised spec and a certified answer. The square family names
// its hand-derived answer `vector` rather than `solution`, so both spellings are accepted here.
const asLot = (spec, id = 'fixture') => ({
  id, tier: 'shoal', k: 0, spec,
  solution: spec.expect ? (spec.expect.solution || spec.expect.vector) : null,
});

// The four corner fixtures share one slot order, printed once so the rest of the file can name a
// slot by what it means instead of by an index nobody can check:
//   TOP = 0-1 (row 0)   BOTTOM = 2-3 (row 2)   LEFT = 0-2 (col 0)   RIGHT = 1-3 (col 2)
const TOP = 0, BOTTOM = 1, LEFT = 2, RIGHT = 3;

// Play the certified answer with adds only, topping each slot up from wherever it stands: one
// drag per missing root, so from a blank board it lands on exactly `target` drags. Legal by
// construction — an intermediate degree never exceeds the clue it is climbing toward, and a
// subset of a crossing-free answer cannot contain a crossing.
function playSolution(game) {
  for (const s of game.comp.slots) {
    for (let v = game.bridges[s.i]; v < game.solution[s.i]; v++) {
      const r = dragBridge(game, s.a, s.b);
      if (!r.ok) throw new Error(`playSolution hit a refusal on slot ${s.i}: ${r.reason}`);
    }
  }
  return game;
}

// Solve by following hint() instead of the answer vector: same drags, but every step cost a peek.
function playByHints(game) {
  for (let guard = 0; guard < 4 * game.target + 8; guard++) {
    const h = hint(game);
    if (!h) break;
    const r = dragBridge(game, h.a, h.b);
    if (!r.ok) throw new Error(`hint() asked for a refused drag: ${r.reason}`);
  }
  return game;
}

test('createGame opens a blank board whose shape the model owns, and nothing else', () => {
  const g = createGame(asLot(SQUARE_A));
  eq(g.id, 'fixture');
  eq([g.drags, g.hints, g.done], [0, 0, false], 'nothing has happened yet');
  eq(g.lastReject, null);
  eq(Array.from(g.bridges), [0, 0, 0, 0], 'every slot starts empty');
  eq(g.bridges.length, compile(SQUARE_A).nSlots);
  ok(g.bridges instanceof Uint8Array, 'a plain array would pass the validator but not the view');
  // The board is `blankBridges(comp)` — the model's own answer for the shape — rather than a
  // locally rebuilt one, so the two can never disagree about how many slots exist.
  eq(Array.from(g.bridges), Array.from(blankBridges(g.comp)), 'same owner, same board');
  // sum(p)/2 counted off the clues by hand: (2+2+2+2)/2 = 4.
  eq([g.sumP, g.target], [8, 4], 'the handshake identity holds before any bridge exists');
  eq(Array.from(g.solution), [1, 1, 1, 1], 'the certified answer rides along for hint()');
  const bare = createGame({ id: 'bare', tier: 'shoal', k: 0, spec: SQUARE_A });
  eq(bare.solution, null, 'a lot with no printed answer simply has no hints to give');
  eq(Array.from(bare.bridges), [0, 0, 0, 0], 'but its board is still the right shape');
});

test('the drag is a 0 -> 1 -> 2 -> 0 cycle and every step of it is billed', () => {
  const g = createGame(asLot(SQUARE_A));
  eq(dragBridge(g, 0, 1), { ok: true, action: 'add', slot: TOP, at: 1 }, 'first drag: one root');
  eq(g.drags, 1);
  eq(dragBridge(g, 0, 1), { ok: true, action: 'add', slot: TOP, at: 2 }, 'second: a double bridge');
  eq(g.drags, 2);
  eq(dragBridge(g, 0, 1), { ok: true, action: 'clear', slot: TOP, at: 0 }, 'third: the pair is cleared');
  eq(g.drags, 3, 'a clear is a real edit, so it costs a drag too');
  eq(Array.from(g.bridges), [0, 0, 0, 0], 'and the board is back where it started');
  eq(g.history.map((h) => `${h.from}>${h.to}`), ['0>1', '1>2', '2>0'], 'undo can retrace all three');
  eq(rootsOf(g.bridges), 0);
  // The cycle is periodic, so a fourth drag on the cleared pair adds again.
  eq(dragBridge(g, 0, 1).at, 1);
  eq(g.drags, 4);
  eq(rootsOf(g.bridges), 1, 'four billed drags, one root on the water: three of them were waste');
  // The algebra the whole grading section rests on, stated while it is cheap to see:
  // drags = adds + clears and roots = adds - 2*clears, so drags - roots is 3*clears.
  eq(g.drags - rootsOf(g.bridges), 3, 'one clear, three drags of interest');
});

test('a refused drag changes nothing at all — not the board, not the count, not the history', () => {
  const broken = [];
  // Every refusal has to be a no-op on all three counters, which is what "not billed" means.
  const refused = (g, a, b, want, label) => {
    const bridges = Array.from(g.bridges).join(',');
    const { drags, hints } = g;
    const history = g.history.length;
    const r = dragBridge(g, a, b);
    if (r.ok) broken.push([label, 'accepted', r]);
    else if (r.reason !== want) broken.push([label, 'reason', r.reason, want]);
    if (Array.from(g.bridges).join(',') !== bridges) broken.push([label, 'the board moved']);
    if (g.drags !== drags) broken.push([label, 'drags billed', g.drags, drags]);
    if (g.history.length !== history) broken.push([label, 'history grew']);
    if (g.hints !== hints) broken.push([label, 'hints moved']);
  };

  // NO_SLOT. COMB_B row 0 holds islands 0,1,2 in that order, so 0 and 2 have no slot between them:
  // a bridge there would run straight through a numbered island.
  const c = createGame(asLot(COMB_B));
  eq(slotFor(c, 0, 2), -1, 'three islands in one row: the outer two are not connected');
  eq(slotFor(c, 0, 1), TOP, 'and the adjacent pair is the slot that stops it');
  refused(c, 0, 2, REJECT.NO_SLOT, 'blocked pair');
  refused(c, 0, 0, REJECT.NO_SLOT, 'island onto itself');
  refused(c, 0, 99, REJECT.NO_SLOT, 'index off the board');
  refused(c, -1, 0, REJECT.NO_SLOT, 'negative index');
  refused(c, 0, 1.5, REJECT.NO_SLOT, 'non-integer index');
  eq(c.lastReject, REJECT.NO_SLOT, 'the last reason is kept for the view even when the code differs');
  eq([c.drags, c.history.length], [0, 0], 'five refused drags, zero billed');
  // The pair that *does* exist, asked for backwards: pairKey orders its endpoints, so 1->0 is the
  // same gesture as 0->1 and must be accepted.
  eq(dragBridge(c, 1, 0), { ok: true, action: 'add', slot: 0, at: 1 });
  eq(c.lastReject, null, 'a legal drag clears the stored reason');

  // CROSSING. TIPS_C is the smallest spec whose two slots cross, at cell (1,1).
  const t = createGame(asLot(TIPS_C));
  eq(dragBridge(t, 1, 2).ok, true, 'the first bridge is fine on its own');
  refused(t, 0, 3, REJECT.CROSSING, 'the second would cross it');
  eq(t.lastReject, REJECT.CROSSING);
  eq(Array.from(t.bridges), [1, 0]);
  eq(t.drags, 1, 'refused, so the player is not charged');

  // OVER. SQUARE_A is tight: p = 2 on four islands, so a filled pair leaves no room on either end.
  const s = createGame(asLot(SQUARE_A));
  dragBridge(s, 0, 1);
  eq(dragBridge(s, 0, 1).at, 2, 'the double is legal: 2 == p');
  eq(Array.from(degreesOf(s.comp, s.bridges)), [2, 2, 0, 0]);
  refused(s, 0, 2, REJECT.OVER, 'island 0 has already spent its two');
  refused(s, 1, 3, REJECT.OVER, 'and so has island 1');
  eq(s.drags, 2, 'over-supply is refused without touching the board');
  // The opposite direction is never an over-supply: a clear only removes roots.
  eq(dragBridge(s, 0, 1).action, 'clear');
  eq(dragBridge(s, 0, 2).at, 1, 'and with the double gone, the left column is legal again');

  // DONE. Once the board is certified the layer stops listening.
  const d = playSolution(createGame(asLot(SQUARE_A)));
  ok(d.done, 'solved');
  refused(d, 0, 2, REJECT.DONE, 'a legal pair after the win');
  refused(d, 0, 99, REJECT.DONE, 'DONE outranks NO_SLOT: the board is finished, not wrong');
  eq([d.drags, d.history.length], [4, 4], 'nothing is billed after the win');
  eq(Array.from(d.bridges), [1, 1, 1, 1], 'the finished board is frozen');
  eq(broken, [], 'every refusal above was a genuine no-op');
});

// REJECT.FULL is documented as an unreachable guard. An unreachable claim needs proof rather than
// a comment: sweep the whole cycle on every slot of every shipped puzzle and read what can fire.
test('FULL never fires, because the cycle maps 2 to 0 instead of to 3', () => {
  const seen = new Set();
  for (const row of LOTS) {
    const g = createGame(row);
    for (const s of g.comp.slots) {
      // Two full turns of the cycle on one slot, without resetting in between: 0 1 2 0 1 2 0.
      for (let k = 0; k < 6; k++) {
        const r = dragBridge(g, s.a, s.b);
        if (!r.ok) seen.add(r.reason);
      }
    }
    reset(g);
    playSolution(g);
    seen.add(dragBridge(g, g.comp.slots[0].a, g.comp.slots[0].b).reason);
  }
  ok(!seen.has(REJECT.FULL), `FULL fired, which the header says is impossible: ${[...seen].join(' ')}`);
  ok(!seen.has(REJECT.NO_SLOT), 'and no slot lookup ever failed either — these were all real slots');
  eq([...seen].sort(), [REJECT.CROSSING, REJECT.DONE, REJECT.OVER].sort(),
    'three refusals are reachable on real data, and each one has a fixture above');
});

test('every number met and every root spent is still not a win when the sea is split', () => {
  // SQUARE_A, vector [2,2,0,0]: two separate double bridges. Degrees are 2,2,2,2 == p, roots are
  // 4 == sum(p)/2, nothing crosses — and there are two components rather than one puzzle.
  const g = createGame(asLot(SQUARE_A));
  for (let i = 0; i < 4; i++) ok(dragBridge(g, i < 2 ? 0 : 2, i < 2 ? 1 : 3).ok);
  eq(Array.from(g.bridges), [2, 2, 0, 0]);
  const p = progress(g);
  eq([p.roots, p.target], [4, 4], 'the root budget is exactly spent');
  eq(p.satisfied, 4, 'every clue is met');
  eq([p.over, p.crossings], [0, 0], 'and nothing illegal happened');
  eq(p.connected, false, 'but the sea is split');
  eq(g.done, false, 'and the game refuses to call it a win');
  eq(won(g), false, 'the independent re-derivation says the same thing');
  eq(checkBridges(g.spec, g.bridges).errors, ['disconnected: 2 components, the islands must form one']);
  eq(components(g.comp, g.bridges), 2);
  // The same trap on shipped data. sound-04 is the bottom row 2-3-4-5-6 with p = 1,3,4,3,1 (12
  // roots' worth = 6) plus the top pair 0-1 at p = 1,1: fill the row, fill the pair, and the two
  // halves never touch. Vector [1,1,2,2,1,0,0] spends 1+1+2+2+1 = 7 = sum(p)/2.
  const row = LOTS.find((l) => l.id === 'sound-04');
  const s = createGame(row);
  eq(row.roots, 7, 'printed on the same line as its spec');
  s.bridges.set([1, 1, 2, 2, 1, 0, 0]);
  eq(rootsOf(s.bridges), row.roots, 'the budget is exactly spent here too');
  eq(Array.from(degreesOf(s.comp, s.bridges)), Array.from(s.comp.p), 'every clue met, to the digit');
  eq(checkBridges(row.spec, s.bridges).ok, false, 'and still not a solution');
  eq(won(s), false, 'so `won` can never be replaced by a clue check');
  eq(progress(s).satisfied, 7);
  eq(progress(s).connected, false, 'the panel says why: 2 components');
});

test('won() re-derives the verdict, so the done latch can be caught lying', () => {
  const row = LOTS.find((l) => l.id === 'shoal-07');
  eq([row.sumP, row.roots, row.solution], [10, 5, [2, 1, 2]], 'the row is what the next three lines claim');
  const g = createGame(row);
  eq(g.done, false);
  eq(won(g), false, 'a blank board is not a win by either route');
  // Write the certified answer straight onto the board: no drag runs, so `done` never latches.
  g.bridges.set(Array.from(g.solution));
  eq(won(g), true, 'the validator says won');
  eq(g.done, false, 'the latch says not yet, because nothing told it');
  // One real drag re-reads the board, and it disagrees with the remembered success.
  const s0 = g.comp.slots[0];
  eq(dragBridge(g, s0.a, s0.b), { ok: true, action: 'clear', slot: 0, at: 0 }, 'slot 0 held 2, so the cycle clears it');
  eq(Array.from(g.bridges), [0, 1, 2]);
  eq([g.done, won(g)], [false, false], 'both routes now say "not won", derived from the same board');
  playSolution(g);
  eq(Array.from(g.bridges), [2, 1, 2]);
  eq([g.done, won(g)], [true, true], 'and both say "won" again, without the latch ever being set by hand');
  eq(g.drags, 3, 'one clear plus two adds: cheaper than the target only because the first write was free');
  reset(g);
  eq([g.done, won(g)], [false, false], 'and reset clears both');
});

test('the fewest drags that can finish a puzzle is exactly sum(p)/2', () => {
  // Hand-played, no hints, no clears: SQUARE_A wants [1,1,1,1] (4 singles = 4 drags) and SQUARE_F
  // wants [2,2,2,2] (8 roots = 8 drags). The identity holds because an add raises the root count
  // by exactly one and nothing else can raise it at all.
  const cases = [
    [SQUARE_A, 'SQUARE_A', [1, 1, 1, 1], 4],
    [SQUARE_F, 'SQUARE_F', [2, 2, 2, 2], 8],
  ];
  for (const [spec, id, vector, drags] of cases) {
    const g = createGame(asLot(spec, id));
    playSolution(g);
    eq(Array.from(g.bridges), vector, 'the hand-derived unique answer');
    eq(g.drags, drags, 'one drag per root, no waste');
    eq([g.sumP / 2, g.target, g.drags, rootsOf(g.bridges)], [drags, drags, drags, drags], 'Σp/2 == target == drags == roots');
    ok(g.done && won(g), `${id} did not certify`);
    eq(grade(g), { key: 'perfect', label: '一次到位', stars: 3 }, 'minimum play is the only perfect play');
  }
});

// What the billing invariant costs the grader. drags - roots = 3 * (clears), so on a *finished*
// board drags - target is a multiple of 3 and the middle band (`over <= 2`) can only be reached
// with over === 0. That makes `hints` the only thing separating 一次到位 from 桥路通畅, which is a
// real property of these three lines of code rather than an accident of one fixture.
test('grade: the bands are perfect / clean / scenic, and the middle one is decided by hints', () => {
  const perfect = grade(playSolution(createGame(asLot(SQUARE_A))));
  eq(perfect.key, 'perfect');
  const hinted = grade(playByHints(createGame(asLot(SQUARE_A))));
  eq([hinted.key, hinted.stars, hinted.label], ['clean', 2, '桥路通畅'], 'same drags, one peek');
  // One wasted cycle (0 -> 1 -> 2 -> 0) on a slot the answer still needs afterwards.
  const wasted = createGame(asLot(SQUARE_F, 'SQUARE_F'));
  for (let k = 0; k < 3; k++) ok(dragBridge(wasted, 0, 1).ok, 'the double and its clear are all legal');
  eq([wasted.drags, rootsOf(wasted.bridges)], [3, 0], 'three drags, no roots: pure waste');
  playSolution(wasted);
  eq([wasted.drags, wasted.target], [11, 8], '8 roots plus the 3 wasted');
  eq(grade(wasted).key, 'scenic', 'over = 3, past the clean line');
  eq(grade(wasted).stars, 1);
  // The invariant behind those numbers. An add moves drags and roots together; a clear moves drags
  // by +1 and roots by -2; so drags - roots is exactly 3 * (clears), for every legal play.
  const inv = [];
  for (const row of LOTS) {
    const g = createGame(row);
    for (let k = 0; k < 40; k++) {
      const s = g.comp.slots[(k * 7 + g.drags) % g.comp.nSlots];
      dragBridge(g, s.a, s.b);
      if (k % 5 === 4) undo(g);
    }
    const clears = g.history.filter((h) => h.to < h.from).length;
    inv.push(g.drags - rootsOf(g.bridges) - 3 * clears);
  }
  eq([...new Set(inv)], [0], 'drags - roots === 3 * clears on all 32 boards, fuzzed');
  // Which means `over` on a finished board is a multiple of 3, so the middle band can only ever be
  // reached at over === 0: in play, 桥路通畅 *is* "minimum drags, but you looked".
  //
  // The wasted cycle has to land on a slot whose answer is a double, or it would leave a root on
  // the water and the rest of the play would be filling a different board. Rows with no double at
  // all cannot waste a whole cycle and are skipped, counted, and reported.
  const overs = new Set();
  let wasteless = 0;
  for (const row of LOTS) {
    const g = createGame(row);
    const double = g.comp.slots.find((s) => g.solution[s.i] === 2);
    if (!double) { wasteless++; continue; }
    for (let cycles = 0; cycles <= 2; cycles++) {
      const h = createGame(row);
      for (let k = 0; k < 3 * cycles; k++) {
        const r = dragBridge(h, double.a, double.b);
        ok(r.ok, `waste drag ${k} on ${double.a}-${double.b}: ${r.reason}`);
      }
      playSolution(h);
      ok(h.done, `${row.id} could not be finished after ${cycles} wasted cycles`);
      overs.add(h.drags - h.target);
    }
  }
  ok(wasteless < LOTS.length, `${wasteless} rows have no double bridge to waste a cycle on`);
  eq([...overs].sort((a, b) => a - b), [0, 3, 6], 'measured over the pool: 0, 3 or 6, never 1, 2, 4 or 5');
  // grade() reads counters, not the verdict: an unfinished board at minimum cost says 一次到位.
  const mid = createGame(asLot(SQUARE_F, 'SQUARE_F'));
  dragBridge(mid, 0, 1);
  dragBridge(mid, 0, 1);
  eq([mid.done, mid.drags - mid.target, grade(mid).key], [false, -6, 'perfect'],
    'so the shell has to keep calling it only from finish(), which is what js/main.js does');
});

test('hint walks the certified answer and never asks for an over-supplied island', () => {
  const g = createGame(asLot(SQUARE_A));
  // Blank board: every one of the four slots needs +1, so 4 roots of work are left.
  eq(hint(g), { slot: TOP, a: 0, b: 1, add: 1, left: 4 });
  eq(g.hints, 1, 'asking costs a hint');
  dragBridge(g, 0, 1);
  eq(hint(g), { slot: BOTTOM, a: 2, b: 3, add: 1, left: 3 }, 'the next short slot in index order');
  eq(hint(g).left, 3, 'and it keeps naming the same one until it is played');
  // Now a board with an excess: slot TOP holds 2 where the answer wants 1, and three slots want +1.
  // `left` counts the excess as work too: |−1| + 1 + 1 + 1 = 4.
  const h = createGame(asLot(SQUARE_A));
  dragBridge(h, 0, 1);
  dragBridge(h, 0, 1);
  eq(Array.from(h.bridges), [2, 0, 0, 0]);
  eq(hint(h), { slot: BOTTOM, a: 2, b: 3, add: 1, left: 4 }, 'the extra root is counted, not ignored');
  eq(h.hints, 1, 'one peek, however many slots it looked at');
  // SQUARE_F wants doubles, so `add` reports the value the slot has to reach, not the delta.
  const f = createGame(asLot(SQUARE_F, 'SQUARE_F'));
  eq(hint(f), { slot: TOP, a: 0, b: 1, add: 2, left: 8 }, 'Σp/2 = 8 roots of work on a blank board');
  dragBridge(f, 0, 1);
  eq(hint(f), { slot: TOP, a: 0, b: 1, add: 2, left: 7 }, 'still slot TOP — one of its two roots is missing');
  dragBridge(f, 0, 1);
  eq(hint(f), { slot: BOTTOM, a: 2, b: 3, add: 2, left: 6 });
  // A solved board has nothing to say, and a board with no printed answer cannot be hinted.
  playSolution(f);
  eq([f.hints, hint(f)], [3, null], 'solved, and honest about it');
  eq(hint(createGame({ id: 'x', tier: 'shoal', k: 0, spec: SQUARE_A })), null);
  const blind = createGame(asLot(SQUARE_A));
  blind.solution = null;
  eq(hint(blind), null, 'no answer vector, no hint — rather than a guess');
  eq(blind.hints, 0, 'and it did not charge for the refusal');
  // Following hint() to the end is a proof of the comment above it: the guidance is never illegal
  // and never over-supplies, on any shipped puzzle.
  const bad = [];
  for (const row of LOTS) {
    const g = createGame(row);
    try {
      playByHints(g);
      if (!g.done) bad.push([row.id, 'not won']);
      const deg = degreesOf(g.comp, g.bridges);
      for (let i = 0; i < g.comp.n; i++) if (deg[i] > g.comp.p[i]) bad.push([row.id, 'over', i]);
    } catch (err) {
      bad.push([row.id, String(err.message)]);
    }
  }
  eq(bad, [], '32 puzzles steered from the blank board to the win with no refused drag');
});

test('undo steps back through the whole cycle, including the drag that won', () => {
  const g = createGame(asLot(SQUARE_A));
  eq(undo(g), false, 'nothing to undo yet');
  eq(g.drags, 0);
  playSolution(g);
  ok(g.done);
  eq([g.drags, g.bridges.join(',')], [4, '1,1,1,1']);
  eq(undo(g), true);
  eq([g.done, g.bridges.join(','), g.drags], [false, '1,1,1,0', 3], 'the win unhappens');
  eq(undo(g), true);
  eq([Array.from(g.bridges), g.drags], [[1, 1, 0, 0], 2]);
  // Undo a *clear*: both roots come back, not one.
  const h = createGame(asLot(SQUARE_A));
  for (let k = 0; k < 3; k++) dragBridge(h, 0, 1);
  eq([h.bridges[TOP], h.drags], [0, 3]);
  undo(h);
  eq([h.bridges[TOP], h.drags], [2, 2], 'back to the double, and the billing follows');
  undo(h);
  eq([h.bridges[TOP], h.drags], [1, 1]);
  undo(h);
  eq([h.bridges[TOP], h.drags], [0, 0]);
  eq(undo(h), false, 'the history is empty again');
  // Undo is the only way out of a won board, and it clears the latch as it goes.
  const u = createGame(asLot(SQUARE_A));
  playSolution(u);
  ok(u.done);
  eq(undo(u), true, 'the win can be taken back');
  eq([u.done, u.bridges.join(','), u.drags], [false, '1,1,1,0', 3], 'and the verdict goes with it');
  eq(won(u), false, 'the validator agrees this time, because the root really is gone');
  eq(dragBridge(u, 1, 3).at, 1, 'play the undone slot (RIGHT, islands 1 and 3) again...');
  eq([u.done, u.bridges.join(',')], [true, '1,1,1,1'], '...and the win is re-derived from scratch');
  eq(u.drags, 4, 'undo refunded the drag, so the round trip costs nothing');
  eq(grade(u).key, 'perfect', 'and the grader cannot tell that a slot was rebuilt — only waste shows up');
});

test('reset wipes the play state but never the puzzle itself', () => {
  const row = LOTS.find((l) => l.id === 'ocean-01');
  const g = playByHints(createGame(row));
  ok(g.done && g.hints > 0);
  const spec = g.spec;
  const comp = g.comp;
  const solution = Array.from(g.solution);
  reset(g);
  eq(Array.from(g.bridges), new Array(g.comp.nSlots).fill(0), 'blank');
  eq([g.drags, g.hints, g.done], [0, 0, false]);
  eq(g.lastReject, null);
  eq([g.spec === spec, g.comp === comp], [true, true], 'the compiled puzzle is shared, not rebuilt');
  eq(Array.from(g.solution), solution, 'and the answer is still there to hint with');
  eq([g.target, g.sumP, g.id, g.tier, g.k], [row.roots, row.sumP, 'ocean-01', 'ocean', row.k], 'metadata survived');
  eq(grade(g).key, 'perfect', 'a blank board has spent zero drags, which is all grade can see');
  eq([progress(g).roots, progress(g).satisfied], [0, 0]);
});

test('progress prints the panel numbers, derived from the board rather than remembered', () => {
  // archipelago-02 by hand: 9 islands, 10 slots, sum(p) = 1+2+1+3+2+1+3+2+1 = 16 so roots = 8, and
  // the printed answer 1,1,0,1,1,1,0,1,1,1 sums to 8 too.
  const row = LOTS.find((l) => l.id === 'archipelago-02');
  eq([row.islands, row.slots, row.sumP, row.roots], [9, 10, 16, 8], 'what the bake printed');
  eq(row.solution.reduce((a, v) => a + v, 0), 8, 'and the answer vector spends exactly that');
  const g = createGame(row);
  const p0 = progress(g);
  eq([p0.islands, p0.roots, p0.target, p0.sumP], [9, 0, 8, 16]);
  eq([g.target, g.sumP], [handshake(g.comp).target, handshake(g.comp).sumP], 'target really is Σp/2');
  eq([p0.satisfied, p0.over, p0.connected, p0.crossings], [0, 0, false, 0], 'nine islands and no bridges is nine components');
  // Half of the printed answer, played with drags: slots 0..4 carry 1+1+0+1+1 = 4 roots, which
  // completes precisely the three islands whose clue is 1 (0, 2 and 5) and no others.
  const half = g.comp.nSlots >> 1;
  for (let i = 0; i < half; i++) {
    const s = g.comp.slots[i];
    for (let v = 0; v < g.solution[i]; v++) ok(dragBridge(g, s.a, s.b).ok, `slot ${i}`);
  }
  const p1 = progress(g);
  eq([g.drags, p1.roots], [4, 4], 'every billed drag was an add, so roots and drags still agree');
  eq(p1.roots < p1.target, true, 'four of eight');
  eq(p1.satisfied, 3, 'the three p=1 islands, and only they are done');
  eq(p1.over, 0, 'the drag layer cannot over-supply, so this column is always 0 in play');
  eq(p1.crossings, 0, 'and neither can it cross: the field is there for a hand-edited board');
  eq(p1.connected, false, 'the board is in five pieces');
  playSolution(g);
  eq(progress(g), {
    roots: 8, target: 8, sumP: 16, satisfied: 9, over: 0,
    islands: 9, connected: true, crossings: 0,
  }, 'the winning row of every column');
  eq(g.drags, g.target, 'still the identity minimum: 8 drags for 8 roots');
});

test('the game layer never edits the pool it was handed', () => {
  // library.js compiles `ALL` once at import. A game that mutated its lot would silently
  // re-shape the daily puzzle for the next player in the same page.
  const before = LOTS.map((l) => `${l.id}:${l.spec.islands.map((x) => x.p).join('')}:${l.solution.join('')}:${l.spec.w}x${l.spec.h}`);
  for (const row of LOTS.slice(0, 8)) {
    playByHints(createGame(row));
    const g = createGame(row);
    playSolution(g);
    reset(g);
    dragBridge(g, g.comp.slots[0].a, g.comp.slots[0].b);
    undo(g);
  }
  const after = LOTS.map((l) => `${l.id}:${l.spec.islands.map((x) => x.p).join('')}:${l.solution.join('')}:${l.spec.w}x${l.spec.h}`);
  eq(after, before, 'no clue, answer or board size moved');
  // Two games over one compiled lot: the geometry is shared (nothing writes to it), the board is
  // not. A raw data row carries no `comp`, so the fallback compiles one per game — also fine, and
  // asserted here so a future change to either branch has to say something.
  const comp = compile(LOTS[0].spec);
  const lot = { ...LOTS[0], comp };
  const a = createGame(lot);
  const b = createGame(lot);
  dragBridge(a, a.comp.slots[0].a, a.comp.slots[0].b);
  eq(Array.from(a.bridges), [1].concat(new Array(a.comp.nSlots - 1).fill(0)));
  eq(Array.from(b.bridges), new Array(b.comp.nSlots).fill(0), 'two games from one lot do not share a board');
  ok(a.bridges !== b.bridges, 'distinct typed arrays');
  ok(a.comp === comp && b.comp === comp, 'while the compiled geometry is shared, because nothing writes to it');
  ok(createGame(LOTS[0]).comp !== createGame(LOTS[0]).comp, 'and a lot without one gets its own');
  eq(validate(LOTS[0].spec, b.bridges), false, 'the untouched one is still blank');
  eq(createGame(lot).solution === lot.solution, false, 'the answer is copied, so hint() cannot be tricked by a player');
});

run();
