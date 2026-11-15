// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail view with the value model's own
// inputs, the live-token view and the methodology. No network: every byte shown is in data.js.
//
// The page recomputes each row's implied value from the snapshot figures (TVL, growth, age,
// chains, category multiple), so the page's code and the board's data are visibly the same
// arithmetic. Hash routes: #/board, #/live, #/method, #/detail/<slug>, #/filter/<category>.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;
  app.setAttribute('aria-busy', 'false');

  var ROWS = DATA.rows || [];
  var LIVE = DATA.live || [];
  var MULTS = DATA.multiples || [];
  var MODEL = DATA.model || {};
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  var state = { q: '', category: 'all', chain: 'all', wlOnly: false, sort: 'implied', dir: -1 };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model, recomputed in the page from the same figures main.ts used. growth is clamped to
  // [growth_floor, growth_cap]; maturity from age (unknown age -> unknown_age_days); breadth from
  // the chain count. The multiple is the category's, already in the row.
  function impliedOf(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, g));
    var growthMult = 1 + (g / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var breadth = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), MODEL.breadth_max_chains) * MODEL.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function totalImplied() {
    var s = 0;
    ROWS.forEach(function (r) { s += r.implied_value_usd; });
    return s;
  }

  function header() {
    return el('header', { class: 'mast' },
      el('div', { class: 'eyebrow', text: 'Token Radar · ' + esc(DATA.model_version) }),
      el('h1', {}, 'Pre-token protocols, ', el('span', { class: 'thin', text: 'ranked by implied value' })),
      el('p', { class: 'lede', text: 'Every protocol in the snapshot that records no token, ranked by what its token would be worth if the market priced it like the listed protocols in its category. Each row carries the steps to farm it.' }),
      el('div', { class: 'meta' },
        'Snapshot ', el('b', { text: esc(DATA.as_of) }),
        ' · Source: DefiLlama protocols · Floor $' + (DATA.floor_usd / 1e6).toFixed(0) + 'M · ',
        String(ROWS.length), ' rows on the board · ', String(LIVE.length), ' live tokens shown · No network: every figure on this page is in the snapshot.'));
  }

  function statCards() {
    var cards = [
      ['Watchlist', String(DATA.watchlist_size), 'protocols at or above the $50M floor with no token'],
      ['Board', String(DATA.board_size), DATA.early_size + ' early rows below the floor'],
      ['Total implied value', fmtUsd(totalImplied()), 'sum of the board, this entry\u2019s own claim'],
      ['Live tokens', String(DATA.live_size), 'listed protocols shown at market value'],
      ['Market median', fmtMult(DATA.global_median), 'mcap / TVL across listed protocols'],
    ];
    return el('div', { class: 'stats' }, cards.map(function (c) {
      return el('div', { class: 'stat' },
        el('div', { class: 'k', text: c[0] }),
        el('div', { class: 'v', text: c[1] }),
        el('div', { class: 's', text: c[2] }));
    }));
  }

  function tabs(active) {
    function tab(href, label, n, on) {
      return el('a', { class: 'tab' + (on ? ' on' : ''), href: href, text: label }, n ? el('span', { class: 'n', text: String(n) }) : null);
    }
    return el('nav', { class: 'tabs' },
      tab('#/board', 'Pre-token board', DATA.board_size, active === 'board'),
      tab('#/live', 'Live tokens', DATA.live_size, active === 'live'),
      tab('#/method', 'How the value is derived', null, active === 'method'));
  }

  function categories() {
    var seen = {};
    var list = [];
    ROWS.forEach(function (r) {
      var c = r.category || '(no category)';
      if (!seen[c]) { seen[c] = true; list.push(c); }
    });
    return list.sort();
  }

  function chains() {
    var seen = {};
    var list = [];
    ROWS.forEach(function (r) {
      (r.chains || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; list.push(c); } });
    });
    return list.sort();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return ROWS.filter(function (r) {
      if (state.wlOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || '(no category)') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sortedRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    var val = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      name: function (r) { return r.name.toLowerCase(); },
      rank: function (r) { return r.rank; },
    }[key] || function (r) { return r.implied_value_usd; };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function boardView() {
    var wrap = el('div', { class: 'wrap' }, header(), statCards(), tabs('board'));
    var rows = sortedRows(filteredRows());

    var search = el('input', { type: 'search', placeholder: 'Search name or slug\u2026', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var catSel = el('select', { 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories().map(function (c) { return el('option', { value: c, text: c + ' (' + ROWS.filter(function (r) { return (r.category || '(no category)') === c; }).length + ')' }); }));
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; render(); });
    var chainSel = el('select', { 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains().map(function (c) { return el('option', { value: c, text: c }); }));
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; render(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox' }), ' Watchlist only');
    var wlBox = wl.querySelector('input');
    wlBox.checked = state.wlOnly;
    wlBox.addEventListener('change', function () { state.wlOnly = wlBox.checked; render(); });
    var count = el('span', { class: 'count', text: rows.length + ' of ' + ROWS.length + ' rows' });
    wrap.appendChild(el('div', { class: 'filters' }, search, catSel, chainSel, wl, count));

    if (rows.length === 0) {
      wrap.appendChild(el('div', { class: 'empty', text: 'No protocol matches this filter.' }));
    } else {
      var table = el('table', {},
        el('thead', {}, el('tr', {},
          th('Rank', 'rank'), th('Protocol', 'name'), th('Category', null), th('Chains', null),
          th('TVL', 'tvl', true), th('7d', 'growth', true), th('Age', 'age', true),
          th('Implied value', 'implied', true), th('Multiple', null, true))),
        el('tbody', {}, rows.map(function (r) { return rowEl(r); })));
      wrap.appendChild(table);
    }
    wrap.appendChild(footer());
    return wrap;

    function th(label, key, right) {
      var attrs = { class: (key ? 'sortable ' : '') + (right ? 'r' : ''), text: label + (state.sort === key ? (state.dir === -1 ? ' \u25bc' : ' \u25b2') : '') };
      if (key) attrs.onclick = function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      };
      return el('th', attrs);
    }
  }

  function rowEl(r) {
    var tr = el('tr', {},
      el('td', { class: 'rank' + (r.rank <= 3 ? ' top3' : '') + ' num', text: '#' + r.rank }),
      el('td', {},
        el('span', { class: 'name', text: r.name }),
        WATCH[r.slug] ? el('span', { class: 'badge wl', text: 'WATCHLIST' }) : null,
        el('div', { class: 'slug', text: r.slug })),
      el('td', { class: 'mut', text: r.category || '\u2014' }),
      el('td', { class: 'mut', text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }),
      el('td', { class: 'r num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'r num ' + (r.change_7d === null ? 'mut' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
      el('td', { class: 'r num mut', text: fmtAge(r.age_days) }),
      el('td', { class: 'r num', html: '<b>' + esc(fmtUsd(r.implied_value_usd)) + '</b>' }),
      el('td', { class: 'r num mut', text: fmtMult(r.multiple) }));
    tr.addEventListener('click', function () { location.hash = '#/detail/' + r.slug; });
    return tr;
  }

  function detailView(slug) {
    var r = BY_SLUG[slug];
    var wrap = el('div', { class: 'wrap' });
    if (!r) {
      wrap.appendChild(el('p', { text: 'No protocol with that slug on this board.' }));
      wrap.appendChild(el('a', { href: '#/board', text: '\u2190 Back to the board' }));
      return wrap;
    }
    var recomputed = impliedOf(r);
    var cat = MULTS.filter(function (m) { return m.category === (r.category || '(no category)'); })[0];
    var mult = cat || null;

    wrap.appendChild(el('a', { class: 'back', href: '#/board', text: '\u2190 Back to the board' }));
    var head = el('div', {},
      el('div', { class: 'detail-head' },
        el('h2', { text: '#' + r.rank + ' ' + r.name }),
        WATCH[r.slug] ? el('span', { class: 'badge wl', text: 'WATCHLIST' }) : null,
        el('span', { class: 'cat', text: r.category || 'No category' })),
      el('div', { class: 'chips' },
        el('span', { class: 'chip', html: 'TVL <b>' + esc(fmtUsd(r.tvl_usd)) + '</b>' }),
        el('span', { class: 'chip', html: '7d <b class="' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + esc(fmtPct(r.change_7d)) + '</b>' }),
        el('span', { class: 'chip', html: 'Age <b>' + esc(fmtAge(r.age_days)) + '</b>' }),
        el('span', { class: 'chip', html: 'Chains <b>' + esc((r.chains || []).join(', ') || 'n/a') + '</b>' }),
        el('span', { class: 'chip', html: 'Listed <b>' + esc(r.listed_at || 'unknown') + '</b>' })));
    wrap.appendChild(head);

    var modelCard = el('div', { class: 'card' },
      el('h3', { text: 'Implied value — how it is derived' }),
      el('dl', { class: 'kv' },
        el('dt', { text: 'TVL \u00d7 category multiple' }),
        el('dd', { text: fmtUsd(r.tvl_usd) + ' \u00d7 ' + fmtMult(r.multiple) }),
        el('dt', { text: 'Category multiple (' + (r.category || 'no category') + ', ' + r.multiple_n + ' comparables)' }),
        el('dd', { text: fmtMult(r.multiple) + (r.category_median !== null ? ' (median ' + fmtMult(r.category_median) + ')' : ' (market median)') }),
        el('dt', { text: 'Growth, 7d clamped to [' + MODEL.growth_floor + '%, ' + MODEL.growth_cap + '%]' }),
        el('dd', { text: fmtPct(r.change_7d) + ' \u2192 \u00d7' + r.growth_multiplier.toFixed(2) }),
        el('dt', { text: 'Maturity, ' + fmtAge(r.age_days) + ' since listing' }),
        el('dd', { text: '\u00d7' + r.maturity_multiplier.toFixed(2) }),
        el('dt', { text: 'Chain breadth, ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') }),
        el('dd', { text: '\u00d7' + r.breadth_multiplier.toFixed(2) }),
        el('dt', { text: 'Implied value' }),
        el('dd', { class: 'big', text: fmtUsdFull(r.implied_value_usd) }),
        el('dt', { class: 'note', text: 'Recomputed in this page from the same figures: ' + fmtUsdFull(recomputed) + '. The multiple comes from the listed protocols in this category, shown below — never from a list of names.' })));
    var compsCard = el('div', { class: 'card' },
      el('h3', { text: 'Listed comparables — ' + (r.category || 'no category') }),
      mult && mult.comps.length > 0
        ? el('table', { class: 'plain' },
          el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { class: 'r', text: 'Market cap' }), el('th', { class: 'r', text: 'TVL' }), el('th', { class: 'r', text: 'mcap / TVL' }))),
          el('tbody', {}, mult.comps.map(function (c) {
            return el('tr', {},
              el('td', { text: c.name }),
              el('td', { class: 'r num', text: fmtUsd(c.mcap_usd) }),
              el('td', { class: 'r num', text: fmtUsd(c.tvl_usd) }),
              el('td', { class: 'r num', text: fmtMult(c.ratio) }));
          })))
        : el('p', { class: 'model-note', text: 'Fewer than three listed protocols in this category, so the board uses the market-wide median multiple of ' + fmtMult(DATA.global_median) + ' instead of a category figure.' }));
    wrap.appendChild(el('div', { class: 'grid2' }, modelCard, compsCard));

    var farm = el('div', { class: 'card' },
      el('h3', { text: 'Farm plan — ' + r.name }),
      el('ol', { class: 'farm' }, farmStepsFor(r).map(function (s) {
        var parts = splitStep(s);
        return el('li', {}, document.createTextNode(parts.text + ' '),
          el('span', { class: 'cost', text: parts.cost }));
      })));
    wrap.appendChild(el('div', { style: 'margin-top:14px' }, farm));
    wrap.appendChild(footer());
    return wrap;
  }

  // board.json carries farm steps as single strings ("action Cost: … Time: …"). Split for display.
  function farmStepsFor(r) {
    return r.farm_steps || [];
  }
  function splitStep(s) {
    var m = s.match(/^(.*?) Cost: (.*?) Time: (.*?)\.?$/);
    if (!m) return { text: s, cost: '' };
    // The step's own sentence already ends in a full stop; drop it so the display does not print two.
    var cost = m[2].replace(/\.$/, '');
    return { text: m[1], cost: 'Cost: ' + cost + '. Time: ' + m[3] + '.' };
  }

  function liveView() {
    var wrap = el('div', { class: 'wrap' }, header(), statCards(), tabs('live'));
    wrap.appendChild(el('p', { class: 'model-note', text: 'Protocols whose token already trades, at the market\u2019s own values — never a model\u2019s. Their market-cap-to-TVL ratios are the comparables the board\u2019s multiples are built from.' }));
    var table = el('table', {},
      el('thead', {}, el('tr', {},
        el('th', { text: '#' }), el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
        el('th', { class: 'r', text: 'TVL' }), el('th', { class: 'r', text: 'Market cap' }),
        el('th', { class: 'r', text: '7d' }), el('th', { class: 'r', text: 'mcap / TVL' }))),
      el('tbody', {}, LIVE.map(function (p, i) {
        return el('tr', {},
          el('td', { class: 'rank num', text: String(i + 1) }),
          el('td', {}, el('span', { class: 'name', text: p.name }), el('div', { class: 'slug', text: p.slug })),
          el('td', { class: 'mut', text: p.category || '\u2014' }),
          el('td', { class: 'r num', text: fmtUsd(p.tvl_usd) }),
          el('td', { class: 'r num', text: fmtUsd(p.mcap_usd) }),
          el('td', { class: 'r num ' + (p.change_7d === null ? 'mut' : p.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(p.change_7d) }),
          el('td', { class: 'r num', text: fmtMult(p.ratio) }));
      })));
    wrap.appendChild(table);
    wrap.appendChild(footer());
    return wrap;
  }

  function methodView() {
    var wrap = el('div', { class: 'wrap' }, header(), statCards(), tabs('method'));
    var rows = MULTS.map(function (m) {
      return el('tr', {},
        el('td', { text: m.category }),
        el('td', { class: 'r num', text: String(m.n) }),
        el('td', { class: 'r num', text: m.median === null ? 'n/a' : fmtMult(m.median) }),
        el('td', { class: 'r num', text: fmtMult(m.multiple) }));
    });
    wrap.appendChild(el('div', { class: 'card' },
      el('h3', { text: 'The model — comparables, not a list of names' }),
      el('p', { class: 'model-note', text: 'A pre-token protocol is valued the way a market values its listed peers: take the category\u2019s median market-cap-to-TVL ratio among the snapshot\u2019s tokened protocols, apply it to this protocol\u2019s TVL, then adjust for its own 7-day growth, how long it has run with no token, and how many chains it runs on. No name is ever special-cased; the same function scores every row.' }),
      el('div', { class: 'formula', text:
        'multiple   = median(mcap / TVL) of the category\u2019s listed protocols\n' +
        '             (winsorised, shrunk toward the market median; < 3 comps \u2192 market median)\n' +
        'base       = tvl_usd \u00d7 multiple\n' +
        'growth     = clamp(change_7d, ' + MODEL.growth_floor + ', ' + MODEL.growth_cap + ')  \u2192  1 + growth/100 \u00d7 ' + MODEL.growth_weight + '\n' +
        'maturity   = ' + MODEL.maturity_floor + ' + min(age_days, ' + MODEL.maturity_days + ') / ' + MODEL.maturity_days + ' \u00d7 ' + MODEL.maturity_range + '\n' +
        'breadth    = 1 + min(chains - 1, ' + MODEL.breadth_max_chains + ') \u00d7 ' + MODEL.breadth_per_chain + '\n' +
        'implied    = max(1, round(base \u00d7 growth \u00d7 maturity \u00d7 breadth))' }),
      el('p', { class: 'model-note', text: 'Multiples are capped to [' + MODEL.multiple_floor + ', ' + MODEL.multiple_cap + '] so one thin category cannot set the board. Growth is clamped because a single week can print +4,000% on a small base. Age is counted from the protocol\u2019s listing date to the snapshot\u2019s date (' + esc(DATA.as_of) + '); unknown age counts as ' + MODEL.unknown_age_days + ' days.' })));
    wrap.appendChild(el('div', { style: 'height:14px' }));
    wrap.appendChild(el('div', { class: 'card' },
      el('h3', { text: 'Category multiples used on this board' }),
      el('table', { class: 'plain' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { class: 'r', text: 'Comparables' }), el('th', { class: 'r', text: 'Category median' }), el('th', { class: 'r', text: 'Multiple used' }))),
        el('tbody', {}, rows))));
    wrap.appendChild(el('div', { style: 'height:14px' }));
    wrap.appendChild(el('div', { class: 'card' },
      el('h3', { text: 'What counts, and what does not' }),
      el('p', { class: 'model-note', text: 'Pre-token means the snapshot records no token: no market cap, no CoinGecko id, no symbol. The board ranks the snapshot\u2019s whole watchlist (TVL at or above $' + (DATA.floor_usd / 1e6).toFixed(0) + 'M, no token) plus every pre-token protocol below the floor that could plausibly issue a token of its own. Wrapped, staked and bridged products of a token that already trades, versioned pools (a name ending in V2 or 2.0) and exchanges are left out: their token, in effect, already exists. A protocol the snapshot says has no token may still have one its DefiLlama record does not carry — the board says it records no token, never that it has none.' }),
      el('p', { class: 'model-note', text: 'Implied value is this entry\u2019s own claim, never make.fun\u2019s. It does not predict whether or when a token is issued. Farm steps are a plan to position for one, not financial advice.' })));
    wrap.appendChild(footer());
    return wrap;
  }

  function footer() {
    return el('footer', {},
      'Token Radar · model ' + esc(DATA.model_version) + ' · Snapshot ' + esc(DATA.as_of) + ' · Source: ' + esc(DATA.source) + ' · ',
      'Implied values are this entry\u2019s own claim. Farm at your own risk.');
  }

  function render() {
    var hash = location.hash || '#/board';
    var view;
    if (hash.indexOf('#/detail/') === 0) {
      view = detailView(decodeURIComponent(hash.slice(9)));
    } else if (hash.indexOf('#/filter/') === 0) {
      var cat = decodeURIComponent(hash.slice(9));
      state.category = cat;
      state.q = ''; state.chain = 'all'; state.wlOnly = false;
      view = boardView();
    } else if (hash === '#/live') {
      view = liveView();
    } else if (hash === '#/method') {
      view = methodView();
    } else {
      view = boardView();
    }
    app.textContent = '';
    app.appendChild(view);
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);
  render();
})();
