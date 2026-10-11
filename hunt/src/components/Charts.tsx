import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Area, AreaChart, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { motion } from 'framer-motion';
import type { Json } from '../lib/api';
import { cx } from '../lib/util';

export function SkillRadar({ skills, names }: { skills: Json; names: string[] }) {
  const data = names.map(n => ({ skill: n === 'System design' ? 'Design' : n === 'Communication' ? 'Comms' : n, rating: skills?.[n]?.rating ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="rgba(255,255,255,.09)" />
        <PolarAngleAxis dataKey="skill" tick={{ fill: '#A3ACC7', fontSize: 12, fontWeight: 600 }} />
        <Radar dataKey="rating" stroke="#8B7CFF" strokeWidth={2} fill="#8B7CFF" fillOpacity={0.28} isAnimationActive animationDuration={900} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

const tip = { contentStyle: { background: '#141B33', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, color: '#E8ECF8' }, labelStyle: { color: '#A3ACC7' } };
export function TrendArea({ data, dataKey = 'value', color = '#2DD4BF', height = 200 }: { data: Json[]; dataKey?: string; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
        <defs><linearGradient id={`g${color}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.45} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: '#6B7494', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: '#6B7494', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip {...tip} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} fill={`url(#g${color})`} dot={{ r: 3, fill: color }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
export function MockLines({ series }: { series: { name: string; points: { date: string; score: number }[] }[] }) {
  const colors = ['#8B7CFF', '#2DD4BF', '#FFB547', '#FB7185', '#60A5FA'];
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  const data = dates.map(d => Object.fromEntries([['date', d], ...series.map(s => [s.name, s.points.find(p => p.date === d)?.score ?? null])]));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
        <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: '#6B7494', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 10]} tick={{ fill: '#6B7494', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip {...tip} />
        {series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={colors[i % colors.length]} strokeWidth={2.5} connectNulls dot={{ r: 4 }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Heatmap({ cells }: { cells: { date: string; level: number; label: string }[] }) {
  const weeks: typeof cells[] = [];
  cells.forEach((c, i) => { (weeks[Math.floor(i / 7)] ??= []).push(c); });
  const tone = ['bg-white/[.05]', 'bg-teal/25', 'bg-teal/45', 'bg-teal/70', 'bg-teal'];
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-[3px]">{weeks.map((w, i) => (
        <div key={i} className="flex flex-col gap-[3px]">{w.map((c, j) => (
          <motion.div key={c.date} title={`${c.date}: ${c.label}`} className={cx('h-3 w-3 rounded-[3px]', tone[c.level])} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: (i * 7 + j) * 0.003 }} />
        ))}</div>
      ))}</div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">Less{tone.map(t => <span key={t} className={cx('h-3 w-3 rounded-[3px]', t)} />)}More</div>
    </div>
  );
}
