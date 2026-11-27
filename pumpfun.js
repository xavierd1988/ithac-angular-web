// Pump.fun investigation page: reads the trend robot's data (rebuilt every 5 minutes) and the hourly search's data (rebuilt
// every 10 minutes: trends watched, tokens found with their paper test, wallets seen buying early on several tokens) and
// shows them plainly. Refreshes itself every 5 minutes.
(() => {
  const SOURCE = 'https://api.ithacapp.com/new/pumpfun.json';
  const ROBOT = 'https://api.ithacapp.com/new/trendbot.json';
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
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const EXIT = { x2: 'sold at twice the price', '-50%': 'stopped at half', '24 hours': 'sold after 24 hours', 'liquidity gone': 'pool emptied, all lost' };

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
    const exit = EXIT;
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

  // The trend robot: a token's line says when it was bought after the trend began, and when the token was created.
  function born(t) {
    if (!t.launchedAt) return '';
    const m = (Date.parse(t.launchedAt) - Date.parse(t.trendStartedAt || t.foundAt)) / 60000;
    if (m >= 0) return `token created ${Math.round(m)} min after it`;
    if (-m < 120) return `token created ${Math.round(-m)} min before`;
    if (-m < 72 * 60) return `token created ${Math.round(-m / 60)} h before`;
    const d = new Date(t.launchedAt);
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return `token created ${d.toLocaleDateString('en-US', opts)}`;
  }
  function bought(t) {
    const what = t.source === 'cafe' ? "the Café edition came out" : 'the trend began';
    const when = t.minAfterTrend == null ? `bought ${ago(t.foundAt)}` : `bought ${t.minAfterTrend} min after ${what}`;
    return [when, born(t)].filter(Boolean).join(' · ');
  }

  function robot(d) {
    const t = d.totals;
    const avg = t.avg60 == null
      ? '<b>—</b><span>Average move 1 hour after buying: first figure an hour after the first buy</span>'
      : `<b class="${tone(t.avg60)}">${signed(t.avg60)}</b><span>Average move 1 hour after buying (${t.n60} token${t.n60 > 1 ? 's' : ''})</span>`;
    const test = t.closed
      ? `<b class="${tone(t.result)}">${money(t.result)}</b><span>Test result, $100 each: ${t.closed} sold, ${t.won} won</span>`
      : '<b>—</b><span>Test result: first sales within 24 hours of the first buy</span>';
    $('robotStats').innerHTML = `
      <div class="lab-stat"><b>${t.trends}</b><span>Trends caught as they started</span></div>
      <div class="lab-stat"><b>${t.tokens}</b><span>Tokens bought on paper (${t.open} still in the test)</span></div>
      <div class="lab-stat">${avg}</div>
      <div class="lab-stat">${test}</div>
      <p class="lab-since">Running since ${esc(day(d.startedAt))}, ${esc(clock(d.startedAt))}. ${t.withTokens} of the ${t.trends} trends caught had a token carrying their name.</p>`;
    const caught = (d.trends || []).slice(0, 14);
    $('robotTrends').innerHTML = caught.length ? `<h3 class="lab-mini">Latest trends caught</h3><ul class="chips">${caught.map((x) =>
      `<li class="chip ${esc(x.source)}" title="${esc(x.label)}">${esc(x.key)}${x.tokens ? ` <b>· ${x.tokens} token${x.tokens > 1 ? 's' : ''}</b>` : ''}</li>`).join('')}</ul>` : '';
    $('robotTokens').innerHTML = !d.tokens.length
      ? '<p class="lab-empty">No token yet. The robot buys on paper as soon as a new trend has one.</p>'
      : `<div class="lab-row tok head"><span>Token</span><span>Trend</span><span class="num">After 1 hour</span><span class="num">Best</span><span>Test</span></div>`
        + d.tokens.slice(0, 60).map((x) => `<div class="lab-row tok">
        <span class="name"><a href="https://www.geckoterminal.com/solana/pools/${esc(x.pool)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>
          <span class="sub">${esc(x.symbol)} · ${esc(bought(x))}</span></span>
        <span class="trend"><span class="chip ${esc(x.source)}">${esc(x.trend)}</span></span>
        <span class="num ${x.after60 == null ? 'flat' : tone(x.after60)}"><span class="lab-label">After 1 hour </span>${x.after60 == null ? '—' : signed(x.after60)}</span>
        <span class="num ${tone(x.best || 0)}"><span class="lab-label">Best </span>${signed(x.best || 0)}</span>
        <span class="test">${x.status === 'closed'
          ? `<b class="${tone(x.result)}">${money(x.result)}</b> ${esc(EXIT[x.exitReason] || '')}`
          : `in the test${x.change == null ? '' : `, ${signed(x.change)} now`}`}</span>
      </div>`).join('');
  }

  async function getJSON(url) {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function load() {
    const [lab, bot] = await Promise.allSettled([getJSON(SOURCE), getJSON(ROBOT)]);
    try {
      if (bot.status !== 'fulfilled') throw bot.reason;
      robot(bot.value);
    } catch {
      $('robotStats').innerHTML = '<p class="lab-empty">The robot\'s data could not be loaded. It is rebuilt every 5 minutes; try again in a moment.</p>';
    }
    try {
      if (lab.status !== 'fulfilled') throw lab.reason;
      const d = lab.value;
      stats(d); trends(d); tokens(d); wallets(d);
    } catch {
      $('stats').innerHTML = '<p class="lab-empty">The investigation data could not be loaded. It is rebuilt every 10 minutes; try again in a moment.</p>';
    }
    const times = [lab, bot].filter((x) => x.status === 'fulfilled').map((x) => Date.parse(x.value.generatedAt)).filter(Boolean);
    if (times.length) $('liveLine').textContent = `Live test, no real money · the robot runs every 5 minutes · last update ${ago(new Date(Math.max(...times)).toISOString())}`;
  }
  load();
  setInterval(load, 5 * 60 * 1000);
})();
