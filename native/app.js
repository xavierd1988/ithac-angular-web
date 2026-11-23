(() => {
  'use strict';

  const API_BASE = resolveApiBase();
  const grading = window.IthacGrading;
  const FETCH_TIMEOUT_MS = 15_000;
  const SNAPSHOT_MIN_INTERVAL_MS = 3_000;
  const CRYPTO_REFRESH_MS = 300_000;
  const POLL_FALLBACK_MS = 5_000;
  // Each tab ranks accounts on their own calls, measured 24 hours, 7 days or 1 month after each call (whole history).
  const REPUTATION_WINDOWS = [
    { key: 'day', label: '24 hours' },
    { key: 'week', label: '7 days' },
    { key: 'month', label: '1 month' }
  ];
  const MINIMUM_RANKED_CALLS = 3;
  const state = {
    pageIndex: 0,
    pagesShown: 1,
    pageSize: 25,
    query: '',
    status: 'all',
    priorityOnly: false,
    snapshotSeq: 0,
    refreshTimer: null,
    snapshotTimer: null,
    lastSnapshotRequestAt: 0,
    clockTimer: null,
    eventSource: null,
    liveTransport: 'connecting',
    lastSnapshotAt: null,
    selectedUsername: null,
    selectedSignal: null,
    selectedMentionKey: null,
    // Open account panel: which result window its calls show, and whether its raw post list is unfolded.
    panelWindow: null,
    panelPostsOpen: false,
    panelCalls: new Map(),
    postTexts: new Map(),
    selectedReputation: null,
    selectedPosts: new Map(),
    run: null,
    page: { pageIndex: 0, pageSize: 25, total: 0, items: [] },
    sessions: [],
    proxies: [],
    jobs: [],
    events: [],
    allInfluencers: [],
    allInfluencersReady: false,
    allInfluencersLoading: false,
    allInfluencersLoadedAt: 0,
    timex: [],
    reputationWindow: 'day',
    reputationPeriod: 'all',
    reputationReports: {},
    reputationRequests: {},
    reputation: {
      day: [],
      week: [],
      month: []
    },
    reputationReady: new Set(),
    reputationErrors: new Set(),
    reputationDetails: new Map(),
    sortMode: 'score',
    scrapeNowBusy: new Set(),
    loadError: null
  };

  const els = {
    livePositionBar: byId('livePositionBar'),
    scannerTitle: byId('scannerTitle'),
    scannerMeta: byId('scannerMeta'),
    scannerProgressText: byId('scannerProgressText'),
    scannerProgressBar: byId('scannerProgressBar'),
    scannerDone: byId('scannerDone'),
    scannerRunning: byId('scannerRunning'),
    scannerQueued: byId('scannerQueued'),
    scannerResources: byId('scannerResources'),
    pageStatus: byId('pageStatus'),
    pageNumbers: byId('pageNumbers'),
    prevPage: byId('prevPage'),
    nextPage: byId('nextPage'),
    pageSize: byId('pageSize'),
    incrementalRanking: byId('incrementalRanking'),
    showMore: byId('showMore'),
    loadError: byId('loadError'),
    rankingStats: byId('rankingStats'),
    rankingQuality: byId('rankingQuality'),
    rankingSearch: byId('rankingSearch'),
    rankingOrder: byId('rankingOrder'),
    featuredRanking: byId('featuredRanking'),
    featuredPeriod: byId('featuredPeriod'),
    featuredCards: byId('featuredCards'),
    scannerPath: byId('scannerPath'),
    scannerDisclosure: document.querySelector('.scanner-disclosure'),
    leaderboardHead: byId('leaderboardHead'),
    periodButtons: document.querySelectorAll('.period-button'),
    list: byId('list'),
    modalRoot: byId('modalRoot')
  };

  const searchSnapshot = debounce(() => void loadSnapshot(), 240);
  let cryptoPanelsRequest = null;
  let actionAccounts = null;
  let didInit = false;
  function boot() {
    if (didInit) return;
    didInit = true;
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  function init() {
    window.ithacGetJson = getJson;
    window.ithacApiUrl = apiUrl;
    window.dispatchEvent(new CustomEvent('ithac:action-source', {
      detail: { loadCalls: (username) => getJson(`/api/crypto/reputation/${encodeURIComponent(username)}/detail?window=day&take=20`) }
    }));
    els.prevPage.addEventListener('click', () => goToPage(rankingPage(liveRows()).pageIndex - 1));
    els.nextPage.addEventListener('click', () => goToPage(rankingPage(liveRows()).nextPage));
    els.showMore.addEventListener('click', showMoreRows);
    els.pageSize.addEventListener('change', () => {
      state.pageSize = Number(els.pageSize.value) || 25;
      state.pageIndex = 0;
      state.pagesShown = 1;
      state.selectedUsername = null;
      renderAll();
      void loadSnapshot({ resetListScroll: true });
    });
    els.rankingSearch.addEventListener('input', () => {
      state.query = els.rankingSearch.value.trim().replace(/^@+/, '');
      state.pageIndex = 0;
      state.pagesShown = 1;
      state.selectedUsername = null;
      renderAll();
      if (!state.allInfluencers.length) searchSnapshot();
    });
    els.rankingOrder.addEventListener('change', () => {
      state.sortMode = els.rankingOrder.value;
      state.selectedUsername = null;
      state.pageIndex = 0;
      state.pagesShown = 1;
      renderAll();
    });
    els.periodButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (state.reputationWindow === button.dataset.reputationWindow) return;
        state.reputationWindow = button.dataset.reputationWindow;
        state.pageIndex = 0;
        state.pagesShown = 1;
        state.selectedReputation = null;
        renderAll();
      });
    });
    els.featuredCards.addEventListener('click', (event) => {
      const card = event.target.closest('.featured-card');
      if (card) jumpToRankingRow(card.dataset.username);
    });
    els.scannerDisclosure.addEventListener('toggle', renderScanner);
    els.list.addEventListener('click', handleListClick);
    els.modalRoot.addEventListener('keydown', handleModalKey);

    startClock();
    // The rankings come from reports the API keeps ready, so the account list and the rankings load right away,
    // next to the slower live snapshot (scanner, robots) instead of after it.
    void loadAllInfluencers(false);
    void loadCryptoPanels();
    setInterval(() => void loadCryptoPanels(), CRYPTO_REFRESH_MS);
    void loadSnapshot({ resetListScroll: false }).then(() => connectLiveEvents());
  }

  function resolveApiBase() {
    const configured = window.ITHAC_API_BASE_URL?.trim();
    if (configured) return configured.replace(/\/+$/, '');
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:5088';
    if (host === 'ithacapp.com' || host === 'www.ithacapp.com') return 'https://api.ithacapp.com/live';
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

  async function getJson(path, timeoutMs = FETCH_TIMEOUT_MS) {
    const sep = path.includes('?') ? '&' : '?';
    return fetchJson(apiUrl(`${path}${sep}_=${Date.now()}`), { timeoutMs });
  }

  async function postJson(path, body) {
    return fetchJson(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    });
  }

  async function fetchJson(url, options = {}) {
    const { timeoutMs = FETCH_TIMEOUT_MS, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...(fetchOptions.headers ?? {})
        }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadSnapshot(options = {}) {
    const requestId = ++state.snapshotSeq;
    const requestedPage = state.pageIndex;
    const requestedPageSize = state.pageSize;
    const requestedQuery = state.query;
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
      void loadAllInfluencers(false);
      if (requestId !== state.snapshotSeq) return;

      state.loadError = null;
      state.run = snapshot.run;
      state.page = snapshot.influencerPage;
      mergeInfluencerRows(snapshot.influencerPage?.items ?? []);
      if (!state.allInfluencers.length && state.pageIndex === requestedPage &&
          state.pageSize === requestedPageSize && state.query === requestedQuery) {
        state.pageIndex = snapshot.influencerPage.pageIndex;
      }
      state.sessions = snapshot.sessions ?? [];
      state.proxies = snapshot.proxies ?? [];
      state.jobs = jobs.length ? jobs : (snapshot.jobs ?? []);
      state.events = snapshot.events ?? [];
      state.lastSnapshotAt = new Date();
      hydrateSelectedPostsFromRecent(posts);
      renderAll();
      window.dispatchEvent(new CustomEvent('ithac:resources', {
        detail: { sessions: state.sessions, proxies: state.proxies, run: state.run, jobs: state.jobs }
      }));
      if (options.resetListScroll) els.list.scrollTop = 0;
    } catch (error) {
      if (requestId !== state.snapshotSeq) return;
      void loadAllInfluencers();
      const fallbackLoaded = await loadInfluencerFallback(requestId, error, options);
      if (fallbackLoaded) return;
      state.loadError = error instanceof Error ? error.message : 'Unable to load live data';
      renderAll();
    }
  }

  function loadCryptoPanels() {
    if (cryptoPanelsRequest) return cryptoPanelsRequest;
    cryptoPanelsRequest = Promise.all([
      ...REPUTATION_WINDOWS.map(({ key }) => loadReputationWindow(key)),
      getJson('/api/crypto/timex?take=500').then((rows) => {
        if (Array.isArray(rows)) state.timex = rows;
      }).catch(() => {})
    ]).finally(() => { cryptoPanelsRequest = null; });
    return cryptoPanelsRequest;
  }

  async function loadReputationWindow(key) {
    const period = state.reputationPeriod;
    const request = (state.reputationRequests[key] || 0) + 1;
    state.reputationRequests[key] = request;
    const current = () => request === state.reputationRequests[key] && period === state.reputationPeriod;
    try {
      const report = grading.report(await getJson(`/api/crypto/reputation/report?window=${key}&period=${period}&take=2500&view=public`, 30_000), key, period);
      if (!current()) return;
      const changed = state.reputationReports[key]?.generatedAt !== report.generatedAt;
      if (changed) {
        const prefix = `${period}:${key}:`;
        for (const cacheKey of state.reputationDetails.keys()) {
          if (cacheKey.startsWith(prefix)) state.reputationDetails.delete(cacheKey);
        }
      }
      state.reputationReports[key] = report;
      state.reputation[key] = [...report.rankings, ...report.unranked];
      if (changed && state.selectedReputation && (state.selectedReputation.window || state.reputationWindow) === key) {
        const selected = state.reputation[key].find((row) => row.username?.toLowerCase() === state.selectedReputation.username?.toLowerCase());
        state.selectedReputation = selected || { username: state.selectedReputation.username, window: key, quality: null, history: [] };
        void loadReputationDetail(state.selectedReputation);
      }
      state.reputationErrors.delete(key);
    } catch {
      if (!current()) return;
      state.reputationErrors.add(key);
      state.reputation[key] = [];
      delete state.reputationReports[key];
    }
    state.reputationReady.add(key);
    if (state.reputationWindow === key) renderAll();
    else renderRankingControls();
  }

  async function loadAllInfluencers(force = false) {
    const now = Date.now();
    if (state.allInfluencersLoading || (!force && now - state.allInfluencersLoadedAt < 60_000)) return;
    state.allInfluencersLoading = true;
    try {
      const rows = await getJson('/api/influencers');
      // Disabled accounts (e.g. deleted on X) stay in the database but are hidden here.
      if (Array.isArray(rows)) state.allInfluencers = rows.filter((row) => row && row.enabled !== false);
    } catch {
      // Snapshot paging remains usable when the full list endpoint is unavailable.
    } finally {
      state.allInfluencersLoading = false;
      state.allInfluencersReady = true;
      state.allInfluencersLoadedAt = Date.now();
      renderAll();
    }
  }

  function mergeInfluencerRows(rows) {
    if (!state.allInfluencers.length || !Array.isArray(rows) || !rows.length) return;
    const byUser = new Map(state.allInfluencers.map((row, index) => [String(row.username || '').toLowerCase(), { row, index }]));
    for (const row of rows) {
      const key = String(row.username || '').toLowerCase();
      const current = byUser.get(key);
      if (!current) continue;
      state.allInfluencers[current.index] = { ...current.row, ...row };
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
      // The direct list works: keep the page calm and only note the slow snapshot in the console.
      console.info('Dashboard snapshot unavailable, using the direct influencer list', originalError);
      state.loadError = null;
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
      startPolling(POLL_FALLBACK_MS);
      return;
    }

    try {
      const source = new EventSource(apiUrl('/api/live/events'));
      state.eventSource = source;
      state.liveTransport = 'sse';
      source.onopen = () => {
        state.liveTransport = 'sse';
        clearInterval(state.refreshTimer);
        renderTop();
      };
      source.onmessage = () => scheduleSnapshot();
      source.onerror = () => {
        state.liveTransport = 'polling';
        renderTop();
        startPolling(POLL_FALLBACK_MS);
      };
    } catch {
      state.liveTransport = 'polling';
      startPolling(POLL_FALLBACK_MS);
    }
  }

  function scheduleSnapshot() {
    if (state.snapshotTimer) return;
    const wait = Math.max(0, SNAPSHOT_MIN_INTERVAL_MS - (Date.now() - state.lastSnapshotRequestAt));
    state.snapshotTimer = setTimeout(() => {
      state.snapshotTimer = null;
      state.lastSnapshotRequestAt = Date.now();
      void loadSnapshot({ resetListScroll: false });
    }, wait);
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
    const accounts = state.allInfluencers.length ? state.allInfluencers : state.page.items;
    if (accounts !== actionAccounts) {
      actionAccounts = accounts;
      window.dispatchEvent(new CustomEvent('ithac:action-accounts', { detail: accounts }));
    }
    renderTop();
    renderRankingControls();
    renderScanner();
    const rows = liveRows();
    renderFeatured(rows);
    renderPager(rows);
    renderList(rows);
    renderModal();
  }

  function handleListClick(event) {
    const postButton = event.target.closest('[data-call-post]');
    const priceButton = event.target.closest('[data-call-price]');
    const callButton = postButton || priceButton;
    if (callButton) {
      event.preventDefault();
      event.stopPropagation();
      const call = state.panelCalls.get(callButton.dataset.callPost || callButton.dataset.call);
      if (!call) return;
      if (postButton) showPostPopover(postButton, call);
      else showPricePopover(priceButton, call, priceButton.dataset.callPrice);
      return;
    }
    const windowButton = event.target.closest('[data-panel-window]');
    if (windowButton && state.selectedUsername) {
      event.preventDefault();
      event.stopPropagation();
      state.panelWindow = windowButton.dataset.panelWindow;
      closePopover();
      renderList();
      void loadReputationDetail({ username: state.selectedUsername, window: state.panelWindow });
      return;
    }
    const helpButton = event.target.closest('[data-score-help]');
    if (helpButton) {
      event.preventDefault();
      event.stopPropagation();
      const row = liveRows().find((item) => item.username.toLowerCase() === helpButton.dataset.scoreHelp.toLowerCase());
      const windowKey = state.panelWindow || state.reputationWindow;
      const reputation = row?._reputations?.[windowKey] || { username: helpButton.dataset.scoreHelp, window: windowKey };
      state.selectedReputation = { ...reputation, window: windowKey };
      renderModal();
      void loadReputationDetail(state.selectedReputation);
      return;
    }
    const scrapeNowButton = event.target.closest('[data-scrape-username]');
    if (scrapeNowButton?.dataset.scrapeUsername) {
      event.preventDefault();
      event.stopPropagation();
      void scrapeInfluencerNow(scrapeNowButton.dataset.scrapeUsername);
      return;
    }
    const signalButton = event.target.closest('[data-signal-id]');
    if (signalButton?.dataset.signalId) {
      event.preventDefault();
      event.stopPropagation();
      const signal = (state.timex || []).find((item) => String(item.id) === String(signalButton.dataset.signalId));
      if (signal) {
        state.selectedSignal = signal;
        renderModal();
      }
      return;
    }
    const mention = event.target.closest('[data-mention-key]');
    if (!mention) return;
    event.preventDefault();
    event.stopPropagation();
    const key = mention.dataset.mentionKey || '';
    state.selectedMentionKey = state.selectedMentionKey === key ? null : key;
    renderList();
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
    const resourcesShort = `${availableCount(state.sessions)}/${state.sessions.length} · ${availableCount(state.proxies)}/${state.proxies.length}`;
    const resources = `${availableCount(state.sessions)}/${state.sessions.length} sessions · ${availableCount(state.proxies)}/${state.proxies.length} proxies`;
    const progress = total ? Math.max(0, Math.min(100, ((done + failed) / Math.max(total, 1)) * 100)) : 0;

    els.livePositionBar.className = `live-position-bar ${status}`;
    els.scannerProgressText.textContent = `${Math.round(progress)}%`;
    els.scannerProgressBar.style.transform = `scaleX(${(progress / 100).toFixed(3)})`;
    els.scannerDone.textContent = String(done);
    els.scannerRunning.textContent = String(running);
    els.scannerQueued.textContent = String(queued);
    els.scannerResources.textContent = resourcesShort;

    if (active) {
      const rowPos = rowPosition(active.username);
      els.scannerTitle.textContent = `now @${active.username}`;
      els.scannerMeta.textContent = `${rowPos} · ${resourceText(active)} · started ${formatTime(active.startedAt || active.updatedAt)} · ${done}/${Math.max(total, 1)} complete · ${failed} failed · ${resources}`;
      return;
    }

    if (status === 'running') {
      const label = eventUser ? `last @${eventUser}` : `Run #${run?.id ?? '-'} active`;
      els.scannerTitle.textContent = label;
      els.scannerMeta.textContent = event
        ? `${event.text} · ${event.at} · ${done}/${Math.max(total, 1)} complete · ${failed} failed · ${resources}`
        : `between accounts · ${done}/${Math.max(total, 1)} complete · ${queued} queued · ${failed} failed · ${resources}`;
      return;
    }

    els.scannerTitle.textContent = eventUser ? `last @${eventUser}` : 'idle';
    els.scannerMeta.textContent = event ? `${event.text} · ${event.at} · ${done}/${Math.max(total, 1)} complete · ${failed} failed · ${resources}` : `no active scrape · ${resources}`;
  }

  function rankingPage(rows) {
    const hasFullList = state.allInfluencers.length > 0;
    const total = hasFullList ? rows.length : state.page.total;
    const pageSize = state.pageSize;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const pageIndex = clampPageIndex(state.pageIndex, total, pageSize);
    const nextPage = Math.min(pageCount, pageIndex + (hasFullList ? state.pagesShown : 1));
    const offset = pageIndex * pageSize;
    const end = Math.min(total, nextPage * pageSize);
    return { hasFullList, total, pageCount, pageIndex, nextPage, offset, end };
  }

  function rankingIsLoading() {
    return state.sortMode === 'score' &&
      (!state.reputationReady.has(state.reputationWindow) || !state.allInfluencersReady);
  }

  function renderPager(rows) {
    els.loadError.hidden = !state.loadError;
    const { hasFullList, total, pageCount, pageIndex, nextPage, offset, end } = rankingPage(rows);
    const hasMore = nextPage < pageCount;
    els.incrementalRanking.hidden = !hasFullList || !hasMore || rankingIsLoading();
    els.showMore.disabled = els.incrementalRanking.hidden;

    els.pageStatus.textContent = total ? `${offset + 1}–${end} of ${total}` : '0 accounts';
    els.prevPage.disabled = pageIndex <= 0;
    els.nextPage.disabled = !hasMore;
    els.pageSize.value = String(state.pageSize);

    const focusedPage = els.pageNumbers.contains(document.activeElement)
      ? document.activeElement.textContent
      : null;
    els.pageNumbers.replaceChildren(...pageButtonNodes(pageIndex, pageCount));
    if (focusedPage) {
      [...els.pageNumbers.querySelectorAll('button')]
        .find((button) => button.textContent === focusedPage)?.focus({ preventScroll: true });
    }
    els.loadError.textContent = state.loadError ? `Live API not loaded: ${state.loadError}` : '';
  }

  function showMoreRows() {
    if (rankingIsLoading()) return;
    const rows = liveRows();
    const { hasFullList, total, offset, end } = rankingPage(rows);
    if (!hasFullList || end >= total) return;

    state.pagesShown += 1;
    renderPager(rows);
    renderList(rows);
    const firstNewRow = els.list.querySelectorAll('.leaderboard-entry > summary')[end - offset];
    firstNewRow?.focus({ preventScroll: true });
    firstNewRow?.scrollIntoView({ block: 'nearest' });
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
      button.setAttribute('aria-label', `Page ${page + 1}`);
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

  function renderList(allRows) {
    if (rankingIsLoading()) {
      els.list.replaceChildren(emptyNode('Loading ranking…', ''));
      return;
    }
    const rowControl = 'summary, button:not([disabled]), a[href]';
    const focused = document.activeElement;
    const focusedRow = focused?.closest('.leaderboard-entry');
    const focusedIndex = focusedRow ? [...focusedRow.querySelectorAll(rowControl)].indexOf(focused) : -1;
    allRows ??= liveRows();
    const { hasFullList, offset, end } = rankingPage(allRows);
    const rows = hasFullList ? allRows.slice(offset, end) : allRows;
    if (!rows.length) {
      const title = state.loadError ? 'Ranking unavailable' : state.lastSnapshotAt ? 'No matching accounts' : 'Loading ranking…';
      const body = state.loadError ? 'The live API could not be reached.' : '';
      els.list.replaceChildren(emptyNode(title, body));
      return;
    }

    const existing = new Map([...els.list.querySelectorAll('.leaderboard-entry')]
      .map((entry) => [entry.dataset.username, entry]));
    const nodes = rows.map((row, index) => renderRow(
      row,
      displayRowNumber(row, offset + index + 1),
      existing.get(row.username)
    ));
    const scoresUnavailable = state.sortMode === 'score' && state.reputationErrors.has(state.reputationWindow);
    if (scoresUnavailable || (state.sortMode === 'score' && !hasFullList)) {
      const title = scoresUnavailable ? 'Scores temporarily unavailable' : 'Full list temporarily unavailable';
      const message = scoresUnavailable ? 'You can still open account details.' : 'Only accounts on this page are shown.';
      const previousNotice = els.list.querySelector('.score-notice');
      const notice = previousNotice?.dataset.noticeTitle === title ? previousNotice : emptyNode(title, message);
      notice.dataset.noticeTitle = title;
      notice.classList.add('score-notice');
      nodes.unshift(notice);
    }
    nodes.forEach((node, index) => {
      const current = els.list.children[index];
      if (current !== node) els.list.insertBefore(node, current || null);
    });
    while (els.list.children.length > nodes.length) els.list.lastElementChild.remove();
    if (focusedIndex >= 0) {
      const nextRow = nodes.find((row) => row.dataset.username === focusedRow.dataset.username);
      if (document.activeElement !== focused) nextRow?.querySelectorAll(rowControl)[focusedIndex]?.focus({ preventScroll: true });
    }
  }

  function renderTimex() {
    const rows = state.timex;
    if (!rows.length) {
      els.list.replaceChildren(emptyNode('No TIMEX signal', 'Signals will appear when Groq extracts crypto mentions and starts 1D / 1W / 1M windows.'));
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
          <em>@${escapeHtml(signal.username || '-')} · ${escapeHtml(signal.symbol || '-')} · ${escapeHtml(signal.horizonLabel || signal.window?.label || '-')}</em>
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

  function currentReputationRows() {
    return state.reputation?.[state.reputationWindow] ?? [];
  }

  function reputationRowsForWindow(windowKey) {
    return state.reputation?.[windowKey] ?? [];
  }

  function reputationMapForWindow(windowKey) {
    return new Map(reputationRowsForWindow(windowKey).map((row) => [String(row.username || '').toLowerCase(), row]));
  }

  function reputationMaps() {
    return Object.fromEntries(REPUTATION_WINDOWS.map((item) => [item.key, reputationMapForWindow(item.key)]));
  }

  function currentReputationMap() {
    return reputationMapForWindow(state.reputationWindow);
  }

  function liveRows() {
    return enrichedInfluencerRows().sort(compareLiveRows)
      .map((row, index) => ({ ...row, _listRank: index + 1 }))
      .filter(matchesLiveFilters);
  }

  function enrichedInfluencerRows() {
    const source = state.allInfluencers.length ? state.allInfluencers : (state.page.items ?? []);
    const repMaps = reputationMaps();
    const repMap = repMaps[state.reputationWindow] || currentReputationMap();
    return source.map((row, index) => ({
      ...row,
      _sourceIndex: index,
      _reputations: Object.fromEntries(REPUTATION_WINDOWS.map((item) => [
        item.key,
        repMaps[item.key]?.get(String(row.username || '').toLowerCase()) || null
      ])),
      _reputation: repMap.get(String(row.username || '').toLowerCase()) || null
    }));
  }

  function matchesLiveFilters(row) {
    const query = String(state.query || '').trim().toLowerCase();
    if (query) {
      const haystack = `${row.username || ''} ${row.displayName || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const status = String(state.status || 'all').toLowerCase();
    if (status !== 'all' && normalizeJobStatus(row.status) !== status) return false;
    if (state.priorityOnly && !row.priority) return false;
    return true;
  }

  function compareLiveRows(a, b) {
    if (state.sortMode === 'scanner') {
      return (a._sourceIndex ?? 0) - (b._sourceIndex ?? 0);
    }
    const windowKey = state.reputationWindow || 'day';
    const repA = a._reputations?.[windowKey] || a._reputation || null;
    const repB = b._reputations?.[windowKey] || b._reputation || null;
    const scoreA = reputationScore(repA);
    const scoreB = reputationScore(repB);
    const hasA = Number.isFinite(scoreA);
    const hasB = Number.isFinite(scoreB);
    if (hasA !== hasB) return hasA ? -1 : 1;
    if (hasA && Math.abs(scoreB - scoreA) > 0.001) return scoreB - scoreA;
    const rankA = Number(repA?.rank);
    const rankB = Number(repB?.rank);
    const safeRankA = Number.isFinite(rankA) ? rankA : Number.MAX_SAFE_INTEGER;
    const safeRankB = Number.isFinite(rankB) ? rankB : Number.MAX_SAFE_INTEGER;
    if (safeRankA !== safeRankB) return safeRankA - safeRankB;
    const countA = reputationScoredCount(repA);
    const countB = reputationScoredCount(repB);
    if (countA !== countB) return countB - countA;
    if (isActiveRow(a) !== isActiveRow(b)) return isActiveRow(a) ? -1 : 1;
    const scrapeA = Date.parse(a.lastScrapeFinishedAt || a.lastScrapeUpdatedAt || a.lastScrapeStartedAt || '') || 0;
    const scrapeB = Date.parse(b.lastScrapeFinishedAt || b.lastScrapeUpdatedAt || b.lastScrapeStartedAt || '') || 0;
    if (scrapeA !== scrapeB) return scrapeB - scrapeA;
    return (a._sourceIndex ?? 0) - (b._sourceIndex ?? 0);
  }

  function reputationWindowLabel(key) {
    return REPUTATION_WINDOWS.find((item) => item.key === key)?.label ?? '1 DAY';
  }

  function renderRankingControls() {
    els.periodButtons.forEach((button) => {
      const active = button.dataset.reputationWindow === state.reputationWindow;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    els.leaderboardHead.firstElementChild.textContent = state.sortMode === 'scanner' ? 'Order' : 'Rank';
    const periods = REPUTATION_WINDOWS.map(({ key, label }) => {
      if (state.reputationErrors.has(key)) return `${label}: unavailable`;
      if (!state.reputationReady.has(key)) return `${label}: loading`;
      return `${label}: ${formatCount(state.reputationReports[key]?.rankings.length || 0)} ranked`;
    });
    els.rankingStats.textContent = `${periods.join(' · ')} · ${formatCount(state.allInfluencers.length || state.page.total)} accounts followed`;
    const after = reputationWindowLabel(state.reputationWindow);
    const report = state.reputationReports[state.reputationWindow];
    els.rankingQuality.textContent = state.reputationErrors.has(state.reputationWindow)
      ? 'The ranking is temporarily unavailable. Try again in a minute.'
      : `Each call is checked ${after} after it was posted: did the price go the way the influencer said? ` +
        `Accounts are ranked on the average score of their calls, from ${MINIMUM_RANKED_CALLS} calls: the highest average comes first, whatever the number of calls.` +
        (report ? ` ${formatCount(report.rankings.length)} accounts ranked.` : '');
  }

  function renderFeatured(rows) {
    const windowKey = state.reputationWindow;
    const ready = state.sortMode === 'score' &&
      !state.query && state.status === 'all' && !state.priorityOnly &&
      state.allInfluencersReady && state.allInfluencers.length > 0 &&
      state.reputationReady.has(windowKey) && !state.reputationErrors.has(windowKey);
    const leaders = ready ? rows.filter((row) => Number.isFinite(reputationScore(row._reputation))).slice(0, 3) : [];
    els.featuredRanking.hidden = leaders.length === 0;
    if (els.featuredRanking.hidden) return;

    const period = `Measured ${reputationWindowLabel(windowKey)} after each call`;
    if (els.featuredPeriod.textContent !== period) els.featuredPeriod.textContent = period;
    const markup = leaders.map((row) => {
      const rank = row._reputation.rank;
      const name = accountDisplayName(row);
      const score = reputationScore(row._reputation);
      const label = `Open rank ${rank}, ${name}, score ${formatScore(score)}`;
      return `
        <button class="featured-card" type="button" data-username="${escapeAttr(row.username)}" aria-label="${escapeAttr(label)}">
          <span class="featured-rank">#${rank}</span>
          <span class="featured-identity">
            ${avatarHtml(row)}
            <span class="featured-name">
              <strong>${escapeHtml(name)}</strong>
            </span>
          </span>
          <span class="featured-score">
            <strong>${formatScore(score)}</strong>
            <small>Score</small>
          </span>
        </button>
      `;
    }).join('');

    if (els.featuredCards.dataset.markup === markup) return;
    const active = document.activeElement?.closest('.featured-card');
    els.featuredCards.dataset.markup = markup;
    els.featuredCards.innerHTML = markup;
    els.featuredCards.querySelectorAll('.featured-card').forEach((card) => {
      prepareRankingAvatar(card.querySelector('.avatar'), card.dataset.username);
      if (active?.dataset.username === card.dataset.username) {
        card.focus({ preventScroll: true });
      }
    });
  }

  function renderScanner() {
    if (!els.scannerDisclosure.open) return;
    const username = document.activeElement?.dataset.jumpUsername;
    const path = renderScannerPath();
    els.scannerPath.replaceChildren(path);
    if (username) {
      [...path.querySelectorAll('[data-jump-username]')]
        .find((button) => button.dataset.jumpUsername === username)?.focus({ preventScroll: true });
    }
  }

  function renderScannerPath() {
    const rows = enrichedInfluencerRows();
    const wrap = document.createElement('section');
    wrap.className = 'scanner-path';
    const current = scannerCurrentUsername();
    const index = scannerIndex(current, rows);
    const total = rows.length || state.run?.targetCount || 0;
    const pageSize = state.pageSize || state.page.pageSize || 250;
    const page = index >= 0 ? Math.floor(index / Math.max(pageSize, 1)) + 1 : null;
    const run = state.run;
    const status = normalizeRunStatus(run?.status);
    const railRows = scannerRailRows(rows, index);

    wrap.innerHTML = `
      <header class="scanner-path-head">
        <div>
          <span>Scanner path</span>
          <strong>${current ? `@${escapeHtml(current)}` : status === 'running' ? 'between accounts' : 'idle'}</strong>
          <em>${index >= 0 ? `natural row ${index + 1}/${total} · page ${page}` : `${run?.successCount ?? 0}/${total || '-'} complete · waiting for next claim`}</em>
        </div>
        <div class="scanner-path-counts">
          <b>${escapeHtml(run?.successCount ?? 0)}</b><small>done</small>
          <b>${escapeHtml(run?.runningCount ?? 0)}</b><small>running</small>
          <b>${escapeHtml(run?.queuedCount ?? 0)}</b><small>queued</small>
        </div>
      </header>
      <div class="scanner-rail">
        ${railRows.length ? railRows.map((item) => scannerRailItemHtml(item, index)).join('') : '<span class="scanner-rail-empty">Waiting for live queue...</span>'}
      </div>
    `;
    wrap.querySelectorAll('[data-jump-username]').forEach((button) => {
      button.addEventListener('click', () => jumpToRankingRow(button.dataset.jumpUsername || ''));
    });
    return wrap;
  }

  function scannerRailRows(rows, index) {
    if (!rows.length) return [];
    if (index < 0) return rows.slice(0, Math.min(5, rows.length)).map((row, offset) => ({ row, index: offset }));
    const start = Math.max(0, Math.min(index - 2, rows.length - 5));
    return rows.slice(start, start + 5).map((row, offset) => ({ row, index: start + offset }));
  }

  function scannerRailItemHtml(item, currentIndex) {
    const { row, index } = item;
    const isCurrent = index === currentIndex;
    const status = isCurrent ? 'now' : index < currentIndex ? 'done' : 'next';
    const label = isCurrent ? 'NOW' : index < currentIndex ? 'DONE' : 'NEXT';
    const score = reputationScore(row._reputation);
    return `
      <button type="button" class="scanner-rail-item ${status}" data-jump-username="${escapeAttr(row.username)}">
        <small>#${index + 1} · ${label}</small>
        <strong>@${escapeHtml(row.username)}</strong>
        <em>${escapeHtml(rowStatusLabel(row))} · ${Number.isFinite(score) ? `score ${formatScore(score)}` : 'not rated'}</em>
      </button>
    `;
  }

  function scannerCurrentUsername() {
    const active = activeJob();
    if (active?.username) return active.username;
    return usernameFromText(latestEvent()?.text) || null;
  }

  function scannerIndex(username, rows = enrichedInfluencerRows()) {
    if (!username) return -1;
    const lower = String(username).toLowerCase();
    return rows.findIndex((row) => String(row.username || '').toLowerCase() === lower);
  }

  function jumpToRankingRow(username) {
    state.query = '';
    els.rankingSearch.value = '';
    const rows = liveRows();
    const lower = String(username || '').toLowerCase();
    const index = rows.findIndex((row) => String(row.username || '').toLowerCase() === lower);
    if (index < 0) return;
    const pageSize = state.pageSize || state.page.pageSize || 250;
    state.pageIndex = Math.floor(index / Math.max(pageSize, 1));
    state.pagesShown = 1;
    state.selectedUsername = username;
    state.selectedMentionKey = null;
    renderAll();
    const entry = [...els.list.querySelectorAll('.leaderboard-entry')]
      .find((element) => element.dataset.username.toLowerCase() === lower);
    const summary = entry?.querySelector('summary');
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({ block: 'nearest' });
    void loadPosts(username);
  }

  async function scrapeInfluencerNow(username) {
    const clean = String(username || '').trim();
    const key = clean.toLowerCase();
    if (!clean || state.scrapeNowBusy.has(key)) return;

    state.scrapeNowBusy.add(key);
    renderAll();
    try {
      await postJson(`/api/influencers/${encodeURIComponent(clean)}/retry`, {});
      await loadSnapshot({ resetListScroll: false });
    } catch (error) {
      console.error(`Unable to queue @${clean} for scrape`, error);
    } finally {
      state.scrapeNowBusy.delete(key);
      renderAll();
    }
  }

  function emptyNode(title, body) {
    const empty = document.createElement('article');
    empty.className = 'empty';
    empty.innerHTML = `<strong>${escapeHtml(title)}</strong><br><span>${escapeHtml(body)}</span>`;
    return empty;
  }

  function renderRow(row, rank, previous) {
    const selected = state.selectedUsername?.toLowerCase() === row.username.toLowerCase();
    const reputation = row._reputation;
    const score = reputationScore(reputation);
    const name = accountDisplayName(row);
    const profileLabel = `Open @${row.username} on X`;
    const graded = grading.calls(reputation);
    const calls = graded > 0 ? formatCount(graded) : '–';
    const qualityLabel = performanceLine(reputation, score);
    const lastCall = reputation?.lastCall?.postedAt ? reputation.lastCall : null;
    const summaryKey = JSON.stringify([rank, name, row.profileImageUrl, score, calls, qualityLabel,
      lastCall ? [lastCall.postId, lastCall.postedAt, lastCall.symbol, lastCall.direction] : null]);
    const entry = previous || document.createElement('details');
    entry.className = 'leaderboard-entry';
    entry.dataset.username = row.username;
    entry.open = selected;
    if (entry.dataset.summaryKey !== summaryKey) {
      entry.dataset.summaryKey = summaryKey;
      entry.innerHTML = `
        <summary class="leaderboard-summary">
          <span class="leaderboard-rank"><span class="visually-hidden">Rank </span>${rank}</span>
          <span class="leaderboard-account">
            ${avatarHtml(row)}
            <span class="leaderboard-name">
              <strong>${escapeHtml(name)}</strong>
              ${qualityLabel ? `<small class="grading-badge ${qualityLabel.tone}">${escapeHtml(qualityLabel.text)}</small>` : ''}
            </span>
          </span>
          ${lastCallCellHtml(lastCall)}
          <span class="leaderboard-score ${scoreClass(score)}"><span class="visually-hidden">Score </span>${formatScore(score)}</span>
          <span class="leaderboard-calls"><span class="visually-hidden">Graded calls </span>${calls}</span>
          <span class="leaderboard-chevron" aria-hidden="true"></span>
        </summary>
      `;
      prepareRankingAvatar(entry.querySelector('.avatar'), row.username);
      entry.querySelector('summary').addEventListener('click', (event) => {
        event.preventDefault();
        // The last call opens its post, without opening or closing the account.
        const lastButton = event.target.closest('[data-last-call]');
        if (lastButton) {
          event.stopPropagation();
          if (lastCall) showPostPopover(lastButton, { ...lastCall, username: row.username });
          return;
        }
        const wasOpen = entry.open;
        state.selectedUsername = wasOpen ? null : row.username;
        state.selectedMentionKey = null;
        state.panelWindow = state.reputationWindow;
        state.panelPostsOpen = false;
        closePopover();
        renderList();
        if (!wasOpen) {
          void loadPosts(row.username);
          void loadReputationDetail({ username: row.username, window: state.panelWindow });
          if (window.IthacAudit?.has(row.username)) void window.IthacAudit.load(row.username).then(() => renderList());
        }
      });
    }

    const previousDetail = entry.querySelector('.leaderboard-detail');
    if (!selected) {
      previousDetail?.remove();
      return entry;
    }
    const panelKey = accountPanelKey(row);
    if (previousDetail?.dataset.panelKey === panelKey) return entry;
    previousDetail?.remove();
    // Public view of an account: its latest calls first, then the calls still being processed, then its raw posts.
    // Robot and proxy details live in the Garage.
    const details = document.createElement('div');
    details.className = 'leaderboard-detail account-panel';
    details.dataset.panelKey = panelKey;
    details.innerHTML = accountPanelHtml(row, profileLabel);
    window.IthacAudit?.bind(details, () => renderList());
    details.querySelector('.posts-disclosure')?.addEventListener('toggle', (event) => {
      state.panelPostsOpen = event.currentTarget.open;
    });
    entry.append(details);
    return entry;
  }

  // The account's most recent call (graded or still in progress): when it was posted, and a button to its post.
  function lastCallCellHtml(call) {
    if (!call) return '<span class="leaderboard-last none"><span class="visually-hidden">No call yet</span><span aria-hidden="true">–</span></span>';
    const short = String(call.direction || '').toLowerCase() === 'bearish';
    const side = short ? 'Short' : 'Long';
    const label = `Last call: ${side} ${call.symbol || ''}, posted ${formatDateTime(call.postedAt)}. Show the post`;
    return `
      <button type="button" class="leaderboard-last" data-last-call aria-haspopup="dialog" aria-label="${escapeAttr(label)}">
        <span class="last-label">Last call</span>
        <b>${escapeHtml(formatLastCallDate(call.postedAt))}</b>
        <small>${escapeHtml(call.symbol || '–')} <span class="${short ? 'short' : 'long'}">${side}</span></small>
      </button>
    `;
  }

  function formatLastCallDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '–';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' }).format(date);
  }

  // ---------- Account panel ----------
  const PANEL_CALLS = 10;

  function panelDetailState(row) {
    return state.reputationDetails.get(reputationDetailKey({ username: row.username, window: state.panelWindow || state.reputationWindow }));
  }

  function accountPanelKey(row) {
    const detailState = panelDetailState(row);
    const posts = state.selectedPosts.get(row.username.toLowerCase());
    const reps = REPUTATION_WINDOWS.map(({ key }) => {
      const rep = row._reputations?.[key];
      return rep ? [rep.rank, rep.competitionScore, grading.calls(rep)] : null;
    });
    return JSON.stringify([state.panelWindow, detailState?.loadedAt || 0, Boolean(detailState?.loading), detailState?.error || '',
      posts ? posts.length : -1, state.selectedMentionKey, state.panelPostsOpen, reps, row.followersCount, scrapeMinute(row),
      window.IthacAudit?.stateKey(row.username) || '']);
  }

  function accountPanelHtml(row, profileLabel) {
    const windowKey = state.panelWindow || state.reputationWindow;
    const label = reputationWindowLabel(windowKey);
    const detailState = panelDetailState(row);
    const detail = detailState?.detail;
    const done = byNewestPost(Array.isArray(detail?.scored) ? detail.scored : []).slice(0, PANEL_CALLS);
    const pending = byNewestPost(Array.isArray(detail?.waiting) ? detail.waiting : []);
    const posts = state.selectedPosts.get(row.username.toLowerCase()) ?? [];
    state.panelCalls = new Map([...done, ...pending.slice(0, PANEL_CALLS)].map((call) => [callId(call), call]));
    return `
      <header class="account-head">
        <div class="account-id">
          <a class="entry-profile" href="${escapeAttr(xProfileUrl(row.username))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(profileLabel)}">
            @${escapeHtml(row.username)} <span aria-hidden="true">↗</span>
          </a>
          <span>${escapeHtml(formatFollowers(row.followersCount))} · posts last read ${escapeHtml(scrapeMinute(row))}</span>
        </div>
        <div class="account-windows" role="group" aria-label="Result measured after each call">
          ${REPUTATION_WINDOWS.map((item) => panelWindowHtml(row._reputations?.[item.key], item, windowKey)).join('')}
        </div>
      </header>
      ${window.IthacAudit?.panelHtml(row.username) || ''}
      <section class="calls-block">
        <div class="calls-title">
          <h3>Latest calls</h3>
          <span>Exit price taken ${escapeHtml(label)} after each call · <button type="button" class="link-button" data-score-help="${escapeAttr(row.username)}">How the score works</button></span>
        </div>
        ${done.length ? callsTableHtml(done, 'done') : callsEmptyHtml(detailState, 'No call has a result for this period yet.')}
      </section>
      <section class="calls-block calls-pending">
        <div class="calls-title">
          <h3>Being processed</h3>
          <span>${pending.length ? `${pending.length} call${pending.length === 1 ? '' : 's'} waiting for the ${escapeHtml(label)} result` : ''}</span>
        </div>
        ${pending.length ? callsTableHtml(pending.slice(0, PANEL_CALLS), 'pending') : callsEmptyHtml(detailState, 'Nothing in progress for this period.')}
        ${pending.length > PANEL_CALLS ? `<p class="calls-more">and ${pending.length - PANEL_CALLS} older call${pending.length - PANEL_CALLS === 1 ? '' : 's'} in progress</p>` : ''}
      </section>
      <details class="posts-disclosure"${state.panelPostsOpen ? ' open' : ''}>
        <summary>Latest posts</summary>
        <div class="posts">
          ${posts.length ? posts.map(postHtml).join('') : '<p class="calls-empty">No stored post loaded for this account yet.</p>'}
        </div>
      </details>
    `;
  }

  function panelWindowHtml(reputation, item, activeKey) {
    const score = reputationScore(reputation);
    const ranked = Number.isFinite(score);
    const calls = grading.calls(reputation);
    const detail = ranked ? `#${reputation.rank} · ${formatScore(score)}`
      : calls ? `${calls} of ${MINIMUM_RANKED_CALLS} calls` : reputation?.lastCall ? 'no result yet' : 'no call yet';
    return `
      <button type="button" class="account-window ${item.key === activeKey ? 'active' : ''} ${scoreClass(score)}" data-panel-window="${escapeAttr(item.key)}" aria-pressed="${item.key === activeKey}">
        <small>${escapeHtml(item.label)}</small>
        <b>${escapeHtml(detail)}</b>
      </button>
    `;
  }

  function callsEmptyHtml(detailState, emptyText) {
    if (!detailState || detailState.loading) return '<p class="calls-empty">Loading the calls…</p>';
    if (detailState.error) return `<p class="calls-empty">The calls could not be loaded (${escapeHtml(detailState.error)}).</p>`;
    return `<p class="calls-empty">${escapeHtml(emptyText)}</p>`;
  }

  function callsTableHtml(calls, kind) {
    return `
      <table class="calls-table ${kind}">
        <thead><tr><th scope="col">Call</th><th scope="col">Entry</th><th scope="col">Exit</th><th scope="col">${kind === 'done' ? 'Result' : 'Status'}</th></tr></thead>
        <tbody>${calls.map((call) => callRowHtml(call, kind)).join('')}</tbody>
      </table>
    `;
  }

  function callRowHtml(call, kind) {
    const id = escapeAttr(callId(call));
    const short = String(call.direction || '').toLowerCase() === 'bearish';
    const entry = grading.number(signalEntryPrice(call));
    const exit = grading.number(signalExitPrice(call));
    const move = grading.number(call.variationPct);
    const right = Number.isFinite(move) ? (short ? move < 0 : move > 0) : null;
    const target = call.targetPriceAt || call.window?.targetAt;
    const exitCell = Number.isFinite(exit)
      ? `<button type="button" class="price-button" data-call-price="exit" data-call="${id}">${escapeHtml(formatPrice(exit))}</button>`
      : target
        ? `<button type="button" class="price-button later" data-call-price="exit" data-call="${id}">${escapeHtml(isFuture(target) ? `on ${formatCallDate(target)}` : 'getting price')}</button>`
        : '<span class="price-later">–</span>';
    const result = kind === 'done'
      ? `<b class="${right === null ? '' : right ? 'call-right' : 'call-wrong'}">${escapeHtml(formatVariation(move).replace('.00%', '%'))}</b><small>${right === null ? '' : right ? 'right' : 'wrong'} · score ${escapeHtml(formatScore(call.score))}</small>`
      : `<b>${escapeHtml(pendingStatusText(call, entry, target))}</b>`;
    return `
      <tr>
        <td class="call-cell" data-label="Call">
          <button type="button" class="call-button" data-call-post="${id}" aria-haspopup="dialog" title="Show the post">
            <b>${escapeHtml(call.symbol || '–')}</b>
            <span class="call-side ${short ? 'short' : 'long'}">${short ? 'Short' : 'Long'}</span>
            <small>${escapeHtml(formatCallDate(signalCallTime(call)))}</small>
          </button>
        </td>
        <td data-label="Entry">${Number.isFinite(entry)
          ? `<button type="button" class="price-button" data-call-price="entry" data-call="${id}">${escapeHtml(formatPrice(entry))}</button>`
          : '<span class="price-later">getting price</span>'}</td>
        <td data-label="Exit">${exitCell}</td>
        <td data-label="${kind === 'done' ? 'Result' : 'Status'}" class="call-result">${result}</td>
      </tr>
    `;
  }

  function pendingStatusText(call, entry, target) {
    if (!Number.isFinite(entry)) return 'Getting the entry price';
    if (target && isFuture(target)) return `Result in ${durationUntil(target)}`;
    return 'Getting the exit price';
  }

  function callId(call) {
    return String(call.windowId ?? call.id ?? `${call.postId}-${call.symbol}`);
  }

  function byNewestPost(calls) {
    return [...calls].sort((a, b) => (Date.parse(signalCallTime(b)) || 0) - (Date.parse(signalCallTime(a)) || 0));
  }

  function isFuture(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) && time > Date.now();
  }

  function durationUntil(value) {
    const minutes = Math.max(1, Math.round((Date.parse(value) - Date.now()) / 60000));
    if (minutes < 90) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h`;
    return `${Math.round(hours / 24)} days`;
  }

  function durationBetween(from, to) {
    const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60000);
    if (!Number.isFinite(minutes)) return '';
    const sign = minutes < 0 ? 'before' : 'after';
    const abs = Math.abs(minutes);
    if (abs < 1) return 'at the time of the post';
    if (abs < 90) return `${abs} min ${sign} the post`;
    const hours = abs / 60;
    if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h ${sign} the post`;
    const days = hours / 24;
    return `${Number.isInteger(days) ? days : days.toFixed(1)} days ${sign} the post`;
  }

  function formatCallDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '–';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(sameYear ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }) }).format(date);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '–';
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
  }

  // ---------- Popups for a call: the post, the entry time, the exit time ----------
  let popover = null;

  function closePopover() {
    popover?.remove();
    popover = null;
    document.querySelectorAll('[data-popover-open]').forEach((node) => node.removeAttribute('data-popover-open'));
  }

  function openPopover(anchor, html, wide = false) {
    const reopen = anchor.hasAttribute('data-popover-open');
    closePopover();
    if (reopen) return null;
    popover = document.createElement('div');
    popover.className = `mini-pop${wide ? ' wide' : ''}`;
    popover.setAttribute('role', 'dialog');
    popover.tabIndex = -1;
    popover.innerHTML = `<button type="button" class="mini-pop-close" aria-label="Close">×</button><div class="mini-pop-body">${html}</div>`;
    popover.querySelector('.mini-pop-close').addEventListener('click', closePopover);
    document.body.append(popover);
    anchor.setAttribute('data-popover-open', '');
    placePopover(anchor);
    popover.focus({ preventScroll: true });
    return popover;
  }

  function placePopover(anchor) {
    if (!popover) return;
    if (window.matchMedia('(max-width: 560px)').matches) {
      popover.classList.add('sheet');
      return;
    }
    const box = anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const viewWidth = document.documentElement.clientWidth;
    const left = Math.max(12, Math.min(box.left, viewWidth - width - 12)) + window.scrollX;
    const below = box.bottom + 8;
    const top = below + height > window.innerHeight - 8 && box.top - height - 8 > 0 ? box.top - height - 8 : below;
    popover.style.left = `${left}px`;
    popover.style.top = `${top + window.scrollY}px`;
  }

  function showPricePopover(anchor, call, kind) {
    const windowLabel = reputationWindowLabel(call.horizonKey || state.panelWindow || state.reputationWindow);
    const posted = signalCallTime(call);
    if (kind === 'entry') {
      const at = call.startPriceAt || call.window?.startAt;
      openPopover(anchor, `
        <small>Entry price</small>
        <strong>${escapeHtml(formatPrice(signalEntryPrice(call)))}</strong>
        <p>Taken ${escapeHtml(formatDateTime(at))}</p>
        <p class="muted">${escapeHtml(durationBetween(posted, at))}</p>
      `);
      return;
    }
    const exit = grading.number(signalExitPrice(call));
    const at = call.endPriceAt || call.window?.endAt;
    const target = call.targetPriceAt || call.window?.targetAt;
    openPopover(anchor, Number.isFinite(exit) ? `
        <small>Exit price</small>
        <strong>${escapeHtml(formatPrice(exit))}</strong>
        <p>Taken ${escapeHtml(formatDateTime(at))}</p>
        <p class="muted">${escapeHtml(durationBetween(posted, at))}</p>
      ` : `
        <small>Exit price</small>
        <strong>${escapeHtml(isFuture(target) ? 'Not yet' : 'Being fetched')}</strong>
        <p>${escapeHtml(isFuture(target) ? 'Will be taken' : 'Was due')} ${escapeHtml(formatDateTime(target))}</p>
        <p class="muted">${escapeHtml(windowLabel)} after the post</p>
      `);
  }

  function showPostPopover(anchor, call) {
    const short = String(call.direction || '').toLowerCase() === 'bearish';
    const confidence = grading.number(call.confidence);
    const box = openPopover(anchor, `
      <small>@${escapeHtml(call.username || state.selectedUsername || '')} · ${escapeHtml(formatDateTime(signalCallTime(call)))}</small>
      <p class="post-text">Loading the post…</p>
      <p class="post-read"><b>Read as ${short ? 'Short' : 'Long'} ${escapeHtml(call.symbol || '')}</b>${Number.isFinite(confidence) ? ` · ${Math.round(confidence * 100)}% sure` : ''}${call.thesis ? `<br>${escapeHtml(call.thesis)}` : ''}</p>
      ${signalPostUrl(call) ? `<a class="post-open" href="${escapeAttr(signalPostUrl(call))}" target="_blank" rel="noopener noreferrer">Open on X ↗</a>` : ''}
    `, true);
    if (!box) return;
    const postId = call.postId;
    const fill = (text) => {
      if (popover !== box) return;
      box.querySelector('.post-text').textContent = text;
      placePopover(anchor);
    };
    if (!postId) { fill('The text of this post was not stored.'); return; }
    if (state.postTexts.has(postId)) { fill(state.postTexts.get(postId)); return; }
    getJson(`/api/posts/${encodeURIComponent(postId)}`)
      .then((post) => {
        const text = String(post?.text || '').trim() || 'The text of this post was not stored.';
        state.postTexts.set(postId, text);
        fill(text);
      })
      .catch(() => fill('The post could not be loaded right now.'));
  }

  document.addEventListener('click', (event) => {
    if (popover && !popover.contains(event.target) && !event.target.closest('[data-popover-open]')) closePopover();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover) closePopover();
  });
  window.addEventListener('resize', () => closePopover());



  function accountDisplayName(row) {
    const name = String(row.displayName || '').trim();
    return name && name.toLowerCase() !== `@${row.username.toLowerCase()}` ? name : 'Name unavailable';
  }

  function xProfileUrl(username) {
    const handle = String(username || '').trim().replace(/^@+/, '');
    return `https://x.com/${encodeURIComponent(handle)}`;
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

  async function loadReputationDetail(row) {
    const key = reputationDetailKey(row);
    const cached = state.reputationDetails.get(key);
    if (cached?.loading || (cached?.detail && Date.now() - cached.loadedAt < 45_000)) return;

    state.reputationDetails.set(key, { loading: true, error: null, detail: null });
    renderModal();
    try {
      const username = String(row.username || '').trim();
      const windowKey = row.window || state.reputationWindow;
      const detail = await getJson(`/api/crypto/reputation/${encodeURIComponent(username)}/detail?window=${encodeURIComponent(windowKey)}&period=all&take=250`, 30_000);
      state.reputationDetails.set(key, { loading: false, error: null, detail, loadedAt: Date.now() });
    } catch (error) {
      state.reputationDetails.set(key, {
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load reputation detail',
        detail: null
      });
    }
    if (state.selectedReputation && reputationDetailKey(state.selectedReputation) === key) {
      renderModal();
    }
    if (state.selectedUsername && reputationDetailKey({ username: state.selectedUsername, window: state.panelWindow || state.reputationWindow }) === key) {
      renderList();
    }
  }

  function reputationDetailKey(row) {
    const username = String(row?.username || '').trim().toLowerCase();
    const windowKey = String(row?.window || state.reputationWindow || 'day').toLowerCase();
    return `${state.reputationPeriod}:${windowKey}:${username}`;
  }

  function goToPage(pageIndex) {
    const total = state.allInfluencers.length ? liveRows().length : state.page.total;
    const pageSize = state.pageSize || state.page.pageSize || 250;
    const next = clampPageIndex(pageIndex, total, pageSize);
    if (next === state.pageIndex && state.pagesShown === 1) return;
    state.pageIndex = next;
    state.pagesShown = 1;
    state.selectedUsername = null;
    if (state.allInfluencers.length) {
      renderAll();
      els.leaderboardHead.scrollIntoView({ block: 'start' });
      return;
    }
    void loadSnapshot({ resetListScroll: true }).then(() => {
      if (state.pageIndex === next) {
        els.leaderboardHead.scrollIntoView({ block: 'start' });
      }
    });
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
    const rows = enrichedInfluencerRows();
    const index = rows.findIndex((row) => row.username.toLowerCase() === lower);
    if (index < 0) return `not in scanner list`;
    const pageSize = state.pageSize || state.page.pageSize || 250;
    const page = Math.floor(index / Math.max(pageSize, 1)) + 1;
    return `scanner row ${index + 1}/${rows.length} · page ${page}`;
  }

  function displayRowNumber(row, fallback) {
    if (state.sortMode === 'scanner' && Number.isFinite(Number(row._sourceIndex))) {
      return Number(row._sourceIndex) + 1;
    }
    if (state.reputationErrors.has(state.reputationWindow)) return '–';
    if (!Number.isFinite(reputationScore(row._reputation))) return '–';
    const rank = grading.number(row._reputation?.rank);
    return Number.isSafeInteger(rank) && rank > 0 ? rank : '–';
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
    const mentions = Array.isArray(post.mentions) ? post.mentions : [];
    return `
      <article class="post">
        <span>${escapeHtml(formatMinute(post.scrapedAt || post.postedAt))}</span>
        <div class="post-mentions">${mentionChipsHtml(post, mentions)}</div>
        <a class="post-link" href="${escapeAttr(post.url || '#')}" target="_blank" rel="noreferrer">${escapeHtml(post.content || '')}</a>
        ${selectedMentionPanelHtml(post, mentions)}
      </article>
    `;
  }

  function mentionChipsHtml(post, mentions) {
    if (!mentions.length) return '<strong class="mention-chip plain">post</strong>';
    return mentions.map((item, index) => {
      const symbol = item?.symbol ?? item;
      const direction = normalizeMentionDirection(item?.direction);
      const thesis = item?.thesis ? ` title="${escapeAttr(item.thesis)}"` : '';
      const label = direction === 'bearish' ? 'NEG' : direction === 'bullish' ? 'POS' : '';
      const windows = timexWindowsForMention(post, item);
      const hasTimex = Object.values(windows).some(Boolean);
      const key = mentionKey(post, item, index);
      return `
        <button type="button" class="mention-chip ${direction} ${hasTimex ? 'has-timex' : ''}" data-mention-key="${escapeAttr(key)}"${thesis}>
          <b>${escapeHtml(symbol || '-')}</b>
          ${label ? `<em>${label}</em>` : ''}
          ${item?.thesis ? `<span>${escapeHtml(item.thesis)}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  function selectedMentionPanelHtml(post, mentions) {
    const selected = mentions
      .map((item, index) => ({ item, index, key: mentionKey(post, item, index) }))
      .find((entry) => entry.key === state.selectedMentionKey);
    if (!selected) return '';
    return mentionTimexPanelHtml(post, selected.item, selected.index);
  }

  function mentionTimexPanelHtml(post, mention, index) {
    const symbol = mention?.symbol ?? mention ?? '-';
    const direction = normalizeMentionDirection(mention?.direction);
    const windows = timexWindowsForMention(post, mention);
    return `
      <section class="mention-timex-panel ${direction}">
        <header>
          <div>
            <span>Groq conclusion</span>
            <strong>${escapeHtml(symbol)} · ${direction === 'bullish' ? 'POSITIVE' : direction === 'bearish' ? 'NEGATIVE' : 'waiting Groq'}</strong>
            <em>${escapeHtml(mention?.thesis || 'No thesis yet')}</em>
          </div>
          <small>${escapeHtml(mentionKey(post, mention, index))}</small>
        </header>
        <div class="timex-bars">
          ${REPUTATION_WINDOWS.map((window) => timexBarHtml(window, windows[window.key])).join('')}
        </div>
      </section>
    `;
  }

  function timexBarHtml(window, signal) {
    const progress = Number(signal?.window?.progressPct ?? 0);
    const clamped = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
    const status = signal?.status || 'not_started';
    const score = signal?.score;
    return `
      <button type="button" class="timex-mini ${scoreClass(score)} ${status}" data-signal-id="${escapeAttr(signal?.id || '')}" ${signal ? '' : 'disabled'}>
        <span>
          <b>${escapeHtml(window.label)}</b>
          <em>${escapeHtml(signal ? windowText(signal) : 'waiting for Timex window')}</em>
        </span>
        <i class="progress-track"><span style="width:${clamped}%"></span></i>
        <strong>${signal ? formatScore(score) : '-'}</strong>
      </button>
    `;
  }

  function timexWindowsForMention(post, mention) {
    const symbol = normalizeSymbol(mention?.symbol ?? mention);
    const postId = String(post?.id ?? post?.postId ?? '');
    const username = String(post?.username ?? '').toLowerCase();
    const matches = (state.timex || []).filter((signal) => {
      const signalSymbol = normalizeSymbol(signal.symbol);
      if (!symbol || signalSymbol !== symbol) return false;
      const signalPostId = String(signal.postId ?? signal.PostId ?? '');
      if (postId && signalPostId && postId === signalPostId) return true;
      return username && String(signal.username || '').toLowerCase() === username;
    });
    const byWindow = {};
    for (const item of matches) {
      const key = String(item.horizonKey || item.window?.horizon || '').toLowerCase();
      if (!key) continue;
      if (!byWindow[key] || new Date(item.updatedAt || 0) > new Date(byWindow[key].updatedAt || 0)) {
        byWindow[key] = item;
      }
    }
    return byWindow;
  }

  function mentionKey(post, mention, index = 0) {
    return [
      post?.id ?? post?.sourcePostId ?? 'post',
      normalizeSymbol(mention?.symbol ?? mention) || 'crypto',
      index
    ].join(':');
  }

  function normalizeSymbol(symbol) {
    return String(symbol || '').replace(/^\$/, '').trim().toUpperCase();
  }

  function normalizeMentionDirection(direction) {
    const value = String(direction || '').toLowerCase();
    if (value === 'bullish' || value === 'bearish') return value;
    return 'plain';
  }

  function renderModal() {
    const wasOpen = Boolean(els.modalRoot.firstElementChild);
    const active = document.activeElement;
    const previousLinks = [...els.modalRoot.querySelectorAll('button, a[href]')];
    const focusIndex = previousLinks.indexOf(active);
    const dialog = state.selectedSignal ? signalModal(state.selectedSignal)
      : state.selectedReputation ? reputationModal(state.selectedReputation) : null;
    els.modalRoot.replaceChildren(...(dialog ? [dialog] : []));
    if (dialog) {
      const controls = [...dialog.querySelectorAll('button, a[href]')];
      (controls[focusIndex] || controls[0])?.focus({ preventScroll: true });
    } else if (wasOpen && (!active || !active.isConnected)) {
      els.list.querySelector('.leaderboard-entry[open] > summary')?.focus({ preventScroll: true });
    }
  }

  function handleModalKey(event) {
    if (event.key === 'Escape') {
      state.selectedSignal = null;
      state.selectedReputation = null;
      renderModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...els.modalRoot.querySelectorAll('button, a[href]')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  function signalModal(signal) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
        <header>
          <div>
            <span class="eyebrow">TIMEX</span>
            <h2 id="dialogTitle">${escapeHtml(signal.serialRef || `Signal #${signal.id}`)}</h2>
          </div>
          <button type="button" class="menu-close">Close</button>
        </header>
        <div class="signal-graph">
          ${signalGraph(signal)}
        </div>
        <div class="modal-grid">
          ${detailCard('Alias', `@${signal.username || '-'}`)}
          ${detailCard('Coin', signal.symbol || '-')}
          ${detailCard('Horizon', signal.horizonLabel || signal.window?.label || '-')}
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
    const detailState = state.reputationDetails.get(reputationDetailKey(row));
    const detail = detailState?.detail;
    const currentDetail = grading.detail(row, detail);
    const scored = currentDetail.scored.filter((signal) => Number.isFinite(grading.number(signal.score)));
    // Rank and score come from the ranking shown on the page (same minimum number of calls).
    const score = reputationScore(row);
    const ranked = Number.isFinite(score);
    const quality = currentDetail.quality || row.quality;
    const calls = grading.calls(quality ? { quality } : row);
    const label = reputationWindowLabel(row.window || state.reputationWindow);
    const status = ranked ? `Rank ${row.rank}` : calls ? `Not ranked yet: ${calls} of ${MINIMUM_RANKED_CALLS} calls` : 'No graded call yet';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal-card reputation-detail-card" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
        <header>
          <div>
            <span class="eyebrow">${escapeHtml(status)}</span>
            <h2 id="dialogTitle">@${escapeHtml(row.username || '-')} · ${escapeHtml(label)}</h2>
          </div>
          <button type="button" class="menu-close">Close</button>
        </header>
        ${detailState?.loading ? '<p class="empty-inline">Loading the calls…</p>' : ''}
        ${detailState?.error ? `<p class="paper-error">The calls could not be loaded (${escapeHtml(detailState.error)}).</p>` : ''}
        <section class="reputation-score-summary" aria-label="Performance ${escapeHtml(label)} after each call">
          <span><b>${escapeHtml(formatScore(score))}</b><em>score</em></span>
          <span><b>${escapeHtml(String(calls || '–'))}</b><em>graded calls</em></span>
          <span><b>${escapeHtml(grading.pct(quality?.directionAccuracyPct))}</b><em>right direction</em></span>
          <span><b>${escapeHtml(grading.pct(quality?.meanDirectionalVariationPct, true))}</b><em>average move</em></span>
        </section>
        <p class="reputation-score-note">
          Each call is checked ${escapeHtml(label)} after it was posted. It scores 50, plus 5 points for every 1% the price
          moved in the called direction (minus 5 when it moved the other way), between 0 and 100. The account score is the
          plain average of all its calls, so the highest average ranks first, whatever the number of calls. An account is
          ranked from ${MINIMUM_RANKED_CALLS} graded calls. Results are before trading costs.
        </p>
        <section class="scored-only-panel">
          <header>
            <strong>Latest graded calls</strong>
            <em>${scored.length}${calls ? ` of ${calls}` : ''}</em>
          </header>
          <div class="scored-only-list">
            ${scored.length ? scored.map(scoredOnlySignalHtml).join('') : `<p class="empty-inline">${detailState?.loading ? 'Loading…' : 'No graded call for this period yet.'}</p>`}
          </div>
        </section>
      </section>
    `;
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('button.menu-close')) {
        state.selectedReputation = null;
        renderModal();
      }
    });
    return backdrop;
  }

  function scoredOnlySignalHtml(signal) {
    const score = grading.number(signal.score);
    const reason = signalReasonText(signal);
    const scoreText = Number.isFinite(score) ? formatScore(score) : '-';
    const symbol = signal.symbol || '-';
    const variation = formatVariation(signal.variationPct);
    const direction = signal.direction || '-';
    const status = signalStatusText(signal);
    const verdict = signalOutcomeText(signal);
    const callTime = compactTime(signalCallTime(signal));
    const endTime = compactTime(signal.targetPriceAt || signal.window?.targetAt || signalEndTime(signal));
    const entryPrice = compactPrice(signalEntryPrice(signal));
    const exitPrice = compactPrice(signalExitPrice(signal));
    const url = signalPostUrl(signal);
    const tag = url ? 'a' : 'article';
    const attrs = url ? ` href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="Open X post"` : '';
    return `
      <${tag} class="scored-only-row scored-call-link ${scoreClass(score)}"${attrs}>
        <span class="scored-call-crypto"><b>${escapeHtml(symbol)}</b><small>${escapeHtml(direction)} · ${escapeHtml(variation)}</small></span>
        <span class="scored-call-score"><b>${escapeHtml(scoreText)}</b><small>score</small></span>
        <span class="scored-call-window"><small>${escapeHtml(callTime)} → ${escapeHtml(endTime)}</small><small>${escapeHtml(entryPrice)} → ${escapeHtml(exitPrice)}</small></span>
        <span class="scored-call-status"><b>${escapeHtml(verdict)}</b><small>${escapeHtml(status)}</small></span>
        <small class="scored-call-reason">${escapeHtml(reason)}</small>
      </${tag}>
    `;
  }

  function signalOutcomeText(signal) {
    const direction = String(signal?.direction || '').toLowerCase();
    const variation = grading.number(signal?.variationPct);
    if (!Number.isFinite(variation) || (direction !== 'bullish' && direction !== 'bearish')) return 'scored call';
    const priceMove = variation > 0 ? 'price up' : variation < 0 ? 'price down' : 'flat';
    const good = direction === 'bullish' ? variation > 0 : variation < 0;
    if (variation === 0) return `${priceMove} · neutral`;
    return `${priceMove} · ${good ? 'good call' : 'bad call'}`;
  }

  function signalPostUrl(signal) {
    return signal.url || signal.postUrl || signal.sourceUrl || signal.Url || '';
  }

  function signalCallTime(signal) {
    return signal.postedAt || signal.posted_at || signal.postCreatedAt || signal.post_created_at ||
      signal.tweetCreatedAt || signal.tweet_created_at || signal.createdAt || signal.created_at ||
      signal.mentionedAt || signal.mentioned_at || signal.callAt || signal.call_at ||
      signal.startPriceAt || signal.start_price_at || signal.window?.startAt ||
      signal.window?.start_at || '';
  }

  function signalEndTime(signal) {
    return signal.endPriceAt || signal.end_price_at || signal.exitPriceAt || signal.exit_price_at ||
      signal.exitAt || signal.exit_at || signal.targetPriceAt || signal.target_price_at ||
      signal.window?.targetAt || signal.window?.target_at || '';
  }

  function signalEntryPrice(signal) {
    return signal.startPriceUsd ?? signal.start_price_usd ?? signal.entryPriceUsd ??
      signal.entry_price_usd ?? signal.priceStartUsd ?? signal.price_start_usd ??
      signal.startPrice ?? signal.entryPrice ?? signal.window?.startPriceUsd ??
      signal.window?.start_price_usd ?? signal.window?.startPrice;
  }

  function signalExitPrice(signal) {
    return signal.endPriceUsd ?? signal.end_price_usd ?? signal.exitPriceUsd ??
      signal.exit_price_usd ?? signal.priceEndUsd ?? signal.price_end_usd ??
      signal.endPrice ?? signal.exitPrice ?? signal.window?.endPriceUsd ??
      signal.window?.end_price_usd ?? signal.window?.endPrice;
  }

  function compactTime(value) {
    return value ? formatMinute(value) : '-';
  }

  function compactPrice(value) {
    const number = Number(value);
    return Number.isFinite(number) ? formatPrice(number) : '-';
  }

  function pipelineSectionHtml(title, kind, signals, emptyText) {
    return `
      <section class="pipeline-section">
        <header>
          <strong>${escapeHtml(title)}</strong>
          <em>${signals.length}</em>
        </header>
        <div class="history-list">
          ${signals.length ? signals.map((signal, index) => pipelineSignalHtml(signal, kind, index)).join('') : `<p class="empty-inline">${escapeHtml(emptyText)}</p>`}
        </div>
      </section>
    `;
  }

  function pipelineSignalHtml(signal, kind, index) {
    const status = signalStatusText(signal);
    const score = grading.number(signal.score);
    const endValue = Number.isFinite(score) ? formatScore(score) : status;
    return `
      <button class="history-row pipeline-row ${scoreClass(signal.score)}" type="button" data-pipeline-kind="${escapeAttr(kind)}" data-pipeline-index="${index}">
        <strong>${escapeHtml(signal.serialRef || `#${signal.id}`)}</strong>
        <span>${escapeHtml(signalCompactMeta(signal))}</span>
        <small>${escapeHtml(signalReasonText(signal))}</small>
        <em>${escapeHtml(endValue)}</em>
      </button>
    `;
  }

  function rawMentionSectionHtml(mentions) {
    return `
      <section class="pipeline-section raw-section">
        <header>
          <strong>Raw mentions</strong>
          <em>${mentions.length}</em>
        </header>
        <div class="raw-mention-list">
          ${mentions.length ? mentions.map(rawMentionHtml).join('') : '<p class="empty-inline">No raw mention.</p>'}
        </div>
      </section>
    `;
  }

  function rawMentionHtml(mention) {
    const source = `${mention.source || 'raw'} · ${confidenceText(mention.confidence)} · ${mention.reason || mention.status || '-'}`;
    return `
      <article class="raw-mention-row">
        <strong>${escapeHtml(mention.symbol || '-')}</strong>
        <span>${escapeHtml(source)}</span>
        <em>${formatMinute(mention.postedAt || mention.mentionedAt)}</em>
        <p>${escapeHtml(compactText(mention.content || ''))}</p>
      </article>
    `;
  }

  function coinLedgerHtml(coins) {
    const rows = Array.isArray(coins) ? coins : [];
    return `
      <section class="coin-ledger">
        <header>
          <strong>Coins</strong>
          <em>${rows.length}</em>
        </header>
        <div class="coin-ledger-list">
          ${rows.length ? rows.map(coinRowHtml).join('') : '<p class="empty-inline">No coin yet.</p>'}
        </div>
      </section>
    `;
  }

  function coinRowHtml(coin) {
    const status = String(coin.status || 'raw').toLowerCase();
    const score = grading.number(coin.score ?? coin.bestScore);
    const hasScore = status === 'scored' && Number.isFinite(score);
    const scoreText = hasScore ? formatScore(score) : coinStatusText(status);
    const meta = coinMetaText(coin);
    const note = coinNoteText(coin);
    return `
      <article class="coin-row ${escapeAttr(status)} ${hasScore ? scoreClass(score) : ''}">
        <span class="coin-symbol">${escapeHtml(coin.symbol || '-')}</span>
        <span class="coin-meta">
          <strong>${escapeHtml(coin.coinId || 'unresolved')}</strong>
          <em>${escapeHtml(meta)}</em>
          ${note ? `<small>${escapeHtml(note)}</small>` : ''}
        </span>
        <b>${escapeHtml(scoreText)}</b>
      </article>
    `;
  }

  function coinStatusText(status) {
    if (status === 'scored') return 'scored';
    if (status === 'waiting') return 'waiting';
    if (status === 'blocked') return 'blocked';
    return 'raw';
  }

  function coinMetaText(coin) {
    const pieces = [];
    const scored = Number(coin.scoredCount || 0);
    const waiting = Number(coin.waitingCount || 0);
    const blocked = Number(coin.blockedCount || 0);
    const raw = Number(coin.rawMentionCount || 0);
    if (scored) pieces.push(`${scored} scored`);
    if (waiting) pieces.push(`${waiting} waiting`);
    if (blocked) pieces.push(`${blocked} blocked`);
    if (raw) pieces.push(`${raw} raw`);
    if (coin.direction) pieces.push(String(coin.direction));
    return pieces.length ? pieces.join(' · ') : coinStatusText(coin.status);
  }

  function coinNoteText(coin) {
    if (coin.status === 'blocked' && coin.reason) return coin.reason;
    if (coin.status === 'waiting' && coin.lastSeenAt) return `target pending · ${formatMinute(coin.lastSeenAt)}`;
    if (coin.status === 'scored') {
      const avg = grading.number(coin.averageScore);
      const best = grading.number(coin.bestScore);
      if (Number.isFinite(avg) && Number.isFinite(best)) return `avg ${formatScore(avg)} · best ${formatScore(best)}`;
    }
    return compactText(coin.thesis || coin.reason || '');
  }

  function buildCoinLedger(scored, waiting, rejected, rawMentions) {
    const map = new Map();
    const get = (symbol, coinId) => {
      const key = normalizeSymbol(symbol) || 'UNKNOWN';
      if (!map.has(key)) {
        map.set(key, {
          symbol: key,
          coinId: coinId || '',
          status: 'raw',
          scoredCount: 0,
          waitingCount: 0,
          blockedCount: 0,
          rawMentionCount: 0,
          totalMentions: 0
        });
      }
      const row = map.get(key);
      if (!row.coinId && coinId) row.coinId = coinId;
      return row;
    };
    scored.forEach((signal) => {
      const row = get(signal.symbol, signal.coinId);
      row.status = 'scored';
      row.scoredCount += 1;
      row.score = signal.score;
      row.bestScore = Math.max(Number(row.bestScore ?? signal.score), Number(signal.score));
      row.averageScore = signal.score;
      row.direction = signal.direction;
      row.thesis = signal.thesis;
      row.totalMentions += 1;
    });
    waiting.forEach((signal) => {
      const row = get(signal.symbol, signal.coinId);
      if (row.status !== 'scored') row.status = 'waiting';
      row.waitingCount += 1;
      row.direction = signal.direction;
      row.thesis = signal.thesis;
      row.lastSeenAt = signal.mentionedAt || signal.updatedAt;
      row.totalMentions += 1;
    });
    rejected.forEach((signal) => {
      const row = get(signal.symbol, signal.coinId);
      if (row.status !== 'scored' && row.status !== 'waiting') row.status = 'blocked';
      row.blockedCount += 1;
      row.reason = signalReasonText(signal);
      row.direction = signal.direction;
      row.thesis = signal.thesis;
      row.totalMentions += 1;
    });
    rawMentions.forEach((mention) => {
      const row = get(mention.symbol, mention.coinId);
      row.rawMentionCount += 1;
      row.totalMentions += 1;
      row.source = mention.source;
      if (!row.direction && mention.direction) row.direction = mention.direction;
      if (!row.thesis && mention.thesis) row.thesis = mention.thesis;
    });
    return [...map.values()].sort((a, b) => {
      const statusRank = { scored: 0, waiting: 1, blocked: 2, raw: 3 };
      return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
        Number(b.score ?? b.bestScore ?? -1) - Number(a.score ?? a.bestScore ?? -1) ||
        Number(b.totalMentions ?? 0) - Number(a.totalMentions ?? 0) ||
        String(a.symbol).localeCompare(String(b.symbol));
    });
  }

  function signalCompactMeta(signal) {
    const symbol = signal.symbol || '-';
    const variation = formatVariation(signal.variationPct);
    const status = signalStatusText(signal);
    const side = signal.direction ? ` · ${signal.direction}` : '';
    return `${symbol} · ${variation} · ${status}${side}`;
  }

  function signalStatusText(signal) {
    const status = String(signal.status || signal.window?.status || 'pending');
    if (status.startsWith('waiting_')) {
      return `${status.replaceAll('_', ' ')} · target ${formatMinute(signal.targetPriceAt || signal.window?.targetAt)}`;
    }
    return status.replaceAll('_', ' ');
  }

  function signalReasonText(signal) {
    if (signal.error) return signal.error;
    if (!signal.coinId) return 'coin unresolved';
    if (signal.thesis) return signal.thesis;
    return signal.source || '-';
  }

  function confidenceText(value) {
    const number = grading.number(value);
    return Number.isFinite(number) ? `${Math.round(number * 100)}%` : '-';
  }

  function compactText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  }

  function performanceLine(reputation, score) {
    if (!reputation) return null;
    const quality = reputation.quality || {};
    const calls = grading.calls(reputation);
    if (!Number.isFinite(score)) {
      return calls ? { text: `${calls} of ${MINIMUM_RANKED_CALLS} calls needed`, tone: 'muted' } : null;
    }
    const move = grading.number(quality.meanDirectionalVariationPct);
    const right = grading.number(quality.directionAccuracyPct);
    const parts = [];
    if (Number.isFinite(right)) parts.push(`${Math.round(right)}% right`);
    if (Number.isFinite(move)) parts.push(`${grading.pct(move, true)} avg move`);
    return parts.length ? { text: parts.join(' · '), tone: move > 0 ? 'up' : move < 0 ? 'down' : 'muted' } : null;
  }

  function formatCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('en-US') : '0';
  }

  function reputationScore(item) {
    return grading.score(item);
  }

  function reputationScoredCount(item) {
    return grading.calls(item);
  }

  function windowAverageScore(windowKey) {
    const rows = reputationRowsForWindow(windowKey)
      .filter((row) => Number.isFinite(reputationScore(row)))
      .map((row) => grading.number(row.averageScore))
      .filter(Number.isFinite);
    if (!rows.length) return NaN;
    return rows.reduce((sum, score) => sum + score, 0) / rows.length;
  }

  function signalGraph(signal) {
    const start = grading.number(signal.startPriceUsd);
    const end = grading.number(signal.endPriceUsd);
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
    if (String(signal.status || '').startsWith('waiting_')) {
      const duration = Number(window.durationMinutes ?? 360);
      const label = window.label || (duration >= 60 ? `${Math.round(duration / 60)}h` : `${duration}m`);
      return `${label} window · ${Math.round(Number(window.progressPct ?? 0))}% · target ${formatMinute(window.targetAt)} · ${Number(window.minutesRemaining ?? 0).toFixed(1)} min left`;
    }
    if (signal.status === 'scored') {
      return `scored · ${formatMinute(signal.startPriceAt)} → ${formatMinute(signal.endPriceAt)}`;
    }
    return signal.status || 'pending';
  }

  function scoreClass(score) {
    const value = grading.number(score);
    if (!Number.isFinite(value)) return 'neutral';
    if (value >= 55) return 'good';
    if (value <= 45) return 'bad';
    return 'neutral';
  }

  function formatScore(score) {
    const value = grading.number(score);
    return Number.isFinite(value) ? value.toFixed(1) : '-';
  }

  function formatVariation(value) {
    const number = grading.number(value);
    if (!Number.isFinite(number)) return '-';
    const sign = number > 0 ? '+' : '';
    return `${sign}${number.toFixed(2)}%`;
  }

  function formatPrice(value) {
    const number = grading.number(value);
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

  function prepareRankingAvatar(avatar, username) {
    if (avatar.tagName !== 'IMG') {
      avatar.setAttribute('aria-hidden', 'true');
      return;
    }
    avatar.alt = '';
    avatar.addEventListener('error', () => {
      const initials = document.createElement('span');
      initials.className = 'avatar avatar-fallback';
      initials.textContent = username.slice(0, 1).toUpperCase();
      initials.setAttribute('aria-hidden', 'true');
      avatar.replaceWith(initials);
    }, { once: true });
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
