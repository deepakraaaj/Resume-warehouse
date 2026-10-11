import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, ArrowDownRight, Flame, Trophy } from 'lucide-react';
import { useApp } from '../lib/state';
import { nextAction } from '../lib/next';
import { rings, streak, heatmap, weekRecap, readinessTrend, clampDay, sprintDay, problemsSolved } from '../lib/progress';
import { DAYS } from '../lib/plan';
import { Card, CountUp, Ring, Bar, Spinner } from '../components/ui';
import { SkillRadar, Heatmap } from '../components/Charts';
import { Tasks } from '../components/Tasks';
import { daysUntil, fmtDate, parseDate, greeting, arr } from '../lib/util';

const rise = (i: number) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 * i, duration: 0.5, ease: [0.16, 1, 0.3, 1] } });

export default function Today() {
  const { profile, targets, sprint, summary } = useApp();
  if (!sprint) return <div className="flex items-center gap-2 text-ink-2"><Spinner />Loading your day…</div>;
  const events = arr(summary?.events);
  const n = nextAction(profile, targets, sprint);
  const r = rings(events);
  const s = streak(events);
  const trend = readinessTrend(events);
  const recap = weekRecap(events);
  const day = clampDay(sprintDay(sprint));
  const sd = sprintDay(sprint);
  const top = [...targets].filter(t => !['Rejected', 'Ghosted'].includes(t.stage)).sort((a, b) => (b.readiness ?? 0) - (a.readiness ?? 0));
  const upcoming = targets.map(t => ({ t, d: daysUntil(t.interviewDate) })).filter(x => x.d != null && x.d >= 0).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
  const name = String(profile?.name ?? '').split(' ')[0];
  const weakest = summary ? Object.entries(summary.skills ?? {}).filter(([, v]) => (v as { rating: number | null }).rating != null).sort((a, b) => ((a[1] as { rating: number }).rating) - ((b[1] as { rating: number }).rating))[0] : null;

  return (
    <div className="space-y-6">
      <motion.header {...rise(0)}>
        <p className="text-ink-2">{fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="mt-1 text-4xl font-bold sm:text-5xl">{greeting()}{name ? `, ${name}` : ''}.</h1>
        <p className="mt-2 text-lg text-ink-2">{sd < 1 ? `Your sprint starts ${fmtDate(parseDate(sprint.start), { weekday: 'long', day: 'numeric', month: 'short' })}.` : sd > 30 ? 'Your 30-day sprint is complete.' : `Day ${sd} of 30 · ${DAYS[day - 1].t}`}</p>
      </motion.header>

      <motion.div {...rise(1)} className="relative overflow-hidden rounded-xl2 p-[1.5px]" style={{ background: 'linear-gradient(120deg, #FFB547, #8B7CFF 45%, #2DD4BF)' }}>
        <div className="relative flex flex-wrap items-center justify-between gap-5 rounded-[calc(1.25rem-1px)] bg-night-900/95 p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-amber/20 blur-3xl" />
          <div className="relative max-w-2xl">
            <p className="text-sm font-bold text-amber">{n.kicker}</p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{n.title}</h2>
            <p className="mt-2 text-ink-2">{n.body}</p>
          </div>
          <Link to={n.to} className="btn-amber relative px-6 py-3 text-base">{n.label}<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <motion.div {...rise(2)}><Card className="h-full">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Today’s rings</h3><span className="flex items-center gap-1.5 text-sm font-semibold text-amber"><Flame className="h-4 w-4" />{s} day streak</span></div>
          <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
            <div className="relative grid flex-none place-items-center">
              <Ring value={r[0].value} max={r[0].goal} size={168} stroke={15} color={r[0].color} />
              <div className="absolute"><Ring value={r[1].value} max={r[1].goal} size={128} stroke={15} color={r[1].color} /></div>
              <div className="absolute"><Ring value={r[2].value} max={r[2].goal} size={88} stroke={15} color={r[2].color} /></div>
            </div>
            <ul className="w-full flex-1 space-y-3">
              {r.map(x => (
                <li key={x.key}>
                  <div className="flex items-baseline justify-between"><span className="font-semibold" style={{ color: x.color }}>{x.label}</span><span className="tnum text-ink-2"><b className="text-ink">{x.value}</b> / {x.goal}{x.unit && ` ${x.unit}`}</span></div>
                  <p className="text-sm text-ink-3">{x.key === 'practice' ? 'Minutes answering out loud' : x.key === 'apply' ? 'Applications, referral asks, recruiter replies' : 'Sprint tasks, research, prep, flashcards'}</p>
                </li>
              ))}
              <li className="text-xs text-ink-3">Close two rings to keep your streak.</li>
            </ul>
          </div>
        </Card></motion.div>

        <motion.div {...rise(3)}><Card className="h-full">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Offer readiness</h3>
            {trend.delta !== 0 && <span className={trend.delta > 0 ? 'flex items-center gap-1 text-sm font-semibold text-teal' : 'flex items-center gap-1 text-sm font-semibold text-rose'}>{trend.delta > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}{trend.delta > 0 ? '+' : ''}{trend.delta} this week</span>}</div>
          <div className="mt-4 flex items-center gap-6">
            <Ring value={summary?.overall ?? 0} size={150} stroke={14} color="#2DD4BF"><div><CountUp value={summary?.overall ?? 0} className="font-display text-4xl font-bold" /><p className="text-xs text-ink-3">of 100</p></div></Ring>
            <ul className="min-w-0 flex-1 space-y-3">
              {top.slice(0, 4).map(t => (
                <li key={t.id}><Link to={`/c/${t.id}`} className="group block">
                  <div className="flex items-baseline justify-between gap-2"><span className="truncate font-semibold group-hover:text-violet">{t.company}</span><span className="tnum text-sm text-ink-2">{t.readiness ?? 0}</span></div>
                  <Bar value={t.readiness ?? 0} color={(t.readiness ?? 0) >= 60 ? 'bg-teal' : 'bg-amber'} className="mt-1.5" />
                </Link></li>
              ))}
              {!top.length && <li className="text-sm text-ink-3">Add a company to see how ready you are for it.</li>}
            </ul>
          </div>
        </Card></motion.div>
      </div>

      {upcoming.length > 0 && (
        <motion.div {...rise(4)} className="flex gap-3 overflow-x-auto pb-1">
          {upcoming.slice(0, 5).map(({ t, d }) => (
            <Link key={t.id} to={`/c/${t.id}`} className="glass flex min-w-[220px] items-center gap-4 p-4 transition hover:border-amber/40">
              <div className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-amber-soft text-amber"><span className="font-display text-2xl font-bold leading-none">{d === 0 ? 'Now' : d}</span>{d ? <span className="-mt-2 text-[10px] font-bold">DAYS</span> : null}</div>
              <div className="min-w-0"><p className="truncate font-semibold">{t.company}</p><p className="text-sm text-ink-3">{fmtDate(parseDate(t.interviewDate))} · {t.stage}</p></div>
            </Link>
          ))}
        </motion.div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div {...rise(5)} className="lg:col-span-2"><Card className="h-full">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Today’s sprint</h3><Link to="/sprint" className="text-sm font-semibold text-violet hover:underline">Full day</Link></div>
          <Tasks day={day} />
          <p className="mt-3 text-sm text-ink-3"><b className="tnum text-ink">{problemsSolved(sprint)}</b> of 75 problems solved · <b className="tnum text-ink">{sprint.refs}</b> referral asks</p>
        </Card></motion.div>
        <motion.div {...rise(6)}><Card className="h-full">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Skills</h3><Link to="/progress" className="text-sm font-semibold text-violet hover:underline">Details</Link></div>
          {summary ? <SkillRadar skills={summary.skills} names={summary.skillNames} /> : <div className="h-[250px]" />}
          {weakest ? <p className="text-sm text-ink-2">Focus next: <b className="text-ink">{weakest[0]}</b> ({(weakest[1] as { rating: number }).rating})</p> : <p className="text-sm text-ink-3">Ratings appear after your first scored answers.</p>}
        </Card></motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div {...rise(7)} className="lg:col-span-2"><Card>
          <h3 className="mb-3 text-lg font-semibold">Activity</h3>
          <Heatmap cells={heatmap(events)} />
        </Card></motion.div>
        <motion.div {...rise(8)}><Card className="h-full">
          <h3 className="flex items-center gap-2 text-lg font-semibold"><Trophy className="h-5 w-5 text-amber" />This week</h3>
          <dl className="mt-3 grid grid-cols-2 gap-4">
            {[['Practice', `${recap.thisWeek.practice} min`, recap.thisWeek.practice - recap.lastWeek.practice], ['Answers scored', recap.thisWeek.answers, recap.thisWeek.answers - recap.lastWeek.answers], ['Average score', recap.thisWeek.avg ?? '–', recap.thisWeek.avg != null && recap.lastWeek.avg != null ? recap.thisWeek.avg - recap.lastWeek.avg : 0], ['Apply actions', recap.thisWeek.apply, recap.thisWeek.apply - recap.lastWeek.apply]].map(([l, v, d]) => (
              <div key={String(l)}><dt className="text-sm text-ink-3">{l}</dt><dd className="font-display text-2xl font-bold tnum">{v}{Number(d) !== 0 && <span className={Number(d) > 0 ? 'ml-1.5 text-sm text-teal' : 'ml-1.5 text-sm text-rose'}>{Number(d) > 0 ? '+' : ''}{d}</span>}</dd></div>
            ))}
          </dl>
        </Card></motion.div>
      </div>
    </div>
  );
}
