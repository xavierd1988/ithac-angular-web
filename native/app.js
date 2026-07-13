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
    selectedMentionKey: null,
    selectedReputation: null,
    activeTab: 'live',
    selectedPosts: new Map(),
    run: null,
    page: { pageIndex: 0, pageSize: 250, total: 0, items: [] },
    sessions: [],
    proxies: [],
    jobs: [],
    events: [],
    allInfluencers: [],
    allInfluencersLoadedAt: 0,
    timex: [],
    reputationWindow: 'day',
    reputation: {
      day: [],
      week: [],
      month: []
    },
    reputationDetails: new Map(),
    paper: null,
    paperSync: null,
    paperBusy: false,
    paperError: null,
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
    loadError: byId('loadError'),
    list: byId('list'),
    mainTabs: document.querySelectorAll('[data-tab]'),
    pager: document.querySelector('.pager'),
    modalRoot: byId('modalRoot')
  };

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
    els.prevPage.addEventListener('click', () => goToPage(state.pageIndex - 1));
    els.nextPage.addEventListener('click', () => goToPage(state.pageIndex + 1));
    els.pageSize.addEventListener('change', () => {
      state.pageSize = Number(els.pageSize.value) || 250;
      state.pageIndex = 0;
      void loadSnapshot({ resetListScroll: true });
    });
    els.list.addEventListener('click', handleListClick);
    els.mainTabs.forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab || 'live'));
    });

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
      void loadAllInfluencers(false);
      if (requestId !== state.snapshotSeq) return;

      state.loadError = null;
      state.run = snapshot.run;
      state.page = snapshot.influencerPage;
      mergeInfluencerRows(snapshot.influencerPage?.items ?? []);
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
      const [timex, repDay, repWeek, repMonth, paper] = await Promise.all([
        getJson('/api/crypto/timex?take=500').catch(() => []),
        getJson('/api/crypto/reputation?window=day&take=2500').catch(() => []),
        getJson('/api/crypto/reputation?window=week&take=2500').catch(() => []),
        getJson('/api/crypto/reputation?window=month&take=2500').catch(() => []),
        getJson('/api/paper/summary?sync=false').catch(() => null)
      ]);
      state.timex = Array.isArray(timex) ? timex : [];
      state.reputation = {
        day: Array.isArray(repDay) ? repDay : [],
        week: Array.isArray(repWeek) ? repWeek : [],
        month: Array.isArray(repMonth) ? repMonth : []
      };
      if (paper) state.paper = paper;
      state.paperError = null;
      renderAll();
    } catch {
      state.timex = [];
      state.reputation = { day: [], week: [], month: [] };
      renderAll();
    }
  }

  async function loadAllInfluencers(force = false) {
    const now = Date.now();
    if (!force && state.allInfluencers.length && now - state.allInfluencersLoadedAt < 60_000) return;
    try {
      const rows = await getJson('/api/influencers');
      if (!Array.isArray(rows)) return;
      state.allInfluencers = rows;
      state.allInfluencersLoadedAt = Date.now();
      renderAll();
    } catch {
      // Snapshot paging remains usable when the full list endpoint is unavailable.
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

  function handleListClick(event) {
    const paperAction = event.target.closest('[data-paper-action]');
    if (paperAction?.dataset.paperAction) {
      event.preventDefault();
      void runPaperAction(paperAction.dataset.paperAction);
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

  function setTab(tab) {
    const next = ['live', 'paper'].includes(tab) ? tab : 'live';
    if (state.activeTab === next) return;
    state.activeTab = next;
    state.selectedUsername = null;
    state.selectedSignal = null;
    state.selectedMentionKey = null;
    state.selectedReputation = null;
    renderAll();
    if (next === 'paper') void loadCryptoPanels();
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

  function renderPager() {
    els.pager.hidden = state.activeTab !== 'live';
    if (state.activeTab !== 'live') return;
    const total = liveRows().length;
    const pageSize = state.pageSize || state.page.pageSize || 250;
    const pageCount = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
    const pageIndex = clampPageIndex(state.pageIndex, total, pageSize);
    const start = total ? pageIndex * pageSize + 1 : 0;
    const end = Math.min(total, start + pageSize - 1);
    const run = state.run;

    els.pageStatus.textContent = `Page ${pageIndex + 1} / ${pageCount} · ${start}-${end} of ${total} · ${run?.successCount ?? 0} complete · ${run?.failedCount ?? 0} failed`;
    els.prevPage.disabled = pageIndex <= 0;
    els.nextPage.disabled = pageIndex >= pageCount - 1;
    els.pageSize.value = String(pageSize);

    els.pageNumbers.replaceChildren(...pageButtonNodes(pageIndex, pageCount));
    els.loadError.hidden = !state.loadError;
    els.loadError.textContent = state.loadError ? `Live API not loaded: ${state.loadError}` : '';
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
    if (state.activeTab === 'paper') {
      renderPaper();
      return;
    }
    const allRows = liveRows();
    const pageSize = state.pageSize || state.page.pageSize || 250;
    const pageIndex = clampPageIndex(state.pageIndex, allRows.length, pageSize);
    const rows = allRows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
    const nodes = [renderScannerPath(), renderReputationSwitcher()];
    if (!rows.length) {
      const empty = document.createElement('article');
      empty.className = 'empty';
      empty.innerHTML = `<strong>No handle</strong><br><span>${escapeHtml(state.loadError ? 'The backend did not answer this browser yet.' : 'No influencer on this page.')}</span>`;
      els.list.replaceChildren(...nodes, empty);
      return;
    }

    rows.forEach((row, index) => {
      nodes.push(renderRow(row, displayRowNumber(row, pageIndex * pageSize + index + 1)));
      if (state.selectedUsername?.toLowerCase() === row.username.toLowerCase()) {
        nodes.push(renderDetail(row));
      }
    });
    els.list.replaceChildren(...nodes);
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
    const rows = enrichedInfluencerRows().filter(matchesLiveFilters);
    rows.sort(compareLiveRows);
    return rows;
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

  function renderReputationSwitcher() {
    const wrap = document.createElement('section');
    wrap.className = 'reputation-switcher merged-ranking-switcher';
    const total = liveRows().length;
    const scored = currentReputationRows().length;
    const activeLabel = reputationWindowLabel(state.reputationWindow);
    const activeScored = reputationRowsForWindow(state.reputationWindow).filter((row) => reputationScoredCount(row) > 0).length;
    const avg = windowAverageScore(state.reputationWindow);
    wrap.innerHTML = `
      <div>
        <strong>${state.sortMode === 'scanner' ? 'Scanner order + scores' : `${activeLabel} best scores + scraper`}</strong>
        <span>${activeScored} aliases with ${activeLabel} calls · ${scored} scored in ${activeLabel} · sorted by highest score first · avg ${formatScore(avg)} · ${total} total handles.</span>
      </div>
      <div class="reputation-window-buttons">
        <button type="button" data-sort-mode="scanner" class="${state.sortMode === 'scanner' ? 'active' : ''}">
          SCANNER
          <em>natural list</em>
        </button>
        <button type="button" data-sort-mode="score" class="${state.sortMode === 'score' ? 'active' : ''}">
          SCORE
          <em>best first</em>
        </button>
        ${REPUTATION_WINDOWS.map((item) => `
          <button type="button" data-reputation-window="${escapeAttr(item.key)}" class="${state.reputationWindow === item.key ? 'active' : ''}">
            ${escapeHtml(item.label)}
            <em>${(state.reputation?.[item.key] ?? []).length} scored · avg ${formatScore(windowAverageScore(item.key))}</em>
          </button>
        `).join('')}
      </div>
    `;
    wrap.querySelectorAll('[data-sort-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.sortMode = button.dataset.sortMode === 'score' ? 'score' : 'scanner';
        state.selectedUsername = null;
        state.pageIndex = 0;
        renderAll();
      });
    });
    wrap.querySelectorAll('[data-reputation-window]').forEach((button) => {
      button.addEventListener('click', () => {
        state.reputationWindow = button.dataset.reputationWindow || 'day';
        state.selectedReputation = null;
        state.pageIndex = 0;
        renderAll();
      });
    });
    return wrap;
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
      button.addEventListener('click', () => jumpToScannerRow(button.dataset.jumpUsername || ''));
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

  function jumpToScannerRow(username) {
    const rows = liveRows();
    const lower = String(username || '').toLowerCase();
    const index = rows.findIndex((row) => String(row.username || '').toLowerCase() === lower);
    if (index < 0) return;
    const pageSize = state.pageSize || state.page.pageSize || 250;
    state.pageIndex = Math.floor(index / Math.max(pageSize, 1));
    state.selectedUsername = username;
    renderAll();
  }

  function renderPaper() {
    const paper = state.paper;
    if (!paper) {
      els.list.replaceChildren(emptyNode('No paper state', state.paperError || 'Paper trading summary is not loaded yet.'));
      return;
    }

    const scrollState = capturePaperScroll();
    const run = paper.currentRun;
    const totals = paper.totals || {};
    const openTrades = paper.openTrades || [];
    const closedTrades = paper.closedTrades || [];
    const allTrades = [...openTrades, ...closedTrades].sort(comparePaperTradesByProgress);
    const active = run?.status === 'active';
    const view = document.createElement('section');
    view.className = 'paper-view';
    view.innerHTML = `
      <section class="paper-list-card">
        <header class="paper-list-head">
          <div>
            <span class="label">Paper trading</span>
            <strong>${run ? `Run #${escapeHtml(run.id)} · ${escapeHtml(run.status)}` : 'No active run'}</strong>
            <em>${Number(totals.openTrades ?? openTrades.length)} open · ${Number(totals.closedTrades ?? closedTrades.length)} closed · net ${formatMoney(totals.netPnlUsd)}</em>
          </div>
          <div class="paper-actions">
            <button type="button" data-paper-action="start" ${active || state.paperBusy ? 'disabled' : ''}>Start</button>
            <button type="button" data-paper-action="sync" ${!run || state.paperBusy ? 'disabled' : ''}>Sync</button>
            <button type="button" data-paper-action="stop" ${!active || state.paperBusy ? 'disabled' : ''}>Stop</button>
          </div>
        </header>
        ${state.paperError ? `<p class="paper-error">${escapeHtml(state.paperError)}</p>` : ''}
        <div class="paper-progress-list">
          ${allTrades.length ? allTrades.map(paperTradeProgressRowHtml).join('') : '<p class="empty-inline">No paper trade yet.</p>'}
        </div>
      </section>
    `;
    els.list.replaceChildren(view);
    restorePaperScroll(scrollState);
  }

  async function runPaperAction(action) {
    if (state.paperBusy) return;
    state.paperBusy = true;
    state.paperError = null;
    renderAll();
    try {
      if (action === 'start') {
        await postJson('/api/paper/runs', {
          name: 'Reputation Top 10',
          topNPerWindow: 10,
          stakeUsd: 100,
          feeBpsPerSide: 10,
          spreadBps: 30,
          slippageBps: 50,
          maxSignalAgeMinutes: 180,
          maxOpenPositions: 90
        });
      } else if (action === 'sync') {
        state.paperSync = await postJson('/api/paper/sync', {});
      } else if (action === 'stop') {
        await postJson('/api/paper/runs/current/stop', {});
      }
      state.paper = await getJson('/api/paper/summary?sync=false');
    } catch (error) {
      state.paperError = error instanceof Error ? error.message : 'Paper action failed';
    } finally {
      state.paperBusy = false;
      renderAll();
    }
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

  function capturePaperScroll() {
    return {
      listTop: els.list.scrollTop
    };
  }

  function restorePaperScroll(scrollState) {
    if (!scrollState) return;
    els.list.scrollTop = scrollState.listTop || 0;
  }

  function paperTradeProgressRowHtml(trade) {
    const username = String(trade.username || '').trim();
    const profileUrl = xProfileUrl(username);
    const profileLabel = `Open @${username || 'profile'} on X`;
    const closed = String(trade.status || '').toLowerCase() === 'closed' || Boolean(trade.exitAt);
    const progress = paperTradeProgressPct(trade);
    const block = paperTradeBlock(trade);
    const result = closed ? paperTradeResult(trade) : (block ? block.result : 'waiting exit');
    const resultClass = closed ? moneyClass(trade.netPnlUsd) : (block ? 'blocked' : 'neutral');
    const progressText = closed ? 'complete' : (block ? block.progress : paperTradeProgressText(trade));
    const rank = trade.rank ?? trade.rankPosition ?? '-';
    return `
      <article class="paper-progress-row ${closed ? 'closed' : block ? 'blocked' : 'open'}">
        <section class="paper-progress-trade">
          <a class="avatar-link paper-avatar x-profile-link" href="${escapeAttr(profileUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(profileLabel)}">
            ${avatarHtml({ ...trade, username })}
          </a>
          <span>
            <strong>${escapeHtml(trade.displayName || `@${username || '-'}`)} · ${escapeHtml(trade.symbol || '-')}</strong>
            <em>@${escapeHtml(username || '-')} · ${escapeHtml(windowShortLabel(trade.categoryWindow))} · #${escapeHtml(trade.rank ?? '-')} · ${escapeHtml(trade.direction || '-')}</em>
          </span>
        </section>
        <section class="paper-progress-main">
          <span>${escapeHtml(progressText)}</span>
          <div class="paper-progress-track"><i style="width:${progress}%"></i></div>
          <em>entry ${formatPrice(trade.entryPriceUsd)} · ${formatMinute(trade.entryAt)} → ${closed ? `exit ${formatPrice(trade.exitPriceUsd)} · ${formatMinute(trade.exitAt)}` : block ? `${block.detail} · target ${formatMinute(trade.targetExitAt)}` : `target ${formatMinute(trade.targetExitAt)}`}</em>
        </section>
        <span class="paper-progress-result ${escapeAttr(resultClass)}">
          <small>${closed ? 'result' : block ? escapeHtml(block.label) : `rank #${escapeHtml(rank)}`}</small>
          <strong>${escapeHtml(result)}</strong>
        </span>
      </article>
    `;
  }

  function paperTradeBlock(trade) {
    const closed = String(trade.status || '').toLowerCase() === 'closed' || Boolean(trade.exitAt);
    if (closed) return null;
    const status = String(trade.signalWindowStatus || '').trim().toLowerCase();
    const error = String(trade.signalWindowError || '').trim().toLowerCase();
    const due = paperTradeProgressPct(trade) >= 99.9 && new Date(trade.targetExitAt).getTime() <= Date.now();
    if (!due && !status.includes('error') && !error) return null;
    if (status.includes('price') || error.includes('coingecko') || error.includes('price')) {
      return {
        label: 'CoinGecko',
        progress: 'price unavailable',
        result: 'price missing',
        detail: humanPaperTradeError(error || status)
      };
    }
    if (status && status !== 'scored' && status !== 'closed') {
      return {
        label: 'Timex',
        progress: status.replaceAll('_', ' '),
        result: 'not scored',
        detail: humanPaperTradeError(error || status)
      };
    }
    return due ? {
      label: 'Timex',
      progress: 'waiting Timex',
      result: 'waiting exit',
      detail: 'Timex has not produced an exit price yet'
    } : null;
  }

  function humanPaperTradeError(value) {
    const clean = String(value || '').trim();
    if (!clean) return 'Exit price unavailable';
    if (clean === 'coingecko_history_start_unavailable') return 'CoinGecko history unavailable';
    if (clean.includes('coingecko')) return clean.replaceAll('_', ' ');
    return clean.replaceAll('_', ' ');
  }

  function paperTradeResult(trade) {
    const pnl = Number(trade.netPnlUsd);
    const pct = trade.netReturnPct ?? trade.grossReturnPct;
    if (!Number.isFinite(pnl)) return 'closed';
    return `${formatMoney(pnl)} · ${formatSignedPct(pct)}`;
  }

  function paperTradeProgressPct(trade) {
    if (String(trade.status || '').toLowerCase() === 'closed' || trade.exitAt) return 100;
    const entry = new Date(trade.entryAt).getTime();
    const target = new Date(trade.targetExitAt).getTime();
    if (!Number.isFinite(entry) || !Number.isFinite(target) || target <= entry) return 0;
    const pct = ((Date.now() - entry) / (target - entry)) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  function paperTradeProgressText(trade) {
    const pct = paperTradeProgressPct(trade);
    const target = new Date(trade.targetExitAt).getTime();
    const minutes = Number.isFinite(target) ? Math.max(0, Math.round((target - Date.now()) / 60000)) : null;
    if (minutes == null) return `${Math.round(pct)}% to exit`;
    if (minutes >= 120) return `${Math.round(pct)}% · ${Math.round(minutes / 60)}h left`;
    return `${Math.round(pct)}% · ${minutes}m left`;
  }

  function comparePaperTradesByProgress(a, b) {
    const progress = paperTradeProgressPct(b) - paperTradeProgressPct(a);
    if (Math.abs(progress) > 0.001) return progress;
    const timeA = new Date(a.exitAt || a.targetExitAt || a.entryAt).getTime();
    const timeB = new Date(b.exitAt || b.targetExitAt || b.entryAt).getTime();
    return (Number.isFinite(timeA) ? timeA : 0) - (Number.isFinite(timeB) ? timeB : 0);
  }

  function windowShortLabel(key) {
    const value = String(key || '').toLowerCase();
    if (value === 'day') return '1D';
    if (value === 'week') return '1W';
    if (value === 'month') return '1M';
    return value.toUpperCase() || '-';
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
    const profileUrl = xProfileUrl(row.username);
    const profileLabel = `Open @${row.username} on X`;
    const reputation = row._reputation;
    article.innerHTML = `
      ${isTraceRow(row) ? '<div class="scan-beam"></div>' : ''}
      <div class="row-main">
        <span class="rank">${rank}</span>
        <section class="identity">
          <a class="avatar-link x-profile-link" href="${escapeAttr(profileUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(profileLabel)}">
            ${avatarHtml(row)}
          </a>
          <a class="identity-text x-profile-link" href="${escapeAttr(profileUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(profileLabel)}">
            <strong>${escapeHtml(row.displayName || `@${row.username}`)}</strong>
            <em>@${escapeHtml(row.username)} · ${formatFollowers(row.followersCount)}</em>
          </a>
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
        ${rankingCellHtml(row, reputation, status)}
      </div>
    `;
    article.querySelectorAll('.x-profile-link').forEach((link) => {
      link.addEventListener('click', (event) => event.stopPropagation());
    });
    article.querySelectorAll('[data-reputation-username]').forEach((reputationButton) => {
      reputationButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const windowKey = reputationButton.dataset.reputationWindow || state.reputationWindow;
        const selected = row._reputations?.[windowKey] || reputation;
        if (!selected) return;
        state.selectedReputation = selected;
        renderModal();
        void loadReputationDetail(selected);
      });
    });
    article.addEventListener('click', () => {
      const wasSelected = state.selectedUsername?.toLowerCase() === row.username.toLowerCase();
      state.selectedUsername = wasSelected ? null : row.username;
      renderList();
      if (!wasSelected) void loadPosts(row.username);
    });
    return article;
  }

  function rankingCellHtml(row, reputation, status) {
    const reps = row._reputations || {};
    if (REPUTATION_WINDOWS.some((item) => reps[item.key])) {
      return `
        <section class="ranking-stack" aria-label="Reputation by competition">
          ${REPUTATION_WINDOWS.map((item) => rankingChipHtml(row, reps[item.key], item)).join('')}
        </section>
      `;
    }
    return `
      <span class="ranking-stack single">
        <span class="ranking-cell unrated">
        <small>not rated</small>
        <strong>-</strong>
        <em>${escapeHtml(status)}</em>
        </span>
      </span>
    `;
  }

  function rankingChipHtml(row, reputation, windowItem) {
    const active = state.reputationWindow === windowItem.key;
    if (!reputation) {
      return `
        <span class="ranking-cell compact unrated ${active ? 'active' : ''}">
          <small>${escapeHtml(windowItem.label)}</small>
          <strong>-</strong>
          <em>not scored</em>
        </span>
      `;
    }
    const score = reputationScore(reputation);
    const avg = Number(reputation.averageScore);
    const title = `${windowItem.label}: rank #${reputation.rank ?? '-'}, score ${formatScore(score)}, average ${formatScore(avg)}, ${Number(reputation.scoredCount ?? 0)} scored`;
    return `
      <button type="button" class="ranking-cell compact ${scoreClass(score)} ${active ? 'active' : ''}" data-reputation-username="${escapeAttr(row.username)}" data-reputation-window="${escapeAttr(windowItem.key)}" title="${escapeAttr(title)}">
        <small>#${escapeHtml(reputation.rank ?? '-')} · ${escapeHtml(windowItem.label)}</small>
        <strong>${formatScore(score)}</strong>
        <em>avg ${formatScore(avg)} · ${Number(reputation.scoredCount ?? 0)}</em>
      </button>
    `;
  }

  function xProfileUrl(username) {
    const handle = String(username || '').trim().replace(/^@+/, '');
    return `https://x.com/${encodeURIComponent(handle)}`;
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

  async function loadReputationDetail(row) {
    const key = reputationDetailKey(row);
    const cached = state.reputationDetails.get(key);
    if (cached?.loading || cached?.detail) return;

    state.reputationDetails.set(key, { loading: true, error: null, detail: null });
    renderModal();
    try {
      const username = String(row.username || '').trim();
      const windowKey = row.window || state.reputationWindow;
      const detail = await getJson(`/api/crypto/reputation/${encodeURIComponent(username)}/detail?window=${encodeURIComponent(windowKey)}&take=250`);
      state.reputationDetails.set(key, { loading: false, error: null, detail });
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
  }

  function reputationDetailKey(row) {
    const username = String(row?.username || '').trim().toLowerCase();
    const windowKey = String(row?.window || state.reputationWindow || 'day').toLowerCase();
    return `${windowKey}:${username}`;
  }

  function goToPage(pageIndex) {
    const total = state.activeTab === 'live' ? liveRows().length : (state.page.total || 0);
    const pageSize = state.pageSize || state.page.pageSize || 250;
    const next = clampPageIndex(pageIndex, total, pageSize);
    if (next === state.pageIndex) return;
    state.pageIndex = next;
    state.selectedUsername = null;
    if (state.activeTab === 'live' && state.allInfluencers.length) {
      renderAll();
      els.list.scrollTop = 0;
      return;
    }
    void loadSnapshot({ resetListScroll: true });
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
    return fallback;
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
    const history = Array.isArray(row.history) ? row.history : [];
    const detailScored = Array.isArray(detail?.scored) ? detail.scored : [];
    const detailHistory = Array.isArray(detail?.ranking?.history) ? detail.ranking.history : [];
    const scored = detailScored.length ? detailScored : (detailHistory.length ? detailHistory : history);
    const ranking = detail?.ranking || row;
    const rankingScore = reputationScore(ranking);
    const tradeAverage = Number(ranking?.averageScore);
    const totalScored = reputationScoredCount(ranking) || scored.length;
    const shownScored = scored.length;
    const label = reputationWindowLabel(row.window || state.reputationWindow);
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal-card reputation-detail-card">
        <header>
          <div>
            <span class="eyebrow">Scored only</span>
            <h2>@${escapeHtml(row.username || '-')} · ${escapeHtml(label)}</h2>
          </div>
          <button type="button" class="menu-close">Close</button>
        </header>
        ${detailState?.loading ? '<p class="empty-inline">Loading full pipeline...</p>' : ''}
        ${detailState?.error ? `<p class="paper-error">${escapeHtml(detailState.error)}</p>` : ''}
        <section class="reputation-score-summary" aria-label="Reputation score summary">
          <span><b>${escapeHtml(formatScore(rankingScore))}</b><em>ranking score</em></span>
          <span><b>${escapeHtml(formatScore(tradeAverage))}</b><em>trade average</em></span>
          <span><b>${escapeHtml(String(totalScored))}</b><em>calls used</em></span>
          <span><b>${escapeHtml(String(shownScored))}</b><em>rows shown</em></span>
        </section>
        <p class="reputation-score-note">
          Ranking score and average use all scored calls in this window. The list below is only the latest detail returned by the API.
        </p>
        <section class="scored-only-panel">
          <header>
            <strong>Latest scored calls shown</strong>
            <em>${shownScored} / ${totalScored || shownScored}</em>
          </header>
          <div class="scored-only-list">
            ${scored.length ? scored.map(scoredOnlySignalHtml).join('') : '<p class="empty-inline">No scored call in this ranking.</p>'}
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
    const score = Number(signal.score);
    const reason = signalReasonText(signal);
    const scoreText = Number.isFinite(score) ? formatScore(score) : '-';
    const symbol = signal.symbol || '-';
    const variation = formatVariation(signal.variationPct);
    const direction = signal.direction || '-';
    const status = signalStatusText(signal);
    const verdict = signalOutcomeText(signal);
    const serial = signal.serialRef || `#${signal.id || '-'}`;
    const url = signalPostUrl(signal);
    const tag = url ? 'a' : 'article';
    const attrs = url ? ` href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="Open X post"` : '';
    return `
      <${tag} class="scored-only-row scored-call-link ${scoreClass(score)}"${attrs}>
        <span class="scored-call-crypto"><b>${escapeHtml(symbol)}</b><small>${escapeHtml(direction)} · ${escapeHtml(variation)}</small></span>
        <span class="scored-call-score"><b>${escapeHtml(scoreText)}</b><small>score</small></span>
        <span class="scored-call-status"><b>${escapeHtml(verdict)}</b><small>${escapeHtml(status)} · ${escapeHtml(serial)}</small></span>
        <small class="scored-call-reason">${escapeHtml(reason)}</small>
      </${tag}>
    `;
  }

  function signalOutcomeText(signal) {
    const direction = String(signal?.direction || '').toLowerCase();
    const variation = Number(signal?.variationPct);
    if (!Number.isFinite(variation) || (direction !== 'bullish' && direction !== 'bearish')) return 'scored call';
    const priceMove = variation > 0 ? 'price up' : variation < 0 ? 'price down' : 'flat';
    const good = direction === 'bullish' ? variation > 0 : variation < 0;
    if (variation === 0) return `${priceMove} · neutral`;
    return `${priceMove} · ${good ? 'good call' : 'bad call'}`;
  }

  function signalPostUrl(signal) {
    return signal.url || signal.postUrl || signal.sourceUrl || signal.Url || '';
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
    const score = Number(signal.score);
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
    const score = Number(coin.score ?? coin.bestScore);
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
      const avg = Number(coin.averageScore);
      const best = Number(coin.bestScore);
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
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number * 100)}%` : '-';
  }

  function compactText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  }

  function reputationScore(item) {
    const value = Number(item?.competitionScore);
    return Number.isFinite(value) ? value : Number(item?.averageScore);
  }

  function reputationScoredCount(item) {
    const value = Number(item?.scoredCount);
    return Number.isFinite(value) ? value : 0;
  }

  function windowAverageScore(windowKey) {
    const rows = reputationRowsForWindow(windowKey)
      .map((row) => Number(row.averageScore))
      .filter(Number.isFinite);
    if (!rows.length) return NaN;
    return rows.reduce((sum, score) => sum + score, 0) / rows.length;
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

  function formatSignedPct(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    const sign = number > 0 ? '+' : '';
    return `${sign}${number.toFixed(2)}%`;
  }

  function formatMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    const sign = number > 0 ? '+' : number < 0 ? '-' : '';
    return `${sign}$${Math.abs(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function moneyClass(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return 'neutral';
    return number > 0 ? 'good' : 'bad';
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
