// Garage — speed gauge on each robot + "Tuning" tab (pace of each X robot). Claude 22/11/2026.
// Reads GET /api/monitor/robots; writes POST /api/admin/robots/{session}/tuning with the admin key
// (kept only in this browser, localStorage "ithacAdminToken").
(() => {
  'use strict';

  const X_LIMIT_PER_HOUR = 187 * 4; // X answers 429 above ~187 timeline reads per 15 min per account
  const PRESETS = [
    { name: 'Gentle', seconds: 30, note: 'safest for the account' },
    { name: 'Normal', seconds: 15, note: 'default pace' },
    { name: 'Fast', seconds: 10, note: 'more posts, more risk' },
    { name: 'Turbo', seconds: 6, note: 'X may throttle the account' }
  ];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => Number(v || 0).toLocaleString('en-US');

  function intervalOf(robot, data) {
    return Number(robot.min_interval_seconds) > 0 ? Number(robot.min_interval_seconds) : Number(data?.defaultIntervalSeconds || 15);
  }

  // Half-circle gauge: needle = reads in the last hour; tick = maximum allowed by the setting; red zone = X limit.
  function gauge(robot, data) {
    const value = Number(robot.passes_1h || 0);
    const interval = intervalOf(robot, data);
    const cap = 3600 / interval;
    const max = X_LIMIT_PER_HOUR;
    const angle = (v) => Math.PI * (1 - Math.min(Math.max(v / max, 0), 1));
    const point = (v, r) => [60 + r * Math.cos(angle(v)), 60 - r * Math.sin(angle(v))];
    const arc = (from, to, color) => {
      const [x1, y1] = point(from, 48), [x2, y2] = point(to, 48);
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A48 48 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="9" fill="none"/>`;
    };
    const [nx, ny] = point(value, 40);
    const [tx1, ty1] = point(cap, 38), [tx2, ty2] = point(cap, 56);
    const zone = value >= max * 0.8 ? 'red' : value >= max * 0.5 ? 'orange' : 'green';
    return `
      <div class="speed-gauge speed-${zone}">
        <svg viewBox="0 0 120 70" role="img" aria-label="${n(value)} reads in the last hour">
          ${arc(0, max * 0.5, '#9fd3b0')}${arc(max * 0.5, max * 0.8, '#f0cf8a')}${arc(max * 0.8, max, '#eaa6a6')}
          <line x1="${tx1.toFixed(1)}" y1="${ty1.toFixed(1)}" x2="${tx2.toFixed(1)}" y2="${ty2.toFixed(1)}" stroke="#294882" stroke-width="2"/>
          <line x1="60" y1="60" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#1b263b" stroke-width="3" stroke-linecap="round"/>
          <circle cx="60" cy="60" r="4" fill="#1b263b"/>
        </svg>
        <div class="speed-text"><strong>${n(value)}</strong><span>reads / hour</span>
          <small>setting: 1 read every ${interval} s (max ${n(Math.round(cap))}/h) · ${n(robot.posts_1h)} new posts in 1 h</small></div>
      </div>`;
  }
  window.ithacRobotGauge = gauge;

  // ---------- Tuning tab ----------
  const panel = document.getElementById('tuningPanel');
  let data = null;
  let timer = null;

  function token() {
    try { return localStorage.getItem('ithacAdminToken') || ''; } catch { return ''; }
  }

  async function save(session, seconds, statusEl) {
    const key = token();
    if (!key) { statusEl.textContent = 'Enter the admin key above first.'; return; }
    if (typeof window.ithacApiUrl !== 'function') { statusEl.textContent = 'API not ready, try again in a moment.'; return; }
    statusEl.textContent = 'Saving…';
    try {
      const response = await fetch(window.ithacApiUrl(`/api/admin/robots/${encodeURIComponent(session)}/tuning`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ithac-Admin-Token': key },
        body: JSON.stringify({ minIntervalSeconds: seconds })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.title || `HTTP ${response.status}`);
      statusEl.textContent = seconds ? `Saved: 1 read every ${seconds} s at most.` : 'Saved: default pace.';
      await load();
    } catch (error) {
      statusEl.textContent = `Not saved: ${error.message}`;
    }
  }

  function render() {
    const list = document.getElementById('tuningRobots');
    if (!list || !data) return;
    const robots = (data.robots || []).filter((r) => r.status === 'alive' || r.status === 'testing')
      .sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { numeric: true }));
    list.innerHTML = robots.length ? robots.map((robot) => {
      const interval = intervalOf(robot, data);
      return `
        <article class="tuning-card" data-session="${esc(robot.session_name)}">
          <div class="tuning-head"><strong>${esc(robot.label)}</strong><span>${esc(robot.identity || '')}</span></div>
          ${gauge(robot, data)}
          <div class="tuning-presets">
            ${PRESETS.map((p) => `<button type="button" class="tuning-preset${p.seconds === interval ? ' active' : ''}" data-seconds="${p.seconds}" title="${esc(p.note)}">${esc(p.name)}<small>${p.seconds} s</small></button>`).join('')}
          </div>
          <label class="tuning-slider">Custom: 1 read every <output>${interval}</output> s
            <input type="range" min="5" max="120" step="1" value="${interval}">
          </label>
          <div class="tuning-actions">
            <button type="button" class="tuning-save">Save</button>
            <button type="button" class="tuning-reset">Default (${n(data.defaultIntervalSeconds)} s)</button>
            <span class="tuning-status" role="status"></span>
          </div>
        </article>`;
    }).join('') : '<p class="garage-note">No robot is working right now.</p>';
  }

  async function load() {
    try {
      if (typeof window.ithacGetJson !== 'function') throw new Error('API not ready');
      data = await window.ithacGetJson('/api/monitor/robots');
      render();
      const u = document.getElementById('tuningUpdated');
      if (u) u.textContent = `Updated ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`;
    } catch {
      const u = document.getElementById('tuningUpdated');
      if (u) u.textContent = 'Robot data unavailable right now';
    }
  }

  if (panel) {
    const keyInput = document.getElementById('tuningKey');
    const keyState = document.getElementById('tuningKeyState');
    const showKeyState = () => { if (keyState) keyState.textContent = token() ? 'Admin key saved in this browser.' : 'No admin key yet: settings can be viewed, not changed.'; };
    showKeyState();
    document.getElementById('tuningKeySave')?.addEventListener('click', () => {
      try { localStorage.setItem('ithacAdminToken', (keyInput?.value || '').trim()); } catch {}
      if (keyInput) keyInput.value = '';
      showKeyState();
    });
    panel.addEventListener('input', (event) => {
      const slider = event.target.closest('.tuning-slider input');
      if (slider) slider.closest('.tuning-slider').querySelector('output').textContent = slider.value;
    });
    panel.addEventListener('click', (event) => {
      const card = event.target.closest('.tuning-card');
      if (!card) return;
      const session = card.dataset.session;
      const status = card.querySelector('.tuning-status');
      const preset = event.target.closest('.tuning-preset');
      if (preset) {
        card.querySelectorAll('.tuning-preset').forEach((b) => b.classList.toggle('active', b === preset));
        const slider = card.querySelector('.tuning-slider input');
        slider.value = preset.dataset.seconds;
        card.querySelector('.tuning-slider output').textContent = preset.dataset.seconds;
        return;
      }
      if (event.target.closest('.tuning-save')) void save(session, Number(card.querySelector('.tuning-slider input').value), status);
      if (event.target.closest('.tuning-reset')) void save(session, null, status);
    });
  }

  function onRoute() {
    clearInterval(timer);
    if (location.hash !== '#garage/tuning') return;
    const start = () => void load();
    if (typeof window.ithacGetJson === 'function') start(); else setTimeout(start, 1500);
    timer = setInterval(load, 60_000);
  }
  window.addEventListener('hashchange', onRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onRoute, { once: true });
  else onRoute();
})();
