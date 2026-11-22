const test = require('node:test');
const assert = require('node:assert/strict');
const grading = require('../grading-quality.js');

test('missing grades stay absent; genuine zero remains zero', () => {
  for (const value of [null, undefined, '', false]) assert.ok(Number.isNaN(grading.number(value)));
  const quality = { independentSampleCount: 6, status: 'ready' };
  assert.ok(Number.isNaN(grading.score({ competitionScore: null, averageScore: 89, quality })));
  assert.equal(grading.score({ competitionScore: 0, quality }), 0);
});
test('legacy scores and a zero independent sample cannot become ranking scores', () => {
  assert.ok(Number.isNaN(grading.score({ competitionScore: 95, averageScore: 99 })));
  assert.ok(Number.isNaN(grading.score({ competitionScore: 95, quality: {} })));
  assert.ok(Number.isNaN(grading.score({ competitionScore: 95, quality: { independentSampleCount: 0 } })));
});
test('a stale response cannot describe a newly selected horizon or publication period', () => {
  const response = { horizon: 'week', period: '30d', rankings: [], unranked: [] };
  assert.equal(grading.report(response, 'week', '30d'), response);
  assert.throws(() => grading.report(response, 'day', '30d'));
  assert.throws(() => grading.report(response, 'week', 'all'));
  assert.throws(() => grading.report([], 'week', 'all'));
});
test('unavailable metrics never look like a zero success rate', () => {
  assert.equal(grading.pct(null), '–');
  assert.equal(grading.pct(0), '0.0%');
  assert.equal(grading.pct(-1.52, true), '-1.5%');
});

test('a completed empty detail invalidates the older report and its scored history', () => {
  const row = { competitionScore: 93, quality: { independentSampleCount: 4 }, history: [{ score: 90 }] };
  const quality = { status: 'recalculation_pending', independentSampleCount: 0 };
  const current = grading.detail(row, { ranking: null, scored: [], quality });
  assert.equal(current.ranking, null);
  assert.deepEqual(current.scored, []);
  assert.equal(current.quality, quality);
  assert.ok(Number.isNaN(grading.score(current.ranking)));
  assert.equal(grading.detail(row, null).ranking, row);
});
