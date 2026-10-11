// The resume desk: explorer, the live A4 page (edit in place, measured against real test prints), and the
// Design / ATS / History / Tailor panels. Logic is the original desk's, via engine.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, X, Download, ExternalLink, MoreHorizontal, PenLine, Code2, Save, Maximize2, Minimize2, PanelLeft, Copy } from 'lucide-react';
import { desk, htmlOf, pdfUrl } from './api';
import { Explorer, NO_COMPANY } from './Explorer';
import { DesignPanel, AtsPanel, HistoryPanel, TailorPanel } from './Panels';
import { makeEditable, makeReadOnly, serialize, contentBottom, handlePageKey, guardIcons, fitContactLine, normaliseHref, addressText, fitToOnePage, fmt, PX_PER_PT } from './engine.js';
import { lint, LIMITS, A4_HEIGHT_PT } from '../../../lib/rules.js';
import { useApp } from '../lib/state';
import { useOverlay, Modal, type MenuEntry } from '../components/Overlay';
import { Spinner, Seg } from '../components/ui';
import type { Json } from '../lib/api';
import { ago, cx, local } from '../lib/util';

const PAGE_H = A4_HEIGHT_PT * PX_PER_PT;
const PAGE_W = (210 / 25.4) * 96;
const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => { let t: number | undefined; const w = (...a: A) => { clearTimeout(t); t = window.setTimeout(() => { t = undefined; fn(...a); }, ms); }; w.pending = () => t !== undefined; w.cancel = () => { clearTimeout(t); t = undefined; }; return w; };

type Live = { bottom: number; room: number; pages: number; spare: number; issues: Json[]; over?: number; limit: number };

export default function Resumes() {
  const { file: fileParam } = useParams();
  const nav = useNavigate();
  const { toast } = useApp();
  const { confirm, prompt, openMenu } = useOverlay();

  const [mode, setMode] = useState('static');
  const [resumes, setResumes] = useState<Json[]>([]);
  const [changes, setChanges] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [source, setSource] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [verified, setVerified] = useState<Json | null>(null);
  const [preview, setPreview] = useState<Json | null>(null);
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  const [scale, setScale] = useState(1);
  const [pageHeight, setPageHeight] = useState(PAGE_H);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<'design' | 'ats' | 'history' | 'tailor'>(local.get('deskTab', 'design'));
  const [openIssues, setOpenIssues] = useState<string | null>(null);
  const [fitting, setFitting] = useState(false);
  const [rail, setRail] = useState(false);
  const [link, setLink] = useState<{ el: HTMLAnchorElement; text: string; href: string; error: boolean; x: number; y: number } | null>(null);
  const [create, setCreate] = useState<{ duplicate: boolean; from: string; role: string; company: string; group: string | null } | null>(null);

  const frame = useRef<HTMLIFrameElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const saved = useRef('');
  const calibration = useRef<number | null>(null);
  const S = useRef({ editing, dirty, file, preview, verified, mode, resumes, showSource });
  S.current = { editing, dirty, file, preview, verified, mode, resumes, showSource };
  const doc = useCallback(() => frame.current?.contentDocument ?? null, []);
  const current = useMemo(() => resumes.find(r => r.file === file) ?? null, [resumes, file]);
  const canEdit = mode !== 'static';

  const applyState = (data: Json) => {
    setMode(data.mode === 'local' || data.mode === 'cloud' ? data.mode : 'static');
    setResumes(data.resumes ?? []); setChanges(data.changes ?? []); setFolders(data.folders ?? []);
  };

  // ---------- Measuring ----------
  const measure = useCallback(() => {
    const d = doc();
    if (!d?.body || !frame.current) return;
    frame.current.style.height = `${PAGE_H}px`;
    const rawBottom = contentBottom(d);
    const root = (d.querySelector('.page') ?? d.body) as HTMLElement;
    const r = S.current.resumes.find(x => x.file === S.current.file);
    const rawSpare = (PAGE_H - rawBottom) / PX_PER_PT;
    if (!S.current.dirty && !S.current.preview && r?.metrics?.spare != null && !r.stale) calibration.current = r.metrics.spare - rawSpare;
    const spare = rawSpare + (calibration.current ?? 0);
    const bottom = PAGE_H - spare * PX_PER_PT;
    const pad = parseFloat(d.defaultView!.getComputedStyle(root).paddingBottom) || 0;
    const limit = PAGE_H - pad;
    const room = (limit - bottom) / PX_PER_PT;
    let h = Math.max(PAGE_H, Math.ceil(Math.max(rawBottom, bottom) + 28));
    const next: Live = { bottom, room, limit, pages: room < 0 ? 1 + Math.ceil(-room / A4_HEIGHT_PT) : 1, spare, issues: S.current.editing ? lint(serialize(d), root.textContent ?? '') : [] };
    const printedOver = S.current.dirty && S.current.verified?.pages > 1 ? -S.current.verified.spare : null;
    if (!(printedOver == null && room >= 0)) { next.over = printedOver ?? -room; h = Math.max(h, Math.ceil(limit + next.over * PX_PER_PT + 24)); }
    frame.current.style.height = `${h}px`;
    setPageHeight(h); setLive(next); setVersion(v => v + 1);
  }, [doc]);
  const remeasure = useMemo(() => debounce(measure, 150), [measure]);

  // Test-prints the draft with the same Chrome that builds the PDF, then re-aims the on-screen estimate.
  const checkHtml = useCallback(async (html: string) => (await desk('check', { html })).metrics as Json, []);
  const seq = useRef(0);
  const verifyDraft = useMemo(() => debounce(async () => {
    if (!S.current.editing || !S.current.dirty || S.current.mode === 'static') return;
    const mine = ++seq.current;
    const d = doc(); if (!d) return;
    const raw = (PAGE_H - contentBottom(d)) / PX_PER_PT;
    try {
      const m = await checkHtml(serialize(d));
      if (mine !== seq.current || !m || !S.current.dirty) return;
      setVerified(m); S.current.verified = m;
      if (m.pages === 1) calibration.current = m.spare - raw;
      measure();
    } catch { /* estimate stays */ }
  }, 1000), [doc, checkHtml, measure]);

  const syncSource = useMemo(() => debounce(() => { const d = doc(); if (S.current.showSource && d) setSource(serialize(d)); }, 300), [doc]);
  const changed = useCallback(() => {
    setVerified(null); S.current.verified = null; seq.current++;
    if (!S.current.dirty) { setDirty(true); S.current.dirty = true; }
    verifyDraft(); remeasure(); syncSource();
  }, [verifyDraft, remeasure, syncSource]);

  // ---------- Loading the page ----------
  const loadPage = useCallback((html: string) => { setLink(null); if (frame.current) frame.current.srcdoc = html; }, []);
  const onLoad = useCallback(() => {
    const d = doc(); if (!d) return;
    d.addEventListener('click', e => {
      const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      if (S.current.editing) { const r = a.getBoundingClientRect(); setLink({ el: a, text: a.textContent?.trim() ?? '', href: a.getAttribute('href') ?? '', error: false, x: r.left, y: r.bottom }); }
      else window.open(a.href, '_blank', 'noopener');
    });
    d.addEventListener('beforeinput', e => { if (S.current.editing) guardIcons(d, e); });
    d.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); return; }
      if (S.current.editing && handlePageKey(d, e)) changed();
    });
    d.addEventListener('input', () => { if (S.current.editing) changed(); });
    d.addEventListener('paste', e => { if (!S.current.editing) return; e.preventDefault(); d.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ')); });
    if (S.current.editing) makeEditable(d);
    measure();
  }, [doc, changed, measure]);

  const refresh = useCallback(async () => { applyState(await desk('state')); }, []);
  useEffect(() => { refresh().catch(err => toast(err.message, true)); }, [refresh, toast]);

  const select = useCallback(async (f: string, force = false) => {
    setRail(false);
    if (f === S.current.file && !force) return;
    if (S.current.dirty && !(await confirm({ title: 'Discard your unsaved changes?', body: 'Your edits to this resume have not been saved.', confirm: 'Discard', danger: true }))) return;
    setFile(f); S.current.file = f; setEditing(false); S.current.editing = false; setDirty(false); S.current.dirty = false;
    setLive(null); setVerified(null); setPreview(null); S.current.preview = null; calibration.current = null; setOpenIssues(null); setShowSource(false);
    nav(`/resumes/${encodeURIComponent(f.replace(/\.html$/, ''))}`, { replace: true });
    try { const html = await htmlOf(f); if (S.current.file !== f) return; saved.current = html; loadPage(html); }
    catch (err) { toast((err as Error).message, true); }
  }, [confirm, loadPage, nav, toast]);

  // Pick the resume from the URL, or the first one.
  useEffect(() => {
    if (!resumes.length) return;
    const wanted = fileParam ? `${decodeURIComponent(fileParam)}.html` : null;
    const target = resumes.find(r => r.file === wanted) ?? (file ? null : resumes[0]);
    if (target && target.file !== file) select(target.file);
  }, [resumes, fileParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Scale ----------
  useEffect(() => {
    const el = colRef.current; if (!el) return;
    const fit = () => {
      const byW = (el.clientWidth - 8) / PAGE_W;
      const byH = (window.innerHeight - 230) / pageHeight;
      const whole = zoom === 'fit' && window.matchMedia('(min-width: 1024px)').matches;
      setScale(zoom === 'actual' ? 1 : Math.min(1, Math.max(0.3, whole ? Math.min(byW, Math.max(byH, byW * 0.7)) : byW)));
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [zoom, pageHeight]);

  // ---------- Editing ----------
  const startEditing = () => { const d = doc(); if (!d) return; setEditing(true); S.current.editing = true; setDirty(false); makeEditable(d); measure(); };
  const ensureEditing = () => { if (!S.current.editing) startEditing(); };
  const stopEditing = async () => {
    if (S.current.dirty && !(await confirm({ title: `Discard your changes to ${current?.role ?? 'this resume'}?`, confirm: 'Discard', danger: true }))) return;
    const was = S.current.dirty;
    setEditing(false); S.current.editing = false; setDirty(false); S.current.dirty = false; setShowSource(false); setVerified(null);
    if (was) loadPage(saved.current); else { const d = doc(); if (d) { makeReadOnly(d); measure(); } }
  };
  const currentHtml = () => (applySource.pending() ? source : serialize(doc()!));
  const applySource = useMemo(() => debounce((html: string) => loadPage(html), 400), [loadPage]);

  const save = async () => {
    if (!S.current.editing || !S.current.dirty || busy) return;
    const html = currentHtml();
    setBusy(true);
    try {
      const data = await desk('save', { file: S.current.file, html });
      saved.current = html; setDirty(false); S.current.dirty = false; applyState(data);
      const m = (data.resumes ?? []).find((r: Json) => r.file === S.current.file)?.metrics;
      if (!m) toast('Saved. The PDF was built but could not be measured.');
      else if (m.pages === 1) toast(`Saved. The PDF fits on one page with ${fmt(m.spare)} pt spare.`);
      else toast(`Saved, but the PDF is ${m.pages} pages. Trim some text to get it back to one.`, true);
      setTimeout(measure, 50);
    } catch (err) { toast(`Not saved. ${(err as Error).message}`, true); }
    finally { setBusy(false); }
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.current.editing) { e.preventDefault(); saveRef.current(); } };
    const before = (e: BeforeUnloadEvent) => { if (S.current.dirty) e.preventDefault(); };
    window.addEventListener('keydown', k); window.addEventListener('beforeunload', before);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('beforeunload', before); };
  }, []);

  const act = (fn: (d: Document) => unknown) => {
    if (!canEdit) return;
    ensureEditing();
    const d = doc(); if (!d?.body) return;
    if (fn(d) !== false) changed();
    setVersion(v => v + 1);
  };
  const onFit = async () => {
    if (!canEdit) return;
    ensureEditing();
    const d = doc(); if (!d) return;
    setFitting(true);
    try {
      const res = await fitToOnePage(d, (html: string) => checkHtml(html), () => serialize(d));
      if (res.ok) { changed(); setVerified(res.metrics); S.current.verified = res.metrics; if (res.metrics.pages === 1) calibration.current = res.metrics.spare - (PAGE_H - contentBottom(d)) / PX_PER_PT; }
      toast(res.message, !res.ok);
    } catch (err) { toast(`Could not make a test print. ${(err as Error).message}`, true); }
    finally { setFitting(false); measure(); }
  };

  // ---------- Links ----------
  const applyLink = (e: React.FormEvent) => {
    e.preventDefault(); if (!link) return;
    const href = normaliseHref(link.href);
    if (!href) { setLink({ ...link, error: true }); return; }
    const text = link.text.trim() || addressText(href);
    link.el.setAttribute('href', href);
    if (text !== link.el.textContent?.trim()) link.el.textContent = text;
    fitContactLine(doc()); setLink(null); changed();
  };

  // ---------- Desk actions ----------
  const run = async (fn: () => Promise<Json>, done?: string | ((d: Json) => string)) => {
    if (busy) return null;
    setBusy(true);
    try { const data = await fn(); applyState(data); if (done) toast(typeof done === 'function' ? done(data) : done); return data; }
    catch (err) { toast((err as Error).message, true); return null; }
    finally { setBusy(false); }
  };
  const blocked = (f: string) => { if (S.current.dirty && f === S.current.file) { toast('Save or discard your edits to this resume first.', true); return true; } return false; };
  const folderNames = () => [...new Set([...folders, ...resumes.map(r => r.group || 'General')])].sort();
  const companyNames = () => [...new Set(resumes.map(r => r.company).filter(Boolean))].sort() as string[];
  const moveResume = async (f: string, details: Json, label: string) => {
    const r = resumes.find(x => x.file === f); if (!r) return;
    if (('group' in details && details.group === r.group) || ('company' in details && details.company === (r.company ?? ''))) return;
    if (blocked(f)) return;
    await run(() => desk('details', { file: f, ...details }), `Moved ${r.role} to ${label}.`);
  };
  const rebuild = (files: string[]) => run(() => desk('build', { files }), d => { const over = (d.resumes ?? []).filter((r: Json) => files.includes(r.file) && r.metrics?.pages > 1); return over.length ? `Rebuilt. ${over.map((r: Json) => r.pdf).join(', ')} runs past one page.` : `Rebuilt ${files.length} PDF${files.length === 1 ? '' : 's'}. All fit on one page.`; });
  const renameFile = async (r: Json) => {
    if (blocked(r.file)) return;
    const name = await prompt({ title: 'Rename file', label: 'File name', value: r.file.replace(/\.html$/, ''), hint: `The PDF is renamed to match. Links you already sent to ${r.pdf} will stop working.`, confirm: 'Rename' });
    if (!name) return;
    const data = await run(() => desk('rename', { file: r.file, name }), d => `Renamed to ${d.renamed}.`);
    if (data?.renamed && S.current.file === r.file) { setFile(data.renamed); S.current.file = data.renamed; nav(`/resumes/${encodeURIComponent(data.renamed.replace(/\.html$/, ''))}`, { replace: true }); }
  };
  const moveToFolder = async (r: Json) => { const to = await prompt({ title: 'Move to folder', label: 'Folder', value: r.group, options: folderNames(), hint: 'Pick a folder or type a new name.', confirm: 'Move' }); if (to) moveResume(r.file, { group: to }, to); };
  const setCompanyFor = async (r: Json) => { const to = await prompt({ title: 'Target company', label: 'Company this resume is for', value: r.company ?? '', options: companyNames(), hint: 'Not printed on the resume. Leave empty for a general resume.' }); if (to !== null) moveResume(r.file, { company: to }, to || NO_COMPANY); };
  const archive = async (r: Json) => {
    if (blocked(r.file)) return;
    if (!(await confirm({ title: `Archive “${r.role}”?`, body: `Its HTML and PDF move to ${mode === 'cloud' ? 'the archive in your account' : '"Archieve Resumes/"'}. Nothing is deleted.`, confirm: 'Move to archive', danger: true }))) return;
    const was = r.file === S.current.file;
    const data = await run(() => desk('archive', { file: r.file }), 'Moved to the archive.');
    if (data && was) { setFile(null); S.current.file = null; if (data.resumes?.[0]) select(data.resumes[0].file, true); }
  };
  const openCreate = (duplicate: boolean, opts: { from?: string; company?: string; group?: string | null } = {}) => {
    const r = resumes.find(x => x.file === opts.from) ?? current;
    setCreate({ duplicate, from: r?.file ?? resumes[0]?.file ?? '', role: duplicate && r ? r.role : '', company: opts.company ?? '', group: opts.group ?? null });
  };
  const submitCreate = async () => {
    if (!create) return;
    if (S.current.dirty && !(await confirm({ title: 'Discard your unsaved changes?', confirm: 'Discard', danger: true }))) return;
    setDirty(false); S.current.dirty = false; setEditing(false); S.current.editing = false;
    const data = await run(() => desk('create', { from: create.from, role: create.role, company: create.company, group: create.group }));
    if (data?.created) { setCreate(null); await select(data.created, true); toast('Created. Click Edit to tailor it.'); }
  };
  const newFolder = async () => { const name = await prompt({ title: 'New folder', label: 'Folder name', hint: 'Drag resumes into it.', confirm: 'Create folder' }); if (name) { if (folderNames().includes(name)) return toast(`${name} already exists.`, true); run(() => desk('folder', { action: 'create', name }), `Created folder ${name}.`); } };
  const copyPdfLink = (r: Json) => navigator.clipboard.writeText(new URL(pdfUrl(r.pdf), location.href).href).then(() => toast('PDF link copied.')).catch(() => toast('Your browser blocked the clipboard.', true));

  const fileMenu = (r: Json): MenuEntry[] => [
    { label: 'Open', run: () => select(r.file) },
    canEdit && { label: 'Edit', run: async () => { await select(r.file); setTimeout(startEditing, 300); } },
    r.pdfExists && { label: 'Open PDF', run: () => window.open(pdfUrl(r.pdf), '_blank', 'noopener') },
    canEdit && '-',
    canEdit && { label: 'Duplicate…', run: () => openCreate(true, { from: r.file, company: r.company, group: r.group }) },
    canEdit && { label: 'Rename file…', key: 'F2', run: () => renameFile(r) },
    canEdit && { label: 'Move to folder…', run: () => moveToFolder(r) },
    canEdit && { label: 'Set target company…', run: () => setCompanyFor(r) },
    '-',
    { label: 'Copy file name', run: () => navigator.clipboard.writeText(r.file).then(() => toast('File name copied.')) },
    mode === 'cloud' && r.pdfExists && { label: 'Copy PDF link', run: () => copyPdfLink(r) },
    canEdit && '-',
    canEdit && { label: 'Move to archive', danger: true, run: () => archive(r) },
  ];
  const folderMenu = (name: string, count: number, byCompany: boolean): MenuEntry[] => !canEdit ? [] : byCompany ? [
    { label: name === NO_COMPANY ? 'New resume…' : `New resume for ${name}…`, run: () => openCreate(false, { company: name === NO_COMPANY ? '' : name }) },
    name !== NO_COMPANY && { label: 'Rename company…', run: async () => { const to = await prompt({ title: 'Rename company', label: 'Company name', value: name, hint: 'Updates every resume marked for this company. Leave empty to clear it.', confirm: 'Rename' }); if (to !== null && to !== name) run(() => desk('company-rename', { name, to }), `Renamed ${name}.`); } },
  ] : [
    { label: 'New resume here…', run: () => openCreate(false, { group: name }) },
    { label: 'New folder…', run: newFolder },
    '-',
    { label: 'Rename folder…', run: async () => { const to = await prompt({ title: 'Rename folder', label: 'Folder name', value: name, confirm: 'Rename' }); if (to && to !== name) run(() => desk('folder', { action: 'rename', name, to }), `Renamed ${name} to ${to}.`); } },
    { label: count ? 'Delete folder (move its resumes first)' : 'Delete folder', disabled: count > 0, danger: true, run: () => run(() => desk('folder', { action: 'delete', name }), `Deleted folder ${name}.`) },
  ];
  const blankMenu = (): MenuEntry[] => canEdit ? [{ label: 'New resume…', run: () => openCreate(false) }, { label: 'New folder…', run: newFolder }] : [];

  // ---------- History ----------
  const previewVersion = async (c: Json) => {
    if (S.current.dirty && !(await confirm({ title: 'Discard your unsaved changes to preview an older version?', confirm: 'Discard', danger: true }))) return;
    try {
      const data = await desk(`version?file=${encodeURIComponent(S.current.file!)}&commit=${c.hash}`);
      setEditing(false); S.current.editing = false; setDirty(false); S.current.dirty = false; setShowSource(false);
      const p = { ...c, html: data.html }; setPreview(p); S.current.preview = p; loadPage(data.html);
    } catch (err) { toast(`Could not open that version. ${(err as Error).message}`, true); }
  };
  const leavePreview = () => { setPreview(null); S.current.preview = null; loadPage(saved.current); };
  const restorePreview = () => {
    const html = preview!.html; setPreview(null); S.current.preview = null;
    setEditing(true); S.current.editing = true; setDirty(true); S.current.dirty = true; loadPage(html); verifyDraft();
    toast('That version is in the editor. Save to make it current, or Discard to go back.');
  };

  // ---------- Checks ----------
  const checks = useMemo(() => {
    const r = current; if (!r) return { items: [] as Json[], source: '' };
    const isLive = editing && dirty && live; const checked = isLive && verified;
    const m = checked ? verified : r.metrics;
    const pages = isLive && !checked ? live!.pages : m?.pages; const spare = isLive && !checked ? live!.spare : m?.spare;
    const issues: Json[] = isLive ? live!.issues : r.issues ?? [];
    const items: Json[] = [];
    if (pages == null) items.push({ level: 'unknown', text: r.pdfExists ? 'PDF not measured' : 'No PDF yet' });
    else if (pages > 1) { const over = isLive && !checked ? -live!.room : -spare; items.push({ level: 'fail', text: over > 0 ? `Runs ${fmt(over)} pt onto page 2` : `${pages} pages, must be 1` }); }
    else { items.push({ level: 'ok', text: 'Fits on one page' }); if (spare < LIMITS.spareMin) items.push({ level: 'warn', text: `Only ${fmt(spare)} pt spare` }); }
    if (m?.delta != null && m.delta >= LIMITS.marginDelta) items.push({ level: 'warn', text: `Side margins differ by ${fmt(m.delta)} pt` });
    const house = issues.filter(i => i.kind !== 'contact'), contact = issues.filter(i => i.kind === 'contact');
    if (house.length) items.push({ level: 'warn', text: `${house.length} house rule issue${house.length === 1 ? '' : 's'}`, issues: house, key: 'house' });
    if (contact.length) items.push({ level: 'warn', text: `${contact.length} contact detail${contact.length === 1 ? '' : 's'} off`, issues: contact, key: 'contact' });
    const src = checked ? 'Checked with a test print of your changes.' : isLive ? 'Estimate while you edit. Checking with a test print…' : m ? `Measured from the PDF built ${ago(r.pdfUpdatedAt)}.` : '';
    return { items: items.filter(i => i.level !== 'ok'), source: src, spare };
  }, [current, editing, dirty, live, verified]);

  const fits = live && !(dirty && verified?.pages > 1) && live.room >= 0;
  const r = current;

  return (
    <div className="-mx-4 -mt-6 grid min-h-[calc(100dvh-2rem)] gap-0 sm:-mx-8 lg:-mt-10 lg:grid-cols-[270px_minmax(0,1fr)_340px]">
      {/* Explorer */}
      <aside className={cx('border-white/[.06] bg-night-950/50 p-4 backdrop-blur-xl lg:sticky lg:top-0 lg:block lg:h-dvh lg:border-r', rail ? 'fixed inset-0 z-40 block' : 'hidden')}>
        <Explorer resumes={resumes} folders={folders} changes={changes} mode={mode} file={file} busy={busy} onSelect={f => select(f)} fileMenu={fileMenu} folderMenu={folderMenu} blankMenu={blankMenu}
          onMove={moveResume} onNew={() => openCreate(false)} onRebuildStale={() => rebuild(resumes.filter(x => x.stale).map(x => x.file))} onCommit={msg => run(() => desk('commit', { message: msg }), `Committed ${changes.length} file${changes.length === 1 ? '' : 's'}.`)} />
        {rail && <button className="btn-ghost mt-3 w-full lg:hidden" onClick={() => setRail(false)}>Close</button>}
      </aside>

      {/* Viewer */}
      <section className="min-w-0 px-4 pb-10 pt-6 sm:px-6 lg:pt-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <button className="btn-ghost px-2.5 lg:hidden" onClick={() => setRail(true)} aria-label="All resumes"><PanelLeft className="h-4 w-4" /></button>
            <div className="min-w-0"><h1 className="truncate text-2xl font-bold sm:text-3xl">{r?.role ?? 'Resumes'}</h1><p className="truncate text-sm text-ink-3">{r ? [r.focus || r.pdf, r.company && `for ${r.company}`].filter(Boolean).join(', ') : ''}</p></div>
          </div>
          {r && (!editing ? (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && !preview && <button className="btn-primary" onClick={startEditing}><PenLine className="h-4 w-4" />Edit</button>}
              {r.pdfExists && <a className="btn-ghost" href={pdfUrl(r.pdf)} target="_blank" rel="noopener"><ExternalLink className="h-4 w-4" />Open PDF</a>}
              {r.pdfExists && <a className="btn-amber" href={pdfUrl(r.pdf)} download={r.pdf}><Download className="h-4 w-4" />Download</a>}
              <button className="btn-ghost px-2.5" aria-label="More" onClick={e => { const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left - 160, b.bottom + 6, fileMenu(r).slice(2)); }}><MoreHorizontal className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('text-sm', dirty ? 'text-amber' : 'text-ink-3')}>{dirty ? 'Unsaved changes' : 'No changes yet'}</span>
              <button className={cx('btn-ghost', showSource && 'bg-white/10')} onClick={() => { const on = !showSource; setShowSource(on); S.current.showSource = on; if (on) setSource(currentHtml()); }}><Code2 className="h-4 w-4" />{showSource ? 'Hide source' : 'Source'}</button>
              <button className="btn-ghost" onClick={stopEditing}>{dirty ? 'Discard' : 'Done'}</button>
              <button className="btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? <><Spinner />Saving</> : <><Save className="h-4 w-4" />Save and build PDF</>}</button>
            </div>
          ))}
        </header>

        {checks.items.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {checks.items.map((it, i) => { const Icon = it.level === 'fail' ? X : it.level === 'warn' ? AlertTriangle : Check; return (
              <button key={i} disabled={!it.issues} onClick={() => setOpenIssues(o => (o === it.key ? null : it.key))} className={cx('chip py-1', it.level === 'fail' ? 'bg-rose-soft text-rose' : it.level === 'warn' ? 'bg-amber-soft text-amber' : 'bg-white/[.06] text-ink-2', it.issues && 'cursor-pointer hover:brightness-125')}><Icon className="h-3.5 w-3.5" />{it.text}</button>
            ); })}
            <span className="text-xs text-ink-3">{checks.source}</span>
          </div>
        )}
        {openIssues && (() => { const it = checks.items.find(x => x.key === openIssues); return it && <ul className="mt-2 space-y-1 rounded-xl bg-amber/[.06] p-3 text-sm">{it.issues.map((x: Json, i: number) => <li key={i}>{x.message}{x.excerpt && <span className="ml-1 text-ink-3">“{x.excerpt}”</span>}</li>)}</ul>; })()}
        {preview && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet/30 bg-violet/10 p-3 text-sm"><span>Previewing the version from {ago(preview.date)}: “{preview.subject}”.</span><span className="flex gap-2"><button className="btn-ghost py-1.5" onClick={leavePreview}>Back to current</button><button className="btn-primary py-1.5" onClick={restorePreview}>Restore this version</button></span></div>}
        {!preview && !editing && r?.stale && canEdit && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber/10 p-3 text-sm text-amber"><span>{r.pdfExists ? 'This PDF is older than its HTML, so it may not match the page.' : 'This resume has no PDF yet.'}</span><button className="btn-ghost py-1.5" disabled={busy} onClick={() => rebuild([r.file])}>{r.pdfExists ? 'Rebuild PDF' : 'Build PDF'}</button></div>}
        {editing && <p className="mt-3 text-xs text-ink-3">Click any text to change it. Click a link to change where it points. Enter adds a bullet, Backspace on an empty bullet removes it. Ctrl+S saves.</p>}

        <div className={cx('mt-5 grid gap-4', showSource && 'xl:grid-cols-2')}>
          {showSource && <textarea className="input min-h-[70vh] font-mono text-xs" spellCheck={false} value={source} onChange={e => { setSource(e.target.value); if (!S.current.dirty) { setDirty(true); S.current.dirty = true; } applySource(e.target.value); }} aria-label="HTML source" />}
          <div ref={colRef} className="min-w-0">
            <div className="relative mx-auto" style={{ width: PAGE_W * scale, height: pageHeight * scale }}>
              <div className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-sm bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,.7),0_0_0_1px_rgba(255,255,255,.06)]" style={{ width: PAGE_W, height: pageHeight, transform: `scale(${scale})` }}>
                <iframe ref={frame} title="Resume page" onLoad={onLoad} className="block w-full border-0" style={{ width: PAGE_W, height: PAGE_H }} />
                {live && fits && <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-teal/70 bg-teal/[.07]" style={{ top: live.bottom, height: Math.max(0, PAGE_H - live.bottom) }}><span className="absolute right-2 top-1 rounded bg-teal px-1.5 py-0.5 text-[11px] font-bold text-night-950">{fmt(live.spare)} pt spare, {fmt(Math.max(0, live.room))} pt before page 2</span></div>}
                {live && !fits && <div className="pointer-events-none absolute inset-x-0 border-t-2 border-rose bg-rose/15" style={{ top: live.limit, height: Math.max(12, (live.over ?? -live.room) * PX_PER_PT) }}><span className="absolute right-2 top-1 rounded bg-rose px-1.5 py-0.5 text-[11px] font-bold text-night-950">Page 1 ends here. {fmt(live.over ?? -live.room)} pt spills over</span></div>}
              </div>
              {link && (
                <form onSubmit={applyLink} onKeyDown={e => { if (e.key === 'Escape') setLink(null); }} className="glass-hi absolute z-10 w-80 space-y-2 p-4 text-sm shadow-glow" style={{ left: Math.min(Math.max(0, link.x * scale), Math.max(0, PAGE_W * scale - 320)), top: link.y * scale + 8 }}>
                  <label className="flex flex-col gap-1"><span className="label">Shown as</span><input className="input py-1.5" value={link.text} onChange={e => setLink({ ...link, text: e.target.value })} /></label>
                  <label className="flex flex-col gap-1"><span className="label">Link address</span><input autoFocus className="input py-1.5" value={link.href} onChange={e => setLink({ ...link, href: e.target.value, error: false })} /></label>
                  {link.error && <p className="text-xs text-rose">Use a web address, an email address or a phone number.</p>}
                  <div className="flex flex-wrap gap-1 text-xs"><button type="button" className="btn-quiet px-2 py-1" onClick={() => { const h = normaliseHref(link.href); if (h) setLink({ ...link, text: addressText(h) }); else setLink({ ...link, error: true }); }}>Show the address</button><button type="button" className="btn-quiet px-2 py-1" onClick={() => { const h = normaliseHref(link.href); if (h) window.open(h, '_blank', 'noopener'); }}>Open</button><button type="button" className="btn-quiet px-2 py-1 text-rose" onClick={() => { link.el.replaceWith(doc()!.createTextNode(link.el.textContent ?? '')); setLink(null); changed(); }}>Remove link</button></div>
                  <div className="flex justify-end gap-2"><button type="button" className="btn-ghost py-1.5" onClick={() => setLink(null)}>Cancel</button><button className="btn-primary py-1.5">Apply</button></div>
                </form>
              )}
            </div>
            {r && <div className="mt-3 flex justify-center"><button className="btn-quiet text-xs" onClick={() => setZoom(z => (z === 'fit' ? 'actual' : 'fit'))}>{zoom === 'fit' ? <><Maximize2 className="h-3.5 w-3.5" />Actual size</> : <><Minimize2 className="h-3.5 w-3.5" />Fit page</>}</button>{mode === 'cloud' && r.pdfExists && <button className="btn-quiet text-xs" onClick={() => copyPdfLink(r)}><Copy className="h-3.5 w-3.5" />Copy PDF link</button>}</div>}
          </div>
        </div>
      </section>

      {/* Panels */}
      <aside className="border-white/[.06] bg-night-950/40 px-4 pb-10 pt-6 backdrop-blur-xl lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-l lg:pt-8">
        <Seg value={tab} onChange={v => { setTab(v); local.set('deskTab', v); }} options={[['design', 'Design'], ['ats', 'ATS'], ['history', 'History'], ['tailor', 'Tailor']]} />
        <div className="mt-5">
          {tab === 'design' && <DesignPanel doc={doc} version={version} act={act} canEdit={canEdit && !preview} onFit={onFit} fitting={fitting} />}
          {tab === 'ats' && <AtsPanel doc={doc} version={version} act={act} canEdit={canEdit && !preview} resume={r} dirty={dirty} />}
          {tab === 'history' && <HistoryPanel resume={r} dirty={dirty} previewHash={preview?.hash} onPreview={previewVersion} mode={mode} refreshKey={`${r?.updatedAt}@${changes.join(',')}`} />}
          {tab === 'tailor' && <TailorPanel resume={r} />}
        </div>
      </aside>

      <Modal open={!!create} onClose={() => setCreate(null)}>
        {create && <form onSubmit={e => { e.preventDefault(); submitCreate(); }} className="space-y-4">
          <h2 className="text-xl font-bold">{create.duplicate ? 'Duplicate resume' : 'New resume'}</h2>
          <label className="flex flex-col gap-1.5"><span className="label">Start from</span><select className="input" value={create.from} onChange={e => setCreate({ ...create, from: e.target.value })}>{resumes.map(x => <option key={x.file} value={x.file}>{x.role}{x.company ? ` for ${x.company}` : ''} ({x.pdf})</option>)}</select></label>
          <label className="flex flex-col gap-1.5"><span className="label">Role</span><input className="input" required minLength={2} maxLength={80} autoFocus value={create.role} onChange={e => setCreate({ ...create, role: e.target.value })} placeholder="Platform Engineer" /></label>
          <label className="flex flex-col gap-1.5"><span className="label">Target company <span className="font-normal text-ink-3">(optional)</span></span><input className="input" maxLength={60} value={create.company} onChange={e => setCreate({ ...create, company: e.target.value })} placeholder="Zoho" /></label>
          <p className="text-xs text-ink-3">Copies the resume you start from and builds its PDF. Tailor the text afterwards with Edit.</p>
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setCreate(null)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : create.duplicate ? 'Create copy' : 'Create resume'}</button></div>
        </form>}
      </Modal>
    </div>
  );
}
