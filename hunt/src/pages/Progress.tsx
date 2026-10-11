import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Flame, Trophy, Timer, MessageSquare } from 'lucide-react';
import { useApp } from '../lib/state';
import { Card, PageHead, Bar, CountUp } from '../components/ui';
import { SkillRadar, TrendArea, MockLines, Heatmap } from '../components/Charts';
import { heatmap, bests, readinessTrend, streak } from '../lib/progress';
import { arr } from '../lib/util';
import type { Json } from '../lib/api';

export default function Progress() {
  const { summary, targets } = useApp();
  const events = arr<Json>(summary?.events);
  const b = bests(events, targets);
  const trend = readinessTrend(events);
  const series = targets.map(t => ({ name: t.company, points: events.filter(e => e.type === 'mock' && e.target === t.id).map(e => ({ date: e.at.slice(5, 10), score: e.score / 10 })) })).filter(s => s.points.length);
  const skills = summary?.skills ?? {};
  const tiles = [
    [Flame, 'Current streak', streak(events), 'days', 'text-amber'],
    [Trophy, 'Best mock', b.bestMock ? b.bestMock.score : 0, b.bestMock ? `/10 at ${b.bestMock.company}` : 'no mocks yet', 'text-violet'],
    [Timer, 'Most practice in a day', b.mostPractice.min, 'min', 'text-teal'],
    [MessageSquare, 'Answers scored', b.answers, 'total', 'text-ink'],
  ] as const;
  return (
    <div className="space-y-6">
      <PageHead title="Progress" sub="Real scores from your answers, not points for clicking." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(([Icon, label, value, unit, tone], i) => (
          <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass p-5">
            <Icon className={`h-5 w-5 ${tone}`} /><p className="mt-3 text-sm text-ink-3">{label}</p>
            <p className="font-display text-3xl font-bold"><CountUp value={Number(value)} /> <span className="text-sm font-medium text-ink-3">{unit}</span></p>
          </motion.div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <h3 className="text-lg font-semibold">Skill ratings</h3>
          <p className="text-sm text-ink-3">Recent answers count more. The ± narrows as you practise.</p>
          {summary && <SkillRadar skills={skills} names={summary.skillNames} />}
          <ul className="space-y-3">{arr<string>(summary?.skillNames).map(n => { const s = skills[n] ?? {}; return (
            <li key={n}><div className="flex items-baseline justify-between"><span className="font-semibold">{n}</span><span className="tnum text-sm text-ink-2">{s.rating == null ? 'No answers yet' : <><b className="text-lg text-ink">{s.rating}</b> ±{s.plusMinus} · {s.n} answer{s.n === 1 ? '' : 's'}</>}</span></div><Bar value={s.rating ?? 0} color={(s.rating ?? 0) >= 70 ? 'bg-teal' : 'bg-violet'} className="mt-1.5" /></li>
          ); })}</ul>
        </Card>
        <div className="space-y-6">
          <Card><h3 className="text-lg font-semibold">Offer readiness over time</h3>{trend.history.length > 1 ? <TrendArea data={trend.history} /> : <p className="py-10 text-center text-ink-3">The chart fills in as you come back on different days.</p>}</Card>
          <Card><h3 className="text-lg font-semibold">Mock interview scores</h3>{series.length ? <MockLines series={series} /> : <p className="py-10 text-center text-ink-3">No mocks yet. <Link to="/practice" className="text-violet underline">Run your first one</Link>.</p>}</Card>
        </div>
      </div>
      <Card><h3 className="mb-3 text-lg font-semibold">Activity, last 18 weeks</h3><Heatmap cells={heatmap(events)} /></Card>
    </div>
  );
}
