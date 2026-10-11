export const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s: string) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (d: Date, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => d.toLocaleDateString('en-IN', o);
export const daysUntil = (d?: string) => { if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((parseDate(d).getTime() - t.getTime()) / 864e5); };
export const ago = (t?: number | string | null) => {
  if (!t) return 'never';
  const ms = typeof t === 'string' ? Date.parse(t) : t;
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
export const dur = (ms?: number | null) => { if (ms == null) return ''; const s = Math.ceil(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const arr = <T = any,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
export const local = {
  get<T>(k: string, f: T): T { try { const v = localStorage.getItem(`hunt2-${k}`); return v ? JSON.parse(v) : f; } catch { return f; } },
  set(k: string, v: unknown) { try { localStorage.setItem(`hunt2-${k}`, JSON.stringify(v)); } catch { /* optional */ } },
};
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
