// Rings, streak, heatmap, weekly recap and personal bests, all derived from the server's activity log.
import { DAYS } from './plan';
import { iso, parseDate } from './util';
import type { Json } from './api';
import type { Sprint } from './state';

export const GOALS = { practiceMin: 20, apply: 2, learn: 3 };
const dayKey = (at: string) => iso(new Date(at));

export function dayStats(events: Json[]) {
  const by: Record<string, { practice: number; apply: number; learn: number; answers: number; best: number }> = {};
  for (const e of events) {
    const k = dayKey(e.at);
    const d = (by[k] ??= { practice: 0, apply: 0, learn: 0, answers: 0, best: 0 });
    if (e.type === 'practice') d.practice += e.seconds / 60;
    if (e.type === 'apply' || e.type === 'referral') d.apply += 1;
    if (e.type === 'task' || e.type === 'card' || e.type === 'kit' || e.type === 'research') d.learn += e.type === 'card' ? 0.34 : 1;
    if (e.type === 'answer') { d.answers += 1; d.best = Math.max(d.best, e.score); }
  }
  return by;
}

export function rings(events: Json[], date = new Date()) {
  const d = dayStats(events)[iso(date)] ?? { practice: 0, apply: 0, learn: 0 };
  return [
    { key: 'practice', label: 'Practise', value: Math.round(d.practice), goal: GOALS.practiceMin, unit: 'min', color: '#8B7CFF' },
    { key: 'apply', label: 'Apply', value: Math.floor(d.apply), goal: GOALS.apply, unit: '', color: '#FFB547' },
    { key: 'learn', label: 'Learn', value: Math.floor(d.learn), goal: GOALS.learn, unit: '', color: '#2DD4BF' },
  ];
}
const closed = (d?: { practice: number; apply: number; learn: number }) => (d ? [d.practice >= GOALS.practiceMin, d.apply >= GOALS.apply, d.learn >= GOALS.learn].filter(Boolean).length : 0);

// A streak day closes at least two of the three rings. Today still counts as "in progress".
export function streak(events: Json[]) {
  const by = dayStats(events);
  let n = 0;
  const d = new Date();
  if (closed(by[iso(d)]) < 2) d.setDate(d.getDate() - 1);
  for (;;) { if (closed(by[iso(d)]) >= 2) { n++; d.setDate(d.getDate() - 1); } else break; }
  return n;
}
export function longestStreak(events: Json[]) {
  const by = dayStats(events);
  const days = Object.keys(by).sort();
  let best = 0, run = 0, prev: Date | null = null;
  for (const k of days) {
    const ok = closed(by[k]) >= 2;
    const cur = parseDate(k);
    if (ok && prev && (cur.getTime() - prev.getTime()) / 864e5 === 1) run++; else run = ok ? 1 : 0;
    if (ok) prev = cur; else prev = null;
    best = Math.max(best, run);
  }
  return best;
}

// 18 weeks of activity intensity for the heatmap.
export function heatmap(events: Json[], weeks = 18) {
  const by = dayStats(events);
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - (weeks * 7 - 1) - start.getDay());
  const cells: { date: string; level: number; label: string }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const s = by[iso(d)];
    const score = s ? s.practice / 10 + s.apply + s.learn + s.answers * 0.5 : 0;
    const level = score === 0 ? 0 : score < 2 ? 1 : score < 4 ? 2 : score < 7 ? 3 : 4;
    cells.push({ date: iso(d), level, label: s ? `${Math.round(s.practice)} min practice, ${Math.floor(s.apply)} apply, ${Math.floor(s.learn)} learn` : 'No activity' });
  }
  return cells;
}

export function weekRecap(events: Json[]) {
  const now = Date.now();
  const inRange = (from: number, to: number) => events.filter(e => { const t = Date.parse(e.at); return t >= now - from * 864e5 && t < now - to * 864e5; });
  const sum = (xs: Json[]) => ({
    practice: Math.round(xs.filter(e => e.type === 'practice').reduce((n, e) => n + e.seconds, 0) / 60),
    answers: xs.filter(e => e.type === 'answer').length,
    avg: (() => { const a = xs.filter(e => e.type === 'answer'); return a.length ? Math.round(a.reduce((n, e) => n + e.score, 0) / a.length) : null; })(),
    apply: xs.filter(e => e.type === 'apply' || e.type === 'referral').length,
  });
  return { thisWeek: sum(inRange(7, 0)), lastWeek: sum(inRange(14, 7)) };
}

export function bests(events: Json[], targets: Json[]) {
  const mocks = events.filter(e => e.type === 'mock');
  const bestMock = mocks.reduce((b: Json | null, e) => (!b || e.score > b.score ? e : b), null);
  const perDay = dayStats(events);
  const mostPractice = Object.entries(perDay).reduce((b, [k, v]) => (v.practice > b.min ? { day: k, min: Math.round(v.practice) } : b), { day: '', min: 0 });
  return {
    bestMock: bestMock ? { score: bestMock.score / 10, company: targets.find(t => t.id === bestMock.target)?.company ?? 'a company', at: bestMock.at } : null,
    longest: longestStreak(events),
    mostPractice,
    answers: events.filter(e => e.type === 'answer').length,
  };
}

export function readinessTrend(events: Json[]) {
  const snaps = events.filter(e => e.type === 'snapshot');
  const weekAgo = Date.now() - 7 * 864e5;
  const before = [...snaps].reverse().find(e => Date.parse(e.at) <= weekAgo) ?? snaps[0];
  const latest = snaps.at(-1);
  return { delta: before && latest ? latest.value - before.value : 0, history: snaps.map(e => ({ date: e.at.slice(5, 10), value: e.value })) };
}

// Sprint helpers.
export const sprintDay = (s: Sprint) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t.getTime() - parseDate(s.start).getTime()) / 864e5) + 1; };
export const clampDay = (n: number) => Math.max(1, Math.min(30, n));
export const taskId = (d: number, i: number) => `d${d}-${i}`;
export const dayDate = (s: Sprint, n: number) => { const d = parseDate(s.start); d.setDate(d.getDate() + n - 1); return d; };
export const dayPct = (s: Sprint, n: number) => { const k = DAYS[n - 1].k; return k.filter((_, i) => s.done[taskId(n, i)]).length / k.length; };
export const problemsSolved = (s: Sprint) => DAYS.reduce((n, d, di) => n + d.k.reduce((x, t, i) => x + (t[3] && s.done[taskId(di + 1, i)] ? t[3] : 0), 0), 0);
