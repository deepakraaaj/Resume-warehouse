import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { arr, cx } from '../lib/util';
import type { Json } from '../lib/api';

export const Card = ({ className, children, hi }: { className?: string; children: ReactNode; hi?: boolean }) => (
  <section className={cx(hi ? 'glass-hi' : 'glass', 'p-5 sm:p-6', className)}>{children}</section>
);
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx('h-4 w-4 animate-spin', className)} aria-hidden />;
export const PageHead = ({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) => (
  <header className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0"><h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>{sub && <p className="mt-2 max-w-2xl text-ink-2">{sub}</p>}</div>
    {right}
  </header>
);
export const Chip = ({ tone = 'neutral', children }: { tone?: 'neutral' | 'violet' | 'teal' | 'amber' | 'rose'; children: ReactNode }) => (
  <span className={cx('chip', { neutral: 'bg-white/[.06] text-ink-2', violet: 'bg-violet-soft text-violet', teal: 'bg-teal-soft text-teal', amber: 'bg-amber-soft text-amber', rose: 'bg-rose-soft text-rose' }[tone])}>{children}</span>
);
export const LabelChip = ({ label }: { label?: string }) => (
  <Chip tone={label === 'official' ? 'teal' : label === 'candidate-reported' ? 'amber' : 'neutral'}>{label === 'official' ? 'Official' : label === 'candidate-reported' ? 'Candidate reports' : 'Unverified'}</Chip>
);

export function CountUp({ value, className, suffix = '' }: { value: number; className?: string; suffix?: string }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, v => `${Math.round(v)}${suffix}`);
  useEffect(() => { const c = animate(mv, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1] }); return c.stop; }, [value, mv]);
  return <motion.span className={cx('tnum', className)}>{rounded}</motion.span>;
}

export function Ring({ value, max = 100, size = 120, stroke = 12, color = '#8B7CFF', track = 'rgba(255,255,255,.07)', children }: { value: number; max?: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 8px ${color}66)` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export const Bar = ({ value, color = 'bg-violet', className }: { value: number; color?: string; className?: string }) => (
  <div className={cx('h-2 overflow-hidden rounded-full bg-white/[.07]', className)}>
    <motion.div className={cx('h-full rounded-full', color)} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
  </div>
);

export const Empty = ({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) => (
  <div className="glass flex flex-col items-center gap-3 border-dashed p-10 text-center"><h3 className="text-xl font-semibold">{title}</h3><div className="max-w-md text-ink-2">{children}</div>{action}</div>
);

// Renders AI text: paragraphs, bullets, **bold**, and [S1, S2] citations linked to their sources.
export function Rich({ text, sources, className }: { text?: string; sources?: Json[]; className?: string }) {
  const byN = new Map(arr(sources).map((s: Json) => [String(s.n), s]));
  const inline = (s: string, key: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*|\[(?:S?\d+\s*,?\s*)+\])/g).filter(Boolean).map((part, i) => {
    if (/^\*\*/.test(part)) return <b key={`${key}${i}`} className="font-semibold text-ink">{part.slice(2, -2)}</b>;
    const m = part.match(/^\[((?:S?\d+\s*,?\s*)+)\]$/);
    if (m) return <span key={`${key}${i}`}>{m[1].split(',').map(x => x.trim().replace(/^S/, '')).filter(Boolean).map(n => { const src = byN.get(n); return src?.url ? <a key={n} href={src.url} target="_blank" rel="noopener" title={src.title || src.site} className="ml-0.5 rounded-md bg-violet-soft px-1.5 py-px align-[1px] text-[11px] font-bold text-violet no-underline hover:bg-violet/30">{n}</a> : <span key={n} className="ml-0.5 rounded-md bg-white/10 px-1.5 text-[11px]">{n}</span>; })}</span>;
    return part;
  });
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`u${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `l${blocks.length}-${i}`)}</li>)}</ul>); list = []; } };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    const b = line.match(/^(?:[-*•]|\d+\.)\s+(.*)/);
    if (b) { list.push(b[1]); continue; }
    flush();
    if (line && !/^\|?[-: |]+\|?$/.test(line)) blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/^#+\s*/, '').replace(/^\||\|$/g, '').replace(/\s\|\s/g, ' — '), `p${blocks.length}`)}</p>);
  }
  flush();
  return <div className={cx('prose-ai leading-relaxed text-ink/90', className)}>{blocks}</div>;
}

export function Sources({ sources }: { sources?: Json[] }) {
  if (!arr(sources).length) return <p className="text-sm text-ink-3">No sources.</p>;
  return (
    <ol className="space-y-1.5 text-sm">{arr(sources).map((s: Json) => (
      <li key={s.n} className="grid grid-cols-[2.2rem_1fr] gap-1"><span className="text-ink-3 tnum">{s.n}</span><span className="min-w-0 break-words">{s.url ? <a className="text-violet hover:underline" href={s.url} target="_blank" rel="noopener">{s.title || s.site}</a> : s.title} <span className="text-ink-3">{s.site}</span></span></li>
    ))}</ol>
  );
}

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-1.5"><span className="label">{label}</span>{children}{hint && <span className="text-xs text-ink-3">{hint}</span>}</label>
);

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-white/[.08] bg-night-900/70 p-1" role="group">
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={cx('relative rounded-full px-3.5 py-1.5 text-sm font-semibold transition', value === k ? 'text-night-950' : 'text-ink-2 hover:text-ink')}>
          {value === k && <motion.span layoutId={`seg-${options.map(o => o[0]).join('')}`} className="absolute inset-0 rounded-full bg-ink" transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }} />}
          <span className="relative">{l}</span>
        </button>
      ))}
    </div>
  );
}
