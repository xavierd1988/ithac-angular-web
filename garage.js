(() => {
  'use strict';

  const SLOT_COUNT = 10;
  const sectionHashes = new Set(['#garage-live', '#garage-robots', '#garage-ranking', '#garage-simulator']);
  const main = document.querySelector('main.app-shell');
  const garage = document.getElementById('garageView');
  if (!main || !garage) return;

  const title = document.getElementById('garageTitle');
  const rankingTitle = document.title;
  const navLinks = garage.querySelectorAll('.garage-nav a');
  const simulator = document.getElementById('actionPanel');
  const rankingResults = document.getElementById('rankingResults');
  const grid = document.getElementById('robotsGrid');
  const summary = document.getElementById('robotsSummary');
  const freeSlots = document.getElementById('garageFreeSlots');
  const freeSummary = document.getElementById('garageFreeSummary');
  const freeGrid = document.getElementById('garageFreeGrid');
  const retired = document.getElementById('garageRetired');
  const retiredSummary = document.getElementById('garageRetiredSummary');
  const retiredGrid = document.getElementById('garageRetiredGrid');

  let latest = null;
  let robotCards = [];
  let returnLink = null;
  let lastScrollY = 0;
  let registryLoaded = false;

  function route({ moveFocus = true } = {}) {
    const hash = location.hash;
    const inGarage = hash === '#garage' || sectionHashes.has(hash);
    if (inGarage) {
      if (garage.hidden) {
        lastScrollY = window.scrollY;
        returnLink ??= document.activeElement?.closest('.garage-entry-link');
        main.hidden = true;
        garage.hidden = false;
        document.title = `Garage · ${rankingTitle}`;
        document.body.classList.add('in-garage');
        updateRobots();
      }
      navLinks.forEach((link) => {
        if (link.hash === hash) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      if (moveFocus) {
        if (hash === '#garage-simulator' && simulator) simulator.open = true;
        const destination = sectionHashes.has(hash) ? document.getElementById(hash.slice(1)) : title;
        destination?.focus({ preventScroll: true });
        if (hash === '#garage') window.scrollTo(0, 0);
        else destination?.scrollIntoView({ block: 'start' });
      }
      return;
    }

    const returning = !garage.hidden;
    if (returning) {
      garage.hidden = true;
      main.hidden = false;
      document.title = rankingTitle;
      document.body.classList.remove('in-garage');
    }
    if (moveFocus && hash === '#rankingResults') {
      rankingResults?.focus({ preventScroll: true });
      rankingResults?.scrollIntoView({ block: 'start' });
    } else if (moveFocus && returning) {
      (returnLink || rankingResults)?.focus({ preventScroll: true });
      window.scrollTo(0, lastScrollY);
    }
    if (returning) returnLink = null;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function timeAgo(value) {
    if (!value) return '';
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  function eastern(value, timeOnly = false) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return '';
    const options = timeOnly
      ? { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }
      : { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return `${date.toLocaleString('en-US', options)} ET`;
  }

  function robotStatus(session, busy) {
    if (!latest) return { key: 'checking', tone: 'pending', label: 'Checking status' };
    if (!session) return { key: 'pending', tone: 'pending', label: 'Waiting for login' };
    const health = String(session.health || '').toLowerCase();
    if (session.enabled && health === 'available') {
      return busy
        ? { key: 'scanning', tone: 'active', label: 'Scanning' }
        : { key: 'ready', tone: 'active', label: 'Ready' };
    }
    if (session.enabled && health === 'coolingdown') return { key: 'paused', tone: 'paused', label: 'Cooling down' };
    if (/brid|throttl|vieux posts|old posts/i.test(session.lastError || '')) {
      return { key: 'throttled', tone: 'throttled', label: 'Rate limited' };
    }
    return { key: 'offline', tone: 'offline', label: 'Offline' };
  }

  function settingsLine(entry, presets) {
    const preset = presets?.[entry.preset];
    if (!preset) return '';
    return `${escapeHtml(preset.label)}: ${escapeHtml(preset.postsPerPass)} posts and ${escapeHtml(preset.requestsPerPass)} request(s) per pass, ` +
      `at least ${escapeHtml(preset.minSecondsBetweenPasses)} s between passes, about ${escapeHtml(preset.approxRequestsPerMinute)} requests per minute ` +
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

  function avatar() {
    return '<div class="robot-avatar" aria-hidden="true"><span class="robot-eye"></span><span class="robot-eye"></span></div>';
  }

  function robotCard(robot, registry) {
    const identity = [robot.handle, robot.email].filter(Boolean).map(escapeHtml).join(' · ') || 'X account';
    const address = robot.address === 'server' ? (registry.serverAddress || 'Server address') : robot.address;
    const stats = robot.stats
      ? `<div><dt>Before ban</dt><dd>${Number(robot.stats.healthyPasses).toLocaleString()} passes · ${Number(robot.stats.newPostsBeforeBan).toLocaleString()} new posts · ${Number(robot.stats.minutesBeforeBan)} min</dd></div>`
      : '';
    const settings = (robot.settings || []).map((entry) => settingsLine(entry, registry.settingsPresets)).filter(Boolean);
    return `
      <article class="robot-card robot-pending">
        ${avatar()}
        <div class="robot-body">
          <div class="robot-title"><h3 class="robot-id">${escapeHtml(robot.id)}</h3><span class="robot-pill">Checking status</span></div>
          <p class="robot-activity">Waiting for live data</p>
          <details class="robot-details">
            <summary>Details<span class="visually-hidden"> for ${escapeHtml(robot.id)}</span></summary>
            <div class="robot-detail-content">
              <p class="robot-identity">${identity}</p>
              <dl>
                ${address ? `<div><dt>Address</dt><dd>${escapeHtml(address)}</dd></div>` : ''}
                <div><dt>Reads today</dt><dd data-robot-reads>–</dd></div>
                ${stats}
              </dl>
              ${settings.length ? `<h4 class="robot-detail-heading">Settings</h4><ul class="robot-settings">${settings.map((line) => `<li>${line}</li>`).join('')}</ul>` : ''}
              ${robot.events?.length ? `<h4 class="robot-detail-heading">History</h4>${timeline(robot.events)}` : ''}
            </div>
          </details>
        </div>
      </article>`;
  }

  function retiredCard(robot) {
    return `
      <article class="robot-card robot-legacy">
        ${avatar()}
        <div class="robot-body">
          <div class="robot-title"><h3 class="robot-id">${escapeHtml(robot.id)}</h3><span class="robot-pill">Retired</span></div>
          <p class="robot-activity">${escapeHtml(robot.label)}</p>
          <details class="robot-details">
            <summary>Details<span class="visually-hidden"> for ${escapeHtml(robot.id)}</span></summary>
            <div class="robot-detail-content">
              <dl>
                <div><dt>Active</dt><dd>${escapeHtml(robot.period)}</dd></div>
                <div><dt>Passes</dt><dd>${Number(robot.passes).toLocaleString()}</dd></div>
                <div><dt>Posts stored</dt><dd>${Number(robot.newPosts).toLocaleString()}</dd></div>
              </dl>
              ${robot.events?.length ? `<h4 class="robot-detail-heading">History</h4>${timeline(robot.events)}` : ''}
            </div>
          </details>
        </div>
      </article>`;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function updateRobots() {
    if (!registryLoaded) return;
    const sessions = new Map((latest?.sessions || []).map((session) => [session.name, session]));
    const working = new Map();
    for (const job of latest?.jobs || []) {
      if (String(job.status || '').toLowerCase() === 'running' && job.sessionName) {
        working.set(job.sessionName, job.username);
      }
    }

    const counts = {};
    for (const card of robotCards) {
      const session = sessions.get(card.robot.session);
      const busy = working.get(card.robot.session);
      const status = robotStatus(session, busy);
      if (card.tone !== status.tone) {
        card.node.classList.replace(`robot-${card.tone}`, `robot-${status.tone}`);
        card.tone = status.tone;
      }
      const retry = eastern(session?.cooldownUntil, true);
      const lastRead = timeAgo(session?.lastUsedAt);
      let activity = latest ? 'Not connected yet' : 'Waiting for live data';
      if (session) {
        if (status.key === 'scanning') activity = `Reading @${String(busy).replace(/^@/, '')}`;
        else if (status.key === 'paused' && retry) activity = `Retry after ${retry}`;
        else activity = lastRead ? `Last read ${lastRead}` : 'No reads yet';
      }
      setText(card.pill, status.label);
      setText(card.activity, activity);
      setText(card.reads, session ? Number(session.dailyJobCount || 0).toLocaleString() : '–');
      counts[status.key] = (counts[status.key] || 0) + 1;
    }

    const labels = [['scanning', 'scanning'], ['ready', 'ready'], ['paused', 'cooling down'],
      ['throttled', 'rate limited'], ['offline', 'offline'], ['pending', 'waiting for login']];
    const statuses = labels.filter(([key]) => counts[key]).map(([key, label]) => `${counts[key]} ${label}`);
    const configured = `${robotCards.length} configured`;
    if (!robotCards.length) setText(summary, 'No robots configured');
    else if (!latest) setText(summary, `${configured} · Waiting for live data`);
    else setText(summary, [configured, ...statuses].join(' · '));
  }

  function renderRegistry(registry) {
    const robots = registry.robots.slice(0, SLOT_COUNT);
    const configured = new Set(robots.map((robot) => robot.id));
    const free = Array.from({ length: SLOT_COUNT }, (_, index) => `X${index + 1}`)
      .filter((id) => !configured.has(id));
    const legacy = registry.legacy || [];

    grid.innerHTML = robots.length ? robots.map((robot) => robotCard(robot, registry)).join('')
      : '<p class="robots-empty-state">No scraper robots have been added yet.</p>';
    robotCards = robots.map((robot, index) => {
      const node = grid.children[index];
      return { robot, node, tone: 'pending', pill: node.querySelector('.robot-pill'),
        activity: node.querySelector('.robot-activity'), reads: node.querySelector('[data-robot-reads]') };
    });
    if (freeSlots && freeSummary && freeGrid) {
      freeSlots.hidden = !free.length;
      setText(freeSummary, `Free slots (${free.length})`);
      freeGrid.innerHTML = free.map((id) => `
        <article class="robot-card robot-empty">
          <div class="robot-avatar" aria-hidden="true"></div>
          <div class="robot-body">
            <div class="robot-title"><h3 class="robot-id">${id}</h3><span class="robot-pill">Free</span></div>
            <p class="robot-activity">Waiting for an X account</p>
          </div>
        </article>`).join('');
    }
    if (retired && retiredSummary && retiredGrid) {
      retired.hidden = !legacy.length;
      setText(retiredSummary, `Retired robots (${legacy.length})`);
      retiredGrid.innerHTML = legacy.map(retiredCard).join('');
    }
    registryLoaded = true;
    updateRobots();
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('.garage-entry-link');
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) returnLink = link;
  });
  window.addEventListener('ithac:resources', (event) => {
    if (Array.isArray(event.detail?.sessions)) latest = event.detail;
    if (!garage.hidden) updateRobots();
  });
  window.addEventListener('ithac:show-ranking', () => {
    if (garage.hidden) return;
    history.pushState(history.state, '', '#rankingResults');
    route({ moveFocus: false });
  });
  window.addEventListener('hashchange', () => route());
  route({ moveFocus: location.hash !== '#garage' });

  grid.setAttribute('aria-busy', 'true');
  fetch('./robots.json?v=20261121-history', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('Robot records unavailable');
      return response.json();
    })
    .then((registry) => {
      if (!Array.isArray(registry?.robots)) throw new Error('Invalid robot records');
      renderRegistry(registry);
    })
    .catch(() => {
      setText(summary, 'Unable to load robot records');
      grid.innerHTML = '<p class="robots-empty-state">Reload the page to try again.</p>';
    })
    .finally(() => grid.setAttribute('aria-busy', 'false'));
})();
