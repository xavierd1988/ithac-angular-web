(() => {
  'use strict';

  const ARMY_SIZE = 10;
  const SERVER_ADDRESS = 'Server address (178.105.42.115, no proxy)';
  let army = null;
  let armyTimer = null;

  window.ithacReloadRobots = () => void loadArmy();
  async function loadArmy() {
    try {
      if (typeof window.ithacGetJson !== 'function') throw new Error('API not ready');
      army = await window.ithacGetJson('/api/monitor/robots');
    } catch {
      army = army || { robots: [], events: [] };
    }
    render();
  }

  const main = document.querySelector('main.app-shell');
  const garage = document.getElementById('garageView');
  const grid = document.getElementById('robotsGrid');
  const summary = document.getElementById('robotsSummary');
  let latest = null;
  let lastScrollY = 0;

  const TABS = ['overview', 'robots', 'analysis', 'tools'];
  const TAB_ALIASES = { tuning: 'robots', journal: 'analysis', groq: 'analysis', activity: 'tools' };

  function currentTab() {
    const raw = location.hash.split('/')[1] || 'overview';
    const tab = TAB_ALIASES[raw] || raw;
    return TABS.includes(tab) ? tab : 'overview';
  }

  function showTab(tab) {
    for (const panel of garage.querySelectorAll('[data-tab-panel]')) {
      panel.hidden = panel.dataset.tabPanel !== tab;
    }
    for (const link of garage.querySelectorAll('.garage-tabs [data-tab]')) {
      const active = link.dataset.tab === tab;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }

  function route() {
    const open = location.hash.startsWith('#garage');
    if (!main || !garage) return;
    if (open) {
      if (garage.hidden) {
        lastScrollY = window.scrollY;
        main.hidden = true;
        garage.hidden = false;
        document.body.classList.add('in-garage');
        garage.classList.remove('garage-opening');
        void garage.offsetWidth; // restart the door animation
        garage.classList.add('garage-opening');
      }
      showTab(currentTab());
      window.scrollTo(0, 0);
      clearInterval(armyTimer);
      const start = () => void loadArmy();
      if (typeof window.ithacGetJson === 'function') start(); else setTimeout(start, 1500);
      armyTimer = setInterval(loadArmy, 60_000);
    } else if (!garage.hidden) {
      clearInterval(armyTimer);
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

  function eastern(value, timeOnly = false) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    const options = timeOnly
      ? { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }
      : { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return `${d.toLocaleString('en-US', options)} ET`;
  }

  function timeline(events) {
    if (!events?.length) return '';
    return `<ol class="robot-timeline">${events.map((event) => `
      <li class="robot-event robot-event-${escapeHtml(event.type)}">
        <time datetime="${escapeHtml(event.at)}">${eastern(event.at)}</time>
        <span>${escapeHtml(event.text)}</span>
      </li>`).join('')}</ol>`;
  }

  function duration(fromValue, toValue) {
    const ms = new Date(toValue).getTime() - new Date(fromValue).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '–';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`;
    return `${Math.round(h / 24)} days`;
  }

  function lifeStatus(robot) {
    const status = String(robot.status || '');
    if (status === 'alive') {
      const health = String(robot.health || '').toLowerCase();
      if (robot.enabled && health === 'coolingdown') {
        return { key: 'paused', label: `Paused by X${robot.cooldown_until ? ` until ${eastern(robot.cooldown_until, true)}` : ''}` };
      }
      return { key: 'active', label: 'Alive' };
    }
    if (status === 'testing') return { key: 'pending', label: 'Birth test…' };
    if (status === 'retired') return { key: 'throttled', label: 'Retired' };
    return { key: 'throttled', label: 'Dead' };
  }

  function robotCard(robot, events, working) {
    const status = lifeStatus(robot);
    const alive = robot.status === 'alive' || robot.status === 'testing';
    const address = robot.address === 'server' ? SERVER_ADDRESS : (robot.address === 'proxy' ? 'Proxy (June setup)' : robot.address || '–');
    const lifeRows = alive
      ? `<div><dt>Born</dt><dd>${eastern(robot.born_at)}</dd></div>
         <div><dt>Alive for</dt><dd>${duration(robot.born_at, new Date())}</dd></div>
         <div><dt>Reads since birth</dt><dd>${Number(robot.passes_since_birth || 0).toLocaleString()} · ${Number(robot.posts_since_birth || 0).toLocaleString()} new posts</dd></div>
         <div><dt>Reads today</dt><dd>${Number(robot.reads_today || 0).toLocaleString()}</dd></div>`
      : `<div><dt>Born</dt><dd>${eastern(robot.born_at)}</dd></div>
         <div><dt>Died</dt><dd>${robot.died_at ? eastern(robot.died_at) : '–'}</dd></div>
         <div><dt>Lived</dt><dd>${robot.died_at ? duration(robot.born_at, robot.died_at) : '–'}</dd></div>
         <div><dt>Work done</dt><dd>${robot.passes_alive != null ? `${Number(robot.passes_alive).toLocaleString()} reads · ${Number(robot.new_posts_alive || 0).toLocaleString()} new posts` : '–'}</dd></div>`;
    const busy = working.get(robot.session_name);
    const activity = robot.status === 'alive'
      ? (busy ? `Reading @${escapeHtml(busy)} now` : `Last read ${timeAgo(robot.last_used_at)}`)
      : robot.status === 'testing' ? 'Being tested on reference influencers'
      : escapeHtml(robot.death_reason || '');
    const last = events[events.length - 1];
    return `
      <article class="robot-card robot-wide robot-${status.key}">
        <div class="robot-avatar" aria-hidden="true"><span class="robot-eye"></span><span class="robot-eye"></span></div>
        <div class="robot-body">
          <div class="robot-title"><strong>${escapeHtml(robot.label)}</strong><span class="robot-pill">${escapeHtml(status.label)}</span></div>
          <p class="robot-identity">${escapeHtml(robot.identity || 'X account')}</p>
          <dl>
            <div><dt>Address</dt><dd>${escapeHtml(address)}</dd></div>
            ${lifeRows}
          </dl>
          ${robot.status === 'alive' && typeof window.ithacRobotGauge === 'function' ? window.ithacRobotGauge(robot, army) : ''}
          <p class="robot-activity">${activity}</p>
          ${last ? `<p class="robot-last"><span>Latest:</span> ${escapeHtml(last.text)} <time>${eastern(last.at)}</time></p>` : ''}
          ${events.length ? `<details class="robot-details"><summary>History (${events.length} events)</summary>${timeline(events)}</details>` : ''}
        </div>
      </article>`;
  }

  function render() {
    if (!grid || !army) return;
    const working = new Map();
    for (const job of latest?.jobs || []) {
      if (String(job.status || '').toLowerCase() === 'running' && job.sessionName) working.set(job.sessionName, job.username);
    }
    const eventsBy = new Map();
    for (const event of army.events || []) {
      if (!eventsBy.has(event.session_name)) eventsBy.set(event.session_name, []);
      eventsBy.get(event.session_name).push(event);
    }
    const number = (robot) => Number(String(robot.label).replace(/\D/g, '')) || 0;
    const all = army.robots || [];
    const army10 = all.filter((robot) => robot.status !== 'retired');
    const retired = all.filter((robot) => robot.status === 'retired');
    const order = { alive: 0, testing: 1, dead: 2 };
    army10.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || number(a) - number(b));

    const living = army10.filter((robot) => robot.status === 'alive' || robot.status === 'testing');
    const dead = army10.filter((robot) => robot.status === 'dead');
    const lives = dead.filter((robot) => robot.died_at).map((robot) => new Date(robot.died_at) - new Date(robot.born_at)).filter((ms) => ms > 0);
    const avg = lives.length ? duration(0, lives.reduce((a, b) => a + b, 0) / lives.length) : '–';
    const stats = `
      <div class="army-stats">
        <div><strong>${army10.length}</strong><span>robots born</span></div>
        <div><strong>${living.length}</strong><span>alive</span></div>
        <div><strong>${dead.length}</strong><span>dead</span></div>
        <div><strong>${avg}</strong><span>average life</span></div>
        <div><strong>${Math.max(0, ARMY_SIZE - living.length)}</strong><span>free places (target ${ARMY_SIZE})</span></div>
      </div>`;
    const addCard = `
      <article class="robot-card robot-empty robot-add">
        <div class="robot-avatar" aria-hidden="true"></div>
        <div class="robot-body">
          <div class="robot-title"><strong>New robot</strong><span class="robot-pill">${Math.max(0, ARMY_SIZE - living.length)} free</span></div>
          <p class="robot-activity">Create an X account, then open <code>ITHAC-Ajouter-un-robot.command</code> on the Mac and sign in. The robot is tested and put to work automatically.</p>
        </div>
      </article>`;
    const cards = army10.map((robot) => robotCard(robot, eventsBy.get(robot.session_name) || [], working));
    const legacy = retired.map((robot) => robotCard(robot, eventsBy.get(robot.session_name) || [], working));
    grid.innerHTML = stats + cards.join('') + addCard +
      (legacy.length ? `<h3 class="robots-legacy-title">Retired accounts (before November 2026)</h3>${legacy.join('')}` : '');
    summary.textContent = `${living.length} alive · ${dead.length} dead · pace set per robot in the Tuning tab`;
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

(() => {
  'use strict';

  const rowsEl = document.getElementById('journalRows');
  const summaryEl = document.getElementById('journalSummary');
  const updatedEl = document.getElementById('journalUpdated');
  const form = document.getElementById('journalFilters');
  const moreButton = document.getElementById('journalMore');
  const exportButton = document.getElementById('journalExport');
  const garage = document.getElementById('garageView');
  if (!rowsEl || !form || !garage) return;

  const PAGE = 50;
  let rows = [];
  let nextBeforeId = null;
  let robotsBySession = {};
  let summaryTimer = null;
  let loading = false;

  fetch('./robots.json?v=20261121-journal', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      for (const robot of [...(data?.robots || []), ...(data?.legacy || [])]) robotsBySession[robot.session] = robot.id;
      if (rows.length) renderRows();
    })
    .catch(() => {});

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const et = (value) => {
    if (!value) return '–';
    const d = new Date(value);
    return Number.isFinite(d.getTime())
      ? d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '–';
  };
  const price = (value) => {
    if (value === null || value === undefined) return '–';
    const n = Number(value);
    if (!Number.isFinite(n)) return '–';
    const digits = n >= 100 ? 2 : n >= 1 ? 4 : 8;
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;
  };
  const minutes = (value) => {
    if (value === null || value === undefined) return '–';
    const m = Number(value);
    if (Math.abs(m) < 120) return `${Math.round(m)} min`;
    if (Math.abs(m) < 2880) return `${(m / 60).toFixed(1)} h`;
    return `${(m / 1440).toFixed(1)} d`;
  };
  const statusText = {
    scored: 'Scored', historical_pending: 'Waiting for price', detected: 'Waiting', waiting_day: 'Running',
    waiting_week: 'Running', waiting_month: 'Running', price_start_error: 'No entry price',
    price_history_error: 'No price history', rejected: 'Rejected'
  };

  async function getJson(path) {
    if (typeof window.ithacGetJson !== 'function') throw new Error('API not ready');
    return window.ithacGetJson(path);
  }

  function windowCell(window) {
    if (!window) return '<td class="jw jw-none">–</td>';
    const status = String(window.status || '');
    if (status === 'scored') {
      const score = Number(window.score);
      const tone = score >= 60 ? 'good' : score <= 40 ? 'bad' : 'flat';
      const variation = Number(window.variationPct);
      return `<td class="jw jw-${tone}"><strong>${Number.isFinite(score) ? score.toFixed(1) : '–'}</strong>` +
        `<small>${Number.isFinite(variation) ? `${variation >= 0 ? '+' : ''}${variation.toFixed(2)}%` : ''} · ${price(window.exitPrice)}</small>` +
        `<small>${et(window.exitAt)}</small></td>`;
    }
    const isError = status.endsWith('_error');
    return `<td class="jw ${isError ? 'jw-error' : 'jw-wait'}"><span class="jw-pill">${esc(statusText[status] || status)}</span>` +
      `<small>${isError ? esc(window.error || '') : `target ${et(window.targetAt)}`}</small></td>`;
  }

  function entryCell(row) {
    const first = (row.windows || []).find((window) => window.entryPrice !== null && window.entryPrice !== undefined);
    if (!first) return '<td class="je">–</td>';
    return `<td class="je"><strong>${price(first.entryPrice)}</strong><small>${et(first.entryAt)}</small>` +
      `<small class="${first.wellTimed ? 'je-ok' : 'je-late'}">${first.wellTimed ? 'on time' : 'late'} · +${minutes(first.entryLagMinutes)}</small></td>`;
  }

  function detail(row) {
    const windows = (row.windows || []).map((window) => `
      <tr><td>${esc(window.label || window.horizon)}</td><td>${esc(window.status)}</td><td>${price(window.entryPrice)}</td><td>${et(window.entryAt)}</td>
      <td>${minutes(window.entryLagMinutes)}</td><td>${et(window.targetAt)}</td><td>${price(window.exitPrice)}</td><td>${et(window.exitAt)}</td>
      <td>${window.variationPct ?? '–'}</td><td>${window.score ?? '–'}</td><td>${esc(window.error || '')}</td></tr>`).join('');
    return `
      <tr class="journal-detail"><td colspan="8">
        <blockquote>${esc(row.post?.text || '(tweet text not stored)')}</blockquote>
        <p>${row.post?.url ? `<a href="${esc(row.post.url)}" target="_blank" rel="noopener noreferrer">Open the tweet</a> · ` : ''}
          Thesis: ${esc(row.thesis || '–')} · Confidence ${Math.round(Number(row.confidence || 0) * 100)}% · Coin id <code>${esc(row.coinId || '–')}</code> · Source ${esc(row.source)}
          · Call #${row.id} · Post #${row.post?.id} · Job #${row.robot?.jobId ?? '–'} · Signal status ${esc(row.signalStatus)}${row.signalError ? ` (${esc(row.signalError)})` : ''}</p>
        <p>Posted ${et(row.post?.postedAt)} · Scraped ${et(row.post?.scrapedAt)} (+${minutes(row.post?.scrapeDelayMinutes)})
          · Analysed ${et(row.analysis?.analyzedAt)} (+${minutes(row.analysis?.delayAfterScrapeMinutes)}) by ${esc(row.analysis?.model || '–')} · Detected ${et(row.detectedAt)}</p>
        <div class="journal-table-wrap"><table class="journal-subtable">
          <thead><tr><th>Window</th><th>Status</th><th>Entry</th><th>Entry at</th><th>Entry lag</th><th>Target</th><th>Exit</th><th>Exit at</th><th>Var. %</th><th>Score</th><th>Error</th></tr></thead>
          <tbody>${windows}</tbody></table></div>
      </td></tr>`;
  }

  function renderRows() {
    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="8">No call matches these filters.</td></tr>';
      return;
    }
    rowsEl.innerHTML = rows.map((row, index) => {
      const byHorizon = Object.fromEntries((row.windows || []).map((window) => [window.horizon, window]));
      const robot = robotsBySession[row.robot?.session] || row.robot?.session || '–';
      const side = String(row.direction || '').toLowerCase() === 'bearish' ? 'bear' : 'bull';
      return `
        <tr class="journal-row" data-index="${index}" tabindex="0" aria-expanded="false">
          <td>${et(row.post?.postedAt)}</td>
          <td>@${esc(row.username)}</td>
          <td><strong>${esc(row.symbol)}</strong> <span class="side side-${side}">${side === 'bull' ? 'Long' : 'Short'}</span><small>${Math.round(Number(row.confidence || 0) * 100)}% conf.</small></td>
          ${entryCell(row)}
          ${windowCell(byHorizon.day)}${windowCell(byHorizon.week)}${windowCell(byHorizon.month)}
          <td class="jp"><small>Scrape +${minutes(row.post?.scrapeDelayMinutes)}</small><small>AI +${minutes(row.analysis?.delayAfterScrapeMinutes)}</small><small>Robot ${esc(robot)}</small></td>
        </tr>`;
    }).join('');
  }

  function toggle(rowEl) {
    const open = rowEl.getAttribute('aria-expanded') === 'true';
    const next = rowEl.nextElementSibling;
    if (open && next?.classList.contains('journal-detail')) next.remove();
    if (!open) rowEl.insertAdjacentHTML('afterend', detail(rows[Number(rowEl.dataset.index)]));
    rowEl.setAttribute('aria-expanded', String(!open));
  }

  function filters() {
    const data = new FormData(form);
    const params = new URLSearchParams({ take: String(PAGE) });
    for (const key of ['status', 'coin', 'username']) {
      const value = String(data.get(key) || '').trim().replace(/^@/, '');
      if (value) params.set(key, value);
    }
    return params;
  }

  async function loadRows(append = false) {
    if (loading) return;
    loading = true;
    try {
      const params = filters();
      if (append && nextBeforeId) params.set('before', String(nextBeforeId));
      if (!append) rowsEl.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
      const data = await getJson(`/api/monitor/journal?${params.toString()}`);
      rows = append ? rows.concat(data.rows || []) : (data.rows || []);
      nextBeforeId = data.nextBeforeId ?? null;
      moreButton.hidden = !nextBeforeId;
      renderRows();
    } catch (error) {
      if (!append) rowsEl.innerHTML = `<tr><td colspan="8">Journal unavailable (${esc(error?.message || 'error')}).</td></tr>`;
    } finally {
      loading = false;
    }
  }

  function count(list, status) {
    return (list || []).filter((item) => !status || item.status === status).reduce((sum, item) => sum + item.count, 0);
  }


  function renderOverview(s) {
    const healthEl = document.getElementById('garageHealth');
    const attentionEl = document.getElementById('garageAttention');
    const overviewUpdated = document.getElementById('overviewUpdated');
    if (!healthEl || !attentionEl) return;
    const robots = s.robots || [];
    const active = robots.filter((r) => r.enabled && String(r.health).toLowerCase() === 'available').length;
    const paused = robots.filter((r) => r.enabled && String(r.health).toLowerCase() === 'coolingdown').length;
    const recentPerHour = s.scraping?.recentPostsScrapedLastHour ?? 0;
    const aiPerHour = count(s.analysis?.lastHour);
    const waiting = s.analysis?.recentPostsWaiting ?? 0;
    const scored24 = s.pricing?.scoredLast24h ?? 0;
    const errors = count(s.pricing?.windowsByStatus, 'price_start_error') + count(s.pricing?.windowsByStatus, 'price_history_error');
    const scoredTotal = count(s.pricing?.windowsByStatus, 'scored');
    const errorShare = scoredTotal + errors ? errors / (scoredTotal + errors) : 0;
    const level = (good, warn) => (good ? 'good' : warn ? 'warn' : 'bad');
    const steps = [
      { name: '1. Collect', tone: level(active >= 2 && recentPerHour > 0, active >= 1), value: `${active} robot${active === 1 ? '' : 's'} working`,
        note: `${recentPerHour.toLocaleString()} recent posts per hour${paused ? ` · ${paused} paused by X` : ''}` },
      { name: '2. AI analysis', tone: level(waiting < 200, waiting < 1000), value: `${aiPerHour.toLocaleString()} posts per hour`,
        note: `${waiting.toLocaleString()} recent posts waiting` },
      { name: '3. Calls', tone: level((s.signals?.createdLast24h ?? 0) > 50, (s.signals?.createdLast24h ?? 0) > 0), value: `${(s.signals?.createdLast24h ?? 0).toLocaleString()} in 24 h`,
        note: `${s.signals?.createdLastHour ?? 0} in the last hour` },
      { name: '4. Prices & scores', tone: level(errorShare < 0.05, errorShare < 0.2), value: `${scored24.toLocaleString()} scores in 24 h`,
        note: `${Math.round(errorShare * 100)}% of windows stuck on a price error` }
    ];
    healthEl.innerHTML = steps.map((step) => `
      <div class="health-card health-${step.tone}">
        <span class="health-light" aria-hidden="true"></span>
        <div><span>${esc(step.name)}</span><strong>${esc(step.value)}</strong><small>${esc(step.note)}</small></div>
        <em class="health-word">${step.tone === 'good' ? 'OK' : step.tone === 'warn' ? 'Watch' : 'Problem'}</em>
      </div>`).join('');
    const items = [];
    if (active === 0) items.push('No X robot is working: collection is stopped. Connect a new X account.');
    else if (active === 1) items.push('Only one X robot is working. If X throttles it, collection stops: add more accounts.');
    if (waiting >= 200) items.push(`The AI cannot keep up: ${waiting.toLocaleString()} recent posts are waiting (free Groq quota).`);
    if (errorShare >= 0.05) items.push(`${errors.toLocaleString()} call windows have no price (unknown coin id or missing entry price).`);
    if (!items.length) items.push('Nothing urgent: every step is running normally.');
    attentionEl.innerHTML = items.map((item) => `<li>${esc(item)}</li>`).join('');
    if (overviewUpdated) overviewUpdated.textContent = `Updated ${new Date(s.generatedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET · refreshes every minute`;
  }

  async function loadSummary() {
    try {
      const s = await getJson('/api/monitor/summary');
      const priceErrors = count(s.pricing?.windowsByStatus, 'price_start_error') + count(s.pricing?.windowsByStatus, 'price_history_error');
      const cards = [
        ['Recent posts scraped', `${(s.scraping?.recentPostsScrapedLastHour ?? 0).toLocaleString()} / h`, `${(s.scraping?.postsScrapedLast24h ?? 0).toLocaleString()} posts in 24 h`],
        ['AI analyses', `${count(s.analysis?.lastHour).toLocaleString()} / h`, `${(s.analysis?.recentPostsWaiting ?? 0).toLocaleString()} recent posts waiting`],
        ['Calls detected', `${(s.signals?.createdLast24h ?? 0).toLocaleString()} in 24 h`, `${s.signals?.createdLastHour ?? 0} in the last hour`],
        ['Windows scored', `${(s.pricing?.scoredLast24h ?? 0).toLocaleString()} in 24 h`, `${count(s.pricing?.windowsByStatus, 'scored').toLocaleString()} in total`],
        ['Price errors', priceErrors.toLocaleString(), `${count(s.pricing?.windowsByStatus, 'historical_pending').toLocaleString()} waiting for price`]
      ];
      summaryEl.innerHTML = cards.map(([label, value, note]) =>
        `<div class="journal-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
      renderOverview(s);
      updatedEl.textContent = `Updated ${new Date(s.generatedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`;
    } catch {
      summaryEl.innerHTML = '<p class="garage-note">Pipeline summary unavailable.</p>';
    }
  }

  function exportCsv() {
    const header = ['call_id', 'posted_at', 'scraped_at', 'analysed_at', 'influencer', 'symbol', 'coin_id', 'side', 'confidence', 'thesis', 'tweet_url', 'robot',
      ...['day', 'week', 'month'].flatMap((h) => [`${h}_status`, `${h}_entry_price`, `${h}_entry_at`, `${h}_entry_lag_min`, `${h}_exit_price`, `${h}_exit_at`, `${h}_variation_pct`, `${h}_score`, `${h}_error`])];
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((row) => {
      const byHorizon = Object.fromEntries((row.windows || []).map((window) => [window.horizon, window]));
      return [row.id, row.post?.postedAt, row.post?.scrapedAt, row.analysis?.analyzedAt, row.username, row.symbol, row.coinId, row.direction, row.confidence, row.thesis, row.post?.url,
        robotsBySession[row.robot?.session] || row.robot?.session,
        ...['day', 'week', 'month'].flatMap((h) => {
          const w = byHorizon[h] || {};
          return [w.status, w.entryPrice, w.entryAt, w.entryLagMinutes, w.exitPrice, w.exitAt, w.variationPct, w.score, w.error];
        })].map(quote).join(',');
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ithac-journal-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); void loadRows(false); });
  moreButton.addEventListener('click', () => void loadRows(true));
  exportButton.addEventListener('click', exportCsv);
  rowsEl.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    const rowEl = event.target.closest('.journal-row');
    if (rowEl) toggle(rowEl);
  });
  rowsEl.addEventListener('keydown', (event) => {
    const rowEl = event.target.closest('.journal-row');
    if (rowEl && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(rowEl); }
  });

  function onRoute() {
    const open = location.hash.startsWith('#garage');
    clearInterval(summaryTimer);
    if (!open) return;
    const start = () => {
      void loadSummary();
      if (!rows.length) void loadRows(false);
      getJson('/api/monitor/robots').then((data) => {
        for (const robot of data?.robots || []) robotsBySession[robot.session_name] = robot.label;
        if (rows.length) renderRows();
      }).catch(() => {});
    };
    if (typeof window.ithacGetJson === 'function') start(); else setTimeout(start, 1500);
    summaryTimer = setInterval(loadSummary, 60_000);
  }
  window.addEventListener('hashchange', onRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onRoute, { once: true });
  else onRoute();
})();
