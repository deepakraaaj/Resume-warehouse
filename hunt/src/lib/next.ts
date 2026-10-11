// The single most useful thing to do next, from profile, companies, flashcards, mocks and the sprint.
import { DAYS } from './plan';
import type { Json } from './api';
import type { Sprint } from './state';
import { daysUntil, arr } from './util';
import { clampDay, sprintDay, taskId } from './progress';

export const APPLIED_STAGES = ['Applied', 'Recruiter call', 'Online test', 'Tech round', 'Manager round', 'HR round', 'Offer', 'Joined', 'Rejected', 'Ghosted'];
export const STAGES = ['Researching', 'Preparing', 'Applied', 'Recruiter call', 'Online test', 'Tech round', 'Manager round', 'HR round', 'Offer', 'Joined', 'Rejected', 'Ghosted'];

export type Next = { kicker: string; title: string; body: string; to: string; label: string };
export function nextAction(profile: Json, targets: Json[], sprint: Sprint | null): Next {
  if (!profile || !arr(profile.facts).length) return { kicker: 'Start here', title: 'Build your profile from your resumes', body: 'Every answer the app writes comes from your real experience. Takes about a minute.', to: '/profile', label: 'Build my profile' };
  if (!targets.length) return { kicker: 'Next step', title: 'Add the first company you’re applying to', body: 'The app researches their rounds, pay and real interview questions, with sources.', to: '/new', label: 'Add a company' };
  const upcoming = targets.filter(t => { const d = daysUntil(t.interviewDate); return d != null && d >= 0 && d <= 21; }).sort((a, b) => (daysUntil(a.interviewDate) ?? 0) - (daysUntil(b.interviewDate) ?? 0));
  const pool = upcoming.length ? upcoming : targets.filter(t => !['Rejected', 'Ghosted', 'Joined'].includes(t.stage)).sort((a, b) => (a.readiness ?? 0) - (b.readiness ?? 0));
  for (const t of pool) {
    const d = daysUntil(t.interviewDate);
    const kicker = d == null ? `Next for ${t.company}` : d === 0 ? `${t.company} interview is today` : `${t.company} interview in ${d} day${d === 1 ? '' : 's'}`;
    if (!t.researched) return { kicker, title: `Find out how ${t.company} interviews`, body: 'Four real web searches: rounds, questions candidates were asked, pay, and the company.', to: `/c/${t.id}/research`, label: 'Research now' };
    if (!arr(t.kit).includes('technical')) return { kicker, title: `Build your ${t.company} prep kit`, body: 'Likely questions with answers from your own projects, HR answers and a salary script.', to: `/c/${t.id}/prepare`, label: 'Build the kit' };
    const c = t.cards ?? { total: 0, known: 0 };
    if (c.total && c.known / c.total < 0.6) return { kicker, title: `Say ${c.total - c.known} ${t.company} answers out loud`, body: `${c.known} of ${c.total} down. Answer first, then flip the card.`, to: `/c/${t.id}/prepare`, label: 'Open flashcards' };
    if (!t.lastMockAt || Date.now() - Date.parse(t.lastMockAt) > 2 * 864e5) return { kicker, title: `Step into a mock ${t.company} interview`, body: t.mockCount ? `Best so far ${t.mockBest}/10. One more round finds the next weak spot.` : 'The interviewer speaks, you answer out loud, and every answer is scored.', to: `/studio/${t.id}`, label: 'Enter the studio' };
    if (t.fit == null && !APPLIED_STAGES.includes(t.stage)) return { kicker, title: `Check your fit and apply to ${t.company}`, body: 'See what matches, what to fix, and get a tailored summary and referral message.', to: `/c/${t.id}/apply`, label: 'Check my fit' };
  }
  if (sprint) {
    const day = clampDay(sprintDay(sprint));
    const left = DAYS[day - 1].k.filter((_, i) => !sprint.done[taskId(day, i)]).length;
    if (left) return { kicker: 'Keep the momentum', title: `${left} sprint task${left === 1 ? '' : 's'} left today`, body: DAYS[day - 1].t, to: '/sprint', label: 'Open today' };
  }
  return { kicker: 'All caught up', title: 'Add another company to your pipeline', body: 'More conversations mean more leverage when offers arrive.', to: '/new', label: 'Add a company' };
}
