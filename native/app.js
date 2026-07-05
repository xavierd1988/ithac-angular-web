(() => {
  'use strict';

  const API_BASE = resolveApiBaseUrl();
  const FETCH_TIMEOUT_MS = 8_000;
  const REPUTATION_WINDOWS = [
    { key: 'day', label: '1 DAY' },
    { key: 'week', label: '1 WEEK' },
    { key: 'month', label: '1 MONTH' }
  ];
  const state = {
    pageIndex: 0,
    pageSize: 250,
    query: '',
    status: 'all',
    priorityOnly: false,
    snapshotSeq: 0,
    refreshTimer: null,
    clockTimer: null,
    eventSource: null,
    liveTransport: 'connecting',
    lastSnapshotAt: null,
    selectedUsername: null,
    selectedSignal: null,
    selectedReputation: null,
    activeTab: 'live',
    selectedPosts: new Map(),
    run: null,
    page: { pageIndex: 0, pageSize: 250, total: 0, items: [] },
    sessions: [],
    proxies: [],
    jobs: [],
    events: [],
    timex: [],
    reputationWindow: 'day',
    reputation: {
      day: [],
      week: [],
      month: []
    },
    loadError: null
  };

  const els = {
    menuToggle: byId('menuToggle'),
    menuClose: byId('menuClose'),
    menuBackdrop: byId('menuBackdrop'),
    controlPopover: byId('controlPopover'),
    menuSummary: byId('menuSummary'),
    runPill: byId('runPill'),
    runState: byId('runState'),
    runProgress: byId('runProgress'),
    scannerTitle: byId('scannerTitle'),
    scannerMeta: byId('scannerMeta'),
    loopMonitor: byId('loopMonitor'),
    loopTitle: byId('loopTitle'),
    loopMeta: byId('loopMeta'),
    addForm: byId('addForm'),
    handleInput: byId('handleInput'),
    searchInput: byId('searchInput'),
    scrapeButton: byId('scrapeButton'),
    listRange: byId('listRange'),
    listStats: byId('listStats'),
    pageStatus: byId('pageStatus'),
    pageNumbers: byId('pageNumbers'),
    prevPage: byId('prevPage'),
    nextPage: byId('nextPage'),
    pageSize: byId('pageSize'),
    loadError: byId('loadError'),
    list: byId('list'),
    mainTabs: document.querySelectorAll('[data-tab]'),
    pager: document.querySelector('.pager'),
    modalRoot: byId('modalRoot')
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    closeMenu();
    window.addEventListener('pageshow', closeMenu);
    els.menuToggle.addEventListener('click', toggleMenu);
    els.menuClose.addEventListener('click', closeMenu);
    els.menuBackdrop.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });
    els.addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void addInfluencer();
    });
    els.searchInput.addEventListener('input', debounce(() => {
      state.query = els.searchInput.value.trim();
      state.pageIndex = 0;
      void loadSnapshot({ resetListScroll: true });
    }, 220));
    els.scrapeButton.addEventListener('click', () => void startRun());
    els.prevPage.addEventListener('click', () => goToPage(state.pageIndex - 1));
    els.nextPage.addEventListener('click', () => goToPage(state.pageIndex + 1));
    els.pageSize.addEventListener('change', () => {
      state.pageSize = Number(els.pageSize.value) || 250;
      state.pageIndex = 0;
      void loadSnapshot({ resetListScroll: true });
    });
    els.mainTabs.forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab || 'live'));
    });

    closeMenu();
    startClock();
    void loadSnapshot({ resetListScroll: false });
    connectLiveEvents();
  }

  function resolveApiBaseUrl() {
    const configured = window.ITHAC_API_BASE_URL?.trim();
    if (configured) return configured.replace(/\/+$/, '');
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:5088';
    if (host === 'ithacapp.com' || host === 'www.ithacapp.com') return 'https://178.105.42.115.sslip.io';
    return '';
  }

  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing #${id}`);
    return node;
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function getJson(path) {
    const sep = path.includes('?') ? '&' : '?';
    return fetchJson(apiUrl(`${path}${sep}_=${Date.now()}`));
  }

  async function postJson(path, body) {
    return fetchJson(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    });
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        ...options,
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...(options.headers ?? {})
        }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`timeout after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadSnapshot(options = {}) {
    const requestId = ++state.snapshotSeq;
    const query = new URLSearchParams({
      query: state.query,
      status: state.status,
      priorityOnly: String(state.priorityOnly),
      pageIndex: String(state.pageIndex),
      pageSize: String(state.pageSize)
    });

    try {
      const snapshot = await getJson(`/api/dashboard/snapshot?${query.toString()}`);
      const [posts, jobs] = await Promise.all([
        getJson('/api/posts/recent?take=160').catch(() => []),
        getJson('/api/jobs/recent?take=220').catch(() => [])
      ]);
      void loadCryptoPanels();
      if (requestId !== state.snapshotSeq) return;

      state.loadError = null;
      state.run = snapshot.run;
      state.page = snapshot.influencerPage;
      state.pageIndex = clampPageIndex(snapshot.influencerPage.pageIndex, snapshot.influencerPage.total, snapshot.influencerPage.pageSize);
      state.pageSize = snapshot.influencerPage.pageSize;
      state.sessions = snapshot.sessions ?? [];
      state.proxies = snapshot.proxies ?? [];
      state.jobs = jobs.length ? jobs : (snapshot.jobs ?? []);
      state.events = snapshot.events ?? [];
      state.lastSnapshotAt = new Date();
      hydrateSelectedPostsFromRecent(posts);
      renderAll();
      if (options.resetListScroll) els.list.scrollTop = 0;
    } catch (error) {
      if (requestId !== state.snapshotSeq) return;
      const fallbackLoaded = await loadInfluencerFallback(requestId, error, options);
      if (fallbackLoaded) return;
      state.loadError = error instanceof Error ? error.message : 'Unable to load live data';
      renderAll();
    }
  }

  async function loadCryptoPanels() {
    try {
      const [timex, repDay, repWeek, repMonth] = await Promise.all([
        getJson('/api/crypto/timex?take=160').catch(() => []),
        getJson('/api/crypto/reputation?window=day&take=160').catch(() => []),
        getJson('/api/crypto/reputation?window=week&take=160').catch(() => []),
        getJson('/api/crypto/reputation?window=month&take=160').catch(() => [])
      ]);
      state.timex = Array.isArray(timex) ? timex : [];
      state.reputation = {
        day: Array.isArray(repDay) ? repDay : [],
        week: Array.isArray(repWeek) ? repWeek : [],
        month: Array.isArray(repMonth) ? repMonth : []
      };
      renderAll();
    } catch {
      state.timex = [];
      state.reputation = { day: [], week: [], month: [] };
      renderAll();
    }
  }

  async function loadInfluencerFallback(requestId, originalError, options = {}) {
    try {
      const query = new URLSearchParams({
        pageIndex: String(state.pageIndex),
        pageSize: String(state.pageSize)
      });
      const items = await getJson(`/api/influencers?${query.toString()}`);
      if (requestId !== state.snapshotSeq) return true;
      const rows = Array.isArray(items) ? items : (items.items ?? []);
      state.loadError = `Dashboard snapshot unavailable; showing direct influencer list (${originalError instanceof Error ? originalError.message : 'fallback'})`;
      state.page = {
        pageIndex: state.pageIndex,
        pageSize: state.pageSize,
        total: rows.length < state.pageSize ? state.pageIndex * state.pageSize + rows.length : Math.max(state.page.total, state.pageIndex * state.pageSize + rows.length),
        items: rows
      };
      state.jobs = [];
      state.events = [];
      state.lastSnapshotAt = new Date();
      renderAll();
      if (options.resetListScroll) els.list.scrollTop = 0;
      return true;
    } catch {
      return false;
    }
  }

  function hydrateSelectedPostsFromRecent(posts) {
    if (!state.selectedUsername) return;
    const key = state.selectedUsername.toLowerCase();
    if (state.selectedPosts.has(key)) return;
    const filtered = posts.filter((post) => post.username?.toLowerCase() === key);
    if (filtered.length) state.selectedPosts.set(key, filtered);
  }

  function connectLiveEvents() {
    if (typeof EventSource === 'undefined') {
      state.liveTransport = 'polling';
      startPolling(2500);
      return;
    }

    try {
      const source = new EventSource(apiUrl('/api/live/events'));
      state.eventSource = source;
      state.liveTransport = 'sse';
      source.onmessage = () => void loadSnapshot({ resetListScroll: false });
      source.onerror = () => {
        state.liveTransport = 'polling';
        renderTop();
        startPolling(2500);
      };
    } catch {
      state.liveTransport = 'polling';
      startPolling(2500);
    }
  }

  function startPolling(ms) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => void loadSnapshot({ resetListScroll: false }), ms);
  }

  function startClock() {
    clearInterval(state.clockTimer);
    state.clockTimer = setInterval(renderAll, 30_000);
  }

  function renderAll() {
    renderTop();
    renderTabs();
    renderPager();
    renderList();
    renderModal();
  }

  function setTab(tab) {
    const next = ['live', 'timex', 'reputation'].includes(tab) ? tab : 'live';
    if (state.activeTab === next) return;
    state.activeTab = next;
    state.selectedUsername = null;
    state.selectedSignal = null;
    state.selectedReputation = null;
    renderAll();
  }

  function renderTabs() {
    els.mainTabs.forEach((button) => {
      const active = button.dataset.tab === state.activeTab;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function renderTop() {
    const run = state.run;
    const total = run?.loadedCount || run?.targetCount || state.page.total || 0;
    const done = run?.successCount ?? 0;
    const running = run?.runningCount ?? 0;
    const failed = run?.failedCount ?? 0;
    const queued = run?.queuedCount ?? Math.max(0, total - done - running - failed);
    const status = normalizeRunStatus(run?.status);
    const active = activeJob();
    const event = latestEvent();
    const eventUser = usernameFromText(event?.text);
    const resources = `${availableCount(state.sessions)}/${state.sessions.length} sessions · ${availableCount(state.proxies)}/${state.proxies.length} proxies`;

    els.runPill.className = `run-pill ${status}`;
    els.runState.textContent = status === 'running' ? 'scraping live' : status;
    els.runProgress.textContent = `${done}/${Math.max(total, 1)}`;
    els.menuSummary.textContent = status === 'running'
      ? `${done}/${Math.max(total, 1)} · ${running} running`
      : `${done}/${Math.max(total, 1)} · ${status}`;

    if (active) {
      const rowPos = rowPosition(active.username);
      els.scannerTitle.textContent = `now @${active.username}`;
      els.scannerMeta.textContent = `${rowPos} · ${resourceText(active)} · ${formatTime(active.startedAt || active.updatedAt)}`;
      els.loopMonitor.className = 'loop-monitor running';
      els.loopTitle.textContent = `SCRAPING @${active.username}`;
      els.loopMeta.textContent = `${done}/${Math.max(total, 1)} done · ${running} running · ${queued} queued · ${failed} failed · ${resourceText(active)} · ${resources}`;
      return;
    }

    if (status === 'running') {
      const label = eventUser ? `last @${eventUser}` : `Run #${run?.id ?? '-'} active`;
      els.scannerTitle.textContent = label;
      els.scannerMeta.textContent = event
        ? `${done}/${Math.max(total, 1)} done · ${event.text} · ${event.at}`
        : `${done}/${Math.max(total, 1)} done · waiting for next account`;
      els.loopMonitor.className = 'loop-monitor running';
      els.loopTitle.textContent = `RUN #${run?.id ?? '-'} · LOOP ACTIVE`;
      els.loopMeta.textContent = `${done}/${Math.max(total, 1)} done · ${running} running · ${queued} queued · ${failed} failed · ${resources}${event ? ` · latest: ${event.text} · ${event.at}` : ''}`;
      return;
    }

    els.scannerTitle.textContent = eventUser ? `last @${eventUser}` : 'idle';
    els.scannerMeta.textContent = event ? `${event.text} · ${event.at}` : 'no active scrape';
    els.loopMonitor.className = 'loop-monitor';
    els.loopTitle.textContent = 'SCANNER IDLE';
    els.loopMeta.textContent = `${done}/${Math.max(total, 1)} done · ${failed} failed · ${resources}`;
  }

  function renderPager() {
    els.pager.hidden = state.activeTab !== 'live';
    if (state.activeTab !== 'live') {
      els.listRange.textContent = state.activeTab === 'timex'
        ? `${state.timex.length} signals`
        : `${currentReputationRows().length} aliases · ${reputationWindowLabel(state.reputationWindow)}`;
      return;
    }
    const total = state.page.total || 0;
    const pageSize = state.page.pageSize || state.pageSize;
    const pageCount = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
    const pageIndex = clampPageIndex(state.pageIndex, total, pageSize);
    const start = total ? pageIndex * pageSize + 1 : 0;
    const end = Math.min(total, start + pageSize - 1);
    const run = state.run;

    els.listRange.textContent = `${start}-${end} visible · ${total} handles`;
    els.listStats.textContent = `${run?.successCount ?? 0} complete · ${run?.failedCount ?? 0} failed`;
    els.pageStatus.textContent = `Page ${pageIndex + 1} / ${pageCount}`;
    els.prevPage.disabled = pageIndex <= 0;
    els.nextPage.disabled = pageIndex >= pageCount - 1;
    els.pageSize.value = String(pageSize);

    els.pageNumbers.replaceChildren(...pageButtonNodes(pageIndex, pageCount));
    els.loadError.hidden = !state.loadError;
    els.loadError.textContent = state.loadError ? `Live API not loaded: ${state.loadError}` : '';
  }

  function toggleMenu() {
    if (els.controlPopover.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  }

  function openMenu() {
    els.controlPopover.hidden = false;
    els.menuBackdrop.hidden = false;
    els.menuToggle.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    els.controlPopover.hidden = true;
    els.menuBackdrop.hidden = true;
    els.menuToggle.setAttribute('aria-expanded', 'false');
  }

  function pageButtonNodes(activePage, pageCount) {
    const pages = visiblePages(activePage, pageCount);
    return pages.map((page) => {
      if (page === 'gap') {
        const span = document.createElement('span');
        span.className = 'page-gap';
        span.textContent = '...';
        return span;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(page + 1);
      button.className = page === activePage ? 'active' : '';
      if (page === activePage) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => goToPage(page));
      return button;
    });
  }

  function visiblePages(activePage, pageCount) {
    if (pageCount <= 15) return Array.from({ length: pageCount }, (_, i) => i);
    const set = new Set([0, 1, pageCount - 2, pageCount - 1]);
    for (let i = activePage - 3; i <= activePage + 3; i += 1) {
      if (i >= 0 && i < pageCount) set.add(i);
    }
    const sorted = [...set].sort((a, b) => a - b);
    const out = [];
    for (const page of sorted) {
      if (out.length && page - out[out.length - 1] > 1) out.push('gap');
      out.push(page);
    }
    return out;
  }

  function renderList() {
    if (state.activeTab === 'timex') {
      renderTimex();
      return;
    }
    if (state.activeTab === 'reputation') {
      renderReputation();
      return;
    }
    const rows = state.page.items ?? [];
    if (!rows.length) {
      const empty = document.createElement('article');
      empty.className = 'empty';
      empty.innerHTML = `<strong>No handle</strong><br><span>${escapeHtml(state.loadError ? 'The backend did not answer this browser yet.' : 'No influencer on this page.')}</span>`;
      els.list.replaceChildren(empty);
      return;
    }

    const nodes = [];
    rows.forEach((row, index) => {
      nodes.push(renderRow(row, state.pageIndex * state.pageSize + index + 1));
      if (state.selectedUsername?.toLowerCase() === row.username.toLowerCase()) {
        nodes.push(renderDetail(row));
      }
    });
    els.list.replaceChildren(...nodes);
  }

  function renderTimex() {
    const rows = state.timex;
    if (!rows.length) {
      els.list.replaceChildren(emptyNode('No TIMEX signal', 'Signals will appear when Groq extracts crypto mentions and the 6h window starts.'));
      return;
    }
    els.list.replaceChildren(...rows.map((signal, index) => renderSignalRow(signal, index + 1)));
  }

  function renderSignalRow(signal, rank) {
    const row = document.createElement('article');
    row.className = `timex-row ${scoreClass(signal.score)} ${signal.status || ''}`;
    const progress = Number(signal.window?.progressPct ?? 0);
    row.innerHTML = `
      <span class="rank">${rank}</span>
      <section class="signal-main">
        <div class="signal-line">
          <strong>${escapeHtml(signal.serialRef || `#${signal.id}`)}</strong>
          <em>@${escapeHtml(signal.username || '-')} · ${escapeHtml(signal.symbol || '-')}</em>
        </div>
        <div class="progress-track signal-progress"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>
        <p>${escapeHtml(windowText(signal))}</p>
      </section>
      <span class="signal-score ${scoreClass(signal.score)}">${formatScore(signal.score)}</span>
      <span class="signal-var ${scoreClass(signal.score)}">${formatVariation(signal.variationPct)}</span>
    `;
    row.addEventListener('click', () => {
      state.selectedSignal = signal;
      renderModal();
    });
    return row;
  }

  function renderReputation() {
    const rows = currentReputationRows();
    const nodes = [renderReputationSwitcher()];
    if (!rows.length) {
      nodes.push(emptyNode('No reputation yet', `${reputationWindowLabel(state.reputationWindow)} competition will appear after scored crypto windows.`));
      els.list.replaceChildren(...nodes);
      return;
    }
    els.list.replaceChildren(...nodes, ...rows.map((row, index) => renderReputationRow(row, row.rank || index + 1)));
  }

  function currentReputationRows() {
    return state.reputation?.[state.reputationWindow] ?? [];
  }

  function reputationWindowLabel(key) {
    return REPUTATION_WINDOWS.find((item) => item.key === key)?.label ?? '1 DAY';
  }

  function renderReputationSwitcher() {
    const wrap = document.createElement('section');
    wrap.className = 'reputation-switcher';
    wrap.innerHTML = `
      <div>
        <strong>Reputation competitions</strong>
        <span>Three independent rankings. Same influencer can compete in day, week and month at the same time.</span>
      </div>
      <div class="reputation-window-buttons">
        ${REPUTATION_WINDOWS.map((item) => `
          <button type="button" data-reputation-window="${escapeAttr(item.key)}" class="${state.reputationWindow === item.key ? 'active' : ''}">
            ${escapeHtml(item.label)}
            <em>${(state.reputation?.[item.key] ?? []).length}</em>
          </button>
        `).join('')}
      </div>
    `;
    wrap.querySelectorAll('[data-reputation-window]').forEach((button) => {
      button.addEventListener('click', () => {
        state.reputationWindow = button.dataset.reputationWindow || 'day';
        state.selectedReputation = null;
        renderAll();
      });
    });
    return wrap;
  }

  function renderReputationRow(item, rank) {
    const row = document.createElement('article');
    const score = reputationScore(item);
    row.className = `reputation-row ${scoreClass(score)}`;
    row.innerHTML = `
      <span class="rank">${rank}</span>
      <section class="signal-main">
        <div class="signal-line">
          <strong>@${escapeHtml(item.username || '-')}</strong>
          <em>${reputationWindowLabel(item.window || state.reputationWindow)} · ${Number(item.scoredCount ?? 0)} scored · last ${escapeHtml(item.lastSymbol || '-')} · ${formatMinute(item.lastUpdatedAt)}</em>
        </div>
        <p>Score ${formatScore(score)} · avg ${formatScore(item.averageScore)} · activity ${formatScore(item.activityScore)} · best ${formatScore(item.bestScore)}</p>
      </section>
      <span class="signal-score ${scoreClass(score)}">${formatScore(score)}</span>
    `;
    row.addEventListener('click', () => {
      state.selectedReputation = item;
      renderModal();
    });
    return row;
  }

  function emptyNode(title, body) {
    const empty = document.createElement('article');
    empty.className = 'empty';
    empty.innerHTML = `<strong>${escapeHtml(title)}</strong><br><span>${escapeHtml(body)}</span>`;
    return empty;
  }

  function renderRow(row, rank) {
    const article = document.createElement('article');
    article.className = [
      'influencer-row',
      normalizeJobStatus(row.status),
      isActiveRow(row) ? 'scraping' : '',
      state.selectedUsername?.toLowerCase() === row.username.toLowerCase() ? 'selected' : '',
      row.enabled ? '' : 'disabled'
    ].filter(Boolean).join(' ');
    article.dataset.username = row.username;

    const progress = rowProgress(row);
    const status = rowStatusLabel(row);
    const steps = scrapeSteps(row);
    article.innerHTML = `
      ${isTraceRow(row) ? '<div class="scan-beam"></div>' : ''}
      <div class="row-main">
        <span class="rank">${rank}</span>
        <section class="identity">
          ${avatarHtml(row)}
          <span class="identity-text">
            <strong>${escapeHtml(row.displayName || `@${row.username}`)}</strong>
            <em>@${escapeHtml(row.username)} · ${formatFollowers(row.followersCount)}</em>
          </span>
        </section>
        <section class="progress-cell">
          <div class="row-line">
            <strong>${status}</strong>
            <time>${scrapeMinute(row)}</time>
          </div>
          <p class="row-subline">${rowMeta(row)}</p>
          <div class="progress-track"><span class="${normalizeJobStatus(row.status) === 'failed' ? 'failed' : ''}" style="width:${progress}%"></span></div>
          <div class="steps">${steps.map(stageHtml).join('')}</div>
        </section>
        <span class="status-light ${normalizeJobStatus(row.status)}"><i></i>${status}</span>
      </div>
    `;
    article.addEventListener('click', () => {
      const wasSelected = state.selectedUsername?.toLowerCase() === row.username.toLowerCase();
      state.selectedUsername = wasSelected ? null : row.username;
      renderList();
      if (!wasSelected) void loadPosts(row.username);
    });
    return article;
  }

  function renderDetail(row) {
    const detail = document.createElement('section');
    detail.className = 'detail';
    const job = latestJobFor(row.username);
    const posts = state.selectedPosts.get(row.username.toLowerCase()) ?? [];
    detail.innerHTML = `
      <div class="detail-grid">
        ${detailCard('Scraped minute', scrapeMinute(row))}
        ${detailCard('Started', formatMinute(job?.startedAt || row.lastScrapeStartedAt))}
        ${detailCard('Duration', scrapeDuration(job, row))}
        ${detailCard('Result', `${job?.status || row.status} · ${job?.outcome || row.lastOutcome || '-'}`)}
        ${detailCard('Run', `#${job?.runId || row.lastScrapeRunId || '-'} · ${resourceText(job || row)}`)}
      </div>
      <aside class="scope-card">
        <strong>What the scraper reads</strong>
        <span>Open page = opens/resolves the X profile with the assigned session. Read posts = reads the first timeline window returned by X, currently capped at ${row.lastPostsSeen ?? job?.postsSeen ?? 5}/50 candidate posts. Extract data = keeps usable posts and crypto mentions. Store = writes new posts/mentions to MySQL.</span>
      </aside>
      <div class="posts">
        ${posts.length ? posts.map(postHtml).join('') : '<div class="post"><span>-</span><strong>posts</strong><span>No stored post loaded for this account yet.</span></div>'}
      </div>
    `;
    return detail;
  }

  async function loadPosts(username) {
    const key = username.toLowerCase();
    try {
      const posts = await getJson(`/api/posts/by-influencer/${encodeURIComponent(username)}?take=10`);
      state.selectedPosts.set(key, posts);
      if (state.selectedUsername?.toLowerCase() === key) renderList();
    } catch {
      state.selectedPosts.set(key, []);
      if (state.selectedUsername?.toLowerCase() === key) renderList();
    }
  }

  function goToPage(pageIndex) {
    const total = state.page.total || 0;
    const pageSize = state.page.pageSize || state.pageSize;
    const next = clampPageIndex(pageIndex, total, pageSize);
    if (next === state.pageIndex) return;
    state.pageIndex = next;
    state.selectedUsername = null;
    void loadSnapshot({ resetListScroll: true });
  }

  async function addInfluencer() {
    const raw = els.handleInput.value.trim();
    const username = raw.replace(/^@/, '');
    if (!username) return;
    try {
      await postJson('/api/influencers', { username, priority: true });
      els.handleInput.value = '';
      state.query = '';
      els.searchInput.value = '';
      state.pageIndex = 0;
      await loadSnapshot({ resetListScroll: true });
    } catch (error) {
      state.loadError = error instanceof Error ? error.message : 'Unable to add influencer';
      renderAll();
    }
  }

  async function startRun() {
    try {
      await postJson('/api/runs', { mode: 'Fast' });
      await loadSnapshot({ resetListScroll: false });
    } catch (error) {
      state.loadError = error instanceof Error ? error.message : 'Unable to start run';
      renderAll();
    }
  }

  function activeJob() {
    return state.jobs.find((job) => normalizeJobStatus(job.status) === 'running') ?? null;
  }

  function latestJobFor(username) {
    const lower = username.toLowerCase();
    return state.jobs.find((job) => job.username?.toLowerCase() === lower) ?? null;
  }

  function latestEvent() {
    return state.events[0] ?? null;
  }

  function usernameFromText(text) {
    if (!text) return null;
    const match = text.match(/@([A-Za-z0-9_]{1,30})/);
    return match ? match[1] : null;
  }

  function rowPosition(username) {
    const lower = username.toLowerCase();
    const index = (state.page.items ?? []).findIndex((row) => row.username.toLowerCase() === lower);
    if (index >= 0) return `row ${state.pageIndex * state.pageSize + index + 1}/${state.page.total}`;
    return `not on page ${state.pageIndex + 1}`;
  }

  function isActiveRow(row) {
    const active = activeJob();
    return active?.username?.toLowerCase() === row.username.toLowerCase();
  }

  function isTraceRow(row) {
    const active = activeJob();
    if (active) return active.username?.toLowerCase() === row.username.toLowerCase();
    const user = usernameFromText(latestEvent()?.text);
    return Boolean(user && user.toLowerCase() === row.username.toLowerCase());
  }

  function scrapeSteps(row) {
    const status = normalizeJobStatus(row.status);
    const active = isActiveRow(row);
    const failed = status === 'failed';
    const seen = Number(row.lastPostsSeen ?? 0);
    const stored = Number(row.lastPostsStored ?? 0);
    const mentions = Number(row.lastMentionsFound ?? 0);
    const hasStarted = Boolean(row.lastScrapeStartedAt || active || status === 'success' || failed);
    const hasFinished = Boolean(row.lastScrapeFinishedAt || status === 'success' || failed);
    const readDone = hasFinished || seen > 0;
    const extractDone = readDone;
    const storeDone = hasFinished && !failed;

    return [
      {
        label: 'Open page',
        state: hasStarted ? 'done' : active ? 'active' : 'pending',
        detail: formatMinute(row.lastScrapeStartedAt)
      },
      {
        label: 'Read posts',
        state: failed ? 'failed' : readDone ? 'done' : active ? 'active' : 'pending',
        detail: readDone ? `${seen}/50 posts` : 'timeline cursor'
      },
      {
        label: 'Extract data',
        state: failed ? 'failed' : extractDone ? 'done' : 'pending',
        detail: extractDone ? `${mentions} mentions` : 'waiting'
      },
      {
        label: 'Store',
        state: failed ? 'failed' : storeDone ? 'done' : active ? 'active' : 'pending',
        detail: storeDone ? `${stored} stored` : 'waiting'
      }
    ];
  }

  function stageHtml(step) {
    return `<span class="stage ${step.state}"><i></i><b>${escapeHtml(step.label)}</b><em>${escapeHtml(step.detail || '')}</em></span>`;
  }

  function rowProgress(row) {
    const status = normalizeJobStatus(row.status);
    if (status === 'success') return 100;
    if (status === 'failed') return 100;
    if (isActiveRow(row)) return 42;
    if (row.lastScrapeStartedAt) return 68;
    if (status === 'queued') return 8;
    return 0;
  }

  function rowStatusLabel(row) {
    const status = normalizeJobStatus(row.status);
    if (status === 'success') return 'complete';
    if (status === 'running') return 'running';
    if (status === 'failed') return 'failed';
    if (status === 'paused') return 'paused';
    return 'queued';
  }

  function rowMeta(row) {
    const seen = row.lastPostsSeen ?? 0;
    const stored = row.lastPostsStored ?? 0;
    const mentions = row.lastMentionsFound ?? 0;
    const when = relative(row.lastScrapeFinishedAt || row.lastScrapeUpdatedAt || row.lastScrapeStartedAt);
    const base = `${seen} seen · ${stored} stored · ${mentions} mentions`;
    return when ? `${base} · ${when}` : base;
  }

  function scrapeMinute(row) {
    const time = row.lastScrapeFinishedAt || row.lastScrapeUpdatedAt || row.lastScrapeStartedAt;
    return time ? `${formatMinute(time)} · ${relative(time)}` : 'not scraped yet';
  }

  function detailCard(label, value) {
    return `<div class="detail-card"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
  }

  function postHtml(post) {
    const mentions = (post.mentions ?? []).map((item) => item.symbol ?? item).join(', ') || 'post';
    return `
      <a class="post" href="${escapeAttr(post.url || '#')}" target="_blank" rel="noreferrer">
        <span>${escapeHtml(formatMinute(post.scrapedAt || post.postedAt))}</span>
        <strong>${escapeHtml(mentions)}</strong>
        <span>${escapeHtml(post.content || '')}</span>
      </a>
    `;
  }

  function renderModal() {
    if (state.selectedSignal) {
      els.modalRoot.replaceChildren(signalModal(state.selectedSignal));
      return;
    }
    if (state.selectedReputation) {
      els.modalRoot.replaceChildren(reputationModal(state.selectedReputation));
      return;
    }
    els.modalRoot.replaceChildren();
  }

  function signalModal(signal) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal-card">
        <header>
          <div>
            <span class="eyebrow">TIMEX</span>
            <h2>${escapeHtml(signal.serialRef || `Signal #${signal.id}`)}</h2>
          </div>
          <button type="button" class="menu-close">Close</button>
        </header>
        <div class="signal-graph">
          ${signalGraph(signal)}
        </div>
        <div class="modal-grid">
          ${detailCard('Alias', `@${signal.username || '-'}`)}
          ${detailCard('Coin', signal.symbol || '-')}
          ${detailCard('Status', signal.status || '-')}
          ${detailCard('Variation', formatVariation(signal.variationPct))}
          ${detailCard('Score', formatScore(signal.score))}
          ${detailCard('Window', windowText(signal))}
        </div>
      </section>
    `;
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('button')) {
        state.selectedSignal = null;
        renderModal();
      }
    });
    return backdrop;
  }

  function reputationModal(row) {
    const backdrop = document.createElement('div');
    const history = Array.isArray(row.history) ? row.history : [];
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal-card">
        <header>
          <div>
            <span class="eyebrow">Reputation</span>
            <h2>#${escapeHtml(String(row.rank || '-'))} @${escapeHtml(row.username || '-')}</h2>
          </div>
          <button type="button" class="menu-close">Close</button>
        </header>
        <div class="modal-grid">
          ${detailCard('Competition', reputationWindowLabel(row.window || state.reputationWindow))}
          ${detailCard('Score', formatScore(reputationScore(row)))}
          ${detailCard('Average', formatScore(row.averageScore))}
          ${detailCard('Activity', formatScore(row.activityScore))}
          ${detailCard('Best', formatScore(row.bestScore))}
          ${detailCard('Last', `${formatScore(row.lastScore)} · ${row.lastSymbol || '-'}`)}
          ${detailCard('Scored windows', String(row.scoredCount ?? history.length))}
          ${detailCard('Period', `${formatMinute(row.windowStart)} → ${formatMinute(row.windowEnd)}`)}
        </div>
        <div class="history-list">
          ${history.length ? history.map(historyHtml).join('') : '<p class="empty-inline">No scored history.</p>'}
        </div>
      </section>
    `;
    backdrop.addEventListener('click', (event) => {
      const historyButton = event.target.closest('[data-signal-id]');
      if (historyButton) {
        const signal = history.find((item) => String(item.id) === historyButton.dataset.signalId);
        if (signal) {
          state.selectedReputation = null;
          state.selectedSignal = signal;
          renderModal();
        }
        return;
      }
      if (event.target === backdrop || event.target.closest('button.menu-close')) {
        state.selectedReputation = null;
        renderModal();
      }
    });
    return backdrop;
  }

  function historyHtml(signal) {
    return `
      <button class="history-row ${scoreClass(signal.score)}" type="button" data-signal-id="${escapeAttr(signal.id)}">
        <strong>${escapeHtml(signal.serialRef || `#${signal.id}`)}</strong>
        <span>${escapeHtml(signal.symbol || '-')} · ${formatVariation(signal.variationPct)}</span>
        <em>${formatScore(signal.score)}</em>
      </button>
    `;
  }

  function reputationScore(item) {
    const value = Number(item.competitionScore);
    return Number.isFinite(value) ? value : Number(item.averageScore);
  }

  function signalGraph(signal) {
    const start = Number(signal.startPriceUsd);
    const end = Number(signal.endPriceUsd);
    const hasEnd = Number.isFinite(end);
    const min = Math.min(start || 0, hasEnd ? end : start || 0);
    const max = Math.max(start || 0, hasEnd ? end : start || 0);
    const range = Math.max(max - min, max * 0.01, 1);
    const y1 = 90 - (((start || min) - min) / range) * 58;
    const y2 = hasEnd ? 90 - ((end - min) / range) * 58 : 90;
    const color = scoreClass(signal.score) === 'good' ? '#35d39e' : scoreClass(signal.score) === 'bad' ? '#ff5d6c' : '#ffb020';
    return `
      <svg viewBox="0 0 320 124" role="img" aria-label="Six hour price window">
        <line x1="28" y1="100" x2="292" y2="100"></line>
        <polyline points="42,${y1.toFixed(1)} 278,${y2.toFixed(1)}" style="stroke:${color}"></polyline>
        <circle cx="42" cy="${y1.toFixed(1)}" r="6"></circle>
        <circle cx="278" cy="${y2.toFixed(1)}" r="6"></circle>
        <text x="42" y="118">start ${formatPrice(start)}</text>
        <text x="196" y="118">${hasEnd ? `end ${formatPrice(end)}` : 'waiting end price'}</text>
      </svg>
    `;
  }

  function windowText(signal) {
    const window = signal.window || {};
    if (signal.status === 'waiting_1h') {
      const duration = Number(window.durationMinutes ?? 360);
      const label = window.label || (duration >= 60 ? `${Math.round(duration / 60)}h` : `${duration}m`);
      return `${label} window · ${Math.round(Number(window.progressPct ?? 0))}% · ${Number(window.minutesRemaining ?? 0).toFixed(1)} min left`;
    }
    if (signal.status === 'scored') {
      return `scored · ${formatMinute(signal.startPriceAt)} → ${formatMinute(signal.endPriceAt)}`;
    }
    return signal.status || 'pending';
  }

  function scoreClass(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return 'neutral';
    if (value >= 55) return 'good';
    if (value <= 45) return 'bad';
    return 'neutral';
  }

  function formatScore(score) {
    const value = Number(score);
    return Number.isFinite(value) ? value.toFixed(1) : '-';
  }

  function formatVariation(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    const sign = number > 0 ? '+' : '';
    return `${sign}${number.toFixed(2)}%`;
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    if (number >= 100) return `$${number.toFixed(2)}`;
    if (number >= 1) return `$${number.toFixed(4)}`;
    return `$${number.toPrecision(4)}`;
  }

  function avatarHtml(row) {
    if (row.profileImageUrl) {
      return `<img class="avatar" src="${escapeAttr(row.profileImageUrl)}" alt="@${escapeAttr(row.username)}" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<span class="avatar avatar-fallback">${escapeHtml(row.username.slice(0, 1).toUpperCase())}</span>`;
  }

  function resourceText(item) {
    if (!item) return 'unassigned';
    const session = item.sessionName || item.lastScrapeSessionName;
    const proxy = item.proxyName || item.lastScrapeProxyName;
    return [session, proxy].filter(Boolean).join(' · ') || 'unassigned';
  }

  function scrapeDuration(job, row) {
    const start = job?.startedAt || row.lastScrapeStartedAt;
    const end = job?.finishedAt || row.lastScrapeFinishedAt;
    if (!start || !end) return '-';
    const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
    return `${seconds}s`;
  }

  function availableCount(items) {
    return items.filter((item) => String(item.health || '').toLowerCase() === 'available' && item.enabled !== false).length;
  }

  function normalizeRunStatus(status) {
    const value = String(status || 'idle').toLowerCase();
    if (value === 'running') return 'running';
    if (value === 'paused') return 'paused';
    if (value === 'failed' || value === 'cancelled') return 'failed';
    return 'idle';
  }

  function normalizeJobStatus(status) {
    const value = String(status || 'queued').toLowerCase();
    if (value === 'success') return 'success';
    if (value === 'running') return 'running';
    if (value === 'failed') return 'failed';
    if (value === 'paused') return 'paused';
    return 'queued';
  }

  function formatFollowers(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 'followers -';
    if (n >= 1_000_000) return `${trimNumber(n / 1_000_000)}M followers`;
    if (n >= 1_000) return `${trimNumber(n / 1_000)}K followers`;
    return `${n.toLocaleString()} followers`;
  }

  function trimNumber(value) {
    return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  }

  function formatMinute(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date);
  }

  function relative(value) {
    if (!value) return '';
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  function clampPageIndex(pageIndex, total, pageSize) {
    const count = Math.max(1, Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1)));
    return Math.min(Math.max(0, Number(pageIndex) || 0), count - 1);
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }
})();
