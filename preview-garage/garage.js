// Garage (v4, Claude 22/11/2026): one module for the whole Garage view.
// Tabs: Overview (pipeline health), Robots (fleet + speed), AI & journal (Groq + calls), Live & tools.
// Data: /api/monitor/summary, /api/monitor/robots, /api/monitor/groq, /api/monitor/journal (read-only),
// speed changes: POST /api/admin/robots/{session}/tuning with the admin key kept in this browser.
(() => {
  'use strict';

  const view = document.getElementById('garageView');
  const main = document.querySelector('main.app-shell');
  if (!view || !main) return;
  const $ = (id) => document.getElementById(id);

  // ---------- formatting ----------
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = (value) => Number(value || 0).toLocaleString('en-US');
  const usd = (value) => `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  function et(value, timeOnly = false) {
    if (!value) return '–';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '–';
    return d.toLocaleString('en-US', timeOnly
      ? { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }
      : { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function ago(value) {
    if (!value) return 'never';
    const s = (Date.now() - new Date(value).getTime()) / 1000;
    if (!Number.isFinite(s)) return 'unknown';
    if (s < 45) return 'just now';
    if (s < 5400) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 172800) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  function span(fromValue, toValue = new Date()) {
    const ms = new Date(toValue).getTime() - new Date(fromValue).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '–';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')} min`;
    return `${Math.round(h / 24)} days`;
  }
  const updatedText = (value) => `Updated ${et(value || new Date(), true)} ET`;

  // ---------- API ----------
  async function api(path) {
    if (typeof window.ithacGetJson !== 'function') throw new Error('The API is not ready yet');
    return window.ithacGetJson(path);
  }
  function whenApiReady(fn, tries = 0) {
    if (typeof window.ithacGetJson === 'function') fn();
    else if (tries < 40) setTimeout(() => whenApiReady(fn, tries + 1), 250);
  }

  // ---------- router ----------
  const TABS = ['overview', 'robots', 'analysis', 'tools'];
  const ALIASES = { tuning: 'robots', journal: 'analysis', groq: 'analysis', activity: 'tools' };
  const timers = new Map();
  let lastScrollY = 0;
  let shownTab = null;

  function currentTab() {
    const raw = location.hash.split('/')[1] || 'overview';
    const tab = ALIASES[raw] || raw;
    return TABS.includes(tab) ? tab : 'overview';
  }
  function every(key, fn, ms) {
    clearInterval(timers.get(key));
    void fn();
    timers.set(key, setInterval(() => void fn(), ms));
  }
  function stopTimers() {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
  }
  function showTab(tab) {
    for (const panel of view.querySelectorAll('[data-tab-panel]')) panel.hidden = panel.dataset.tabPanel !== tab;
    for (const link of view.querySelectorAll('.garage-tabs [data-tab]')) {
      const active = link.dataset.tab === tab;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  function route() {
    const open = location.hash.startsWith('#garage');
    if (!open) {
      if (!view.hidden) {
        stopTimers();
        view.hidden = true;
        main.hidden = false;
        document.body.classList.remove('in-garage');
        window.scrollTo(0, lastScrollY);
        shownTab = null;
      }
      return;
    }
    const opening = view.hidden;
    if (opening) {
      lastScrollY = window.scrollY;
      main.hidden = true;
      view.hidden = false;
      document.body.classList.add('in-garage');
      view.classList.remove('garage-opening');
      void view.offsetWidth; // restart the door animation
      view.classList.add('garage-opening');
      window.scrollTo(0, 0);
    }
    const tab = currentTab();
    if (!opening && tab !== shownTab) {
      const nav = view.querySelector('.garage-tabs');
      if (nav && nav.getBoundingClientRect().top <= 0) window.scrollTo(0, nav.offsetTop);
    }
    shownTab = tab;
    showTab(tab);
    stopTimers();
    whenApiReady(() => {
      every('summary', loadSummary, 60_000);
      if (tab === 'overview') every('groq', loadGroq, 60_000);
      if (tab === 'robots') every('robots', loadRobots, 30_000);
      if (tab === 'analysis') {
        every('groq', loadGroq, 30_000);
        if (!journal.loaded) void loadJournal(false);
        if (!army) void loadRobots();
      }
    });
  }

  // ---------- Overview + status band ----------
  let summary = null;
  let groq = null;
  const countOf = (list, status) => (list || []).filter((item) => !status || item.status === status).reduce((sum, item) => sum + Number(item.count || 0), 0);
  const LEVEL_WORD = { good: 'Running', watch: 'Watch', bad: 'Problem' };

  function assess(s) {
    const robots = s.robots || [];
    const active = robots.filter((r) => r.enabled && String(r.health).toLowerCase() === 'available').length;
    const paused = robots.filter((r) => r.enabled && String(r.health).toLowerCase() === 'coolingdown').length;
    const fresh = Number(s.scraping?.recentPostsScrapedLastHour || 0);
    const waiting = Number(s.analysis?.recentPostsWaiting || 0);
    const readLive = s.analysis?.liveLastHour ?? countOf(s.analysis?.lastHour);
    const calls24 = s.signals?.live24h ?? s.signals?.createdLast24h ?? 0;
    const callsHour = s.signals?.liveLastHour ?? s.signals?.createdLastHour ?? 0;
    const scored24 = Number(s.pricing?.scoredLast24h || 0);
    const priceErrors = countOf(s.pricing?.windowsByStatus, 'price_start_error') + countOf(s.pricing?.windowsByStatus, 'price_history_error');
    const scoredTotal = countOf(s.pricing?.windowsByStatus, 'scored');
    const errorShare = scoredTotal + priceErrors ? priceErrors / (scoredTotal + priceErrors) : 0;
    const level = (good, watch) => (good ? 'good' : watch ? 'watch' : 'bad');
    const steps = [
      { name: 'Collect', tab: 'robots', link: 'See the robots', level: level(active >= 2 && fresh > 0, active >= 1),
        value: `${active} robot${active === 1 ? '' : 's'} reading X`,
        note: `${num(fresh)} fresh posts in the last hour${paused ? `, ${paused} paused by X` : ''}` },
      { name: 'Read with AI', tab: 'analysis', link: 'See the AI', level: level(waiting < 200, waiting < 1000),
        value: waiting ? `${num(waiting)} posts waiting` : 'Up to date',
        note: `${num(readLive)} fresh posts read in the last hour` },
      { name: 'Detect calls', tab: 'analysis', link: 'See the journal', level: level(calls24 > 50, calls24 > 0),
        value: `${num(calls24)} calls in 24 h`,
        note: `${num(callsHour)} in the last hour` },
      { name: 'Price and score', tab: 'analysis', link: 'See the journal', level: level(errorShare < 0.05, errorShare < 0.2),
        value: `${num(scored24)} scores in 24 h`,
        note: `${Math.round(errorShare * 100)}% of call windows have no price` }
    ];
    const attention = [];
    if (active === 0) attention.push({ level: 'bad', text: 'No robot is reading X: collection has stopped. Add a robot with a new X account.' });
    else if (active === 1) attention.push({ level: 'watch', text: 'Only one robot is reading X. If X throttles it, collection stops: add a robot.' });
    if (paused) attention.push({ level: 'watch', text: `${paused} robot${paused === 1 ? ' is' : 's are'} paused by X and will resume by themselves.` });
    if (waiting >= 200) attention.push({ level: waiting >= 1000 ? 'bad' : 'watch', text: `The AI is behind: ${num(waiting)} recent posts are waiting to be read.` });
    if (errorShare >= 0.05) attention.push({ level: errorShare >= 0.2 ? 'bad' : 'watch', text: `${num(priceErrors)} call windows have no price (coin not recognised, or no entry price).` });
    return { steps, attention };
  }

  function renderBand(failed = false) {
    const box = $('garageStatus');
    const text = $('garageStatusText');
    if (!box || !text) return;
    if (failed || !summary) {
      box.dataset.level = 'unknown';
      text.textContent = failed ? 'Status unavailable right now' : 'Checking the machine…';
      return;
    }
    const { steps, attention } = assess(summary);
    const worst = steps.some((s) => s.level === 'bad') || attention.some((a) => a.level === 'bad') ? 'bad'
      : steps.some((s) => s.level === 'watch') || attention.length ? 'watch' : 'good';
    box.dataset.level = worst;
    text.textContent = worst === 'good' ? 'Everything is running'
      : `${attention.length || 1} thing${(attention.length || 1) === 1 ? '' : 's'} to ${worst === 'bad' ? 'fix' : 'watch'}`;
  }

  function renderOverview() {
    const list = $('garageHealth');
    const attentionEl = $('garageAttention');
    if (!list || !attentionEl || !summary) return;
    const { steps, attention } = assess(summary);
    list.innerHTML = steps.map((step, index) => `
      <li class="pipeline-step" data-level="${step.level}">
        <span class="pipeline-name"><span class="pipeline-number">${index + 1}</span>${esc(step.name)}</span>
        <span class="pipeline-state"><span class="light" aria-hidden="true"></span>${LEVEL_WORD[step.level]}</span>
        <strong class="pipeline-value">${esc(step.value)}</strong>
        <span class="pipeline-note">${esc(step.note)}</span>
        <a class="pipeline-link" href="#garage/${step.tab}">${esc(step.link)}</a>
      </li>`).join('');
    attentionEl.innerHTML = attention.length
      ? attention.map((item) => `<li data-level="${item.level}"><span class="light" aria-hidden="true"></span>${esc(item.text)}</li>`).join('')
      : '<li data-level="good"><span class="light" aria-hidden="true"></span>Nothing needs attention right now.</li>';
    const updated = $('overviewUpdated');
    if (updated) updated.textContent = `${updatedText(summary.generatedAt)}, refreshed every minute`;
  }

  async function loadSummary() {
    try {
      summary = await api('/api/monitor/summary');
      renderBand();
      renderOverview();
    } catch {
      renderBand(true);
      const list = $('garageHealth');
      if (list && !summary) list.innerHTML = '<li class="pipeline-step"><span class="pipeline-note">The status is unavailable right now. It will retry in a minute.</span></li>';
    }
  }

  // ---------- Robots + speed ----------
  const PRESETS = [
    { name: 'Gentle', seconds: 30 },
    { name: 'Normal', seconds: 15 },
    { name: 'Fast', seconds: 10 },
    { name: 'Turbo', seconds: 6 }
  ];
  const X_LIMIT_PER_HOUR = 187 * 4;
  const TOKEN_KEY = 'ithacAdminToken';
  let army = null;
  let liveJobs = new Map();
  const openDetails = new Set();
  const rowNotes = new Map();
  let lastLiveRender = 0;

  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = (value) => { try { if (value) localStorage.setItem(TOKEN_KEY, value); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
  const intervalOf = (robot) => (Number(robot.min_interval_seconds) > 0 ? Number(robot.min_interval_seconds) : Number(army?.defaultIntervalSeconds || 15));
  const robotNumber = (robot) => Number(String(robot.label || '').replace(/\D/g, '')) || 0;

  function robotState(robot) {
    const health = String(robot.health || '').toLowerCase();
    if (robot.status === 'testing') return { key: 'watch', word: 'Being tested', note: 'Reading reference accounts' };
    if (robot.status !== 'alive') return { key: 'bad', word: robot.status === 'retired' ? 'Retired' : 'Stopped by X', note: robot.death_reason || '' };
    if (!robot.enabled) return { key: 'bad', word: 'Switched off', note: '' };
    if (health === 'coolingdown') return { key: 'watch', word: 'Paused by X', note: robot.cooldown_until ? `Back at ${et(robot.cooldown_until, true)} ET` : 'Back soon' };
    const busy = liveJobs.get(robot.session_name);
    return { key: 'good', word: 'Working', note: busy ? `Reading @${busy}` : `Last read ${ago(robot.last_used_at)}` };
  }

  function gauge(value, cap) {
    const max = X_LIMIT_PER_HOUR;
    const angle = (v) => Math.PI * (1 - Math.min(Math.max(v / max, 0), 1));
    const at = (v, r) => [32 + r * Math.cos(angle(v)), 32 - r * Math.sin(angle(v))];
    const arc = (from, to, cls) => {
      const [x1, y1] = at(from, 26);
      const [x2, y2] = at(to, 26);
      return `<path class="${cls}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} A26 26 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
    };
    const [nx, ny] = at(value, 21);
    const [t1x, t1y] = at(cap, 20);
    const [t2x, t2y] = at(cap, 31);
    return `<svg class="gauge" viewBox="0 0 64 36" aria-hidden="true">
      ${arc(0, max * 0.5, 'zone-ok')}${arc(max * 0.5, max * 0.8, 'zone-warn')}${arc(max * 0.8, max, 'zone-limit')}
      <line class="cap" x1="${t1x.toFixed(1)}" y1="${t1y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}"/>
      <line class="needle" x1="32" y1="32" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"/>
      <circle class="hub" cx="32" cy="32" r="2.6"/>
    </svg>`;
  }

  function timeline(events) {
    if (!events.length) return '<p class="g-hint">No event yet.</p>';
    const items = [...events].reverse();
    return `<ol class="robot-history">${items.map((event, index) => `
      <li${index >= 6 ? ' class="is-extra"' : ''}><time datetime="${esc(event.at)}">${et(event.at)}</time><span>${esc(event.text)}</span></li>`).join('')}</ol>
      ${items.length > 6 ? `<button type="button" class="g-link" data-action="history-all">Show all ${items.length} events</button>` : ''}`;
  }

  function fleetRow(robot, events) {
    const state = robotState(robot);
    const alive = robot.status === 'alive' || robot.status === 'testing';
    const interval = intervalOf(robot);
    const cap = Math.round(3600 / interval);
    const reads = Number(robot.passes_1h || 0);
    const unlocked = Boolean(token());
    const isPreset = PRESETS.some((p) => p.seconds === interval);
    const route = robot.address === 'server' ? 'Server address, no proxy' : robot.address ? `Through ${robot.address}` : 'Route unknown';
    const note = rowNotes.get(robot.session_name);
    const speed = alive ? `
      <div class="fleet-speed">
        <div class="seg seg-speed" role="radiogroup" aria-label="Speed of ${esc(robot.label)}">
          ${PRESETS.map((p) => `<button type="button" role="radio" aria-checked="${p.seconds === interval}" data-seconds="${p.seconds}"
            ${unlocked ? '' : 'disabled title="Unlock the speed controls first"'}><span>${p.name}</span><small>${p.seconds} s</small></button>`).join('')}
          ${isPreset ? '' : `<button type="button" role="radio" aria-checked="true" disabled><span>Custom</span><small>${interval} s</small></button>`}
        </div>
        <p class="fleet-speed-note" role="status">${note ? esc(note) : `1 read every ${interval} s at most, up to ${num(cap)} per hour`}</p>
      </div>` : '<div class="fleet-speed"><p class="fleet-speed-note">No longer reading</p></div>';
    const open = openDetails.has(robot.session_name);
    return `
      <article class="fleet-row" role="listitem" data-session="${esc(robot.session_name)}" data-level="${state.key}">
        <div class="fleet-id">
          <span class="fleet-avatar" aria-hidden="true"><i></i><i></i></span>
          <div><strong>${esc(robot.label)}</strong><span>${esc(robot.identity || 'X account')}</span><span>${esc(route)}</span></div>
        </div>
        <div class="fleet-state"><span class="pill" data-level="${state.key}">${esc(state.word)}</span><small>${esc(state.note)}</small></div>
        <div class="fleet-reads">${alive ? gauge(reads, cap) : ''}<div><span class="fleet-label">Reads in the last hour</span><b>${num(reads)}</b><small>${alive ? `limit about ${num(X_LIMIT_PER_HOUR)}` : `${num(robot.passes_alive)} reads in its life`}</small></div></div>
        <div class="fleet-yield"><span class="fleet-label">New posts</span><b>${num(alive ? robot.posts_1h : robot.new_posts_alive)}</b><small>${alive ? 'in the last hour' : 'in its life'}</small></div>
        ${speed}
        <details class="fleet-more"${open ? ' open' : ''}>
          <summary>Details</summary>
          <div class="fleet-more-body">
            <dl class="fleet-facts">
              <div><dt>Born</dt><dd>${et(robot.born_at)} ET</dd></div>
              <div><dt>${alive ? 'Working for' : 'Lived'}</dt><dd>${alive ? span(robot.born_at) : span(robot.born_at, robot.died_at)}</dd></div>
              <div><dt>Reads since birth</dt><dd>${num(robot.passes_since_birth ?? robot.passes_alive)}</dd></div>
              <div><dt>New posts since birth</dt><dd>${num(robot.posts_since_birth ?? robot.new_posts_alive)}</dd></div>
              <div><dt>Reads today</dt><dd>${num(robot.reads_today)}</dd></div>
              <div><dt>Reads in 15 min</dt><dd>${num(robot.passes_15m)} <span class="g-hint">(X limit about 187)</span></dd></div>
            </dl>
            ${alive ? `
            <div class="fleet-custom">
              <label><span>Custom speed: 1 read every <output>${interval}</output> s</span>
                <input type="range" min="5" max="120" step="1" value="${interval}" ${unlocked ? '' : 'disabled'}>
              </label>
              <div class="fleet-custom-actions">
                <button type="button" class="g-button" data-action="apply-custom" ${unlocked ? '' : 'disabled'}>Apply</button>
                <button type="button" class="g-button g-button-quiet" data-action="default-speed" ${unlocked ? '' : 'disabled'}>Back to default (${num(army?.defaultIntervalSeconds || 15)} s)</button>
              </div>
            </div>` : ''}
            <div class="fleet-history"><h4>History</h4>${timeline(events)}</div>
          </div>
        </details>
      </article>`;
  }

  function renderRobots() {
    const grid = $('robotsGrid');
    const summaryEl = $('robotsSummary');
    if (!grid || !army) return;
    const eventsBy = new Map();
    for (const event of army.events || []) {
      if (!eventsBy.has(event.session_name)) eventsBy.set(event.session_name, []);
      eventsBy.get(event.session_name).push(event);
    }
    const all = (army.robots || []).filter((r) => r.status !== 'retired').sort((a, b) => robotNumber(a) - robotNumber(b));
    const working = all.filter((r) => r.status === 'alive' || r.status === 'testing');
    const stopped = all.filter((r) => r.status === 'dead');
    grid.innerHTML = (working.length ? working.map((r) => fleetRow(r, eventsBy.get(r.session_name) || [])).join('')
      : '<p class="g-empty">No robot is reading X right now. Add one with the steps below.</p>') +
      (stopped.length ? `<details class="fleet-stopped"><summary>${stopped.length} robot${stopped.length === 1 ? '' : 's'} stopped by X</summary>${stopped.map((r) => fleetRow(r, eventsBy.get(r.session_name) || [])).join('')}</details>` : '');
    if (summaryEl) {
      const room = Math.max(0, 10 - working.length);
      summaryEl.textContent = `${working.length} robot${working.length === 1 ? ' is' : 's are'} reading X with ${working.length === 1 ? 'its' : 'their'} own account. Room for ${room} more.`;
    }
    renderLock();
  }

  async function loadRobots() {
    try {
      army = await api('/api/monitor/robots');
      renderRobots();
      if (journal.rows.length) renderJournalRows();
    } catch {
      const grid = $('robotsGrid');
      if (grid && !army) grid.innerHTML = '<p class="g-empty">The robots are unavailable right now. The page retries every 30 seconds.</p>';
    }
  }

  function renderLock() {
    const button = $('speedLockButton');
    const state = $('tuningKeyState');
    const unlocked = Boolean(token());
    if (button) {
      button.textContent = unlocked ? 'Lock speed controls' : 'Unlock speed controls';
      button.setAttribute('aria-expanded', String(!$('speedUnlock')?.hidden));
    }
    if (state && unlocked) state.textContent = 'Unlocked in this browser.';
  }

  async function saveSpeed(session, seconds) {
    const key = token();
    const robot = army?.robots?.find((r) => r.session_name === session);
    if (!key || !robot) return;
    rowNotes.set(session, 'Saving…');
    renderRobots();
    try {
      if (typeof window.ithacApiUrl !== 'function') throw new Error('the API is not ready yet');
      const response = await fetch(window.ithacApiUrl(`/api/admin/robots/${encodeURIComponent(session)}/tuning`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ithac-Admin-Token': key },
        body: JSON.stringify({ minIntervalSeconds: seconds })
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setToken('');
        throw new Error('the admin key was refused, unlock again with the right key');
      }
      if (!response.ok) throw new Error(body.error || body.title || `HTTP ${response.status}`);
      robot.min_interval_seconds = body.minIntervalSeconds ?? null;
      const now = intervalOf(robot);
      rowNotes.set(session, `Saved: 1 read every ${now} s at most`);
    } catch (error) {
      rowNotes.set(session, `Not saved: ${error.message}`);
    }
    renderRobots();
    setTimeout(() => { rowNotes.delete(session); if (army) renderRobots(); }, 6000);
  }

  function bindRobots() {
    const grid = $('robotsGrid');
    const lockButton = $('speedLockButton');
    const form = $('speedUnlock');
    const input = $('tuningKey');
    lockButton?.addEventListener('click', () => {
      if (token()) {
        setToken('');
        if (form) form.hidden = true;
        const state = $('tuningKeyState');
        if (state) state.textContent = 'The key stays in this browser only.';
        renderRobots();
        renderLock();
        return;
      }
      if (form) {
        form.hidden = !form.hidden;
        if (!form.hidden) input?.focus();
      }
      renderLock();
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = (input?.value || '').trim();
      if (input) input.value = '';
      if (!value) return;
      setToken(value);
      form.hidden = true;
      renderRobots();
      renderLock();
    });
    grid?.addEventListener('toggle', (event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('fleet-more')) return;
      const session = details.closest('.fleet-row')?.dataset.session;
      if (!session) return;
      if (details.open) openDetails.add(session); else openDetails.delete(session);
    }, true);
    grid?.addEventListener('input', (event) => {
      const range = event.target.closest('.fleet-custom input[type="range"]');
      if (range) range.closest('label').querySelector('output').textContent = range.value;
    });
    grid?.addEventListener('click', (event) => {
      const row = event.target.closest('.fleet-row');
      const session = row?.dataset.session;
      if (!session) return;
      const preset = event.target.closest('.seg-speed button[data-seconds]');
      if (preset && !preset.disabled) {
        if (preset.getAttribute('aria-checked') === 'true') return;
        void saveSpeed(session, Number(preset.dataset.seconds));
        return;
      }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'apply-custom') void saveSpeed(session, Number(row.querySelector('.fleet-custom input[type="range"]').value));
      if (action === 'default-speed') void saveSpeed(session, null);
      if (action === 'history-all') {
        row.querySelectorAll('.robot-history .is-extra').forEach((item) => item.classList.remove('is-extra'));
        event.target.remove();
      }
    });
    window.addEventListener('ithac:resources', (event) => {
      const jobs = event.detail?.jobs || [];
      liveJobs = new Map(jobs.filter((job) => String(job.status || '').toLowerCase() === 'running' && job.sessionName)
        .map((job) => [job.sessionName, job.username]));
      if (!view.hidden && shownTab === 'robots' && army && Date.now() - lastLiveRender > 5000) {
        const focused = document.activeElement;
        // never redraw under the pointer while a speed control is being used
        if ($('robotsGrid')?.contains(focused) && (focused.type === 'range' || focused.closest('.seg-speed'))) return;
        lastLiveRender = Date.now();
        renderRobots();
      }
    });
  }

  // ---------- AI analysis (Groq) ----------
  function errorKind(text) {
    const t = String(text || '');
    if (/json_validate_failed|Failed to (generate|validate) JSON/i.test(t)) return 'Groq could not format its answer';
    if (/HTTP 429|rate.?limit|quota/i.test(t)) return 'Groq quota reached at that moment';
    if (/timed? ?out|TaskCanceled|timeout/i.test(t)) return 'Groq did not answer in time';
    if (/HTTP 5\d\d/i.test(t)) return 'Groq had a server error';
    return t.replace(/^groq\s+/i, '').slice(0, 140);
  }

  function renderGroq() {
    if (!groq) return;
    const p = groq.provider || {};
    const b = groq.backlog || {};
    const lastOkMin = p.last_success_at ? (Date.now() - new Date(p.last_success_at).getTime()) / 60000 : Infinity;
    const limited = p.last_rate_limited_at && (Date.now() - new Date(p.last_rate_limited_at).getTime()) < 10 * 60000;
    const state = lastOkMin < 15 ? (limited ? 'watch' : 'good') : 'bad';
    const freePlan = Number(p.limit_requests || 0) > 0 && Number(p.limit_requests) <= 1000;
    const hourly = groq.pace?.hourly || [];
    const errors24 = hourly.filter((r) => r.status === 'error').reduce((s, r) => s + Number(r.n || 0), 0);
    const total24 = hourly.reduce((s, r) => s + Number(r.n || 0), 0);
    const waiting = Number(b.recent_not_analyzed || 0);

    const cards = $('groqCards');
    if (cards) {
      cards.innerHTML = `
        <div data-level="${state}"><dt>Groq</dt><dd><span class="light" aria-hidden="true"></span>${state === 'good' ? 'Working' : state === 'watch' ? 'Slowed by its quota' : 'Not answering'}</dd>
          <dd class="kpi-note">${esc(p.model || '')}${p.last_success_at ? `, last answer ${ago(p.last_success_at)}` : ''}</dd></div>
        <div data-level="${freePlan ? 'watch' : 'good'}"><dt>Quota left</dt><dd>${p.remaining_requests != null ? `${num(p.remaining_requests)} requests today` : '–'}</dd>
          <dd class="kpi-note">${p.remaining_tokens != null ? `${num(p.remaining_tokens)} of ${num(p.limit_tokens)} tokens this minute, ${freePlan ? 'free plan' : 'paid plan'}` : 'Shown after the next request'}</dd></div>
        <div data-level="${waiting < 200 ? 'good' : waiting < 2000 ? 'watch' : 'bad'}"><dt>Recent posts waiting</dt><dd>${num(waiting)}</dd>
          <dd class="kpi-note">Published in the last 48 h, not read yet</dd></div>
        <div data-level="${total24 && errors24 / total24 > 0.05 ? 'watch' : 'good'}"><dt>Errors in 24 h</dt><dd>${num(errors24)}</dd>
          <dd class="kpi-note">${total24 ? `${(errors24 / total24 * 100).toFixed(1)}% of ${num(total24)} posts read` : 'No post read yet'}</dd></div>`;
    }
    const notice = $('groqNotice');
    if (notice) {
      const lines = [];
      if (freePlan) lines.push('Groq is on the free plan: about 250 posts a day. Add a card on console.groq.com to read everything.');
      if (limited) lines.push(`Groq refused requests for quota at ${et(p.last_rate_limited_at, true)} ET. The worker waits and retries by itself.`);
      notice.hidden = !lines.length;
      notice.textContent = lines.join(' ');
    }

    // pace chart, 24 hourly bars
    const byHour = new Map();
    for (const row of hourly) {
      const h = byHour.get(row.hour) || { complete: 0, no_crypto: 0, error: 0 };
      h[row.status] = (h[row.status] || 0) + Number(row.n || 0);
      byHour.set(row.hour, h);
    }
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const hours = [];
    for (let i = 23; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 3600000).toISOString().slice(0, 13) + ':00:00Z';
      hours.push([t, byHour.get(t) || { complete: 0, no_crypto: 0, error: 0 }]);
    }
    const max = Math.max(1, ...hours.map(([, h]) => h.complete + h.no_crypto + h.error));
    const bars = $('groqBars');
    if (bars) {
      bars.innerHTML = hours.map(([t, h]) => {
        const label = `${et(t, true)} ET: ${num(h.complete)} with a coin, ${num(h.no_crypto)} without, ${num(h.error)} errors`;
        return `<span class="pace-bar" title="${esc(label)}">
          <i class="bar-error" style="height:${(h.error / max) * 100}%"></i><i class="bar-none" style="height:${(h.no_crypto / max) * 100}%"></i><i class="bar-crypto" style="height:${(h.complete / max) * 100}%"></i></span>`;
      }).join('');
    }
    const axis = $('groqAxis');
    if (axis) axis.innerHTML = hours.map(([t], i) => `<span>${i % 6 === 0 ? esc(et(t, true).replace(':00', '')) : ''}</span>`).join('');
    const paceTotal = $('groqPaceTotal');
    if (paceTotal) paceTotal.textContent = `${num(total24)} in 24 h, live posts and catch-up together. Highest hour: ${num(max)}.`;

    renderCatchup($('groqCatchup'), true);
    renderCatchup($('overviewCatchupBody'), false);

    const errorsEl = $('groqErrors');
    const errorsTitle = $('groqErrorsTitle');
    const recent = groq.recentErrors || [];
    if (errorsTitle) errorsTitle.textContent = recent.length ? `Latest errors (${recent.length})` : 'Latest errors (none)';
    if (errorsEl) {
      errorsEl.innerHTML = recent.length ? recent.map((e) => `
        <li><time>${et(e.analyzed_at)}</time><span>@${esc(e.username)}</span><span>${esc(errorKind(e.error))}</span></li>`).join('')
        : '<li>No recent error.</li>';
    }
    const updated = $('groqUpdated');
    if (updated) updated.textContent = `${updatedText(groq.generatedAt)}, refreshed every 30 s`;
  }

  const BATCH_STATUS = {
    exported: 'Waiting to be sent', validating: 'Being checked by Groq', in_progress: 'Running', finalizing: 'Finishing',
    completed: 'Done, being stored', imported: 'Done', failed: 'Failed, will be sent again', expired: 'Expired', expired_imported: 'Partly done', cancelled: 'Cancelled'
  };

  function renderCatchup(target, withTable) {
    if (!target || !groq) return;
    const t = groq.batches?.totals || {};
    const items = [...(groq.batches?.items || [])].sort((a, b) => String(a.file_name).localeCompare(String(b.file_name)));
    const overviewCard = withTable ? null : $('overviewCatchup');
    if (overviewCard) overviewCard.hidden = !items.length;
    if (!items.length) {
      target.innerHTML = withTable ? '<p class="g-hint">No catch-up running. Old posts are read in batches when Groq is on a paid plan.</p>' : '';
      return;
    }
    const requests = Number(t.requests || 0);
    const done = Number(t.completed || 0);
    const share = pct(done, requests);
    const finished = items.every((b) => ['imported', 'expired_imported', 'cancelled'].includes(b.status));
    const head = `
      <div class="catchup-head">
        <strong>${finished ? 'Catch-up finished' : `Catch-up: ${share}%`}</strong>
        <span>${num(done)} of ${num(requests)} old posts read</span>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}" aria-label="Catch-up progress"><i style="width:${share}%"></i></div>
      <dl class="catchup-facts">
        <div><dt>Batches</dt><dd>${num(items.filter((b) => b.status === 'imported').length)} done, ${num(t.running)} running, ${num(t.waitingToSend)} waiting</dd></div>
        <div><dt>Calls found</dt><dd>${num(t.signals)}</dd></div>
        <div><dt>Cost so far</dt><dd>${usd(t.costUsd)}</dd></div>
      </dl>`;
    if (!withTable) {
      target.innerHTML = `${head}<a class="pipeline-link" href="#garage/analysis">See the batches</a>`;
      return;
    }
    const name = (file) => { const m = String(file).match(/-(\d{3})\.jsonl$/); return m ? `Batch ${Number(m[1])}` : file; };
    target.innerHTML = `${head}
      <details class="g-disclosure">
        <summary>All ${items.length} batches</summary>
        <div class="journal-table-wrap">
          <table class="batch-table">
            <thead><tr><th scope="col">Batch</th><th scope="col">Status</th><th scope="col">Progress</th><th scope="col">Posts stored</th><th scope="col">Calls</th><th scope="col">Cost</th><th scope="col">Sent (ET)</th><th scope="col">Finished (ET)</th></tr></thead>
            <tbody>${items.map((b) => {
              const share2 = pct(Number(b.completed || 0), Number(b.requests || 0));
              return `<tr data-status="${esc(b.status)}">
                <th scope="row" title="${esc(b.file_name)}">${esc(name(b.file_name))}</th>
                <td>${esc(BATCH_STATUS[b.status] || b.status)}${b.last_error ? `<small>${esc(String(b.last_error).slice(0, 120))}</small>` : ''}</td>
                <td><span class="progress progress-small"><i style="width:${share2}%"></i></span><small>${num(b.completed)} of ${num(b.requests)}</small></td>
                <td>${num(b.imported)}</td><td>${num(b.signals)}</td><td>${b.cost_usd ? usd(b.cost_usd) : '–'}</td>
                <td>${et(b.submitted_at)}</td><td>${et(b.finished_at)}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </details>`;
  }

  async function loadGroq() {
    try {
      groq = await api('/api/monitor/groq');
      renderGroq();
    } catch {
      const updated = $('groqUpdated');
      if (updated) updated.textContent = 'AI data unavailable right now';
    }
  }

  // ---------- Journal of calls ----------
  const journal = { rows: [], next: null, loading: false, loaded: false };
  const JOURNAL_PAGE = 50;
  const windowStatusText = {
    scored: 'Scored', historical_pending: 'Waiting for price', detected: 'Waiting', waiting_day: 'Running',
    waiting_week: 'Running', waiting_month: 'Running', price_start_error: 'No entry price',
    price_history_error: 'No price history', rejected: 'Rejected'
  };
  function price(value) {
    if (value === null || value === undefined) return '–';
    const n = Number(value);
    if (!Number.isFinite(n)) return '–';
    const digits = n >= 100 ? 2 : n >= 1 ? 4 : 8;
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;
  }
  function minutes(value) {
    if (value === null || value === undefined) return '–';
    const m = Number(value);
    if (!Number.isFinite(m)) return '–';
    if (Math.abs(m) < 120) return `${Math.round(m)} min`;
    if (Math.abs(m) < 2880) return `${(m / 60).toFixed(1)} h`;
    return `${(m / 1440).toFixed(1)} d`;
  }
  function robotName(session) {
    const robot = army?.robots?.find((r) => r.session_name === session);
    if (robot) return robot.label;
    return session ? 'Retired robot' : '–';
  }
  function windowCell(w, label) {
    const tag = `data-label="${esc(label)}"`;
    if (!w) return `<td class="jw jw-none" ${tag}>–</td>`;
    const status = String(w.status || '');
    if (status === 'scored') {
      const score = Number(w.score);
      const tone = score >= 60 ? 'good' : score <= 40 ? 'bad' : 'flat';
      const variation = Number(w.variationPct);
      return `<td class="jw jw-${tone}" ${tag}><strong>${Number.isFinite(score) ? score.toFixed(1) : '–'}</strong>` +
        `<small>${Number.isFinite(variation) ? `${variation >= 0 ? '+' : ''}${variation.toFixed(2)}%` : ''}</small><small>${price(w.exitPrice)}</small></td>`;
    }
    const isError = status.endsWith('_error');
    return `<td class="jw ${isError ? 'jw-error' : 'jw-wait'}" ${tag}><span class="jw-pill">${esc(windowStatusText[status] || status)}</span>` +
      `<small>${isError ? esc(w.error || '') : w.targetAt ? `Due ${et(w.targetAt)}` : 'No entry price yet'}</small></td>`;
  }
  function entryCell(row) {
    const first = (row.windows || []).find((w) => w.entryPrice !== null && w.entryPrice !== undefined);
    if (!first) return '<td class="je" data-label="Entry">No entry price yet</td>';
    return `<td class="je" data-label="Entry"><strong>${price(first.entryPrice)}</strong><small>${et(first.entryAt)}</small>` +
      `<small class="${first.wellTimed ? 'je-ok' : 'je-late'}">${first.wellTimed ? 'On time' : 'Late'}, +${minutes(first.entryLagMinutes)}</small></td>`;
  }
  function journalDetail(row) {
    const windows = (row.windows || []).map((w) => `
      <tr><th scope="row">${esc(w.label || w.horizon)}</th><td>${esc(windowStatusText[w.status] || w.status)}</td><td>${price(w.entryPrice)}</td><td>${et(w.entryAt)}</td>
      <td>${minutes(w.entryLagMinutes)}</td><td>${et(w.targetAt)}</td><td>${price(w.exitPrice)}</td><td>${et(w.exitAt)}</td>
      <td>${w.variationPct ?? '–'}</td><td>${w.score ?? '–'}</td><td>${esc(w.error || '')}</td></tr>`).join('');
    return `
      <tr class="journal-detail"><td colspan="8">
        <blockquote>${esc(row.post?.text || 'The text of this post was not stored.')}</blockquote>
        <dl class="journal-facts">
          <div><dt>Thesis</dt><dd>${esc(row.thesis || '–')}</dd></div>
          <div><dt>Confidence</dt><dd>${Math.round(Number(row.confidence || 0) * 100)}%</dd></div>
          <div><dt>Coin id</dt><dd><code>${esc(row.coinId || '–')}</code></dd></div>
          <div><dt>Posted</dt><dd>${et(row.post?.postedAt)} ET</dd></div>
          <div><dt>Collected</dt><dd>${et(row.post?.scrapedAt)} ET, after ${minutes(row.post?.scrapeDelayMinutes)}</dd></div>
          <div><dt>Read by the AI</dt><dd>${et(row.analysis?.analyzedAt)} ET, after ${minutes(row.analysis?.delayAfterScrapeMinutes)} (${esc(row.analysis?.model || '–')})</dd></div>
          <div><dt>Robot</dt><dd>${esc(robotName(row.robot?.session))}</dd></div>
          <div><dt>References</dt><dd>Call ${row.id}, post ${row.post?.id ?? '–'}, job ${row.robot?.jobId ?? '–'}</dd></div>
        </dl>
        ${row.post?.url ? `<p><a href="${esc(row.post.url)}" target="_blank" rel="noopener noreferrer">Open the post on X</a></p>` : ''}
        <div class="journal-table-wrap"><table class="journal-subtable">
          <thead><tr><th scope="col">Window</th><th scope="col">Status</th><th scope="col">Entry</th><th scope="col">Entry at</th><th scope="col">Entry delay</th><th scope="col">Due</th><th scope="col">Exit</th><th scope="col">Exit at</th><th scope="col">Change %</th><th scope="col">Score</th><th scope="col">Error</th></tr></thead>
          <tbody>${windows}</tbody></table></div>
      </td></tr>`;
  }
  function renderJournalRows() {
    const body = $('journalRows');
    if (!body) return;
    if (!journal.rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="g-empty">No call matches these filters. Try a longer period.</td></tr>';
      return;
    }
    body.innerHTML = journal.rows.map((row, index) => {
      const byHorizon = Object.fromEntries((row.windows || []).map((w) => [w.horizon, w]));
      const side = String(row.direction || '').toLowerCase() === 'bearish' ? 'bear' : 'bull';
      return `
        <tr class="journal-row" data-index="${index}" tabindex="0" aria-expanded="false">
          <td class="jt">${et(row.post?.postedAt)}</td>
          <td class="ju">@${esc(row.username)}</td>
          <td class="jc"><strong>${esc(row.symbol)}</strong> <span class="side side-${side}">${side === 'bull' ? 'Long' : 'Short'}</span><small>${Math.round(Number(row.confidence || 0) * 100)}% confidence</small></td>
          ${entryCell(row)}
          ${windowCell(byHorizon.day, '1 day')}${windowCell(byHorizon.week, '1 week')}${windowCell(byHorizon.month, '1 month')}
          <td class="jp"><small>${esc(robotName(row.robot?.session))}</small><small>Collected after ${minutes(row.post?.scrapeDelayMinutes)}</small><small>Read after ${minutes(row.analysis?.delayAfterScrapeMinutes)}</small></td>
        </tr>`;
    }).join('');
  }
  function journalParams() {
    const form = $('journalFilters');
    const data = new FormData(form);
    const params = new URLSearchParams({ take: String(JOURNAL_PAGE), sort: 'posted' });
    for (const key of ['status', 'coin', 'username', 'hours']) {
      const value = String(data.get(key) || '').trim().replace(/^@/, '');
      if (value) params.set(key, value);
    }
    return params;
  }
  async function loadJournal(append) {
    const body = $('journalRows');
    const more = $('journalMore');
    if (journal.loading || !body) return;
    journal.loading = true;
    try {
      const params = journalParams();
      if (append && journal.next?.cursor) params.set('cursor', journal.next.cursor);
      else if (append && journal.next?.before) params.set('before', String(journal.next.before));
      if (!append) body.innerHTML = '<tr><td colspan="8" class="g-empty">Loading the calls…</td></tr>';
      const data = await api(`/api/monitor/journal?${params.toString()}`);
      journal.rows = append ? journal.rows.concat(data.rows || []) : (data.rows || []);
      journal.next = data.nextCursor ? { cursor: data.nextCursor } : data.nextBeforeId ? { before: data.nextBeforeId } : null;
      journal.loaded = true;
      if (more) more.hidden = !journal.next;
      renderJournalRows();
      const updated = $('journalUpdated');
      const order = data.sort === 'posted' ? 'newest post first' : 'newest first';
      if (updated) updated.textContent = `${num(journal.rows.length)} call${journal.rows.length === 1 ? '' : 's'} shown, ${order}`;
    } catch (error) {
      if (!append) body.innerHTML = `<tr><td colspan="8" class="g-empty">The journal is unavailable right now (${esc(error?.message || 'error')}).</td></tr>`;
    } finally {
      journal.loading = false;
    }
  }
  function exportJournal() {
    const header = ['call_id', 'posted_at', 'scraped_at', 'analysed_at', 'influencer', 'symbol', 'coin_id', 'side', 'confidence', 'thesis', 'tweet_url', 'robot',
      ...['day', 'week', 'month'].flatMap((h) => [`${h}_status`, `${h}_entry_price`, `${h}_entry_at`, `${h}_entry_lag_min`, `${h}_exit_price`, `${h}_exit_at`, `${h}_variation_pct`, `${h}_score`, `${h}_error`])];
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = journal.rows.map((row) => {
      const byHorizon = Object.fromEntries((row.windows || []).map((w) => [w.horizon, w]));
      return [row.id, row.post?.postedAt, row.post?.scrapedAt, row.analysis?.analyzedAt, row.username, row.symbol, row.coinId, row.direction, row.confidence, row.thesis, row.post?.url,
        robotName(row.robot?.session),
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
  function bindJournal() {
    const form = $('journalFilters');
    const body = $('journalRows');
    form?.addEventListener('submit', (event) => { event.preventDefault(); void loadJournal(false); });
    form?.addEventListener('change', (event) => { if (event.target.name === 'hours' || event.target.name === 'status') void loadJournal(false); });
    $('journalMore')?.addEventListener('click', () => void loadJournal(true));
    $('journalExport')?.addEventListener('click', exportJournal);
    const toggle = (rowEl) => {
      const open = rowEl.getAttribute('aria-expanded') === 'true';
      const next = rowEl.nextElementSibling;
      if (open && next?.classList.contains('journal-detail')) next.remove();
      if (!open) rowEl.insertAdjacentHTML('afterend', journalDetail(journal.rows[Number(rowEl.dataset.index)]));
      rowEl.setAttribute('aria-expanded', String(!open));
    };
    body?.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      const rowEl = event.target.closest('.journal-row');
      if (rowEl) toggle(rowEl);
    });
    body?.addEventListener('keydown', (event) => {
      const rowEl = event.target.closest('.journal-row');
      if (rowEl && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(rowEl); }
    });
  }

  // ---------- start ----------
  bindRobots();
  bindJournal();
  window.addEventListener('hashchange', route);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route, { once: true });
  else route();
})();
