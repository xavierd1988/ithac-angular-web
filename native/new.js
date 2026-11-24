// New ITHAC home page: the list of followed accounts, read from the new base on the server.
// Scores and calls come later, with the new collection; the 24 hours / 7 days / 1 month buttons are ready for them.
(() => {
  'use strict';

  const SOURCE = new URLSearchParams(location.search).get('src') || 'https://api.ithacapp.com/new/accounts.json';
  const state = { accounts: [], query: '', page: 1, size: 100, open: null };

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
          <span class="leaderboard-score"><span class="visually-hidden">Score </span>–</span>
          <span class="leaderboard-calls"><span class="visually-hidden">Calls </span>–</span>
          <span class="leaderboard-chevron" aria-hidden="true"></span>
        </summary>
        <div class="new-detail">
          <a class="new-profile" href="https://x.com/${encodeURIComponent(a.username)}" target="_blank" rel="noopener noreferrer">Open @${esc(a.username)} on X</a>
          <p>Calls and scores will appear here with the new collection.</p>
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

  // The three windows stay in place for the scores to come; for now they only change which button is active.
  for (const button of document.querySelectorAll('[data-window]')) {
    button.addEventListener('click', () => {
      for (const b of document.querySelectorAll('[data-window]')) {
        const active = b === button;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      }
    });
  }

  fetch(SOURCE, { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then((data) => {
      state.accounts = (data.accounts || []).map((a, i) => ({ ...a, rank: i + 1, name: a.name || a.username }));
      render();
    })
    .catch(() => {
      list.innerHTML = '<p class="empty">The list of accounts could not be loaded. Try again in a moment.</p>';
    });
})();
