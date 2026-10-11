import { useState } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, MoreHorizontal, Plus, RefreshCw, GitCommitHorizontal } from 'lucide-react';
import type { Json } from '../lib/api';
import { cx, local } from '../lib/util';
import { useOverlay, type MenuEntry } from '../components/Overlay';
import { LIMITS } from '../../../lib/rules.js';

export const NO_COMPANY = 'No company yet';
export function levelOf(r: Json) {
  const m = r.metrics;
  if (!r.pdfExists || (m && m.pages > 1)) return 'fail';
  if (!m) return 'unknown';
  if (r.stale || r.issues?.length || m.spare < LIMITS.spareMin || m.delta >= LIMITS.marginDelta) return 'warn';
  return 'ok';
}
export const LEVEL_WORDS: Record<string, string> = { ok: 'Ready to send', warn: 'Needs a look', fail: 'Needs fixing', unknown: 'Not measured' };
const DOT: Record<string, string> = { ok: 'bg-teal', warn: 'bg-amber', fail: 'bg-rose', unknown: 'bg-ink-3' };

type Props = {
  resumes: Json[]; folders: string[]; changes: string[]; mode: string; file: string | null; busy: boolean;
  onSelect: (file: string) => void; fileMenu: (r: Json) => MenuEntry[]; folderMenu: (name: string, count: number, byCompany: boolean) => MenuEntry[]; blankMenu: () => MenuEntry[];
  onMove: (file: string, details: Json, label: string) => void; onNew: () => void; onRebuildStale: () => void; onCommit: (msg: string) => void;
};

export function Explorer(p: Props) {
  const { openMenu } = useOverlay();
  const [groupBy, setGroupBy] = useState<'group' | 'company'>(local.get('groupBy', 'group'));
  const [collapsed, setCollapsed] = useState<string[]>(local.get('collapsed', []));
  const [drop, setDrop] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const byCompany = groupBy === 'company';
  const editable = p.mode !== 'static';
  const groups = new Map<string, Json[]>();
  for (const r of p.resumes) { const k = byCompany ? (r.company || NO_COMPANY) : (r.group || 'General'); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  if (!byCompany) for (const f of p.folders) if (!groups.has(f)) groups.set(f, []);
  const names = [...groups.keys()].sort((a, b) => Number(a === NO_COMPANY) - Number(b === NO_COMPANY) || a.localeCompare(b));
  const over = p.resumes.filter(r => r.metrics?.pages > 1).length;
  const stale = editable ? p.resumes.filter(r => r.stale) : [];
  const toggle = (key: string, open: boolean) => { const next = open ? collapsed.filter(k => k !== key) : [...collapsed, key]; setCollapsed(next); local.set('collapsed', next); };
  const more = (e: React.MouseEvent, entries: MenuEntry[]) => { e.stopPropagation(); e.preventDefault(); const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(b.left, b.bottom + 4, entries); };

  return (
    <div className="flex h-full min-h-0 flex-col" onContextMenu={e => { if ((e.target as HTMLElement).closest('[data-row]')) return; e.preventDefault(); openMenu(e.clientX, e.clientY, p.blankMenu()); }}>
      <div className="flex items-center justify-between gap-2 px-1">
        <div><h2 className="text-lg font-bold">Resumes</h2><p className="text-xs text-ink-3">{p.resumes.length} resumes · {over ? `${over} past one page` : 'all fit on one page'}</p></div>
        {editable && <button className="btn-primary px-3 py-1.5" onClick={p.onNew}><Plus className="h-4 w-4" />New</button>}
      </div>
      <div className="mt-3 inline-flex rounded-full border border-white/[.08] bg-night-900/70 p-1 text-xs font-semibold">
        {(['group', 'company'] as const).map(g => <button key={g} className={cx('flex-1 rounded-full px-3 py-1.5 transition', groupBy === g ? 'bg-ink text-night-950' : 'text-ink-2')} onClick={() => { setGroupBy(g); local.set('groupBy', g); }}>By {g === 'group' ? 'folder' : 'company'}</button>)}
      </div>
      {stale.length > 0 && <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-amber/10 px-3 py-2 text-xs text-amber"><span>{stale.length} PDF{stale.length === 1 ? ' is' : 's are'} older than the HTML</span><button className="btn-quiet px-2 py-1 text-xs text-amber" disabled={p.busy} onClick={p.onRebuildStale}><RefreshCw className="h-3.5 w-3.5" />Rebuild</button></div>}
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {names.map(name => {
          const key = `${groupBy}:${name}`;
          const members = groups.get(name)!;
          const open = !collapsed.includes(key) || members.some(r => r.file === p.file);
          return (
            <section key={key} className={cx('rounded-xl transition', drop === key && 'bg-violet/10 ring-1 ring-violet/40')}
              onDragOver={e => { if (!editable) return; e.preventDefault(); setDrop(key); }} onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop(null); }}
              onDrop={e => { e.preventDefault(); setDrop(null); const file = e.dataTransfer.getData('text/plain'); p.onMove(file, byCompany ? { company: name === NO_COMPANY ? '' : name } : { group: name }, name); }}>
              <div data-row className="group flex items-center rounded-lg pr-1 hover:bg-white/[.04]" onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY, p.folderMenu(name, members.length, byCompany)); }}>
                <button className="flex flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm font-semibold text-ink-2" onClick={() => toggle(key, !open)} aria-expanded={open}>
                  <ChevronRight className={cx('h-4 w-4 transition', open && 'rotate-90')} />{open ? <FolderOpen className="h-4 w-4 text-violet" /> : <Folder className="h-4 w-4 text-violet" />}<span className="truncate">{name}</span><span className="ml-auto text-xs text-ink-3">{members.length}</span>
                </button>
                <button className="rounded-md p-1 text-ink-3 opacity-0 transition hover:text-ink group-hover:opacity-100" aria-label={`More for ${name}`} onClick={e => more(e, p.folderMenu(name, members.length, byCompany))}><MoreHorizontal className="h-4 w-4" /></button>
              </div>
              {open && (
                <div className="ml-4 border-l border-white/[.06] pl-2">
                  {members.map(r => { const lv = levelOf(r); return (
                    <div key={r.file} data-row draggable={editable} onDragStart={e => { e.dataTransfer.setData('text/plain', r.file); e.dataTransfer.effectAllowed = 'move'; }}
                      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY, p.fileMenu(r)); }}
                      className={cx('group flex items-center rounded-lg pr-1 transition', r.file === p.file ? 'bg-violet/15 text-ink' : 'text-ink-2 hover:bg-white/[.04]')}>
                      <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left" onClick={() => p.onSelect(r.file)} title={`${r.role}\n${r.pdf}\n${LEVEL_WORDS[lv]}`} aria-current={r.file === p.file}>
                        <FileText className="h-4 w-4 flex-none" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.role}</span><span className="block truncate text-xs text-ink-3">{!byCompany && r.company ? `${r.company} · ` : ''}{r.pdf.replace(/\.pdf$/, '')}</span></span>
                        <span className={cx('h-2 w-2 flex-none rounded-full', DOT[lv])} aria-label={LEVEL_WORDS[lv]} />
                      </button>
                      <button className="rounded-md p-1 text-ink-3 opacity-0 transition hover:text-ink group-hover:opacity-100 focus:opacity-100" aria-label={`More for ${r.role}`} onClick={e => more(e, p.fileMenu(r))}><MoreHorizontal className="h-4 w-4" /></button>
                    </div>
                  ); })}
                  {!members.length && <p className="px-2 py-2 text-xs text-ink-3">Empty. Drag a resume here.</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {p.mode === 'local' && p.changes.length > 0 && (
        <form className="mt-3 rounded-xl border border-white/[.08] bg-night-900/60 p-3" onSubmit={e => { e.preventDefault(); p.onCommit(msg); setMsg(''); }}>
          <p className="text-xs text-ink-3">{p.changes.length} changed file{p.changes.length === 1 ? '' : 's'} not committed</p>
          <div className="mt-2 flex gap-2"><input className="input py-1.5 text-sm" value={msg} onChange={e => setMsg(e.target.value)} placeholder="Update resumes" /><button className="btn-ghost px-3" disabled={p.busy}><GitCommitHorizontal className="h-4 w-4" /></button></div>
        </form>
      )}
    </div>
  );
}
