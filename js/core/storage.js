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
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          stats: { ...base.stats, ...(p.stats || {}) },
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
    return load().records[id] || null;
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
