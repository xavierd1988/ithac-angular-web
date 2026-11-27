// Pump.fun investigation page: reads the data rebuilt on the server every 10 minutes (trends watched, tokens found with their paper
// test, wallets seen buying early on several tokens) and shows it plainly. Refreshes itself every 5 minutes.
(() => {
  const SOURCE = 'https://api.ithacapp.com/new/pumpfun.json';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const signed = (v, unit = '%') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : 1)}${unit}`;
  const money = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toFixed(0)}`;
  const tone = (v) => (v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat');
  function ago(iso) {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 60) return `${m} min ago`;
    if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
  }
  const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  function stats(d) {
    const t = d.totals;
    const test = t.closed
      ? `<b class="${tone(t.result)}">${money(t.result)}</b><span>Test result, $100 each: ${t.closed} closed, ${t.won} won</span>`
      : '<b>—</b><span>Test result: no token sold yet (24 hours at most)</span>';
    $('stats').innerHTML = `
      <div class="lab-stat"><b>${d.trends.watchedToday}</b><span>Trends watched today</span></div>
      <div class="lab-stat"><b>${t.tokens}</b><span>Tokens found named after a trend (${t.open} still in the test)</span></div>
      <div class="lab-stat"><b>${t.doubled}</b><span>Of them doubled after we found them</span></div>
      <div class="lab-stat">${test}</div>
      <p class="lab-since">Since ${esc(day(d.startedAt))}. ${d.wallets.noted.toLocaleString('en-US')} early-buyer wallets noted so far.</p>`;
  }

  function trends(d) {
    // A short sample of each source keeps the page light; the rest is counted.
    const group = (cls, title, list, max) => list.length ? `<div class="lab-group"><h3><span class="lab-dot ${cls}"></span>${title}</h3>
      <ul class="chips">${list.slice(0, max).map((t) => `<li class="chip ${cls}" title="${esc(t.label)}">${esc(t.key)}</li>`).join('')}`
      + (list.length > max ? `<li class="chip more">and ${list.length - max} more</li>` : '') + '</ul></div>' : '';
    $('trends').innerHTML = group('cafe', "From the Dinelli's Café edition", d.trends.cafe || [], 24)
      + group('google', 'Google Trends, live', d.trends.google || [], 12)
      || '<p class="lab-empty">No trend read yet today.</p>';
  }

  function tokens(d) {
    if (!d.tokens.length) {
      $('tokens').innerHTML = '<p class="lab-empty">No token named after today\'s trends yet. The search runs every hour.</p>';
      return;
    }
    const exit = { x2: 'sold at twice the price', '-50%': 'stopped at half', '24 hours': 'sold after 24 hours', 'liquidity gone': 'pool emptied, all lost' };
    $('tokens').innerHTML = `<div class="lab-row tok head"><span>Token</span><span>Trend</span><span class="num">Since found</span><span class="num">Best</span><span>Test</span></div>`
      + d.tokens.map((t) => `<div class="lab-row tok">
        <span class="name"><a href="https://www.geckoterminal.com/solana/pools/${esc(t.pool)}" target="_blank" rel="noopener noreferrer">${esc(t.name)}</a>
          <span class="sub">found ${esc(ago(t.foundAt))}, ${t.ageAtFoundH < 1 ? Math.round(t.ageAtFoundH * 60) + ' min' : t.ageAtFoundH + ' h'} after its launch · ${t.earlyBuyers} early buyers noted</span></span>
        <span class="trend"><span class="chip ${esc(t.source)}">${esc(t.trend)}</span></span>
        <span class="num ${tone(t.change)}"><span class="lab-label">Since found </span>${signed(t.change)}</span>
        <span class="num ${tone(t.best)}"><span class="lab-label">Best </span>${signed(t.best)}</span>
        <span class="test">${t.status === 'closed'
          ? `<b class="${tone(t.result)}">${money(t.result)}</b> ${esc(exit[t.exitReason] || '')}`
          : 'in the test'}</span>
      </div>`).join('');
  }

  function wallets(d) {
    const w = d.wallets.list;
    if (!w.length) {
      $('wallets').innerHTML = `<p class="lab-empty">None yet: ${d.wallets.noted.toLocaleString('en-US')} wallets noted, none early on two of our tokens so far.</p>`;
      return;
    }
    $('wallets').innerHTML = `<div class="lab-row wal head"><span>Wallet</span><span class="num">Early on</span><span class="num">Of them doubled</span><span>Tokens</span></div>`
      + w.map((x) => `<div class="lab-row wal">
        <span class="name mono"><a href="https://solscan.io/account/${esc(x.wallet)}" target="_blank" rel="noopener noreferrer">${esc(x.wallet.slice(0, 5))}…${esc(x.wallet.slice(-4))}</a></span>
        <span class="num"><span class="lab-label">Early on </span>${x.tokens} tokens</span>
        <span class="num ${x.doubled ? 'up' : 'flat'}"><span class="lab-label">Doubled </span>${x.doubled}</span>
        <span class="names sub">${x.names.map(esc).join(', ')}</span>
      </div>`).join('');
  }

  async function load() {
    try {
      const r = await fetch(`${SOURCE}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      $('liveLine').textContent = `Live test, no real money · prices read every 10 minutes · last update ${ago(d.generatedAt)}`;
      stats(d); trends(d); tokens(d); wallets(d);
    } catch {
      $('stats').innerHTML = '<p class="lab-empty">The investigation data could not be loaded. It is rebuilt every 10 minutes; try again in a moment.</p>';
    }
  }
  load();
  setInterval(load, 5 * 60 * 1000);
})();
