(() => {
  'use strict';

  const ARMY_SIZE = 10;
  let registry = null;

  fetch('./robots.json?v=20261121-history', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => { registry = data; render(); })
    .catch(() => { registry = { robots: [], legacy: [] }; render(); });

  const main = document.querySelector('main.app-shell');
  const garage = document.getElementById('garageView');
  const grid = document.getElementById('robotsGrid');
  const summary = document.getElementById('robotsSummary');
  let latest = null;
  let lastScrollY = 0;

  function route() {
    const open = location.hash === '#garage';
    if (!main || !garage) return;
    if (open && garage.hidden) {
      lastScrollY = window.scrollY;
      main.hidden = true;
      garage.hidden = false;
      document.body.classList.add('in-garage');
      garage.classList.remove('garage-opening');
      void garage.offsetWidth; // restart the door animation
      garage.classList.add('garage-opening');
      window.scrollTo(0, 0);
      render();
    } else if (!open && !garage.hidden) {
      garage.hidden = true;
      main.hidden = false;
      document.body.classList.remove('in-garage');
      window.scrollTo(0, lastScrollY);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function timeAgo(value) {
    if (!value) return 'never';
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return 'unknown';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  function clock(value) {
    const d = new Date(value);
    return Number.isFinite(d.getTime())
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
  }

  function robotStatus(session) {
    if (!session) return { key: 'pending', label: 'Waiting for login' };
    const health = String(session.health || '').toLowerCase();
    const error = String(session.lastError || '');
    if (session.enabled && health === 'available') return { key: 'active', label: 'Active' };
    if (session.enabled && health === 'coolingdown') {
      const until = session.cooldownUntil ? ` until ${eastern(session.cooldownUntil, true)}` : '';
      return { key: 'paused', label: `Paused by X${until}` };
    }
    if (/brid|throttl|vieux posts|old posts/i.test(error)) return { key: 'throttled', label: 'Throttled by X' };
    return { key: 'offline', label: 'Offline' };
  }

  function eastern(value, timeOnly = false) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    const options = timeOnly
      ? { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }
      : { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return `${d.toLocaleString('en-US', options)} ET`;
  }

  function settingsLine(entry) {
    const preset = registry?.settingsPresets?.[entry.preset];
    if (!preset) return '';
    return `${escapeHtml(preset.label)}: ${preset.postsPerPass} posts / pass, ${escapeHtml(preset.requestsPerPass)} request(s) / pass, ` +
      `min ${preset.minSecondsBetweenPasses} s between passes, ~${escapeHtml(preset.approxRequestsPerMinute)} requests / min ` +
      `<span class="robot-since">since ${eastern(entry.from)}</span>`;
  }

  function timeline(events) {
    if (!events?.length) return '';
    return `<ol class="robot-timeline">${events.map((event) => `
      <li class="robot-event robot-event-${escapeHtml(event.type)}">
        <time datetime="${escapeHtml(event.at)}">${eastern(event.at)}</time>
        <span>${escapeHtml(event.text)}</span>
      </li>`).join('')}</ol>`;
  }

  function render() {
    if (!grid || !registry) return;
    const sessions = new Map((latest?.sessions || []).map((session) => [session.name, session]));
    const working = new Map();
    for (const job of latest?.jobs || []) {
      if (String(job.status || '').toLowerCase() === 'running' && job.sessionName) working.set(job.sessionName, job.username);
    }

    const robots = (registry.robots || []).slice(0, ARMY_SIZE);
    const cards = robots.map((robot) => {
      const session = sessions.get(robot.session);
      const status = robotStatus(session);
      const identity = [robot.handle, robot.email].filter(Boolean).map(escapeHtml).join(' · ') || 'X account';
      const address = robot.address === 'server' ? (registry.serverAddress || 'Server address') : robot.address;
      const busy = working.get(robot.session);
      const activity = !session ? 'Not connected yet'
        : busy ? `Reading @${escapeHtml(busy)} now`
        : `Last read ${timeAgo(session.lastUsedAt)}`;
      const stats = robot.stats
        ? `<div><dt>Before ban</dt><dd>${robot.stats.healthyPasses} passes · ${robot.stats.newPostsBeforeBan.toLocaleString()} new posts · ${robot.stats.minutesBeforeBan} min</dd></div>`
        : '';
      const settings = (robot.settings || []).map(settingsLine).filter(Boolean);
      return `
        <article class="robot-card robot-wide robot-${status.key}">
          <div class="robot-avatar" aria-hidden="true"><span class="robot-eye"></span><span class="robot-eye"></span></div>
          <div class="robot-body">
            <div class="robot-title"><strong>${escapeHtml(robot.id)}</strong><span class="robot-pill">${escapeHtml(status.label)}</span></div>
            <p class="robot-identity">${identity}</p>
            <dl>
              <div><dt>Address</dt><dd>${escapeHtml(address)}</dd></div>
              <div><dt>Reads today</dt><dd>${session ? Number(session.dailyJobCount || 0).toLocaleString() : '–'}</dd></div>
              ${stats}
            </dl>
            <p class="robot-activity">${activity}</p>
            ${settings.length ? `<details class="robot-details"><summary>Settings</summary><ul class="robot-settings">${settings.map((line) => `<li>${line}</li>`).join('')}</ul></details>` : ''}
            ${robot.events?.length ? `<details class="robot-details" open><summary>History</summary>${timeline(robot.events)}</details>` : ''}
          </div>
        </article>`;
    });

    for (let slot = robots.length; slot < ARMY_SIZE; slot++) {
      cards.push(`
        <article class="robot-card robot-empty" aria-label="Free robot slot">
          <div class="robot-avatar" aria-hidden="true"></div>
          <div class="robot-body">
            <div class="robot-title"><strong>X${slot + 1}</strong><span class="robot-pill">Free slot</span></div>
            <p class="robot-activity">Waiting for an X account</p>
          </div>
        </article>`);
    }

    const legacy = (registry.legacy || []).map((robot) => `
      <article class="robot-card robot-wide robot-legacy robot-throttled">
        <div class="robot-avatar" aria-hidden="true"><span class="robot-eye"></span><span class="robot-eye"></span></div>
        <div class="robot-body">
          <div class="robot-title"><strong>${escapeHtml(robot.id)}</strong><span class="robot-pill">Retired</span></div>
          <p class="robot-identity">${escapeHtml(robot.label)}</p>
          <dl>
            <div><dt>Active</dt><dd>${escapeHtml(robot.period)}</dd></div>
            <div><dt>Passes</dt><dd>${Number(robot.passes).toLocaleString()}</dd></div>
            <div><dt>Posts stored</dt><dd>${Number(robot.newPosts).toLocaleString()}</dd></div>
          </dl>
          <details class="robot-details"><summary>History</summary>${timeline(robot.events)}</details>
        </div>
      </article>`);

    grid.innerHTML = cards.join('') +
      (legacy.length ? `<h3 class="robots-legacy-title">Retired accounts (before November 2026)</h3>${legacy.join('')}` : '');

    const statuses = robots.map((robot) => robotStatus(sessions.get(robot.session)).key);
    const count = (key) => statuses.filter((value) => value === key).length;
    const parts = [`${count('active')} active`];
    if (count('paused')) parts.push(`${count('paused')} paused`);
    if (count('throttled')) parts.push(`${count('throttled')} throttled`);
    if (count('pending')) parts.push(`${count('pending')} waiting for login`);
    parts.push(`${robots.length}/${ARMY_SIZE} slots used`);
    summary.textContent = parts.join(' · ');
  }

  window.addEventListener('ithac:resources', (event) => {
    latest = event.detail || null;
    if (garage && !garage.hidden) render();
  });
  window.addEventListener('hashchange', route);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', route, { once: true });
  } else {
    route();
  }
})();
