// Open-web search for research. Two free providers behind one call, each with its own budget:
//   Gemini grounding — a real Google search, answered by gemini-2.5-flash with numbered sources.
//   Tavily — a search API built for AI apps; returns page extracts (needs TAVILY_API_KEY, 1,000/month free).
// Results are cached for 7 days so preparing for the same company twice costs nothing.
import crypto from 'node:crypto';
import { budget, saveStatus, parseDuration, retryFromText, isDailyLimit } from './llm.mjs';
import { loadProviders, SEARCH_LIMITS } from './llm-config.mjs';
import { getStore } from './kv.mjs';

const CACHE_MS = 7 * 24 * 3600_000;
const MIN = 60_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Grounding links are Google redirects; follow one hop to show the real page address.
async function realUrl(uri) {
  if (!/grounding-api-redirect|vertexaisearch/.test(uri)) return uri;
  try {
    const res = await fetch(uri, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000) });
    return res.headers.get('location') || uri;
  } catch { return uri; }
}

async function gate(id) {
  const b = await budget(id);
  if (!b) return null;
  const wait = b.waitFor(0);
  if (wait > 4000) return { b, busy: wait };
  if (wait) await sleep(wait);
  return { b };
}

function failBudget(b, res, text) {
  const retry = parseDuration(res.headers.get('retry-after')) ?? retryFromText(text);
  if (res.status === 429) b.fail(isDailyLimit(text) || /quota/i.test(text) ? `Daily search quota used up. ${text.slice(0, 160)}` : `Rate limited. ${text.slice(0, 160)}`, retry ?? (isDailyLimit(text) || /quota/i.test(text) ? 6 * 60 * MIN : 30_000));
  else if (res.status === 401 || res.status === 403) b.block(`Search key rejected (${res.status}).`, 30 * MIN);
  else b.fail(`HTTP ${res.status}: ${text.slice(0, 160)}`, res.status >= 500 ? 30_000 : 0);
}

async function geminiSearch(query, instructions, retry = false) {
  const g = await gate('search:gemini-grounding');
  if (!g) return { skip: 'Gemini is not configured.' };
  if (g.busy) return { skip: `Google search is cooling down (${Math.ceil(g.busy / 1000)}s).` };
  const { b } = g;
  const { providers } = loadProviders();
  const model = SEARCH_LIMITS['search:gemini-grounding'].model;
  // Short search-style queries make Gemini actually search; the instructions say what to pull out.
  const prompt = `${retry ? 'You MUST use Google Search before answering. ' : ''}Search Google for: ${query}\n\nThen answer from the search results only. ${instructions ?? 'Be factual and specific. Include dates when sources give them. If sources disagree, say so. If nothing reliable is found, say "Not found".'}`;
  const started = Date.now();
  b.start(started);
  let res, text;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': providers.gemini.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1, maxOutputTokens: 1400 } }),
      signal: AbortSignal.timeout(40_000),
    });
    text = await res.text();
  } catch (err) {
    b.fail(`Network: ${err.message}`, 30_000);
    return { skip: 'Google search did not answer in time.' };
  }
  if (!res.ok) {
    failBudget(b, res, text);
    if (res.status === 429 && (isDailyLimit(text) || /quota/i.test(text))) (await budget(`gemini:${model}`))?.fail('Daily quota used up (shared with Google search).', 6 * 60 * MIN);
    return { skip: `Google search failed (${res.status}).` };
  }
  const data = JSON.parse(text);
  const cand = data.candidates?.[0];
  let answer = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('').trim();
  const meta = cand?.groundingMetadata ?? {};
  const chunks = meta.groundingChunks ?? [];
  b.record(data.usageMetadata?.totalTokenCount ?? 0, Date.now() - started);
  // An answer without search results is the model's memory, not research: retry once, then discard.
  if (!chunks.length) {
    if (!retry) return geminiSearch(query, instructions, true);
    return { skip: 'Google returned no sources for this search.', empty: true };
  }
  // Number the sources and insert [n] markers where Google says each sentence is supported.
  const supports = [...(meta.groundingSupports ?? [])].sort((a, b2) => (b2.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0));
  const bytes = Buffer.from(answer, 'utf8');
  let out = bytes;
  for (const s of supports) {
    const end = s.segment?.endIndex;
    const ids = (s.groundingChunkIndices ?? []).map(i => i + 1);
    if (end == null || !ids.length) continue;
    out = Buffer.concat([out.subarray(0, end), Buffer.from(` [${ids.join(',')}]`), out.subarray(end)]);
  }
  answer = out.toString('utf8');
  const sources = await Promise.all(chunks.map(async (c, i) => {
    const url = await realUrl(c.web?.uri ?? '');
    const host = hostOf(url);
    return { n: i + 1, title: c.web?.title || host, url, site: host && !host.includes('vertexaisearch') ? host : c.web?.title || host };
  }));
  return { provider: 'google', answer: answer || 'Not found', sources, queries: meta.webSearchQueries ?? [] };
}

async function tavilySearch(query, deep) {
  const g = await gate('search:tavily');
  if (!g) return { skip: 'Tavily is not configured.' };
  if (g.busy) return { skip: `Tavily is cooling down (${Math.ceil(g.busy / 1000)}s).` };
  const { b } = g;
  const started = Date.now();
  b.start(started);
  let res, text;
  try {
    res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, search_depth: deep ? 'advanced' : 'basic', max_results: deep ? 8 : 5, include_answer: 'advanced' }),
      signal: AbortSignal.timeout(40_000),
    });
    text = await res.text();
  } catch (err) {
    b.fail(`Network: ${err.message}`, 30_000);
    return { skip: 'Tavily did not answer in time.' };
  }
  if (!res.ok) { failBudget(b, res, text); return { skip: `Tavily failed (${res.status}).` }; }
  const data = JSON.parse(text);
  // Advanced searches cost 2 credits on Tavily's free plan.
  b.record(0, Date.now() - started);
  if (deep) b.month.requests++;
  const sources = (data.results ?? []).map((r, i) => ({ n: i + 1, title: r.title, url: r.url, site: hostOf(r.url), snippet: String(r.content ?? '').slice(0, 700), date: r.published_date ?? null }));
  return { provider: 'tavily', answer: data.answer ?? '', sources };
}

// Groq's built-in browser search: the model searches, opens pages, and answers. Sources come from the
// search results and the pages it opened (with their real text as extracts).
async function groqSearch(query, instructions) {
  const { providers } = loadProviders();
  if (!providers.groq) return { skip: 'Groq is not configured.' };
  let chosen = null, busyFor = Infinity;
  for (const model of SEARCH_LIMITS['search:groq'].models) {
    const b = await budget(`groq:${model}`);
    if (!b) continue;
    const wait = b.waitFor(5000);
    if (wait <= 4000) { chosen = { model, b, wait }; break; }
    busyFor = Math.min(busyFor, wait);
    // Groq's token-per-minute window frees up within a minute; waiting beats failing a research step.
    if (!chosen && wait <= 35_000 && (!chosen || wait < chosen.wait)) chosen = { model, b, wait, later: true };
  }
  if (chosen?.later) for (const model of SEARCH_LIMITS['search:groq'].models) {
    const b = await budget(`groq:${model}`);
    const wait = b?.waitFor(5000) ?? Infinity;
    if (wait < chosen.wait) chosen = { model, b, wait };
  }
  if (!chosen) return { skip: `Groq search is cooling down${Number.isFinite(busyFor) ? ` (${Math.ceil(busyFor / 1000)}s)` : ''}.` };
  const { model, b } = chosen;
  if (chosen.wait) await sleep(chosen.wait);
  const prompt = `Search the web for: ${query}\nOpen the 2-3 most relevant results. Then answer from those pages only. ${instructions ?? 'Be factual and specific. Include dates when sources give them. If sources disagree, say so. If nothing reliable is found, say "Not found".'}\nAfter each fact, name its source website in parentheses, like (glassdoor.co.in).`;
  const started = Date.now();
  b.start(started);
  let res, text;
  try {
    res = await fetch(`${providers.groq.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${providers.groq.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], tools: [{ type: 'browser_search' }], reasoning_effort: 'low', temperature: 0.1, max_completion_tokens: 1800 }),
      signal: AbortSignal.timeout(50_000),
    });
    text = await res.text();
  } catch (err) {
    b.fail(`Network: ${err.message}`, 30_000);
    return { skip: 'Groq search did not answer in time.' };
  }
  b.readHeaders(res.headers);
  if (!res.ok) { failBudget(b, res, text); return { skip: `Groq search failed (${res.status}).` }; }
  const data = JSON.parse(text);
  const msg = data.choices?.[0]?.message ?? {};
  b.record(data.usage?.total_tokens ?? 6000, Date.now() - started);
  const seen = new Map();
  const sources = [];
  const add = (r, snippet) => {
    const url = String(r.url ?? '');
    if (!/^https?:/.test(url)) return;
    if (seen.has(url)) { const s = sources[seen.get(url) - 1]; if (snippet && !s.snippet) s.snippet = snippet; return; }
    sources.push({ n: sources.length + 1, title: String(r.title ?? '').replace(/ - viewing lines.*$/, '') || hostOf(url), url, site: hostOf(url), snippet: snippet || '' });
    seen.set(url, sources.length);
  };
  // Opened pages first: their text is real evidence.
  for (const t of msg.executed_tools ?? []) if (t.type !== 'browser_search') for (const r of t.search_results?.results ?? []) add(r, String(r.content ?? '').replace(/L\d+: /g, '').replace(/\s+/g, ' ').slice(0, 900));
  for (const t of msg.executed_tools ?? []) if (t.type === 'browser_search') for (const r of t.search_results?.results ?? []) add(r, '');
  // Turn "(site.com)" mentions into [n] markers that point at the sources list.
  let answer = String(msg.content ?? '').replace(/【[^】]*】/g, '').trim();
  answer = answer.replace(/\(([a-z0-9.-]+\.[a-z]{2,})(?:[^)]*)\)/gi, (m, host) => {
    const s = sources.find(x => x.site === host.replace(/^www\./, '') || x.site.endsWith(host.replace(/^www\./, '')));
    return s ? `[${s.n}]` : m;
  });
  if (!sources.length) return { skip: 'Groq search returned no sources.', empty: true };
  return { provider: 'groq', answer, sources };
}

// search(query, {deep, instructions, fresh}) → {query, provider, answer, sources[], cachedAt, note}
export async function search(query, opts = {}) {
  const q = String(query ?? '').trim().slice(0, 400);
  if (q.length < 3) throw new Error('Search for something a little longer.');
  const store = await getStore();
  const key = `cache/search/${hash(`${opts.deep ? 'deep' : 'quick'}|${opts.instructions ?? ''}|${q.toLowerCase()}`)}`;
  if (!opts.fresh) {
    const hit = await store.get(key, null);
    if (hit && Date.now() - hit.cachedAt < CACHE_MS) return { ...hit, cached: true };
  }
  // Deep research prefers Tavily's page extracts; quick lookups prefer Google.
  const order = opts.deep
    ? [() => tavilySearch(q, true), () => groqSearch(q, opts.instructions), () => geminiSearch(q, opts.instructions)]
    : [() => geminiSearch(q, opts.instructions), () => groqSearch(q, opts.instructions), () => tavilySearch(q, false)];
  const skipped = [];
  for (const run of order) {
    const r = await run();
    if (r.skip) { skipped.push(r.skip); continue; }
    if (!r.sources?.length) { skipped.push(`${r.provider} found no sources.`); continue; }
    const result = { query: q, ...r, cachedAt: Date.now() };
    await store.put(key, result).catch(() => {});
    await saveStatus();
    return result;
  }
  await saveStatus(true);
  if (skipped.some(x => /no sources/.test(x))) return { query: q, provider: 'none', answer: 'No web sources found for this search.', sources: [], cachedAt: Date.now(), noSources: true };
  throw new Error(`Web search is unavailable right now. ${skipped.join(' ')}`.trim());
}
