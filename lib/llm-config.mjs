// Which AI models the desk can use, the free-tier limits it plans around, and which models each kind of
// task prefers. Edit the numbers here; live headers from Groq and Mistral correct them while running.
//
// Keys and base URLs come from .env.local / Vercel env: LLM_<n>_URL, LLM_<n>_MODEL, LLM_<n>_KEY, and
// optionally LLM_<n>_EXTRA_MODELS (comma-separated) to add more free models from the same provider.

// Free-tier defaults. Gemini's were measured on this key on 11 Oct 2026 (2.5 Flash ran out after ~5-20 calls a day). Unknown values are null (not enforced).
// rpm/rpd = requests per minute/day, tpm/tpd = tokens per minute/day, minGapMs = spacing between calls.
export const MODEL_LIMITS = {
  'groq:openai/gpt-oss-120b': { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  'groq:openai/gpt-oss-20b': { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  'groq:qwen/qwen3.8-27b': { rpm: 30, rpd: 1000, tpm: 6000, tpd: 500000 },
  'groq:whisper-large-v3-turbo': { rpm: 20, rpd: 2000, audioSecondsPerDay: 28800 },
  'gemini:gemini-2.5-flash': { rpm: 5, rpd: 20, tpm: 250000 },
  'gemini:gemini-3.5-flash-lite': { rpm: 10, rpd: 100, tpm: 250000 },
  'mistral:mistral-small-latest': { rpm: 50, minGapMs: 1100, tpm: 500000 },
  'mistral:mistral-medium-latest': { rpm: 50, minGapMs: 1100, tpm: 500000 },
};
const FALLBACK_LIMITS = { rpm: 10, rpd: 500 };

// Extra free models tried from each provider when its key is configured.
export const EXTRA_MODELS = {
  groq: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  gemini: ['gemini-2.5-flash', 'gemini-3.5-flash-lite'],
  mistral: ['mistral-small-latest'],
};

// Search budgets. Gemini grounding is capped well under its reported free allowance (500–1,500/day).
export const SEARCH_LIMITS = {
  // Shares Gemini 2.5 Flash's small daily quota.
  'search:gemini-grounding': { rpm: 5, rpd: 18, model: 'gemini-2.5-flash' },
  // Groq's built-in browser search on gpt-oss models; uses those models' own budgets (1,000 requests/day each).
  'search:groq': { models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'] },
  'search:tavily': { rpm: 20, rpm_note: 'free plan', perMonth: 1000 },
};

// Task → models in preference order. Unconfigured or unavailable models are skipped.
export const TASKS = {
  // Live conversation: mock interviews, mentor chat, explain trainer.
  fast: ['groq:openai/gpt-oss-120b', 'gemini:gemini-3.5-flash-lite', 'mistral:mistral-small-latest', 'groq:qwen/qwen3.8-27b', 'groq:openai/gpt-oss-20b', 'gemini:gemini-2.5-flash'],
  // Careful analysis: research synthesis, prep kits, JD fit, profile extraction.
  smart: ['gemini:gemini-2.5-flash', 'groq:openai/gpt-oss-120b', 'mistral:mistral-small-latest', 'groq:qwen/qwen3.8-27b', 'gemini:gemini-3.5-flash-lite'],
  // Short helpers: messages, titles, small rewrites.
  light: ['gemini:gemini-3.5-flash-lite', 'mistral:mistral-small-latest', 'groq:openai/gpt-oss-20b', 'groq:qwen/qwen3.8-27b', 'groq:openai/gpt-oss-120b'],
};

export const TIMEOUT_MS = (Number(process.env.LLM_TIMEOUT) || 45) * 1000;

function kindOf(url) {
  const host = String(url ?? '');
  if (host.includes('groq.com')) return 'groq';
  if (host.includes('googleapis.com')) return 'gemini';
  if (host.includes('mistral.ai')) return 'mistral';
  return 'openai';
}

// Normalises a base URL to the OpenAI-compatible root each provider serves.
function baseUrlFor(kind, url) {
  const u = String(url).replace(/\/+$/, '');
  if (kind === 'groq' && !u.endsWith('/openai/v1')) return 'https://api.groq.com/openai/v1';
  if (kind === 'gemini' && !u.endsWith('/openai')) return 'https://generativelanguage.googleapis.com/v1beta/openai';
  if (kind === 'mistral' && !u.endsWith('/v1')) return 'https://api.mistral.ai/v1';
  return u;
}

// Reads LLM_1.., returns { providers: {kind: {kind, base, key}}, models: [{id, kind, model}] }.
export function loadProviders(env = process.env) {
  const providers = {};
  const models = [];
  const seen = new Set();
  const add = (kind, model) => {
    const id = `${kind}:${model}`;
    if (!model || seen.has(id)) return;
    seen.add(id);
    models.push({ id, kind, model, limits: { ...FALLBACK_LIMITS, ...(MODEL_LIMITS[id] ?? {}) } });
  };
  for (let n = 1; n <= 9; n++) {
    const url = env[`LLM_${n}_URL`], key = env[`LLM_${n}_KEY`];
    if (!url || !key) continue;
    const kind = kindOf(url);
    providers[kind] ??= { kind, base: baseUrlFor(kind, url), key };
    add(kind, env[`LLM_${n}_MODEL`]);
    for (const m of String(env[`LLM_${n}_EXTRA_MODELS`] ?? '').split(',').map(s => s.trim())) add(kind, m);
    for (const m of EXTRA_MODELS[kind] ?? []) add(kind, m);
  }
  return { providers, models };
}
