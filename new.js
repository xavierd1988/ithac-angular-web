// New ITHAC home page: the ranking of the followed accounts, read from the new base on the server.
// The name and the photo of an account open it on X; the rest of its row opens its calls, with its tweets folded
// in a list under them. The chosen window (24 hours, 7 days, 1 month) sets the scores and filters the calls and tweets.
(() => {
  'use strict';

  const SOURCE = new URLSearchParams(location.search).get('src') || 'https://api.ithacapp.com/new/accounts.json';
  const BASE = SOURCE.replace(/[^/]*$/, '');
  const state = { accounts: [], query: '', page: 1, size: 100, open: null, pendingOpen: false, tweetsOpen: false, window: 'day', cat: 'independent', sort: { key: 'score', dir: 'desc' }, wsAt: null, hasPrevious: false };
  const WINDOW_MS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
  const WINDOW_WORDS = { day: 'in the last 24 hours', week: 'in the last 7 days', month: 'in the last month' };
  const tweetCache = new Map();
  // Account types from the server's classification, shown as a coloured dot; news outlets count as institutions.
  const GROUP = { independent: 'independent', promoter: 'promoter', institution: 'institution', news: 'institution', bot: 'bot', offtopic: 'offtopic', inactive: 'inactive' };
  const LABEL = { independent: 'Independent', promoter: 'Promoter', institution: 'Institution', bot: 'Bot', offtopic: 'Off topic', inactive: 'Inactive' };
  const typeOf = (a) => GROUP[a.category] || null;
  // Wolf Simple: each account's result after its calls, per window, read from wolf_simple.json; its calls from calls/<account>.json.
  const callCache = new Map();
  // A call's result is in points: what its coin did against the market, counted the other way for a bearish call, at
  // most 50. A percentage is only ever a real price move, said in words ("down 53.3%") rather than with a minus sign.
  const pts = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
  const moved = (v) => (Math.abs(v) < 0.05 ? 'flat' : `${v > 0 ? 'up' : 'down'} ${Math.abs(v).toFixed(1)}%`);
  const when = (ts) => new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const wsOf = (a) => a.ws?.[state.window] || null;

  const list = document.getElementById('list');
  const stats = document.getElementById('rankingStats');
  const pager = document.getElementById('pager');
  const numbers = document.getElementById('pageNumbers');
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  const sizeSelect = document.getElementById('pageSize');
  const search = document.getElementById('rankingSearch');
  const legend = document.getElementById('catLegend');
  const head = document.getElementById('listHead');
  const SORT_WORDS = {
    followers: { desc: 'most followers first', asc: 'fewest followers first' },
    last: { desc: 'most recent tweet first', asc: 'oldest tweet first' },
    tweets: { desc: 'most tweets first', asc: 'fewest tweets first' },
    score: { desc: 'best result after the calls first', asc: 'worst result after the calls first' },
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const count = (value) => Number(value || 0).toLocaleString('en-US');

  // A chosen account type keeps only those accounts and numbers them from 1; a search then narrows them further.
  function visible() {
    const base = state.cat ? state.accounts.filter((a) => typeOf(a) === state.cat) : state.accounts;
    base.forEach((a, i) => { a.shownRank = i + 1; });
    const q = state.query.trim().toLowerCase().replace(/^@/, '');
    if (!q) return base;
    return base.filter((a) => a.username.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
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

  // The ranking. By default: most tweets in the chosen window first. A column header sorts by followers,
  // last tweet or number of tweets; a second click on it reverses the order. Ties: more tweets, then the
  // more recent last tweet, then more followers. Accounts without the value (not read yet) always go last.
  function sortValue(a, key) {
    if (key === 'score') { const s = wsOf(a); return s && s.ranked ? s.score : null; }
    if (key === 'followers') return Number.isFinite(a.followers) ? a.followers : null;
    if (key === 'last') { const t = Date.parse(a.lastTweetAt || ''); return Number.isFinite(t) ? t : null; }
    const n = a.tweets?.[state.window];
    return Number.isFinite(n) ? n : null;
  }
  function rankAccounts() {
    const { key, dir } = state.sort;
    const sign = dir === 'asc' ? 1 : -1;
    const ties = (a, b) => (sortValue(b, 'tweets') ?? -1) - (sortValue(a, 'tweets') ?? -1)
      || (sortValue(b, 'last') ?? 0) - (sortValue(a, 'last') ?? 0) || (b.followers || 0) - (a.followers || 0);
    state.accounts.sort((a, b) => {
      const x = sortValue(a, key);
      const y = sortValue(b, key);
      if (x === null || y === null) return x === y ? ties(a, b) : x === null ? 1 : -1;
      return (x - y) * sign || ties(a, b);
    });
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

  // The tweets are folded under the calls: they load only when their button unfolds them. Retweets are left out,
  // as in the number of tweets: only the account's own posts and quotes.
  function fillTweets(entry) {
    const box = entry.querySelector('.new-tweets');
    if (!box || box.hidden) return;
    const username = entry.dataset.username;
    const win = state.window;
    const account = state.accounts.find((a) => a.username === username);
    const all = `<a class="new-all" href="https://x.com/${encodeURIComponent(username)}" target="_blank" rel="noopener noreferrer">All tweets on X</a>`;
    box.innerHTML = '<p class="new-tweets-note">Loading tweets…</p>';
    loadTweets(username).then((tweets) => {
      if (!entry.isConnected || state.window !== win) return;
      const cutoff = Date.now() - WINDOW_MS[win];
      const inWindow = tweets.filter((t) => t.kind !== 'retweet' && Date.parse(t.at) >= cutoff);
      if (!inWindow.length) {
        box.innerHTML = `<p class="new-tweets-note">No tweet ${WINDOW_WORDS[win]}.</p>${all}`;
        return;
      }
      const capped = (account?.tweets?.[win] || 0) > inWindow.length
        ? `<p class="new-tweets-note">The latest ${inWindow.length} are shown here.</p>` : '';
      box.innerHTML = `<ol class="new-tweet-list">${inWindow.slice(0, 10).map((t) => tweetItem(t, username)).join('')}</ol>`
        + (inWindow.length > 10 ? `<button class="new-more" type="button">Show ${inWindow.length - 10} more</button>` : capped) + all;
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
    const g = typeOf(a);
    const dot = g ? `<span class="cat-dot cat-${g}" title="${LABEL[g]}"><span class="visually-hidden">${LABEL[g]}: </span></span>` : '';
    return `
      <details class="leaderboard-entry" data-username="${esc(a.username)}"${open ? ' open' : ''}>
        <summary class="leaderboard-summary">
          <span class="leaderboard-rank"><span class="visually-hidden">Rank </span>${a.shownRank}${moveBadge(a)}</span>
          <span class="leaderboard-account">
            <a class="account-link" href="https://x.com/${encodeURIComponent(a.username)}" target="_blank" rel="noopener noreferrer" title="Open on X">
              ${avatar(a)}
              <span class="leaderboard-name">
                <strong>${dot}${esc(a.name)}</strong>
              </span>
            </a>
          </span>
          <span class="leaderboard-last new-followers"><span class="last-label">Followers</span><b>${count(a.followers)}</b></span>
          <span class="leaderboard-score new-last"${a.lastTweetAt ? ` title="${esc(fullDate(a.lastTweetAt))}"` : ''}><span class="visually-hidden">Last tweet </span>${esc(lastTweet(a))}</span>
          <span class="leaderboard-calls new-count"><span class="visually-hidden">Number of tweets </span>${esc(tweetCount(a))}</span>
          ${scoreCell(a)}
          <span class="leaderboard-chevron" aria-hidden="true"></span>
        </summary>
        <div class="new-detail">
          <div class="new-calls"></div>
          ${actions(a, open)}
        </div>
      </details>`;
  }

  // Under the calls, two buttons, each unfolding its list below them: the new calls still in process (their result
  // for the chosen window is not known yet) and the tweets of the chosen window. Both start folded.
  function actions(a, open) {
    const n = a.tweets?.[state.window];
    const pendingOpen = open && state.pendingOpen;
    const tweetsOpen = open && state.tweetsOpen && n !== 0;
    const pending = a.ws
      ? `<button class="new-toggle" type="button" data-show="pending" aria-expanded="${pendingOpen}" aria-controls="pending-${esc(a.username)}">New in process <span class="new-toggle-n"></span></button>`
      : '';
    return `<div class="new-actions">
            ${pending}
            <button class="new-toggle" type="button" data-show="tweets" aria-expanded="${tweetsOpen}" aria-controls="tweets-${esc(a.username)}"${n === 0 ? ' disabled' : ''}>Tweets${Number.isFinite(n) ? ` <span class="new-toggle-n">${count(n)}</span>` : ''}</button>
          </div>
          ${a.ws ? `<div class="new-pending" id="pending-${esc(a.username)}"${pendingOpen ? '' : ' hidden'}></div>` : ''}
          <div class="new-tweets" id="tweets-${esc(a.username)}"${tweetsOpen ? '' : ' hidden'}></div>`;
  }

  // A button of an opened account shows or hides its list; the choice holds while the account stays open.
  function showPart(entry, which, show) {
    const button = entry.querySelector(`.new-toggle[data-show="${which}"]`);
    const box = entry.querySelector(which === 'pending' ? '.new-pending' : '.new-tweets');
    if (!button || !box) return;
    button.setAttribute('aria-expanded', String(show));
    box.hidden = !show;
    if (state.open === entry.dataset.username) state[which === 'pending' ? 'pendingOpen' : 'tweetsOpen'] = show;
    if (show) (which === 'pending' ? fillPending : fillTweets)(entry);
  }

  // Score: the average result of the account's calls for the chosen window (the asset's move minus Bitcoin's, or SPY's
  // for a stock; a bearish call counts the other way), with the number of calls. Fewer than 5 calls: shown in grey, not ranked.
  function scoreCell(a) {
    const s = wsOf(a);
    if (!s) return '<span class="new-score none"><span class="visually-hidden">Score </span>–</span>';
    const cls = !s.ranked ? 'few' : s.avg >= 0 ? 'up' : 'down';
    return `<span class="new-score ${cls}" title="${pts(s.avg)} points per call on average, ${s.n} call${s.n > 1 ? 's' : ''}, ${s.win}% won${s.ranked ? '' : ': too few to be ranked'}">`
      + `<span class="visually-hidden">Score </span><b>${pts(s.avg)}</b><small>${s.n} call${s.n > 1 ? 's' : ''}</small></span>`;
  }

  function loadCalls(username) {
    const key = username.toLowerCase();
    if (!callCache.has(key)) {
      callCache.set(key, fetch(`${BASE}calls/${encodeURIComponent(key)}.json`)
        .then((response) => (response.ok ? response.json() : { calls: [] }))
        .then((data) => data.calls || [])
        .catch(() => []));
    }
    return callCache.get(key);
  }

  // The asset by its ticker ($HYPE). A token called by its contract address comes with its ticker too (read on the
  // server from the pool it trades in); one still without a ticker shows its shortened address, without a $ sign.
  function assetName(c) {
    return c.asset.includes('…') || /^0x[0-9a-f]{8}/i.test(c.asset) ? c.asset : '$' + c.asset;
  }

  // One call: when, its direction and asset, and the points it brings (or, still in process, when its result comes).
  // Under it, what really happened: the coin's move and the market's over the same hours, from the entry price to the
  // exit price, and who measured the prices.
  function callItem(c, end) {
    const v = c[state.window];
    const capped = Math.abs(v) >= 50 ? '<small title="A call counts for at most 50 points"> max</small>' : '';
    return `<li><a class="new-call" href="${esc(c.url || '#')}" target="_blank" rel="noopener noreferrer">
        <span class="new-tweet-meta"><time datetime="${esc(c.at)}" title="${esc(fullDate(c.at))}">${esc(ago(Date.parse(c.at)))}</time></span>
        <span class="new-call-asset"><span class="call-dir ${c.stance === 'bearish' ? 'bear' : 'bull'}">${c.stance === 'bearish' ? 'Bearish' : 'Bullish'}</span>${esc(assetName(c))}</span>
        ${end || `<span class="new-call-result ${v >= 0 ? 'up' : 'down'}">${pts(v)} pts${capped}</span>`}
        ${callDetail(c)}
      </a></li>`;
  }

  function callDetail(c) {
    const w = state.window;
    const source = c.type === 'dex' ? 'GeckoTerminal' : 'CoinGecko';
    if (!Number.isFinite(c[w])) {
      return c.entryTs ? `<span class="new-call-detail">Since ${esc(when(c.entryTs))} · prices from ${source}</span>` : '';
    }
    const raw = c[`${w}Raw`];
    if (!Number.isFinite(raw)) return '';
    const yard = c[`${w}Yard`];
    const market = Number.isFinite(yard) ? ` (${c.type === 'stock' ? 'S&P 500' : 'Bitcoin'} ${moved(yard)})` : '';
    const span = c.entryTs && c[`${w}Ts`] ? ` from ${when(c.entryTs)} to ${when(c[`${w}Ts`])}` : '';
    const text = moved(raw);
    return `<span class="new-call-detail">${esc(text.charAt(0).toUpperCase() + text.slice(1) + market + span)} · prices from ${source}</span>`;
  }

  // New calls still in process: their result for the chosen window is not known yet, so they are not in the score.
  // It comes at the first update after the window has passed (24 hours after the call for the 24-hour window). A call
  // still without a result 2 hours after that lacks a price, and is left out.
  const SPAN = { day: '24 hours', week: '7 days', month: '1 month' };
  function inProcess(calls, win) {
    const now = Date.now();
    return calls.filter((c) => !Number.isFinite(c[win]) && now - Date.parse(c.at) < WINDOW_MS[win] + 2 * 36e5);
  }
  function resultIn(c) {
    const minutes = Math.ceil((Date.parse(c.at) + WINDOW_MS[state.window] - Date.now()) / 60000);
    const when = minutes <= 0 ? 'Result at the next update'
      : minutes < 60 ? `Result in ${minutes} min`
      : minutes < 48 * 60 ? `Result in ${Math.round(minutes / 60)} h` : `Result in ${Math.round(minutes / 1440)} d`;
    return `<span class="new-call-wait">${when}</span>`;
  }

  function fillPending(entry) {
    const button = entry.querySelector('.new-toggle[data-show="pending"]');
    const box = entry.querySelector('.new-pending');
    if (!button || !box) return;
    const win = state.window;
    loadCalls(entry.dataset.username).then((calls) => {
      if (!entry.isConnected || state.window !== win) return;
      const pending = inProcess(calls, win);
      button.querySelector('.new-toggle-n').textContent = count(pending.length);
      button.disabled = !pending.length;
      if (!pending.length) {
        // Nothing in process for this window: the list folds, and unfolds again in a window that has some.
        button.setAttribute('aria-expanded', 'false');
        box.hidden = true;
        return;
      }
      if (box.hidden) return;
      const item = (c) => callItem(c, resultIn(c));
      box.innerHTML = `<p class="new-tweets-note">Each call counts in the score ${SPAN[win]} after it was made.</p>`
        + `<ol class="new-call-list">${pending.slice(0, 10).map(item).join('')}</ol>`
        + (pending.length > 10 ? `<button class="new-more" type="button">Show ${pending.length - 10} more</button>` : '');
      box.querySelector('.new-more')?.addEventListener('click', (event) => {
        event.currentTarget.remove();
        box.querySelector('.new-call-list').insertAdjacentHTML('beforeend', pending.slice(10).map(item).join(''));
      });
    });
  }

  function fillCalls(entry) {
    const box = entry.querySelector('.new-calls');
    if (!box) return;
    const account = state.accounts.find((a) => a.username === entry.dataset.username);
    const win = state.window;
    if (!account?.ws) {
      // Calls are scored for independent accounts only.
      const note = typeOf(account || {}) !== 'independent' ? 'Calls are scored for independent accounts only.'
        : state.wsAt ? 'No call found.'
        : state.wsFailed ? 'The calls could not be loaded. Try again in a moment.' : 'Loading the calls…';
      box.innerHTML = `<p class="new-tweets-note">${note}</p>`;
      return;
    }
    fillPending(entry);
    loadCalls(entry.dataset.username).then((calls) => {
      if (!entry.isConnected || state.window !== win) return;
      const scored = calls.filter((c) => Number.isFinite(c[win]));
      const s = wsOf(account);
      if (!scored.length || !s) {
        box.innerHTML = `<p class="new-tweets-note">No call scored after ${SPAN[win]} yet.</p>`;
        return;
      }
      // How many calls bet on the coin rising (bullish) and on it falling (bearish): a bearish call wins when its coin falls
      // against the market (it does worse than Bitcoin, or SPY for a stock).
      const bear = Number.isFinite(s.bear) ? s.bear : scored.filter((c) => c.stance === 'bearish').length;
      const split = s.n === 1 ? `1 call, ${bear ? 'bearish' : 'bullish'}`
        : !bear ? `${s.n} calls, all bullish`
        : bear === s.n ? `${s.n} calls, all bearish` : `${s.n} calls: ${s.n - bear} bullish, ${bear} bearish`;
      box.innerHTML = `<p class="new-calls-head">${split}</p>`
        + `<p class="new-calls-sub">${pts(s.avg)} points per call on average against the market, ${s.win}% won.${bear ? ' A bearish call wins when its coin falls against the market.' : ''}</p>`
        + `<ol class="new-call-list">${scored.slice(0, 10).map((c) => callItem(c)).join('')}</ol>`
        + (scored.length > 10 ? `<button class="new-more" type="button">Show ${scored.length - 10} more calls</button>` : '');
      box.querySelector('.new-more')?.addEventListener('click', (event) => {
        event.currentTarget.remove();
        box.querySelector('.new-call-list').insertAdjacentHTML('beforeend', scored.slice(10).map((c) => callItem(c)).join(''));
      });
    });
  }

  // Movement since the previous update (every 30 minutes), shown under the rank when the list is ranked by score.
  function moveBadge(a) {
    if (state.sort.key !== 'score' || state.sort.dir !== 'desc' || !state.hasPrevious) return '';
    const s = wsOf(a);
    if (!s || !s.rank) return '';
    if (!s.prevRank) return '<span class="rank-move new" title="New in the ranking since the last update">new</span>';
    const d = s.prevRank - s.rank;
    if (!d) return '<span class="rank-move same" title="Same place as at the last update">=</span>';
    const n = Math.abs(d);
    return `<span class="rank-move ${d > 0 ? 'up' : 'down'}" title="${n} place${n > 1 ? 's' : ''} ${d > 0 ? 'up' : 'down'} since the last update">${d > 0 ? '▲' : '▼'}${n}</span>`;
  }

  function applyWs(ws) {
    if (!ws?.accounts) return;
    state.wsAt = ws.generatedAt;
    state.hasPrevious = Boolean(ws.hasPrevious);
    for (const a of state.accounts) a.ws = ws.accounts[a.username.toLowerCase()] || null;
    callCache.clear();
    rankAccounts();
    render();
  }

  // After an update: the accounts' activity again (tweets, last tweet, type), keeping their scores.
  function reloadAccounts() {
    return fetch(`${SOURCE}${SOURCE.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.accounts) return;
        const old = new Map(state.accounts.map((a) => [a.username.toLowerCase(), a]));
        state.accounts = data.accounts.map((a) => ({ ...a, name: a.name || a.username, ws: old.get(a.username.toLowerCase())?.ws || null }));
        tweetCache.clear();
      })
      .catch(() => {});
  }

  // Countdown to the next update: the scores are recomputed at 10 and 40 minutes past each hour (UTC). When it runs out,
  // the page asks for the new scores every 20 seconds until they arrive, then shows them with each account's movement.
  const countdown = document.getElementById('nextUpdate');
  let target = 0;
  let waiting = false;
  function nextSlot() {
    const d = new Date();
    const m = d.getUTCMinutes();
    d.setUTCSeconds(0, 0);
    if (m < 10) d.setUTCMinutes(10);
    else if (m < 40) d.setUTCMinutes(40);
    else d.setUTCHours(d.getUTCHours() + 1, 10);
    return d.getTime();
  }
  function poll(tries) {
    fetch(`${BASE}wolf_simple.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((ws) => {
        if (ws && ws.generatedAt !== state.wsAt) {
          return reloadAccounts().then(() => { applyWs(ws); waiting = false; target = nextSlot(); });
        }
        throw new Error('not yet');
      })
      .catch(() => {
        if (tries < 18) setTimeout(() => poll(tries + 1), 20000);
        else { waiting = false; target = nextSlot(); }
      });
  }
  function tick() {
    if (!countdown) return;
    if (!target) target = nextSlot();
    const left = target - Date.now();
    if (left > 0) {
      const sec = Math.ceil(left / 1000);
      countdown.textContent = `Next update in ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    } else {
      countdown.textContent = 'Updating…';
      if (!waiting) { waiting = true; poll(0); }
    }
  }
  tick();
  setInterval(tick, 1000);

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
      ? `Accounts ${count(start + 1)}–${count(start + pageRows.length)} of ${count(rows.length)}${state.cat ? `, ${LABEL[state.cat].toLowerCase()} only` : ''}${state.query.trim() ? ` matching “${state.query.trim()}”` : ''}`
      : '';
    const opened = list.querySelector('details.leaderboard-entry[open]');
    if (opened) { fillCalls(opened); fillTweets(opened); }
  }

  function goTo(page) {
    state.page = page;
    render();
    list.closest('.list-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // One account open at a time. A newly opened account shows its calls, with its new calls in process and its tweets
  // folded; what was unfolded stays so through a new window or an update.
  list.addEventListener('toggle', (event) => {
    const el = event.target;
    if (!el.matches?.('details.leaderboard-entry')) return;
    if (el.open) {
      if (state.open !== el.dataset.username) {
        state.pendingOpen = false;
        state.tweetsOpen = false;
        showPart(el, 'pending', false);
        showPart(el, 'tweets', false);
      }
      state.open = el.dataset.username;
      for (const other of list.querySelectorAll('details.leaderboard-entry[open]')) if (other !== el) other.open = false;
      fillCalls(el);
      fillTweets(el);
    } else if (state.open === el.dataset.username) {
      state.open = null;
      state.pendingOpen = false;
      state.tweetsOpen = false;
    }
  }, true);

  list.addEventListener('click', (event) => {
    const button = event.target.closest('.new-toggle');
    const entry = button?.closest('details.leaderboard-entry');
    if (!entry || button.disabled) return;
    showPart(entry, button.dataset.show, button.getAttribute('aria-expanded') !== 'true');
  });

  prev.addEventListener('click', () => goTo(state.page - 1));
  next.addEventListener('click', () => goTo(state.page + 1));
  numbers.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (button) goTo(Number(button.dataset.page));
  });
  sizeSelect.addEventListener('change', () => { state.size = Number(sizeSelect.value) || 100; state.page = 1; render(); });

  // Column headers: a click sorts by that column (largest or most recent first), a second click reverses it.
  function markSort() {
    for (const b of head?.querySelectorAll('[data-sort]') || []) {
      const on = b.dataset.sort === state.sort.key;
      b.classList.toggle('active', on);
      b.dataset.dir = on ? state.sort.dir : '';
      b.title = on ? `Sorted: ${SORT_WORDS[b.dataset.sort][state.sort.dir]}. Click to reverse.` : `Sort: ${SORT_WORDS[b.dataset.sort].desc}`;
    }
  }
  head?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    state.sort = state.sort.key === key ? { key, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' };
    markSort();
    rankAccounts();
    state.page = 1;
    render();
  });
  markSort();

  // The legend: a click shows only that type of account; "All" (or a second click on the type) shows them all again.
  legend?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-cat]');
    if (!item) return;
    const cat = item.dataset.cat === 'all' ? null : item.dataset.cat;
    state.cat = state.cat === cat ? null : cat;
    markLegend();
    state.page = 1;
    render();
  });
  // The legend shows only the types that some account has (off-topic and inactive accounts now live in the Garage).
  function markLegend() {
    if (!legend) return;
    for (const b of legend.querySelectorAll('[data-cat]')) {
      b.setAttribute('aria-pressed', String((b.dataset.cat === 'all' ? null : b.dataset.cat) === state.cat));
    }
    legend.classList.toggle('filtering', Boolean(state.cat));
  }

  function showLegend() {
    const has = state.accounts.some((a) => typeOf(a));
    if (!legend) return;
    legend.hidden = !has;
    legend.closest('.ranking-layout')?.classList.toggle('has-legend', has);
    for (const b of legend.querySelectorAll('[data-cat]')) {
      if (b.dataset.cat !== 'all') b.hidden = !state.accounts.some((a) => typeOf(a) === b.dataset.cat);
    }
  }
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
      showLegend();
      render();
      markLegend();
      fetch(`${BASE}wolf_simple.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
        .then(applyWs)
        .catch(() => { state.wsFailed = true; render(); });
    })
    .catch(() => {
      list.innerHTML = '<p class="empty">The list of accounts could not be loaded. Try again in a moment.</p>';
    });
})();
