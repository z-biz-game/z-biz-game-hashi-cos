# deliverable — z-biz-game-hashi-cos

基线 HEAD `04bdc0a`（并线后）→ 本次提交。下面那段是**这一次**原样贴出的输出（含真实浏览器那一遍）；
其后的每一轮改动只把两腿的规模钉进闸自己（`tools/doctest.mjs` 的两颗钉、README 门禁清单那句规模、
`tools/verify.sh` 的三条 expect），本报告不跟着漂——所以读到这里那一段不等于读现在的闸。

## 0. 一句话

并线把两侧各写一遍的 `toggleFullscreen` 都留在了 `js/main.js` —— ES module 里同名顶层函数声明
直接是 SyntaxError，**整个模块图一行都不执行**，页面停在空壳。修掉它之后闸又暴露出更下面一层：
并线把「系统控件」那条线带进来的 CSS 整块丢了，玩法浮层退化成铺在棋盘上的一块普通内容，
**把所有鼠标输入都吃掉**，整局照样不可玩。两层都修完，闸从 13 条红到全绿。

## 1. 整局级缺陷（一）：同名顶层声明

**旧代码错在哪**

并线把两侧各写一遍的 `toggleFullscreen` 都留在了 `js/main.js`（382 行无参版 / 598 行带 root 版）。
ES module 是严格模式，同一作用域里两个同名函数声明直接是 SyntaxError
（`Identifier 'toggleFullscreen' has already been declared`）—— 整个模块图一行都不执行，
`load_sweep` 报 LOAD-ERROR。

而且就算只留一份，两套 wiring 也都注册在页面上：一个绑 `#fs`（点击 + F 键），一个绑
`#btn-fullscreen`（点击 + 它自己的 F 键监听），同一件事两个入口、一次按键两个监听。
页面里因此出现**两个「全屏」按钮**：nav 里的 `#btn-fullscreen` 与系统控件条里的 `#fs`。

**新代码为什么对**

- 只留一份声明，能力取两侧并集：前缀探测（标准 / webkit / ms）、退出侧兜底（iOS / 老 Edge 只有
  webkit/ms 前缀）、失败静默（不让 rejected promise 冒到 `window.onerror`）、不支持时把按钮变灰
  并说明原因、按钮文案随全屏状态切换、Esc 与 iOS 下滑退出后靠 `fullscreenchange` 把状态拉回来。
- 入口只留一个 `#fs`（与静音/暂停/玩法同组的系统控件条）；并线另一侧单独加的 `#btn-fullscreen`
  从 nav 里删掉 —— 同一功能两个入口在屏幕上并排出现是重影。删掉的是重复入口，全屏功能一行没少。

## 2. 整局级缺陷（二）：并线丢掉的 CSS 块把玩法浮层铺在棋盘上

**旧代码错在哪**

并线给 `css/game.css` 整份取的是较旧侧权威，而较旧侧那份**是在「系统控件」那条线之前的版本** ——
它压根没有 `.modal` / `.modal-card` / `.modal-actions` / `.veil` / `.controls.sys` 这些类。
掉的不只是好看不好看：

- `.modal` 少了 `position: fixed; inset: 0` → 玩法浮层从整屏浮层退化成文档流里的一块普通内容，
  铺在棋盘上；
- `main.js` 的 input 入口又有 `if (app.paused || !el.helpModal.hidden) return false;`
  → 浮层开着的时候所有输入都被拒。

合起来就是：**第一次访问的玩家看不到也摸不到棋盘，整局不可玩**。

真浏览器实测（headless Chrome + CDP，真鼠标事件）：按下的事件目标落在 `#help-modal` 上，
canvas 的 `down()` 一次都没被调用。

**归因（合并前基线）**：在并线后的树上只做「删掉重复声明」这一处最小改动，@pointer 仍红 13 条，
与并线前 ours 侧的 5 条红法完全不同 → 断点是并线造成的，不是本次改动造成的。
把并线前的 `css/game.css` 换回并线后的树，@pointer 的红从 13 条降到 5 条 → 定位到 CSS。

**新代码为什么对**

- 把掉的样式块原样补回（`.modal` / `.modal-card` / `.modal-actions` / `.veil` / `.controls.sys` /
  触摸命中区 / reduceMotion 豁免），并写清为什么它们是「能玩」的前提而不是装饰。
- 首屏不再自动弹玩法卡：去掉 `if (!prefs.seenHelp) openHelp();`。
  玩法卡本身一个没少 —— 顶栏「玩法」按钮、`h`/`?` 键、Esc 收起、点遮罩收起都在
  （README §玩法 的键位表）；去掉的只是「没看过就自动弹」这个触发器。
  自动引导把整局变成不可看不可玩，它和「棋盘立刻可玩」不能同时成立，而仓里自己的台架要求后者。

## 3. 台架那条过时的键位断言

`the h key asks for a hint` 按的是 `h`，但键位表（README §玩法：撤销 `u` · 提示 `g` · 重开 `r` ·
暂停 `p` · 静音 `m` · 全屏 `f` · `h`/`?` 帮助卡）里 `h` 已经是帮助卡、提示是 `g` ——
那条断言按的是一个会弹出玩法卡、根本不出提示的键。改成按 `g`，断言本身一条没 weakened：
仍是「按提示键后提示数恰好为 1」。

## 4. 减弱动效：两套机制合成一个

并线两侧各留了一个标志（一边叫 `motion`、另一边叫 `reduceMotion`）。真正驱动渲染的是 `motion`
（粒子/涟漪/晃动）；`reduceMotion` 那个**在渲染里没人读** —— 置位了也不影响任何画面，是个假开关。
现在合成一个：`motion = !reduceMotion`，`setReduceMotion` 就是 `setMotion` 的另一种说法，
两个对外名字都还能用。另补上并线漏掉的一步：订阅 `change` 之外先把初始值落一次
（否则首屏在「用户已要求减弱动效」的系统上仍会放粒子，要等用户拨一次开关才生效）。

## 5. 另三处并线欠账

- `pages.yml` 改成调 `tools/assemble-site.sh`（仓内唯一清单），不再自己手写 cp ——
  闸的 W2 就是管这件事的：CI 拷另一份清单，本地闸验的就不是上线那一份。
  `assemble-site.sh` 补上 `sw-register.js`，保持产物内容与改前一致
  （页面实际加载的是 `js/sw-register.js`，仓根那份是旧副本）。
- 部署集钉数 `EXPECT_CHECKS` 22→23、`EXPECT_ROWS` 41→42：并线新引入 1 条页面引用
  （`js/main.js` 的 `./audio.js`），逐条核过是真实存在、非 0 字节的文件，无引用丢失。
- 文档数字对齐现场：DESIGN §7 那两处断言行数的写法，旧值改到新值 103（storage 14→16）——旧值故意不
  写成「共 N 行断言」那道文法：`D12d` 把面里每一处这种文法都当成**现值**来对账，把历史数写进这种
  文法里，要么红在一句历史上，要么绿着指隔壁，两种都是谎；
  README 的 dev/verify 端口写成 `http://127.0.0.1:5181/`，裸 `node server.cjs` 的默认 5180
  保持原样（那是 `server.cjs` 里的真值）。

## 6. 真实文件清单

```
.github/workflows/pages.yml    1 增 4 删（改调 assemble-site.sh）
DESIGN.md                     2 增 2 删（断言行数 101→103）
README.md                     1 增 1 删（dev/verify 端口同源）
css/game.css                 41 增 0 删（补回并线丢掉的样式块）
index.html                    0 增 1 删（去掉重复的全屏按钮）
js/main.js                   94 增 135 删（全屏统一 + 动效订阅 + 去自动弹层）
js/view.js                   19 增 17 删（动效标志合成一个）
tools/assemble-site.sh        3 增 1 删（补 sw-register.js）
tools/deploy-set.mjs          2 增 2 删（钉数 22→23 / 41→42）
tools/playtest.mjs            5 增 2 删（提示键 h→g，按 README 键位表）
deliverable.md                本文件（审计报告里本仓的 `missing:deliverable.md` 欠账）
```

删行审计（`git diff --numstat 04bdc0a HEAD`）：共 170 删行，逐类 ——
`reduceMotion` 7 + `motionQuery` 7 + `applyReduceMotion` 5 + `setReduceMotion` 2 + `isReducedMotion` 1
（两套动效机制合成一套，**对外 API 两个名字都留着**）、
`toggleFullscreen` 4 + `bindFullscreen` 2 + `bootFullscreen` 3 + `fsRoot/fsElement/fsRequest/fsQuiet` 10
+ `syncFullscreen` 1（同名声明与它的 wiring，能力并进留下的那一份）、
`btn-fullscreen` 4（重复入口）、`seenHelp` 1 + `openHelp` 1（首屏自动弹层的触发器）、
`EXPECT_CHECKS/EXPECT_ROWS` 各 1（钉数随页面引用数走）。
关卡数据零删行：`js/data/lots.js` 未改。

## 7. 验收结论（本机现跑）

```
$ node z-biz-game-lead/003_辅助能力/polish/script/cos_load_sweep.js z-biz-game-hashi-cos
z-biz-game-hashi-cos                     | LOADED          ← 改前是 LOAD-ERROR
$ npm test --silent
7 个 .test.mjs：count 15 · game 13 · library 9 · logic 18 · model 20 · rng 12 · storage 16
合计 103 行断言，fail: 0
$ node tools/deploy-set.mjs
部署集：23 条引用（含 3 张位图尺寸核对），失败 0 项
rows: 42 fail: 0
$ node tools/deploy-set-selftest.mjs
DS_SELFTEST rc=0（0=每一刀都按预期发力、阴性对照按预期不发力）
$ node tools/doctest.mjs
合计 254 项，0 项失败
$ bash tools/verify.sh
knives: 16 fail: 0        （16 把刀各自逼红了点名的断言，复原逐字节一致，干净树对照双绿）
=== @boot ===    rows: 19 fail: []
=== @play ===    rows: 20 fail: []
=== @routes ===  rows: 13 fail: []
=== @save ===    rows: 12 fail: []
=== @pointer === rows: 20 fail: []
=== browser assertions: 84 ===
rows: 42 fail: 0
=== ALL GREEN ===
```

`verify.sh` 是本仓自己的整闸：node 套件 + 部署集闸 + 部署集自测 + doctest
+ sabotage 台账 + 真实浏览器（headless Chrome over CDP）五个场景逐条断言 + console 干净
+ 跑完无残留 Chrome。**ALL GREEN / rc=0**。改前浏览器、部署集、doctest 三条腿各自有红项。
两腿的规模是钉：doctest 的项数组名钉在自己的 `EXPECT_ROWS`/`EXPECT_GROUPS`，台账的刀数与文档抄的规模
由 `tools/verify.sh` 的 `DOCTEST_ROWS_EXPECT`/`DOCTEST_GROUPS_EXPECT`/`SABOTAGE_KNIVES_EXPECT` 和 README
门禁清单那一句共同对账（`D17b`、`D16b` 会把这几处逼成同一个数）。这一节因此不重抄它们——改了钉不回来改这里，
读它就不等于读数。真实浏览器那五段的行数只有跑它的人才知道，本仓的规矩是别把它的数字抄进文档当现值。

## 8. 行为变化，需知会

1. **首屏不再自动弹玩法卡**（去掉了「没看过就自动弹」这一个触发器）。
   玩法卡、顶栏「玩法」按钮、`h`/`?` 键、Esc 收起、点遮罩收起全部保留。
2. **全屏入口只剩一个**（系统控件条里的 `#fs`）；nav 里那个重复的 `#btn-fullscreen` 已去掉。
   键盘 `f` 仍然可用。
3. **提示键是 `g`**（README §玩法 早已这么写；台架那条按 `h` 的断言是过时的，已按键位表改正）。

## 9. 未实现 / 需人接手

- **视觉呈现仍需人眼**：本会话没有可用的页面截图比对工具，浮层/幕布/系统控件条的实际观感
  （居中、模糊、按钮态）只由闸的「console 干净 + 场景断言」覆盖，色感与留白没人看过。
- `assets/gen/make_art.py` 烤出来的位图（`assets/island.png` / `assets/particle.png`）
  在本次改动里一个字节没动。
- 审计报告（`z-biz-game-lead/001_项目认知/003_审计报告.md`）里本仓只挂着 `missing:deliverable.md`，
  本文件补上；`missing:LICENSE` / `missing:.github/workflows` 本仓不挂。
