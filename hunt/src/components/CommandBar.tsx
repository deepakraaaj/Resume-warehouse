import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Mic, Plus, Sparkles } from 'lucide-react';
import { useApp } from '../lib/state';

// ⌘K: jump anywhere, start a mock with any company, or send a question to Ask.
export function CommandBar() {
  const { palette, setPalette, targets } = useApp();
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const go = (to: string) => { setPalette(false); setQ(''); nav(to); };
  const item = 'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-ink-2 data-[selected=true]:bg-white/[.08] data-[selected=true]:text-ink';
  return (
    <AnimatePresence>
      {palette && (
        <motion.div className="fixed inset-0 z-50 grid place-items-start bg-night-950/70 px-4 pt-[14vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPalette(false)}>
          <motion.div initial={{ y: -12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, opacity: 0 }} onClick={e => e.stopPropagation()} className="mx-auto w-full max-w-xl">
            <Command className="glass-hi overflow-hidden shadow-glow" loop>
              <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Go to, practise, or ask anything…" className="w-full border-b border-white/10 bg-transparent px-5 py-4 text-lg text-ink outline-none placeholder:text-ink-3"
                onKeyDown={e => { if (e.key === 'Escape') setPalette(false); }} />
              <Command.List className="max-h-[50vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-ink-3">Press Enter on “Ask” to search the web.</Command.Empty>
                {q.trim().length > 3 && (
                  <Command.Item value={`ask ${q}`} onSelect={() => go(`/ask?q=${encodeURIComponent(q)}`)} className={item}><Sparkles className="h-4 w-4 text-amber" />Ask: “{q}”<ArrowRight className="ml-auto h-4 w-4" /></Command.Item>
                )}
                <Command.Group heading="Practise" className="px-1 text-xs text-ink-3">
                  {targets.map(t => <Command.Item key={`m${t.id}`} value={`mock interview ${t.company}`} onSelect={() => go(`/studio/${t.id}`)} className={item}><Mic className="h-4 w-4 text-violet" />Mock interview: {t.company}</Command.Item>)}
                  <Command.Item value="explain a project" onSelect={() => go('/studio/general?mode=explain')} className={item}><Mic className="h-4 w-4 text-teal" />Explain one of my projects</Command.Item>
                </Command.Group>
                <Command.Group heading="Companies" className="px-1 text-xs text-ink-3">
                  {targets.map(t => <Command.Item key={t.id} value={`company ${t.company} ${t.role}`} onSelect={() => go(`/c/${t.id}`)} className={item}><Building2 className="h-4 w-4" />{t.company}<span className="ml-auto text-xs text-ink-3">{t.readiness ?? 0}% ready</span></Command.Item>)}
                  <Command.Item value="add a company new" onSelect={() => go('/new')} className={item}><Plus className="h-4 w-4" />Add a company</Command.Item>
                </Command.Group>
                <Command.Group heading="Go to" className="px-1 text-xs text-ink-3">
                  {[['/', 'Today'], ['/progress', 'Progress'], ['/sprint', '30-day sprint'], ['/profile', 'My profile'], ['/offers', 'Offers'], ['/status', 'AI status']].map(([to, l]) => (
                    <Command.Item key={to} value={`go ${l}`} onSelect={() => go(to)} className={item}><ArrowRight className="h-4 w-4" />{l}</Command.Item>
                  ))}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
