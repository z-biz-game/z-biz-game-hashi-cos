// Tiny zero-dep test harness: every tools/../test/*.mjs suite prints the same shape so
// verify.sh can aggregate them.

const rows = [];

export function test(name, fn) {
  try {
    fn();
    rows.push({ test: name, pass: true });
  } catch (err) {
    rows.push({ test: name, pass: false, detail: String((err && err.message) || err) });
  }
}

export function ok(cond, msg = 'expected truthy') {
  if (!cond) throw new Error(msg);
}

// Typed-array aware equality. The engine hands back `Uint8Array` slot domains and degree tables,
// and `JSON.stringify(new Uint8Array([2,2,2,2]))` is `{"0":2,"1":2,"2":2,"3":2}` — an *object*
// form — so a plain-array expectation written by hand could never match it. Comparing element by
// element keeps the assertion exactly as strict (same length, same numbers, and a typed array
// still never equals a string or an object) while letting the tests state what they mean.
function shape(v) {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v);
  return v;
}

export function eq(a, b, msg = 'not equal') {
  const sa = JSON.stringify(shape(a));
  const sb = JSON.stringify(shape(b));
  if (sa !== sb) throw new Error(`${msg}\n    got      ${sa}\n    expected ${sb}`);
}

export function fail(msg) {
  throw new Error(msg);
}

export function run() {
  const bad = rows.filter((r) => !r.pass);
  for (const r of rows) console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.test}${r.pass ? '' : '\n         ' + r.detail}`);
  console.log(`rows: ${rows.length} fail: ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
}
