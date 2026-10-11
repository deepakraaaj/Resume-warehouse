// App-wide dialogs (confirm, prompt) and context menus, opened imperatively: await confirm(...), await prompt(...), openMenu(...).
import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/util';

type ConfirmOpts = { title: string; body?: string; confirm?: string; danger?: boolean };
type PromptOpts = { title: string; label: string; value?: string; hint?: string; confirm?: string; options?: string[] };
export type MenuEntry = { label: string; run: () => void; danger?: boolean; disabled?: boolean; key?: string } | '-' | null | false | undefined;
type Ctx = { confirm: (o: ConfirmOpts) => Promise<boolean>; prompt: (o: PromptOpts) => Promise<string | null>; openMenu: (x: number, y: number, entries: MenuEntry[]) => void };
const C = createContext<Ctx>(null as unknown as Ctx);
export const useOverlay = () => useContext(C);

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  return (
    <AnimatePresence>{open && (
      <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-night-950/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
        <motion.div role="dialog" aria-modal className={cx('glass-hi w-full p-6 shadow-glow', wide ? 'max-w-2xl' : 'max-w-md')} initial={{ y: 14, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, opacity: 0 }} onMouseDown={e => e.stopPropagation()}>{children}</motion.div>
      </motion.div>
    )}</AnimatePresence>
  );
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [conf, setConf] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [prm, setPrm] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [value, setValue] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => setConf({ ...o, resolve })), []);
  const prompt = useCallback((o: PromptOpts) => new Promise<string | null>(resolve => { setValue(o.value ?? ''); setPrm({ ...o, resolve }); }), []);
  const openMenu = useCallback((x: number, y: number, entries: MenuEntry[]) => setMenu({ x, y, entries }), []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', key); window.addEventListener('resize', () => setMenu(null), { once: true });
    const el = menuRef.current;
    if (el) { const r = el.getBoundingClientRect(); el.style.left = `${Math.min(menu.x, innerWidth - r.width - 8)}px`; el.style.top = `${Math.min(menu.y, innerHeight - r.height - 8)}px`; (el.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus(); }
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, [menu]);
  const closeConf = (v: boolean) => { conf?.resolve(v); setConf(null); };
  const closePrm = (v: string | null) => { prm?.resolve(v); setPrm(null); };
  return (
    <C.Provider value={{ confirm, prompt, openMenu }}>
      {children}
      <Modal open={!!conf} onClose={() => closeConf(false)}>
        {conf && <><h2 className="text-xl font-bold">{conf.title}</h2>{conf.body && <p className="mt-2 whitespace-pre-line text-ink-2">{conf.body}</p>}
          <div className="mt-6 flex justify-end gap-2"><button className="btn-ghost" onClick={() => closeConf(false)}>Cancel</button><button autoFocus className={conf.danger ? 'btn bg-rose text-night-950' : 'btn-primary'} onClick={() => closeConf(true)}>{conf.confirm ?? 'OK'}</button></div></>}
      </Modal>
      <Modal open={!!prm} onClose={() => closePrm(null)}>
        {prm && <form onSubmit={e => { e.preventDefault(); closePrm(value.trim()); }}>
          <h2 className="text-xl font-bold">{prm.title}</h2>
          <label className="mt-4 flex flex-col gap-1.5"><span className="label">{prm.label}</span><input autoFocus className="input" value={value} onChange={e => setValue(e.target.value)} list="prompt-options" onFocus={e => e.target.select()} /></label>
          <datalist id="prompt-options">{(prm.options ?? []).map(o => <option key={o} value={o} />)}</datalist>
          {prm.hint && <p className="mt-2 text-sm text-ink-3">{prm.hint}</p>}
          <div className="mt-6 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => closePrm(null)}>Cancel</button><button className="btn-primary">{prm.confirm ?? 'Save'}</button></div>
        </form>}
      </Modal>
      {menu && (
        <div ref={menuRef} role="menu" className="glass-hi fixed z-[70] min-w-[220px] p-1.5 shadow-glow" style={{ left: menu.x, top: menu.y }}
          onKeyDown={e => { const items = [...(menuRef.current?.querySelectorAll('button:not(:disabled)') ?? [])] as HTMLButtonElement[]; const i = items.indexOf(document.activeElement as HTMLButtonElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); } }}>
          {menu.entries.filter(Boolean).map((en, i) => en === '-' ? <div key={i} className="my-1 h-px bg-white/10" /> : en && (
            <button key={i} role="menuitem" disabled={en.disabled} onClick={() => { setMenu(null); en.run(); }} className={cx('flex w-full items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/[.08] disabled:opacity-40', en.danger ? 'text-rose' : 'text-ink')}>
              {en.label}{en.key && <kbd className="text-xs text-ink-3">{en.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </C.Provider>
  );
}
