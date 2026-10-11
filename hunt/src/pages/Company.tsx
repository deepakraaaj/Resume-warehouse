import { AnimatePresence, motion } from 'framer-motion';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, Copy, Mic, RotateCcw, Sparkles, ChevronLeft, ChevronRight, Trash2, ExternalLink } from 'lucide-react';
import { get, post, type Json } from '../lib/api';
import { useApp, useAction } from '../lib/state';
import { STAGES, APPLIED_STAGES } from '../lib/next';
import { Card, Chip, LabelChip, Rich, Sources, Spinner, Ring, CountUp, Field, Seg, Bar, Empty } from '../components/ui';
import { arr, cx, daysUntil, ago } from '../lib/util';

const STEP_NAMES = ['How their interview rounds work', 'Questions candidates were asked', 'What this role pays', 'The company, tech stack and joining'];
const KIT_ORDER = ['technical', 'projects', 'hr', 'concepts', 'ask', 'plan'];
const KIT_TITLES: Record<string, string> = { technical: 'Technical questions', projects: 'Explain your projects', hr: 'HR and managerial', concepts: 'Concepts to master', ask: 'Questions to ask them', plan: 'Prep plan' };

export default function Company() {
  const { id = '', step } = useParams();
  const { loadTargets, toast } = useApp();
  const nav = useNavigate();
  const [t, setT] = useState<Json | null>(null);
  const [armed, setArmed] = useState(false);
  const load = useCallback(async () => { try { setT(await get('target', { id })); } catch (err) { toast((err as Error).message, true); } }, [id, toast]);
  useEffect(() => { setT(null); load(); }, [load]);
  if (!t) return <div className="flex items-center gap-2 text-ink-2"><Spinner />Loading…</div>;
  const cur = step ?? (!t.research ? 'research' : !t.kit?.technical ? 'prepare' : 'practise');
  const d = daysUntil(t.interviewDate);
  const cs = t.cardStats ?? { total: 0, known: 0 };
  const best = Math.max(0, ...arr(t.mocks).map((m: Json) => Number(m.report?.overall) || 0));
  const steps = [
    ['research', 'Research', Boolean(t.research), t.research ? `${arr(t.research.sources).length} sources` : 'Not started'],
    ['apply', 'Apply', t.fit != null, t.fit ? `Fit ${t.fit.score}/100` : APPLIED_STAGES.includes(t.stage) ? t.stage : 'Check your fit'],
    ['prepare', 'Prepare', Boolean(t.kit?.technical), cs.total ? `${cs.known}/${cs.total} cards known` : `${Object.keys(t.kit ?? {}).length} of 6 sections`],
    ['practise', 'Practise', arr(t.mocks).length > 0, arr(t.mocks).length ? `Best mock ${best}/10` : 'No mocks yet'],
  ] as const;
  const update = async (fields: Json) => { await post('target-update', { id, ...fields }); await Promise.all([load(), loadTargets()]); toast('Saved.'); };
  const reload = async () => { await Promise.all([load(), loadTargets()]); };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex items-center gap-5">
          <Ring value={t.readiness} size={92} stroke={9} color={t.readiness >= 60 ? '#2DD4BF' : '#FFB547'}><div><CountUp value={t.readiness} className="font-display text-2xl font-bold" /><p className="-mt-1 text-[10px] text-ink-3">READY</p></div></Ring>
          <div><h1 className="text-4xl font-bold">{t.company}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-ink-2">{t.role}{t.location ? `, ${t.location}` : ''}</span>{d != null && d >= 0 && <Chip tone="amber">{d === 0 ? 'Interview today' : `Interview in ${d} day${d === 1 ? '' : 's'}`}</Chip>}</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto py-2" value={t.stage} onChange={e => update({ stage: e.target.value })} aria-label="Stage">{STAGES.map(s => <option key={s}>{s}</option>)}</select>
          <input className="input w-auto py-2" type="date" value={t.interviewDate} onChange={e => update({ interviewDate: e.target.value })} aria-label="Interview date" />
          <button className="btn-quiet text-rose" onClick={async () => { if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; } await post('target-delete', { id }); await loadTargets(); nav('/companies'); }}><Trash2 className="h-4 w-4" />{armed ? 'Click again to delete' : ''}</button>
        </div>
      </header>

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Steps">
        {steps.map(([k, label, done, state], i) => (
          <NavLink key={k} to={`/c/${id}/${k}`} className={cx('glass relative overflow-hidden p-4 transition hover:border-white/20', cur === k && 'border-violet/50 bg-violet/[.08]')}>
            <span className="flex items-center gap-2 font-semibold"><span className={cx('grid h-6 w-6 place-items-center rounded-full text-xs font-bold', done ? 'bg-teal text-night-950' : 'bg-white/10 text-ink-2')}>{done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}</span>{label}</span>
            <span className="mt-1 block text-sm text-ink-3">{state}</span>
            {cur === k && <motion.span layoutId="steprail" className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-violet to-teal" />}
          </NavLink>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div key={cur} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          {cur === 'research' && <Research t={t} reload={reload} />}
          {cur === 'apply' && <Apply t={t} reload={reload} />}
          {cur === 'prepare' && <Prepare t={t} reload={reload} />}
          {cur === 'practise' && <Practise t={t} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Research({ t, reload }: { t: Json; reload: () => Promise<void> }) {
  const [params, setParams] = useSearchParams();
  const [states, setStates] = useState<{ cls: string; note: string }[]>([]);
  const [jd, setJd] = useState(t.jd ?? '');
  const { busy, run } = useAction();
  const started = useRef(false);
  const go = (fresh: boolean) => run('research', async () => {
    if (jd.trim() !== (t.jd ?? '')) await post('target-update', { id: t.id, jd });
    const st = STEP_NAMES.map(() => ({ cls: '', note: '' })).concat([{ cls: '', note: '' }]);
    for (let i = 0; i < 4; i++) {
      st[i] = { cls: 'run', note: '' }; setStates([...st]);
      const out = await post('research', { id: t.id, step: i, fresh }).catch((err: Error) => ({ error: err.message }));
      st[i] = { cls: out.error ? 'err' : 'done', note: out.error ?? `${out.sources} sources${out.cached ? ' · saved earlier' : ''}` }; setStates([...st]);
    }
    st[4] = { cls: 'run', note: '' }; setStates([...st]);
    await post('synthesize', { id: t.id });
    st[4] = { cls: 'done', note: '' }; setStates([...st]);
    await reload();
  });
  useEffect(() => { if (params.get('auto') && !started.current && !t.research) { started.current = true; setParams({}); go(false); } }); // eslint-disable-line react-hooks/exhaustive-deps
  const r = t.research;
  const runner = (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">{r ? 'Update the research' : `Research ${t.company}`}</h3>{r && <span className="text-sm text-ink-3">Last run {ago(r.at)}</span>}</div>
      {!r && <><p className="mt-2 text-ink-2">Four real web searches, then a brief where every claim is marked official, from candidate reports, or unverified, with its source.</p>
        <Field label="Job description (optional)"><textarea className="input mt-1 min-h-[110px]" value={jd} onChange={e => setJd(e.target.value)} /></Field></>}
      {(busy || states.length > 0) && (
        <ol className="mt-4 space-y-2">{[...STEP_NAMES, 'Write the brief'].map((n, i) => {
          const s = states[i]?.cls;
          return <li key={n} className={cx('flex items-center gap-3', s === 'err' ? 'text-rose' : s ? 'text-ink' : 'text-ink-3')}>
            <span className={cx('grid h-5 w-5 place-items-center rounded-full border', s === 'done' ? 'border-teal bg-teal text-night-950' : s === 'run' ? 'border-amber' : s === 'err' ? 'border-rose' : 'border-white/20')}>{s === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : s === 'run' ? <Spinner className="h-3 w-3 text-amber" /> : null}</span>
            {n}{states[i]?.note && <span className="text-sm text-ink-3">· {states[i].note}</span>}</li>;
        })}</ol>
      )}
      <div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary" disabled={!!busy} onClick={() => go(false)}>{busy ? <><Spinner />Researching</> : r ? 'Run again' : 'Start research'}</button>{r && <button className="btn-quiet" disabled={!!busy} onClick={() => go(true)}>Search fresh</button>}</div>
    </Card>
  );
  if (!r) return runner;
  const src = r.sources;
  const List = ({ items, render }: { items: Json[]; render: (x: Json) => JSX.Element | string }) => arr(items).length ? <ul className="space-y-2">{arr(items).map((x, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-violet" /><span>{render(x)}</span></li>)}</ul> : <p className="text-ink-3">Nothing found.</p>;
  return (
    <div className="space-y-6">
      <Rich text={r.summary} sources={src} className="max-w-3xl text-lg" />
      <Card>
        <h3 className="mb-4 text-lg font-semibold">The rounds</h3>
        <ol className="relative space-y-6 border-l border-white/10 pl-7">
          {arr(r.rounds).map((x: Json, i: number) => (
            <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative">
              <span className="absolute -left-[42px] grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-violet to-teal text-sm font-bold text-night-950">{i + 1}</span>
              <div className="flex flex-wrap items-center gap-2"><b className="text-lg">{x.name}</b><LabelChip label={x.label} /><Rich text={arr(x.refs).map((s: string) => `[${s}]`).join('')} sources={src} className="inline" /></div>
              <p className="text-sm text-ink-3">{x.format}</p><p className="mt-1">{x.tests}</p>
              {x.tips && !/not in research/i.test(x.tips) && <p className="mt-1 text-sm text-ink-2"><b className="text-amber">Tip</b> {x.tips}</p>}
            </motion.li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Pay</h3><LabelChip label={r.salary?.label} /></div><p className="mt-2 font-display text-3xl font-bold">{r.salary?.range ?? 'Not found'}</p><Rich text={`${r.salary?.basis ?? ''} ${arr(r.salary?.refs).map((s: string) => `[${s}]`).join('')}`} sources={src} className="mt-1 text-sm text-ink-2" /></Card>
        <Card><h3 className="mb-3 text-lg font-semibold">What they look for</h3><List items={r.whatTheyValue} render={x => String(x)} /></Card>
        <Card><h3 className="mb-3 text-lg font-semibold">About the company</h3><List items={r.companyFacts} render={x => <Rich text={`${x.fact} ${arr(x.refs).map((s: string) => `[${s}]`).join('')}`} sources={src} className="inline" />} /></Card>
        <Card><h3 className="mb-3 text-lg font-semibold">What the role needs</h3><List items={r.jdNeeds} render={x => String(x)} />{arr(r.techStack).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{arr(r.techStack).map((x: Json, i: number) => <Chip key={i}>{x.item}</Chip>)}</div>}</Card>
      </div>
      {arr(r.redFlags).length > 0 && <Card className="border-amber/30 bg-amber/[.06]"><h3 className="mb-2 text-lg font-semibold text-amber">Watch out</h3><List items={r.redFlags} render={x => <Rich text={String(x)} sources={src} className="inline" />} /></Card>}
      {arr(r.unknowns).length > 0 && <Card><h3 className="text-lg font-semibold">Ask the recruiter</h3><p className="mb-3 text-sm text-ink-3">The research couldn’t confirm these.</p><List items={r.unknowns} render={x => String(x)} /></Card>}
      <Card><details><summary className="cursor-pointer font-semibold text-violet">{arr(src).length} sources</summary><div className="mt-3"><Sources sources={src} /></div></details></Card>
      {runner}
    </div>
  );
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const { toast } = useApp();
  return <button className="btn-ghost py-1.5 text-xs" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied.')).catch(() => toast('Copy failed. Select the text instead.', true))}><Copy className="h-3.5 w-3.5" />{label}</button>;
}

function Apply({ t, reload }: { t: Json; reload: () => Promise<void> }) {
  const { toast } = useApp();
  const { busy, run } = useAction();
  const [jd, setJd] = useState(t.jd ?? '');
  const [type, setType] = useState<'referral' | 'recruiter' | 'followup' | 'thanks' | 'counter' | 'post'>('referral');
  const [who, setWho] = useState(''); const [extra, setExtra] = useState('');
  const [msg, setMsg] = useState<string>(t.messages?.[0]?.text ?? '');
  const [resumes, setResumes] = useState<Json[]>([]); const [base, setBase] = useState('');
  useEffect(() => { fetch('/api/state', { cache: 'no-store' }).then(r => r.json()).then(d => { setResumes(arr(d.resumes)); setBase(arr<Json>(d.resumes)[0]?.file ?? ''); }).catch(() => {}); }, []);
  const f = t.fit;
  return (
    <div className="space-y-6">
      {f && (
        <Card hi>
          <div className="flex flex-wrap items-center gap-6">
            <Ring value={f.score} size={120} stroke={11} color={f.score >= 75 ? '#2DD4BF' : f.score >= 55 ? '#FFB547' : '#FB7185'}><CountUp value={f.score} className="font-display text-3xl font-bold" /></Ring>
            <div className="min-w-0 flex-1"><h2 className="text-2xl font-bold">{f.verdict}</h2><p className="mt-1 text-ink-2">{f.experienceMatch}</p></div>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div><h3 className="mb-2 font-semibold text-teal">Where you match</h3><ul className="space-y-2">{arr(f.matched).map((m: Json, i: number) => <li key={i}><b>{m.need}.</b> <span className="text-ink-2">{m.proof}</span></li>)}</ul></div>
            <div><h3 className="mb-2 font-semibold text-amber">Gaps and how to close them</h3><ul className="space-y-2">{arr(f.gaps).map((m: Json, i: number) => <li key={i}><b>{m.need}.</b> <span className="text-ink-2">{m.fix}</span></li>)}</ul></div>
          </div>
          {arr(f.keywords).length > 0 && <div className="mt-5"><h3 className="mb-2 font-semibold">Keywords to add, only if true</h3><div className="flex flex-wrap gap-1.5">{arr(f.keywords).map((k: string) => <Chip key={k} tone="violet">{k}</Chip>)}</div></div>}
        </Card>
      )}
      {f && (
        <Card>
          <h3 className="text-lg font-semibold">Tailored for {t.company}</h3>
          <div className="mt-3 space-y-3">
            <div><div className="mb-1 flex items-center justify-between"><span className="label">Summary</span><CopyBtn text={f.summary} /></div><p className="rounded-xl bg-night-900/60 p-3">{f.summary}</p></div>
            <div><div className="mb-1 flex items-center justify-between"><span className="label">Bullets</span><CopyBtn text={arr(f.bullets).map((b: string) => `• ${b}`).join('\n')} /></div><ul className="space-y-1.5 rounded-xl bg-night-900/60 p-3">{arr(f.bullets).map((b: string, i: number) => <li key={i}>• {b}</li>)}</ul></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[.06] pt-4">
            <span className="text-sm text-ink-3">Copy a resume for {t.company}:</span>
            <select className="input w-auto max-w-full py-1.5 text-sm" value={base} onChange={e => setBase(e.target.value)}>{resumes.map(r => <option key={r.file} value={r.file}>{r.file.replace(/\.html$/, '').replace(/_/g, ' ')}</option>)}</select>
            <button className="btn-ghost" disabled={!base || !!busy} onClick={() => run('copy', async () => { const out = await post('tailor-copy', { id: t.id, from: base }); toast(`Created ${out.file.replace(/\.html$/, '')}.`); await reload(); })}>Create copy</button>
            {t.resumeFile && <a className="btn-quiet" href={`/?r=${encodeURIComponent(t.resumeFile.replace(/\.html$/, ''))}`}>Open it<ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        </Card>
      )}
      <Card>
        <h3 className="text-lg font-semibold">{f ? 'Job description' : `Check your fit for ${t.company}`}</h3>
        {!f && <p className="mt-1 text-ink-2">Paste the job description for a sharper result. Without one, the research is used.</p>}
        <textarea className="input mt-3 min-h-[120px]" value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the job description" />
        <button className="btn-primary mt-3" disabled={!!busy} onClick={() => run('fit', async () => { if (jd.trim() !== (t.jd ?? '')) await post('target-update', { id: t.id, jd }); await post('fit', { id: t.id }); await reload(); })}>{busy === 'fit' ? <><Spinner />Checking</> : f ? 'Check again' : 'Check my fit'}</button>
      </Card>
      <Card>
        <h3 className="mb-3 text-lg font-semibold">Write a message</h3>
        <Seg value={type} onChange={setType} options={[['referral', 'Referral ask'], ['recruiter', 'Recruiter reply'], ['followup', 'Follow-up'], ['thanks', 'Thank-you'], ['counter', 'Salary counter'], ['post', 'LinkedIn post']]} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Their name"><input className="input" value={who} onChange={e => setWho(e.target.value)} placeholder="Optional" /></Field><Field label="Anything to mention"><input className="input" value={extra} onChange={e => setExtra(e.target.value)} placeholder="Same college, offered 7 LPA…" /></Field></div>
        <button className="btn-primary mt-3" disabled={!!busy} onClick={() => run('msg', async () => { const out = await post('message', { id: t.id, type, name: who, extra }); setMsg(out.text); })}>{busy === 'msg' ? <><Spinner />Writing</> : <><Sparkles className="h-4 w-4" />Write it</>}</button>
        {msg && <div className="mt-4"><textarea className="input min-h-[140px]" value={msg} onChange={e => setMsg(e.target.value)} /><div className="mt-2"><CopyBtn text={msg} label="Copy message" /></div></div>}
      </Card>
    </div>
  );
}

function Prepare({ t, reload }: { t: Json; reload: () => Promise<void> }) {
  const kit = t.kit ?? {};
  const missing = KIT_ORDER.filter(k => !kit[k]);
  const [mode, setMode] = useState<'cards' | 'notes'>(arr(t.cards).length ? 'cards' : 'notes');
  const { busy, run } = useAction();
  const build = (sections: string[]) => run('kit', async () => { for (const s of sections) { setBuilding(s); await post('kit', { id: t.id, section: s }); } setBuilding(''); await reload(); });
  const [building, setBuilding] = useState('');
  return (
    <div className="space-y-6">
      {!t.research && <Card className="border-amber/30 bg-amber/[.06]">Research {t.company} first, so the prep matches how they actually interview. <Link className="font-semibold text-amber underline" to={`/c/${t.id}/research`}>Go to research</Link></Card>}
      {missing.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-lg font-semibold">{kit.technical ? 'Finish your prep kit' : 'Build your prep kit'}</h3><p className="text-sm text-ink-3">{missing.length} of 6 sections left. Each takes 15–40 seconds and only uses facts you can defend.</p></div>
            <button className="btn-primary" disabled={!!busy} onClick={() => build(missing)}>{busy ? <><Spinner />Building {KIT_TITLES[building]?.toLowerCase()}</> : `Build ${missing.length === 6 ? 'the kit' : 'the rest'}`}</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{missing.map(k => <button key={k} className="btn-ghost text-xs" disabled={!!busy} onClick={() => build([k])}>{KIT_TITLES[k]}</button>)}</div>
        </Card>
      )}
      {arr(t.cards).length > 0 && <div className="flex flex-wrap items-center justify-between gap-3"><Seg value={mode} onChange={setMode} options={[['cards', 'Flashcards'], ['notes', 'Study notes']]} /><span className="text-sm text-ink-3">{t.cardStats.known} of {t.cardStats.total} known</span></div>}
      {mode === 'cards' && arr(t.cards).length > 0 ? <Flashcards t={t} reload={reload} /> : <Notes t={t} rebuild={k => build([k])} busy={!!busy} />}
    </div>
  );
}

function Flashcards({ t, reload }: { t: Json; reload: () => Promise<void> }) {
  const [marks, setMarks] = useState<Record<string, string>>({ ...(t.practice ?? {}) });
  const [filter, setFilter] = useState('all');
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [said, setSaid] = useState('');
  const [fb, setFb] = useState<Json | null>(null);
  const { busy, run } = useAction();
  const decks = ['all', 'again', ...new Set(arr<Json>(t.cards).map(c => c.deck))];
  const cards = arr<Json>(t.cards).filter(c => filter === 'all' || (filter === 'again' ? marks[c.id] !== 'known' : c.deck === filter));
  const c = cards[Math.min(idx, cards.length - 1)];
  const reset = () => { setFlipped(false); setSaid(''); setFb(null); };
  const mark = async (v: 'known' | 'again') => {
    setMarks(m => ({ ...m, [c.id]: v }));
    post('target-update', { id: t.id, practice: { [c.id]: v } }).then(reload).catch(() => {});
    reset();
    if (!(filter === 'again' && v === 'known')) setIdx(i => i + 1);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.target as HTMLElement).tagName === 'TEXTAREA') return; if (e.key === ' ') { e.preventDefault(); setFlipped(f => !f); } if (e.key === 'ArrowRight') { reset(); setIdx(i => (i + 1) % Math.max(1, cards.length)); } if (e.key === 'ArrowLeft') { reset(); setIdx(i => Math.max(0, i - 1)); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [cards.length]);
  const deckBar = <Seg value={filter} onChange={v => { setFilter(v); setIdx(0); reset(); }} options={decks.map(d => [d, d === 'all' ? 'All' : d === 'again' ? 'Not known yet' : d] as [string, string])} />;
  if (!c) return <div className="space-y-4">{deckBar}<Empty title="Pile cleared" action={<Link className="btn-primary" to={`/studio/${t.id}`}>Enter the mock studio</Link>}>Every card here is marked known. Time for a real mock interview.</Empty></div>;
  return (
    <div className="space-y-4">
      {deckBar}
      <div className="flex items-center gap-3"><Bar value={(Object.values(marks).filter(v => v === 'known').length / arr(t.cards).length) * 100} color="bg-teal" className="flex-1" /><span className="tnum text-sm text-ink-3">{Math.min(idx, cards.length - 1) + 1} / {cards.length}</span></div>
      <div style={{ perspective: 1400 }}>
        <motion.div className="relative grid min-h-[360px]" style={{ transformStyle: 'preserve-3d' }} animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
          <div className="glass-hi relative flex flex-col gap-4 p-6 sm:p-8" style={{ backfaceVisibility: 'hidden' }}>
            <span className="text-sm font-semibold text-ink-3">{c.deck}{c.deck === 'Projects' && c.note ? ` · ${c.note}` : ''}</span>
            <p className="font-display text-2xl font-semibold leading-snug sm:text-[28px]">{c.q}</p>
            <textarea className="input mt-auto min-h-[90px]" value={said} onChange={e => setSaid(e.target.value)} placeholder="Answer before you look — type it, or say it out loud first." />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => setFlipped(true)}>Flip card</button>
              <button className="btn-ghost" disabled={!!busy || said.trim().length < 20} onClick={() => run('score', async () => { setFb(await post('explain', { topic: c.q, kind: 'concept', explanation: said, targetId: t.id })); setFlipped(true); })}>{busy ? <><Spinner />Scoring</> : 'Score my answer'}</button>
              <span className="ml-auto self-center text-xs text-ink-3">Space flips · ← → move</span>
            </div>
          </div>
          <div className="glass-hi absolute inset-0 flex flex-col gap-4 overflow-y-auto p-6 sm:p-8" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <span className="text-sm font-semibold text-teal">A strong answer</span>
            {fb && <Feedback fb={fb} compact />}
            <Rich text={c.a} />
            {arr(c.points).length > 0 && <div className="flex flex-wrap gap-1.5">{arr(c.points).map((p: string) => <Chip key={p} tone="violet">{p}</Chip>)}</div>}
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              <button className="btn-amber" onClick={() => mark('again')}><RotateCcw className="h-4 w-4" />Again later</button>
              <button className="btn-primary" onClick={() => mark('known')}><Check className="h-4 w-4" />Got it</button>
              <button className="btn-quiet ml-auto" onClick={() => setFlipped(false)}>Flip back</button>
            </div>
          </div>
        </motion.div>
      </div>
      <div className="flex items-center justify-between">
        <button className="btn-quiet" disabled={idx === 0} onClick={() => { reset(); setIdx(i => Math.max(0, i - 1)); }}><ChevronLeft className="h-4 w-4" />Previous</button>
        <div className="flex flex-wrap justify-center gap-1">{cards.slice(0, 40).map((x, i) => <span key={x.id} className={cx('h-2 w-2 rounded-full', marks[x.id] === 'known' ? 'bg-teal' : marks[x.id] === 'again' ? 'bg-amber' : 'bg-white/15', i === idx && 'ring-2 ring-ink ring-offset-1 ring-offset-night-950')} />)}</div>
        <button className="btn-quiet" onClick={() => { reset(); setIdx(i => (i + 1) % cards.length); }}>Skip<ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function Feedback({ fb, compact }: { fb: Json; compact?: boolean }) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/[.08] bg-night-900/60 p-4">
      <div className="flex items-center justify-between gap-3"><b>{fb.verdict}</b><span className="font-display text-2xl font-bold tnum">{fb.overall}<span className="text-sm text-ink-3">/10</span></span></div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">{Object.entries(fb.scores ?? {}).map(([k, v]) => <Fragment key={k}><span className="capitalize text-ink-2">{k}</span><Bar value={Number(v) * 20} color={Number(v) >= 4 ? 'bg-teal' : 'bg-amber'} /><span className="tnum">{String(v)}</span></Fragment>)}</div>
      {!compact && arr(fb.fix).length > 0 && <div><b className="text-amber">Fix</b><ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">{arr(fb.fix).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>}
      {arr(fb.missing).length > 0 && <div><b>They expected to hear</b><ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">{arr(fb.missing).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>}
      {arr(fb.wrong).length > 0 && <p className="text-rose"><b>Not correct:</b> {arr(fb.wrong).join('; ')}</p>}
      <div className="rounded-xl bg-violet/10 p-3"><b className="text-violet">Say it like this</b><p className="mt-1">{fb.tighter}</p></div>
    </div>
  );
}

function Notes({ t, rebuild, busy }: { t: Json; rebuild: (k: string) => void; busy: boolean }) {
  const kit = t.kit ?? {};
  const src = t.research?.sources;
  const Q = ({ q, children, sub }: { q: string; children: JSX.Element; sub?: string }) => <details className="group border-t border-white/[.06] py-3 first:border-0"><summary className="flex cursor-pointer list-none items-start justify-between gap-3 font-semibold"><span>{q}{sub && <span className="block text-sm font-normal text-ink-3">{sub}</span>}</span><span className="text-ink-3 transition group-open:rotate-45">+</span></summary><div className="mt-2">{children}</div></details>;
  const sections = KIT_ORDER.filter(k => kit[k]);
  if (!sections.length) return <Empty title="No prep yet">Build the kit above. It takes a few minutes and is written from your own projects.</Empty>;
  return (
    <div className="space-y-6">{sections.map(k => {
      const d = kit[k]; const items = arr<Json>(d.items);
      return (
        <Card key={k}>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-lg font-semibold">{KIT_TITLES[k]}</h3><button className="btn-quiet text-xs" disabled={busy} onClick={() => rebuild(k)}><RotateCcw className="h-3.5 w-3.5" />Rebuild</button></div>
          {k === 'technical' && items.map((x, i) => <Q key={i} q={x.q} sub={x.why}><Rich text={x.answer} /></Q>)}
          {k === 'projects' && items.map((x, i) => <Q key={i} q={x.project} sub={x.whyRelevant}><div className="space-y-2"><p><b>In 30 seconds:</b> {x.pitch30}</p><Rich text={x.star} />{arr(x.dontSay).length > 0 && <p className="text-sm text-amber">Don’t claim: {arr(x.dontSay).join('; ')}</p>}</div></Q>)}
          {k === 'hr' && <>{d.ctcScript && <div className="mb-3 space-y-1 rounded-xl bg-teal/10 p-4"><b className="text-teal">Salary script</b><p><b>Current:</b> {d.ctcScript.current}</p><p><b>Expected:</b> {d.ctcScript.expected}</p><p><b>If they push back:</b> {d.ctcScript.ifPushed}</p><p><b>Walk away when:</b> {d.ctcScript.walkAway}</p></div>}{items.map((x, i) => <Q key={i} q={x.q}><Rich text={x.answer} sources={src} /></Q>)}</>}
          {k === 'concepts' && items.map((x, i) => <Q key={i} q={x.concept} sub={x.priority === 'must' ? 'Must know' : x.priority === 'should' ? 'Should know' : 'Nice to know'}><div className="space-y-2"><p>{x.simple}</p><p className="text-sm text-ink-2"><b>In your work:</b> {x.inYourWork}</p>{arr(x.check).map((c: Json, j: number) => <p key={j} className="text-sm"><b>{c.q}</b> <span className="text-ink-3">{c.a}</span></p>)}</div></Q>)}
          {k === 'ask' && <ul className="space-y-2">{items.map((x, i) => <li key={i}>{x.q} <span className="text-sm text-ink-3">({x.round})</span></li>)}</ul>}
          {k === 'plan' && <div className="space-y-3">{arr(d.days).map((x: Json, i: number) => <div key={i}><b>{x.day}: {x.focus}</b><ul className="mt-1 list-disc pl-5 text-ink-2">{arr(x.tasks).map((z: string, j: number) => <li key={j}>{z}</li>)}</ul></div>)}</div>}
        </Card>
      );
    })}</div>
  );
}

function Practise({ t }: { t: Json }) {
  const rounds = arr<Json>(t.research?.rounds).map(r => r.name).filter(Boolean);
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl2 border border-violet/30 bg-gradient-to-br from-violet/20 via-night-850 to-teal/10 p-8">
        <div className="pointer-events-none absolute -right-12 -top-12 h-60 w-60 rounded-full bg-violet/30 blur-3xl" />
        <h2 className="text-3xl font-bold">Step into the {t.company} studio</h2>
        <p className="mt-2 max-w-xl text-ink-2">The interviewer speaks each question out loud. You answer by voice with a live waveform and captions, and get a scorecard after every answer.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {(rounds.length ? rounds : ['Technical', 'Managerial', 'HR']).slice(0, 5).map(r => <Link key={r} className="btn-primary" to={`/studio/${t.id}?round=${encodeURIComponent(r)}`}><Mic className="h-4 w-4" />{r}</Link>)}
          <Link className="btn-ghost" to={`/studio/${t.id}?mode=explain`}>Explain something instead</Link>
        </div>
      </div>
      {arr(t.mocks).length > 0 && (
        <Card>
          <h3 className="mb-3 text-lg font-semibold">Your reports</h3>
          <div className="space-y-4">{arr<Json>(t.mocks).map((m, i) => (
            <details key={i} className="rounded-xl border border-white/[.06] p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3"><span><b>{m.round}</b> <span className="text-ink-3">· {ago(m.at)}</span></span><span className="font-display text-xl font-bold tnum">{m.report?.overall}<span className="text-sm text-ink-3">/10</span></span></summary>
              <p className="mt-3 text-ink-2">{m.report?.summary}</p>
              <ul className="mt-2 space-y-1">{arr(m.report?.weakSpots).map((w: Json, j: number) => <li key={j}><b className="text-amber">{w.topic}.</b> {w.fix}</li>)}</ul>
            </details>
          ))}</div>
        </Card>
      )}
    </div>
  );
}
