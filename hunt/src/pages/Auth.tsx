// Sign-in for the online desk. The local dashboard has no accounts and skips straight in.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Spinner } from '../components/ui';

type Account = { email: string; name?: string } | null;
const C = createContext<{ account: Account; mode: string; signOut: () => void }>({ account: null, mode: 'local', signOut: () => {} });
export const useAuth = () => useContext(C);

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'check' | 'signIn' | 'password' | 'in' | 'error'>('check');
  const [account, setAccount] = useState<Account>(null);
  const [mode, setMode] = useState('local');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: '', password: '', current: '', next: '', next2: '' });
  const check = async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return setPhase('signIn');
      if (res.status === 403 && data.mustChangePassword) return setPhase('password');
      if (!res.ok) throw new Error(data.error ?? `The desk answered ${res.status}.`);
      setAccount(data.account ?? null); setMode(data.mode ?? 'local'); setPhase('in');
    } catch (err) { setError((err as Error).message); setPhase('error'); }
  };
  useEffect(() => { check(); }, []);
  const signOut = async () => { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); location.href = '/'; };
  const submit = (fn: () => Promise<void>) => async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };

  if (phase === 'in') return <C.Provider value={{ account, mode, signOut }}>{children}</C.Provider>;
  return (
    <div className="relative grid min-h-dvh place-items-center px-4">
      <div className="aurora"><i /><i /><i /></div>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-hi relative z-10 w-full max-w-sm p-7 shadow-glow">
        <div className="mb-6 flex items-center gap-2.5 font-display text-xl font-bold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet to-teal"><span className="h-3 w-3 rounded-full bg-amber" /></span>Job Hunt</div>
        {phase === 'check' && <div className="flex items-center gap-2 text-ink-2"><Spinner />Opening your desk…</div>}
        {phase === 'error' && <><p className="text-rose">{error}</p><button className="btn-primary mt-4" onClick={check}>Try again</button></>}
        {phase === 'signIn' && (
          <form className="space-y-4" onSubmit={submit(async () => { const d = await post('/api/login', { email: f.email, password: f.password }); setF({ ...f, password: '' }); if (d.mustChangePassword) setPhase('password'); else await check(); })}>
            <div><h1 className="text-2xl font-bold">Welcome back</h1><p className="text-sm text-ink-2">Sign in to your resumes and job hunt.</p></div>
            <input className="input" type="email" autoComplete="username" required placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoFocus />
            <input className="input" type="password" autoComplete="current-password" required placeholder="Password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
            {error && <p className="text-sm text-rose" role="alert">{error}</p>}
            <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
          </form>
        )}
        {phase === 'password' && (
          <form className="space-y-4" onSubmit={submit(async () => { if (f.next !== f.next2) throw new Error('The two new passwords do not match.'); await post('/api/password', { current: f.current, next: f.next }); await check(); })}>
            <div><h1 className="text-2xl font-bold">Choose your password</h1><p className="text-sm text-ink-2">Replace the temporary password. Use at least 10 characters.</p></div>
            <input className="input" type="password" autoComplete="current-password" required placeholder="Current password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} />
            <input className="input" type="password" autoComplete="new-password" minLength={10} required placeholder="New password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} />
            <input className="input" type="password" autoComplete="new-password" minLength={10} required placeholder="New password again" value={f.next2} onChange={e => setF({ ...f, next2: e.target.value })} />
            {error && <p className="text-sm text-rose" role="alert">{error}</p>}
            <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? <Spinner /> : 'Save password'}</button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
