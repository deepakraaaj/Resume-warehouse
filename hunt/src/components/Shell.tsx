import { AnimatePresence, motion } from 'framer-motion';
import { NavLink, type Location } from 'react-router-dom';
import { Activity, Building2, Gauge, Home, Mic, MoreHorizontal, Search, Settings2, Sparkles, User, Wallet, CalendarDays, Command, FileText, LogOut, Download } from 'lucide-react';
import { useAuth } from '../pages/Auth';
import type { ReactNode } from 'react';
import { useApp } from '../lib/state';
import { cx } from '../lib/util';
import { CommandBar } from './CommandBar';

const NAV = [
  ['/', 'Today', Home], ['/resumes', 'Resumes', FileText], ['/companies', 'Companies', Building2], ['/practice', 'Practice', Mic], ['/progress', 'Progress', Activity],
  ['/ask', 'Ask anything', Sparkles], ['/sprint', '30-day sprint', CalendarDays], ['/profile', 'My profile', User], ['/offers', 'Offers', Wallet], ['/status', 'AI status', Gauge],
] as const;
const TABS = [['/', 'Today', Home], ['/resumes', 'Resumes', FileText], ['/companies', 'Companies', Building2], ['/practice', 'Practice', Mic], ['/more', 'More', MoreHorizontal]] as const;

export function Shell({ children, location }: { children: ReactNode; location: Location }) {
  const { targets, status, toasts, setPalette } = useApp();
  const llm = (status?.budgets ?? []).filter((b: { id: string }) => !b.id.startsWith('search:') && !b.id.includes('whisper') && !b.id.includes('orpheus'));
  const ready = llm.filter((b: { state: string }) => b.state === 'ready').length;
  const studio = location.pathname.startsWith('/studio');
  const wide = location.pathname.startsWith('/resumes');
  const { account, signOut } = useAuth();
  return (
    <div className="relative min-h-dvh">
      <div className="aurora"><i /><i /><i /></div><div className="grain" />
      {!studio && (
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/[.06] bg-night-950/40 px-3 py-5 backdrop-blur-xl lg:flex">
          <NavLink to="/" className="mb-5 flex items-center gap-2.5 px-3 font-display text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet to-teal shadow-glow"><span className="h-2.5 w-2.5 rounded-full bg-amber" /></span>Job Hunt
          </NavLink>
          <button onClick={() => setPalette(true)} className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-ink-3 transition hover:text-ink">
            <Search className="h-4 w-4" />Search or ask<kbd className="ml-auto flex items-center gap-0.5 rounded-md bg-white/10 px-1.5 text-[11px]"><Command className="h-3 w-3" />K</kbd>
          </button>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
            {NAV.map(([to, label, Icon]) => (
              <div key={to}>
                <NavLink to={to} end={to === '/'} className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition', isActive ? 'bg-white/[.08] text-ink' : 'text-ink-2 hover:bg-white/[.04] hover:text-ink')}>
                  <Icon className="h-[18px] w-[18px]" />{label}
                </NavLink>
                {to === '/companies' && targets.length > 0 && (
                  <div className="my-1 ml-6 flex flex-col border-l border-white/[.08] pl-2">
                    {targets.slice(0, 7).map(t => (
                      <NavLink key={t.id} to={`/c/${t.id}`} className={({ isActive }) => cx('flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition', isActive ? 'bg-white/[.06] text-ink' : 'text-ink-2 hover:text-ink')}>
                        <span className="truncate">{t.company}</span><span className="tnum text-xs text-ink-3">{t.readiness ?? 0}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
          <NavLink to="/status" className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-white/[.04]">
            <span className={cx('h-2 w-2 rounded-full', !llm.length ? 'bg-ink-3' : ready === 0 ? 'bg-rose' : ready < llm.length / 2 ? 'bg-amber' : 'bg-teal')} />{llm.length ? `${ready} of ${llm.length} AI models ready` : 'Checking AI…'}
          </NavLink>
          {account && (
            <div className="mt-2 flex items-center gap-2 border-t border-white/[.06] px-3 pt-3 text-xs text-ink-3">
              <span className="min-w-0 flex-1 truncate" title={account.email}>{account.email}</span>
              <a href="/api/export" download className="rounded p-1 hover:text-ink" title="Download all resumes"><Download className="h-4 w-4" /></a>
              <button onClick={signOut} className="rounded p-1 hover:text-ink" title="Sign out"><LogOut className="h-4 w-4" /></button>
            </div>
          )}
        </aside>
      )}
      <main className={cx('relative z-10', studio ? '' : 'lg:pl-64')}>
        <AnimatePresence mode="wait">
          <motion.div key={wide ? 'resumes' : location.pathname} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className={studio ? '' : wide ? 'px-4 pb-24 pt-6 sm:px-8 lg:pb-0 lg:pt-10' : 'mx-auto max-w-6xl px-4 pb-28 pt-8 sm:px-8 lg:pb-16 lg:pt-12'}>
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      {!studio && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/[.08] bg-night-950/85 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
          {TABS.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] font-semibold', isActive ? 'text-ink' : 'text-ink-3')}>
              <Icon className="h-5 w-5" />{label}
            </NavLink>
          ))}
        </nav>
      )}
      <CommandBar />
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-8">
        <AnimatePresence>{toasts.map(t => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} role="status"
            className={cx('pointer-events-auto max-w-lg rounded-full px-5 py-2.5 text-sm font-semibold shadow-2xl', t.bad ? 'bg-rose text-night-950' : 'bg-ink text-night-950')}>{t.text}</motion.div>
        ))}</AnimatePresence>
      </div>
    </div>
  );
}
export { Settings2 };
