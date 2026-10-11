import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { DAYS, WEEKS } from '../lib/plan';
import { post } from '../lib/api';
import { useApp, useAction } from '../lib/state';
import { STAGES } from '../lib/next';
import { clampDay, sprintDay, dayDate, dayPct, taskId, problemsSolved } from '../lib/progress';
import { Card, PageHead, Seg, Bar, Field, Spinner } from '../components/ui';
import { Tasks } from '../components/Tasks';
import { fmtDate, iso, local, cx } from '../lib/util';

export default function Sprint() {
  const { tab = 'day' } = useParams();
  const nav = useNavigate();
  const { sprint, setSprint } = useApp();
  const [view, setView] = useState<number | null>(null);
  if (!sprint) return <Spinner />;
  const day = view ?? clampDay(sprintDay(sprint));
  return (
    <div className="space-y-6">
      <PageHead title="30-day sprint" sub={`${problemsSolved(sprint)} problems solved · ${sprint.refs} referral asks`}
        right={<label className="flex items-center gap-2 text-sm text-ink-3">Started<input type="date" className="input w-auto py-1.5" value={sprint.start} onChange={e => e.target.value && setSprint(s => ({ ...s, start: e.target.value }))} /></label>} />
      <Seg value={tab as 'day'} onChange={v => nav(`/sprint/${v}`)} options={[['day', 'Day by day'], ['plan', 'All 30 days'], ['pipeline', 'Pipeline'], ['mentor', 'Mentor']] as ['day', string][]} />
      {tab === 'plan' ? <Plan onPick={n => { setView(n); nav('/sprint/day'); }} /> : tab === 'pipeline' ? <Pipeline /> : tab === 'mentor' ? <Mentor /> : <Day day={day} setDay={setView} />}
    </div>
  );
}

function Day({ day, setDay }: { day: number; setDay: (n: number) => void }) {
  const { sprint, setSprint, toast } = useApp();
  const d = DAYS[day - 1], w = WEEKS.find(x => day >= x.from && day <= x.to)!;
  const key = iso(dayDate(sprint!, day));
  const [ci, setCi] = useState(sprint!.checkins[key] ?? {});
  useEffect(() => setCi(sprint!.checkins[key] ?? {}), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-ink-3">Week {w.n}: {w.title}</p><h2 className="text-3xl font-bold">Day {day}: {d.t}</h2><p className="text-ink-3">{fmtDate(dayDate(sprint!, day), { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
        <div className="flex gap-1"><button className="btn-ghost" disabled={day <= 1} onClick={() => setDay(day - 1)}><ChevronLeft className="h-4 w-4" /></button><button className="btn-ghost" onClick={() => setDay(clampDay(sprintDay(sprint!)))}>Today</button><button className="btn-ghost" disabled={day >= 30} onClick={() => setDay(day + 1)}><ChevronRight className="h-4 w-4" /></button></div>
      </div>
      <div className="rounded-xl2 border border-violet/25 bg-violet/[.08] p-5 text-lg leading-relaxed">{d.note}</div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card><h3 className="text-lg font-semibold">Tasks</h3><Bar value={dayPct(sprint!, day) * 100} color="bg-teal" className="my-3" /><Tasks day={day} /></Card>
        <Card>
          <h3 className="text-lg font-semibold">End-of-day check-in</h3>
          <div className="mt-3 space-y-3">
            <div><span className="label">Energy</span><div className="mt-1.5 flex gap-1.5">{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setCi({ ...ci, energy: n })} className={cx('h-10 flex-1 rounded-xl border font-semibold transition', ci.energy === n ? 'border-violet bg-violet text-night-950' : 'border-white/10 hover:border-white/30')}>{n}</button>)}</div></div>
            <Field label="Focused hours"><input className="input" type="number" min={0} max={16} step={0.5} value={ci.hours ?? ''} onChange={e => setCi({ ...ci, hours: Number(e.target.value) || null })} /></Field>
            <Field label="One win"><input className="input" value={ci.win ?? ''} onChange={e => setCi({ ...ci, win: e.target.value })} placeholder="Solved 3Sum without hints" /></Field>
            <Field label="What got in the way"><input className="input" value={ci.block ?? ''} onChange={e => setCi({ ...ci, block: e.target.value })} /></Field>
            <button className="btn-primary" onClick={() => { setSprint(s => ({ ...s, checkins: { ...s.checkins, [key]: ci } })); toast('Check-in saved.'); }}>Save check-in</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Plan({ onPick }: { onPick: (n: number) => void }) {
  const { sprint } = useApp();
  const today = sprintDay(sprint!);
  return (
    <div className="space-y-8">{WEEKS.map(w => (
      <section key={w.n}><h3 className="text-xl font-semibold">Week {w.n}: {w.title}</h3><p className="mb-3 text-sm text-ink-3">{w.aim}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{Array.from({ length: w.to - w.from + 1 }, (_, i) => w.from + i).map(n => (
          <button key={n} onClick={() => onPick(n)} className={cx('glass flex min-h-[110px] flex-col gap-1 p-3 text-left transition hover:border-violet/50', n === today && 'border-amber/70 shadow-amber')}>
            <span className="text-xs text-ink-3">Day {n} · {fmtDate(dayDate(sprint!, n), { weekday: 'short', day: 'numeric' })}</span>
            <b className="text-sm leading-snug">{DAYS[n - 1].t}</b>
            <Bar value={dayPct(sprint!, n) * 100} color="bg-teal" className="mt-auto h-1.5" />
          </button>
        ))}</div>
      </section>
    ))}</div>
  );
}

function Pipeline() {
  const { targets, sprint, setSprint, loadTargets, toast } = useApp();
  const ref = (delta: number) => { setSprint(s => ({ ...s, refs: Math.max(0, s.refs + delta) })); post('activity', { type: 'referral', delta }).catch(() => {}); };
  return (
    <div className="space-y-6">
      <Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="text-lg font-semibold">Referral asks</h3><p className="text-sm text-ink-3">Every message to an engineer asking for a referral. Target 40.</p></div>
        <div className="flex items-center gap-3"><button className="btn-ghost" onClick={() => ref(-1)}>−</button><span className="tnum font-display text-4xl font-bold">{sprint!.refs}</span><button className="btn-amber" onClick={() => ref(1)}>+1 sent</button></div></div></Card>
      <div className="glass overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink-3">{['Company', 'Role', 'Stage', 'Interview', 'Ready'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{targets.map(t => (
          <tr key={t.id} className="border-t border-white/[.06]">
            <td className="px-4 py-3"><Link to={`/c/${t.id}`} className="font-semibold hover:text-violet">{t.company}</Link></td><td className="px-4 py-3 text-ink-2">{t.role}</td>
            <td className="px-4 py-3"><select className="input py-1.5" value={t.stage} onChange={e => post('target-update', { id: t.id, stage: e.target.value }).then(loadTargets).then(() => toast('Saved.'))}>{STAGES.map(s => <option key={s}>{s}</option>)}</select></td>
            <td className="px-4 py-3"><input className="input py-1.5" type="date" value={t.interviewDate} onChange={e => post('target-update', { id: t.id, interviewDate: e.target.value }).then(loadTargets)} /></td>
            <td className="tnum px-4 py-3">{t.readiness ?? 0}</td>
          </tr>
        ))}</tbody></table>
        {!targets.length && <p className="p-6 text-center text-ink-3">Companies you add show up here.</p>}</div>
    </div>
  );
}

const MODES: [string, string][] = [['talk', 'Talk it through'], ['Python', 'Python quiz'], ['SQL and databases', 'SQL quiz'], ['GenAI and LLM systems', 'GenAI quiz'], ['system design', 'System design'], ['behavioural questions (STAR)', 'Behavioural'], ['HR round and salary negotiation', 'HR & salary']];
function Mentor() {
  const { sprint } = useApp();
  const [chat, setChat] = useState(local.get('mentor', { mode: 'talk', turns: [] as { role: string; content: string }[] }));
  const [text, setText] = useState('');
  const { busy, run } = useAction();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [chat]);
  const save = (c: typeof chat) => { setChat(c); local.set('mentor', { ...c, turns: c.turns.slice(-30) }); };
  const send = () => run('m', async () => {
    if (!text.trim()) return;
    const turns = [...chat.turns, { role: 'user', content: text.trim() }];
    save({ ...chat, turns }); setText('');
    const day = clampDay(sprintDay(sprint!));
    const ctx = `Sprint day ${sprintDay(sprint!)} of 30 ("${DAYS[day - 1].t}"). Tasks: ${DAYS[day - 1].k.map((t, i) => `[${sprint!.done[taskId(day, i)] ? 'x' : ' '}] ${t[1]}`).join('; ')}. Problems ${problemsSolved(sprint!)}/75, referral asks ${sprint!.refs}/40.`;
    const out = await post('mentor', { history: turns, context: ctx, mode: chat.mode });
    save({ ...chat, turns: [...turns, { role: 'assistant', content: out.text }] });
  });
  return (
    <Card>
      <Seg value={chat.mode} onChange={m => save({ mode: m, turns: [] })} options={MODES} />
      <div ref={box} className="my-4 flex max-h-[55vh] min-h-[240px] flex-col gap-3 overflow-y-auto">
        {!chat.turns.length && <div className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-night-800 p-4">{chat.mode === 'talk' ? 'I can see your plan, companies, profile and check-ins. How’s it going?' : 'Type “start” for the first question.'}</div>}
        {chat.turns.map((m, i) => <div key={i} className={cx('max-w-[85%] whitespace-pre-wrap rounded-2xl p-4', m.role === 'user' ? 'self-end rounded-br-md bg-violet text-night-950' : 'self-start rounded-bl-md bg-night-800')}>{m.content}</div>)}
        {busy && <div className="self-start rounded-2xl bg-night-800 p-4"><Spinner /></div>}
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send(); }}><input className="input" value={text} onChange={e => setText(e.target.value)} placeholder="Message your mentor" /><button className="btn-primary" disabled={!!busy}><Send className="h-4 w-4" /></button></form>
    </Card>
  );
}
