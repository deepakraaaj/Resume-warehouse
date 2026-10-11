// Live check of every configured AI model and search provider, using the real keys in .env.local.
//   node --env-file=.env.local scripts/ai-smoke.mjs [--search]
import { status, probe } from '../lib/llm.mjs';
import { search } from '../lib/search.mjs';

const fmt = ms => (ms == null ? '-' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const st = await status();
for (const b of st.budgets) {
  if (b.id.startsWith('search:') || b.id.includes('whisper')) continue;
  const r = await probe(b.id);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${b.id.padEnd(34)} ${r.ok ? fmt(r.latencyMs) : r.error}`);
}
if (process.argv.includes('--search')) {
  try {
    const r = await search('Infosys interview process for experienced Python developer 2026', { fresh: true });
    console.log(`\nSEARCH via ${r.provider}: ${r.answer.slice(0, 300)}…`);
    for (const s of r.sources.slice(0, 5)) console.log(`  [${s.n}] ${s.site} ${s.url.slice(0, 90)}`);
  } catch (err) { console.log('SEARCH FAIL', err.message); }
}
console.log('\nSTATUS');
for (const b of (await status()).budgets) {
  const h = b.header ? ` live: ${b.header.remainingRequests ?? '?'}/${b.header.limitRequests ?? '?'} req, ${b.header.remainingTokens ?? '?'}/${b.header.limitTokens ?? '?'} tok` : '';
  console.log(`${b.state.padEnd(9)} ${b.id.padEnd(34)} day ${b.used.dayRequests} req${h}${b.lastError ? ` | ${b.lastError.message.slice(0, 90)}` : ''}`);
}
