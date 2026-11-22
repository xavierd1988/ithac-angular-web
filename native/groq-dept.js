// Garage — Groq department: live AI provider state, pace, backlog, errors and Batch catch-up.
// Data: GET /api/monitor/groq (refreshed every 30 s while the tab is open). Claude 21/11/2026.
(() => {
  'use strict';

  const panel = document.getElementById('groqPanel');
  if (!panel) return;
  const el = (id) => document.getElementById(id);
  let timer = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (value) => Number(value || 0).toLocaleString('en-US');
  const usd = (value) => `$${Number(value || 0).toFixed(2)}`;
  const et = (value) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  function ago(value) {
    if (!value) return 'never';
    const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (s < 90) return `${Math.round(s)} s ago`;
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  function card(label, value, note, tone) {
    return `<div class="journal-card${tone ? ` groq-${tone}` : ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
  }

  function renderProvider(d) {
    const p = d.provider || {};
    const b = d.backlog || {};
    const recentWaiting = Number(b.recent_not_analyzed || 0);
    const lastOk = p.last_success_at ? (Date.now() - new Date(p.last_success_at).getTime()) / 60000 : Infinity;
    const limited = p.last_rate_limited_at && (Date.now() - new Date(p.last_rate_limited_at).getTime()) < 10 * 60000;
    const state = lastOk < 15 ? (limited ? 'warn' : 'good') : 'bad';
    const stateText = state === 'good' ? 'Working' : state === 'warn' ? 'Working, slowed by the quota' : 'No answer for a while';
    const freeTier = Number(p.limit_requests || 0) > 0 && Number(p.limit_requests) <= 1000;
    el('groqCards').innerHTML = [
      card('Groq status', stateText, `${p.model || 'model ?'} · last answer ${ago(p.last_success_at)}`, state),
      card('Quota left', p.remaining_requests != null ? `${n(p.remaining_requests)} / ${n(p.limit_requests)} req.` : '—',
        p.remaining_tokens != null ? `${n(p.remaining_tokens)} / ${n(p.limit_tokens)} tokens · ${freeTier ? 'free plan' : 'paid plan'}` : 'waits for the next request', freeTier ? 'warn' : ''),
      card('Recent posts waiting', n(recentWaiting), 'published in the last 48 h, not analyzed yet', recentWaiting < 200 ? 'good' : recentWaiting < 2000 ? 'warn' : 'bad'),
      card('Whole backlog', n(b.not_analyzed), `of ${n(b.posts_total)} posts · ${n(b.errors_waiting_retry)} errors to retry`),
      card('Since the last restart', `${n(p.successes_since_start)} answers`,
        `${n(p.rate_limited_since_start)} quota refusals (429) · ${n(p.errors_since_start)} errors · since ${et(p.started_at)} ET`),
      card('Results', `${n(b.signals_24h)} calls in 24 h`, `${n(b.analyzed_crypto)} crypto posts · ${n(b.analyzed_no_crypto)} without crypto in total`)
    ].join('');
    const notes = [];
    if (freeTier) notes.push('Groq is on the free plan (1,000 requests a day): live posts pile up and Batch catch-up is refused. Add a card on console.groq.com → Billing.');
    if (limited) notes.push(`Groq refused requests for quota at ${et(p.last_rate_limited_at)} ET; the worker waits and retries by itself.`);
    if (p.last_error) notes.push(`Last error (${ago(p.last_error_at)}): ${p.last_error.slice(0, 180)}`);
    el('groqNotes').innerHTML = notes.length ? notes.map((t) => `<li>${esc(t)}</li>`).join('') : '<li>Nothing to report.</li>';
  }

  function renderPace(d) {
    const byHour = new Map();
    for (const row of d.pace?.hourly || []) {
      const h = byHour.get(row.hour) || { complete: 0, no_crypto: 0, error: 0 };
      h[row.status] = (h[row.status] || 0) + Number(row.n || 0);
      byHour.set(row.hour, h);
    }
    const hours = [];
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 3600000).toISOString().slice(0, 13) + ':00:00Z';
      hours.push([t, byHour.get(t) || { complete: 0, no_crypto: 0, error: 0 }]);
    }
    const max = Math.max(1, ...hours.map(([, h]) => h.complete + h.no_crypto + h.error));
    const total = hours.reduce((s, [, h]) => s + h.complete + h.no_crypto, 0);
    const errors = hours.reduce((s, [, h]) => s + h.error, 0);
    el('groqPaceTotal').textContent = `${n(total)} posts analyzed in 24 h · ${n(errors)} errors`;
    el('groqBars').innerHTML = hours.map(([t, h]) => {
      const sum = h.complete + h.no_crypto + h.error;
      const label = `${new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric' })}: ${h.complete} crypto, ${h.no_crypto} without crypto, ${h.error} errors`;
      return `<div class="groq-bar" title="${esc(label)}" aria-label="${esc(label)}">
        <span class="groq-bar-error" style="height:${(h.error / max) * 100}%"></span>
        <span class="groq-bar-none" style="height:${(h.no_crypto / max) * 100}%"></span>
        <span class="groq-bar-crypto" style="height:${(h.complete / max) * 100}%"></span>
        ${sum === 0 ? '<span class="groq-bar-empty"></span>' : ''}</div>`;
    }).join('');
  }

  function renderBatches(d) {
    const t = d.batches?.totals || {};
    const items = d.batches?.items || [];
    el('groqBatchCards').innerHTML = [
      card('Batches', `${n(t.files)} files`, `${n(t.running)} running · ${n(t.waitingToSend)} waiting to be sent`),
      card('Requests', `${n(t.completed)} / ${n(t.requests)}`, `${n(t.failed)} failed · ${n(t.imported)} stored`),
      card('Calls found', n(t.signals), 'by the catch-up'),
      card('Real cost', usd(t.costUsd), 'batch price, measured on Groq answers')
    ].join('');
    const statusText = { exported: 'Waiting to send', validating: 'Checked by Groq', in_progress: 'Running', finalizing: 'Finishing',
      completed: 'Done, importing', imported: 'Done', failed: 'Failed', expired: 'Expired', expired_imported: 'Expired (partly done)', cancelled: 'Cancelled' };
    el('groqBatchRows').innerHTML = items.length ? items.map((b) => {
      const pct = b.requests ? Math.round((Number(b.completed || 0) / Number(b.requests)) * 100) : 0;
      return `<tr>
        <td>${esc(b.file_name)}</td>
        <td><span class="groq-status groq-status-${esc(b.status)}">${esc(statusText[b.status] || b.status)}</span>${b.last_error ? `<br><small>${esc(String(b.last_error).slice(0, 120))}</small>` : ''}</td>
        <td><div class="groq-progress"><span style="width:${pct}%"></span></div><small>${n(b.completed)} / ${n(b.requests)}</small></td>
        <td>${n(b.imported)}</td><td>${n(b.signals)}</td><td>${b.cost_usd ? usd(b.cost_usd) : '—'}</td>
        <td>${et(b.submitted_at)}</td><td>${et(b.finished_at)}</td></tr>`;
    }).join('') : '<tr><td colspan="8">No batch yet.</td></tr>';
  }

  function renderErrors(d) {
    const rows = d.recentErrors || [];
    el('groqErrors').innerHTML = rows.length ? rows.map((e) =>
      `<li><time>${esc(et(e.analyzed_at))}</time> @${esc(e.username)} — ${esc(String(e.error || '').replace(/^groq /, '').slice(0, 200))}</li>`).join('') : '<li>No recent error.</li>';
  }

  async function load() {
    try {
      if (typeof window.ithacGetJson !== 'function') throw new Error('API not ready');
      const d = await window.ithacGetJson('/api/monitor/groq');
      renderProvider(d);
      renderPace(d);
      renderBatches(d);
      renderErrors(d);
      el('groqUpdated').textContent = `Updated ${et(d.generatedAt)} ET · refreshes every 30 s`;
    } catch {
      el('groqUpdated').textContent = 'Groq data unavailable right now';
    }
  }

  function onRoute() {
    clearInterval(timer);
    if (!['#garage/analysis', '#garage/groq', '#garage/journal'].includes(location.hash)) return;
    const start = () => void load();
    if (typeof window.ithacGetJson === 'function') start(); else setTimeout(start, 1500);
    timer = setInterval(load, 30_000);
  }
  window.addEventListener('hashchange', onRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onRoute, { once: true });
  else onRoute();
})();
