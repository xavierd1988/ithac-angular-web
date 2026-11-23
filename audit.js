// Audit of every crypto mention of one account (test of the new reading method).
// First read: the legend and one short line per post (light, date and time, coin or platform).
// Everything else opens on demand: the details of a post in a pop-up, the test's figures and method in a fold-out.
// The data is a static file published with the site: ./audit/<username>.json. Only the accounts listed here have one.
(() => {
  'use strict';

  const ACCOUNTS = new Set(['wulfcryptox']);
  const VERSION = '20261123-audit4';
  const CATEGORIES = [
    { key: 'scored', label: 'Scored call', help: 'A call by this account on an identified token, with a price: scored with the same rule as every call on the site.' },
    { key: 'unscorable', label: 'Call without a price', help: 'A call on a known token whose exact token or price could not be pinned down, so it cannot be scored.' },
    { key: 'relayed', label: 'Relayed call', help: 'Someone else\'s call, retweeted or quoted. It is not counted for this account.' },
    { key: 'mention', label: 'Crypto mentioned, no call', help: 'A token named as context, news, a giveaway or a past move, with no view on what comes next.' },
    { key: 'unknown', label: 'Call, token unknown', help: 'A call that names no token we can identify, such as "the bottom is in".' },
    { key: 'platform', label: 'Platform or promo', help: 'An app, exchange or casino, not a token.' },
    { key: 'none', label: 'No crypto', help: 'Nothing about crypto in the post or its images.' }
  ];
  // The site's three result windows, and the matching horizon in the audit data.
  const WINDOWS = [{ key: 'day', h: '1d', label: '24 hours' }, { key: 'week', h: '1w', label: '7 days' }, { key: 'month', h: '1m', label: '1 month' }];
  const HORIZONS = WINDOWS.map((w) => [w.h, w.label]);
  const windowOf = (key) => WINDOWS.find((w) => w.key === key) || WINDOWS[0];
  const state = { data: new Map(), loading: new Map(), errors: new Map(), filter: new Map(), about: new Map(), window: 'day' };
  let dialog = null;

  const key = (username) => String(username || '').trim().replace(/^@+/, '').toLowerCase();
  const has = (username) => ACCOUNTS.has(key(username));
  const category = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1];

  function load(username) {
    const k = key(username);
    if (!ACCOUNTS.has(k)) return Promise.resolve(null);
    if (state.data.has(k)) return Promise.resolve(state.data.get(k));
    if (state.loading.has(k)) return state.loading.get(k);
    const request = fetch(`./audit/${encodeURIComponent(k)}.json?v=${VERSION}`, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => { state.data.set(k, data); state.errors.delete(k); return data; })
      .catch((error) => { state.errors.set(k, error.message || 'unavailable'); return null; })
      .finally(() => state.loading.delete(k));
    state.loading.set(k, request);
    return request;
  }

  function stateKey(username) {
    const k = key(username);
    if (!ACCOUNTS.has(k)) return '';
    const data = state.data.get(k);
    return [data ? data.generatedAt : '', state.errors.get(k) || '', state.filter.get(k) || 'all'].join('|');
  }

  function bind(container, rerender, setWindow) {
    container.querySelectorAll('[data-audit-window]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (typeof setWindow === 'function') setWindow(button.dataset.auditWindow, button);
      });
    });
    container.querySelectorAll('[data-audit-filter]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const k = button.dataset.auditAccount;
        const value = button.dataset.auditFilter;
        state.filter.set(k, state.filter.get(k) === value ? 'all' : value);
        rerender();
      });
    });
    container.querySelectorAll('[data-audit-open]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openPost(button.dataset.auditAccount, button.dataset.auditOpen);
      });
    });
    container.querySelectorAll('[data-audit-about]').forEach((details) => {
      details.addEventListener('toggle', () => state.about.set(details.dataset.auditAbout, details.open));
    });
  }

  function panelHtml(username, windowKey) {
    const k = key(username);
    if (!ACCOUNTS.has(k)) return '';
    state.window = windowOf(windowKey).key;
    const data = state.data.get(k);
    if (!data) {
      const text = state.errors.has(k) ? `The audit could not be loaded (${esc(state.errors.get(k))}).` : 'Loading the audit…';
      return `<section class="audit"><p class="calls-empty">${text}</p></section>`;
    }
    const filter = state.filter.get(k) || 'all';
    const items = data.items || [];
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, items.filter((i) => i.category === c.key).length]));
    const shown = filter === 'all' ? items : items.filter((i) => i.category === filter);
    return `
      <section class="audit" aria-labelledby="audit-title-${esc(k)}">
        <div class="audit-head">
          <h3 id="audit-title-${esc(k)}">Every crypto mention <small>test</small></h3>
          <div class="audit-windows" role="group" aria-label="Result taken after">
            ${WINDOWS.map((w) => `<button type="button" class="${w.key === state.window ? 'active' : ''}" data-audit-window="${w.key}"
              aria-pressed="${w.key === state.window}">${esc(w.label)}</button>`).join('')}
          </div>
          ${aboutHtml(k, data)}
        </div>
        <div class="audit-legend" role="group" aria-label="Show one type of post">
          ${CATEGORIES.map((c) => `
            <button type="button" class="audit-key${filter === c.key ? ' active' : ''}" data-audit-account="${esc(k)}" data-audit-filter="${c.key}"
              aria-pressed="${filter === c.key}" title="${esc(c.help)}">
              <span class="audit-led" data-cat="${c.key}" aria-hidden="true"></span>
              <span>${esc(c.label)}</span>
              <b>${counts[c.key]}</b>
            </button>`).join('')}
        </div>
        <ol class="audit-list">
          ${shown.map((item) => rowHtml(k, item)).join('') || '<li class="calls-empty">No post of this type.</li>'}
        </ol>
      </section>
    `;
  }

  // One line per post: its light, when it was posted, and the coin (or the platform).
  function rowHtml(k, item) {
    const cat = category(item.category);
    const coin = coinLabel(item);
    return `
      <li>
        <button type="button" class="audit-row" data-audit-account="${esc(k)}" data-audit-open="${esc(item.id)}"
          aria-label="${esc(`${cat.label}, ${dateTime(item.postedAt)}, ${coin}. Show the post`)}" aria-haspopup="dialog">
          <span class="audit-led" data-cat="${esc(cat.key)}" aria-hidden="true"></span>
          <time datetime="${esc(item.postedAt)}">${esc(dateTime(item.postedAt))}</time>
          <span class="audit-what">
            <span class="audit-coin${item.category === 'none' ? ' quiet' : ''}">${esc(coin)}</span>
            ${rowResultHtml(item)}
          </span>
          <span class="audit-chevron" aria-hidden="true">›</span>
        </button>
      </li>
    `;
  }

  function rowResultHtml(item) {
    const call = (item.calls || []).find((c) => c.results) || (item.calls || [])[0];
    if (!call) return '';
    const w = windowOf(state.window);
    const r = call.results?.[w.h];
    const entry = Number.isFinite(call.entry) ? price(call.entry) : '–';
    if (!call.results) return `<span class="audit-row-result"><span class="quiet">${esc(call.unscorable || 'No price')}</span></span>`;
    if (!r || r.status === 'pending' || r.status === 'no price') {
      return `<span class="audit-row-result"><span class="audit-prices">${esc(entry)} → <span class="quiet">${r?.status === 'no price' ? 'no price' : 'pending'}</span></span><span class="audit-score quiet">–</span></span>`;
    }
    const pct = Number(r.pct);
    const exit = Number.isFinite(r.exit) ? price(r.exit) : '–';
    return `
      <span class="audit-row-result ${scoreTone(r.score)}">
        <span class="audit-prices">${esc(entry)} → ${esc(exit)}</span>
        <span class="audit-pct">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</span>
        <span class="audit-score">${Number(r.score).toFixed(0)}</span>
      </span>`;
  }

  function coinLabel(item) {
    const uniq = (list) => [...new Set(list.filter(Boolean))];
    if ((item.calls || []).length) return uniq(item.calls.map((c) => c.asset)).join(', ');
    const of = (kind) => uniq((item.mentions || []).filter((m) => m.kind === kind).map((m) => m.asset));
    if (item.category === 'relayed') return of('relayed').join(', ') || 'Relayed call';
    if (item.category === 'mention') return of('mention').slice(0, 3).join(', ') || 'Crypto';
    if (item.category === 'unknown') return 'Unknown token';
    if (item.category === 'platform') return of('platform').slice(0, 2).join(', ') || 'Platform';
    return 'No crypto';
  }

  // The test's figures and how the list is made, folded away.
  function aboutHtml(k, data) {
    const s = data.summary || {};
    return `
      <details class="audit-about" data-audit-about="${esc(k)}"${state.about.get(k) ? ' open' : ''}>
        <summary>About this test</summary>
        <div class="audit-about-body">
          <p>New reading method, tried on this profile only. These calls are not in the ranking yet.</p>
          <dl class="audit-stats">
            <div><dt>Posts read</dt><dd>${num(s.posts)}</dd></div>
            <div><dt>Calls</dt><dd>${num(s.calls)}</dd></div>
            <div><dt>Scored</dt><dd>${num(s.scored)}</dd></div>
            <div><dt>1-day average</dt><dd class="${scoreTone(s.average1d)}">${Number.isFinite(s.average1d) ? s.average1d.toFixed(1) : '–'}</dd></div>
          </dl>
          <p>${esc(dateOnly(data.from))} to ${esc(dateOnly(data.to))}, newest first. A second reading, post by post, agrees on ${num(s.checkedAgree)} of ${num(s.posts)} posts.</p>
          ${data.method?.length ? `<ol>${data.method.map((line) => `<li>${esc(line)}</li>`).join('')}</ol>` : ''}
        </div>
      </details>
    `;
  }

  // ---------- Pop-up with the details of one post ----------
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'audit-dialog';
    dialog.setAttribute('aria-labelledby', 'audit-dialog-title');
    dialog.addEventListener('click', (event) => {
      // a click on the dimmed backdrop, or on the close button, closes it
      if (event.target === dialog || event.target.closest('[data-audit-close]')) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }

  function openPost(k, id) {
    const item = (state.data.get(key(k))?.items || []).find((i) => i.id === id);
    if (!item) return;
    const d = ensureDialog();
    d.innerHTML = detailHtml(item);
    if (!d.open) d.showModal();
    d.querySelector('.audit-dialog-inner')?.scrollTo(0, 0);
  }

  function detailHtml(item) {
    const cat = category(item.category);
    const type = item.type === 'retweet' ? `Retweet of ${item.from || ''}` : item.type === 'quote' ? `Quote of ${item.from || ''}` : 'Post';
    const calls = item.calls || [];
    const more = [
      ...calls.map(callReadingHtml),
      (item.mentions || []).length ? `<ul class="audit-mentions">${item.mentions.map(mentionHtml).join('')}</ul>` : '',
      (item.images || []).length ? `<p class="audit-image">${item.images.map((d) => `<span>Image: ${esc(d)}</span>`).join('')}</p>` : '',
      item.check ? `<p class="audit-check ${item.check.agrees ? 'ok' : 'differs'}">${item.check.agrees ? 'Second reading: same result' : `Second reading: ${esc(item.check.note || 'read differently')}`}</p>` : ''
    ].filter(Boolean).join('');
    return `
      <div class="audit-dialog-inner">
        <header class="audit-dialog-head">
          <span class="audit-led" data-cat="${esc(cat.key)}" aria-hidden="true"></span>
          <div>
            <h4 id="audit-dialog-title">${esc(coinLabel(item))}</h4>
            <p>${esc(dateTime(item.postedAt))} · ${esc(type)}${item.pinned ? ' · pinned' : ''} · <span class="audit-cat" data-cat="${esc(cat.key)}">${esc(cat.label)}</span></p>
          </div>
          <button type="button" class="audit-close" data-audit-close aria-label="Close">×</button>
        </header>
        ${item.text ? `<p class="audit-text">${esc(item.text)}</p>` : ''}
        ${item.quoted ? `<blockquote class="audit-quoted"><b>${esc(item.quoted.author)}</b> ${esc(item.quoted.text)}</blockquote>` : ''}
        ${calls.map(callHtml).join('')}
        <a class="audit-open-x" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open the post on X ↗</a>
        ${more ? `<details class="audit-more"><summary>Details</summary><div class="audit-more-body">${more}</div></details>` : ''}
      </div>
    `;
  }

  // The call itself: token, side, the author's words about what comes next, and its results.
  function callHtml(call) {
    const side = call.side === 'short' ? 'short' : 'long';
    const results = call.results
      ? HORIZONS.map(([h, label]) => resultHtml(call.results[h], label).replace('class="audit-result', `class="audit-result${h === windowOf(state.window).h ? ' current' : ''}`)).join('')
      : `<span class="audit-result none"><span>${esc(call.unscorable || 'No price')}</span></span>`;
    return `
      <div class="audit-call">
        <div class="audit-call-head">
          <b>${esc(call.asset)}</b>
          <span class="call-side ${side}">${side === 'short' ? 'Short' : 'Long'}</span>
          ${call.words ? `<q>${esc(call.words)}</q>` : ''}
        </div>
        <div class="audit-results">
          ${Number.isFinite(call.entry) ? `<span class="audit-result entry"><small>Entry</small><span>${esc(price(call.entry))}</span></span>` : ''}
          ${results}
        </div>
      </div>
    `;
  }

  // How the call was read: which token, how it was identified, how it was decided.
  function callReadingHtml(call) {
    const token = call.token
      ? `<a href="${esc(call.token.url)}" target="_blank" rel="noopener noreferrer">${esc(call.token.chain)} · ${esc(shortAddress(call.token.address))}</a>`
      : '<span>token not pinned down</span>';
    return `
      <div class="audit-reading">
        <div class="audit-call-token"><b>${esc(call.asset)}</b> ${token}${call.identity ? ` <small>${esc(call.identity)}</small>` : ''}</div>
        ${call.decision ? `<div class="audit-call-decision">${esc(call.decision)}</div>` : ''}
        ${call.correction ? `<p class="audit-correction">${esc(call.correction)}</p>` : ''}
      </div>
    `;
  }

  function resultHtml(result, label) {
    if (!result || result.status === 'pending') return `<span class="audit-result pending"><small>${esc(label)}</small><span>pending</span></span>`;
    if (result.status === 'no price') return `<span class="audit-result none"><small>${esc(label)}</small><span>no price</span></span>`;
    const pct = Number(result.pct);
    const exit = Number.isFinite(result.exit) ? `${price(result.exit)} · ` : '';
    return `<span class="audit-result ${scoreTone(result.score)}"><small>${esc(label)}</small><span>${esc(exit)}${pct > 0 ? '+' : ''}${pct.toFixed(1)}% · <b>${Number(result.score).toFixed(0)}</b></span></span>`;
  }

  function mentionHtml(m) {
    const cat = { call: 'scored', relayed: 'relayed', mention: 'mention', unknown: 'unknown', platform: 'platform' }[m.kind] || 'mention';
    const side = m.side ? ` <span class="call-side ${m.side}">${m.side === 'short' ? 'Short' : 'Long'}</span>` : '';
    return `
      <li>
        <span class="audit-led small" data-cat="${esc(cat)}" aria-hidden="true"></span>
        <b>${esc(m.asset)}</b>${side} <span class="audit-role">${esc(m.label || m.kind)}</span>
        ${m.quote ? `<q>${esc(m.quote)}</q>` : ''}
      </li>
    `;
  }

  function scoreTone(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return 'neutral';
    if (value >= 55) return 'good';
    if (value <= 45) return 'bad';
    return 'neutral';
  }

  function price(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '–';
    if (n >= 100) return `$${n.toFixed(2)}`;
    if (n >= 1) return `$${n.toFixed(4)}`;
    return `$${n.toPrecision(4)}`;
  }

  function shortAddress(address) {
    const a = String(address || '');
    return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
  }

  function dateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function dateOnly(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function num(value) {
    return Number.isFinite(Number(value)) ? String(value) : '–';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  window.IthacAudit = { has, load, stateKey, panelHtml, bind };
})();
