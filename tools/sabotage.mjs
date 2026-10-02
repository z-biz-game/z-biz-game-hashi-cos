// 破坏试验台账：把「文档可能抄的是一个已经不存在的数」这件事，一类谎一类谎地塞回代码里，
// 证明 tools/doctest.mjs 真的会红，而且红的就是文档点名的那一条断言 —— 不是随便一条别的红。
//
// 为什么要这道闸：doctest 是绿的，但「绿」有两种：一种是被断言真的守住了，一种是解析器集体扑空
// （正则改了形状、锚点被删空、balance 没跑起来）。前者绿是成绩，后者绿是假账。唯一的分辨办法是
// 主动把代码改坏，看这道闸是不是立刻变红并且报出对应的那一条。这里就把每一类谎固化成一把刀。
//
// 五条规矩（照 z-biz-game-kurotto-cos / z-biz-game-nurikabe-cos 的台账走，不自创一套）：
//   1. 每把刀改一个真实的代码文件（不是改文档），当场跑 node tools/doctest.mjs，读回真实 rc；
//   2. rc 必须 != 0，而且日志里必须出现「文档点名的那条断言」的 FAIL 行 —— 只红在别处不算逼到；
//   3. 复原只用内存里读回来的原始字节 writeFileSync，绝不借 git 命令复原；复原后再逐字节回读比对；
//   4. 台账的 rc 一格是「从脚本读回来的真实读数」，自钉必须幂等：干净树上重跑，刀数与 rc 都不变；
//   5. 前提是被破坏的树得先是干净的（`git status --porcelain -uno` 为空，且每把刀的 from 在目标文件里
//      恰好命中一次）—— 刀在飞、树在改 = 假绿。开发期要显式 SABOTAGE_ALLOW_DIRTY=1 才允许跑，
//      verify.sh 与 CI 都不带这个变量，所以在闸里这条前提始终是真要求的。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (rel) => join(ROOT, rel);

// 五把刀，各打 doctest 的一个不同组：D1 档位岛数区间、D2 规则原文、D5 balance 实测表、
// D8 端口默认号、D9 屏上读数的名字。全部是纯逻辑的常量改动 —— 不动浏览器、不开 Chrome，
// 因此这把刀在任何机器上都一样快、一样准。
const KNIVES = [
  {
    id: 'K1', group: 'D1', file: 'js/data/lots.js',
    from: '"islMin":11,"islMax":12', to: '"islMin":11,"islMax":11',
    breaks: '把出厂表里 ocean 的 islMax 从 12 改成 11（README 题库那行写的是 7×7·11-12 岛）',
    assert: /FAIL .*D1 ocean 的岛数区间 .* == TIERS_META 与出厂池现量/,
    rc: '1',
  },
  {
    id: 'K2', group: 'D2', file: 'js/core/logic.js',
    from: "text: '某岛度已满 -> 其余方向定空'", to: "text: '某岛度已满 -> 其余方向定 0 根'",
    breaks: '把 R-satisfied 那条规则的原文改一个字（DESIGN §4 的规则表抄的是「定空」）',
    assert: /FAIL .*D2 R-satisfied 的原文逐字 == logic\.js:30 的 RULES/,
    rc: '1',
  },
  {
    id: 'K3', group: 'D5', file: 'test/balance.mjs',
    from: 'Number(process.env.SEEDS || 8) || 8', to: 'Number(process.env.SEEDS || 6) || 6',
    breaks: '把 balance 的默认种子数从 8 改成 6（§5 那张表的 seeds 列印的是 8）',
    assert: /FAIL .*D5 shoal 的结构列 seeds 文档 .* == balance 现场/,
    rc: '1',
  },
  {
    id: 'K4', group: 'D8', file: 'tools/verify.sh',
    from: 'WEB_PORT=${WEB_PORT:-5181}', to: 'WEB_PORT=${WEB_PORT:-5182}',
    breaks: '把 verify.sh 的 HTTP 默认端口从 5181 改成 5182（与 package.json dev / 两份文档不同源）',
    assert: /FAIL .*D8 HTTP 默认号两处一致/,
    rc: '1',
  },
  {
    id: 'K5', group: 'D9', file: 'js/main.js',
    from: "field('推理深度', app.lot.k,", to: "field('深度k', app.lot.k,",
    breaks: '把侧栏第四个读数的名字改掉（README「屏上的四个数」表里那一行写的是 推理深度）',
    assert: /FAIL D9 文档表的四个名字与页面头四个读数逐条同序/,
    rc: '1',
  },
];

const runCmd = (cmd, ms) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024 });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const runGate = () => runCmd('node tools/doctest.mjs', 300000);
const runPool = () => runCmd('node test/library.test.mjs', 300000);

const problems = [];
const ledger = [];

// ---- 前提一：树是干净的（不干净就是有人在同时改这些文件，刀打出来的红不能算数）----
const dirty = runCmd('git status --porcelain -uno', 30000);
if (dirty.rc !== 0) { console.log(`  前置不成立：git status 没跑起来（rc=${dirty.rc}）`); process.exit(1); }
if (dirty.out.trim() && !process.env.SABOTAGE_ALLOW_DIRTY) {
  console.log('  前置不成立：被破坏的树必须先是干净的，tracked 文件有未提交改动：');
  for (const l of dirty.out.trim().split('\n').slice(0, 10)) console.log(`    ${l}`);
  console.log('  （开发期可显式 SABOTAGE_ALLOW_DIRTY=1；verify.sh 与 CI 不带它）');
  process.exit(1);
}
if (dirty.out.trim()) console.log(`  NOTE 树不干净但有 SABOTAGE_ALLOW_DIRTY=1（开发期），台账照常跑：${dirty.out.trim().split('\n').length} 处改动`);

// ---- 前提二：每把刀的 from 在目标文件里恰好命中一次，to 还不存在（上一次没复原干净就别往下动）----
for (const k of KNIVES) {
  if (!existsSync(p(k.file))) { problems.push(`${k.id}: 目标文件不存在 ${k.file}`); continue; }
  const src = readFileSync(p(k.file), 'utf8');
  const nFrom = src.split(k.from).length - 1;
  const nTo = src.split(k.to).length - 1;
  if (nFrom !== 1) problems.push(`${k.id}: ${k.file} 里 from 命中 ${nFrom} 次（必须恰好 1 次才敢改）`);
  if (nTo !== 0) problems.push(`${k.id}: ${k.file} 里 to 已存在 ${nTo} 次（上一次没复原干净？）`);
}
if (problems.length) { for (const x of problems) console.log(`  前置不干净：${x}`); process.exit(1); }

for (const k of KNIVES) {
  const original = readFileSync(p(k.file));      // 原始字节进内存，复原只认这份
  const sabotaged = original.toString('utf8').replace(k.from, k.to);
  if (sabotaged === original.toString('utf8')) { problems.push(`${k.id}: 替换没生效（from 与 to 相同？）`); continue; }
  writeFileSync(p(k.file), sabotaged, 'utf8');
  let gate;
  try {
    gate = runGate();
  } finally {
    writeFileSync(p(k.file), original);           // 无论闸跑成什么、有没有抛，都用内存里的原始字节写回去
  }
  const restored = readFileSync(p(k.file)).equals(original); // 复原后逐字节回读校验
  const named = gate.out.split('\n').find((l) => l.includes('FAIL') && k.assert.test(l));
  const tripped = gate.rc !== 0 && !!named;
  const reds = gate.out.split('\n').filter((l) => l.includes('FAIL')).length;
  k.rc = String(gate.rc);
  ledger.push({ id: k.id, group: k.group, breaks: k.breaks, rc: gate.rc, tripped, restored, named: named || '(日志里没有点名的那条 FAIL)', reds });
  console.log(`  [${tripped ? '逼红' : '未逼红'}] ${k.id} → ${k.group} · 破坏「${k.breaks}」 · doctest rc=${gate.rc} · 红 ${reds} 条`);
  console.log(`      点名的断言：${(named || '(没点名)').trim()}`);
  if (!restored) problems.push(`${k.id}: 复原后逐字节不一致（还原没做到）`);
  if (gate.rc === 0) problems.push(`${k.id}: 塞了这类谎 doctest 却还是 rc=0 —— 这一类谎没人守`);
  else if (!named) problems.push(`${k.id}: doctest 红了但不是红在点名的那条（${k.group}）`);
}

// ---- 自钉：把读回来的真实 rc 写进本文件的台账（幂等 —— 同样的刀只会得到同样的 rc）----
const selfPath = fileURLToPath(import.meta.url);
const selfSrc = readFileSync(selfPath, 'utf8');
let stamped = selfSrc;
for (const k of KNIVES) {
  const re = new RegExp(`(id: '${k.id}'[\\s\\S]*?rc: ')[^']*(')`);
  if (!re.test(stamped)) { problems.push(`自钉：找不到 ${k.id} 的 rc 槽`); continue; }
  stamped = stamped.replace(re, `$1${k.rc}$2`);
}
if (stamped !== selfSrc) writeFileSync(selfPath, stamped, 'utf8'); // 幂等：干净重跑时这里 no-op

// ---- 对照：不带任何破坏，doctest 与出厂题库重数都必须绿 —— 台账不是靠改坏闸来绿 ----
const ctl = runGate();
const pool = runPool();
console.log(`\n对照（干净树）：doctest rc=${ctl.rc} · library.test rc=${pool.rc}`);
if (ctl.rc !== 0) console.log(ctl.out.split('\n').filter((l) => l.includes('FAIL')).slice(0, 20).join('\n'));

console.log('\n== 破坏试验台账（rc 均为本次从脚本读回的真实读数）==');
console.log('| 刀 | 打哪组 | 破坏 | 逼到的断言 | 真实 rc |');
console.log('|---|---|---|---|---|');
for (const r of ledger) console.log(`| ${r.id} | ${r.group} | ${r.breaks} | ${r.named.slice(0, 46).trim()} | ${r.rc} |`);
console.log(`\npin: knives=${KNIVES.length}`);
console.log(`knives: ${KNIVES.length} fail: ${problems.length}`);

if (problems.length) { console.log('\n台账不绿：'); for (const x of problems) console.log(`  - ${x}`); process.exit(1); }
if (ctl.rc !== 0 || pool.rc !== 0) { console.log('对照不绿：闸在干净树上是红的'); process.exit(1); }
console.log(`\n台账全绿：${ledger.length} 把刀各自逼红了点名的断言，复原逐字节一致，干净树对照 doctest+library.test 双绿。`);
process.exit(0);
