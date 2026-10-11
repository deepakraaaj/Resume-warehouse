import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Plus, ArrowRight } from 'lucide-react';
import { useApp, useAction } from '../lib/state';
import { post } from '../lib/api';
import { Card, PageHead, Ring, Empty, Field, Spinner } from '../components/ui';
import { daysUntil, fmtDate, parseDate } from '../lib/util';

export function Companies() {
  const { targets } = useApp();
  return (
    <div className="space-y-6">
      <PageHead title="Companies" sub="Every company you’re going after, from research to offer." right={<Link to="/new" className="btn-primary"><Plus className="h-4 w-4" />Add a company</Link>} />
      {targets.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {targets.map((t, i) => {
            const d = daysUntil(t.interviewDate);
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Link to={`/c/${t.id}`} className="glass group flex items-center gap-5 p-5 transition hover:-translate-y-0.5 hover:border-violet/40">
                  <Ring value={t.readiness ?? 0} size={78} stroke={8} color={(t.readiness ?? 0) >= 60 ? '#2DD4BF' : '#FFB547'}><span className="tnum font-display text-lg font-bold">{t.readiness ?? 0}</span></Ring>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-semibold">{t.company}</p>
                    <p className="truncate text-sm text-ink-2">{t.role}</p>
                    <p className="mt-1 text-xs text-ink-3">{t.stage}{d != null && d >= 0 ? ` · interview ${d === 0 ? 'today' : `in ${d}d`}` : ''}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-ink-3 transition group-hover:translate-x-1 group-hover:text-ink" />
                </Link>
              </motion.div>
            );
          })}
        </div>
      ) : <Empty title="No companies yet" action={<Link to="/new" className="btn-primary">Add a company</Link>}>Add the company and role you’re applying for. The app researches how they interview and prepares you from your own projects.</Empty>}
    </div>
  );
}

export function NewCompany() {
  const { loadTargets } = useApp();
  const { busy, run } = useAction();
  const nav = useNavigate();
  const [f, setF] = useState({ company: '', role: '', location: '', interviewDate: '', jd: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHead title="Add a company" sub="A pasted job description makes everything sharper." />
      <Card hi>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); run('add', async () => { const t = await post('target-create', f); await loadTargets(); nav(`/c/${t.id}/research?auto=1`); }); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company"><input className="input" required value={f.company} onChange={set('company')} placeholder="Infosys" autoFocus /></Field>
            <Field label="Role"><input className="input" required value={f.role} onChange={set('role')} placeholder="Python Developer" /></Field>
            <Field label="City"><input className="input" value={f.location} onChange={set('location')} placeholder="Chennai" /></Field>
            <Field label="Interview date" hint="Leave empty if you don’t have one yet."><input className="input" type="date" value={f.interviewDate} onChange={set('interviewDate')} /></Field>
          </div>
          <Field label="Job description"><textarea className="input min-h-[150px]" value={f.jd} onChange={set('jd')} placeholder="Paste the full job description (optional)" /></Field>
          <button className="btn-primary px-6 py-2.5" disabled={!!busy}>{busy ? <><Spinner />Adding</> : 'Add and start research'}</button>
        </form>
      </Card>
    </div>
  );
}
export { fmtDate, parseDate };
