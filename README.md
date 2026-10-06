# 数桥 · HASHI

Hashiwokakero（桥梁）：海里散落着标了数字的岛，你在岛与岛之间架桥，让**每座岛连出去的桥根数
正好等于它的数字**。桥只能沿行或沿列走、不能穿第三座岛、同两座岛之间最多两根、任意两桥不能交叉，
并且**所有岛必须连成一片**。四条规则全满足的那张桥图就是答案 —— 而这一局**只有一个**答案，
这是穷举计数器算出来的，不是标的。

```
   4 × 4（出厂题库的第一关 shoal-01）   Σp = 1+2+2+1 = 6 → 桥数 = Σp/2 = 3

        c=0    c=1    c=2    c=3
  r=0  ( 1 )══( 2 )
  r=1          ║             三根桥：①—② · ②┆③ · ③┆④
  r=2          ( 2 )          度数 1,2,2,1 全部对上 · 一条链连通 · 无交叉
  r=3          ( 1 )
```

上面这一张是 `node -e` 从 `js/data/lots.js` 里读出来重算的：`checkBridges` 返回
`ok:true, degrees:[1,2,2,1], components:1`，`countSolutions(spec, 3)` 返回 `count:1`。

## 玩法

* **唯一的交互是拖**：从一座岛拖到另一座岛。同一条线拖三次一个循环：
  `0 根 → 1 根 → 2 根 → 清空`。所以**第三次拖会把这座桥撤掉** —— 这条产品决定写在这里，
  因为它有个后果：`完成一盘所需的最少拖拽数`恰好等于桥根数 `Σp/2`，每拖一次只可能加一根。
* 被拒绝的拖拽**一次都不计**（不同行列、中间隔着第三座岛、会超过某座岛的数字、与已有桥交叉），
  所以屏上的"拖拽数"量的是玩法，不是手忙脚乱。
* `撤销` `u` · `提示` `h` · `重开` `r` · `Esc` 收起结算卡。提示给的是**出厂那份唯一解**里还没架的
  一根，跟着它不会走进死胡同，也不会把某座岛撑超数字。
* 结算分三档：`一次到位`（拖拽数不超过 Σp/2 且没要提示）· `桥路通畅`（多花 ≤2 拖）· `绕了远路`。
* 成绩只存在这台设备的浏览器里（一个 `localStorage` 键 `hashi.save.v1`），页底的
  `清空存档` 要点两次才算数。

## 屏上的四个数是谁算出来的

| 屏幕上 | 谁算的 | 怎么复现 |
| --- | --- | --- |
| `Σp`（标注"握手引理：必为偶数"） | `js/core/model.js` 的 `handshake()`：把每座岛的数字加起来，奇偶当场判 | `node test/model.test.mjs` |
| `桥数 n/Σp÷2` | 同一个恒等式的另一半：数一遍已架的桥根，和 `Σp/2` 对不上就是算错了 | `node test/game.test.mjs` |
| `解数 1`（"穷举计数器已证明唯一"） | `js/core/count.js`：带域传播剪枝的穷举计数器，数到 2 就停 | `node test/count.test.mjs`（与一个**不共享任何搜索代码**的 `3^槽` 全枚举对账） |
| `推理深度 k`（"规则求解器猜 k 层"） | `js/core/logic.js`：迭代加深，取的是**最小**猜测层数，不是某一次幸运 trace | `node test/logic.test.mjs` |

关卡本身来自构建期：`tools/bake.mjs` 先造一张连通的桥图，再读数字，再证唯一解，四道复核
（`checkSpec`、结构上界、重新计数、重新推 depth）全过才写进 `js/data/lots.js`。**浏览器不生成任何东西**，
只从这 32 关里挑 —— 成本实测见 `DESIGN.md` §5。

题库：`shoal 浅滩` 4×4·4-5 岛·深度 0 · `sound 内海` 5×5·6-7 岛·深度 1 ·
`archipelago 群岛` 6×6·8-9 岛·深度 2 · `ocean 远洋` 7×7·11-12 岛·深度 3，各 8 关。
这四行的"深度"是**量出来的出厂区间**（`TIERS_META`），不是生成器的愿望清单：`ocean` 的生成
门槛允许 3-4 层，实际出厂的 8 关全是 3 层。

外部锚点（不是本仓的实现，是它对得上公开事实的地方）：

* **握手引理**：任何图的度数和是偶数，`桥根数 = Σp/2` 是恒等式而不是估计 —— 每关出厂时都按它核过一遍。
* **结构上界** `p ≤ 2 × 方向数`（角 2 方向 → 最多 4，边 3 → 最多 6，内 4 → 最多 8）：违反它的数据连编译都过不去。
* **连通性是定义的一部分**，不是加分项：`test/fixture.mjs` 的 fixture A（3×3 四角，`p=[2,2,2,2]`）
  手工推出三条解 `[1,1,1,1]`、`[0,0,2,2]`、`[2,2,0,0]`，后两条每座岛的数字都对、根数都等于 `Σp/2=4`，
  只是把岛切成了两半 —— 忽略连通性的实现必须在这里说谎，而它在本仓会说谎（`count` 返回 3）。
* **策略书里流传的那条"数字等于方向数 ⇒ 全是单桥"是错的**，本仓不带它。反例就在同一份手工
  fixture 里（fixture X 的 3 号岛 `p=2`、两个方向，它那一根其实是 2 根），`test/logic.test.mjs:31`
  直接断言规则表里没有这条。带上它 `k` 会变小，那就不是"这盘要猜几层"了。

```bash
node test/count.test.mjs      # 手工 fixture + 全枚举对账 + 251 个擦线索变体
node test/balance.mjs         # 生成器的实测账：接受率、毫秒、被丢原因
bash tools/verify.sh          # node 层 + 一次真实 headless Chrome 的 5 段浏览器断言
```

## 跑起来

```bash
node server.cjs          # http://127.0.0.1:5181/ —— 零依赖静态服务器
npm run check            # node --check 全量（与 CI 的语法步骤同一文件集合）
npm test                 # 语法 + 7 个 node 测试文件
npm run balance          # 生成器的账，SEEDS=20 node test/balance.mjs 可加样本
bash tools/verify.sh     # node 层 + 真实 Chrome（boot play routes save pointer）
npm run bake             # 重新出题（会改写 js/data/lots.js，PER_TIER=12 可改每档数量）
npm run electron         # 桌面壳
```

零依赖、零打包器、零图片素材：`dependencies` 与 `devDependencies` 都是 `{}`，画面全部由
canvas 2D 程序绘制。ES module 需要 origin，所以双击 `index.html` 不是支持的玩法。

路由：`#/c/12` 战役第 12 关 · `#/lot/shoal-03` 分享某一关 · `#/daily` 当日题 ·
`#/random/archipelago/4kq2` 档位内随机。`#/daily` 用 `hashSeed(YYYY-MM-DD) % 32` 落在**固定题库**上，
所以同一天所有设备同一局，且页面加载时不做任何搜索；随机路由必须带 token，
不带 token 的裸 `#/random/shoal` 会被 `location.replace` 补一个，否则同一个链接每次打开都换题，
"分享"就成了假话。

## 六道闸

每个印出来的数字都得有人守着，闸本身的大小也得钉住 —— 缩水的闸不是闸。

| 闸 | 命令 | 它钉住什么 |
| --- | --- | --- |
| 引擎/逻辑 | `node test/<name>.test.mjs`（7 个文件） | 规则、计数器、深度、出厂题库的每一行 |
| balance | `node test/balance.mjs` | `DESIGN.md` §5 那张表的七个结构列逐位可复现 |
| doctest（文档数字闸） | `node tools/doctest.mjs` | 文档里每一个能现算的数：17 组 / 254 项等式，代码是基准 |
| sabotage（破坏试验台账） | `node tools/sabotage.mjs` | 破坏试验台账（16 把刀）：doctest 的十七个组一组一把（D11 那一组给不出最小刀，理由写在台账的文件头），每把打一组断言，逼红并点名它杀掉了哪一条 |
| playtest | `bash tools/verify.sh` | 真实 headless Chrome + 裸 CDP 的五段浏览器断言（`@boot @play @routes @save @pointer`） |
| CI | `.github/workflows/ci.yml` | 前四道在不开浏览器的 job 里跑，浏览器单独一个 job |

`bash tools/verify.sh` 会把两道文档闸跑在起浏览器**之前**，并把它们的 rc 与自己的规模钉
（`DOCTEST_ROWS_EXPECT` / `SABOTAGE_KNIVES_EXPECT`）一起折进结论；`ONLY=D5 node tools/doctest.mjs`
这类子集运行会逐组打 `NOTE`，不会静默跳过。

## 已知边界（诚实清单）

* **`k` 只在本仓内可比**。它定义在"本仓这 7 条规则 + 这个分支顺序 + 不用连通性做推理"之上；
  换一套更大的规则集（例如经典的"一组岛不能被切断"）同一批题会印出更小的数。`DESIGN.md` §4
  逐条列了规则表。
* **`reason()` 的猜测层数上限是 4**（`logic.js:54`），生成器按档位上限 +1 探。超过 4 层的候选
  记 `tooDeep` 丢掉，永远不会出厂 —— 也就是说本仓从没声称"7 层难度的题存在但我们不发"，
  只是它进不了这个池子。
* **出厂题库的线索不是最小化的**。正向构造只保证唯一，不保证每根线索都咬得住：
  对 32 关做"逐个擦掉一座岛的数字"共 **251 个变体**（`test/count.test.mjs:167`，断言逐台机器复现），
  其中 `shoal` 33 个、`sound` 54 个**全都仍然唯一解** —— 前两档没有一条线索是 load-bearing 的；
  上两档 164 个变体里 **31 个**擦掉就不再唯一。要"擦一条线索就多出解"，得上 `archipelago` 以上。
* **越大的档越难出题**，这是量出来的而不是感觉：`node test/balance.mjs`（默认 8 个种子）
  `shoal` 8/8 出、`sound` 8/8、`archipelago` 6/8、`ocean` 只有 **2/8**（6 个种子把 60 次重启全用光）。
  主要死因不是不唯一，而是 `offBand`（唯一但深度不落在该档窗口内）：`ocean` 274 个唯一候选里
  272 个 offBand。`tools/bake.mjs` 靠更大的种子预算（`SEED_LIMIT = PER_TIER × 60`）凑满 8 关。
* **R-minned 这条规则在出厂引擎里到不了**，而且是手工推出来的（域代数：闭包能写出的两值域只有
  `{0,1}`，其下限为 0，于是 `need == min` 就是 `need == 0`，被前一条分支 `R-satisfied` 吃掉）。
  它留着是因为规则集与计数器共用同一份 `propagate()`，删掉它等于给两条实现制造差异。
  `test/logic.test.mjs:124` 把这个论证写成了测试。
* 没有成就、排行榜、签到、内购、云存档；分享的只有谜题本身（`#/lot/<id>`，序列化的就是 spec）。

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高——文件图标读文件头，
  内联成 base64 的图标先解码再读同一段。后一条不是可选项：图标可能住在清单里而不是盘上的 `.png`
  （有的仓另有一条"零二进制文件"的承诺，那条只约束"有没有 .png 这个文件"）；如果 P 段只筛文件名，
  声明写 512 而真图 192 就一路放行。
- **钉住两个数**：R 段实际检查的路径条数（`22`）与这一次跑的断言条数（`40`），两个数
  都钉在 `tools/deploy-set.mjs` 顶部的那对常量里。没改页面却掉了，说明解析断了；删掉一张图标会同时
  少一条 R10 与那张的 P1/P2，所以两个数一起钉，断言条数能漂就是闸在缩水的信号。这一节故意只写数值、
  不写那对常量的名字，也不写别仓文档闸的编号：有的仓的文档闸会拿"文档里出现过的同名标识号"回数它
  自己的条数，还有的会把文档里点到的每个组编号逐个核对"这一轮真的发过"——两道闸共用一个名字，
  或者在本仓的文档里出现一个本仓没有的组编号，打红的都是不相干的那一边。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`22`、断言仍然 `40`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug /
X13 内联位图谎报尺寸——只在有靶子时下：X11/X12 要页面上那句 og:image，X13 要清单里真有一段 base64
图标，没有就打印 SKIP；反过来 X1 没有位图目录可砍时改砍 css，P 段一位都不核时台架直接报靶子不够），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑（取径真的会读的那支 JS / 那一张 CSS，不写死某一个仓的入口名），所以页面改了、仓与仓
不同，台架跟着走。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；本仓的整闸在 `tools/verify.sh` 的 `=== deploy-set ===` 那一段也各跑一次。它们红的时候并进本仓那条出口的退出码——这一条是这么证的：
把 ci.yml 里那行 `run: node tools/deploy-set.mjs` 砍掉，本仓整闸必须点名红且退出码非 0。
所以「本地全绿、线上 404 自己的 manifest / sw.js / 图标」这一类坏法在本地就会红。

## 在线试玩

<https://z-biz-game.github.io/z-biz-game-hashi-cos/>（`main` 分支推送即自动部署）
