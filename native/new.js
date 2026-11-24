// New ITHAC home page: the ranking of the most active followed accounts, read from the new base on the server.
// The chosen window (24 hours, 7 days, 1 month) orders the list by number of tweets, then by last tweet,
// and filters the tweets shown under an opened account.
(() => {
  'use strict';

  const SOURCE = new URLSearchParams(location.search).get('src') || 'https://api.ithacapp.com/new/accounts.json';
  const BASE = SOURCE.replace(/[^/]*$/, '');
  const state = { accounts: [], query: '', page: 1, size: 100, open: null, window: 'day' };
  const WINDOW_MS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
  const WINDOW_WORDS = { day: 'in the last 24 hours', week: 'in the last 7 days', month: 'in the last month' };
  const tweetCache = new Map();

  const list = document.getElementById('list');
  const stats = document.getElementById('rankingStats');
  const pager = document.getElementById('pager');
  const numbers = document.getElementById('pageNumbers');
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  const sizeSelect = document.getElementById('pageSize');
  const search = document.getElementById('rankingSearch');

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const count = (value) => Number(value || 0).toLocaleString('en-US');

  function visible() {
    const q = state.query.trim().toLowerCase().replace(/^@/, '');
    if (!q) return state.accounts;
    return state.accounts.filter((a) => a.username.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }

  // Last tweet and number of tweets come from the new collection; until it fills the new base they show "–".
  // The number of tweets follows the chosen window: 24 hours, 7 days or 1 month.
  function ago(t) {
    if (!Number.isFinite(t)) return '–';
    const minutes = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
    return `${Math.round(minutes / 1440)} d ago`;
  }
  const lastTweet = (a) => ago(Date.parse(a.lastTweetAt || ''));
  function fullDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function tweetCount(a) {
    const n = a.tweets?.[state.window];
    return Number.isFinite(n) ? count(n) : '–';
  }

  // The ranking: most tweets in the chosen window first, then the most recent last tweet, then followers.
  // Accounts not read yet go last.
  function rankAccounts() {
    const n = (a) => (Number.isFinite(a.tweets?.[state.window]) ? a.tweets[state.window] : -1);
    const t = (a) => Date.parse(a.lastTweetAt || '') || 0;
    state.accounts.sort((a, b) => n(b) - n(a) || t(b) - t(a) || (b.followers || 0) - (a.followers || 0));
    state.accounts.forEach((a, i) => { a.rank = i + 1; });
  }

  // Tweets of one account: one small file per account, loaded when its row is opened.
  function loadTweets(username) {
    const key = username.toLowerCase();
    if (!tweetCache.has(key)) {
      tweetCache.set(key, fetch(`${BASE}tweets/${encodeURIComponent(key)}.json`)
        .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
        .then((data) => data.tweets || [])
        .catch((error) => { tweetCache.delete(key); throw error; }));
    }
    return tweetCache.get(key);
  }

  function tweetItem(t, username) {
    let text = String(t.text || '');
    if (t.kind === 'retweet') text = text.replace(/^RT @\w+:\s*/, '');
    text = text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\s*\n+\s*/g, ' ').trim() || 'Image or link only';
    const kind = t.kind === 'retweet' ? `Retweet of @${t.of || '?'}` : t.kind === 'quote' ? `Quote of @${t.of || '?'}` : '';
    const url = t.url || `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(t.id)}`;
    return `<li><a class="new-tweet" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
        <span class="new-tweet-meta"><time datetime="${esc(t.at)}" title="${esc(fullDate(t.at))}">${esc(ago(Date.parse(t.at)))}</time>${kind ? `<span class="new-tweet-kind">${esc(kind)}</span>` : ''}</span>
        <span class="new-tweet-text">${esc(text)}</span>
      </a></li>`;
  }

  function fillTweets(entry) {
    const box = entry.querySelector('.new-tweets');
    if (!box) return;
    const username = entry.dataset.username;
    const win = state.window;
    const account = state.accounts.find((a) => a.username === username);
    box.innerHTML = '<p class="new-tweets-note">Loading tweets…</p>';
    loadTweets(username).then((tweets) => {
      if (!entry.isConnected || state.window !== win) return;
      const cutoff = Date.now() - WINDOW_MS[win];
      const inWindow = tweets.filter((t) => Date.parse(t.at) >= cutoff);
      if (!inWindow.length) {
        box.innerHTML = `<p class="new-tweets-note">No tweet ${WINDOW_WORDS[win]}.</p>`;
        return;
      }
      const capped = (account?.tweets?.[win] || 0) > inWindow.length
        ? `<p class="new-tweets-note">The latest ${inWindow.length} are shown here.</p>` : '';
      box.innerHTML = `<ol class="new-tweet-list">${inWindow.slice(0, 10).map((t) => tweetItem(t, username)).join('')}</ol>`
        + (inWindow.length > 10 ? `<button class="new-more" type="button">Show ${inWindow.length - 10} more</button>` : capped);
      box.querySelector('.new-more')?.addEventListener('click', (event) => {
        event.currentTarget.insertAdjacentHTML('afterend', capped);
        event.currentTarget.remove();
        box.querySelector('.new-tweet-list').insertAdjacentHTML('beforeend', inWindow.slice(10).map((t) => tweetItem(t, username)).join(''));
      });
    }).catch(() => {
      if (entry.isConnected) box.innerHTML = '<p class="new-tweets-note">The tweets could not be loaded. Try again in a moment.</p>';
    });
  }

  function avatar(a) {
    if (!a.avatar) return `<span class="avatar avatar-fallback" aria-hidden="true">${esc(a.username.slice(0, 1).toUpperCase())}</span>`;
    return `<img class="avatar" src="${esc(a.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }

  function row(a) {
    const open = state.open === a.username;
    return `
      <details class="leaderboard-entry" data-username="${esc(a.username)}"${open ? ' open' : ''}>
        <summary class="leaderboard-summary">
          <span class="leaderboard-rank"><span class="visually-hidden">Rank </span>${a.rank}</span>
          <span class="leaderboard-account">
            ${avatar(a)}
            <span class="leaderboard-name">
              <strong>${esc(a.name)}</strong>
              <small class="grading-badge">@${esc(a.username)}</small>
            </span>
          </span>
          <span class="leaderboard-last new-followers"><span class="last-label">Followers</span><b>${count(a.followers)}</b></span>
          <span class="leaderboard-score new-last"${a.lastTweetAt ? ` title="${esc(fullDate(a.lastTweetAt))}"` : ''}><span class="visually-hidden">Last tweet </span>${esc(lastTweet(a))}</span>
          <span class="leaderboard-calls new-count"><span class="visually-hidden">Number of tweets </span>${esc(tweetCount(a))}</span>
          <span class="leaderboard-chevron" aria-hidden="true"></span>
        </summary>
        <div class="new-detail">
          <div class="new-tweets"></div>
          <a class="new-profile" href="https://x.com/${encodeURIComponent(a.username)}" target="_blank" rel="noopener noreferrer">Open @${esc(a.username)} on X</a>
        </div>
      </details>`;
  }

  // Page numbers: the first, the last and the two around the current one, with gaps shown as "…".
  function pageList(current, total) {
    const keep = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
    const pages = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const out = [];
    pages.forEach((p, i) => { if (i && p - pages[i - 1] > 1) out.push('…'); out.push(p); });
    return out;
  }

  function render() {
    const rows = visible();
    const total = Math.max(1, Math.ceil(rows.length / state.size));
    state.page = Math.min(Math.max(1, state.page), total);
    const start = (state.page - 1) * state.size;
    const pageRows = rows.slice(start, start + state.size);
    if (!rows.length) {
      list.innerHTML = `<p class="empty">${state.accounts.length ? 'No account matches this search.' : 'No account yet.'}</p>`;
    } else {
      list.innerHTML = pageRows.map(row).join('');
      for (const img of list.querySelectorAll('img.avatar')) {
        img.addEventListener('error', () => {
          const entry = img.closest('[data-username]');
          const fallback = document.createElement('span');
          fallback.className = 'avatar avatar-fallback';
          fallback.setAttribute('aria-hidden', 'true');
          fallback.textContent = (entry?.dataset.username || '?').slice(0, 1).toUpperCase();
          img.replaceWith(fallback);
        }, { once: true });
      }
    }
    pager.hidden = rows.length <= 25;
    prev.disabled = state.page <= 1;
    next.disabled = state.page >= total;
    numbers.innerHTML = pageList(state.page, total).map((p) => p === '…'
      ? '<span class="page-gap" aria-hidden="true">…</span>'
      : `<button type="button" data-page="${p}"${p === state.page ? ' class="active" aria-current="page"' : ''}>${p}</button>`).join('');
    stats.textContent = rows.length
      ? `Accounts ${count(start + 1)}–${count(start + pageRows.length)} of ${count(rows.length)}${state.query.trim() ? ` matching “${state.query.trim()}”` : ''}`
      : '';
    const opened = list.querySelector('details.leaderboard-entry[open]');
    if (opened) fillTweets(opened);
  }

  function goTo(page) {
    state.page = page;
    render();
    list.closest('.list-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  list.addEventListener('toggle', (event) => {
    const entry = event.target;
    if (!entry.matches?.('details.leaderboard-entry')) return;
    if (entry.open) {
      state.open = entry.dataset.username;
      for (const other of list.querySelectorAll('details.leaderboard-entry[open]')) if (other !== entry) other.open = false;
      fillTweets(entry);
    } else if (state.open === entry.dataset.username) {
      state.open = null;
    }
  }, true);

  prev.addEventListener('click', () => goTo(state.page - 1));
  next.addEventListener('click', () => goTo(state.page + 1));
  numbers.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (button) goTo(Number(button.dataset.page));
  });
  sizeSelect.addEventListener('change', () => { state.size = Number(sizeSelect.value) || 100; state.page = 1; render(); });
  search.addEventListener('input', () => { state.query = search.value; state.page = 1; render(); });

  // The chosen window ranks the accounts and filters the tweets under the opened account; an opened account
  // stays open, on the page where its new rank puts it. A glossy pill slides under the chosen window.
  const group = document.querySelector('.page-intro .ranking-period');
  const glider = group?.querySelector('.period-glider');
  function placeGlider() {
    const active = group?.querySelector('.period-button.active');
    if (!glider || !active) return;
    glider.style.width = `${active.offsetWidth}px`;
    glider.style.transform = `translateX(${active.offsetLeft}px)`;
    group.classList.add('has-glider');
  }
  for (const button of document.querySelectorAll('[data-window]')) {
    button.addEventListener('click', () => {
      for (const b of document.querySelectorAll('[data-window]')) {
        const active = b === button;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      }
      state.window = button.dataset.window;
      placeGlider();
      if (!state.accounts.length) return;
      rankAccounts();
      const at = state.open ? visible().findIndex((a) => a.username === state.open) : -1;
      state.page = at >= 0 ? Math.floor(at / state.size) + 1 : 1;
      render();
    });
  }
  placeGlider();
  requestAnimationFrame(() => glider?.classList.add('ready'));
  document.fonts?.ready.then(placeGlider);
  window.addEventListener('resize', placeGlider);

  fetch(SOURCE, { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then((data) => {
      state.accounts = (data.accounts || []).map((a) => ({ ...a, name: a.name || a.username }));
      rankAccounts();
      render();
    })
    .catch(() => {
      list.innerHTML = '<p class="empty">The list of accounts could not be loaded. Try again in a moment.</p>';
    });
})();
