(() => {
  'use strict';

  const API_BASE = resolveApiBaseUrl();
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
    selectedPosts: new Map(),
    run: null,
    page: { pageIndex: 0, pageSize: 250, total: 0, items: [] },
    sessions: [],
    proxies: [],
    jobs: [],
    events: [],
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
    list: byId('list')
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
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

    connectLiveEvents();
    startClock();
    void loadSnapshot({ resetListScroll: false });
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
    const response = await fetch(apiUrl(`${path}${sep}_=${Date.now()}`), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function postJson(path, body) {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
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
      state.loadError = error instanceof Error ? error.message : 'Unable to load live data';
      renderAll();
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
    renderPager();
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
