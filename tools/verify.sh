#!/usr/bin/env bash
# One-shot verification: the node suites first, and only once they are green, one real browser
# against one real server driven over CDP. Everything the script starts is gone when it exits,
# including the Chrome it started in a temp profile — which it then proves by looking.
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterization saturates the cores and, with no CDP client attached, the process will not exit on
# its own. This game is 2D canvas, so plain headless Chrome is enough.
#
#   bash tools/verify.sh                       # node suites + @boot @play @routes @save @pointer
#   SCENARIOS="pointer" ./tools/verify.sh      # one browser suite while editing the view
#   SKIP_UNIT=1 SCENARIOS="boot" ./tools/verify.sh   # browser only (what the CI browser job does)
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
CDP_PORT=${CDP_PORT:-9341}
WEB_PORT=${WEB_PORT:-5181}
BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
cd "$HERE"
FAILED=0

# --------------------------------------------------------------------------- node suites first
# A browser run on top of a broken engine proves nothing, and headless Chrome costs cores, so the
# engine has to be green before anything is launched.
if [ -z "${SKIP_UNIT:-}" ]; then
  echo "=== node suites ==="
  for f in test/*.test.mjs; do
    echo "--- $f"
    node "$f" || FAILED=1
  done
  # ------------------------------------------------------------------ documentation honesty gates
  # doctest re-derives every number README/DESIGN prints from the engine or from this repo's own
  # tools (a lying doc goes RED, and the doc gets fixed — never the assertion); sabotage then
  # breaks one file at a time and proves each assertion group really does go RED and names the
  # assertion it killed. Both are pure logic runs, so they belong here, before any browser exists.
  # Their *own size* is pinned below as well as inside the gate: rc=0 alone cannot detect a gate
  # that was narrowed by deleting 20 assertions, so a mismatched row/knife count is a failure too.
  GATES="doctest sabotage"
  DOCTEST_GROUPS_EXPECT=${DOCTEST_GROUPS_EXPECT:-17}
  DOCTEST_ROWS_EXPECT=${DOCTEST_ROWS_EXPECT:-254}
  SABOTAGE_KNIVES_EXPECT=${SABOTAGE_KNIVES_EXPECT:-16}
  for g in $GATES; do
    echo "=== $g ==="
    OUT=$(node "tools/$g.mjs" 2>&1); RC=$?
    printf '%s\n' "$OUT"
    case "$g" in
      doctest) PIN_WANT="pin: groups=$DOCTEST_GROUPS_EXPECT rows=$DOCTEST_ROWS_EXPECT" ;;
      sabotage) PIN_WANT="pin: knives=$SABOTAGE_KNIVES_EXPECT" ;;
    esac
    PIN_GOT=$(printf '%s\n' "$OUT" | grep '^pin: ' | head -1)
    if [ "$PIN_GOT" != "$PIN_WANT" ]; then
      echo "$g 的规模与 verify.sh 的钉不符：got [$PIN_GOT] want [$PIN_WANT]" >&2
      FAILED=1
    fi
    if [ $RC -ne 0 ]; then echo "$g rc=$RC（红）" >&2; FAILED=1; fi
  done
  if [ $FAILED -ne 0 ]; then
    echo "=== node suites failed; browser not started ===" >&2
    exit $FAILED
  fi
fi

if ! command -v "$CHROME" >/dev/null 2>&1 && [ ! -x "$CHROME" ]; then
  echo "no Chrome found; set CHROME_BIN" >&2; exit 2;
fi

# --------------------------------------------------------------------------- one browser, one server
UDD=$(mktemp -d)
TMP=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir=$UDD \
  --window-size=900,860 --no-first-run --no-default-browser-check about:blank >/tmp/hashi-chrome.log 2>&1 &
CPID=$!
node "$HERE/server.cjs" $WEB_PORT >/tmp/hashi-server.log 2>&1 &
SPID=$!
cleanup() {
  kill -9 $CPID $SPID 2>/dev/null
  wait $CPID 2>/dev/null
  wait $SPID 2>/dev/null
  rm -rf $UDD $TMP
}
trap cleanup EXIT
# Watchdog redirects its fds: a background subshell inherits the script's stdout, and if this runs
# inside a pipeline it would hold the write end open for the full timeout and stall the consumer
# long after the tests finished.
( sleep ${WD_TIMEOUT:-420}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools noticeably later than a warm profile, so wait on the
# endpoints rather than guessing a sleep duration.
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP_PORT" >&2; exit 3; }
for i in $(seq 1 40); do
  curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "$BASE" >/dev/null 2>&1 || {
  echo "static server never answered on $BASE" >&2; exit 4; }

export CDP_PORT
export BASE_URL=$BASE
node tools/playtest.mjs open "$BASE" | head -3
# The pool is tens of kilobytes of measurement and the shell resolves a route before it reports a
# state, so wait on window.hashi rather than on a timer.
BOOT=""
for i in $(seq 1 60); do
  BOOT=$(node tools/playtest.mjs eval "window.hashi?window.hashi.state.id:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot puzzle: $BOOT"
[ "$BOOT" = "nope" ] && { echo "window.hashi never appeared at $BASE" >&2; exit 5; }

TOTAL=0
for s in ${SCENARIOS:-boot play routes save pointer}; do
  echo "=== @$s ==="
  node tools/playtest.mjs eval "@$s" nonav > "$TMP/$s.out" 2>&1
  # The eval output is JSON *plus* the captured console, so brace-count the first object rather
  # than trusting the tail of the stream.
  SUM=$(python3 - "$TMP/$s.out" <<'PY'
import sys, json
raw = open(sys.argv[1], encoding='utf-8', errors='replace').read()
start = raw.find("{")
if start < 0:
    print("NO RESULT", raw[-300:]); sys.exit(0)
depth = 0
for i in range(start, len(raw)):
    if raw[i] == "{":
        depth += 1
    elif raw[i] == "}":
        depth -= 1
        if depth == 0:
            try:
                d = json.loads(raw[start:i + 1])
            except Exception as e:
                print("BAD JSON", e, raw[start:start + 200]); sys.exit(0)
            break
rows = d.get("rows", [])
print("rows:", len(rows), "fail:", json.dumps(d.get("fail", []), ensure_ascii=False))
for r in rows:
    if not r["pass"]:
        print("  FAIL", r["test"], json.dumps(r["detail"], ensure_ascii=False)[:240])
PY
)
  printf '%s\n' "$SUM"
  case "$SUM" in
    *"fail: []"*) ;;
    *) FAILED=1 ;;
  esac
  N=$(printf '%s' "$SUM" | awk '{ for (i = 1; i < NF; i++) if ($i == "rows:") print $(i + 1) }' | tr -d '\n')
  TOTAL=$((TOTAL + ${N:-0}))
  node tools/playtest.mjs shot "/tmp/hashi-$s.png" >/dev/null 2>&1
done
echo "=== browser assertions: $TOTAL ==="

echo "=== console ==="
node tools/playtest.mjs logs

# The script owns exactly one Chrome, so it says so out loud when it cannot prove it.
kill $WD 2>/dev/null
wait $WD 2>/dev/null
kill $CPID $SPID 2>/dev/null
wait $CPID 2>/dev/null
wait $SPID 2>/dev/null
for i in $(seq 1 20); do
  pgrep -f "user-data-dir=$UDD" >/dev/null || break
  sleep 0.25
done
if pgrep -f "user-data-dir=$UDD" >/dev/null 2>&1; then
  echo "chrome did not exit" >&2; FAILED=1
else
  echo "=== chrome exited, temp profile gone ==="
fi
rm -rf $UDD $TMP
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
