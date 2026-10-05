// Canvas renderer + pointer handling. This file owns pixels and gestures and decides nothing
// about legality: on release it hands js/main.js a pair of island indices, and js/core/game.js
// either applies the 0->1->2->0 cycle or refuses and asks for a shake.
//
// Everything is drawn procedurally — sea, islands, bridges — and the three baked textures from
// assets/gen/make_art.py only lay on top: if they are missing or fail to decode, the board still
// renders. A single bridge is one stroke; a double bridge is two strokes laid side by side, which
// is the only convention in this file a player has to learn.
//
// The drag is the whole interaction: press an island, pull along its row or column, and the
// target is the *nearest island on that ray*. That is what makes an over-drag harmless — pull
// eight cells past the target and the ray still names the same island, so the clamp lives in the
// geometry rather than in a second copy of the rules.

const PAD = 22;
const LAND = '#f2e3c2';
const LAND_EDGE = '#b8985f';
const INK = '#22242b';
const BRIDGE = '#e8eef6';
const BRIDGE_EDGE = 'rgba(12, 20, 34, 0.55)';
const HI = '#78dcff';
const WARN = '#ff7a6b';
const SEA_TOP = '#132a44';
const SEA_BOTTOM = '#0b1526';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createView(canvas, { onBridge } = {}) {
  const ctx = canvas.getContext('2d');
  let game = null;
  let geom = { cell: 40, ox: 20, oy: 20, vw: 320, vh: 320 };
  let drag = null; // { from, axis, dir, target, x, y }
  let hint = null; // { slot, a, b, until }
  let shake = null; // { slot, until } — a refused drag, drawn as a short wobble
  let raf = 0;
  let last = 0;
  // 定步长仿真：帧 dt 只进累加器，积分一律按 SIM_STEP 走。显式欧拉（先位移后加重力）在帧 dt 下
  // 每帧少算半格冲量，30Hz 与 120Hz 跑同一虚拟时长会差出几十像素；粒子消亡时刻也会被帧网格量化。
  const SIM_STEP = 1 / 120;
  let accum = 0;
  let simSteps = 0;
  let motion = true; // prefers-reduced-motion:false → 允许粒子/涟漪/抖动
  let paused = false;
  const particles = [];

  // 真位图资产（由 assets/gen/make_art.py 烤出）。加载失败或环境无 Image 时保持 false，
  // 渲染回落到程序化绘制 —— 资产是增强，不是依赖。
  const tex = { sea: false, island: false, spark: false };
  const img = {};
  function loadTex(key, src, flag) {
    if (typeof Image === 'undefined') return;
    const im = new Image();
    im.onload = () => { tex[flag] = true; draw(); };
    im.onerror = () => { tex[flag] = false; };
    im.src = src;
    img[key] = im;
  }
  loadTex('sea', 'assets/sea-tile.png', 'sea');
  loadTex('island', 'assets/island.png', 'island');
  loadTex('spark', 'assets/particle.png', 'spark');

  function measure() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = Math.max(200, Math.round(box.width));
    const H = Math.max(200, Math.round(box.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game) return;
    const comp = game.comp;
    const cell = Math.max(22, Math.floor(Math.min((W - PAD * 2) / comp.w, (H - PAD * 2) / comp.h)));
    geom = {
      cell,
      ox: Math.round((W - cell * comp.w) / 2),
      oy: Math.round((H - cell * comp.h) / 2),
      vw: W,
      vh: H,
    };
    draw();
  }

  const center = (isl) => ({
    x: geom.ox + isl.c * geom.cell + geom.cell / 2,
    y: geom.oy + isl.r * geom.cell + geom.cell / 2,
  });
  const radius = () => geom.cell * 0.3;

  function localPoint(ev) {
    const box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  function toClient(x, y) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.round(box.left + x), y: Math.round(box.top + y), cell: geom.cell, r: radius() };
  }

  // The nearest island strictly inside the ray leaving `from` along `axis` in direction `dir`.
  // Geometric on purpose: "is this pair joinable at all" is a rule, and rules live in js/core.
  function rayTarget(from, axis, dir) {
    const isl = game.comp.islands[from];
    let best = -1;
    let bestGap = Infinity;
    game.comp.islands.forEach((x, i) => {
      if (i === from) return;
      if (axis === 'h') {
        if (x.r !== isl.r || (x.c - isl.c) * dir <= 0) return;
        const gap = Math.abs(x.c - isl.c);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      } else {
        if (x.c !== isl.c || (x.r - isl.r) * dir <= 0) return;
        const gap = Math.abs(x.r - isl.r);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
    });
    return best;
  }

  function islandAt(p) {
    if (!game) return -1;
    // 命中半径抬到 22px（44px 盒），但不越过半个格距：越过之后落在两座岛之间的*海面*上
    // 的按下也会被最近的岛吃掉，那是"点海面出岛"。所以取两者较小值 —— 密集盘面（7×7 在
    // 300px 画布里格距只有 36px）能拿到的上限就是格距本身，再放大会吃掉邻岛。
    const rr = Math.max(radius() * 1.4, Math.min(22, geom.cell * 0.5));
    let found = -1;
    let best = Infinity;
    game.comp.islands.forEach((x, i) => {
      const c = center(x);
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (Math.abs(c.x - p.x) <= rr && Math.abs(c.y - p.y) <= rr && d < best) {
        best = d;
        found = i;
      }
    });
    return found;
  }

  function down(ev) {
    if (!game || game.done || paused) return;
    const p = localPoint(ev);
    const from = islandAt(p);
    if (from < 0) return;
    drag = { from, axis: null, dir: 0, target: -1, x: p.x, y: p.y };
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* a browser that refuses capture still drags fine inside the canvas */
      }
    }
    draw();
    ev.preventDefault();
  }

  function move(ev) {
    if (!drag) return;
    const p = localPoint(ev);
    const isl = game.comp.islands[drag.from];
    const c = center(isl);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    // Dominance, not proximity: the axis follows how far the finger has travelled, so a drag
    // that leaves the island diagonally still means something.
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    const along = axis === 'h' ? dx : dy;
    drag.axis = axis;
    drag.dir = along >= 0 ? 1 : -1;
    drag.target = Math.abs(along) > geom.cell * 0.45 ? rayTarget(drag.from, axis, drag.dir) : -1;
    drag.x = p.x;
    drag.y = p.y;
    draw();
    ev.preventDefault();
  }

  function up(ev) {
    if (!drag) return;
    const { from, target } = drag;
    drag = null;
    if (ev) ev.preventDefault();
    if (target >= 0 && onBridge) onBridge(from, target);
    else draw();
  }

  function bridgeEnds(s, offset) {
    const a = center(game.comp.islands[s.a]);
    const b = center(game.comp.islands[s.b]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const gap = radius() + Math.max(2, geom.cell * 0.06);
    const px = -uy * offset;
    const py = ux * offset;
    return {
      x1: a.x + ux * gap + px,
      y1: a.y + uy * gap + py,
      x2: b.x - ux * gap + px,
      y2: b.y - uy * gap + py,
    };
  }

  function strokeBridge(x1, y1, x2, y2, width, color) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = BRIDGE_EDGE;
    ctx.lineWidth = width + 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawSea() {
    const { vw, vh } = geom;
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, SEA_TOP);
    g.addColorStop(1, SEA_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    // 真海纹 tile（assets/sea-tile.png）：加载成功才叠，低透明度盖在渐变上；未加载则纯程序化。
    if (tex.sea && img.sea) {
      try {
        const pat = ctx.createPattern(img.sea, 'repeat');
        if (pat) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, vw, vh);
          ctx.restore();
        }
      } catch (err) {
        /* createPattern 在个别环境对未解码图会抛，忽略即可 */
      }
    }
    // swell: a fixed pattern of short arcs, so the sea reads as water and not as a wallpaper
    ctx.strokeStyle = 'rgba(140, 190, 230, 0.10)';
    ctx.lineWidth = 1.5;
    const step = Math.max(26, geom.cell * 0.72);
    for (let y = step / 2, row = 0; y < vh; y += step, row++) {
      ctx.beginPath();
      for (let x = 0; x <= vw; x += 8) {
        const yy = y + Math.sin((x + row * 37) / 26) * 2.2;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }

  function drawGrid() {
    const comp = game.comp;
    const { cell, ox, oy } = geom;
    ctx.fillStyle = 'rgba(9, 16, 28, 0.35)';
    roundRect(ctx, ox - 10, oy - 10, cell * comp.w + 20, cell * comp.h + 20, 14);
    ctx.fill();
    ctx.fillStyle = 'rgba(150, 200, 240, 0.07)';
    for (let r = 0; r < comp.h; r++) {
      for (let c = 0; c < comp.w; c++) {
        ctx.beginPath();
        ctx.arc(ox + c * cell + cell / 2, oy + r * cell + cell / 2, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawBridge(s, now) {
    const n = game.bridges[s.i];
    const hinted = hint && hint.slot === s.i;
    const wobbling = shake && shake.slot === s.i;
    const width = Math.max(2.5, geom.cell * 0.075);
    const color = wobbling ? WARN : hinted ? HI : BRIDGE;
    const t = wobbling ? (shake.until - now) / 260 : 0;
    const off = wobbling && motion ? Math.sin(now / 24) * 3 * Math.max(0, t) : 0;
    if (n === 1) {
      const e = bridgeEnds(s, 0);
      strokeBridge(e.x1 + off, e.y1, e.x2 + off, e.y2, width, color);
      return;
    }
    if (n === 2) {
      const gap = width * 1.15;
      for (const side of [-gap, gap]) {
        const e = bridgeEnds(s, side);
        strokeBridge(e.x1 + off, e.y1, e.x2 + off, e.y2, width * 0.86, color);
      }
    }
  }

  function drawIsland(i, now) {
    const comp = game.comp;
    const isl = comp.islands[i];
    const c = center(isl);
    const r = radius();
    const p = comp.p[i];
    const deg = (() => {
      let d = 0;
      for (const s of comp.inc[i]) d += game.bridges[s.i];
      return d;
    })();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = LAND;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LAND_EDGE;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // 真岛屿 sprite（assets/island.png）：加载成功就盖在程序化沙盘上，透明留白按半径缩放。
    if (tex.island && img.island) {
      try {
        const box = r * 2.6;
        ctx.drawImage(img.island, c.x - box / 2, c.y - box / 2, box, box);
      } catch (err) {
        /* 图未解码时 drawImage 会抛，忽略，保留程序化沙盘 */
      }
    }

    // satisfied islands get a ring the colour of the number's own state: met = cyan, over = red
    if (p >= 0 && !game.done) {
      if (deg === p) ctx.strokeStyle = 'rgba(120, 220, 255, 0.75)';
      else if (deg > p) ctx.strokeStyle = 'rgba(255, 122, 107, 0.85)';
      else ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (hint && (hint.a === i || hint.b === i)) {
      if (motion) {
        const t = (now % 900) / 900;
        ctx.strokeStyle = `rgba(120, 220, 255, ${(0.85 - t * 0.55).toFixed(3)})`;
        ctx.lineWidth = 2 + t * 4;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 5 + t * 6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(120, 220, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (drag && drag.from === i) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.font = `600 ${Math.round(r * 1.15)}px ${'"SF Mono", Menlo, Consolas, monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p < 0 ? '?' : String(p), c.x, c.y + 1);
  }

  function drawPreview() {
    if (!drag || !drag.axis) return;
    const isl = game.comp.islands[drag.from];
    const c = center(isl);
    const r = radius();
    const target = drag.target >= 0 ? center(game.comp.islands[drag.target]) : null;
    const ex = target ? target.x : drag.x;
    const ey = target ? target.y : drag.y;
    const dx = ex - c.x;
    const dy = ey - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(232, 238, 246, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(c.x + ux * r, c.y + uy * r);
    ctx.lineTo(ex - ux * (target ? r : 0), ey - uy * (target ? r : 0));
    ctx.stroke();
    ctx.restore();
  }

  // 确定性伪随机：通关粒子的初速度用固定种子的 LCG，而不是 Math.random，
  // 这样帧率对拍能在 30/60/120Hz 下复现出逐位相同的粒子态。
  let _seed = 0x9e3779b9;
  function psrnd() {
    _seed = (_seed + 0x6d2b79f5) >>> 0;
    let t = _seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function spawnParticles(n) {
    if (!motion) return; // reduceMotion：不放粒子
    const cx = game ? geom.ox + (game.comp.w * geom.cell) / 2 : geom.vw / 2;
    const cy = game ? geom.oy + (game.comp.h * geom.cell) / 2 : geom.vh / 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + psrnd() * 0.35;
      const sp = 120 + psrnd() * 170;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70, life: 0.9 + psrnd() * 0.5, max: 1.4 });
    }
  }

  // 帧率无关：位移用 x += v*dt，阻尼用 Math.pow(k, dt*60) —— 30/60/120Hz 下同一虚拟时长结果一致。
  function stepParticles(dt) {
    const G = 520;
    const damp = Math.pow(0.92, dt * 60);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += G * dt;
      p.vx *= damp;
      p.vy *= damp;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    if (!particles.length) return;
    ctx.save();
    for (const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      if (tex.spark && img.spark) {
        const s = 10 + 8 * a;
        ctx.globalAlpha = a;
        ctx.drawImage(img.spark, p.x - s / 2, p.y - s / 2, s, s);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = HI;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + 2 * a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!game) {
      drawSea();
      return;
    }
    const now = performance.now();
    drawSea();
    drawGrid();
    for (const s of game.comp.slots) drawBridge(s, now);
    for (let i = 0; i < game.comp.n; i++) drawIsland(i, now);
    drawPreview();
    drawParticles();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused) {
      last = now; // 暂停：只对齐时钟，仿真（粒子/涟漪/抖动计时）一律不推进
      return 0;
    }
    if (!last) last = now; // 兜底：没有上一帧时间戳时不补算（start/恢复都已播种）
    // 帧 dt 只进累加器（超过 50ms 的长帧被夹住：切回标签页不追帧）。这里必须吃真实 elapsed：
    // 写成常量步长等于让仿真按帧数推进，120Hz 的机器会跑成 30Hz 的三倍速。
    const elapsed = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    accum += elapsed;
    while (accum >= SIM_STEP - 1e-9) {
      accum -= SIM_STEP;
      simSteps += 1;
      if (particles.length) stepParticles(SIM_STEP);
    }
    if (hint && now >= hint.until) hint = null;
    if (shake && now >= shake.until) shake = null;
    if (drag || hint || shake || particles.length) draw();
    return elapsed;
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // 回落：没有 PointerEvent 的环境（老 Safari、部分 WebView）里 touch/mouse 仍要能拖出桥。
  // 坐标换算复用同一条 localPoint（getBoundingClientRect + clientX），所以手机缩放画布时
  // 不会出现"点 A 打 B"。
  if (typeof window === 'undefined' || typeof window.PointerEvent === 'undefined') {
    const asPoint = (ev) => {
      const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || ev;
      return {
        clientX: t.clientX, clientY: t.clientY, pointerId: 0,
        preventDefault: () => { if (ev.preventDefault) ev.preventDefault(); },
      };
    };
    canvas.addEventListener('touchstart', (ev) => down(asPoint(ev)), { passive: false });
    canvas.addEventListener('touchmove', (ev) => move(asPoint(ev)), { passive: false });
    canvas.addEventListener('touchend', (ev) => up(asPoint(ev)), { passive: false });
    canvas.addEventListener('touchcancel', (ev) => up(asPoint(ev)), { passive: false });
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', up);
  }

  return {
    attach(next) {
      game = next;
      drag = null;
      hint = null;
      shake = null;
      particles.length = 0;
      accum = 0; // 重开/换关：累加器余量不能带进新局
      measure();
    },
    measure,
    redraw: draw,
    // Where an automated finger has to press to grab island `i`, in client pixels.
    islandPoint(i) {
      if (!game || i < 0 || i >= game.comp.n) return null;
      const c = center(game.comp.islands[i]);
      return { ...toClient(c.x, c.y), r: radius(), cell: geom.cell };
    },
    // Centre of a grid cell in client pixels — used by the rig to press the open sea.
    cellPoint(r, c) {
      return toClient(geom.ox + c * geom.cell + geom.cell / 2, geom.oy + r * geom.cell + geom.cell / 2);
    },
    gridSize() {
      return game ? `${game.comp.w}×${game.comp.h}` : '';
    },
    showHint(h) {
      hint = { ...h, until: performance.now() + 3000 };
      draw();
    },
    shakeSlot(slot) {
      shake = { slot, until: performance.now() + 260 };
      draw();
    },
    celebrate() {
      hint = null;
      shake = null;
      spawnParticles(28);
      draw();
    },
    setPaused(v) {
      paused = !!v;
      // 暂停键可能在拖拽中途按下：那一拖直接作废，否则冻结的盘面上会留一条虚线预览。
      if (paused && drag) { drag = null; draw(); }
      // 恢复时把时钟播到"现在"：暂停期间那一段不补算，而恢复后到下一帧之间的真实时长要算，
      // 否则丢掉的那一帧 dt 会随刷新率变化（30Hz 丢 33ms、120Hz 丢 8ms）——那是帧率依赖。
      if (!paused) last = performance.now();
    },
    isPaused() { return paused; },
    isMotion() { return motion; },
    setMotion(v) {
      motion = !!v;
      if (!motion) particles.length = 0;
      draw();
    },
    particleCount() { return particles.length; },
    // 帧率对拍的读数口：步号是"仿真推进了多少"的唯一诚实单位（虚拟秒会被帧网格量化）。
    simInfo() { return { steps: simSteps, accum, step: SIM_STEP, particles: particles.length }; },
    // 帧率对拍用的确定性钩子：同一批粒子分别按 30/60/120Hz 的步长喂 stepParticles，
    // 比较最终位置是否一致（dt 无关性）。
    testSpawn(n) { spawnParticles(n); },
    testStep(dt) { stepParticles(dt); },
    testParticles() { return particles.map((p) => ({ x: p.x, y: p.y, life: p.life })); },
    start() {
      if (!raf) {
        last = performance.now(); // 播种首帧：留 0 会让第一帧算出 dt=0，丢的时长随刷新率变
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
