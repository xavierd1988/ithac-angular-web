// New ITHAC home page: the list of followed accounts, read from the new base on the server.
// Scores and calls come later, with the new collection; the 24 hours / 7 days / 1 month buttons are ready for them.
(() => {
  'use strict';

  const SOURCE = new URLSearchParams(location.search).get('src') || 'https://api.ithacapp.com/new/accounts.json';
  const STEP = 100;
  const state = { accounts: [], query: '', shown: STEP, open: null };

  const list = document.getElementById('list');
  const note = document.getElementById('rankingQuality');
  const stats = document.getElementById('rankingStats');
  const more = document.getElementById('incrementalRanking');
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

  function render() {
    const rows = visible();
    if (!rows.length) {
      list.innerHTML = `<p class="empty">${state.accounts.length ? 'No account matches this search.' : 'No account yet.'}</p>`;
    } else {
      list.innerHTML = rows.slice(0, state.shown).map(row).join('');
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
    more.hidden = rows.length <= state.shown;
    stats.textContent = state.query
      ? `${count(rows.length)} of ${count(state.accounts.length)} accounts match`
      : `${count(state.accounts.length)} accounts followed · showing ${count(Math.min(state.shown, rows.length))}`;
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

  document.getElementById('showMore').addEventListener('click', () => { state.shown += STEP; render(); });
  search.addEventListener('input', () => { state.query = search.value; state.shown = STEP; render(); });

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
      note.textContent = `New base: ${count(state.accounts.length)} accounts followed. Scores and calls will appear here as the new collection fills in.`;
      render();
    })
    .catch(() => {
      note.textContent = 'The list of accounts could not be loaded. Try again in a moment.';
      list.innerHTML = '<p class="empty">The list of accounts could not be loaded.</p>';
    });
})();
