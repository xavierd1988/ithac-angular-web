(() => {
  'use strict';

  const panel = document.getElementById('actionPanel');
  if (!panel) return;

  const balance = document.getElementById('actionBalance');
  const status = document.getElementById('actionStatus');
  const notice = document.getElementById('actionSignalNotice');
  const influencer = document.getElementById('actionInfluencer');
  const suggestions = document.getElementById('actionSuggestions');
  const callCard = document.getElementById('actionCall');
  const callSource = document.getElementById('actionCallSource');
  const callTitle = document.getElementById('actionCallTitle');
  const callMeta = document.getElementById('actionCallMeta');
  const post = document.getElementById('actionPost');
  const demo = document.getElementById('actionDemo');
  const tradeButton = document.getElementById('actionPositionButton');
  const position = document.getElementById('actionPosition');
  const entry = document.getElementById('actionEntry');
  const mark = document.getElementById('actionMark');
  const pnl = document.getElementById('actionPnl');
  const reset = document.getElementById('actionReset');
  const storageKey = 'ithac-action-demo-v1';
  const stake = 100;
  const startingChips = 1000;
  const entryIndex = 100;
  const pollMs = 60_000;
  const maxCallAgeMs = 48 * 60 * 60 * 1000;
  const chips = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  const index = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = new Intl.NumberFormat('en', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
  const callTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const initialState = () => ({
    balance: startingChips, follow: null, call: null, open: null, result: null, seen: []
  });
  let state = restore();
  let accounts = [];
  let loadCalls;
  let requestedFollow;
  let watchingError = false;
  let choosing = false;
  let message = '';

  function isCall(call) {
    return ['demo', 'live'].includes(call?.source) && ['long', 'short'].includes(call.side) &&
      typeof call.symbol === 'string' && typeof call.id === 'string' &&
      (call.source === 'demo' || (Number.isFinite(call.postedAt) && typeof call.author === 'string'));
  }

  function restore() {
    const fresh = initialState();
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey));
      if (!Number.isFinite(saved?.balance) || saved.balance < 0) return fresh;
      fresh.balance = saved.balance;
      if (normalizeAccount(saved.follow) && Number.isFinite(saved.follow.since)) fresh.follow = saved.follow;
      if (isCall(saved.call)) fresh.call = saved.call;
      if (isCall(saved.open?.call) && Number.isFinite(saved.open.openedAt) &&
          Number.isFinite(saved.open.phase)) fresh.open = saved.open;
      if (Number.isFinite(saved.result?.mark) && Number.isFinite(saved.result?.pnl)) fresh.result = saved.result;
      if (Array.isArray(saved.seen)) fresh.seen = saved.seen.filter((id) => typeof id === 'string').slice(-64);
    } catch {
      // The demo also runs when session storage is blocked.
    }
    return fresh;
  }

  function save() {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // The current page still keeps its test chips and selection.
    }
  }

  function normalizeAccount(account) {
    const username = String(account?.username || '').trim().replace(/^@/, '');
    if (!/^[\w]{1,30}$/.test(username)) return null;
    const displayName = String(account.displayName || '').trim() || username;
    return { username, displayName };
  }

  function plain(value) {
    return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }

  function openSuggestions() {
    choosing = true;
    renderSuggestions();
  }

  function closeSuggestions() {
    choosing = false;
    suggestions.hidden = true;
  }

  function renderSuggestions() {
    if (!choosing) return;
    const query = plain(influencer.value.trim().replace(/^@/, ''));
    const matches = accounts
      .filter(({ searchName, searchUsername }) => searchName.includes(query) || searchUsername.includes(query))
      .sort((a, b) => Number(b.searchName.startsWith(query)) - Number(a.searchName.startsWith(query)))
      .slice(0, 6);
    const list = document.createDocumentFragment();
    for (const account of matches) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = account.displayName;
      button.addEventListener('click', () => followAccount(account));
      item.append(button);
      list.append(item);
    }
    if (query && accounts.length && !matches.length) {
      const item = document.createElement('li');
      item.textContent = 'No matching influencer';
      list.append(item);
    }
    suggestions.replaceChildren(list);
    suggestions.hidden = !suggestions.children.length;
  }

  function followAccount(account) {
    const selected = normalizeAccount(account);
    if (!selected) return;
    influencer.value = selected.displayName;
    influencer.focus();
    closeSuggestions();
    if (state.follow?.username.toLowerCase() === selected.username.toLowerCase()) return;
    state.follow = { ...selected, since: Date.now() };
    state.seen = [];
    if (state.call?.source === 'live') state.call = null;
    watchingError = false;
    message = '';
    save();
    render();
    void poll();
  }

  function sourceUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password &&
          ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return url.href;
    } catch {
      // Missing or invalid source links do not stop the simulation.
    }
    return '';
  }

  function extractCall(signal, follow, now) {
    const direction = signal?.direction;
    if (direction !== 'bullish' && direction !== 'bearish') return null;
    const side = direction === 'bullish' ? 'long' : 'short';
    const symbol = String(signal?.symbol || '').trim().toUpperCase();
    const postedAt = Date.parse(signal?.mentionedAt);
    const detectedAt = Date.parse(signal?.detectedAt);
    const id = signal?.postId && signal.coinId ? `${signal.postId}:${signal.coinId}` : signal?.signalId;
    if (!id || !signal.coinId || !/^[A-Z0-9._-]{1,18}$/.test(symbol) ||
        !Number.isFinite(postedAt) || !Number.isFinite(detectedAt) || postedAt < follow.since ||
        detectedAt < follow.since || postedAt < now - maxCallAgeMs) return null;
    return {
      id: String(id), symbol, side, postedAt, detectedAt, source: 'live', author: follow.displayName,
      url: sourceUrl(signal.postUrl || signal.url || signal.sourceUrl)
    };
  }

  async function poll() {
    const follow = state.follow;
    if (!follow || !loadCalls || document.hidden || requestedFollow === follow) return;
    requestedFollow = follow;
    try {
      const data = await loadCalls(follow.username);
      if (state.follow !== follow) return;
      if (!Array.isArray(data?.waiting) || !Array.isArray(data.scored)) throw new Error('Invalid action feed');
      watchingError = false;
      const now = Date.now();
      const seen = new Set(state.seen);
      const newCalls = [];
      for (const signal of [...data.waiting, ...data.scored]) {
        const call = extractCall(signal, follow, now);
        if (!call || seen.has(call.id)) continue;
        seen.add(call.id);
        newCalls.push(call);
      }
      if (newCalls.length) {
        newCalls.sort((a, b) => b.detectedAt - a.detectedAt || b.postedAt - a.postedAt);
        state.call = newCalls[0];
        state.seen = [...seen].slice(-64);
        message = '';
        save();
      }
    } catch {
      if (state.follow === follow) watchingError = true;
    } finally {
      if (requestedFollow === follow) requestedFollow = null;
      if (state.follow === follow) render();
    }
  }

  const round = (value) => Math.round(value * 100) / 100;
  const direction = (call) => call.side === 'long' ? 'Long' : 'Short';

  function simulatedMark(trade) {
    const elapsed = Math.max(0, (Date.now() - trade.openedAt) / 1000);
    const firstWave = 2.9 * (Math.sin(trade.phase + elapsed / 11) - Math.sin(trade.phase));
    const secondWave = 1.35 * (Math.sin(trade.phase * 2 + elapsed / 4) - Math.sin(trade.phase * 2));
    return round(entryIndex + firstWave + secondWave);
  }

  function returns(trade) {
    const price = simulatedMark(trade);
    const sign = trade.call.side === 'long' ? 1 : -1;
    const result = round(stake * sign * (price / entryIndex - 1));
    return { mark: price, pnl: Math.max(-stake, result === 0 ? 0 : result) };
  }

  function statusText() {
    if (state.open && state.call?.source === 'live') return `New ${state.call.symbol} call queued.`;
    if (message) return message;
    if (state.open) return 'Position open. The index is simulated.';
    if (state.call?.source === 'live') return `New call from ${state.call.author}.`;
    if (state.call) return 'Test call ready.';
    if (watchingError) return 'Live calls unavailable. The test still works.';
    if (state.follow) return `Watching ${state.follow.displayName} for a new call.`;
    return 'Choose an influencer or try a test call.';
  }

  function render() {
    const trade = state.open;
    const call = trade?.call ?? state.call;
    const result = trade ? returns(trade) : state.result;
    const statusTextNow = statusText();
    if (status.textContent !== statusTextNow) status.textContent = statusTextNow;
    const noticeText = state.call?.source === 'live' ? 'New call' : state.call ? 'Test call' : '';
    if (notice && notice.textContent !== noticeText) notice.textContent = noticeText;
    balance.textContent = chips.format(state.balance);
    panel.dataset.robotState = trade ? 'position' : call ? 'signal' : result ? 'closed' : 'watching';
    callCard.hidden = !call;
    tradeButton.hidden = !call;
    tradeButton.disabled = !trade && state.balance < stake;
    demo.hidden = Boolean(call);
    reset.hidden = Boolean(trade) || state.balance >= stake;

    if (call) {
      callSource.textContent = call.source === 'demo' ? 'Test call' : 'Influencer call';
      callTitle.textContent = `${direction(call)} ${call.symbol}`;
      callMeta.textContent = call.source === 'demo'
        ? 'Sample signal · 100 chips'
        : `${call.author} · ${callTime.format(call.postedAt)} · 100 chips`;
      const url = sourceUrl(call.url);
      post.hidden = !url;
      if (url) post.href = url;
      else post.removeAttribute('href');
      tradeButton.textContent = trade ? 'Close position' : `Open ${direction(call).toLowerCase()}`;
    }

    position.hidden = !result;
    position.dataset.state = trade ? 'open' : 'closed';
    if (result) {
      entry.textContent = index.format(entryIndex);
      mark.textContent = index.format(result.mark);
      pnl.textContent = `${signed.format(result.pnl)} chips`;
      pnl.dataset.tone = result.pnl > 0 ? 'gain' : result.pnl < 0 ? 'loss' : 'even';
    }
  }

  demo.addEventListener('click', () => {
    if (state.open || state.call) return;
    state.call = { id: 'demo', source: 'demo', side: 'long', symbol: 'BTC', url: '' };
    message = '';
    save();
    render();
  });

  tradeButton.addEventListener('click', () => {
    if (state.open) {
      state.result = returns(state.open);
      state.balance = round(state.balance + stake + state.result.pnl);
      state.open = null;
      message = `Position closed. ${signed.format(state.result.pnl)} chips.`;
    } else {
      if (!state.call || state.balance < stake) return;
      state.open = { call: state.call, openedAt: Date.now(), phase: Math.random() * 2 * Math.PI };
      state.balance = round(state.balance - stake);
      state.call = null;
      state.result = null;
      message = '';
    }
    save();
    render();
  });

  reset.addEventListener('click', () => {
    if (state.open || state.balance >= stake) return;
    state.balance = startingChips;
    state.result = null;
    message = 'Test chips reset.';
    save();
    render();
  });

  window.addEventListener('ithac:action-source', (event) => {
    if (typeof event.detail?.loadCalls !== 'function') return;
    loadCalls = event.detail.loadCalls;
    void poll();
  });
  window.addEventListener('ithac:action-accounts', (event) => {
    if (!Array.isArray(event.detail)) return;
    accounts = event.detail.map(normalizeAccount).filter(Boolean).map((account) => ({
      ...account,
      searchName: plain(account.displayName),
      searchUsername: plain(account.username)
    }));
    renderSuggestions();
  });

  influencer.addEventListener('input', openSuggestions);
  influencer.addEventListener('focus', openSuggestions);
  influencer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSuggestions();
    if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
    if (!choosing && event.key === 'ArrowDown') openSuggestions();
    const first = !suggestions.hidden && suggestions.querySelector('button');
    if (!first) return;
    event.preventDefault();
    if (event.key === 'Enter') first.click();
    else first.focus();
  });
  suggestions.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      influencer.focus();
      closeSuggestions();
    }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const sibling = event.key === 'ArrowDown'
      ? event.target.closest('li')?.nextElementSibling : event.target.closest('li')?.previousElementSibling;
    if (sibling) sibling.querySelector('button')?.focus();
    else if (event.key === 'ArrowUp') influencer.focus();
  });
  function outsidePicker(event) {
    if (event.target !== influencer && !suggestions.contains(event.target)) closeSuggestions();
  }
  document.addEventListener('focusin', outsidePicker);
  document.addEventListener('pointerdown', outsidePicker);

  panel.open = window.matchMedia('(min-width: 961px)').matches;
  if (state.follow) influencer.value = state.follow.displayName;
  panel.addEventListener('toggle', () => {
    if (panel.open) {
      render();
      void poll();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      render();
      void poll();
    }
  });
  window.setInterval(poll, pollMs);
  window.setInterval(() => {
    if (state.open && panel.open && !document.hidden) render();
  }, 2000);
  render();
})();
