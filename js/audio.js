// 音效引擎 —— 真 Web Audio，不是把 gain 设 0 的假静音。
//
// 三条硬约束（派工单 §2）：
//   1. 懒建 AudioContext：浏览器只在用户手势后才允许出声，模块加载期绝不 new，
//      否则在无手势/无 AudioContext 的环境（node 沙箱、file://）里直接抛错。
//   2. 静音态不得再新建振荡器节点：tone() 在 muted 时首行 return，一个节点都不造，
//      而不是造完把 gain 调 0。
//   3. suspend()/resume() 真停 AudioContext：暂停与静音都会挂起上下文本身。
//
// 环境拿不到 AudioContext 时（隐私窗口、老 Safari、无手势），所有方法静默降级为 no-op，
// 游戏照常能玩 —— 音效是增强，不是依赖。

let ctx = null;
let muted = false;

function ac() {
  if (ctx) return ctx;
  const AC = typeof AudioContext !== 'undefined'
    ? AudioContext
    : (typeof window !== 'undefined' && (window.webkitAudioContext || window.AudioContext));
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch (err) {
    ctx = null;
  }
  return ctx;
}

// 一个短促的包络音。静音时直接返回 —— 不创建任何振荡器/增益节点。
function tone(freq, dur, type, peak) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  if (c.state === 'suspended' && c.resume) c.resume();
  const d = dur || 0.12;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak || 0.18, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + d + 0.02);
}

export const audio = {
  // 首次用户手势里调用：把被自动挂起的上下文唤醒，之后才能正常出声。
  unlock() {
    const c = ac();
    if (c && c.resume && c.state === 'suspended') c.resume();
  },
  place() { tone(520, 0.1, 'triangle', 0.16); },
  add() { tone(680, 0.07, 'sine', 0.12); },
  clear() { tone(300, 0.09, 'sine', 0.1); },
  reject() { tone(150, 0.16, 'sawtooth', 0.13); },
  hint() { tone(880, 0.06, 'sine', 0.1); },
  click() { tone(440, 0.05, 'square', 0.08); },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.18), i * 90));
  },
  suspend() {
    const c = ctx;
    if (c && c.suspend && c.state === 'running') c.suspend();
  },
  resume() {
    const c = ctx;
    if (c && c.resume && c.state === 'suspended') c.resume();
  },
  setMuted(v) {
    muted = !!v;
    if (muted) {
      if (ctx && ctx.suspend && ctx.state === 'running') ctx.suspend();
    } else if (ctx && ctx.resume && ctx.state === 'suspended') {
      ctx.resume();
    }
  },
  get muted() { return muted; },
};
