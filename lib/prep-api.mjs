// Job Hunt routes, shared by the online desk (api/app.js) and the local dashboard (dashboard/server.mjs).
// ctx: { uid, resumes(): [{file, text}], createResume({from, role, company}): file name }
import { userStore } from './kv.mjs';
import { status, probe, transcribe, speak } from './llm.mjs';
import { search } from './search.mjs';
import * as prep from './prep.mjs';

const MAX_AUDIO = 3 * 1024 * 1024;

const GET = {
  status: () => status(),
  profile: s => prep.getProfile(s),
  targets: s => prep.listTargets(s),
  target: (s, q) => prep.getTargetView(s, String(q.id ?? '')),
  sprint: s => prep.getSprint(s),
  sections: () => prep.KIT_SECTIONS,
  summary: s => prep.summary(s),
};

const POST = {
  probe: (s, b) => probe(String(b.id ?? '')),
  profile: (s, b) => prep.saveProfile(s, b),
  'profile-seed': (s, b, ctx) => prep.seedProfile(s, ctx, b),
  'target-create': (s, b) => prep.createTarget(s, b),
  'target-update': (s, b) => prep.updateTarget(s, b),
  'target-delete': (s, b) => prep.deleteTarget(s, b),
  research: (s, b) => prep.researchStep(s, b),
  synthesize: (s, b) => prep.synthesize(s, b),
  kit: (s, b) => prep.kitSection(s, b),
  fit: (s, b) => prep.fit(s, b),
  message: (s, b) => prep.message(s, b),
  'tailor-copy': (s, b, ctx) => prep.tailorCopy(s, ctx, b),
  mock: (s, b) => prep.mock(s, b),
  explain: (s, b) => prep.explain(s, b),
  ask: (s, b) => prep.ask(s, b),
  search: (s, b) => search(String(b.query ?? ''), { deep: Boolean(b.deep) }),
  offers: (s, b) => prep.offers(s, b),
  sprint: (s, b) => prep.saveSprint(s, b.state),
  mentor: (s, b) => prep.mentor(s, b),
  activity: (s, b) => prep.clientActivity(s, b),
  tts: (s, b) => speak(String(b.text ?? '')),
  transcribe: async (s, b) => {
    const audio = Buffer.from(String(b.audio ?? ''), 'base64');
    if (!audio.length) throw new Error('No recording received.');
    if (audio.length > MAX_AUDIO) throw new Error('That recording is too long. Keep answers under 3 minutes.');
    return { text: await transcribe(audio, String(b.mime ?? 'audio/webm')) };
  },
};

// Returns the response body, or undefined when the route is unknown.
export async function handlePrep(route, method, body, query, ctx) {
  const table = method === 'POST' ? POST : method === 'GET' ? GET : null;
  const fn = table?.[route];
  if (!fn) return undefined;
  const store = await userStore(ctx.uid);
  return method === 'GET' ? fn(store, query ?? {}, ctx) : fn(store, body ?? {}, ctx);
}
