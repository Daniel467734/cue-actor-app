// Aggregates rehearsal sessions into per-line stats and trouble spots.

export function lastResultPerLine(results) {
  const map = new Map();
  for (const r of results) map.set(r.lineId, r);
  return [...map.values()];
}

export function summarize(results) {
  const rs = lastResultPerLine(results);
  const count = (s) => rs.filter((r) => r.status === s).length;
  const total = rs.length;
  const ok = count('ok');
  return {
    total,
    ok,
    prompted: count('prompted'),
    missed: count('missed'),
    skipped: count('skipped'),
    clean: total ? Math.round((ok / total) * 100) : 0,
  };
}

export function lineStats(sessions, character) {
  const map = new Map();
  for (const s of sessions) {
    if (character && s.character !== character) continue;
    for (const r of lastResultPerLine(s.results)) {
      const e = map.get(r.lineId) || { lineId: r.lineId, runs: 0, ok: 0, prompted: 0, missed: 0, skipped: 0, last: null };
      e.runs++;
      e[r.status] = (e[r.status] || 0) + 1;
      e.last = r.status;
      map.set(r.lineId, e);
    }
  }
  for (const e of map.values()) e.weakness = (e.missed * 2 + e.prompted + e.skipped * 0.5) / e.runs;
  return map;
}

export function troubleLineIds(sessions, character) {
  return [...lineStats(sessions, character).values()]
    .filter((e) => e.weakness >= 0.5 || e.last === 'missed' || e.last === 'prompted')
    .map((e) => e.lineId);
}

export const STATUS = {
  ok: { icon: '✓', label: 'Clean', cls: 'ok' },
  prompted: { icon: '💡', label: 'Prompted', cls: 'prompted' },
  missed: { icon: '✗', label: 'Missed', cls: 'missed' },
  skipped: { icon: '⏭', label: 'Skipped', cls: 'skipped' },
};

// Per-line memory state from past sessions: streak of clean runs and when it was last rehearsed.
export function lineMemory(sessions, character) {
  const map = new Map();
  const ordered = [...sessions].filter((s) => !character || s.character === character).sort((a, b) => a.startedAt - b.startedAt);
  for (const s of ordered) {
    for (const r of lastResultPerLine(s.results)) {
      const e = map.get(r.lineId) || { streak: 0, last: 0 };
      e.streak = r.status === 'ok' ? e.streak + 1 : 0;
      e.last = s.endedAt || s.startedAt;
      map.set(r.lineId, e);
    }
  }
  return map;
}

const DAY = 86400000;
const INTERVALS = [0, 1, 2, 4, 8, 16];

// Lines never rehearsed, recently failed, or whose review interval has passed.
export function dueLineIds(sessions, character, items, now = Date.now()) {
  const mem = lineMemory(sessions, character);
  return items
    .filter((it) => it.type === 'dialogue' && it.character === character)
    .filter((it) => {
      const m = mem.get(it.id);
      if (!m) return true;
      return now - m.last >= INTERVALS[Math.min(m.streak, INTERVALS.length - 1)] * DAY;
    })
    .map((it) => it.id);
}
