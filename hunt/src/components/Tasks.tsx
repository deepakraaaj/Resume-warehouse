import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { DAYS, CAT_NAME } from '../lib/plan';
import { post } from '../lib/api';
import { useApp } from '../lib/state';
import { taskId } from '../lib/progress';
import { cx } from '../lib/util';

// A sprint day's tasks with animated checkboxes; ticking one also logs it for the Learn ring.
export function Tasks({ day }: { day: number }) {
  const { sprint, setSprint, toast } = useApp();
  if (!sprint) return null;
  const toggle = (id: string, on: boolean) => {
    setSprint(s => { const done = { ...s.done }; if (on) done[id] = true; else delete done[id]; return { ...s, done }; });
    post('activity', { type: on ? 'task' : 'untask', id }).catch(err => toast(err.message, true));
  };
  return (
    <ul className="divide-y divide-white/[.06]">
      {DAYS[day - 1].k.map((t, i) => {
        const id = taskId(day, i), on = Boolean(sprint.done[id]);
        return (
          <li key={id} className="flex items-start gap-3 py-3">
            <button onClick={() => toggle(id, !on)} aria-pressed={on} aria-label={on ? 'Mark not done' : 'Mark done'}
              className={cx('mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-lg border transition', on ? 'border-teal bg-teal text-night-950' : 'border-white/20 hover:border-teal')}>
              {on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}><Check className="h-4 w-4" strokeWidth={3} /></motion.span>}
            </button>
            <div className={cx('min-w-0 flex-1', on && 'text-ink-3 line-through decoration-white/20')}>
              <span className="mr-2 text-xs font-bold uppercase tracking-wide text-ink-3">{CAT_NAME[t[0]]}</span>{t[1]}
              {t[4] && <span className="mt-0.5 block text-sm text-ink-3 no-underline">{t[4]}</span>}
            </div>
            {t[2] > 0 && <span className="tnum whitespace-nowrap text-sm text-ink-3">{t[2]} min</span>}
          </li>
        );
      })}
    </ul>
  );
}
