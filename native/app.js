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
    timex: [],
    reputationWindow: 'day',
    reputation: {
      day: [],
      week: [],
      month: []
    },
    paper: null,
    paperSync: null,
    paperBusy: false,
    paperError: null,
    loadError: null
  };

  const els = {
    livePositionBar: byId('livePositionBar'),
    scannerTitle: byId('scannerTitle'),
    scannerMeta: byId('scannerMeta'),
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
      const [timex, repDay, repWeek, repMonth, paper] = await Promise.all([
        getJson('/api/crypto/timex?take=500').catch(() => []),
        getJson('/api/crypto/reputation?window=day&take=160').catch(() => []),
        getJson('/api/crypto/reputation?window=week&take=160').catch(() => []),
        getJson('/api/crypto/reputation?window=month&take=160').catch(() => []),
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
    const next = ['live', 'reputation', 'paper'].includes(tab) ? tab : 'live';
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
    const resources = `${availableCount(state.sessions)}/${state.sessions.length} sessions · ${availableCount(state.proxies)}/${state.proxies.length} proxies`;

    els.livePositionBar.className = `live-position-bar ${status}`;

    if (active) {
      const rowPos = rowPosition(active.username);
      els.scannerTitle.textContent = `now @${active.username}`;
      els.scannerMeta.textContent = `${rowPos} · ${done}/${Math.max(total, 1)} complete · ${running} running · ${queued} queued · ${failed} failed · ${resourceText(active)} · ${formatTime(active.startedAt || active.updatedAt)} · ${resources}`;
      return;
    }

    if (status === 'running') {
      const label = eventUser ? `last @${eventUser}` : `Run #${run?.id ?? '-'} active`;
      els.scannerTitle.textContent = label;
      els.scannerMeta.textContent = event
        ? `${done}/${Math.max(total, 1)} complete · ${running} running · ${queued} queued · ${failed} failed · ${event.text} · ${event.at} · ${resources}`
        : `${done}/${Math.max(total, 1)} complete · ${running} running · ${queued} queued · ${failed} failed · waiting for next account · ${resources}`;
      return;
    }

    els.scannerTitle.textContent = eventUser ? `last @${eventUser}` : 'idle';
    els.scannerMeta.textContent = event ? `${event.text} · ${event.at}` : 'no active scrape';
  }

  function renderPager() {
    els.pager.hidden = state.activeTab !== 'live';
    if (state.activeTab !== 'live') return;
    const total = state.page.total || 0;
    const pageSize = state.page.pageSize || state.pageSize;
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
    if (state.activeTab === 'reputation') {
      renderReputation();
      return;
    }
    if (state.activeTab === 'paper') {
      renderPaper();
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

  function renderPaper() {
    const paper = state.paper;
    if (!paper) {
      els.list.replaceChildren(emptyNode('No paper state', state.paperError || 'Paper trading summary is not loaded yet.'));
      return;
    }

    const run = paper.currentRun;
    const totals = paper.totals || {};
    const openTrades = paper.openTrades || [];
    const closedTrades = paper.closedTrades || [];
    const categories = paper.categories || [];
    const topRanks = paper.topRanks || [];
    const active = run?.status === 'active';
    const view = document.createElement('section');
    view.className = 'paper-view';
    view.innerHTML = `
      <article class="paper-hero">
        <header>
          <div>
            <span class="label">Paper trading</span>
            <strong>${run ? `Run #${escapeHtml(run.id)} · ${escapeHtml(run.status)}` : 'No active run'}</strong>
            <em>${run ? `${formatMinute(run.startedAt)} · ${formatMoney(run.stakeUsd)} per call · ${formatSignedPct(run.roundTripCostPct)} cost` : 'Top reputation calls are waiting for a run.'}</em>
          </div>
          <div class="paper-actions">
            <button type="button" data-paper-action="start" ${active || state.paperBusy ? 'disabled' : ''}>Start</button>
            <button type="button" data-paper-action="sync" ${!run || state.paperBusy ? 'disabled' : ''}>Sync</button>
            <button type="button" data-paper-action="stop" ${!active || state.paperBusy ? 'disabled' : ''}>Stop</button>
          </div>
        </header>
        ${state.paperError ? `<p class="paper-error">${escapeHtml(state.paperError)}</p>` : ''}
        <div class="paper-metrics">
          ${paperMetric('Net PnL', formatMoney(totals.netPnlUsd), moneyClass(totals.netPnlUsd))}
          ${paperMetric('Gross PnL', formatMoney(totals.grossPnlUsd), moneyClass(totals.grossPnlUsd))}
          ${paperMetric('Costs', formatMoney(-(Number(totals.costUsd) || 0)), 'bad')}
          ${paperMetric('Open', String(totals.openTrades ?? 0), '')}
          ${paperMetric('Closed', String(totals.closedTrades ?? 0), '')}
          ${paperMetric('Win rate', formatSignedPct(totals.winRatePct), scoreClass(totals.winRatePct))}
        </div>
      </article>
      <section class="paper-grid">
        ${paperPanel('Categories', categories.length ? categories.map(paperCategoryHtml).join('') : '<p class="empty-inline">No category trade yet.</p>', 'compact')}
        ${paperPanel('Open trades', openTrades.length ? openTrades.map((trade) => paperTradeHtml(trade, false)).join('') : '<p class="empty-inline">No open trade yet.</p>')}
        ${paperPanel('Closed trades', closedTrades.length ? closedTrades.map((trade) => paperTradeHtml(trade, true)).join('') : '<p class="empty-inline">No closed trade yet.</p>')}
        ${paperPanel('Top ranks followed', topRanks.length ? topRanks.map(paperRankHtml).join('') : '<p class="empty-inline">No rank snapshot.</p>', 'compact')}
      </section>
    `;
    els.list.replaceChildren(view);
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
          maxOpenPositions: 60
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

  function paperMetric(label, value, className) {
    return `
      <span>
        <small>${escapeHtml(label)}</small>
        <strong class="${escapeAttr(className || 'neutral')}">${escapeHtml(value)}</strong>
      </span>
    `;
  }

  function paperPanel(title, content, modifier = '') {
    return `
      <article class="paper-panel ${escapeAttr(modifier)}">
        <h2>${escapeHtml(title)}</h2>
        <div class="paper-table">${content}</div>
      </article>
    `;
  }

  function paperCategoryHtml(category) {
    const net = Number(category.netPnlUsd ?? 0);
    return `
      <div class="paper-table-row">
        <strong>${escapeHtml(windowShortLabel(category.window))}</strong>
        <span>${Number(category.openTrades ?? 0)} open · ${Number(category.closedTrades ?? 0)} closed</span>
        <em class="${moneyClass(net)}">${formatMoney(net)}</em>
      </div>
    `;
  }

  function paperTradeHtml(trade, closed) {
    const pnl = Number(trade.netPnlUsd ?? 0);
    const returnPct = trade.netReturnPct ?? trade.grossReturnPct;
    return `
      <div class="paper-trade-row">
        <strong>@${escapeHtml(trade.username || '-')} · ${escapeHtml(trade.symbol || '-')}</strong>
        <span>${escapeHtml(windowShortLabel(trade.categoryWindow))} · #${escapeHtml(trade.rankPosition ?? '-')} · ${escapeHtml(trade.direction || '-')}</span>
        <span>${formatMoney(trade.stakeUsd)} @ ${formatPrice(trade.entryPriceUsd)}</span>
        <em>${closed ? formatMinute(trade.exitAt) : `target ${formatMinute(trade.targetExitAt)}`}</em>
        <b class="${moneyClass(pnl)}">${closed ? `${formatMoney(pnl)} · ${formatSignedPct(returnPct)}` : 'open'}</b>
      </div>
    `;
  }

  function paperRankHtml(rank) {
    return `
      <div class="paper-table-row">
        <strong>${escapeHtml(windowShortLabel(rank.window))} #${escapeHtml(rank.rank)}</strong>
        <span>@${escapeHtml(rank.username || '-')}</span>
        <em>${formatScore(rank.competitionScore)}</em>
      </div>
    `;
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
