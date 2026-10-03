// Canvas renderer + pointer handling. This file owns pixels and gestures and decides nothing
// about legality: on release it hands js/main.js a pair of island indices, and js/core/game.js
// either applies the 0->1->2->0 cycle or refuses and asks for a shake.
//
// Everything is drawn procedurally — sea, islands, bridges — so the repo ships zero image assets.
// A single bridge is one stroke; a double bridge is two strokes laid side by side, which is the
// only convention in this file a player has to learn.
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

  // ---- 减弱动效（prefers-reduced-motion）----
  // 被拒的一拖会左右摆：off = Math.sin(now / 24) * 3 * 衰减，是一段纯装饰的来回位移。
  // 减弱动效下**只把位移钉成 0，不动颜色**：那座桥此时正画成 WARN 橙，而 WARN 橙是
  // "刚才这一拖不成立"唯一的画面证据；连它一起关掉，玩家就只剩一句读数，棋盘上却毫无异样。
  // 与 ferry-cos 同口径：晃动是装饰，告警色是反馈。
  let reduceMotion = false;

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
    const rr = radius() * 1.4;
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
    if (!game || game.done) return;
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
    const off = wobbling && !reduceMotion ? Math.sin(now / 24) * 3 * Math.max(0, t) : 0;
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
      const t = (now % 900) / 900;
      ctx.strokeStyle = `rgba(120, 220, 255, ${(0.85 - t * 0.55).toFixed(3)})`;
      ctx.lineWidth = 2 + t * 4;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 5 + t * 6, 0, Math.PI * 2);
      ctx.stroke();
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
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, now - (last || now));
    last = now;
    if (hint && now >= hint.until) hint = null;
    if (shake && now >= shake.until) shake = null;
    if (drag || hint || shake) draw();
    return dt;
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    // The gate the runtime pref flip lands on: idempotent, and repaints so the bridge stops
    // mid-wobble on the same frame the setting changes rather than at the end of the shake.
    setReduceMotion(v) {
      const on = !!v;
      if (on === reduceMotion) return reduceMotion;
      reduceMotion = on;
      if (reduceMotion) draw();
      return reduceMotion;
    },
    isReducedMotion: () => reduceMotion,
    attach(next) {
      game = next;
      drag = null;
      hint = null;
      shake = null;
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
      draw();
    },
    start() {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
