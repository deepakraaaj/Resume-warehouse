// Job Hunt features. Every answer about the user comes from their profile (facts they marked "defend");
// every answer about a company comes from web research with numbered sources [S1], [S2], ...
import crypto from 'node:crypto';
import { chat, chatJson } from './llm.mjs';
import { search } from './search.mjs';

const newId = p => `${p}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const clip = (s, n) => String(s ?? '').slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);
const str = v => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const arr = v => (Array.isArray(v) ? v : []);

const RULES = `Ground rules:
- About the candidate, use ONLY the profile facts given. Never invent projects, numbers, tools or employers. If something is missing, say what to add to the profile.
- About companies, use ONLY the research given and cite it as [S1], [S2]. If the research does not say, write "Not in research". Never guess salaries, rounds or policies.
- Label company claims: "official" (company's own site or careers page), "candidate-reported" (Glassdoor, AmbitionBox, GeeksforGeeks, Reddit, LinkedIn posts, blogs by candidates), or "unverified".
- Indian job market context. Money in LPA (lakhs per annum). Plain English, short sentences.`;

// ---------- Profile ----------

const EMPTY_PROFILE = { name: '', headline: '', summary: '', years: '', location: '', currentCtc: '', targetCtc: '', noticePeriod: '', lanes: [], projects: [], facts: [], skills: { defend: [], learning: [] }, updatedAt: null };

export async function getProfile(store) {
  return { ...EMPTY_PROFILE, ...(await store.get('profile', {})) };
}

export async function saveProfile(store, body) {
  const prev = await getProfile(store);
  const p = { ...prev, ...body, updatedAt: new Date().toISOString() };
  p.facts = arr(p.facts).map(f => ({ id: f.id || newId('f'), text: clip(f.text, 400), area: f.area || 'other', project: f.project || '', status: ['defend', 'unsure', 'dont'].includes(f.status) ? f.status : 'unsure' })).filter(f => f.text.trim());
  p.projects = arr(p.projects).map(x => ({ id: x.id || newId('p'), name: clip(x.name, 120), stack: arr(x.stack).map(s => clip(s, 40)).slice(0, 20), problem: clip(x.problem, 600), what: clip(x.what, 1200), impact: clip(x.impact, 600), story: clip(x.story, 3000) })).filter(x => x.name.trim());
  await store.put('profile', p);
  return p;
}

// What the AI is allowed to say about the user.
export function profileContext(p, { full = false } = {}) {
  const defend = p.facts.filter(f => f.status === 'defend');
  const unsure = p.facts.filter(f => f.status === 'unsure');
  const lines = [
    `Candidate: ${p.name || 'the candidate'}. ${p.headline}`,
    p.summary && `Summary: ${p.summary}`,
    p.years && `Experience: ${p.years}`,
    p.location && `Location: ${p.location}`,
    p.currentCtc && `Current CTC: ${p.currentCtc}`,
    p.targetCtc && `Target CTC: ${p.targetCtc}`,
    p.noticePeriod && `Notice period: ${p.noticePeriod}`,
    'Projects:',
    ...p.projects.map(x => `- ${x.name} [${x.stack.join(', ')}]: ${x.problem} ${x.what} Impact: ${x.impact}${full && x.story ? ` Story: ${x.story}` : ''}`),
    'Facts the candidate can defend in depth:',
    ...defend.map(f => `- ${f.text}`),
    unsure.length && 'Facts the candidate is unsure about (mention only lightly, never as a core strength):',
    ...unsure.map(f => `- ${f.text}`),
    p.skills?.defend?.length && `Skills he can defend: ${p.skills.defend.join(', ')}`,
    p.skills?.learning?.length && `Skills still learning (do not claim expertise): ${p.skills.learning.join(', ')}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/h\d|\/tr|\/div|\/section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// Reads the user's resumes and optional guide page, then asks the AI to extract a structured profile.
// Facts that appear only in one tailored resume, or look inflated, come back as "unsure".
export async function seedProfile(store, ctx, { guideUrl } = {}) {
  const resumes = await ctx.resumes();
  const resumeText = resumes.map(r => `=== ${r.file} ===\n${clip(r.text, 5000)}`).join('\n\n').slice(0, 40000);
  let guide = '';
  if (guideUrl) {
    try {
      const res = await fetch(guideUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) guide = clip(htmlToText(await res.text()), 45000);
    } catch { /* optional */ }
  }
  if (!resumeText && !guide) throw new Error('No resumes or guide text found to read.');
  const { data } = await chatJson('smart', [
    { role: 'system', content: 'You extract an honest, structured candidate profile for interview preparation. Output only JSON.' },
    { role: 'user', content: `Build the candidate's profile from these sources.

Status rules for each fact:
- "defend": stated consistently across sources, or explained in detail in the interview guide.
- "unsure": appears in only one tailored resume, uses big claims without detail (e.g. exactly-once Kafka, Kubernetes, Terraform, "architected" platforms), or the guide says he did not build it.
- "dont": the guide explicitly says he did not do it.

Return JSON:
{"name":"","headline":"one line positioning","summary":"3 sentences, first person","years":"e.g. 2 years 4 months","location":"",
"projects":[{"name":"","stack":["..."],"problem":"","what":"what HE did","impact":"numbers only if stated","story":"2-minute STAR story in first person using only stated facts"}],
"facts":[{"text":"one verifiable claim","area":"project|skill|impact|education|other","project":"project name or empty","status":"defend|unsure|dont"}],
"skills":{"defend":["..."],"learning":["..."]}}
Include every distinct project. 25-60 facts.

RESUMES:
${resumeText}

INTERVIEW GUIDE (his own notes, most candid source):
${guide || '(not provided)'}` },
  ], { maxTokens: 8000, temperature: 0.1, reasoning: 'medium' });
  const prev = await getProfile(store);
  return saveProfile(store, { ...data, currentCtc: prev.currentCtc, targetCtc: prev.targetCtc, noticePeriod: prev.noticePeriod, lanes: prev.lanes });
}

// ---------- Targets ----------

async function index(store) { return store.get('targets/index', []); }
export const listTargets = store => index(store);
export async function getTarget(store, id) {
  const t = await store.get(`targets/${id}`, null);
  if (!t) throw new Error('That target no longer exists.');
  return t;
}
async function putTarget(store, t) {
  t.updatedAt = new Date().toISOString();
  await store.put(`targets/${t.id}`, t);
  const list = (await index(store)).filter(x => x.id !== t.id);
  list.unshift({ id: t.id, company: t.company, role: t.role, stage: t.stage, fit: t.fit?.score ?? null, interviewDate: t.interviewDate || '', updatedAt: t.updatedAt, researched: Boolean(t.research), kitDone: Object.keys(t.kit ?? {}).length });
  await store.put('targets/index', list);
  return t;
}

export async function createTarget(store, { company, role, jd, location, interviewDate, notes }) {
  const c = clip(company, 80).trim(), r = clip(role, 100).trim();
  if (c.length < 2) throw new Error('Name the company.');
  if (r.length < 2) throw new Error('Name the role.');
  return putTarget(store, { id: newId('t'), company: c, role: r, jd: clip(jd, 15000), location: clip(location, 60), interviewDate: clip(interviewDate, 10), notes: clip(notes, 2000), stage: 'Researching', createdAt: new Date().toISOString(), searches: [], research: null, kit: {}, fit: null, messages: [], mocks: [] });
}

export async function updateTarget(store, { id, ...fields }) {
  const t = await getTarget(store, id);
  for (const k of ['company', 'role', 'jd', 'location', 'interviewDate', 'notes', 'stage', 'resumeFile', 'appliedOn', 'offer']) if (fields[k] !== undefined) t[k] = typeof fields[k] === 'string' ? clip(fields[k], k === 'jd' ? 15000 : 2000) : fields[k];
  return putTarget(store, t);
}

export async function deleteTarget(store, { id }) {
  await store.del(`targets/${id}`);
  await store.put('targets/index', (await index(store)).filter(x => x.id !== id));
  return { ok: true };
}

// The research plan: each step is one search, small enough for one serverless call.
function researchQueries(t, p) {
  const yrs = `${parseInt(p.years, 10) || 2} years experience`;
  const loc = t.location || p.location || 'India';
  return [
    { key: 'process', deep: false, q: `${t.company} interview process ${t.role} ${yrs} rounds 2026`,
      how: 'List each interview round in order: its name, format (online test, video, in person), duration, platform, and what it tests. Say which sources are official and which are candidate reports.' },
    { key: 'experiences', deep: true, q: `${t.company} ${t.role} interview experience questions asked 2026`,
      how: 'List the actual questions candidates reported being asked, grouped by round, with the source and date of each report.' },
    { key: 'salary', deep: false, q: `${t.company} ${t.role} salary ${yrs} ${loc} LPA`,
      how: 'Give salary figures in LPA with the source, job level or designation, experience and date for each figure. Do not average different sources together.' },
    { key: 'company', deep: false, q: `${t.company} lateral hiring ${t.role} tech stack work mode notice period 2026`,
      how: 'Cover: what the company and its relevant business unit does, the tech stack engineers use, work mode, joining or notice-period buyout for lateral hires, and any 2026 news that matters to a candidate.' },
  ];
}

export async function researchStep(store, { id, step, fresh }) {
  const t = await getTarget(store, id);
  const p = await getProfile(store);
  const plan = researchQueries(t, p);
  const s = plan[Number(step)];
  if (!s) throw new Error('Unknown research step.');
  let result;
  try {
    result = await search(s.q, { deep: s.deep, instructions: s.how, fresh: Boolean(fresh) });
  } catch (err) {
    result = { query: s.q, provider: 'none', answer: '', sources: [], error: err.message };
  }
  t.searches = arr(t.searches).filter(x => x.key !== s.key);
  t.searches.push({ key: s.key, ...result });
  await putTarget(store, t);
  return { step: Number(step), total: plan.length, key: s.key, query: s.q, provider: result.provider, sources: result.sources?.length ?? 0, error: result.error ?? (result.noSources ? 'No web sources found.' : null), cached: Boolean(result.cached) };
}

// Merges every search's sources into one S-numbered list and rewrites [n] markers to [Sn].
function mergeSources(searches) {
  const all = [];
  const byUrl = new Map();
  const blocks = searches.map(s => {
    const map = {};
    for (const src of arr(s.sources)) {
      const key = src.url || `${s.key}-${src.n}`;
      if (!byUrl.has(key)) { byUrl.set(key, all.length + 1); all.push({ ...src, n: all.length + 1 }); }
      map[src.n] = byUrl.get(key);
    }
    const answer = String(s.answer ?? '').replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, ids) => `[${ids.split(',').map(x => `S${map[x.trim()] ?? x.trim()}`).join(', ')}]`);
    const extracts = arr(s.sources).filter(x => x.snippet).map(x => `[S${map[x.n]}] ${x.title}: ${x.snippet}`).join('\n');
    if (!arr(s.sources).length) return `### ${s.key} (searched: "${s.query}")\nNo web sources found. Treat this topic as unknown.`;
    return `### ${s.key} (searched: "${s.query}")\n${answer}${extracts ? `\nExtracts:\n${extracts}` : ''}${s.error ? `\n(search failed: ${s.error})` : ''}`;
  });
  return { sources: all, text: blocks.join('\n\n') };
}

export async function synthesize(store, { id }) {
  const t = await getTarget(store, id);
  const p = await getProfile(store);
  if (!arr(t.searches).length) throw new Error('Run the research first.');
  const merged = mergeSources(t.searches);
  const { data } = await chatJson('smart', [
    { role: 'system', content: `You are a precise interview researcher. ${RULES}\nOutput only JSON.` },
    { role: 'user', content: `Company: ${t.company}\nRole: ${t.role}\nLocation: ${t.location || p.location || 'India'}\nCandidate experience: ${p.years || 'about 2 years'}\n${t.jd ? `Job description:\n${clip(t.jd, 8000)}\n` : ''}
RESEARCH (sources are [S#]):
${clip(merged.text, 14000)}

Return JSON:
{"summary":"3-4 sentences: what this interview will be like and what matters most",
"rounds":[{"name":"","format":"online test / video / in-person, duration if known","tests":"what it checks","tips":"your own coaching advice for winning this round (not a research claim)","label":"official|candidate-reported|unverified","refs":["S1"]}],
"salary":{"range":"e.g. 6-9 LPA or Not in research","basis":"who reported it, for what experience","label":"","refs":[]},
"companyFacts":[{"fact":"","label":"","refs":[]}],
"techStack":[{"item":"","refs":[]}],
"whatTheyValue":["..."],
"jdNeeds":["top requirements from the JD or role, most important first"],
"conflicts":["where sources disagree, both sides with refs"],
"unknowns":["important things the research could not confirm"],
"redFlags":["e.g. bond, service agreement, long notice - only if in research"]}` },
  ], { maxTokens: 3000, temperature: 0.1 });
  t.research = { ...data, sources: merged.sources, at: new Date().toISOString() };
  if (t.stage === 'Researching') t.stage = 'Preparing';
  return putTarget(store, t);
}

function researchContext(t) {
  const r = t.research;
  if (!r) return 'No research yet.';
  const src = arr(r.sources).map(s => `[S${s.n}] ${s.site || s.title}`).join('; ');
  return `${r.summary}\nRounds: ${arr(r.rounds).map(x => `${x.name} (${x.format}): ${x.tests} [${arr(x.refs).join(',')}] (${x.label})`).join(' | ')}\nSalary: ${r.salary?.range} — ${r.salary?.basis} [${arr(r.salary?.refs).join(',')}]\nCompany: ${arr(r.companyFacts).map(f => `${f.fact} [${arr(f.refs).join(',')}]`).join(' | ')}\nTech: ${arr(r.techStack).map(x => x.item).join(', ')}\nValues: ${arr(r.whatTheyValue).join('; ')}\nJD needs: ${arr(r.jdNeeds).join('; ')}\nUnknowns: ${arr(r.unknowns).join('; ')}\nSources: ${src}`;
}

// ---------- Prep kit ----------

const KIT = {
  technical: {
    title: 'Technical questions',
    ask: `List the 10 technical questions this company is most likely to ask for this role, using the research (questions candidates reported first) and the JD. For each, write the answer the candidate should give in his own voice (first person, spoken, 60-90 seconds), tied to his real projects where possible.
JSON: {"items":[{"q":"","why":"why they ask / which round","source":"[S#] or 'common for this role'","answer":"","keyPoints":["..."],"followUps":[{"q":"","a":""}],"trap":"common mistake to avoid"}]}`,
  },
  projects: {
    title: 'Explain your projects',
    ask: `For each of the candidate's projects that is relevant to this role (max 4, most relevant first), prepare how to explain it to THIS company's interviewer.
JSON: {"items":[{"project":"","whyRelevant":"link to the JD or company","pitch30":"30-second version","star":"2-minute STAR version in first person","numbers":["numbers to remember, only from the profile"],"deepDive":[{"q":"","a":""}],"dontSay":["claims to avoid because they are unsure or unverifiable"]}]}`,
  },
  hr: {
    title: 'HR and managerial',
    ask: `Prepare the HR and managerial round. Cover: tell me about yourself (tailored to this company), why ${'{company}'}, why are you leaving, notice period, current CTC, expected CTC (anchor on the researched salary range, never below the candidate's target, and say what to answer if they push back), relocation or work mode, strengths, a weakness, a conflict story, where you see yourself in 3 years.
JSON: {"items":[{"q":"","answer":"spoken, first person","tip":"","refs":["S#"]}],"ctcScript":{"current":"","expected":"","ifPushed":"","walkAway":"guidance, not a number unless research supports it"}}`,
  },
  concepts: {
    title: 'Concepts to master',
    ask: `List the 8-12 concepts this interview is most likely to probe (from the JD, research and role). For each, explain it simply, show where it appears in the candidate's own work (or say honestly that it doesn't), and give 3 self-check questions with short answers.
JSON: {"items":[{"concept":"","simple":"explain like to a smart friend, 3-4 sentences","inYourWork":"","priority":"must|should|nice","check":[{"q":"","a":""}],"learnIn":"what to read or build in under 2 hours"}]}`,
  },
  ask: {
    title: 'Questions to ask them',
    ask: `Write 6 sharp questions the candidate can ask at the end of each type of round, based on the research (team, tech, growth, the role). Avoid anything answered on their website.
JSON: {"items":[{"round":"technical|manager|HR","q":"","why":"what it signals"}]}`,
  },
  plan: {
    title: 'Prep plan',
    ask: `Make a day-by-day prep plan from today until the interview date (or 7 days if no date), 2-3 hours a day, prioritising the biggest gaps between the candidate's profile and this role. Then a day-before checklist and an on-the-day checklist.
JSON: {"days":[{"day":"Day 1 · date","focus":"","tasks":["..."]}],"dayBefore":["..."],"onTheDay":["..."]}`,
  },
};
export const KIT_SECTIONS = Object.fromEntries(Object.entries(KIT).map(([k, v]) => [k, v.title]));

export async function kitSection(store, { id, section }) {
  const spec = KIT[section];
  if (!spec) throw new Error('Unknown prep section.');
  const t = await getTarget(store, id);
  const p = await getProfile(store);
  const { data, model } = await chatJson('smart', [
    { role: 'system', content: `You are an expert interview coach for Indian tech hiring who prepares candidates with honest, specific answers. ${RULES}\nOutput only JSON.` },
    { role: 'user', content: `Company: ${t.company}\nRole: ${t.role}\nToday: ${today()}\nInterview date: ${t.interviewDate || 'not set'}\n${t.jd ? `JD:\n${clip(t.jd, 3000)}\n` : ''}
RESEARCH:
${clip(researchContext(t), 4000)}

CANDIDATE PROFILE:
${clip(profileContext(p, { full: section === 'projects' || section === 'hr' }), 7000)}

TASK:
${spec.ask.replace('{company}', t.company)}` },
  ], { maxTokens: 3500, temperature: 0.3 });
  // Models sometimes return the list itself instead of {items: [...]}.
  const body = Array.isArray(data) ? { items: data } : data.items || data.days ? data : { items: Object.values(data).find(Array.isArray) ?? [], ...data };
  t.kit = { ...(t.kit ?? {}), [section]: { ...body, model, at: new Date().toISOString() } };
  return putTarget(store, t);
}

// ---------- Apply ----------

export async function fit(store, { id }) {
  const t = await getTarget(store, id);
  const p = await getProfile(store);
  const { data } = await chatJson('smart', [
    { role: 'system', content: `You are a blunt, accurate tech recruiter in India. ${RULES}\nOutput only JSON.` },
    { role: 'user', content: `Score the candidate for this role.\nCompany: ${t.company}\nRole: ${t.role}\nJD:\n${clip(t.jd, 5000) || '(no JD pasted; use the research)'}\nRESEARCH:\n${clip(researchContext(t), 3000)}\n\nPROFILE:\n${profileContext(p)}

Return JSON:
{"score":0-100,"verdict":"apply now | apply with tweaks | low fit, and why in one sentence","experienceMatch":"","matched":[{"need":"","proof":"which project or fact proves it"}],"gaps":[{"need":"","fix":"what to do in 1-3 days, or how to frame it honestly"}],"keywords":["exact JD terms he can honestly put on the resume"],"summary":"tailored resume summary, 3 lines, first person implied, only true claims","bullets":["5 tailored resume bullets from his real work with his real numbers"],"referralAngle":"one line hook for a referral message"}
Score honestly: 80+ only if most must-haves are clearly met.` },
  ], { maxTokens: 2500, temperature: 0.2 });
  t.fit = { ...data, at: new Date().toISOString() };
  return putTarget(store, t);
}

const MESSAGE_TYPES = {
  referral: 'a LinkedIn referral request to an engineer at the company (not HR), under 90 words',
  recruiter: 'a reply to a recruiter who reached out, confirming interest, notice period and asking for the JD and process, under 90 words',
  followup: 'a polite follow-up on an application with no response for a week, under 80 words',
  thanks: 'a thank-you note after the interview that recalls one specific topic discussed, under 100 words',
  counter: 'a warm, firm salary counter-offer email that cites the role scope and market data, under 140 words',
  post: 'a LinkedIn post about a project he built, specific and humble, under 180 words, no hashtags spam',
};

export async function message(store, { id, type, name, extra }) {
  const p = await getProfile(store);
  const t = id ? await getTarget(store, id) : null;
  const what = MESSAGE_TYPES[type];
  if (!what) throw new Error('Unknown message type.');
  const { text } = await chat('light', [
    { role: 'system', content: `You write short, confident, human messages for an Indian software engineer. No emojis, no "I hope this finds you well", no buzzwords. ${RULES}` },
    { role: 'user', content: `Write ${what}.\nRecipient: ${name || 'unknown, use a neutral greeting'}\nCompany: ${t?.company ?? ''}\nRole: ${t?.role ?? ''}\nExtra context: ${extra || 'none'}\n${t?.research ? `Research:\n${clip(researchContext(t), 3000)}\n` : ''}${t?.fit?.referralAngle ? `Hook: ${t.fit.referralAngle}\n` : ''}\nPROFILE:\n${clip(profileContext(p), 5000)}\n\nOutput only the message.` },
  ], { maxTokens: 700, temperature: 0.6 });
  if (t) { t.messages = [{ type, text, at: new Date().toISOString() }, ...arr(t.messages)].slice(0, 20); await putTarget(store, t); }
  return { text };
}

export async function tailorCopy(store, ctx, { id, from }) {
  const t = await getTarget(store, id);
  const file = await ctx.createResume({ from, role: t.role, company: t.company });
  t.resumeFile = file;
  await putTarget(store, t);
  return { file };
}

// ---------- Mock interview ----------

export async function mock(store, { id, round, history = [], action }) {
  const t = await getTarget(store, id);
  const p = await getProfile(store);
  const turns = arr(history).slice(-20).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: clip(h.content, 4000) }));
  const base = `You are the interviewer for ${t.company}, ${round || 'technical'} round, for the role ${t.role}. Behave like a real interviewer at this company would, based on the research. Ask ONE question at a time. Mix: core questions for this round, follow-ups that dig into what he just said, and at most one curveball.
${RULES}
RESEARCH:\n${clip(researchContext(t), 5000)}\nCANDIDATE PROFILE (what he can truthfully claim):\n${clip(profileContext(p), 6000)}`;
  if (action === 'report') {
    const { data } = await chatJson('smart', [
      { role: 'system', content: base },
      ...turns,
      { role: 'user', content: 'The interview is over. Write the debrief. JSON: {"overall":0-10,"hireSignal":"strong no|no|lean no|lean yes|yes|strong yes","summary":"","strengths":["..."],"weakSpots":[{"topic":"","evidence":"what he said","fix":"exactly what to practise"}],"bestAnswer":"","worstAnswer":"","nextDrills":["3 drills for the next 2 days"]}' },
    ], { maxTokens: 2500, temperature: 0.2 });
    t.mocks = [{ round, at: new Date().toISOString(), report: data, turns: turns.length }, ...arr(t.mocks)].slice(0, 20);
    await putTarget(store, t);
    return { report: data };
  }
  const instruction = turns.length
    ? 'Evaluate the candidate\'s last answer, then ask the next question. JSON: {"score":1-5,"strong":"one line","missing":"one or two lines","better":"how a strong candidate would answer, in his voice, max 6 lines, using only his real facts","next":"the next interview question"}'
    : 'Start the interview: greet briefly as the interviewer and ask the first question. JSON: {"next":"greeting + first question"}';
  const { data } = await chatJson('fast', [{ role: 'system', content: base }, ...turns, { role: 'user', content: instruction }], { maxTokens: 1500, temperature: 0.5 });
  return data;
}

// ---------- Explain trainer ----------

export async function explain(store, { topic, kind, explanation, history = [], targetId }) {
  const p = await getProfile(store);
  const t = targetId ? await getTarget(store, targetId).catch(() => null) : null;
  if (String(explanation ?? '').trim().length < 20) throw new Error('Say or type a fuller explanation first (a few sentences).');
  const turns = arr(history).slice(-12).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: clip(h.content, 3000) }));
  const { data } = await chatJson('fast', [
    { role: 'system', content: `You coach a software engineer to explain things clearly in interviews. Be direct and specific. Judge the explanation like a senior interviewer${t ? ` at ${t.company} for ${t.role}` : ''}. ${RULES}\nCANDIDATE PROFILE:\n${clip(profileContext(p, { full: kind === 'project' }), 7000)}` },
    ...turns,
    { role: 'user', content: `Topic (${kind === 'project' ? 'his project' : 'concept'}): ${topic}\nHis explanation (transcribed speech, ignore filler words):\n"""${clip(explanation, 5000)}"""

Return JSON:
{"scores":{"clarity":1-5,"structure":1-5,"depth":1-5,"accuracy":1-5,"impact":1-5},"overall":1-10,"verdict":"one honest sentence","strong":["..."],"fix":["specific, actionable"],"missing":["what an interviewer expected to hear"],"wrong":["anything technically incorrect, or empty"],"tighter":"his explanation rewritten in his own voice, 90-150 words, only true facts","followUp":"the next question an interviewer would ask about this"}` },
  ], { maxTokens: 2200, temperature: 0.3 });
  return data;
}

// ---------- Ask anything (intent → searches → sourced answer) ----------

export async function ask(store, { question, targetId }) {
  const q = clip(question, 1000).trim();
  if (q.length < 5) throw new Error('Ask a fuller question.');
  const p = await getProfile(store);
  const t = targetId ? await getTarget(store, targetId).catch(() => null) : null;
  const ctxLine = `Candidate: ${p.headline || ''}; ${p.years || ''}; ${p.location || 'India'}; current CTC ${p.currentCtc || 'unknown'}; target ${p.targetCtc || 'unknown'}.${t ? ` Currently targeting ${t.company} for ${t.role}.` : ''}`;
  const { data: plan } = await chatJson('light', [
    { role: 'system', content: 'You turn a job-seeker\'s question into precise web searches. Output only JSON.' },
    { role: 'user', content: `${ctxLine}\nToday: ${today()}\nQuestion: ${q}\nReturn {"intent":"what he really wants to know, one line","queries":["1-3 specific Google-style searches with company, role, location, year where useful"],"needsWeb":true|false}` },
  ], { maxTokens: 400, temperature: 0.2 });
  const queries = arr(plan.queries).slice(0, 3);
  const searches = [];
  if (plan.needsWeb !== false) {
    for (const [i, query] of queries.entries()) {
      try { searches.push({ key: `q${i + 1}`, ...(await search(query)) }); }
      catch (err) { searches.push({ key: `q${i + 1}`, query, answer: '', sources: [], error: err.message }); }
    }
  }
  const merged = mergeSources(searches);
  const { text } = await chat('smart', [
    { role: 'system', content: `You are a career mentor for an Indian software engineer. Answer what he really needs, then give 1-3 concrete next steps. ${RULES}` },
    { role: 'user', content: `${ctxLine}\nHis intent: ${plan.intent}\nQuestion: ${q}\n\nRESEARCH:\n${clip(merged.text, 20000) || '(no web search needed)'}\n\nPROFILE:\n${clip(profileContext(p), 5000)}\n\nAnswer in under 250 words with [S#] citations for every company or market fact. End with "Next steps:" and a short list.` },
  ], { maxTokens: 1500, temperature: 0.2 });
  return { intent: plan.intent, queries, answer: text, sources: merged.sources };
}

// ---------- Offers ----------

export async function offers(store, { offers: list, notes }) {
  const p = await getProfile(store);
  const targets = await index(store);
  const ctx = [];
  for (const o of arr(list).slice(0, 6)) {
    const match = targets.find(x => x.company.toLowerCase() === String(o.company ?? '').toLowerCase());
    if (match) { const t = await getTarget(store, match.id).catch(() => null); if (t?.research?.salary) ctx.push(`${t.company} researched pay: ${t.research.salary.range} (${t.research.salary.basis})`); }
  }
  const { data } = await chatJson('smart', [
    { role: 'system', content: `You are a sharp, honest offer-negotiation advisor for Indian tech hiring. Use only the given numbers and research. ${RULES}\nOutput only JSON.` },
    { role: 'user', content: `Offers:\n${JSON.stringify(list, null, 1)}\nNotes: ${notes || 'none'}\nResearch:\n${ctx.join('\n') || 'none'}\nProfile: current CTC ${p.currentCtc || 'unknown'}, target ${p.targetCtc || 'unknown'}, notice ${p.noticePeriod || 'unknown'}.

Return JSON: {"comparison":[{"company":"","fixedLpa":0,"inHandMonthlyApprox":"rough estimate with assumptions","pros":["..."],"cons":["..."]}],"recommendation":"","negotiate":[{"company":"","ask":"what to ask for and why it's justified","script":"exact words to say on the call"}],"watchOuts":["bond, variable pay, joining date, notice buyout"]}` },
  ], { maxTokens: 3000, temperature: 0.2 });
  return data;
}

// ---------- Sprint + mentor ----------

export const getSprint = store => store.get('sprint', null);
export async function saveSprint(store, state) {
  if (!state || typeof state !== 'object') throw new Error('Nothing to save.');
  const s = JSON.stringify(state);
  if (s.length > 400_000) throw new Error('Sprint data is too large to save.');
  await store.put('sprint', state);
  return { ok: true };
}

export async function mentor(store, { history = [], context = '', mode = 'talk' }) {
  const p = await getProfile(store);
  const targets = (await index(store)).slice(0, 8).map(t => `${t.company} (${t.role}, ${t.stage}${t.interviewDate ? `, interview ${t.interviewDate}` : ''})`).join('; ');
  const turns = arr(history).slice(-16).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: clip(h.content, 3000) }));
  if (!turns.length || turns.at(-1).role !== 'user') throw new Error('Say something first.');
  const { text, model } = await chat('fast', [
    { role: 'system', content: `You are ${p.name || 'the candidate'}'s job-switch mentor. Talk like a sharp senior engineer friend from Chennai: direct, warm, casual, never cheesy. Confidence must come from evidence: his real projects and progress numbers. Never invent experience or promise outcomes. If he's low, acknowledge in one line, then one concrete action under 30 minutes. Under 170 words unless asked. Plain text.
${mode !== 'talk' ? `Run a mock on ${mode}: one question at a time; after each answer give Score n/5, Strong, Missing, a model answer (max 6 lines), then the next question.` : ''}
PROFILE:\n${clip(profileContext(p), 6000)}\nTARGETS: ${targets || 'none yet'}\nSPRINT STATUS:\n${clip(context, 4000)}` },
    ...turns,
  ], { maxTokens: 900, temperature: 0.6 });
  return { text, model };
}
