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
  function score(row) {
    if (!row?.quality || !(number(row.quality.independentSampleCount) >= 1)) return NaN;
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
  function pct(value, signed) {
    const n = number(value);
    return Number.isFinite(n) ? `${signed && n > 0 ? '+' : ''}${n.toFixed(1)}%` : '–';
  }
  return Object.freeze({ number, score, label, period, report, pct });
});
