import { useEffect, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { post, type Json } from '../lib/api';
import { useApp, useAction } from '../lib/state';
import { Card, PageHead, Field, Seg, Spinner, Chip } from '../components/ui';
import { ago, arr } from '../lib/util';

export default function Profile() {
  const { profile, loadProfile, toast } = useApp();
  const { busy, run } = useAction();
  const [p, setP] = useState<Json | null>(profile);
  const [guide, setGuide] = useState('https://deepsinterview.vercel.app/');
  useEffect(() => setP(profile), [profile]);
  if (!p) return <Spinner />;
  const fresh = !arr(p.facts).length;
  const counts = { defend: 0, unsure: 0, dont: 0 } as Record<string, number>;
  arr<Json>(p.facts).forEach(f => counts[f.status]++);
  const set = (k: string, v: unknown) => setP({ ...p, [k]: v });
  return (
    <div className="space-y-6 pb-20">
      <PageHead title="My profile" sub="Everything the app may say about you. Mark a fact “I can defend” only if you can talk about it for ten minutes." />
      <div className={fresh ? 'relative overflow-hidden rounded-xl2 p-[1.5px]' : ''} style={fresh ? { background: 'linear-gradient(120deg,#FFB547,#8B7CFF,#2DD4BF)' } : undefined}>
        <Card className={fresh ? 'rounded-[calc(1.25rem-1px)] bg-night-900/95' : ''}>
          <h3 className="text-lg font-semibold">{fresh ? 'Build your profile from your resumes' : 'Rebuild from your resumes'}</h3>
          <p className="mt-1 text-sm text-ink-2">Reads every resume plus your interview guide. Big claims that appear only once are marked unsure. Pay and notice period are kept.{!fresh && ' Rebuilding replaces your projects and facts.'}</p>
          <div className="mt-3 flex flex-wrap gap-2"><input className="input flex-1" value={guide} onChange={e => setGuide(e.target.value)} aria-label="Interview guide link" />
            <button className={fresh ? 'btn-amber' : 'btn-ghost'} disabled={!!busy} onClick={() => run('seed', async () => { await post('profile-seed', { guideUrl: guide }); await loadProfile(); toast('Profile built. Check the facts marked unsure.'); })}>{busy === 'seed' ? <><Spinner />Reading, about a minute</> : <><Wand2 className="h-4 w-4" />{fresh ? 'Build my profile' : 'Rebuild'}</>}</button></div>
        </Card>
      </div>
      {!fresh && <>
        <Card>
          <h3 className="mb-3 text-lg font-semibold">Basics</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[['name', 'Name'], ['headline', 'Headline'], ['years', 'Experience'], ['location', 'City'], ['currentCtc', 'Current pay (CTC)'], ['targetCtc', 'Target pay'], ['noticePeriod', 'Notice period']].map(([k, l]) => <Field key={k} label={l}><input className="input" value={p[k] ?? ''} onChange={e => set(k, e.target.value)} /></Field>)}</div>
          <Field label="Summary"><textarea className="input mt-1 min-h-[90px]" value={p.summary ?? ''} onChange={e => set('summary', e.target.value)} /></Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Skills you can defend" hint="Separate with commas."><textarea className="input" value={arr(p.skills?.defend).join(', ')} onChange={e => set('skills', { ...p.skills, defend: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Field>
            <Field label="Still learning"><textarea className="input" value={arr(p.skills?.learning).join(', ')} onChange={e => set('skills', { ...p.skills, learning: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Field>
          </div>
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-semibold">Projects</h3><button className="btn-ghost" onClick={() => set('projects', [{ id: '', name: 'New project', stack: [], problem: '', what: '', impact: '', story: '' }, ...arr(p.projects)])}><Plus className="h-4 w-4" />Add</button></div>
          <div className="space-y-2">{arr<Json>(p.projects).map((x, i) => (
            <details key={i} className="rounded-xl border border-white/[.06] p-4" open={!x.id}>
              <summary className="cursor-pointer font-semibold">{x.name || 'New project'}<span className="ml-2 text-sm font-normal text-ink-3">{arr(x.stack).slice(0, 4).join(', ')}</span></summary>
              <div className="mt-3 space-y-3">
                {[['name', 'Name', 1], ['stack', 'Stack (commas)', 1], ['problem', 'The problem', 2], ['what', 'What you did', 3], ['impact', 'Impact, real numbers only', 2], ['story', 'The 2-minute story', 6]].map(([k, l, rows]) => (
                  <Field key={String(k)} label={String(l)}><textarea className="input" rows={Number(rows)} value={k === 'stack' ? arr(x.stack).join(', ') : x[String(k)] ?? ''} onChange={e => { const projects = [...p.projects]; projects[i] = { ...x, [String(k)]: k === 'stack' ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : e.target.value }; set('projects', projects); }} /></Field>
                ))}
                <button className="btn-quiet text-rose" onClick={() => set('projects', p.projects.filter((_: Json, j: number) => j !== i))}><Trash2 className="h-4 w-4" />Remove project</button>
              </div>
            </details>
          ))}</div>
        </Card>
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Facts</h3><div className="flex flex-wrap gap-1.5"><Chip tone="teal">{counts.defend} I can defend</Chip><Chip tone="amber">{counts.unsure} unsure</Chip><Chip tone="rose">{counts.dont} don’t claim</Chip><button className="btn-ghost py-1 text-xs" onClick={() => set('facts', [{ id: '', text: '', area: 'other', status: 'defend' }, ...p.facts])}><Plus className="h-3.5 w-3.5" />Add</button></div></div>
          <div className="divide-y divide-white/[.06]">{arr<Json>(p.facts).map((f, i) => (
            <div key={f.id || i} className="flex flex-wrap items-start gap-3 py-3">
              <textarea className="input min-h-[44px] flex-1 basis-80" rows={1} value={f.text} onChange={e => { const facts = [...p.facts]; facts[i] = { ...f, text: e.target.value }; set('facts', facts); }} />
              <Seg value={f.status} onChange={v => { const facts = [...p.facts]; facts[i] = { ...f, status: v }; set('facts', facts); }} options={[['defend', 'I can defend'], ['unsure', 'Unsure'], ['dont', 'Don’t claim']]} />
              <button className="btn-quiet" aria-label="Delete fact" onClick={() => set('facts', p.facts.filter((_: Json, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}</div>
        </Card>
        <div className="fixed inset-x-0 bottom-20 z-20 flex justify-center px-4 lg:bottom-6 lg:pl-64">
          <div className="glass-hi flex items-center gap-3 px-3 py-2 shadow-glow"><span className="text-sm text-ink-3">{p.updatedAt ? `Saved ${ago(p.updatedAt)}` : 'Not saved'}</span>
            <button className="btn-primary" disabled={!!busy} onClick={() => run('save', async () => { await post('profile', p); await loadProfile(); toast('Profile saved.'); })}>{busy === 'save' ? <Spinner /> : 'Save profile'}</button></div>
        </div>
      </>}
    </div>
  );
}
