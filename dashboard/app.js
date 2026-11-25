// Token Radar dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail sheet with the model's own inputs and the protocol's
// farm plan. No network: every byte it shows lives in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // Recompute a row from the snapshot figures and check it against the
  // number board.json carries, so the page and the board visibly agree.
  function impliedOf(row, model) {
    var g = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var damp = Math.min(1, Math.max(model.growth_damp_floor, Math.sqrt(row.tvl_usd / model.growth_damp_tvl)));
    var mult = 1 + (g / 100) * model.growth_weight * damp;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var mat = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * mult * mat));
  }

  function node(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) el.appendChild(c); });
      else if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else el.appendChild(child);
    }
    return el;
  }

  // The farm plan is the same derivation main.ts writes into board.json:
  // category, chains, TVL, age and the snapshot date decide the action,
  // the capital, the hold and every cost and time. No name is special-cased.
  var CHEAP = ['Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche', 'Sui', 'Aptos', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mode', 'Zora', 'Ethereum', 'Bitcoin', 'Hyperliquid L1'];
  function cheapChain(p) {
    if (!p.chains || p.chains.length === 0) return 'its main chain';
    for (var i = 0; i < CHEAP.length; i++) if (p.chains.indexOf(CHEAP[i]) >= 0) return CHEAP[i];
    return p.chains[0];
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  var ACTION_RULES = [
    { has: ['curator', 'allocator', 'yield aggregator', 'vault'], say: function (n, c, ch) { return 'Deposit $' + c + ' into a ' + n + ' vault on ' + ch + ' and keep the shares.'; } },
    { has: ['lend', 'cdp', 'collateral'], say: function (n, c, ch) { return 'Supply $' + c + ' of USDC to ' + n + ' on ' + ch + ' and keep the position open.'; } },
    { has: ['dex', 'leveraged farm', 'liquidity manager'], say: function (n, c, ch) { return 'Provide $' + c + ' of liquidity to ' + n + "'s main pool on " + ch + ' and keep the position open.'; } },
    { has: ['yield', 'farm'], say: function (n, c, ch) { return 'Deposit $' + c + " into " + n + "'s highest-yield pool on " + ch + ' and keep the position open.'; } },
    { has: ['bridge', 'canonical bridge'], say: function (n, c, ch) { return 'Bridge $' + c + ' of USDC to ' + ch + ' through ' + n + ' and use the bridged funds in its app.'; } },
    { has: ['staking', 'restak'], say: function (n, c, ch) { return "Stake $" + c + " of the chain's staking asset through " + n + ' and keep the receipt.'; } },
    { has: ['perpetual', 'derivative', 'basis trading', 'options'], say: function (n, c, ch) { return 'Deposit $' + c + ' of USDC as margin on ' + n + ' and open one small position.'; } },
    { has: ['prediction'], say: function (n, c, ch) { return 'Fund $' + c + ' and place one market position on ' + n + '.'; } },
    { has: ['launchpad'], say: function (n, c, ch) { return 'Join the next ' + n + ' launch with $' + c + ' of USDC and hold the allocation.'; } },
    { has: ['index'], say: function (n, c, ch) { return 'Buy $' + c + ' of the ' + n + ' index on ' + ch + ' and hold it.'; } },
    { has: ['oracle'], say: function (n, c, ch) { return 'Deposit $' + c + ' as stake to run a ' + n + ' oracle feed on ' + ch + '.'; } },
    { has: ['privacy'], say: function (n, c, ch) { return 'Deposit $' + c + ' into a ' + n + ' privacy pool on ' + ch + ' and keep the receipt.'; } },
    { has: ['gaming', 'gamefi'], say: function (n, c, ch) { return 'Buy $' + c + ' of in-game assets on ' + n + ' and play one session a week.'; } },
    { has: ['social'], say: function (n, c, ch) { return 'Create a profile on ' + n + ', post once a week and hold $' + c + ' of its asset.'; } },
    { has: ['stable'], say: function (n, c, ch) { return 'Mint or deposit $' + c + ' of the stable asset through ' + n + ' on ' + ch + '.'; } },
    { has: ['rwa'], say: function (n, c, ch) { return "Mint $" + c + " of the protocol's yield asset on " + ch + ' and hold it.'; } },
    { has: ['insurance'], say: function (n, c, ch) { return 'Buy $' + c + ' of cover from ' + n + ' on ' + ch + ' and keep the policy.'; } },
    { has: ['btc', 'anchor'], say: function (n, c, ch) { return 'Bridge $' + c + ' of BTC through ' + n + ' and hold the receipt on ' + ch + '.'; } },
    { has: ['chain'], say: function (n, c, ch) { return 'Bridge $' + c + ' of USDC to ' + n + ' and use its apps once a week.'; } }
  ];
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTION_RULES.length; i++) {
      var rule = ACTION_RULES[i];
      for (var j = 0; j < rule.has.length; j++) {
        if (c.indexOf(rule.has[j]) >= 0) return rule.say(p.name, capital, chain);
      }
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  function oneStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = cheapChain(p);
    var capital = capitalFor(p);
    var hold = holdFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week on ' + chain + ', such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "As of the " + DATA.as_of + " snapshot, watch " + p.name + "'s own site and channels for a points page or a token announcement, and claim only from links it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(oneStep);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && (!r.chains || r.chains.indexOf(view.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function ordered(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function mast() {
    return node('header', { class: 'mast' },
      node('div', { class: 'wordmark' }, node('span', { class: 'dot' }), node('span', { class: 'wordmark-name', text: 'Token Radar' })),
      node('div', { class: 'mast-meta' },
        node('span', { text: 'Snapshot ' + DATA.as_of }),
        node('span', { text: 'DefiLlama protocol index' }),
        node('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function intro() {
    return node('section', { class: 'intro' },
      node('div', null,
        node('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        node('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols below that floor — the whole field, not a capped slice. Implied value is a model, not a promise.' })
      ),
      node('div', { class: 'kpis' },
        node('div', { class: 'kpi' }, node('span', { text: 'Watchlist covered' }), node('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        node('div', { class: 'kpi' }, node('span', { text: 'Pre-token rows scored' }), node('b', { text: String(DATA.board_size) })),
        node('div', { class: 'kpi' }, node('span', { text: 'Early rows below the floor' }), node('b', { text: String(DATA.early_size) })),
        node('div', { class: 'kpi' }, node('span', { text: 'Live-token protocols set aside' }), node('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function top10() {
    var top = DATA.rows.slice(0, 10);
    return node('section', { class: 'top10' },
      node('h2', { text: 'Top 10 by implied value' }),
      top.map(function (r) {
        return node('button', { type: 'button', class: 'pick', onclick: function () { openDetail(r.slug); } },
          node('span', { class: 'tag', text: '#' + r.rank + ' · ' + (r.category || 'Other') }),
          node('b', { text: r.name }),
          node('span', { class: 'val', text: usd(r.implied_value_usd) })
        );
      })
    );
  }

  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = node('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); paint(); });
    var catSel = node('select', { id: 'category', 'aria-label': 'Filter by category' },
      node('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return node('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { view.category = catSel.value; writeHash(); paint(); });
    var chainSel = node('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      node('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return node('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { view.chain = chainSel.value; writeHash(); paint(); });
    var pre = node('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; paint(); } });
    var live = node('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; paint(); } });
    var movers = node('button', { type: 'button', class: 'mover', 'aria-pressed': view.sort === 'growth' ? 'true' : 'false', text: 'Biggest 7d movers', onclick: function () { view.sort = 'growth'; view.dir = -1; paint(); } });
    return node('div', { class: 'bar' },
      node('div', { class: 'field' }, node('label', { for: 'q', text: 'Search' }), search),
      node('div', { class: 'field' }, node('label', { for: 'category', text: 'Category' }), catSel),
      node('div', { class: 'field' }, node('label', { for: 'chain', text: 'Chain' }), chainSel),
      node('div', { class: 'field' }, node('span', { class: 'note', text: 'Token status' }), node('div', { class: 'seg' }, pre, live)),
      movers,
      node('span', { class: 'showing', text: view.tab === 'pre-token' ? filtered().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHead(key, label) {
    return node('th', { scope: 'col' },
      node('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); } },
        label,
        view.sort === key ? node('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = ordered(filtered());
    if (list.length === 0) {
      return node('div', { class: 'card' }, node('div', { class: 'none' },
        node('h2', { text: 'No protocol matches that filter' }),
        node('p', { text: 'Clear the search or pick another category to see the board again.' }),
        node('button', { class: 'btn hot', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; writeHash(); paint(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var body = node('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var gcls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var tr = node('tr', {
        'data-active': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        node('td', { class: 'fig', text: String(r.rank) }),
        node('td', null, node('div', { class: 'who' },
          node('b', { text: r.name }),
          node('span', { class: 'note', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        node('td', { class: 'fig', text: usd(r.tvl_usd) }),
        node('td', { class: 'fig ' + gcls, text: growth }),
        node('td', { class: 'fig', text: ageLabel(r.age_days) }),
        node('td', null, node('div', { class: 'value-cell' },
          node('div', { class: 'gauge', 'aria-hidden': 'true' }, node('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          node('span', { class: 'fig', text: usd(r.implied_value_usd) })
        )),
        node('td', null, node('span', { class: 'badge', text: 'no token' }))
      );
      body.appendChild(tr);
    });
    return node('div', { class: 'card' },
      node('div', { class: 'scroll' },
        node('table', null,
          node('caption', { class: 'note', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          node('thead', null, node('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('implied', 'Implied value'),
            node('th', { scope: 'col', text: 'Token' })
          )),
          body
        )
      )
    );
  }

  function liveTable() {
    var body = node('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(node('tr', null,
        node('td', { class: 'fig', text: 'live' }),
        node('td', null, node('div', { class: 'who' }, node('b', { text: r.name }), node('span', { class: 'note', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        node('td', { class: 'fig', text: usd(r.tvl_usd) }),
        node('td', { class: 'fig ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }),
        node('td', { class: 'fig', text: usd(r.mcap_usd) }),
        node('td', null, node('span', { class: 'badge', text: 'already trades' }))
      ));
    });
    return node('div', { class: 'card' },
      node('div', { class: 'scroll' },
        node('table', null,
          node('caption', { class: 'note', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Status' }), node('th', { scope: 'col', text: 'Protocol' }), node('th', { scope: 'col', text: 'TVL' }), node('th', { scope: 'col', text: '7d' }), node('th', { scope: 'col', text: 'Market cap' }), node('th', { scope: 'col', text: 'Token' }))),
          body
        )
      )
    );
  }

  function howPanel() {
    var m = DATA.model;
    var top = DATA.rows[0];
    var worked = '';
    if (top) {
      var g = Math.min(m.growth_cap, Math.max(m.growth_floor, top.change_7d === null ? 0 : top.change_7d));
      var damp = Math.min(1, Math.max(m.growth_damp_floor, Math.sqrt(top.tvl_usd / m.growth_damp_tvl)));
      var mult = 1 + (g / 100) * m.growth_weight * damp;
      var age = top.age_days === null ? m.unknown_age_days : top.age_days;
      var mat = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
      worked = 'Worked example — rank #1 ' + top.name + ': ' + usd(top.tvl_usd) + ' TVL x ' + m.base_multiple + ' = ' + usd(Math.round(top.tvl_usd * m.base_multiple)) + '; growth ' + pct(top.change_7d) + ' clamped to ' + g + '% x damp ' + damp.toFixed(2) + ' gives x' + mult.toFixed(2) + '; age ' + ageLabel(top.age_days) + ' gives maturity x' + mat.toFixed(2) + '; implied ' + usd(top.implied_value_usd) + '.';
    }
    return node('section', { class: 'card howto' },
      node('h2', { text: 'How implied value is computed' }),
      node('p', { class: 'note', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      node('div', { class: 'math' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ' x damp) x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      node('p', { class: 'note', text: 'The base multiple ' + m.base_multiple + ' is not a guess: it is the median market-cap/TVL of the ' + DATA.live_for_multiple + ' live-token protocols in this same snapshot — how the market itself prices a launched token. Growth is damped on small TVL (damp = clamp(sqrt(tvl / $100M), 0.25, 1)), because a big weekly move on a tiny protocol is noise. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days, and the five-year maturity horizon pays long no-token runs up to 1.2x.' }),
      worked ? node('div', { class: 'example', text: worked }) : null
    );
  }

  var sheet = node('dialog', { class: 'sheet', id: 'detail', 'aria-labelledby': 'detail-title' });
  sheet.addEventListener('close', function () { view.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeHash();
    sheet.textContent = '';
    var steps = farmSteps(row);
    sheet.appendChild(node('div', { class: 'sheet-top' },
      node('div', null,
        node('span', { class: 'wordmark-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        node('h2', { id: 'detail-title', text: row.name }),
        node('p', { class: 'note', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      node('button', { class: 'shut', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { sheet.close(); } })
    ));
    sheet.appendChild(node('section', { class: 'sheet-block' },
      node('h3', { text: 'Implied value' }),
      node('div', { class: 'math-grid' },
        node('div', null, node('span', { text: 'TVL' }), node('b', { class: 'fig', text: usd(row.tvl_usd) })),
        node('div', null, node('span', { text: 'Seven-day growth' }), node('b', { class: 'fig', text: pct(row.change_7d) })),
        node('div', null, node('span', { text: 'Growth damp (small TVL)' }), node('b', { class: 'fig', text: String(row.growth_damp) })),
        node('div', null, node('span', { text: 'Age with no token' }), node('b', { class: 'fig', text: ageLabel(row.age_days) })),
        node('div', null, node('span', { text: 'Growth multiplier' }), node('b', { class: 'fig', text: String(row.growth_multiplier) })),
        node('div', null, node('span', { text: 'Maturity multiplier' }), node('b', { class: 'fig', text: String(row.maturity_multiplier) })),
        node('div', null, node('span', { text: 'Implied value' }), node('b', { class: 'fig', text: usd(row.implied_value_usd) }))
      ),
      node('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + usd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    sheet.appendChild(node('section', { class: 'sheet-block' },
      node('h3', { text: 'Farm plan' }),
      node('ol', { class: 'plan' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return node('li', null, node('b', { text: action }), node('span', { class: 'price', text: tail }));
      }))
    ));
    if (typeof sheet.showModal === 'function') {
      if (!sheet.open) sheet.showModal();
    } else {
      sheet.setAttribute('open', '');
    }
  }

  function paint() {
    mount.textContent = '';
    var shell = node('div', { class: 'wrap' });
    shell.appendChild(mast());
    shell.appendChild(intro());
    if (view.tab === 'pre-token') shell.appendChild(top10());
    shell.appendChild(controls());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    if (view.tab === 'pre-token') shell.appendChild(howPanel());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!sheet.isConnected) mount.appendChild(sheet);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheet.open) sheet.close();
  });
})();
