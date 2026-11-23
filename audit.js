// Audit of every crypto mention of one account, post by post (test of the new reading method).
// The data is a static file published with the site: ./audit/<username>.json. Only the accounts listed here have one.
(() => {
  'use strict';

  const ACCOUNTS = new Set(['wulfcryptox']);
  const VERSION = '20261123-audit1';
  const CATEGORIES = [
    { key: 'scored', label: 'Scored call', help: 'A call by this account on an identified token, with a price: scored with the same rule as every call on the site.' },
    { key: 'unscorable', label: 'Call without a price', help: 'A call on a known token whose exact token or price could not be pinned down, so it cannot be scored.' },
    { key: 'relayed', label: 'Relayed call', help: 'Someone else\'s call, retweeted or quoted. It is not counted for this account.' },
    { key: 'mention', label: 'Crypto mentioned, no call', help: 'A token named as context, news, a giveaway or a past move, with no view on what comes next.' },
    { key: 'unknown', label: 'Call, token unknown', help: 'A call that names no token we can identify, such as "the bottom is in".' },
    { key: 'platform', label: 'Platform or promo', help: 'An app, exchange or casino, not a token.' },
    { key: 'none', label: 'No crypto', help: 'Nothing about crypto in the post or its images.' }
  ];
  const HORIZONS = [['1d', '1 day'], ['1w', '1 week'], ['1m', '1 month']];
  const state = { data: new Map(), loading: new Map(), errors: new Map(), filter: new Map() };

  const key = (username) => String(username || '').trim().replace(/^@+/, '').toLowerCase();
  const has = (username) => ACCOUNTS.has(key(username));

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

  function bind(container, rerender) {
    container.querySelectorAll('[data-audit-filter]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const k = button.dataset.auditAccount;
        const value = button.dataset.auditFilter;
        state.filter.set(k, state.filter.get(k) === value ? 'all' : value);
        rerender();
      });
    });
  }

  function panelHtml(username) {
    const k = key(username);
    if (!ACCOUNTS.has(k)) return '';
    const data = state.data.get(k);
    if (!data) {
      const text = state.errors.has(k) ? `The audit could not be loaded (${esc(state.errors.get(k))}).` : 'Loading the audit…';
      return `<section class="audit"><p class="calls-empty">${text}</p></section>`;
    }
    const filter = state.filter.get(k) || 'all';
    const items = data.items || [];
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, items.filter((i) => i.category === c.key).length]));
    const shown = filter === 'all' ? items : items.filter((i) => i.category === filter);
    const active = CATEGORIES.find((c) => c.key === filter);
    const s = data.summary || {};
    return `
      <section class="audit" aria-labelledby="audit-title-${esc(k)}">
        <div class="audit-head">
          <div>
            <h3 id="audit-title-${esc(k)}">Every crypto mention, post by post</h3>
            <p class="audit-sub">Test of the new reading method on this profile only. These calls are not in the ranking yet.</p>
          </div>
          <dl class="audit-stats">
            <div><dt>Posts read</dt><dd>${num(s.posts)}</dd></div>
            <div><dt>Calls by @${esc(k)}</dt><dd>${num(s.calls)}</dd></div>
            <div><dt>Scored</dt><dd>${num(s.scored)}</dd></div>
            <div><dt>1-day average</dt><dd class="${scoreTone(s.average1d)}">${Number.isFinite(s.average1d) ? s.average1d.toFixed(1) : '–'}</dd></div>
          </dl>
        </div>
        <p class="audit-period">${esc(dateOnly(data.from))} to ${esc(dateOnly(data.to))}, newest first · second check, post by post: ${num(s.checkedAgree)} of ${num(s.posts)} read the same way</p>
        <div class="audit-legend" role="group" aria-label="Show one type of post">
          ${CATEGORIES.map((c) => `
            <button type="button" class="audit-key${filter === c.key ? ' active' : ''}" data-audit-account="${esc(k)}" data-audit-filter="${c.key}"
              aria-pressed="${filter === c.key}" title="${esc(c.help)}">
              <span class="audit-led" data-cat="${c.key}" aria-hidden="true"></span>
              <span class="audit-key-label">${esc(c.label)}</span>
              <b>${counts[c.key]}</b>
            </button>`).join('')}
        </div>
        <p class="audit-legend-help">${active ? `${esc(active.help)} <button type="button" class="link-button" data-audit-account="${esc(k)}" data-audit-filter="${active.key}">Show every post</button>` : 'Each light shows what a post contains. Select a type to show only those posts.'}</p>
        <ol class="audit-list">
          ${shown.map(itemHtml).join('') || '<li class="calls-empty">No post of this type.</li>'}
        </ol>
        ${data.method?.length ? `
          <details class="audit-method">
            <summary>How this list is made</summary>
            <ol>${data.method.map((line) => `<li>${esc(line)}</li>`).join('')}</ol>
          </details>` : ''}
      </section>
    `;
  }

  function itemHtml(item) {
    const cat = CATEGORIES.find((c) => c.key === item.category) || CATEGORIES[CATEGORIES.length - 1];
    const type = item.type === 'retweet' ? `Retweet of ${item.from || ''}` : item.type === 'quote' ? `Quote of ${item.from || ''}` : 'Post';
    return `
      <li class="audit-item" data-cat="${esc(cat.key)}">
        <span class="audit-led" data-cat="${esc(cat.key)}" aria-hidden="true"></span>
        <div class="audit-body">
          <div class="audit-meta">
            <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(dateTime(item.postedAt))}</a>
            <span>${esc(type)}${item.pinned ? ' · pinned' : ''}</span>
            <span class="audit-cat" data-cat="${esc(cat.key)}">${esc(cat.label)}</span>
          </div>
          ${item.text ? `<p class="audit-text">${esc(item.text)}</p>` : ''}
          ${item.quoted ? `<blockquote class="audit-quoted"><b>${esc(item.quoted.author)}</b> ${esc(item.quoted.text)}</blockquote>` : ''}
          ${(item.images || []).length ? `<p class="audit-image">${item.images.map((d) => `<span>Image: ${esc(d)}</span>`).join('')}</p>` : ''}
          ${(item.calls || []).map(callHtml).join('')}
          ${(item.mentions || []).length ? `<ul class="audit-mentions">${item.mentions.map(mentionHtml).join('')}</ul>` : ''}
          ${item.check ? `<p class="audit-check ${item.check.agrees ? 'ok' : 'differs'}">${item.check.agrees ? 'Second check: same reading' : `Second check: ${esc(item.check.note || 'read differently')}`}</p>` : ''}
        </div>
      </li>
    `;
  }

  function callHtml(call) {
    const side = call.side === 'short' ? 'short' : 'long';
    const token = call.token
      ? `<a href="${esc(call.token.url)}" target="_blank" rel="noopener noreferrer">${esc(call.token.chain)} · ${esc(shortAddress(call.token.address))}</a>`
      : '<span>token not pinned down</span>';
    const results = call.results
      ? HORIZONS.map(([h, label]) => resultHtml(call.results[h], label)).join('')
      : `<span class="audit-result none">${esc(call.unscorable || 'No price')}</span>`;
    return `
      <div class="audit-call" data-scored="${call.results ? 'yes' : 'no'}">
        <div class="audit-call-head">
          <b>${esc(call.asset)}</b>
          <span class="call-side ${side}">${side === 'short' ? 'Short' : 'Long'}</span>
          ${call.words ? `<q>${esc(call.words)}</q>` : ''}
        </div>
        <div class="audit-call-token">${token}${call.identity ? ` <small>${esc(call.identity)}</small>` : ''}</div>
        ${call.decision ? `<div class="audit-call-decision">${esc(call.decision)}</div>` : ''}
        ${call.correction ? `<p class="audit-correction">${esc(call.correction)}</p>` : ''}
        <div class="audit-results">
          ${Number.isFinite(call.entry) ? `<span class="audit-result entry"><small>Entry</small><span>${esc(price(call.entry))}</span></span>` : ''}
          ${results}
        </div>
      </div>
    `;
  }

  function resultHtml(result, label) {
    if (!result || result.status === 'pending') return `<span class="audit-result pending"><small>${esc(label)}</small><span>pending</span></span>`;
    if (result.status === 'no price') return `<span class="audit-result none"><small>${esc(label)}</small><span>no price</span></span>`;
    const pct = Number(result.pct);
    return `<span class="audit-result ${scoreTone(result.score)}"><small>${esc(label)}</small><span>${pct > 0 ? '+' : ''}${pct.toFixed(1)}% · <b>${Number(result.score).toFixed(0)}</b></span></span>`;
  }

  function mentionHtml(m) {
    const cat = { call: 'scored', relayed: 'relayed', mention: 'mention', unknown: 'unknown', platform: 'platform' }[m.kind] || 'mention';
    const side = m.side ? ` <span class="call-side ${m.side}">${m.side === 'short' ? 'Short' : 'Long'}</span>` : '';
    return `
      <li>
        <span class="audit-led small" data-cat="${esc(m.kind === 'call' && m.scored === false ? 'unscorable' : cat)}" aria-hidden="true"></span>
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
