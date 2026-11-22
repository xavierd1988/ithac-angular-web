// Garage — robot speed gauge + speed controls inside each robot card (Robots tab). Claude 22/11/2026.
// Data comes from garage.js (GET /api/monitor/robots). Changes: POST /api/admin/robots/{session}/tuning
// with the admin key kept in this browser only (localStorage "ithacAdminToken").
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
  const drafts = new Map(); // session -> seconds chosen but not saved yet (survives the 60 s refresh)

  function token() {
    try { return localStorage.getItem('ithacAdminToken') || ''; } catch { return ''; }
  }
  function intervalOf(robot, data) {
    return Number(robot.min_interval_seconds) > 0 ? Number(robot.min_interval_seconds) : Number(data?.defaultIntervalSeconds || 15);
  }

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
          <small>${n(robot.posts_1h)} new posts in the last hour</small></div>
      </div>`;
  }

  function controls(robot, data) {
    const saved = intervalOf(robot, data);
    const chosen = drafts.get(robot.session_name) ?? saved;
    return `
      <div class="robot-tuning" data-session="${esc(robot.session_name)}" data-saved="${saved}">
        <div class="robot-tuning-head"><span>Speed</span><em>1 read every <output>${chosen}</output> s · max ${n(Math.round(3600 / chosen))}/h</em></div>
        <div class="tuning-presets">
          ${PRESETS.map((p) => `<button type="button" class="tuning-preset${p.seconds === chosen ? ' active' : ''}" data-seconds="${p.seconds}" title="${esc(p.note)}">${esc(p.name)}<small>${p.seconds} s</small></button>`).join('')}
        </div>
        <input class="tuning-range" type="range" min="5" max="120" step="1" value="${chosen}" aria-label="Seconds between two reads">
        <div class="tuning-actions"${chosen === saved ? ' hidden' : ''}>
          <button type="button" class="tuning-save">Apply</button>
          <button type="button" class="tuning-cancel">Cancel</button>
        </div>
        <span class="tuning-status" role="status"></span>
      </div>`;
  }

  // Called by garage.js for each working robot.
  window.ithacRobotGauge = (robot, data) => gauge(robot, data) + controls(robot, data);

  function setChosen(box, seconds) {
    drafts.set(box.dataset.session, seconds);
    box.querySelector('output').textContent = seconds;
    box.querySelector('.robot-tuning-head em').innerHTML = `1 read every <output>${seconds}</output> s · max ${n(Math.round(3600 / seconds))}/h`;
    box.querySelector('.tuning-range').value = seconds;
    box.querySelectorAll('.tuning-preset').forEach((b) => b.classList.toggle('active', Number(b.dataset.seconds) === seconds));
    const dirty = seconds !== Number(box.dataset.saved);
    box.querySelector('.tuning-actions').hidden = !dirty;
    if (!dirty) drafts.delete(box.dataset.session);
  }

  async function save(box) {
    const status = box.querySelector('.tuning-status');
    const seconds = Number(box.querySelector('.tuning-range').value);
    if (!token()) { status.textContent = 'Add the admin key (top of this tab) to change speeds.'; return; }
    if (typeof window.ithacApiUrl !== 'function') { status.textContent = 'API not ready, try again.'; return; }
    status.textContent = 'Saving…';
    try {
      const response = await fetch(window.ithacApiUrl(`/api/admin/robots/${encodeURIComponent(box.dataset.session)}/tuning`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ithac-Admin-Token': token() },
        body: JSON.stringify({ minIntervalSeconds: seconds })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.title || `HTTP ${response.status}`);
      drafts.delete(box.dataset.session);
      status.textContent = 'Saved.';
      if (typeof window.ithacReloadRobots === 'function') window.ithacReloadRobots();
    } catch (error) {
      status.textContent = `Not saved: ${error.message}`;
    }
  }

  function wire() {
    const grid = document.getElementById('robotsGrid');
    if (!grid || grid.dataset.tuningWired) return;
    grid.dataset.tuningWired = '1';
    grid.addEventListener('input', (event) => {
      const range = event.target.closest('.tuning-range');
      if (range) setChosen(range.closest('.robot-tuning'), Number(range.value));
    });
    grid.addEventListener('click', (event) => {
      const box = event.target.closest('.robot-tuning');
      if (!box) return;
      const preset = event.target.closest('.tuning-preset');
      if (preset) setChosen(box, Number(preset.dataset.seconds));
      if (event.target.closest('.tuning-cancel')) setChosen(box, Number(box.dataset.saved));
      if (event.target.closest('.tuning-save')) void save(box);
    });

    const keyInput = document.getElementById('tuningKey');
    const keyState = document.getElementById('tuningKeyState');
    const show = () => {
      if (keyState) keyState.textContent = token() ? 'Admin key saved in this browser: speeds can be changed.' : 'Viewing only. Paste the admin key once to change speeds.';
      const box = document.getElementById('tuningKeyBox');
      if (box) box.classList.toggle('has-key', !!token());
    };
    show();
    document.getElementById('tuningKeySave')?.addEventListener('click', () => {
      try { localStorage.setItem('ithacAdminToken', (keyInput?.value || '').trim()); } catch {}
      if (keyInput) keyInput.value = '';
      show();
    });
    document.getElementById('tuningKeyForget')?.addEventListener('click', () => {
      try { localStorage.removeItem('ithacAdminToken'); } catch {}
      show();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
