import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Zap } from 'lucide-react';
import { get, post, type Json } from '../lib/api';
import { useApp } from '../lib/state';
import { Card, PageHead, Bar, Spinner } from '../components/ui';
import { ago, arr, dur, cx } from '../lib/util';

const USED: Record<string, string> = { rpm: 'minuteRequests', rpd: 'dayRequests', tpm: 'minuteTokens', tpd: 'dayTokens', perMonth: 'monthRequests' };
const LABEL: Record<string, string> = { rpm: 'Requests / min', tpm: 'Tokens / min', rpd: 'Requests today', tpd: 'Tokens today', perMonth: 'This month' };
export default function Status() {
  const { toast, loadStatus } = useApp();
  const [st, setSt] = useState<Json | null>(null);
  const [testing, setTesting] = useState('');
  const load = () => get('status').then(setSt).catch(err => toast(err.message, true));
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return <Spinner />;
  const card = (b: Json, i: number) => {
    const tone = b.state === 'ready' ? 'text-teal bg-teal-soft' : b.state === 'cooling' ? 'text-amber bg-amber-soft' : 'text-rose bg-rose-soft';
    const label = b.state === 'ready' ? 'Ready' : b.state === 'blocked' ? 'Blocked' : `Back in ${dur(b.readyInMs)}`;
    return (
      <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className={cx('glass flex flex-col gap-3 p-5', b.state !== 'ready' && 'opacity-90')}>
        <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words font-semibold">{b.label.replace(' · ', ': ')}</h3><span className={cx('chip', tone)}>{label}</span></div>
        {b.blocked && <p className="text-sm text-rose">{b.blocked.reason}</p>}
        {!b.blocked && b.state === 'exhausted' && <p className="text-sm text-ink-3">Today’s free quota is used up. It refills on its own.</p>}
        <div className="space-y-2.5">{Object.keys(USED).filter(k => b.limits?.[k]).map(k => { const used = b.used[USED[k]], lim = b.limits[k], p = (used / lim) * 100; return (
          <div key={k}><div className="flex justify-between text-sm"><span className="text-ink-2">{LABEL[k]}</span><span className="tnum text-ink-3">{used.toLocaleString('en-IN')} / {lim.toLocaleString('en-IN')}</span></div><Bar value={p} color={p > 85 ? 'bg-rose' : p > 60 ? 'bg-amber' : 'bg-teal'} className="mt-1 h-1.5" /></div>
        ); })}</div>
        {b.header && <p className="text-sm text-ink-2"><b className="text-ink">Provider says</b> {b.header.remainingRequests ?? '?'} / {b.header.limitRequests ?? '?'} requests, {b.header.remainingTokens ?? '?'} / {b.header.limitTokens ?? '?'} tokens left <span className="text-ink-3">({ago(b.header.at)})</span></p>}
        <p className="text-xs text-ink-3">{b.lastOkAt ? `Answered ${ago(b.lastOkAt)}${b.lastLatencyMs ? ` in ${dur(b.lastLatencyMs)}` : ''}` : 'Not used yet'} · {b.totals.requests} calls · {b.totals.errors} errors</p>
        {b.lastError && <details className="text-xs text-ink-3"><summary className="cursor-pointer">Last error</summary><p className="mt-1">{ago(b.lastError.at)}: {b.lastError.message}</p></details>}
        {!b.id.startsWith('search:') && !/whisper|orpheus/.test(b.id) && <button className="btn-ghost mt-auto self-start py-1.5 text-xs" disabled={testing === b.id} onClick={async () => { setTesting(b.id); const r = await post('probe', { id: b.id }).catch((e: Error) => ({ ok: false, error: e.message })); toast(r.ok ? `Answered in ${dur(r.latencyMs)}.` : r.error, !r.ok); setTesting(''); load(); loadStatus(); }}>{testing === b.id ? <Spinner /> : <Zap className="h-3.5 w-3.5" />}Test now</button>}
      </motion.div>
    );
  };
  const models = arr<Json>(st.budgets).filter(b => !b.id.startsWith('search:') && !/whisper|orpheus/.test(b.id));
  const services = arr<Json>(st.budgets).filter(b => b.id.startsWith('search:') || /whisper|orpheus/.test(b.id));
  const mistralBlocked = models.some(b => b.id.startsWith('mistral') && b.state === 'blocked');
  return (
    <div className="space-y-8">
      <PageHead title="AI status" sub="Every free model and service, its limits, and what’s left. Updates every 10 seconds." right={<button className="btn-ghost" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</button>} />
      <section><h2 className="mb-3 text-xl font-semibold">Models</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{models.map(card)}</div></section>
      <section><h2 className="mb-3 text-xl font-semibold">Search and voice</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{services.map(card)}</div>
        <p className="mt-3 text-sm text-ink-3">Search tries Google (via Gemini, ~18/day), then Groq browser search, then Tavily if configured. Results are saved for 7 days.</p></section>
      <Card><h3 className="mb-3 text-lg font-semibold">Which model answers what</h3><div className="grid gap-5 md:grid-cols-3">{Object.entries(st.routes ?? {}).map(([task, ids]) => (
        <div key={task}><b>{({ fast: 'Conversation', smart: 'Careful work', light: 'Short writing' } as Record<string, string>)[task] ?? task}</b><p className="text-xs text-ink-3">{({ fast: 'Mocks, mentor, explain', smart: 'Research, prep kits, fit', light: 'Messages' } as Record<string, string>)[task]}</p><ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-ink-2">{arr(ids as string[]).map(id => <li key={id}>{id}</li>)}</ol></div>
      ))}</div></Card>
      {(mistralBlocked || !st.searchConfigured?.tavily || services.some(b => b.id.includes('orpheus') && b.state === 'blocked')) && (
        <Card className="border-amber/30 bg-amber/[.05]"><h3 className="text-lg font-semibold text-amber">Unlock more free capacity</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
          {mistralBlocked && <li>Mistral: turn on the free Experiment plan at console.mistral.ai (Admin → Billing), then press Test.</li>}
          {services.some(b => b.id.includes('orpheus') && b.state === 'blocked') && <li>Interviewer voice: accept the Orpheus terms in the Groq console playground. Until then the browser’s voice is used.</li>}
          {!st.searchConfigured?.tavily && <li>Deeper research: add a free Tavily key as TAVILY_API_KEY (1,000 searches/month).</li>}
        </ul></Card>
      )}
    </div>
  );
}
