import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillRatings, readinessFactors, readiness } from '../lib/prep.mjs';

const day = 864e5;
test('skill ratings weight recent answers more and narrow with more answers', () => {
  const now = Date.UTC(2026, 9, 20);
  const ev = [
    { type: 'answer', skill: 'SQL', score: 40, at: new Date(now - 28 * day).toISOString() },
    { type: 'answer', skill: 'SQL', score: 80, at: new Date(now).toISOString() },
  ];
  const r = skillRatings(ev, now);
  assert.ok(r.SQL.rating > 60, `recent 80 should dominate, got ${r.SQL.rating}`);
  assert.equal(r.SQL.n, 2);
  assert.equal(r.SQL.plusMinus, 21);
  assert.equal(r.Python.rating, null);
  assert.equal(r.Python.plusMinus, 30);
});

test('readiness adds up factors and penalises a stale mock', () => {
  const t = { research: {}, fit: { score: 70 }, kit: { technical: { items: [{ q: 'a', answer: 'b' }, { q: 'c', answer: 'd' }] } }, practice: { 'tech-0': 'known' }, mocks: [{ at: new Date(Date.now() - 6 * day).toISOString(), report: { overall: 8 } }] };
  const f = readinessFactors(t);
  assert.equal(f.find(x => x.label.startsWith('No mock in')).points, -6);
  assert.equal(readiness(t), 15 + 10 + 5 + 13 + 24 - 6);
});
