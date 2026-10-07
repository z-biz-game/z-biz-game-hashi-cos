// 文档是被断言的面：README / DESIGN 里印出去的每一个「现值」都必须等于代码或闸的现在值。
//
// 为什么要有这个文件：这一仓的文档抄了一整套可以现算的数 —— 四档的 4×4·4-5 岛·深度 0、出厂 32 关、
// 251 个擦线索变体（33 / 54 / 164，其中 31 个不再唯一）、§5 那张 balance 实测表（accept / gaveUp /
// unique / 解数>1 / of cand. / maxNodes / maxGuess 七列逐位可复现）、规则表 7 条、握手引理 Σp/2、
// 端口 5181/9341、npm test 的 101 行断言、屏上四个数与三档结算。这些数由 7 个 node 测试、
// test/balance.mjs 与 js/core/* 现场产出，但**没有任何命令**守着"文档抄的那一行 == 现在的这一行"。
// 散文可以一直抄下去，直到某天代码改了字、文档还在引用上一个世界的数。
//
// 五条规矩（照 z-biz-game-kurotto-cos / z-biz-game-nurikabe-cos 的 doctest 机制走，不自创一套）：
//   1. 每一条等式都配一条「解析到几行」的反空转断言 —— 正则没命中不是绿，是红；
//   2. 只比现值，不复测读数：ms / 墙钟 / 浏览器段那些本机量只以"文档自己写明这一列会漂"的关系出现
//      （D14/D15），绝不重新计时，也绝不把新测的毫秒写回文档；
//   3. **代码是基准**：这里从不把文档的值当期望值喂进去，全部现场从 js/core/* 或仓自己的工具算出来
//      再对表；文档说谎就改文档，绝不为了绿而弱化断言；
//   4. 引用 `file:NN` / `file:NN-MM` 的每一条都跑一次范围与锚点检查 —— 代码改一个字，行号就漂；
//   5. 本闸自己发出的组数与项数都自钉（D16）—— 加一项、删一项都得同时改这里的钉，否则红。
//
//   子集运行：ONLY=D5,D8 node tools/doctest.mjs 只跑点名的组，其余组**逐组打 NOTE**，
//   并在结尾显式声明这不是全量运行（自钉那一组在子集运行里不成立）—— 绝不静默跳过。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOTS, TIERS_META } from '../js/data/lots.js';
import { TIERS as GEN_TIERS } from '../js/core/make.js';
import { RULES, reason } from '../js/core/logic.js';
import { compile, handshake, checkBridges, withoutClue, serialize, deserialize } from '../js/core/model.js';
import { countSolutions } from '../js/core/count.js';
import * as FX from '../test/fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
const emitted = new Set();
const skipped = [];
let rows = 0;
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim().replace(/^D/i, 'D')).filter(Boolean);
const active = (label) => {
  const m = label.match(/^D\d+/);
  if (!m) throw new Error(`断言标签必须以 D<N> 开头：${label}`);
  if (!ONLY.length || ONLY.includes(m[0])) return true;
  if (!skipped.includes(m[0])) { skipped.push(m[0]); console.log(`  NOTE ${m[0]} 及其后未列入 ONLY 的组不执行（子集运行）`); }
  return false;
};
const ok = (cond, label, detail) => {
  if (!active(label)) return;
  rows++;
  emitted.add(label.match(/^D\d+/)[0]);
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
// 文档里 × 与 x、全角空格、反引号是排版差异而不是数值差异；除此之外逐字比
const norm = (s) => s.replace(/`/g, '').replace(/\s+/g, '').replace(/×/g, 'x').replace(/⇒|→/g, '->');

const README = read('README.md');
const DESIGN = read('DESIGN.md');
const DOCS = README + '\n' + DESIGN;
const CI = read('.github/workflows/ci.yml');
const VERIFY = read('tools/verify.sh');
const PKG = JSON.parse(read('package.json'));
const MAKE_SRC = read('js/core/make.js');
const COUNT_SRC = read('js/core/count.js');
const LOGIC_SRC = read('js/core/logic.js');
const MODEL_SRC = read('js/core/model.js');
const GAME_SRC = read('js/core/game.js');
const STORE_SRC = read('js/core/storage.js');
const BAL_SRC = read('test/balance.mjs');
const BAKE_SRC = read('tools/bake.mjs');
const MAIN_SRC = read('js/main.js');
const HTML = read('index.html');

const run = (cmd, env, ms) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// 现值来源是**仓自己的工具**：balance 是纯逻辑跑（默认 8 种子 × 4 档），秒级，不开浏览器
const BAL = run('node test/balance.mjs', {}, 180000);
const SUITES = {};
for (const f of ['count', 'game', 'library', 'logic', 'model', 'rng', 'storage']) SUITES[f] = run(`node test/${f}.test.mjs`, {}, 180000);

// ---- D1 档位表：README 那四行「shoal 浅滩 4×4·4-5 岛·深度 0」逐格 == TIERS_META 现值 ----
const tierRows = [...README.matchAll(/`(shoal|sound|archipelago|ocean) ([^`]+)` (\d+)×(\d+)·(\d+)-(\d+) 岛·深度 (\d+)/g)];
ok(tierRows.length === TIERS_META.length, `D1a README 题库那一行解析到 ${TIERS_META.length} 档（解析不到就是句式改了）`,
  `解析 ${tierRows.length} 行 vs TIERS_META ${TIERS_META.length} 档`);
for (const t of TIERS_META) {
  const row = tierRows.find((m) => m[1] === t.key);
  ok(!!row, `D1 ${t.key} 那一档在 README 的题库行里`, row ? `| ${row[1]} ${row[2]} |` : '文档里没有这一档');
  if (!row) continue;
  ok(row[2] === t.label, `D1 ${t.key} 的中文名 ${t.label} == TIERS_META 现值`, `文档 ${row[2]} vs 代码 ${t.label}`);
  ok(+row[3] === (row[3] === row[4] ? LOTS.find((l) => l.tier === t.key).spec.w : -1) && +row[4] === LOTS.find((l) => l.tier === t.key).spec.h,
    `D1 ${t.key} 的边长 ${row[3]}×${row[4]} == 出厂盘现量`, `文档 ${row[3]}×${row[4]} vs 代码 ${LOTS.find((l) => l.tier === t.key).spec.w}×${LOTS.find((l) => l.tier === t.key).spec.h}`);
  const st = { n: 0, islMin: Infinity, islMax: 0, kMin: Infinity, kMax: -Infinity };
  for (const l of LOTS.filter((x) => x.tier === t.key)) { st.n++; st.islMin = Math.min(st.islMin, l.islands); st.islMax = Math.max(st.islMax, l.islands); st.kMin = Math.min(st.kMin, l.k); st.kMax = Math.max(st.kMax, l.k); }
  ok(+row[5] === t.islMin && +row[6] === t.islMax && +row[5] === st.islMin && +row[6] === st.islMax,
    `D1 ${t.key} 的岛数区间 ${row[5]}-${row[6]} == TIERS_META 与出厂池现量`, `文档 ${row[5]}-${row[6]} vs META ${t.islMin}-${t.islMax} vs 现量 ${st.islMin}-${st.islMax}`);
  ok(+row[7] === st.kMin && +row[7] === st.kMax && +row[7] === t.min && +row[7] === t.max,
    `D1 ${t.key} 的深度 ${row[7]} == 出厂池量出的 ${st.kMin}-${st.kMax}（TIERS_META ${t.min}-${t.max}）`,
    `文档 ${row[7]} vs 现量 ${st.kMin}-${st.kMax}`);
  ok(st.n === 8, `D1 ${t.key} 出厂 ${st.n} 关 == README「各 8 关」`, `${st.n} 关`);
}
const each8 = (README.match(/各 8 关/) || [])[0];
ok(!!each8 && LOTS.length === 32 && TIERS_META.length === 4, `D1b 「各 8 关」那句还在，且 4 档 × 8 == js/data/lots.js 的 ${LOTS.length} 行`,
  `lots ${LOTS.length} · 4×8=${4 * 8}`);
const doc32 = [...DOCS.matchAll(/(\d+) 关|\*\*32 行\*\*|把 32 行/g)].map((m) => m[1]).filter(Boolean).map(Number);
const poolClaims = [...DOCS.matchAll(/(?:从这 |只从 )?(\d+) 关里挑|32 行|(\d+) 关做/g)].map((m) => +(m[1] || m[2])).filter(Boolean);
ok(poolClaims.length >= 2 && poolClaims.every((x) => x === LOTS.length), `D1c 文档所有「从 32 关里挑 / 32 行 / 对 32 关做」都等于 lots.js 的 ${LOTS.length}（解析到 ${poolClaims.length} 处）`,
  poolClaims.join('/'));

// ---- D2 规则表：DESIGN §4 那 7 行逐字 == logic.js 的 RULES；「N 条规则」全部现量 ----
const ruleSection = DESIGN.slice(DESIGN.indexOf('## 4 推理规则集'), DESIGN.indexOf('三条刻意的决定'));
const ruleRows = [...ruleSection.matchAll(/^\| `(R-[a-z]+)` \| ([^|]+?) \|$/gm)];
ok(ruleRows.length === RULES.length, `D2a DESIGN §4 的规则表解析到 ${RULES.length} 行（解析不到就是表格形状改了）`,
  `解析 ${ruleRows.length} 行 vs RULES ${RULES.length} 条`);
RULES.forEach((R, i) => {
  const row = ruleRows[i];
  ok(!!row && row[1] === R.key, `D2 ${i + 1} 条的 key ${R.key} 与规则表现值同序`, row ? `文档 ${row[1]} vs 代码 ${R.key}` : '解析不到');
  ok(!!row && norm(row[2]) === norm(R.text), `D2 ${R.key} 的原文逐字 == logic.js:30 的 RULES`,
    row ? `文档「${row[2].trim().slice(0, 26)}…」vs 代码「${R.text.slice(0, 26)}…」` : '解析不到');
});
const ruleCount = [...DOCS.matchAll(/这 ?(\d+) 条规则|(\d+) 条规则见/g)].map((m) => +(m[1] || m[2]));
ok(ruleCount.length >= 3 && ruleCount.every((x) => x === RULES.length),
  `D2c 文档里所有「这 N 条规则 / N 条规则见 §4」都等于 ${RULES.length}（解析到 ${ruleCount.length} 处：${ruleCount.join('/')}）`, RULES.length + ' 条现值');
const legalityRows = [...DESIGN.slice(DESIGN.indexOf('## 1 规则'), DESIGN.indexOf('规则 1/2/4')).matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)];
ok(legalityRows.length === 4, `D2d DESIGN §1 的合法充要条件编号项解析到 4 条（桥图四条规则）`, `${legalityRows.length} 条`);
const fourClaims = [...DOCS.matchAll(/(四条规则全满足|充要条件是四条|四道复核)/g)].map((m) => m[1]);
ok(fourClaims.length >= 3 && new Set(fourClaims).size === 3, `D2e 文档里「四条规则全满足 / 充要条件是四条 / 四道复核」三句都在（缺一就是文档只改了一半）`,
  fourClaims.join(' · '));
const fourRechecks = (README.match(/四道复核\s*\n?（([^）]+)）/) || [])[1] || '';
const recheckNames = fourRechecks.split('、').map((s) => norm(s).replace(/[：:].*/, '')).filter(Boolean);
ok(recheckNames.length === 4 && /Four re-checks/.test(BAKE_SRC), `D2f README 的「四道复核」列了 4 个名字，且 bake.mjs 自己写的就是 "Four re-checks"`,
  `${recheckNames.join('/')} · bake=${/Four re-checks/.test(BAKE_SRC)}`);

// ---- D3 手工 fixture：DESIGN §3 表与 README 的连通性锚点，全部现场重数（含 naiveCounts 对账）----
const fixSection = DESIGN.slice(DESIGN.indexOf('| fixture | 盘 |'), DESIGN.indexOf('## 4'));
const fixRows = [...fixSection.matchAll(/^\| `([A-Z_]+)` \| ([^|]+) \| ([^|]+) \|/gm)];
ok(fixRows.length === 4, `D3a DESIGN §3 的 fixture 表解析到 4 行（每行一个手工盘；解析不到就是表格形状改了）`,
  `${fixRows.length} 行：${fixRows.map((r) => r[1]).join('/')}`);
// 解向量的格式化。sol 可能是 undefined（fixture 被改坏到无解时，上面那些 ok 的 detail 会先算参数）：
// 这里给一个占位而不是抛异常 —— 无解本身就是那一条要红的理由，闸不许在印判决之前先崩掉。
const vecOf = (comp, sol) => comp.slots.map((s) => (sol ? sol[s.i] ?? 0 : '—'));
const asSorted = (list) => list.map((v) => v.join(',')).sort().join(' ; ');
// 方括号里那份数字列：空白与逗号种类是排版而不是数值，抓出来归一化后再比
const bracket = (str, kw) => { const m = str.match(new RegExp(kw + '[\\s\\S]{0,10}?\\[([\\d\\s\uff0c,]+)\\]')); return m ? m[1].replace(/\s+/g, '').replace(/\uff0c/g, ',') : null; };
// 文档对每一份手工盘写了什么，逐份钉死：p 数组有的写、有的不写（TIPS_C 只写"十字四端"），
// 写了的必须逐字对得上，没写的这一格必须真的没写 —— 两种情况都不许静默通过。
const FIX_CLAIM = { SQUARE_A: { p: true }, SQUARE_X: { p: true }, COMB_B: { p: true }, TIPS_C: { p: false } };
let prevGrid = null;
for (const m of fixRows) {
  const [, name, board, verdict] = m;
  const spec = FX[name];
  ok(!!spec, `D3 ${name} 在 test/fixture.mjs 里真的存在`, spec ? '在' : 'fixture 没有这一份手工盘');
  if (!spec) { continue; }
  const comp = compile(spec);
  const vN = verdict.replace(/[，]/g, ','); // 全角/半角逗号是排版差异，不是数值差异
  const gm = board.match(/(\d+)×(\d+)/);
  const grid = gm ? [+gm[1], +gm[2]] : (/同上/.test(board) ? prevGrid : null);
  prevGrid = grid;
  ok(!!grid && grid[0] === spec.w && grid[1] === spec.h, `D3 ${name} 盘面 ${grid ? `${grid[0]}×${grid[1]}` : '解析不到'} == fixture 现值 ${spec.w}×${spec.h}`,
    `文档 ${board.trim().slice(0, 20)} vs 代码 ${spec.w}×${spec.h}`);
  const pm = board.match(/`p=\[([\d,]+)\]`/);
  if (FIX_CLAIM[name].p) {
    ok(!!pm && pm[1] === comp.p.join(','), `D3 ${name} 的 p=[${pm ? pm[1] : '解析不到'}] == fixture 现值 [${comp.p}]`, `文档 ${pm ? pm[1] : '无'} vs 代码 [${comp.p}]`);
  } else {
    ok(!pm && new RegExp(`${comp.n} 端|四端|十字`).test(board) && comp.n === 4,
      `D3 ${name} 那一格不写 p（只写「十字四端」），现量正好 ${comp.n} 座岛`, `文档 ${board.trim()} · 岛数 ${comp.n}`);
  }
  const on = countSolutions(spec, 99);
  const off = countSolutions(spec, 99, { connected: false });
  const nv = FX.naiveCounts(spec);
  const nvo = FX.naiveCounts(spec, { connected: false });
  ok(on.count === nv.count && asSorted(on.solutions.map((s) => vecOf(comp, s))) === asSorted(nv.solutions)
    && off.count === nvo.count && asSorted(off.solutions.map((s) => vecOf(comp, s))) === asSorted(nvo.solutions),
    `D3 ${name} 计数器与不共享代码的 3^槽 全枚举对账（解数与解集都逐位）`, `count ${on.count}/${nv.count} · noconn ${off.count}/${nvo.count}`);
  if (name === 'SQUARE_A') {
    const a1 = verdict.match(/带连通 \*\*(\d+) 个\*\*解/);
    const a3 = verdict.match(/关掉连通 \*\*(\d+) 个\*\*/);
    ok(!!a1 && +a1[1] === on.count && on.count === 1, `D3 SQUARE_A「带连通 ${a1 ? a1[1] : '?'} 个解」== 现量 ${on.count}`, `现量 ${on.count} · ${vecOf(comp, on.solutions[0]).join(',')}`);
    ok(!!a3 && +a3[1] === off.count && off.count === 3, `D3 SQUARE_A「关掉连通 ${a3 ? a3[1] : '?'} 个」== 现量 ${off.count}`, `现量 ${off.count}`);
    ok(handshake(comp).target === 4 && /Σp\/2=4/.test(DOCS), `D3 SQUARE_A 的 Σp/2 现量 4，且文档写的就是 4`, `target ${handshake(comp).target}`);
    const docThree = (README.match(/手工推出三条解 `\[([\d,]+)\]`、`\[([\d,]+)\]`、`\[([\d,]+)\]`/) || []).slice(1).map((s) => s.split(',').map(Number));
    ok(docThree.length === 3 && asSorted(docThree) === asSorted(off.solutions.map((s) => vecOf(comp, s))),
      `D3 README 列的三条解与关掉连通后的现量解集逐位相同`, `文档 ${docThree.map((v) => v.join(',')).join(' / ')} vs 现量 ${asSorted(off.solutions.map((s) => vecOf(comp, s)))}`);
    ok(/`count` 返回 3/.test(README) && off.count === 3, `D3 README「忽略连通性的实现必须在这里说谎（count 返回 3）」现量成立`, `现量 ${off.count}`);
  }
  if (name === 'SQUARE_X') {
    const x = bracket(vN, '\u552f\u4e00\u89e3');
    const xr = (vN.match(/(\d+)\s*\u6839/) || [])[1];
    ok(!!x && !!xr, `D3 SQUARE_X 那一格解析出「唯一解 […]」与「N 根」两格`, verdict.trim().slice(0, 40));
    ok(!!x && on.count === 1 && x === vecOf(comp, on.solutions[0]).join(','),
      `D3 SQUARE_X 唯一解 [${x || '?'}] == 计数器现量`, `文档 [${x || '?'}] vs 现量 [${on.count === 1 ? vecOf(comp, on.solutions[0]).join(',') : on.count + ' 个解'}]`);
    ok(!!xr && +xr === handshake(comp).target && rootsOf(spec, on.solutions[0]) === +xr,
      `D3 SQUARE_X 的「${xr || '?'} 根」== \u03a3p/2 与解里现数的根数`, `文档 ${xr || '?'} vs target ${handshake(comp).target}`);
    ok(/3 号岛 `p=2`/.test(DOCS) && comp.p[3] === 2 && dirsOf(comp, 3) === 2 && maxIncident(comp, on.solutions[0], 3) === 2,
      `D3 那份反例成立：SQUARE_X 的 3 号岛 p=${comp.p[3]}、方向数 ${dirsOf(comp, 3)}，现量解里它那一根其实是 ${maxIncident(comp, on.solutions[0], 3)} 根`,
      `策略书那条「数字 == 方向数 \u21d2 全单桥」在现量上是错的（文档两处都这么写）`);
  }
  if (name === 'COMB_B') {
    const e = verdict.match(/擦掉 (\d+) 号岛的数字后剩 \*\*(\d+) 个\*\*连通解/);
    ok(!!e, `D3 COMB_B 那一格解析出「擦掉 N 号岛 → M 个连通解」`, verdict.trim().slice(0, 46));
    const erased = countSolutions(withoutClue(spec, e ? +e[1] : 0), 99);
    ok(!!e && erased.count === +e[2] && erased.count === 2, `D3 COMB_B 擦掉 ${e ? e[1] : '?'} 号岛现量 ${erased.count} 个连通解 == 文档 ${e ? e[2] : '?'}`, `现量 ${erased.count}`);
    const b = bracket(vN, '唯一解');
    ok(!!b && on.count === 1 && b === vecOf(comp, on.solutions[0]).join(','),
      `D3 COMB_B 唯一解 [${b || '?'}] == 计数器现量`, `现量 ${on.count === 1 ? vecOf(comp, on.solutions[0]).join(',') : on.count + ' 个解'}`);
  }
  if (name === 'TIPS_C') {
    const z = verdict.match(/\*\*(\d+) 个\*\*解/);
    ok(!!z && +z[1] === 0 && on.count === 0, `D3 TIPS_C「${z ? z[1] : '?'} 个解」== 计数器现量 ${on.count}`, `现量 ${on.count} · 文档 ${z ? z[1] : '?'}`);
  }
}

// ---- D4 计数器与求解器的现值：默认 limit / nodes / deadline / 层数上限 / 重启预算 / 出厂预算 ----
ok(/export function countSolutions\(spec, limit = 2, opts = \{\}\)/.test(COUNT_SRC), `D4a countSolutions 的默认 limit 是 2（"数到 2 就停"）`,
  COUNT_SRC.match(/export function countSolutions[^{]*/)?.[0] || '解析不到');
const nodesDefault = +(COUNT_SRC.match(/const maxNodes = opts\.nodes \|\| (\d+)/) || [])[1];
ok(nodesDefault === 300000 && /默认 300 000/.test(DESIGN), `D4b 计数器节点上限现值 ${nodesDefault} == DESIGN 的「默认 300 000」`, `代码 ${nodesDefault}`);
const deadlineEvery = +(COUNT_SRC.match(/\(nodes & (\d+)\) === 0/) || [])[1];
ok(deadlineEvery === 8191 && /每 8191 个节点/.test(DESIGN), `D4c 撞钟间隔现值 ${deadlineEvery} == DESIGN 的「每 8191 个节点看一次钟」`, `代码 ${deadlineEvery}`);
const depthCap = +(LOGIC_SRC.match(/opts\.maxDepth === undefined \? (\d+)/) || [])[1];
const reasonCap = +(LOGIC_SRC.match(/const cap = opts\.nodes \|\| (\d+)/) || [])[1];
ok(depthCap === 4 && /默认层数上限是 4/.test(DESIGN) && /上限是 4/.test(README), `D4d reason() 的层数上限现值 ${depthCap} == 两份文档的「上限 4」`, `代码 ${depthCap}`);
ok(reasonCap === 60000 && /节点上限 60 000/.test(DESIGN), `D4e reason() 节点上限现值 ${reasonCap} == DESIGN 的「60 000」`, `代码 ${reasonCap}`);
ok(/上限三件套/.test(DESIGN) && /\bnodes\b/.test(COUNT_SRC) && /deadline/.test(COUNT_SRC) && /limit/.test(COUNT_SRC),
  'D4f DESIGN「上限三件套」的三条在 count.js 里都是代码（nodes / deadline / limit）', '三件都在');
const restarts = GEN_TIERS.map((t) => `${t.key}:${t.restarts}`).join(' ');
ok(GEN_TIERS.filter((t) => t.restarts === 40).length === 3 && GEN_TIERS.find((t) => t.key === 'ocean').restarts === 60,
  `D4g 生成器重启预算现值 前三档 40 / ocean 60 == 文档「40/60 次重启」`, restarts);
const perTier = +(BAKE_SRC.match(/const PER_TIER = Number\(process\.env\.PER_TIER \|\| (\d+)\)/) || [])[1];
const seedLimitMul = +(BAKE_SRC.match(/PER_TIER \* (\d+)/) || [])[1];
ok(perTier === 8 && seedLimitMul === 60, `D4h bake 的 PER_TIER 默认 ${perTier} 与 ×${seedLimitMul} == README「SEED_LIMIT = PER_TIER × 60」`, `PER_TIER ${perTier} · 乘数 ${seedLimitMul}`);
ok(/SEED_LIMIT = PER_TIER × 60 = 480/.test(DESIGN) && perTier * seedLimitMul === 480, `D4i DESIGN 的「= 480」== 现算 ${perTier}×${seedLimitMul}`, `${perTier * seedLimitMul}`);
const seedsDefault = +(BAL_SRC.match(/process\.env\.SEEDS \|\| (\d+)/) || [])[1];
const seedStrat = (BAL_SRC.match(/`balance-[^`]*`/) || ['解析不到'])[0];
ok(seedsDefault === 8 && /默认 8 个种子/.test(README) && /SEEDS=8（默认）/.test(DESIGN)
  && /`balance-\$\{tier\}-\$\{s\}`/.test(DESIGN) && seedStrat !== '解析不到',
  `D4j balance 的默认种子数 ${seedsDefault} 与默认种子策略 balance-\${tier}-\${s} 都等于两份文档抄的现值`,
  `代码 seeds=${seedsDefault} · seed=${seedStrat}`);

// ---- D5 balance 那一张 §5 实测表：整行从 balance 现场跑出来再逐格对（七个结构列一个都不放过）----
ok(BAL.rc === 0, `D5a balance 现场跑就是绿的（rc=${BAL.rc}）—— 不绿的读数不是现值`, `rc=${BAL.rc}`);
const balHeader = BAL.out.split('\n').find((l) => /^tier\s+grid/.test(l)) || '';
const docHeader = DESIGN.split('\n').find((l) => /^tier\s+grid/.test(l)) || '';
ok(!!docHeader && norm(docHeader) === norm(balHeader), `D5b §5 表的列头与 balance 现场打印的列头同一`, balHeader.slice(0, 46) + '…');
const CELLS = 15;
const parseRow = (l) => { const p = l.trim().split(/\s+/); return p.length === CELLS ? p : null; };
const balRows = {};
for (const l of BAL.out.split('\n')) { const p = parseRow(l); if (p && /^(shoal|sound|archipelago|ocean)$/.test(p[0])) balRows[p[0]] = p; }
ok(Object.keys(balRows).length === 4, `D5c balance 现场表解析到 4 行（每行 15 格；解析不到就是列数或格式换了）`, `${Object.keys(balRows).length} 行 · ${Object.keys(balRows).join('/')}`);
const docBalRows = {};
for (const l of DESIGN.split('\n')) { const p = parseRow(l); if (p && /^(shoal|sound|archipelago|ocean)$/.test(p[0])) docBalRows[p[0]] = p; }
ok(Object.keys(docBalRows).length === 4, `D5d DESIGN §5 的表解析到 4 行`, `${Object.keys(docBalRows).length} 行`);
const STRUCT = [5, 6, 7, 8, 9, 10, 13, 14];
const STRUCT_NAME = ['seeds', 'accept', 'gaveUp', 'unique', '解数>1', 'of cand.', 'maxNodes', 'maxGuess'];
for (const key of ['shoal', 'sound', 'archipelago', 'ocean']) {
  const d = docBalRows[key], b = balRows[key], g = GEN_TIERS.find((t) => t.key === key);
  ok(!!d && !!b, `D5 ${key} 在文档表与 balance 现场表里都在`, `doc=${!!d} bal=${!!b}`);
  if (!d || !b) continue;
  const band = d[2].split('-').map(Number);
  const depth = d[4].split('-').map(Number);
  ok(d[1] === b[1] && d[1] === `${g.w}×${g.h}` && band.length === 2 && band[0] === g.islands[0] && band[1] === g.islands[1]
    && d[3] === b[3] && d[4] === b[4] && depth[0] === g.k[0] && depth[1] === g.k[1],
    `D5 ${key} 的形状三格（${d[1]} · ${d[2]} 岛 · ${d[4]}）== balance 现跑与 make.js 的档位窗口`,
    `文档 ${d[1]}/${d[2]}/${d[4]} vs 现跑 ${b[1]}/${b[2]}/${b[4]} vs TIERS ${g.w}×${g.h}/${g.islands}/k${g.k}`);
  for (let i = 0; i < STRUCT.length; i++) {
    const c = STRUCT[i];
    ok(d[c] === b[c], `D5 ${key} 的结构列 ${STRUCT_NAME[i]} 文档 ${d[c]} == balance 现场 ${b[c]}（逐位可复现）`, `文档 ${d[c]} vs 现跑 ${b[c]}`);
  }
  const docDrop = (DESIGN.match(new RegExp(`^${key}: dropped — (.+)$`, 'm')) || [])[1] || '';
  const balDrop = ((BAL.out.match(new RegExp(`^${key}: dropped — (.+)$`, 'm')) || [])[1] || '').trim();
  ok(docDrop.trim() !== '' && docDrop.trim() === balDrop, `D5 ${key} 的 dropped 明细「${docDrop.trim() || '未解析'}」== balance 现场`, `现跑 ${balDrop || '未解析'}`);
}
const oceanU = +((balRows.ocean || [])[8] ?? -1);
const oceanOff = +((BAL.out.match(/^ocean: dropped — offBand:(\d+)/m) || [])[1] || 0);
ok(/ocean` (\d+) 个唯一候选里\s*\n?\s*(\d+) 个 offBand/.test(README), 'D5e README「ocean 274 个唯一候选里 272 个 offBand」解析到了两格', (README.match(/ocean` (\d+) 个唯一候选/) || [])[1] || '解析不到');
const rOcean = README.match(/ocean` (\d+) 个唯一候选里\s*\n?\s*(\d+) 个 offBand/);
ok(!!rOcean && +rOcean[1] === oceanU && +rOcean[2] === oceanOff, `D5f README 抄的 ocean unique/offBand 等于 balance 现跑`, `文档 ${rOcean?.[1]}/${rOcean?.[2]} vs 现跑 ${oceanU}/${oceanOff}`);
const acceptDoc = (README.match(/`shoal` (\d+)\/\d+ 出、`sound` (\d+)\/\d+、`archipelago` (\d+)\/8、`ocean` 只有 \*\*(\d+)\/8/) || []).slice(1).map(Number);
ok(acceptDoc.length === 4 && acceptDoc[0] === +balRows.shoal[6] && acceptDoc[1] === +balRows.sound[6]
  && acceptDoc[2] === +balRows.archipelago[6] && acceptDoc[3] === +balRows.ocean[6],
  `D5g README 的「8/8、8/8、6/8、2/8」四格逐位 == balance 现跑 accept`, `文档 ${acceptDoc.join('/')} vs 现跑 ${['shoal', 'sound', 'archipelago', 'ocean'].map((k) => balRows[k]?.[6]).join('/')}`);
ok(+balRows.ocean[7] === 6 && /6 个种子把 60 次重启全用光/.test(README) && GEN_TIERS.find((t) => t.key === 'ocean').restarts === 60,
  `D5h README「6 个种子把 60 次重启全用光」的 gaveUp 与 restarts 两格都是现值`, `gaveUp ${balRows.ocean?.[7]} · restarts ${GEN_TIERS.find((t) => t.key === 'ocean').restarts}`);

// ---- D6 出厂池实测：251 个擦线索变体、33/54/164、31 个不再唯一、Σp/2 与深度逐行重算 ----
const sweep = {};
for (const row of LOTS) {
  const comp = compile(row.spec);
  const st = (sweep[row.tier] = sweep[row.tier] || { v: 0, multi: 0 });
  for (let i = 0; i < comp.n; i++) {
    const cs = countSolutions(withoutClue(row.spec, i), 2);
    st.v++;
    if (cs.count > 1) st.multi++;
  }
}
const totalV = Object.values(sweep).reduce((a, x) => a + x.v, 0);
const totalM = Object.values(sweep).reduce((a, x) => a + x.multi, 0);
const upper = (sweep.archipelago.v + sweep.ocean.v);
const upperM = sweep.archipelago.multi + sweep.ocean.multi;
const doc251 = [...DOCS.matchAll(/共[\s\S]{0,12}?\*\*(\d+) 个变体\*\*|(\d+) 个擦线索变体/g)].map((m) => +(m[1] || m[2])).filter(Boolean);
ok(doc251.length >= 3 && doc251.every((x) => x === totalV), `D6a 文档所有「251 个变体」都等于现扫 ${totalV}（解析到 ${doc251.length} 处：${doc251.join('/')}）`, `现扫 ${totalV}`);
const docShoal = +(README.match(/`shoal` (\d+) 个/) || [])[1];
const docSound = +(README.match(/`sound` (\d+) 个/) || [])[1];
ok(docShoal === 33 && docShoal === sweep.shoal.v, `D6b shoal 擦线索变体文档 ${docShoal ?? '未解析'} == 现量 ${sweep.shoal.v}`, `现量 ${sweep.shoal.v}`);
ok(docSound === 54 && docSound === sweep.sound.v, `D6c sound 擦线索变体文档 ${docSound ?? '未解析'} == 现量 ${sweep.sound.v}`, `现量 ${sweep.sound.v}`);
const upperDocs = [...DOCS.matchAll(/上两档 (\d+) 个变体|`archipelago` \+ `ocean` 的 (\d+) 个变体/g)].map((m) => +(m[1] || m[2]));
ok(upperDocs.length === 2 && upperDocs.every((x) => x === upper), `D6d 两处「上两档 164 个变体」都等于现量 ${upper}（archipelago ${sweep.archipelago.v} + ocean ${sweep.ocean.v}）`,
  upperDocs.join('/'));
const multiDocs = [...DOCS.matchAll(/(\d+) 个\*\*擦掉就不再唯一|变体里有 \*\*(\d+) 个\*\*|(\d+) 个擦掉就不再唯一/g)].map((m) => +(m[1] || m[2] || m[3])).filter(Boolean);
ok(multiDocs.length >= 1 && multiDocs.every((x) => x === totalM) && totalM === 31,
  `D6e 文档的「31 个不再唯一」== 现扫 ${totalM}（multi 判据同 test/count.test.mjs：naive.count > 1）`, `文档 ${multiDocs.join('/')} vs 现量 ${totalM}`);
ok(sweep.shoal.multi === 0 && sweep.sound.multi === 0, `D6f 前两档「没有一条线索是 load-bearing」成立（擦完仍全部唯一）`,
  `shoal ${sweep.shoal.multi} · sound ${sweep.sound.multi}`);
const pool = LOTS.map((row) => {
  const ser = serialize(row.spec);
  const spec2 = deserialize(ser);
  const comp = compile(spec2);
  const hs = handshake(comp);
  const c = countSolutions(spec2, 2);
  const r = reason(spec2, { maxDepth: 4 });
  return { okAll: serialize(spec2) === ser && hs.sumP % 2 === 0 && hs.target === row.roots && row.sumP === hs.sumP && c.count === 1 && !c.stopped && r.ok && r.depth === row.k };
});
ok(pool.every((x) => x.okAll), `D6g 32 关逐行从**序列化字节**重算：Σp 为偶 · roots == Σp/2 · 解数 == 1 未截断 · reason 深度 == 出厂 k`,
  `通过 ${pool.filter((x) => x.okAll).length}/${pool.length}`);
ok(/eq\(variants, LOTS\.reduce/.test(read('test/count.test.mjs')), 'D6h 251 这一条在 test/count.test.mjs 里是代码断言（不是文档自说自话）', '见该文件 251-variants 那条 test');
const tierIsl = { shoal: 33, sound: 54, archipelago: 71, ocean: 93 };
ok(Object.entries(tierIsl).every(([k, v]) => sweep[k].v === v) && 33 + 54 + 71 + 93 === totalV,
  `D6i 四档变体数逐档现量相加 == ${totalV}（33+54+71+93）`, Object.entries(sweep).map(([k, x]) => `${k}=${x.v}`).join(' + '));

// ---- D7 README 开头那张 shoal-01 示例卡：每个数字都从 lots.js 的那一行现算 ----
const sh1 = LOTS.find((l) => l.id === 'shoal-01');
const sh1comp = compile(sh1.spec);
const sh1cb = checkBridges(sh1.spec, sh1.solution);
const card = README.slice(0, README.indexOf('## 玩法'));
ok(/4 × 4（出厂题库的第一关 shoal-01）/.test(card), 'D7a 示例卡那句「4 × 4（出厂题库的第一关 shoal-01）」还在', `shoal-01 的盘是 ${sh1comp.w}×${sh1comp.h}`);
const sumExpr = (card.match(/Σp = ([\d+]+) = (\d+)/) || []).slice(1);
ok(sumExpr.length === 2 && sumExpr[0] === sh1comp.p.join('+') && +sumExpr[1] === handshake(sh1comp).sumP,
  `D7 示例卡的 Σp = ${sumExpr[0]} = ${sumExpr[1]} == shoal-01 现量`, `文档 ${sumExpr.join(' = ')} vs 代码 ${sh1comp.p.join('+')} = ${handshake(sh1comp).sumP}`);
const rootsDoc = (card.match(/桥数 = Σp\/2 = (\d+)/) || [])[1];
ok(+rootsDoc === sh1.roots && +rootsDoc === handshake(sh1comp).target, `D7 示例卡「桥数 = Σp/2 = ${rootsDoc}」== 出厂行 roots 与握手引理现量`, `文档 ${rootsDoc} vs ${sh1.roots}/${handshake(sh1comp).target}`);
const degDoc = (card.match(/度数 ([\d,]+) 全部对上/) || [])[1];
ok(degDoc === sh1cb.degrees.join(',') && sh1cb.ok === true, `D7 示例卡「度数 ${degDoc} 全部对上」== checkBridges 现量`, `文档 ${degDoc} vs 代码 ${sh1cb.degrees.join(',')}`);
ok(/一条链连通/.test(card) && sh1cb.components === 1, `D7 示例卡「一条链连通」== checkBridges 的 components 现量`, `components ${sh1cb.components}`);
const cs3 = countSolutions(sh1.spec, 3);
ok(/`countSolutions\(spec, 3\)` 返回 `count:1`/.test(card) && cs3.count === 1, `D7 示例卡那句 countSolutions(spec, 3) 返回 count:1 现场成立`, `现量 ${cs3.count}`);
ok(/`checkBridges` 返回\s*\n?`ok:true, degrees:\[([\d,]+)\], components:(\d+)`/.test(card), 'D7b 示例卡解析到 checkBridges 的 degrees 与 components 两格', degDoc);
ok(/三根桥：①—② · ②┆③ · ③┆④/.test(card) && sh1.roots === 3 && sh1.solution.reduce((a, v) => a + v, 0) === 3,
  `D7c 示例卡那句「三根桥」== shoal-01 解里的根数现量`, `roots ${sh1.roots} · 解的和 ${sh1.solution.reduce((a, v) => a + v, 0)}`);

// ---- D8 端口与服务器：verify.sh 的默认号 == package.json == 两份文档抄的数 ----
const cdpWant = +(VERIFY.match(/CDP_PORT=\$\{CDP_PORT:-(\d+)\}/) || [])[1];
const webWant = +(VERIFY.match(/WEB_PORT=\$\{WEB_PORT:-(\d+)\}/) || [])[1];
const devPort = +((PKG.scripts?.dev || '').match(/server\.cjs\s+(\d+)/) || [])[1];
ok(cdpWant > 0 && webWant > 0 && devPort > 0, `D8a verify.sh 的两个默认号与 package.json dev 端口都解析到（CDP ${cdpWant} · WEB ${webWant} · dev ${devPort}）`,
  `verify ${webWant}/${cdpWant} · package ${devPort}`);
ok(webWant === devPort, `D8 HTTP 默认号两处一致：verify.sh ${webWant} == package.json dev ${devPort}`, `verify=${webWant} · package=${devPort}`);
ok(/:5181\/` \/ devtools `:9341/.test(DESIGN) || (/web `:5181` \/ devtools `:9341`/.test(DESIGN) && webWant === 5181 && cdpWant === 9341),
  `D8b DESIGN 端口那句 web :5181 / devtools :9341 == verify.sh 现值`, `verify ${webWant}/${cdpWant}`);
ok(/127\.0\.0\.1:5181/.test(README) && /node server\.cjs 5181/.test(DESIGN), `D8c README 与 DESIGN §7 抄的 5181 两处同源`, `两处命中`);
const srvSrc = read('server.cjs');
ok(/process\.argv\[2\]/.test(srvSrc) || /\|\| *5181/.test(srvSrc), 'D8d server.cjs 的默认端口取自参数或 5181（文档那句「零依赖静态服务器」有代码）',
  srvSrc.match(/5181|argv\[2\]/)?.[0] || '解析不到');

// ---- D9 屏上的四个数与玩法决定：表里几行、读几个数、几档结算、几次拖一个循环 ----
const readoutSection = README.slice(README.indexOf('## 屏上的四个数'), README.indexOf('关卡本身来自构建期'));
const readoutRows = [...readoutSection.matchAll(/^\| `([^`]+)`[^|]*\| ([^|]+) \|/gm)];
ok(readoutRows.length === 4, `D9a「屏上的四个数」那张表解析到 4 行（!=4 就是表格形状改了）`, `${readoutRows.length} 行`);
const roStart = MAIN_SRC.indexOf('el.readout.innerHTML = [');
const roTail = MAIN_SRC.slice(roStart);
const roEnd = roTail.search(/\n\s*\]\s*[.;]/);
const readoutBlock = roEnd > 0 ? roTail.slice(0, roEnd) : roTail;
const uiLabels = [...readoutBlock.matchAll(/field\('([^']+)'/g)].map((m) => m[1]);
ok(uiLabels.length === 6, `D9b js/main.js 的 readout 现场解析到 6 个 field（文档点名的 4 个读数 + 2 个玩法计数 ${uiLabels.slice(4).join('/')}）`, uiLabels.join('/'));
const docFour = readoutRows.map((r) => r[1].trim().split(/[\s（]/)[0]);
ok(readoutRows.length === 4 && docFour.join('/') === uiLabels.slice(0, 4).join('/'),
  `D9 文档表的四个名字与页面头四个读数逐条同序（第 5、6 个是玩法计数，文档没写进那张表）`, `文档 ${docFour.join('/')} vs 页面 ${uiLabels.slice(0, 4).join('/')}`);
ok(/屏幕上这四个数都不是感觉/.test(HTML), 'D9c index.html 里那句「屏幕上这四个数」还在（改了面板就得同时改三处）', '命中');
const verdicts = [...GAME_SRC.matchAll(/label: '([^']+)', stars: (\d)/g)];
ok(verdicts.length === 3 && /结算分三档/.test(README), `D9d 结算是三档（game.js 现量 ${verdicts.length}），README 那句「分三档」同源`, verdicts.map((v) => v[1]).join('/'));
const bandDoc = (README.match(/结算分三档：`([^`]+)`[^`]*`([^`]+)`（多花 ≤(\d+) 拖）· `([^`]+)`/) || []).slice(1);
ok(bandDoc.length === 4 && bandDoc[0] === verdicts[0][1] && bandDoc[1] === verdicts[1][1] && bandDoc[3] === verdicts[2][1],
  `D9 三档的名字与顺序逐条 == game.js 现值`, `文档 ${bandDoc[0]}/${bandDoc[1]}/${bandDoc[3]} vs 代码 ${verdicts.map((v) => v[1]).join('/')}`);
ok(+bandDoc[2] === +((GAME_SRC.match(/if \(over <= (\d+)\) return \{ key: 'clean'/) || [])[1]),
  `D9e「多花 ≤${bandDoc[2]} 拖」那一条 == game.js 里 clean 档的阈值`, `文档 ≤${bandDoc[2]} vs 代码 ${GAME_SRC.match(/over <= (\d+)\) return \{ key: 'clean'/)?.[1]}`);
ok(/0 -> 1 -> 2 -> 0/.test(GAME_SRC) && /同一条线拖三次一个循环/.test(README), 'D9f 拖拽 3-循环在 game.js 里是代码，README 那句「拖三次一个循环」同源', '命中');
ok(/0 根 → 1 根 → 2 根 → 清空/.test(README) && /`完成一盘所需的最少拖拽数`恰好等于桥根数 `Σp\/2`/.test(README),
  'D9g README 那句「最少拖拽数 == Σp/2」写明了，且 target 就是握手引理那个数', `game.target = hs.target=${/target: hs\.target/.test(GAME_SRC)}`);
const keyHits = (MODEL_SRC + STORE_SRC).match(/hashi\.save\.v1/g) || [];
ok(keyHits.length === 1 && /一个 `localStorage` 键 `hashi\.save\.v1`/.test(README), `D9h 存档键全仓只有一处定义，且 README 抄的就是它`, `${keyHits.length} 处`);
const blankFields = (STORE_SRC.match(/return \{\s*\n((?:\s+\w+:.*\n)+?)\s*\}/) || [])[1] || '';
const fields = blankFields.split('\n').map((l) => l.trim().split(':')[0]).filter(Boolean);
ok(fields.length === 4 && /`records`[^`]*`daily`[^`]*`unlocked`[^`]*`stats`/.test(DESIGN), `D9i storage 的 blank() 字段现量 ${fields.length} 个 == DESIGN 列的四个`, fields.join('/'));
ok(/asks twice/.test(MAIN_SRC) && /要点两次才算数/.test(README), 'D9j 「清空存档 要点两次」在 main.js 里是代码', '命中');

// ---- D10 符号锚点：文档为某个文件写的 `file:NN` / `file:NN-MM`，必须真的坐在它声称的那一行上 ----
const fileRanges = (file) => {
  // 文档有时写全路径（`js/core/model.js:255`），有时只写基名（`model.js:242`），两种都要认
  const base = file.split('/').pop().replace(/[.]/g, '\\.');
  return [...DOCS.matchAll(new RegExp('`(?:[\\w./-]*/)?' + base + ':(\\d+)(?:-(\\d+))?`', 'g'))].map((m) => [+(m[1]), +(m[2] || m[1])]);
};
const lineOf = (file, re) => { const a = read(file).split('\n'); for (let i = 0; i < a.length; i++) if (re.test(a[i])) return i + 1; return -1; };
const ANCHORS = [
  ['js/core/logic.js', 'RULES 表', /export const RULES = \[/, 'logic.js:30'],
  ['js/core/logic.js', 'reason 默认层数上限', /opts\.maxDepth === undefined/, 'logic.js:54'],
  ['js/core/count.js', 'propagate 共用', /export function propagate/, 'count.js:62'],
  ['js/core/count.js', 'wildcard 注释', /A slot between two \*wildcards\*/, 'count.js:191'],
  ['js/core/count.js', 'pickSlot', /export function pickSlot/, 'count.js:196'],
  ['js/core/model.js', 'compile', /export function compile\(spec\)/, 'model.js:46'],
  ['js/core/model.js', '交叉判定循环', /for \(const h of slots\) \{/, 'model.js:107'],
  ['js/core/model.js', 'toBridges 注释所在函数', /export function toBridges/, 'model.js:158'],
  ['js/core/model.js', 'connected()', /export function connected/, 'model.js:242'],
  ['js/core/model.js', 'handshake()', /export function handshake/, 'model.js:255'],
  ['js/core/model.js', 'checkBridges()', /export function checkBridges/, 'model.js:320'],
  ['js/core/model.js', '交叉每对只报一次', /if \(o > s\.i && read\.bridges\[o\]\)/, 'model.js:338'],
  ['js/core/make.js', '随机撒岛不行的论证', /A random scatter with a uniqueness filter/, 'make.js:15'],
  ['tools/verify.sh', 'CDP 默认号', /CDP_PORT=\$\{CDP_PORT/, 'tools/verify.sh:15-16'],
  ['tools/verify.sh', 'WEB 默认号', /WEB_PORT=\$\{WEB_PORT/, 'tools/verify.sh:15-16'],
  ['tools/verify.sh', '端口被占就 exit 3', /exit 3/, 'verify.sh:105'],
  ['tools/playtest.mjs', 'isOurs 同源判定', /const isOurs = /, 'tools/playtest.mjs:21'],
  ['test/logic.test.mjs', '规则表里没有「全单桥」', /no rule claims/, 'test/logic.test.mjs:31'],
  ['test/logic.test.mjs', 'R-minned 到不了的论证', /R-minned is the one printed rule/, 'test/logic.test.mjs:124'],
  ['test/count.test.mjs', '251 个擦线索变体', /single-clue erasure of the shipped pool/, 'test/count.test.mjs:167'],
];
for (const [file, what, re, cite] of ANCHORS) {
  const real = lineOf(file, re);
  const cw = cite.match(/:(\d+)(?:-(\d+))?/); const cLo = +cw[1]; const cHi = +(cw[2] || cw[1]);
  const ranges = fileRanges(file);
  const hits = ranges.filter(([a, b]) => real >= a && real <= b);
  ok(real > 0, `D10 代码侧「${what}」解析到了（找不到就是空转）`, `${file}:${real}`);
  ok(hits.length >= 1 && real >= cLo && real <= cHi, `D10 文档为 ${file} 写的 \`${cite}\` 真的压在「${what}」现在的第 ${real} 行`,
    ranges.length ? `文档 ${file} 的引用：${ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(' / ')} · 代码现在 ${real}` : '文档里解析不到这个文件的行引用');
}

// ---- D11 泛引用范围检查：README + DESIGN 里每一条 path:NN / path:NN-MM 都落在真实文件行数内 ----
const cites = [...DOCS.matchAll(/((?:\.github\/workflows\/|js\/|tools\/|css\/|test\/)?[\w./-]+\.(?:js|mjs|cjs|sh|json|html|yml)):(\d+)(?:-(\d+))?/g)];
const resolve = (p) => {
  if (existsSync(join(ROOT, p))) return p;
  const base = p.split('/').pop();
  for (const d of ['tools/', 'js/core/', 'js/data/', 'js/', 'test/', 'css/', '.github/workflows/', '']) if (existsSync(join(ROOT, d + base))) return d + base;
  return null;
};
// 一条引用能犯的错有三样：文件不在树里、行号越界、被指的行段整段是空行。第三样是这一轮补的：
// 在中间插几行之后 `:NN` 指的是空行，可它还在界内，只问「行号存在吗」的那道闸一路绿。
const citeMiss = (raw, fromRaw, toRaw) => {
  const rp = resolve(raw);
  if (!rp) return `${raw}:${fromRaw}（文件不存在）`;
  const src = read(rp).split('\n');
  const to = +(toRaw || fromRaw);
  if (+fromRaw > src.length || to > src.length) return `${raw}:${fromRaw}${toRaw ? '-' + toRaw : ''}（该文件只有 ${src.length} 行）`;
  if (src.slice(+fromRaw - 1, to).join('').trim() === '') return `${raw}:${fromRaw}${toRaw ? '-' + toRaw : ''} 那几行整段是空行`;
  return '';
};
const bad = cites.map((c) => citeMiss(c[1], c[2], c[3])).filter(Boolean);
// 空行这一道不许空转：靶子从本闸自己的文件里现量（写死行号会在有人填了那一行那天停止测试）。
const ownLines = read('tools/doctest.mjs').split('\n');
let blankAt = 0;
for (let i = 1; i < ownLines.length; i++) if (String(ownLines[i]).trim() === '') { blankAt = i + 1; break; }
const blankKnife = blankAt ? citeMiss('tools/doctest.mjs', blankAt, null) : '';
ok(cites.length >= 22, `D11a 文档里的 path:NN 引用解析到 ${cites.length} 条（少于 22 条说明引用格式改了或被删空）`, `${cites.length} 条`);
ok(bad.length === 0 && !!blankKnife, `D11 每一条 path:NN 引用都落在真实文件的行数内、且被指的那几行整段不许是空行（在界内不等于指到了代码；这一格自己带一把指向空行的刀）`,
  bad.length ? `越界/不存在/空行：${bad.slice(0, 5).join('，')}${bad.length > 5 ? ` …共 ${bad.length} 条` : ''}`
    : blankKnife ? `${cites.length} 条全部在范围内 · 刀：本闸第 ${blankAt} 行现量是空行，指过去判红「那几行整段是空行」`
      : '本闸自己的文件里现量不出空行靶子 —— 空行那一道没被证明过');

// ---- D12 复现命令与 npm test 的断言行数：七个文件、每个的 rows、合计，全部现跑 ----
const suiteFiles = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort();
const rowsDocs = [...DOCS.matchAll(/(?:count|game|library|logic|model|rng|storage)\s+\d+ · [^\n]*/g)];
const perFile = (rowsDocs[0] ? rowsDocs[0][0] : '').split('·').map((s) => +(s.match(/(\d+)/) || [])[1]).filter(Boolean);
ok(suiteFiles.length === 7 && /7 个 node (?:测试文件|测试)/.test(DOCS), `D12a test/ 下现量 ${suiteFiles.length} 个 .test.mjs == 两份文档说的「7 个」`, suiteFiles.join(' '));
ok(perFile.length === 7, `D12b DESIGN §7 那行「count 15 · game 13 · …」解析到 7 个数字（解析不到就是句式改了）`, perFile.join('/'));
const liveRows = {};
for (const [name, r] of Object.entries(SUITES)) {
  const m = r.out.match(/^rows: (\d+) fail: (\d+)$/m);
  liveRows[name] = { rc: r.rc, rows: m ? +m[1] : -1, failed: m ? +m[2] : -1 };
  ok(r.rc === 0 && m && +m[2] === 0, `D12 ${name}.test.mjs 现场跑 rc=${r.rc} 且打了「rows: N fail: 0」`, m ? `rows ${m[1]}` : '解析不到 rows 行');
}
const docRowsOrder = ['count', 'game', 'library', 'logic', 'model', 'rng', 'storage'];
ok(perFile.length === 7 && docRowsOrder.every((n, i) => perFile[i] === liveRows[n].rows),
  `D12c 文档那七个数字逐位等于现场跑的 rows（${docRowsOrder.map((n) => `${n} ${liveRows[n].rows}`).join(' · ')}）`, `文档 ${perFile.join('/')}`);
const liveTotal = docRowsOrder.reduce((a, n) => a + liveRows[n].rows, 0);
const docTotals = [...DOCS.matchAll(/(?:共|合计) (\d+)(?: 行断言|。)/g)].map((m) => +m[1]);
ok(docTotals.length >= 2 && docTotals.every((x) => x === liveTotal),
  `D12d 文档的「共 101 行断言」与「合计 101」两处都等于现跑七档相加 ${liveTotal}（解析到 ${docTotals.length} 处：${docTotals.join('/')}）`, `现量 ${liveTotal}`);
const declared = Object.keys(PKG.scripts || {});
for (const cmd of ['check', 'unit', 'test', 'balance', 'bake', 'verify']) {
  ok(declared.includes(cmd), `D12e package.json 里有 ${cmd} 这条 script（文档 §7 与 README 的运行块都点了它）`, PKG.scripts[cmd] || '没有');
}

// ---- D13 接线：doctest 与 sabotage 进了 verify.sh 的逻辑段、CI 的无浏览器 job 与 package.json ----
const pkgHas = (k) => (PKG.scripts?.[k] || '').includes(`tools/${k}.mjs`);
ok(pkgHas('doctest') && pkgHas('sabotage'), `D13a package.json 有 doctest 与 sabotage 两条 script 且都指向本仓 tools/`,
  `doctest=${PKG.scripts?.doctest} · sabotage=${PKG.scripts?.sabotage}`);
const logicSeg = VERIFY.slice(0, VERIFY.indexOf('one browser, one server'));
ok(/GATES="doctest sabotage"/.test(logicSeg) && /for g in \$GATES/.test(logicSeg) && /node "tools\/\$g\.mjs"/.test(logicSeg),
  'D13b verify.sh 的逻辑段（在起浏览器之前）用 $GATES 把这两道闸各跑一遍', `GATES=${/doctest sabotage/.test(logicSeg)} · 循环=${/node "tools\/\$g\.mjs"/.test(logicSeg)}`);
ok(/FAILED=1/.test(logicSeg) && /DOCTEST_ROWS_EXPECT=/.test(VERIFY) && /SABOTAGE_KNIVES_EXPECT=/.test(VERIFY),
  'D13c verify.sh 把两道闸的 rc 折进 FAILED，并且把它们自己的规模钉在 expect 里（缩小就是红）',
  (VERIFY.match(/DOCTEST_ROWS_EXPECT=\S+/) || [])[0] + ' · ' + (VERIFY.match(/SABOTAGE_KNIVES_EXPECT=\S+/) || [])[0]);
const ciUnitSeg = CI.slice(CI.indexOf('  unit:'), CI.indexOf('  browser:'));
ok(/node tools\/doctest\.mjs/.test(ciUnitSeg) && /node tools\/sabotage\.mjs/.test(ciUnitSeg),
  'D13d 两道闸都在 CI 那个不开浏览器的 job（本仓叫 unit）里 —— 本地绿＝CI 绿，不许有只在本地跑的闸',
  `unit job: doctest=${/doctest/.test(ciUnitSeg)} · sabotage=${/sabotage/.test(ciUnitSeg)}`);
ok(/bash tools\/verify\.sh/.test(CI) && PKG.scripts?.verify === 'bash tools/verify.sh', `D13e verify.sh 是 CI 与本地共用的那一条命令`, `pkg.verify=${PKG.scripts?.verify}`);
ok(/## 六道闸/.test(README) && /破坏试验台账（\d+ 把刀）/.test(README), 'D13f README 里有一节写明新加的两道文档诚实闸与台账刀数（不许只改脚本不改文档）',
  (README.match(/破坏试验台账（\d+ 把刀）/) || ['未写'])[0]);

// ---- D14 墙钟与浏览器读数：只比「文档自己声明这一列会漂」这层关系，绝不重测 ----
const driftNotes = [...DOCS.matchAll(/(毫秒量随机器负载漂移|七个结构列\*\*逐位相同|别引用毫秒|结构量逐位可复现)/g)].map((m) => m[1]);
ok(driftNotes.length >= 3, `D14a 文档里三处以上写明「结构列逐位相同、毫秒会漂、别引用毫秒」（少了就是有人又把墙钟当现值抄）`, `${driftNotes.length} 处`);
ok(/msPerSeed|ms\/seed/.test(BAL_SRC) && !/budgetMs/.test(BAL_SRC), 'D14b balance.mjs 打印 ms 但没有任何 budgetMs 判定路径（文档那句「别引用毫秒」有代码背书）',
  `ms 列=${/ms\/seed/.test(BAL_SRC)} · budgetMs=${/budgetMs/.test(BAL_SRC)}`);
const msCols = (docBalRows.ocean || []).slice(11, 13);
const liveMsCols = (balRows.ocean || []).slice(11, 13);
ok(msCols.length === 2 && liveMsCols.length === 2 && /只有 `ms\/seed`、`ms max` 两列漂移/.test(DESIGN),
  `D14c §5 表里 ms/seed 与 ms max 这两列被文档明写会漂（所以这里只核形状，不核数值）`, `文档 ${msCols.join('/')} · 现跑 ${liveMsCols.join('/')}`);

// ---- D15 UNPINNED 清单：需要浏览器或本机负载才有值的读数不进等式，但每条都要「还在文档里」----
const UNPINNED = [
  ['U1', '§5 表里的毫秒两列（0.6 / 3.1 … 6.2 / 7.9）', /0\.6\s+3\.1/],
  ['U2', 'wall 0.1s 那句出题墙钟', /wall 0\.1s/],
  ['U3', '浏览器段 @boot 19 · @play 20 · @routes 13 · @save 12 · @pointer 20', /@boot 19 · @play 20 · @routes 13 · @save 12 · @pointer 20/],
  ['U4', '浏览器段合计 84 行、0 失败', /合计 84 行、0 失败/],
  ['U5', '数字来自 2026-09-27 本机（Apple Silicon / node v24.18.0）', /2026-09-27/],
  ['U6', 'balance 表里 ocean 的 ms/seed 漂移序列 6.2 → 6.5 → 4.2', /6\.2 → 6\.5 → 4\.2/],
];
UNPINNED.forEach(([id, what, re]) => {
  const hits = (DOCS.match(re) || []).length;
  ok(hits >= 1, `D15 ${id}「${what}」还写在文档里（钉不住 ≠ 可以删；删了就是这一条红）`, `${hits} 处`);
});
const unpinnedHits = UNPINNED.filter(([, , re]) => re.test(DOCS)).length;
ok(unpinnedHits === UNPINNED.length, `D15a 反空转：${UNPINNED.length} 条 unpinned 逐条在文档里找到 needle`, `${unpinnedHits}/${UNPINNED.length}`);
ok(!/@boot 19/.test(BAL.out) && !/playtest/.test(BAL_SRC), 'D15b 浏览器那 84 行确实不属于这道闸的现算范围（balance 里既无 @boot 也不碰 playtest）', '现算范围只到 §5 的结构列');

// ---- D16 台账本身：文档说的刀数 == sabotage.mjs 里的 KNIVES 条数，每格 rc 是读回来的数字 ----
const sabSrc = existsSync(join(ROOT, 'tools/sabotage.mjs')) ? read('tools/sabotage.mjs') : '';
// 三处解析一律行首锚定（照 z-biz-game-masyu-cos 的 D16a 走）：刀自己的 from/to、以及任何一句
// 讲刀头的注释，磁盘上都可能原样出现一行 `id: 'K5', group: 'D9', ...`。不锚定的话它会被数成
// 多出来的一把刀 —— 而多出来的那一把没有真刀守着，D16b/D16d 就是在给一个幽灵记账。
const knifeIds = [...sabSrc.matchAll(/^    id: '(K\d+)'/gm)].map((m) => m[1]);
ok(knifeIds.length >= 4, `D16a sabotage.mjs 里至少 4 把刀（当前 ${knifeIds.length} 把：${knifeIds.join(' ')}）`, `${knifeIds.length} 把：${knifeIds.join(' ')}`);
const knifeDoc = (README.match(/破坏试验台账（(\d+) 把刀）/) || [])[1];
ok(!!knifeDoc && +knifeDoc === knifeIds.length, `D16b README 那句「台账（N 把刀）」等于 sabotage.mjs 里的刀数`,
  `文档 ${knifeDoc ?? '未解析'} vs 脚本 ${knifeIds.length}`);
const rcCells = knifeIds.map((id) => (sabSrc.match(new RegExp(`^    id: '${id}',[\\s\\S]*?rc: '(\\d+|\\?)'`, 'm')) || [])[1]);
ok(rcCells.every((x) => x && /^\d+$/.test(x)), `D16c 台账每一格 rc 都是从闸里读回来的数字（'?' 表示这一版还没整跑过）`, rcCells.join(' / '));
const knifeGroups = [...sabSrc.matchAll(/^    id: 'K\d+', group: '(D\d+)'/gm)].map((m) => m[1]);
// D17 是本闸最后一组：跑到这里它自己那两条还没发，所以它只能被"钉表改了而刀没跟上"这类红抓住。
// 除它以外，刀口点名的组必须此刻真的发过，否则那把刀在冒充一组并不存在的断言。
ok(new Set(knifeGroups).size === knifeGroups.length && knifeGroups.every((g) => emitted.has(g) || g === 'D17'),
  `D16d 每把刀打的都是不同的断言组，而且那些组本闸真的发过（D17 是本闸最后一组，它的证据在 D17 自己那两条）`,
  `${knifeGroups.join(' ')} vs 本闸 ${[...emitted].length} 组`);

// ---- D17 自数：这道闸自己发出的组数与项数都钉死 —— 删一条断言/少解析一行就是这里红 ----
const EXPECT_GROUPS = 17;
const EXPECT_ROWS = 254;
// 求值顺序：ok() 的 label/detail 实参在本条计入 rows 之前就算好了，所以显式把「接下来要发的 D17a、D17b」
// 与 D17 这一组预先并进总数再比 —— 钉的是全量运行的规模，不是运行到这里为止的规模。
const finalRows = rows + (ONLY.length ? 0 : 2);
const finalGroups = emitted.size + (emitted.has('D17') || ONLY.length ? 0 : 1);
ok(finalGroups === EXPECT_GROUPS, `D17a 本闸发出 ${finalGroups} 组 D 标签（钉在 ${EXPECT_GROUPS}；少一组就是这里红）`,
  [...emitted].sort((a, b) => +a.slice(1) - +b.slice(1)).join(' '));
ok(finalRows === EXPECT_ROWS, `D17b 本闸项数 == 钉的 ${EXPECT_ROWS}（增/删一条 ok() 都要改这里的钉）`, `本次累计 ${finalRows} 项${ONLY.length ? '（子集运行）' : ''}`);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
if (skipped.length) console.log(`NOTE 本次是子集运行（ONLY=${ONLY.join(',')}），未执行的组：${skipped.join(' ')}；自钉 D17 在全量运行才成立`);
console.log(`rows: ${rows} fail: ${fail.length}`);
console.log(`pin: groups=${finalGroups} rows=${finalRows}`);
console.log(`钉值 groups_expect=${EXPECT_GROUPS} rows_expect=${EXPECT_ROWS}（verify.sh 的 DOCTEST_GROUPS_EXPECT/DOCTEST_ROWS_EXPECT 必须与这两个数一致）`);
console.log(`钉成等式的文档现值：${rows - UNPINNED.length} 项 · 显式 unpinned：${UNPINNED.length} 项`);
if (fail.length) { for (const f of fail) console.log(`  未过：${f}`); process.exit(1); }
process.exit(0);

function rootsOf(spec, sol) {
  const comp = compile(spec);
  let t = 0;
  for (const s of comp.slots) t += (sol[s.i] ?? 0);
  return t;
}
function dirsOf(comp, i) {
  let n = 0;
  for (const s of comp.slots) if (s.a === i || s.b === i) n++;
  return n;
}
function maxIncident(comp, sol, i) {
  let mx = 0;
  for (const s of comp.slots) if (s.a === i || s.b === i) mx = Math.max(mx, sol[s.i] ?? 0);
  return mx;
}
