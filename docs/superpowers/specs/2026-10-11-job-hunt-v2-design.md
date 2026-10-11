# Job Hunt v2: the interview studio, readiness scores and a bold UI

Date: 2026-10-11 · Status: approved in chat (rings + scores, no XP) · Builds on `2026-10-11-job-hunt-design.md`

## Why

v1 works but feels flat. The aim is a tool people want to open daily: practice that feels like a real
interview, progress you can see moving, and a modern, alive interface. XP, levels and badges were rejected
as dated. Progress is measured by real performance instead.

## Stack

- New app in `hunt/`: React 18, TypeScript, Vite 5, Tailwind 3, Framer Motion, lucide-react, recharts, cmdk,
  canvas-confetti, react-router (base `/hunt/`).
- Builds into `dashboard/public/hunt/` (git-ignored). Vercel builds it before assembling `public/`. The local
  dashboard serves it, with an SPA fallback. `/hunt.html` redirects to `/hunt/`.
- Same backend (`/api/prep/*`), same sign-in, same per-user storage.

## Progress system (replaces XP)

- **Activity log** (server, `activity` doc, last 3,000 events): practice seconds, sprint tasks, referral
  asks, applications, flashcards known, research, kit sections, scored answers (with skill and score), mock
  reports and readiness snapshots.
  Scored events are written by the server inside the mock and explain handlers, so they can't be faked
  from the client.
- **Daily rings**: Practise (20 min of speaking), Apply (2 actions: applications, referral asks, messages),
  Learn (3 sprint tasks). A streak day means at least 2 rings were closed.
- **Offer readiness 0–100** for each company and overall, with a weekly trend and contributing factors
  (research, kit, flashcards, best mock, days since the last mock).
- **Skill ratings** for Python, SQL, GenAI, System design, DSA and Communication. Each is a recency-weighted
  mean of scored answers (14-day half-life), with ±confidence = 30/√n (3 to 30). It starts at 50 ±30.
- **Personal bests and a weekly recap**: best mock, longest streak, most practice in a day, and this week
  compared with last.

## Interview studio

Full-screen and call-like:
1. An orb that pulses while the interviewer speaks. Speech comes from Groq Orpheus TTS when its terms are
   accepted, otherwise the browser's built-in voice.
2. The question types out as it is spoken. Then come the live mic waveform (Web Audio), live captions
   (browser speech recognition) and a 2-minute timer ring.
3. On stop, Whisper produces the final transcript, the answer is scored, an animated scorecard shows, and the
   next question is spoken.
4. At the end comes a report. Scoring 7/10 or more triggers confetti.

The explain trainer uses the same studio in "Explain" mode.

## Screens

Today (next action, rings, readiness with factors, coming up, skills radar, heatmap, weekly recap, tasks) ·
Companies · Company (journey: Research, Apply, Prepare with 3D flip flashcards, Practise → Studio) · Studio ·
Progress (mock trend, readiness history, skills table, heatmap, bests) · Ask · Profile · Sprint · Offers ·
AI status · ⌘K command bar everywhere.

## Look

Dark-first midnight base with glass panels and a slowly drifting aurora (violet, teal, amber). Sora for
headings, Manrope for body text. Motion is used for page transitions, count-up numbers, ring fills, the
card flip and the studio orb, and respects reduced motion.

## Backend additions

`POST activity` (client events: task, referral, card), `GET summary` (activity, skills, readiness, history),
`POST tts`, skill tags in mock and explain responses, practice seconds on mock and explain calls, and readiness
factors.
