import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { post, type Json } from '../lib/api';
import { useAction } from '../lib/state';
import { Card, PageHead, Spinner } from '../components/ui';
import { local, arr } from '../lib/util';

const COLS: [string, string][] = [['company', 'Company'], ['role', 'Role'], ['fixedLpa', 'Fixed (LPA)'], ['variableLpa', 'Variable (LPA)'], ['joiningBonus', 'Joining bonus'], ['location', 'City / mode'], ['joining', 'Joining date'], ['notes', 'Notes: bond, benefits']];
export default function Offers() {
  const [st, setSt] = useState<{ rows: Json[]; result: Json | null }>(local.get('offers', { rows: [{}], result: null }));
  const { busy, run } = useAction();
  const save = (s: typeof st) => { setSt(s); local.set('offers', s); };
  const r = st.result;
  return (
    <div className="space-y-6">
      <PageHead title="Offers" sub="Compare offers and get the exact words for negotiating. Researched pay is used as evidence." />
      <div className="glass overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink-3">{COLS.map(([, l]) => <th key={l} className="px-3 py-3 font-semibold">{l}</th>)}<th /></tr></thead>
        <tbody>{st.rows.map((row, i) => (
          <tr key={i} className="border-t border-white/[.06]">{COLS.map(([k]) => <td key={k} className="px-2 py-2"><input className="input min-w-[110px] py-1.5" value={row[k] ?? ''} onChange={e => { const rows = [...st.rows]; rows[i] = { ...row, [k]: e.target.value }; save({ ...st, rows }); }} /></td>)}
            <td className="px-2"><button className="btn-quiet" aria-label="Remove" onClick={() => save({ ...st, rows: st.rows.filter((_, j) => j !== i).length ? st.rows.filter((_, j) => j !== i) : [{}] })}><Trash2 className="h-4 w-4" /></button></td></tr>
        ))}</tbody></table></div>
      <div className="flex gap-2"><button className="btn-ghost" onClick={() => save({ ...st, rows: [...st.rows, {}] })}><Plus className="h-4 w-4" />Add an offer</button>
        <button className="btn-amber" disabled={!!busy} onClick={() => run('cmp', async () => { const offers = st.rows.filter(x => x.company); if (!offers.length) throw new Error('Add at least one offer with a company name.'); save({ ...st, result: await post('offers', { offers }) }); })}>{busy ? <><Spinner />Comparing</> : 'Compare and plan the negotiation'}</button></div>
      {r && <>
        <Card hi><h2 className="text-2xl font-bold">{r.recommendation}</h2></Card>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{arr<Json>(r.comparison).map((c, i) => <Card key={i}><h3 className="text-lg font-semibold">{c.company}</h3><p className="font-display text-3xl font-bold">{c.fixedLpa} LPA</p><p className="text-sm text-ink-3">{c.inHandMonthlyApprox}</p><p className="mt-3 font-semibold text-teal">Good</p><ul className="list-disc pl-5 text-ink-2">{arr(c.pros).map((x: string, j: number) => <li key={j}>{x}</li>)}</ul><p className="mt-2 font-semibold text-amber">Watch</p><ul className="list-disc pl-5 text-ink-2">{arr(c.cons).map((x: string, j: number) => <li key={j}>{x}</li>)}</ul></Card>)}</div>
        <Card><h3 className="mb-3 text-lg font-semibold">How to negotiate</h3><div className="space-y-4">{arr<Json>(r.negotiate).map((n, i) => <div key={i}><b>{n.company}: {n.ask}</b><p className="mt-2 rounded-xl bg-violet/10 p-4">{n.script}</p></div>)}</div></Card>
        {arr(r.watchOuts).length > 0 && <Card className="border-amber/30"><h3 className="text-lg font-semibold text-amber">Check before you sign</h3><ul className="mt-2 list-disc pl-5">{arr(r.watchOuts).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></Card>}
      </>}
    </div>
  );
}
