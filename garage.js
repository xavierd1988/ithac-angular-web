(() => {
  'use strict';

  // Public, masked labels of the X accounts used by each robot (never the full handle).
  const ROBOT_ACCOUNTS = {
    session_02: 'Old account',
    session_04: '@Dinel…8079',
    session_05: '@XDine…0196',
    session_06: 'xavi…155 (Yahoo)',
    session_07: 'xavi…36 (Yahoo)'
  };
  // Proxies configured with no real proxy: the robot reads from the server's own address.
  const SERVER_ADDRESS_PROXIES = new Set(['proxy-us-04', 'proxy-us-05', 'proxy-us-06', 'proxy-us-07']);
  const ARMY_SIZE = 10;

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
    const health = String(session.health || '').toLowerCase();
    const error = String(session.lastError || '');
    if (session.enabled && health === 'available') return { key: 'active', label: 'Active' };
    if (session.enabled && health === 'coolingdown') {
      const until = session.cooldownUntil ? ` until ${clock(session.cooldownUntil)}` : '';
      return { key: 'paused', label: `Paused by X${until}` };
    }
    if (/brid|throttl|vieux posts|old posts/i.test(error)) return { key: 'throttled', label: 'Throttled by X' };
    return { key: 'offline', label: 'Offline' };
  }

  function isShown(session) {
    return session.enabled || Object.prototype.hasOwnProperty.call(ROBOT_ACCOUNTS, session.name);
  }

  function render() {
    if (!grid || !latest) return;
    const sessions = (latest.sessions || []).filter(isShown);
    const order = { active: 0, paused: 1, throttled: 2, offline: 3 };
    const robots = sessions
      .map((session) => ({ session, status: robotStatus(session) }))
      .sort((a, b) => order[a.status.key] - order[b.status.key] || a.session.name.localeCompare(b.session.name));
    const working = new Map();
    for (const job of latest.jobs || []) {
      if (String(job.status || '').toLowerCase() === 'running' && job.sessionName) {
        working.set(job.sessionName, job.username);
      }
    }

    const cards = robots.slice(0, ARMY_SIZE).map(({ session, status }, index) => {
      const account = ROBOT_ACCOUNTS[session.name] || 'X account';
      const address = SERVER_ADDRESS_PROXIES.has(session.assignedProxy)
        ? 'Server address'
        : (session.assignedProxy || 'No proxy');
      const busy = working.get(session.name);
      const activity = busy ? `Reading @${escapeHtml(busy)}` : `Last read ${timeAgo(session.lastUsedAt)}`;
      return `
        <article class="robot-card robot-${status.key}">
          <div class="robot-avatar" aria-hidden="true"><span class="robot-eye"></span><span class="robot-eye"></span></div>
          <div class="robot-body">
            <div class="robot-title"><strong>Robot ${index + 1}</strong><span class="robot-pill">${escapeHtml(status.label)}</span></div>
            <dl>
              <div><dt>X account</dt><dd>${escapeHtml(account)}</dd></div>
              <div><dt>Address</dt><dd>${escapeHtml(address)}</dd></div>
              <div><dt>Reads today</dt><dd>${Number(session.dailyJobCount || 0).toLocaleString()}</dd></div>
            </dl>
            <p class="robot-activity">${activity}</p>
          </div>
        </article>`;
    });

    for (let slot = cards.length; slot < ARMY_SIZE; slot++) {
      cards.push(`
        <article class="robot-card robot-empty" aria-label="Free robot slot">
          <div class="robot-avatar" aria-hidden="true"></div>
          <div class="robot-body">
            <div class="robot-title"><strong>Robot ${slot + 1}</strong><span class="robot-pill">Free slot</span></div>
            <p class="robot-activity">Waiting for an X account</p>
          </div>
        </article>`);
    }
    grid.innerHTML = cards.join('');

    const count = (key) => robots.filter((robot) => robot.status.key === key).length;
    const parts = [`${count('active')} active`];
    if (count('paused')) parts.push(`${count('paused')} paused`);
    if (count('throttled')) parts.push(`${count('throttled')} throttled`);
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
