import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import { post, type Json } from '../lib/api';
import { useApp, useAction } from '../lib/state';
import { Card, PageHead, Rich, Sources, Spinner } from '../components/ui';
import { local, ago, arr } from '../lib/util';

const EXAMPLES = ['What does Infosys pay a Python developer with 2 years?', 'How do I get a referral at Zoho?', 'Which Chennai startups hire FastAPI developers right now?', 'How do I answer “why are you leaving” honestly?'];

export default function Ask() {
  const { targets } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [target, setTarget] = useState('');
  const [items, setItems] = useState<Json[]>(local.get('ask', []));
  const { busy, run } = useAction();
  const fired = useRef(false);
  const ask = (question: string) => run('ask', async () => {
    if (question.trim().length < 5) return;
    const out = await post('ask', { question, targetId: target || undefined });
    const next = [{ question, ...out, at: Date.now() }, ...items].slice(0, 15);
    setItems(next); local.set('ask', next); setQ('');
  });
  useEffect(() => { const pre = params.get('q'); if (pre && !fired.current) { fired.current = true; setQ(pre); setParams({}); ask(pre); } }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHead title="Ask anything" sub="Ask in your own words. It works out what you need, searches the web, and answers with sources." />
      <div className="glass-hi p-2">
        <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); ask(q); }}>
          <Search className="ml-3 h-5 w-5 flex-none text-ink-3" />
          <input className="min-w-0 flex-1 bg-transparent px-2 py-3 text-lg outline-none placeholder:text-ink-3" value={q} onChange={e => setQ(e.target.value)} placeholder="What do you want to know?" />
          <button className="btn-amber" disabled={!!busy}>{busy ? <><Spinner />Searching</> : <><Sparkles className="h-4 w-4" />Ask</>}</button>
        </form>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[.06] px-3 pb-1 pt-2">
          <select className="rounded-lg bg-transparent text-sm text-ink-2 outline-none" value={target} onChange={e => setTarget(e.target.value)}><option value="">Any company</option>{targets.map(t => <option key={t.id} value={t.id}>About {t.company}</option>)}</select>
        </div>
      </div>
      {!items.length && !busy && <div className="flex flex-wrap gap-2">{EXAMPLES.map(e => <button key={e} className="btn-ghost text-left" onClick={() => { setQ(e); ask(e); }}>{e}</button>)}</div>}
      <AnimatePresence initial={false}>{items.map(a => (
        <motion.div key={a.at} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <h3 className="text-xl font-semibold">{a.question}</h3>
            {a.intent && <p className="mt-1 text-sm text-ink-3">Understood as: {a.intent}</p>}
            <Rich text={a.answer} sources={a.sources} className="mt-4" />
            <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-violet">{arr(a.sources).length} sources{arr(a.queries).length ? ` from ${arr(a.queries).length} searches` : ''}</summary>
              {arr(a.queries).length > 0 && <p className="mb-2 mt-2 text-xs text-ink-3">Searched: {arr<string>(a.queries).map(x => `“${x}”`).join(', ')}</p>}<Sources sources={a.sources} /></details>
            <p className="mt-3 text-xs text-ink-3">{ago(a.at)}</p>
          </Card>
        </motion.div>
      ))}</AnimatePresence>
    </div>
  );
}
