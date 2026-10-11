# Job Hunt: AI interview prep inside Resume Desk

Date: 2026-10-11 · Status: implemented (phases 1–3), verified locally with live keys

## Goal

Land a better-paid job by turning existing skills into applications, explanations and interview answers.
Type "Infosys, Python developer" (or paste a JD) and get everything needed for that interview, built from
real web research and from Deepakraj's own verified experience. Free tiers only. Accuracy over volume.

## Decisions

- Lives inside Resume Desk: same Vercel project, sign-in, per-user Blob storage, a new page `/hunt.html`.
- AI keys stay on the server. The browser only calls `/api/prep/*`.
- Models: Groq, Gemini, Mistral (OpenAI-compatible endpoints from `LLM_n_*` env vars) with automatic fallback.
- Search, in fallback order: Gemini Google Search grounding (`gemini-2.5-flash`, about 18/day on this key), Groq
  browser search (`gpt-oss-20b`/`120b`, shares those models' budgets), Tavily (`TAVILY_API_KEY`, optional).
- Measured on 11 Oct 2026: Gemini 2.5 Flash's free daily quota ran out after about 5–20 calls; `gemini-2.5-flash-lite` is
  closed to new users (use `gemini-3.5-flash-lite`); Mistral's workspace reports a limit of 0 requests until its free
  plan is turned on.
- Voice answers: Groq Whisper transcription, with the browser's speech recognition as fallback.
- Works in both modes: Vercel (Blob storage under `u/<id>/prep/`) and the local dashboard (files under `.data/`).

## Units

| File | Job |
| --- | --- |
| `lib/kv.mjs` | JSON storage with two backends: Blob (cloud) and local files. |
| `lib/llm-config.mjs` | Providers, model lists, default limits, task routing. The one place to edit limits. |
| `lib/llm.mjs` | `chat(task, messages, opts)`: picks a model with budget, waits or falls back, records limits. `status()` for Settings. |
| `lib/search.mjs` | `search(query, opts)`: grounding or Tavily, cached 7 days, every result carries source URLs. |
| `lib/prep.mjs` | Feature logic: profile, target research, kit sections, apply, mock, explain, sprint, mentor, offer. |
| `lib/prep-api.mjs` | Route table shared by `api/app.js` and `dashboard/server.mjs`. |
| `dashboard/public/hunt.*` | The Job Hunt page: Sprint, Profile, Targets, Settings. |

## Rate limiting (per model and per search provider)

- Each model keeps rolling counters for requests and tokens per minute and per day, against limits from
  `llm-config.mjs`.
- Provider headers (`x-ratelimit-remaining-*`, `retry-after`) override the defaults when present.
- On a 429: parse the retry time from headers or the message ("try again in 13m20s", `retryDelay`). Daily
  caps cool down until their reset. A limit of 0 marks the model "blocked by plan" and is rechecked every
  10 minutes.
- When choosing a model: skip models that are cooling down or out of budget. Wait if the next free slot
  is 3 seconds away or less (Mistral's 1 request/second). Otherwise fall back to the next model.
- If every model is unavailable, the error names the soonest one to free up.
- Status is kept in memory and saved to storage at most every 30 seconds and on every cooldown change.
  Settings shows limits, usage, remaining quota, cooldowns and the last error for each model.

## Accuracy rules

- Research answers cite sources by number, and each claim is labelled official, candidate-reported
  or unverified.
- Conflicting sources are shown side by side. "Not found" beats a guess.
- Answers about Deepakraj use only profile facts marked "defend". Facts marked "don't claim" are never used.
- Low temperature for research and analysis. JSON outputs are validated, and malformed ones are retried
  once on another model.

## Flow

1. **Profile**: seeded by AI from his resumes and deepsinterview.vercel.app. Each fact can be marked
   defend, unsure or don't claim.
2. **Target**: company + role + optional JD → research (rounds, candidate experiences, pay, company
   facts), each item sourced.
3. **Apply**: fit score, gaps, keywords, tailored summary and bullets, referral and recruiter messages,
   "create tailored copy" in Resume Desk, add to pipeline.
4. **Prepare**: a kit section for each round (likely questions with answers from his profile), project
   explanations for this role, concepts to master, questions to ask. Includes the Explain trainer
   (speak → transcript → scored feedback → follow-ups → tighter version).
5. **Mock**: one question at a time for each round, scored, ending with a weak-spot report.
6. **Offer**: compare offers, and a negotiation script grounded in researched pay.
7. **Sprint home**: 30-day plan, pipeline, streak, check-ins, mentor chat.

## Vercel's 60-second limit

Long jobs are split into steps the browser runs one at a time (research → each kit section), and each
step finishes in under 60 seconds.

## Testing

- Unit-style checks for the limiter (counters, cooldown parsing, choosing a model) run with
  `node --test`.
- A live smoke script runs one call per provider plus one search, and prints the status table.
- A manual pass of each page in the local dashboard.
