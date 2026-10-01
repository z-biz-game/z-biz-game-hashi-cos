// Save file. One localStorage key, plain JSON, versioned shape so an old save is recognised
// rather than mistaken for a new one.
//
// Records are keyed by puzzle id (the ids in js/data/lots.js), plus a daily log and a campaign
// unlock pointer. Everything degrades to a memory session when localStorage is denied, which it
// is in private windows and inside some webviews. Double-clicking index.html is not a supported
// way to play at all — ES modules need an origin, so use `node server.cjs`.

const KEY = 'hashi.save.v1';

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, drags: 0, hints: 0 },
  };
}

let cache = null;

// 数值字段强制成有限非负整数：坏档里的 null / "x" / NaN / 负数 / 越界都退回 0，
// 不让一个坏值把整块统计污染成 NaN（两段式解码的第二段：逐字段，而不是整块信任）。
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function load() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch (err) {
    raw = null; // no window (node) or storage blocked
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        const st = p.stats && typeof p.stats === 'object' ? p.stats : {};
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: num(p.unlocked) >= 1 ? num(p.unlocked) : base.unlocked,
          stats: {
            solves: num(st.solves),
            perfect: num(st.perfect),
            drags: num(st.drags),
            hints: num(st.hints),
          },
        };
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    /* memory-only session */
  }
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },

  record(id) {
    const r = load().records[id];
    // 两段式解码的第二段：单条坏记录（null/数字/字符串/数组）只丢它自己，返回 null，
    // 不让 UI 去 `rec.best` 解引用一个非对象而把整局冻死。
    return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
  },

  // Unlocking is monotone: replaying an early island chain must never hide a later one.
  unlock(n) {
    const s = load();
    if (n > s.unlocked) s.unlocked = n;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = load();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  // `target` is sum(p)/2 — the identity-derived floor on productive drags — so "一次到位" is a
  // fact about this board rather than a feeling. Hinted runs bill the hint but never take the
  // perfect flag.
  solve(id, { drags, target, hints }) {
    const s = load();
    const prev = s.records[id];
    const cur = {
      solved: true,
      best: !prev || !prev.best || drags < prev.best ? drags : prev.best,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: (drags <= target && !hints) || !!(prev && prev.perfect),
    };
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.drags += drags;
    s.stats.hints += hints || 0;
    if (drags <= target && !hints) s.stats.perfect += 1;
    persist();
    return cur;
  },

  reset() {
    cache = blank();
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) {
      /* nothing was ever persisted */
    }
  },
};

export const SAVE_KEY = KEY;
