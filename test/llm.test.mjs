import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Budget, parseDuration, retryFromText, isDailyLimit, parseJson } from '../lib/llm.mjs';

test('parseDuration reads provider formats', () => {
  assert.equal(parseDuration('1m26.4s'), 86400);
  assert.equal(parseDuration('697ms'), 697);
  assert.equal(parseDuration('13m20.496s'), 800496);
  assert.equal(parseDuration('2h3m'), 7380000);
  assert.equal(parseDuration('45'), 45000);
  assert.equal(parseDuration(null), null);
});

test('retryFromText finds Groq and Gemini retry hints', () => {
  assert.equal(retryFromText('Please try again in 13m20.496s. Need more tokens?'), 800496);
  assert.equal(retryFromText('{"retryDelay": "37s"}'), 37000);
  assert.equal(retryFromText('nothing here'), null);
});

test('isDailyLimit spots per-day caps', () => {
  assert.ok(isDailyLimit('Rate limit reached ... on tokens per day (TPD): Limit 200000'));
  assert.ok(!isDailyLimit('Rate limit reached on requests per minute'));
});

test('rpm limit makes the budget wait for the oldest call to expire', () => {
  const t0 = 1_000_000;
  const b = new Budget('x', { rpm: 2 });
  b.record(10, 5, t0);
  b.record(10, 5, t0 + 1000);
  assert.equal(b.waitFor(0, t0 + 2000), 58000);
  assert.equal(b.waitFor(0, t0 + 60001), 0);
});

test('minGapMs spaces calls (Mistral 1 request/second)', () => {
  const b = new Budget('m', { minGapMs: 1100 });
  b.start(5000);
  assert.equal(b.waitFor(0, 5500), 600);
  assert.equal(b.waitFor(0, 6100), 0);
});

test('tpm limit counts tokens in the last minute', () => {
  const b = new Budget('t', { tpm: 1000 });
  b.record(900, 5, 0);
  assert.ok(b.waitFor(200, 1000) > 0);
  assert.equal(b.waitFor(50, 1000), 0);
});

test('cooldown and block are respected', () => {
  const b = new Budget('c', {});
  b.fail('Rate limited', 5000, 100);
  assert.equal(b.waitFor(0, 1100), 4000);
  b.block('plan allows 0', 10000, 200);
  assert.equal(b.snapshot(300).state, 'blocked');
});

test('Mistral headers with a zero limit block the model', () => {
  const b = new Budget('mistral:x', {});
  const h = new Headers({ 'x-ratelimit-limit-req-minute': '0', 'x-ratelimit-remaining-req-minute': '0' });
  b.readHeaders(h, 0);
  assert.ok(b.blocked);
});

test('Groq headers feed remaining tokens into waits', () => {
  const b = new Budget('groq:x', {});
  const h = new Headers({ 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '999', 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '100', 'x-ratelimit-reset-requests': '1m', 'x-ratelimit-reset-tokens': '2s' });
  b.readHeaders(h, 0);
  assert.equal(b.waitFor(500, 0), 2000);
  assert.equal(b.waitFor(50, 0), 0);
});

test('day limit waits until the next UTC midnight', () => {
  const now = Date.UTC(2026, 9, 11, 22, 0, 0);
  const b = new Budget('d', { rpd: 1 });
  b.record(1, 1, now);
  assert.equal(b.waitFor(0, now + 1000), Date.UTC(2026, 9, 12) - now - 1000);
});

test('parseJson handles fences and surrounding text', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Here you go: {"a":2} thanks'), { a: 2 });
  assert.equal(parseJson('nope'), null);
});
