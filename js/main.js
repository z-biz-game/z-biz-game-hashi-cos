// The shell: hash routes in, canvas out, records in between. Nothing here knows the rules of
// the sea — those live in js/core — and nothing here draws — that is js/view.js.

import { createGame, dragBridge, undo, reset, hint, grade, progress, won, REJECT } from './core/game.js';
import { checkBridges } from './core/model.js';
import { store, SAVE_KEY } from './core/storage.js';
import {
  TIERS, ALL, byId, levelAt, lotsIn, randomPuzzle, dailyPuzzle, tierByKey, stats as poolStats,
} from './core/library.js';
import { todayKey } from './core/rng.js';
import { createView } from './view.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('sea'), wipe: $('wipe'),
};

const LEVELS = ALL.length;
const app = {
  mode: 'campaign',
  index: 1,
  route: null,
  lot: null,
  game: null,
  label: '',
  day: null,
  lastHint: null,
};

const REJECT_LINE = {
  [REJECT.NO_SLOT]: '这两座岛不同排不同列，或者中间还压着一座岛 —— 桥不能那样架',
  [REJECT.CROSSING]: '这条线上已经横着别的桥了 —— 桥不许交叉',
  [REJECT.OVER]: '再架就超过数字了 —— 这座岛的桥数已经够了',
  [REJECT.FULL]: '这里已经放不下了',
};

function clampIndex(n) {
  return Math.min(LEVELS, Math.max(1, Number(n) || 1));
}

// #/c/12 · #/daily · #/random/shoal/4kq2 · #/lot/shoal-03
// The puzzle id is in the URL, so a shared link resolves to the same sea on another device
// without the receiver needing the sender's save file.
function parseHash(hash = location.hash) {
  const p = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'random') return { mode: 'random', tier: p[1] || TIERS[0].key, key: p[2] || null };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  const n = p[0] === 'c' || p[0] === 'campaign' ? Number(p[1]) : Number(p[0]);
  return { mode: 'campaign', index: clampIndex(n) };
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    const day = todayKey();
    return { lot: dailyPuzzle(day), label: `每日数桥 · ${day}`, note: day, day };
  }
  if (rt.mode === 'random') {
    const tier = tierByKey(rt.tier);
    return { lot: randomPuzzle(`${tier.key}|${rt.key}`, tier.key), label: `随机 · ${tier.label}`, note: tier.blurb };
  }
  if (rt.mode === 'lot') {
    const lot = byId(rt.id) || ALL[0];
    return { lot, label: `关卡 ${lot.id}`, note: tierByKey(lot.tier).blurb };
  }
  const lot = levelAt(rt.index - 1);
  return { lot, label: `第 ${rt.index} 关`, note: `共 ${LEVELS} 关 · ${tierByKey(lot.tier).label}` };
}

const view = createView(el.canvas, { onBridge: (a, b) => commit(a, b) });

function setGame(lot, label) {
  app.lot = lot;
  app.label = label || app.label;
  app.game = createGame(lot);
  view.attach(app.game);
  el.curtain.hidden = true;
  say('从一座岛拖到同排或同列的另一座岛：第一次架一根，再拖加到两根，第三次拆掉');
}

function say(html) {
  el.hintline.innerHTML = html;
}

function stars(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

function field(label, value, note, cls = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderCrumbs() {
  const tier = tierByKey(app.lot.tier);
  const g = app.game;
  const pr = progress(g);
  const rec = store.record(g.id);
  el.crumbs.innerHTML = `${app.label}<b>${tier.label}<span class="band"> ${tier.blurb}</span></b>`;
  el.readout.innerHTML = [
    field('Σp', g.sumP, '握手引理：必为偶数', 'sum'),
    field('桥数', `${pr.roots}/${g.target}`, '已架根数 / Σp÷2', pr.roots > g.target ? 'warn' : 'bridges'),
    field('解数', 1, '穷举计数器已证明唯一', 'proof'),
    field('推理深度', app.lot.k, `规则求解器猜 ${app.lot.k} 层`, 'depth'),
    field('拖动', g.drags, `最少 ${g.target} 次`, g.drags > g.target ? 'warn' : ''),
    field('最佳', rec && rec.best ? rec.best : '—', rec && rec.perfect ? '一次到位' : '你的纪录', ''),
  ].join('');
  el.undo.disabled = !g.drags || g.done;
  el.hint.disabled = g.done;
}

function renderTotals() {
  const s = store.stats;
  el.totals.innerHTML = `已通 <b>${Object.values(store.records).filter((r) => r.solved).length}</b>/${LEVELS}`
    + ` · 一次到位 <b>${Object.values(store.records).filter((r) => r.perfect).length}</b>`
    + ` · 提示 <b>${s.hints}</b>`;
}

function renderShelf() {
  if (app.mode === 'campaign') {
    const unlocked = store.unlocked;
    let html = '';
    for (const tier of TIERS) {
      html += `<p class="tier">${tier.label} · ${tier.blurb}</p>`;
      for (const lot of lotsIn(tier.key)) {
        const n = ALL.indexOf(lot) + 1;
        const rec = store.record(lot.id);
        const cls = [
          n === app.index ? 'here' : '',
          rec && rec.perfect ? 'perfect' : rec && rec.solved ? 'done' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" data-index="${n}" class="${cls}" ${n > unlocked ? 'disabled' : ''}>${n}</button>`;
      }
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-index]').forEach((b) => {
      b.addEventListener('click', () => go(`#/c/${b.dataset.index}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="tier">选一片海域</p>';
    for (const tier of TIERS) {
      const on = tier.key === app.route.tier ? 'here' : '';
      html += `<button type="button" class="${on}" data-tier="${tier.key}">${tier.label}<br><small>${tier.blurb}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一片海</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-tier]').forEach((b) => {
      b.addEventListener('click', () => go(`#/random/${b.dataset.tier}/${token()}`));
    });
    el.shelf.querySelector('[data-reroll]').addEventListener('click', () => go(`#/random/${app.route.tier}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="tier">今天这一局对所有人相同${done ? ' · 已通过' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到战役 第 ${store.unlocked} 关</button>`;
  } else {
    el.shelf.innerHTML = '<p class="tier">分享的关卡</p>';
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go(`#/c/${store.unlocked}`));
}

function token() {
  return Math.random().toString(36).slice(2, 8);
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === app.mode));
  });
  renderCrumbs();
  renderTotals();
  renderShelf();
}

// The one place a bridge happens: the drag from the view, the replay from a test, and the
// hint's own suggestion all arrive here, and all of them go through js/core/game.js.
function commit(a, b) {
  const g = app.game;
  const r = dragBridge(g, a, b);
  if (!r.ok) {
    if (r.slot >= 0) view.shakeSlot(r.slot);
    view.redraw();
    renderCrumbs();
    const line = REJECT_LINE[r.reason] || '这一拖不成立';
    say(`<span class="bad">${line}</span>`);
    return false;
  }
  renderCrumbs();
  if (g.done) finish();
  else {
    const pr = progress(g);
    say(`架了 ${r.action === 'clear' ? '一次（拆掉）' : `第 ${r.at} 根`} · 已用根数 ${pr.roots}/${g.target}`
      + (pr.satisfied === g.comp.n && !pr.connected ? ' · <b>数字都满足了，但岛屿还没连成一片</b>' : ''));
  }
  return true;
}

function finish() {
  const lot = app.lot;
  const g = app.game;
  const rec = store.solve(lot.id, { drags: g.drags, target: g.target, hints: g.hints });
  if (app.day) store.markDaily(app.day, lot.id);
  let nextIndex = 0;
  if (app.mode === 'campaign') {
    store.unlock(Math.max(store.unlocked, app.index + 1));
    nextIndex = app.index < LEVELS ? app.index + 1 : 0;
  }
  const gr = grade(g);
  el.stars.textContent = stars(gr.stars);
  el.verdict.textContent = gr.label;
  el.tally.innerHTML = `你的 <b>${g.drags}</b> 次拖动 · 恒等式最少 <b>${g.target}</b> 次 · 提示 <b>${g.hints}</b>`
    + (rec.best === g.drags ? '<br>这是这一关的最好成绩' : '');
  el.next.hidden = !nextIndex;
  el.curtain.hidden = false;
  view.celebrate();
  render();
}

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    // A bare #/random/shoal would mean a different puzzle on every visit and an unreproducible
    // link, so the token is minted once and written back into the URL.
    location.replace(`${location.pathname}${location.search}#/random/${rt.tier}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.lot) {
    say('这一档还没有烤好的关卡');
    return;
  }
  app.day = r.day || null;
  app.index = rt.mode === 'campaign' ? rt.index : ALL.indexOf(r.lot) + 1;
  setGame(r.lot, r.label);
  render();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#/lot/${app.lot.id}`;
  const done = () => toast('链接已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => toast(url));
  } else {
    toast(url);
  }
}

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'campaign') go(`#/c/${clampIndex(store.unlocked)}`);
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${TIERS[0].key}/${token()}`);
});

el.undo.addEventListener('click', () => {
  if (undo(app.game)) {
    view.redraw();
    renderCrumbs();
    if (app.game.drags === 0) say('回到起点');
  }
});

el.hint.addEventListener('click', () => {
  const h = hint(app.game);
  app.lastHint = h;
  if (!h) {
    say('已经没有什么可提示的了 —— 要么已经连成一片，要么这一拖得由你自己拆');
    return;
  }
  view.showHint(h);
  say(`提示：在 <b>${h.a}↔${h.b}</b> 号岛之间架到 <b>${h.add}</b> 根 —— 还差 <b>${h.left}</b> 根`);
  renderCrumbs();
});

function restart() {
  reset(app.game);
  el.curtain.hidden = true;
  view.attach(app.game); // resets the shake/hint state as well as the bridges
  render();
  say('回到起点');
}

el.restart.addEventListener('click', restart);
el.share.addEventListener('click', shareLink);
el.again.addEventListener('click', restart);
el.next.addEventListener('click', () => go(`#/c/${Math.min(LEVELS, app.index + 1)}`));

// Wiping the save is the one destructive thing this game can do, so it asks twice instead of
// firing on a stray click.
let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => { wipeArmed = false; }, 4000);
    return;
  }
  store.reset();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'escape' && !el.curtain.hidden) el.curtain.hidden = true;
  else if (k === 'u') el.undo.click();
  else if (k === 'h') el.hint.click();
  else if (k === 'r') el.restart.click();
});

view.start();
// Deliberately not paused on visibilitychange: the hint pulse, the refused-drag shake and the win
// card are driven from the same loop, and a tab that reports itself hidden (headless Chrome does)
// must still be able to finish a puzzle.
apply();

window.hashi = {
  version: 1,
  get state() {
    const g = app.game;
    const pr = g ? progress(g) : null;
    return {
      mode: app.mode,
      label: app.label,
      id: app.lot && app.lot.id,
      tier: app.lot && app.lot.tier,
      index: app.index,
      k: app.lot && app.lot.k,
      sumP: g && g.sumP,
      target: g && g.target,
      roots: pr && pr.roots,
      islands: g && g.comp.n,
      slots: g && g.comp.nSlots,
      satisfied: pr && pr.satisfied,
      connected: pr && pr.connected,
      crossings: pr && pr.crossings,
      drags: g && g.drags,
      hints: g && g.hints,
      // `done` is re-derived from the validator on every read, and `flag` is the latch the last
      // drag left behind. They are the same fact twice, by two code paths: the panel reports the
      // rules, the drag loop reports itself. The browser suite asserts they agree — a win card on a
      // board the validator rejects, or a solved board that never reports, both fail there instead
      // of on screen.
      done: !!(g && won(g)),
      flag: !!(g && g.done),
      unlocked: store.unlocked,
      solved: Object.values(store.records).filter((r) => r.solved).length,
      curtain: !el.curtain.hidden,
      grid: view.gridSize(),
    };
  },
  get pool() { return poolStats(); },
  load(hash) { go(hash); return app.lot && app.lot.id; },
  // Client pixels of an island centre, and of a bare cell: what an automated finger needs so it
  // presses the island instead of re-deriving the layout maths.
  islandPoint(i) { return view.islandPoint(i); },
  cellPoint(r, c) { return view.cellPoint(r, c); },
  lot() { return app.lot ? JSON.parse(JSON.stringify(app.lot.spec)) : null; },
  slots() {
    if (!app.game) return null;
    return app.game.comp.slots.map((s) => ({ i: s.i, a: s.a, b: s.b, kind: s.kind, crosses: s.crosses.slice() }));
  },
  bridges() { return app.game ? Array.from(app.game.bridges) : null; },
  solution() { return app.lot ? app.lot.solution.slice() : null; },
  // The clues in *compiled* order — the same order the slot list uses. `lot()` hands back the
  // serialised spec, whose islands are in write order, so a test that pairs slot endpoints with
  // numbers has to read them from here rather than sorting the spec by hand and hoping.
  numbers() { return app.game ? Array.from(app.game.comp.p) : null; },
  // The shipped validator, on demand: the browser suite uses it to show that a board with every
  // number met but the islands split in two still comes out `false`.
  check() { return app.game ? checkBridges(app.game.spec, app.game.bridges) : null; },
  // `won` is the game layer's own question — "is *this puzzle* finished" — so the shell asks it
  // rather than reaching past it into the model. The rules of the game live in js/core/game.js.
  isValid() { return app.game ? won(app.game) : false; },
  // The certified unique solution of this puzzle, recomputed here so a test can prove the
  // browser agrees with the number printed on screen.
  play(edges) {
    let applied = 0;
    for (const e of edges || []) {
      const n = Number(e.n === undefined ? 1 : e.n);
      for (let k = 0; k < n; k++) {
        if (commit(e.a, e.b)) applied++;
        else break;
      }
    }
    return applied;
  },
  hintOnce() {
    el.hint.click();
    return { hints: app.game.hints, line: el.hintline.textContent, hint: app.lastHint };
  },
  store,
  // The one localStorage key this game owns, published rather than duplicated. The @save suite has
  // to read and delete *the real key* to show a solve survived a reload and that 清空存档 actually
  // removed it; hard-coding the string in the rig instead would let a rename in js/core/storage.js
  // pass as "the save file is gone" while the old key was still sitting there.
  saveKey: SAVE_KEY,
};

// ---- 全屏开关 ----
//
// 绑到 index.html 的 HUD 里真实存在的 #btn-fullscreen。
// 只在 js 里留一串 requestFullscreen 能骗过字符串扫描，但按钮不在 DOM 里就是死代码：
// 玩家按不到，功能等于没做。所以 id 必须与 HTML 里的按钮对得上，缺失时要在控制台喊出来。
//
// 三套 API 一律**特性探测**，不做 UA 判断：iPhone 版 Safari 压根没有元素全屏（只有 <video> 能全屏），
// 老 Edge 只认 ms 前缀，Firefox 认 moz 前缀。UA 字符串是猜的，方法在不在是量的，猜错就静默失效。
function fsRoot() {
  return document.documentElement;
}

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function fsRequest(root) {
  // 老 Edge 的 msRequestFullscreen 挂在元素上，和标准名同一个位置，所以并排取即可。
  return root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen || null;
}

// iOS Safari 会把非 video 元素的请求直接 reject 成 NotAllowedError。
// 这个 promise 没人接就升级成 unhandledrejection，冒到 window.onerror——离屏预载时足以把整页判死。
// 因此凡是可能返回 promise 的调用，返回值一律就地吞掉，绝不让拒绝逃出这一层。
function fsQuiet(p) {
  if (p && typeof p.catch === 'function') p.catch(() => {});
  return p;
}

// 返回 true=请求进入，false=请求退出，null=不支持（调用方据此禁用按钮）。
function toggleFullscreen(root) {
  const req = fsRequest(root);
  if (!req) return null;
  if (fsElement()) {
    // 退出侧同样要兜底：老 Edge 是 msExitFullscreen；万一三者皆无就当无事发生，不抛。
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) fsQuiet(exit.call(document));
    return false;
  }
  // 部分实现（如被 Permissions-Policy 挡住的 iframe）会同步抛，所以 catch 和 .catch 两头都要接。
  try {
    fsQuiet(req.call(root));
  } catch (err) {
    // 拒绝即降级：静默保持当前形态，不冒泡、不打断这一局的其余逻辑。
  }
  return true;
}

function bindFullscreen(btn) {
  const root = fsRoot();

  // 状态回写：Esc 和 iOS 下滑手势退出时不会经过按钮，
  // 只有 fullscreenchange 事件能把按钮的文案/字形拉回正确状态，否则它会一直假装自己在全屏里。
  const sync = () => {
    const on = !!fsElement();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    btn.title = on ? "退出全屏 (F)" : "全屏 (F)";
    document.body.classList.toggle('is-fullscreen', on);
    return on;
  };

  if (!fsRequest(root)) {
    // 不支持就要说明为什么：只把按钮变灰，玩家会以为这活根本没做完。
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」）';
    return;
  }

  btn.addEventListener('click', () => {
    toggleFullscreen(root);
    sync();
  });

  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // 正在输入框里打字时不劫持按键，否则会打不出 f。
    if (ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName)) return;
    if (ev.key === "f" || ev.key === "F") {
      ev.preventDefault();
      toggleFullscreen(root);
      sync();
    }
  });

  sync();
}

function bootFullscreen() {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) {
    // 按钮被谁删掉了？在控制台喊出来，别让这个坑静默地烂在下一棒手里。
    console.warn('[fullscreen] index.html 里找不到 #' + "btn-fullscreen" + '，全屏开关没有入口');
    return;
  }
  bindFullscreen(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFullscreen);
} else {
  bootFullscreen();
}

// ---- 减弱动效（prefers-reduced-motion）----
//
// 跟住系统设置，而且**运行中改设置要立刻生效**：只读一次 matchMedia 不够，玩家在系统里
// 把开关拨回来，页面还停在上一次读到的答案上。addEventListener 是标准接口，老 Safari 只有
// addListener —— 特性探测，不做 UA 判断。
const motionQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)') : null;
function applyReduceMotion(on) { view.setReduceMotion(on); }
if (motionQuery) {
  applyReduceMotion(motionQuery.matches);
  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', (e) => applyReduceMotion(e.matches));
  } else if (typeof motionQuery.addListener === 'function') {
    motionQuery.addListener((e) => applyReduceMotion(e.matches));
  }
}
window.hashi.setReduceMotion = applyReduceMotion;
window.hashi.isReducedMotion = () => view.isReducedMotion();
