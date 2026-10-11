// App-wide data: companies, profile, sprint, activity summary and AI status, with refreshers.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, post, afterPost, type Json } from './api';
import { START_DEFAULT } from './plan';

export type Sprint = { v: number; start: string; done: Record<string, boolean>; checkins: Record<string, Json>; refs: number };
type Toast = { id: number; text: string; bad?: boolean };
type Ctx = {
  targets: Json[]; profile: Json | null; sprint: Sprint | null; summary: Json | null; status: Json | null;
  loadTargets: () => Promise<void>; loadProfile: () => Promise<void>; loadSummary: () => Promise<void>; loadStatus: () => Promise<void>;
  setSprint: (fn: (s: Sprint) => Sprint) => void;
  toast: (text: string, bad?: boolean) => void; toasts: Toast[];
  palette: boolean; setPalette: (v: boolean) => void;
};
const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Json[]>([]);
  const [profile, setProfile] = useState<Json | null>(null);
  const [sprint, setSprintState] = useState<Sprint | null>(null);
  const [summary, setSummary] = useState<Json | null>(null);
  const [status, setStatus] = useState<Json | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [palette, setPalette] = useState(false);
  const saveTimer = useRef<number>();

  const toast = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, bad }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), bad ? 6500 : 2800);
  }, []);
  const loadTargets = useCallback(async () => { setTargets(await get('targets').catch(() => [])); }, []);
  const loadProfile = useCallback(async () => { setProfile(await get('profile').catch(() => null)); }, []);
  const loadSummary = useCallback(async () => { setSummary(await get('summary').catch(() => null)); }, []);
  const loadStatus = useCallback(async () => { setStatus(await get('status').catch(() => null)); }, []);
  const setSprint = useCallback((fn: (s: Sprint) => Sprint) => {
    setSprintState(prev => {
      const next = fn(prev ?? { v: 1, start: START_DEFAULT, done: {}, checkins: {}, refs: 0 });
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => post('sprint', { state: next }).catch(err => toast(`Couldn't save your sprint: ${err.message}`, true)), 600);
      return next;
    });
  }, [toast]);

  useEffect(() => {
    let statusTimer: number;
    afterPost(() => { clearTimeout(statusTimer); statusTimer = window.setTimeout(() => { loadStatus(); loadSummary(); }, 1200); });
    (async () => {
      const s = await get('sprint').catch(() => null);
      setSprintState({ v: 1, start: START_DEFAULT, done: {}, checkins: {}, refs: 0, ...(s ?? {}) });
    })();
    loadTargets(); loadProfile(); loadSummary(); loadStatus();
    const t = window.setInterval(loadStatus, 60_000);
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); } };
    window.addEventListener('keydown', key);
    return () => { clearInterval(t); window.removeEventListener('keydown', key); };
  }, [loadTargets, loadProfile, loadSummary, loadStatus]);

  const value = useMemo(() => ({ targets, profile, sprint, summary, status, loadTargets, loadProfile, loadSummary, loadStatus, setSprint, toast, toasts, palette, setPalette }),
    [targets, profile, sprint, summary, status, loadTargets, loadProfile, loadSummary, loadStatus, setSprint, toast, toasts, palette]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

// Runs an async action, reports errors as a toast, and exposes a busy flag.
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    try { return await fn(); } catch (err) { toast((err as Error).message, true); return undefined; } finally { setBusy(null); }
  }, [toast]);
  return { busy, run };
}
