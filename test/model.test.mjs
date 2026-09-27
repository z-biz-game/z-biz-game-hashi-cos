// js/core/model.js: the slot list, the validator, and the four negative classes the spec names.
import { test, run, eq, ok, fail } from '../tools/harness.mjs';
import {
  compile, compileSafe, checkSpec, checkBridges, validate, errorKinds, handshake, boundOf,
  degreesOf, rootsOf, components, connected, serialize, deserialize, withoutClue, toBridges,
  toEdges, sumP,
} from '../js/core/model.js';
import {
  SQUARE_A, SQUARE_X, COMB_B, TIPS_C, OVER_BOUND, ODD_SUM, THREE_IN_A_ROW,
} from './fixture.mjs';

const names = (spec) => compile(spec).slots.map((s) => `${s.a}-${s.b}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

test('compile normalises islands to (row, column) order and numbers them', () => {
  const shuffled = { w: 3, h: 3, islands: [SQUARE_A.islands[3], SQUARE_A.islands[0], SQUARE_A.islands[2], SQUARE_A.islands[1]] };
  const comp = compile(shuffled);
  eq(comp.islands.map((x) => [x.r, x.c]), [[0, 0], [0, 2], [2, 0], [2, 2]]);
  eq(Array.from(comp.p), [2, 2, 2, 2], 'the clues follow the reordering');
});

test('the slot list is consecutive pairs per row and per column (fixture A)', () => {
  eq(names(SQUARE_A), SQUARE_A.expect.slots);
  eq(names(COMB_B), COMB_B.expect.slots);
  eq(names(TIPS_C), TIPS_C.expect.slots);
});

test('the third-island rule is structural: three in a row give two slots, never a jump-over pair', () => {
  const comp = compile(THREE_IN_A_ROW);
  eq(names(THREE_IN_A_ROW), ['0-1', '1-2']);
  ok(!comp.slotOf.has('0:2'), 'islands 0 and 2 have no slot between them');
});

test('handshake: Σp is even and the root target is exactly Σp/2 on every fixture', () => {
  for (const spec of [SQUARE_A, SQUARE_X, COMB_B, TIPS_C]) {
    const hs = handshake(compile(spec));
    const e = spec.expect;
    ok(hs.even, `${e.sumP} should be even`);
    eq(hs.sumP, e.sumP);
    eq(hs.target, e.target);
  }
});

test('degrees and roots are recomputed from the bridge state, not accumulated', () => {
  const comp = compile(SQUARE_A);
  const deg = degreesOf(comp, Uint8Array.from(SQUARE_A.expect.split));
  eq(Array.from(deg), [2, 2, 2, 2], 'the split board meets every number');
  eq(rootsOf(Uint8Array.from(SQUARE_A.expect.split)), SQUARE_A.expect.target);
});

test('boundOf: two directions cap a clue at 4, one at 2, four at 8', () => {
  const plus = {
    w: 3, h: 3,
    islands: [{ r: 0, c: 1, p: 1 }, { r: 1, c: 0, p: 1 }, { r: 1, c: 1, p: 4 }, { r: 1, c: 2, p: 1 }, { r: 2, c: 1, p: 1 }],
  };
  const comp = compile(plus);
  eq(Array.from(comp.dirs), [1, 1, 4, 1, 1]);
  eq(boundOf(comp, 2), 8);
  eq(boundOf(comp, 0), 2);
  ok(checkSpec(plus).ok, 'a legal plus-shaped spec stays legal');
});

test('validator negative class 1: a clue above the structural bound is rejected', () => {
  const r = checkSpec(OVER_BOUND);
  eq(r.ok, false);
  eq(errorKinds(r), ['bound']);
  ok(/p=5/.test(r.errors[0]) && /max 4/.test(r.errors[0]), r.errors[0]);
});

test('validator negative class 2: an odd Σp is rejected (no placement can satisfy it)', () => {
  const r = checkSpec(ODD_SUM);
  eq(r.ok, false);
  eq(errorKinds(r), ['parity']);
});

test('validator negative class 3: a bridge onto a non-joinable pair is rejected', () => {
  const comp = compile(THREE_IN_A_ROW);
  const read = toBridges(comp, [{ a: 0, b: 2, n: 1 }]);
  eq(errorKinds({ errors: read.errors }), ['illegal']);
  eq(Array.from(read.bridges), [0, 0], 'the illegal edge contributes nothing');
});

test('validator negative class 4: a board whose numbers are met but whose islands are split is rejected', () => {
  const r = checkBridges(SQUARE_A, SQUARE_A.expect.split);
  eq(r.ok, false);
  eq(errorKinds(r), ['disconnected']);
  eq(r.components, 2);
  eq(r.roots, r.target);
  eq(validate(SQUARE_A, SQUARE_A.expect.split), false);
});

test('connectivity is only reported once the numbers are met (a half-built board is not an error)', () => {
  const r = checkBridges(SQUARE_A, [1, 0, 0, 0]);
  eq(errorKinds(r), ['degree']);
  eq(r.errors.length, 4, 'one degree error per unsatisfied island');
  ok(!r.errors.some((e) => e.startsWith('disconnected')), 'no spurious connectivity complaint mid-play');
});

test('a crossing pair is reported once, and only when both bridges stand', () => {
  const both = checkBridges(TIPS_C, [1, 1]);
  eq(errorKinds(both).includes('crossing'), true);
  eq(both.errors.filter((e) => e.startsWith('crossing')).length, 1);
  const one = checkBridges(TIPS_C, [1, 0]);
  ok(!one.errors.some((e) => e.startsWith('crossing')), 'one standing bridge crosses nothing');
});

test('an over-supplied or illegal bridge count is caught at the shape level', () => {
  const comp = compile(THREE_IN_A_ROW);
  eq(errorKinds({ errors: toBridges(comp, [{ a: 0, b: 1, n: 2 }, { a: 0, b: 1, n: 1 }]).errors }), ['over2']);
  eq(errorKinds({ errors: toBridges(comp, [{ a: 0, b: 1, n: 3 }]).errors }), ['value']);
  eq(errorKinds({ errors: toBridges(comp, [1, 3]).errors }), ['value']);
  eq(errorKinds({ errors: toBridges(comp, [1]).errors }), ['shape']);
  eq(errorKinds({ errors: toBridges(comp, 'nope').errors }), ['shape']);
  eq(errorKinds({ errors: toBridges(comp, null).errors }), ['shape']);
});

test('checkSpec rejects malformed specs rather than guessing at them', () => {
  eq(errorKinds(checkSpec({ w: 0, h: 3, islands: [] })), ['shape']);
  eq(errorKinds(checkSpec({ w: 3, h: 3, islands: [{ r: 0, c: 0, p: 1 }] })), ['shape']);
  eq(errorKinds(checkSpec({ w: 3, h: 3, islands: [{ r: 0, c: 0, p: 1 }, { r: 0, c: 0, p: 2 }] })), ['duplicate']);
  eq(errorKinds(checkSpec({ w: 3, h: 3, islands: [{ r: 0, c: 0, p: 1 }, { r: 9, c: 0, p: 1 }] })), ['bounds']);
  eq(errorKinds(checkSpec({ w: 3, h: 3, islands: [{ r: 0, c: 0, p: 0 }, { r: 0, c: 2, p: 2 }] })), ['degree']);
  eq(compileSafe({ w: 1.5, h: 3, islands: [] }).comp, null, 'compileSafe reports instead of throwing');
});

test('the validator accepts the hand-derived solutions of fixtures A, X and B', () => {
  for (const spec of [SQUARE_A, SQUARE_X, COMB_B]) {
    const r = checkBridges(spec, spec.expect.solution);
    ok(r.ok, JSON.stringify(r.errors));
    eq(r.roots, spec.expect.target);
    eq(r.components, 1);
  }
});

test('fixture C is legal as a spec and unsolvable as a puzzle', () => {
  ok(checkSpec(TIPS_C).ok, 'the spec itself is fine');
  eq(validate(TIPS_C, [1, 1]), false, 'the only number-meeting board crosses');
});

test('serialize is canonical and survives JSON; validate follows it', () => {
  const text = serialize(SQUARE_A);
  eq(text, serialize({ w: 3, h: 3, islands: [SQUARE_A.islands[2], SQUARE_A.islands[1], SQUARE_A.islands[3], SQUARE_A.islands[0]] }));
  const back = deserialize(text);
  eq(validate(back, SQUARE_A.expect.solution), true);
  eq(checkSpec(back).ok, true);
  eq(names(back), SQUARE_A.expect.slots);
});

test('toEdges / dense round-trip through the same validator', () => {
  const comp = compile(COMB_B);
  const dense = Uint8Array.from(COMB_B.expect.solution);
  const edges = toEdges(comp, dense);
  eq(validate(COMB_B, edges), true);
  eq(rootsOf(dense), edges.reduce((a, e) => a + e.n, 0));
});

test('withoutClue turns one number into a wildcard and the checks step back', () => {
  const erased = withoutClue(COMB_B, COMB_B.expect.eraseIsland);
  const comp = compile(erased);
  eq(comp.wildcard, true);
  eq(handshake(comp).wildcard, true);
  ok(checkSpec(erased).ok, 'a wildcard is not a spec error');
  eq(sumP(comp), COMB_B.expect.sumP - COMB_B.islands[2].p);
  const r = checkBridges(erased, COMB_B.expect.erasedSolutions[0]);
  ok(!r.errors.some((e) => /island 2 /.test(e)), JSON.stringify(r.errors));
});

test('the model layer never mutates the spec it is handed', () => {
  const spec = clone(SQUARE_A);
  const before = JSON.stringify(spec);
  const comp = compile(spec);
  checkSpec(spec);
  checkBridges(spec, SQUARE_A.expect.split);
  serialize(spec);
  withoutClue(spec, 1);
  degreesOf(comp, Uint8Array.from(SQUARE_A.expect.solution));
  components(comp, Uint8Array.from(SQUARE_A.expect.solution));
  eq(connected(comp, Uint8Array.from(SQUARE_A.expect.solution)), true);
  eq(JSON.stringify(spec), before, 'spec untouched');
  eq(Object.isFrozen(spec), false);
  try {
    compile({ w: 3, h: 3, islands: [{ r: 0, c: 0, p: 1 }, { r: 0, c: 0, p: 1 }] });
    fail('duplicate cells should throw out of compile');
  } catch (err) {
    ok(/two islands/.test(String(err.message)), String(err.message));
  }
});

run();
