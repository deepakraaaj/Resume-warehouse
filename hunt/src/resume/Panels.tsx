import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, AlertTriangle, X, Trash2, Wand2, GitCommitHorizontal, PenLine, Copy } from 'lucide-react';
import { FONTS, ACCENTS, STEPS, setFont, editCss, setAccent, setColumns, moveSection, removeSection, readDesign, atsChecks, jdKeywords, containsTerm, hexToHsl, hslToHex } from './engine.js';
import type { Json } from '../lib/api';
import { get } from '../lib/api';
import { useApp } from '../lib/state';
import { cx, local, ago, arr } from '../lib/util';
import { Spinner, Chip } from '../components/ui';

type DocFn = () => Document | null;
type Act = (fn: (doc: Document) => unknown) => void;

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="space-y-2.5 border-t border-white/[.06] pt-4 first:border-0 first:pt-0"><h3 className="text-sm font-semibold text-ink-2">{title}</h3>{children}</section>;
const Stepper = ({ label, value, onStep, disabled }: { label: string; value: string; onStep: (d: number) => void; disabled: boolean }) => (
  <div className="flex items-center justify-between gap-2 text-sm"><span className="text-ink-2">{label}</span>
    <span className="flex items-center gap-1 rounded-full border border-white/10 bg-night-900/70 p-0.5"><button disabled={disabled} className="h-7 w-7 rounded-full hover:bg-white/10 disabled:opacity-40" onClick={() => onStep(-1)} aria-label={`Less ${label}`}>−</button><output className="tnum min-w-[4.5rem] text-center">{value}</output><button disabled={disabled} className="h-7 w-7 rounded-full hover:bg-white/10 disabled:opacity-40" onClick={() => onStep(1)} aria-label={`More ${label}`}>+</button></span></div>
);

export function DesignPanel({ doc, version, act, canEdit, onFit, fitting }: { doc: DocFn; version: number; act: Act; canEdit: boolean; onFit: () => void; fitting: boolean }) {
  const d = readDesign(doc());
  const [custom, setCustom] = useState(false);
  const [hue, setHue] = useState(200); const [depth, setDepth] = useState(32); const [hex, setHex] = useState('');
  useEffect(() => { if (d?.accent) { const [h, , l] = hexToHsl(d.accent); setHue(Math.round(h)); setDepth(Math.round(Math.min(48, Math.max(15, l * 100)))); setHex(d.accent); } }, [version, d?.accent]);
  if (!d) return <p className="text-sm text-ink-3">Open a resume to see its design.</p>;
  const isCustom = d.accent && !ACCENTS.some(a => a.hex === d.accent);
  return (
    <div className="space-y-4">
      {!canEdit && <p className="rounded-xl bg-amber/10 p-3 text-sm text-amber">Design tools need the desk to be editable.</p>}
      <Group title="Fit">
        <button className="btn-primary w-full" disabled={!canEdit || fitting} onClick={onFit}>{fitting ? <><Spinner />Fitting with test prints</> : <><Wand2 className="h-4 w-4" />Fit to one page</>}</button>
        <p className="text-xs text-ink-3">Picks the largest text size that still leaves 42 pt free at the bottom.</p>
      </Group>
      <Group title="Text">
        <label className="flex items-center justify-between gap-2 text-sm"><span className="text-ink-2">Font</span>
          <select className="input w-44 py-1.5 text-sm" disabled={!canEdit} value={d.font} onChange={e => act(doc => editCss(doc, (css: string) => setFont(css, e.target.value)))}>
            {!d.font && <option value="" disabled>{d.family} (current)</option>}{FONTS.map((f: Json) => <option key={f.label} value={f.stack}>{f.label}</option>)}
          </select></label>
        <Stepper label="Size" value={d.text} disabled={!canEdit} onStep={dir => act(doc => STEPS.text(doc, dir))} />
        <Stepper label="Line spacing" value={d.line} disabled={!canEdit} onStep={dir => act(doc => STEPS.line(doc, dir))} />
      </Group>
      <Group title="Spacing">
        <Stepper label="Between sections" value={d.space} disabled={!canEdit} onStep={dir => act(doc => STEPS.space(doc, dir))} />
        <Stepper label="Side margins" value={d.side} disabled={!canEdit} onStep={dir => act(doc => STEPS.side(doc, dir))} />
        <Stepper label="Top and bottom" value={d.vert} disabled={!canEdit} onStep={dir => act(doc => STEPS.vert(doc, dir))} />
      </Group>
      <Group title="Accent colour">
        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((a: Json) => <button key={a.hex} disabled={!canEdit} title={a.name} aria-label={a.name} aria-pressed={d.accent === a.hex} onClick={() => act(doc => setAccent(doc, a.hex))} className={cx('h-8 w-8 rounded-full ring-offset-2 ring-offset-night-850 transition', d.accent === a.hex ? 'ring-2 ring-ink' : 'hover:scale-110')} style={{ background: a.hex }} />)}
          <button disabled={!canEdit} onClick={() => setCustom(c => !c)} aria-expanded={custom} title="Custom colour" className={cx('h-8 w-8 rounded-full ring-offset-2 ring-offset-night-850', isCustom ? 'ring-2 ring-ink' : '')} style={{ background: isCustom ? d.accent : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
        </div>
        {custom && (
          <div className="space-y-2 rounded-xl bg-night-900/60 p-3 text-sm">
            <label className="flex items-center gap-3"><span className="w-12 text-ink-3">Hue</span><input type="range" min={0} max={359} value={hue} className="flex-1 accent-violet" onChange={e => { const h = Number(e.target.value); setHue(h); const x = hslToHex(h, 0.8, depth / 100); setHex(x); act(doc => setAccent(doc, x)); }} /></label>
            <label className="flex items-center gap-3"><span className="w-12 text-ink-3">Depth</span><input type="range" min={15} max={48} value={depth} className="flex-1 accent-violet" onChange={e => { const l = Number(e.target.value); setDepth(l); const x = hslToHex(hue, 0.8, l / 100); setHex(x); act(doc => setAccent(doc, x)); }} /></label>
            <label className="flex items-center gap-3"><span className="w-12 text-ink-3">Hex</span><input className="input py-1 font-mono text-sm" value={hex} maxLength={7} onChange={e => { const v = e.target.value; setHex(v); const x = (v.startsWith('#') ? v : `#${v}`).toLowerCase(); if (/^#[0-9a-f]{6}$/.test(x)) act(doc => setAccent(doc, x)); }} /></label>
          </div>
        )}
      </Group>
      <Group title="Skills layout">
        <div className="grid grid-cols-2 gap-1 rounded-full border border-white/[.08] bg-night-900/70 p-1 text-sm font-semibold">
          {[1, 2].map(n => <button key={n} disabled={!canEdit || d.columns == null} onClick={() => act(doc => setColumns(doc, n))} className={cx('rounded-full py-1.5 transition disabled:opacity-40', d.columns === n ? 'bg-ink text-night-950' : 'text-ink-2')}>{n === 1 ? 'One column' : 'Two columns'}</button>)}
        </div>
      </Group>
      <Group title="Sections">
        <ol className="space-y-1">{d.sections.map((s: string, i: number) => (
          <li key={`${s}${i}`} className="flex items-center gap-1 rounded-lg bg-night-900/50 px-3 py-1.5 text-sm">
            <span className="flex-1 truncate">{s}</span>
            <button className="rounded p-1 hover:bg-white/10 disabled:opacity-30" disabled={!canEdit || i === 0} onClick={() => act(doc => moveSection(doc, i, -1))} aria-label={`Move ${s} up`}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button className="rounded p-1 hover:bg-white/10 disabled:opacity-30" disabled={!canEdit || i === d.sections.length - 1} onClick={() => act(doc => moveSection(doc, i, 1))} aria-label={`Move ${s} down`}><ArrowDown className="h-3.5 w-3.5" /></button>
            <button className="rounded p-1 text-rose hover:bg-rose/10 disabled:opacity-30" disabled={!canEdit} onClick={() => act(doc => removeSection(doc, i))} aria-label={`Remove ${s}`}><Trash2 className="h-3.5 w-3.5" /></button>
          </li>
        ))}</ol>
      </Group>
    </div>
  );
}

const LV = { ok: [Check, 'text-teal'], warn: [AlertTriangle, 'text-amber'], fail: [X, 'text-rose'] } as const;
export function AtsPanel({ doc, version, act, canEdit, resume, dirty }: { doc: DocFn; version: number; act: Act; canEdit: boolean; resume: Json | null; dirty: boolean }) {
  const [extracted, setExtracted] = useState<Json | null>(null);
  const [jd, setJd] = useState<string>(local.get('jd', ''));
  useEffect(() => {
    setExtracted(null);
    if (!resume?.pdfExists) return;
    fetch(`/api/ats?file=${encodeURIComponent(resume.file)}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(setExtracted).catch(() => {});
  }, [resume?.file, resume?.pdfUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = doc();
  if (!d?.body) return <p className="text-sm text-ink-3">Open a resume to check it.</p>;
  const items = atsChecks(d, extracted, resume) as Json[];
  const pageText = (d.querySelector('.page') ?? d.body).textContent ?? '';
  const words = jd.trim() ? (jdKeywords(jd) as Json[]) : [];
  const found = words.filter(w => containsTerm(pageText, w.display));
  const missing = words.filter(w => !containsTerm(pageText, w.display));
  void version;
  return (
    <div className="space-y-4">
      <Group title="Checks">
        <ul className="space-y-2">{items.map((it, i) => { const [Icon, tone] = LV[it.level as keyof typeof LV]; return (
          <li key={i} className="flex gap-2.5 text-sm"><Icon className={cx('mt-0.5 h-4 w-4 flex-none', tone)} /><div className="min-w-0"><p className="font-medium">{it.title}</p>{it.detail && <p className="text-xs text-ink-3">{it.detail}</p>}{it.fix && canEdit && <button className="btn-ghost mt-1.5 px-3 py-1 text-xs" onClick={() => act(it.fix.run)}>{it.fix.label}</button>}</div></li>
        ); })}</ul>
      </Group>
      <Group title="Match a job">
        <textarea className="input min-h-[110px] text-sm" value={jd} onChange={e => { setJd(e.target.value); local.set('jd', e.target.value); }} placeholder="Paste a job description to see which of its keywords this resume covers." />
        {words.length > 0 && <>
          <p className="text-sm"><b className="tnum">{found.length}</b> of <b className="tnum">{words.length}</b> keywords are on this resume.</p>
          {missing.length > 0 && <div><p className="mb-1 text-xs font-semibold text-amber">Missing</p><div className="flex flex-wrap gap-1">{missing.map(w => <Chip key={w.display} tone="amber">{w.display}</Chip>)}</div><p className="mt-1 text-xs text-ink-3">Add the ones you have really used, in a bullet that shows where.</p></div>}
          {found.length > 0 && <div><p className="mb-1 text-xs font-semibold text-teal">Already there</p><div className="flex flex-wrap gap-1">{found.map(w => <Chip key={w.display} tone="teal">{w.display}</Chip>)}</div></div>}
        </>}
      </Group>
      <Group title="What an ATS reads">
        <p className="text-xs text-ink-3">{extracted ? (dirty ? 'From the last saved PDF. Save to see your changes here.' : 'Pulled from the PDF the way most ATS read it, top to bottom.') : 'No PDF text yet, so this is the text on the page.'}</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-night-900/70 p-3 text-xs leading-relaxed text-ink-2">{extracted ? extracted.text : (d.querySelector('.page') as HTMLElement | null)?.innerText ?? d.body.innerText}</pre>
      </Group>
    </div>
  );
}

export function HistoryPanel({ resume, dirty, previewHash, onPreview, mode, refreshKey }: { resume: Json | null; dirty: boolean; previewHash?: string; onPreview: (c: Json) => void; mode: string; refreshKey: string }) {
  const [data, setData] = useState<Json | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!resume) return;
    setErr('');
    fetch(`/api/history?file=${encodeURIComponent(resume.file)}`, { cache: 'no-store' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j); }).catch(e => setErr(e.message));
  }, [resume?.file, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!resume) return null;
  if (err) return <p className="text-sm text-amber">Could not read the history. {err}</p>;
  if (!data) return <div className="flex items-center gap-2 text-sm text-ink-3"><Spinner />Loading history…</div>;
  const items: Json[] = [];
  if (dirty) items.push({ kind: 'working', subject: 'Unsaved edits', meta: 'In the editor now' });
  else if (data.changed) items.push({ kind: 'working', subject: mode === 'local' ? 'Saved, not committed yet' : 'Latest save', meta: mode === 'local' ? 'Commit from the bottom of the resume list' : '' });
  items.push(...arr<Json>(data.commits).map(c => ({ kind: 'commit', ...c })));
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">Click a version to preview it. Restore puts it in the editor; nothing changes until you save.</p>
      <ol className="relative space-y-1 border-l border-white/10 pl-4">
        {items.map((it, i) => (
          <li key={i} className="relative">
            <span className={cx('absolute -left-[23px] top-3 grid h-3.5 w-3.5 place-items-center rounded-full', it.kind === 'commit' ? 'bg-violet' : 'bg-amber')} />
            {it.kind === 'commit'
              ? <button onClick={() => onPreview(it)} className={cx('w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[.05]', previewHash === it.hash && 'bg-violet/15')}><p className="text-sm font-medium">{it.subject}</p><p className="flex items-center gap-1.5 text-xs text-ink-3"><GitCommitHorizontal className="h-3 w-3" />{it.author}, {ago(it.date)} · <code>{it.hash}</code></p></button>
              : <div className="px-2.5 py-2"><p className="flex items-center gap-1.5 text-sm font-medium text-amber"><PenLine className="h-3.5 w-3.5" />{it.subject}</p>{it.meta && <p className="text-xs text-ink-3">{it.meta}</p>}</div>}
          </li>
        ))}
        {!arr(data.commits).length && <li className="text-sm text-ink-3">No earlier versions yet.</li>}
      </ol>
    </div>
  );
}

// Brings company prep in: pick a company you're targeting and paste its tailored summary and bullets into the page.
export function TailorPanel({ resume }: { resume: Json | null }) {
  const { targets, toast } = useApp();
  const [id, setId] = useState<string>(() => targets.find(t => t.id)?.id ?? '');
  const [t, setT] = useState<Json | null>(null);
  useEffect(() => { if (!id && targets[0]) setId(targets[0].id); }, [targets, id]);
  useEffect(() => { setT(null); if (id) get('target', { id }).then(setT).catch(() => {}); }, [id]);
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast('Copied. Click into the page and paste.')).catch(() => toast('Copy failed.', true));
  if (!targets.length) return <div className="space-y-3 text-sm text-ink-2"><p>Add the companies you’re applying to in Companies. Their tailored summary and bullets show up here, ready to paste into this resume.</p><Link to="/new" className="btn-primary">Add a company</Link></div>;
  return (
    <div className="space-y-4">
      <label className="flex flex-col gap-1.5 text-sm"><span className="label">Tailor this resume for</span><select className="input py-2" value={id} onChange={e => setId(e.target.value)}>{targets.map(x => <option key={x.id} value={x.id}>{x.company} · {x.role}</option>)}</select></label>
      {!t ? <Spinner /> : !t.fit ? (
        <div className="space-y-2 text-sm text-ink-2"><p>No fit check for {t.company} yet. It writes a tailored summary and bullets from your real experience.</p><Link to={`/c/${t.id}/apply`} className="btn-primary">Check fit for {t.company}</Link></div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-3"><span className="font-display text-3xl font-bold">{t.fit.score}</span><span className="text-ink-2">{t.fit.verdict}</span></div>
          <div><div className="mb-1 flex items-center justify-between"><span className="label">Summary</span><button className="btn-quiet px-2 py-1 text-xs" onClick={() => copy(t.fit.summary)}><Copy className="h-3.5 w-3.5" />Copy</button></div><p className="rounded-xl bg-night-900/60 p-3">{t.fit.summary}</p></div>
          <div><span className="label">Bullets</span><ul className="mt-1 space-y-1.5">{arr<string>(t.fit.bullets).map((b, i) => <li key={i} className="group flex gap-2 rounded-xl bg-night-900/60 p-2.5"><span className="flex-1">{b}</span><button className="opacity-50 group-hover:opacity-100" aria-label="Copy bullet" onClick={() => copy(b)}><Copy className="h-3.5 w-3.5" /></button></li>)}</ul></div>
          {arr(t.fit.keywords).length > 0 && <div><span className="label">Keywords to work in, if true</span><div className="mt-1 flex flex-wrap gap-1">{arr<string>(t.fit.keywords).map(k => <Chip key={k} tone="violet">{k}</Chip>)}</div></div>}
          <Link to={`/c/${t.id}/apply`} className="text-violet hover:underline">Open {t.company}</Link>
          {resume && t.resumeFile === resume.file && <p className="text-xs text-teal">This resume is the tailored copy for {t.company}.</p>}
        </div>
      )}
    </div>
  );
}
