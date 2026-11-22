(function (root, factory) {
  const grading = factory();
  if (typeof module === 'object' && module.exports) module.exports = grading;
  else root.IthacGrading = grading;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const periods = new Set(['all', '7d', '30d', '90d']);
  function number(value) {
    if (value == null || value === '' || typeof value === 'boolean') return NaN;
    const result = Number(value);
    return Number.isFinite(result) ? result : NaN;
  }
  // Graded calls of a ranking row. Every call with a result counts, repeats on one coin included.
  function calls(row) {
    const graded = number(row?.quality?.evaluableSignalCount);
    if (Number.isFinite(graded)) return graded;
    const scored = number(row?.scoredCount);
    return Number.isFinite(scored) ? scored : 0;
  }
  function score(row) {
    if (!row?.quality || !(calls(row) >= 1)) return NaN;
    return number(row.competitionScore);
  }
  function label(quality) {
    if (!quality) return 'Not rated';
    if (quality.status === 'ready') return 'Verified sample';
    if (quality.status === 'insufficient_sample') return 'Small sample';
    if (quality.status === 'data_uncertain') return 'Limited data';
    if (quality.status === 'recalculation_pending' || quality.status === 'legacy_unreviewed') return 'Awaiting review';
    if (quality.status === 'awaiting_horizon') return 'Awaiting end time';
    if (quality.status === 'no_eligible_calls') return 'No evaluable calls';
    return 'Awaiting evaluation';
  }
  function period(value) { return periods.has(value) ? value : 'all'; }
  function report(value, horizon, selectedPeriod) {
    if (!value || !Array.isArray(value.rankings) || !Array.isArray(value.unranked)) {
      throw new Error('Ranking quality data unavailable');
    }
    if (value.horizon !== horizon || value.period !== period(selectedPeriod)) {
      throw new Error('Ranking period does not match the selected period');
    }
    return value;
  }
  function detail(row, response) {
    const loaded = response != null;
    const ranking = loaded ? response.ranking : row;
    return {
      ranking,
      quality: loaded ? (response.quality || ranking?.quality) : row?.quality,
      explanation: loaded ? (response.explanation || ranking?.explanation) : row?.explanation,
      scored: loaded ? (Array.isArray(response.scored) ? response.scored : []) : (Array.isArray(row?.history) ? row.history : [])
    };
  }
  function pct(value, signed) {
    const n = number(value);
    if (!signed && n > 0 && n < 0.1) return '<0.1%';
    return Number.isFinite(n) ? `${signed && n > 0 ? '+' : ''}${n.toFixed(1)}%` : '–';
  }
  return Object.freeze({ number, calls, score, label, period, report, pct, detail });
});
