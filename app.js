// ============================================================
// StockPulse — Dairy Inventory Dashboard
// ============================================================

const CONFIG = {
  USE_AI_BRIEFING: false,    // true = Anthropic API  |  false = rule-based (free, instant)
  AI_DAILY_LIMIT: 3,         // per-browser daily cap (localStorage). Only used when USE_AI_BRIEFING: true
  ANTHROPIC_API_KEY: '',     // paste key here to bake it in, or leave blank for user-input field
};

// Single namespace for all app state to avoid polluting globals.
window.APP = {
  today: [],
  hist: [],
  computed: [],          // TODAY_DATA rows enriched with flag/priority/etc.
  reviewed: new Set(),   // batch_ids marked as reviewed
  activeSummaryFilter: null,   // 'RESTOCK' | 'CLEAR' | 'HOLD' | null
  activeTimelineFilter: null,  // 'expired' | 'urgent' | 'soon' | 'safe' | null
  activeFeedTab: 'ALL',
  charts: {},             // Chart.js instances, keyed by canvas id
  aggregates: {},          // pre-aggregated historical datasets
};

// ------------------------------------------------------------
// CSV PARSING
// ------------------------------------------------------------

// Parses raw CSV text into an array of objects keyed by header name.
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] !== undefined ? cells[idx] : '').trim();
    });
    rows.push(row);
  }
  return rows;
}

// Casts today_data.csv's numeric columns from strings to integers.
function castTodayData(rows) {
  const intCols = ['quantity_received', 'quantity_sold', 'quantity_in_stock', 'expected_stock',
    'stock_discrepancy', 'minimum_stock_threshold', 'reorder_quantity', 'days_until_expiration'];
  rows.forEach(r => {
    intCols.forEach(c => { r[c] = parseInt(r[c], 10); });
  });
  return rows;
}

// Casts historical_data.csv's numeric columns from strings to floats/ints.
function castHistData(rows) {
  const floatCols = ['quantity_received', 'expected_stock', 'stock_discrepancy',
    'minimum_stock_threshold', 'reorder_quantity'];
  const intCols = ['quantity_sold', 'quantity_in_stock', 'days_until_expiration'];
  rows.forEach(r => {
    floatCols.forEach(c => { r[c] = parseFloat(r[c]); });
    intCols.forEach(c => { r[c] = parseInt(r[c], 10); });
  });
  return rows;
}

// ------------------------------------------------------------
// DATA LOADING
// ------------------------------------------------------------

// Fetches both CSVs in parallel, parses them, and boots the app.
function loadData() {
  Promise.all([
    fetch('./today_data.csv').then(r => r.text()),
    fetch('./historical_data.csv').then(r => r.text()),
  ]).then(([todayText, histText]) => {
    window.TODAY_DATA = castTodayData(parseCSV(todayText));
    window.HIST_DATA = castHistData(parseCSV(histText));
    APP.today = window.TODAY_DATA;
    APP.hist = window.HIST_DATA;
    hideLoadingSpinner();
    initApp();
  }).catch(err => {
    hideLoadingSpinner();
    console.error('Failed to load inventory data', err);
  });
}

// Hides the centered loading spinner overlay.
function hideLoadingSpinner() {
  const el = document.getElementById('loading-spinner');
  if (el) el.style.display = 'none';
}

// ------------------------------------------------------------
// CALCULATIONS
// ------------------------------------------------------------

// Enriches each TODAY_DATA row with sales rate, days remaining, flag, and priority.
function computeToday() {
  APP.computed = APP.today.map(r => {
    const sales_rate = r.quantity_sold / 30;
    const days_remaining = sales_rate === 0 ? 999 : r.quantity_in_stock / sales_rate;
    const days_until_expiry = r.days_until_expiration;
    const units_expiring_unsold = r.quantity_in_stock - (sales_rate * Math.max(days_until_expiry, 0));
    const normal_cycle = sales_rate === 0 ? 999 : r.minimum_stock_threshold / sales_rate;

    let flag = null;
    if (days_remaining <= 5) {
      flag = 'RESTOCK';
    } else if (units_expiring_unsold > 0 && days_until_expiry <= 7) {
      flag = 'CLEAR';
    } else if (days_remaining > (2 * normal_cycle)) {
      flag = 'HOLD';
    }

    let priority;
    if (r.days_until_expiration < 0) {
      priority = r.quantity_in_stock * r.reorder_quantity * 1000;
    } else {
      priority = (r.quantity_in_stock * r.reorder_quantity) / Math.max(r.days_until_expiration, 1);
    }

    return Object.assign({}, r, {
      sales_rate, days_remaining, days_until_expiry, units_expiring_unsold,
      normal_cycle, flag, priority,
    });
  });
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------

// Runs all one-time setup after data has loaded: calculations, aggregation, landing render.
function initApp() {
  computeToday();
  aggregateHistorical();
  renderLandingStats();
  bindGlobalEvents();
}

// Wires up navigation and static event listeners that only need binding once.
function bindGlobalEvents() {
  document.getElementById('hero-cta').addEventListener('click', () => { showView('dashboard-view'); triggerDashboard(); });
  document.getElementById('bottom-cta').addEventListener('click', () => { showView('dashboard-view'); triggerDashboard(); });
  document.getElementById('back-to-landing').addEventListener('click', () => showView('landing-view'));
  document.getElementById('back-to-landing-2').addEventListener('click', () => showView('landing-view'));
  document.getElementById('tab-dashboard').addEventListener('click', () => showView('dashboard-view'));
  document.getElementById('tab-insights').addEventListener('click', () => { showView('insights-view'); renderInsights(); });
  document.getElementById('tab-dashboard-2').addEventListener('click', () => showView('dashboard-view'));
  document.getElementById('tab-insights-2').addEventListener('click', () => { showView('insights-view'); renderInsights(); });
  document.getElementById('back-to-dashboard').addEventListener('click', () => showView('dashboard-view'));
  document.getElementById('print-picklist').addEventListener('click', () => window.print());

  document.querySelectorAll('.summary-card').forEach(card => {
    card.addEventListener('click', () => toggleSummaryFilter(card.dataset.flag));
  });

  document.querySelectorAll('.feed-tab').forEach(tab => {
    tab.addEventListener('click', () => setFeedTab(tab.dataset.filter));
  });
}

// Shows the requested view and hides all others, with a fade transition.
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => {
    v.style.display = (v.id === viewId) ? '' : 'none';
  });
  const target = document.getElementById(viewId);
  target.classList.remove('view-fade-in');
  void target.offsetWidth;
  target.classList.add('view-fade-in');
}

// First-time setup when the dashboard is opened: render everything.
function triggerDashboard() {
  renderSummaryCards();
  renderTimeline();
  renderUrgentLots();
  renderFeed();
  renderReviewFooter();
  renderBriefing();
}

// ------------------------------------------------------------
// LANDING VIEW
// ------------------------------------------------------------

// Calculates and renders the 3 live stat cards on the landing page.
function renderLandingStats() {
  const expiring = APP.today.filter(r => r.days_until_expiration >= 0 && r.days_until_expiration <= 7).length;
  const belowThreshold = APP.today.filter(r => r.quantity_in_stock <= r.minimum_stock_threshold).length;
  const needsAction = APP.computed.filter(r => r.flag === 'RESTOCK' || r.flag === 'CLEAR').length;

  document.getElementById('stat-expiring').textContent = expiring;
  document.getElementById('stat-below-threshold').textContent = belowThreshold;
  document.getElementById('stat-needs-action').textContent = needsAction;
}

// ------------------------------------------------------------
// DASHBOARD — SUMMARY CARDS
// ------------------------------------------------------------

// Renders the 3 summary cards (Restock/Clear/Hold) with counts and subtext.
function renderSummaryCards() {
  const restock = APP.computed.filter(r => r.flag === 'RESTOCK');
  const clear = APP.computed.filter(r => r.flag === 'CLEAR');
  const hold = APP.computed.filter(r => r.flag === 'HOLD');
  const unflagged = APP.computed.filter(r => !r.flag);

  document.getElementById('count-restock').textContent = restock.length;
  document.getElementById('count-clear').textContent = clear.length;
  document.getElementById('count-hold').textContent = hold.length;

  const restockQty = restock.reduce((sum, r) => sum + r.reorder_quantity, 0);
  document.getElementById('subtext-restock').textContent = `Total reorder qty: ${restockQty}`;

  const avgDays = clear.length ? (clear.reduce((sum, r) => sum + r.days_until_expiry, 0) / clear.length) : 0;
  document.getElementById('subtext-clear').textContent = `Avg ${avgDays.toFixed(1)} days remaining`;

  document.getElementById('subtext-hold').textContent = `${unflagged.length} items need no action`;

  document.querySelectorAll('.summary-card').forEach(card => {
    card.classList.toggle('active', card.dataset.flag === APP.activeSummaryFilter);
  });
}

// Toggles the active summary card filter and re-renders the feed.
function toggleSummaryFilter(flag) {
  APP.activeSummaryFilter = (APP.activeSummaryFilter === flag) ? null : flag;
  APP.activeTimelineFilter = null;
  APP.activeFeedTab = 'ALL';
  document.querySelectorAll('.feed-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'ALL'));
  renderSummaryCards();
  renderTimeline();
  renderFeed();
}

// ------------------------------------------------------------
// DASHBOARD — EXPIRY TIMELINE
// ------------------------------------------------------------

// Renders the 4-segment expiry timeline bar sized proportionally to counts.
function renderTimeline() {
  const expired = APP.today.filter(r => r.days_until_expiration < 0);
  const urgent = APP.today.filter(r => r.days_until_expiration >= 0 && r.days_until_expiration <= 3);
  const soon = APP.today.filter(r => r.days_until_expiration >= 4 && r.days_until_expiration <= 7);
  const safe = APP.today.filter(r => r.days_until_expiration >= 8);
  const total = APP.today.length || 1;

  const segments = [
    { key: 'expired', label: 'Expired', count: expired.length, color: '#D85A30' },
    { key: 'urgent', label: 'Urgent 0–3d', count: urgent.length, color: '#E8593C' },
    { key: 'soon', label: 'Expiring Soon 4–7d', count: soon.length, color: '#BA7517' },
    { key: 'safe', label: 'Safe 8+d', count: safe.length, color: '#1D9E75' },
  ];

  const bar = document.getElementById('timeline-bar');
  bar.innerHTML = segments.map(seg => {
    const pct = (seg.count / total) * 100;
    const active = APP.activeTimelineFilter === seg.key ? 'active' : '';
    const wide = pct >= 12;
    return `<div class="timeline-segment ${active}" data-key="${seg.key}" style="width:${pct}%;background:${seg.color};">
      ${wide ? `<span class="segment-label-inline">${seg.count} · ${seg.label}</span>` : ''}
    </div>`;
  }).join('') + segments.filter(s => (s.count / total) * 100 < 12 && s.count > 0).map(s =>
    `<span class="segment-label-below" style="color:${s.color}">${s.count} ${s.label}</span>`
  ).join('');

  bar.querySelectorAll('.timeline-segment').forEach(seg => {
    seg.addEventListener('click', () => toggleTimelineFilter(seg.dataset.key));
  });
}

// Toggles the active timeline segment filter and re-renders the feed.
function toggleTimelineFilter(key) {
  APP.activeTimelineFilter = (APP.activeTimelineFilter === key) ? null : key;
  APP.activeSummaryFilter = null;
  APP.activeFeedTab = 'ALL';
  document.querySelectorAll('.feed-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'ALL'));
  renderTimeline();
  renderSummaryCards();
  renderFeed();
}

// ------------------------------------------------------------
// DASHBOARD — URGENT LOTS TABLE
// ------------------------------------------------------------

// Renders the urgent lots table (Restock + Clear items ranked by priority).
function renderUrgentLots() {
  const urgent = APP.computed.filter(r => r.flag === 'RESTOCK' || r.flag === 'CLEAR')
    .sort((a, b) => b.priority - a.priority);

  const section = document.getElementById('urgent-lots-section');
  if (urgent.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  const body = document.getElementById('urgent-table-body');
  body.innerHTML = urgent.map((r, i) => {
    const badgeClass = r.flag === 'RESTOCK' ? 'badge-red' : 'badge-amber';
    const action = r.flag === 'RESTOCK'
      ? `Order ${r.reorder_quantity} ${r.unit}`
      : `Move ${r.quantity_in_stock} ${r.unit}`;
    return `<tr class="urgent-row" data-product="${escapeHtml(r.product_name)}">
      <td>${i + 1}</td>
      <td class="product-link">${escapeHtml(r.product_name)}</td>
      <td>${escapeHtml(r.brand)}</td>
      <td>${escapeHtml(r.sales_channel)}</td>
      <td>${r.quantity_in_stock} ${escapeHtml(r.unit)}</td>
      <td>${r.days_until_expiration}d</td>
      <td><span class="badge ${badgeClass}">${r.flag}</span></td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.urgent-row').forEach(row => {
    row.addEventListener('click', () => openFefo(row.dataset.product));
  });
}

// ------------------------------------------------------------
// DASHBOARD — PRODUCT FEED
// ------------------------------------------------------------

// Sets the active feed tab filter and re-renders the feed.
function setFeedTab(filter) {
  APP.activeFeedTab = filter;
  APP.activeSummaryFilter = null;
  APP.activeTimelineFilter = null;
  document.querySelectorAll('.feed-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
  renderSummaryCards();
  renderTimeline();
  renderFeed();
}

// Applies all active filters (summary card, timeline segment, feed tab) to the computed rows.
function getFilteredRows() {
  let rows = APP.computed;

  if (APP.activeSummaryFilter) {
    rows = rows.filter(r => r.flag === APP.activeSummaryFilter);
  } else if (APP.activeFeedTab !== 'ALL') {
    rows = rows.filter(r => r.flag === APP.activeFeedTab);
  }

  if (APP.activeTimelineFilter) {
    rows = rows.filter(r => {
      const d = r.days_until_expiration;
      if (APP.activeTimelineFilter === 'expired') return d < 0;
      if (APP.activeTimelineFilter === 'urgent') return d >= 0 && d <= 3;
      if (APP.activeTimelineFilter === 'soon') return d >= 4 && d <= 7;
      if (APP.activeTimelineFilter === 'safe') return d >= 8;
      return true;
    });
  }

  return rows;
}

// Builds the reason text + key number for a single product card based on its flag.
function buildReason(r) {
  if (r.flag === 'RESTOCK') {
    return {
      text: `Runs out in ${Math.max(Math.round(r.days_remaining), 0)} days. Order ${r.reorder_quantity} ${r.unit}.`,
      keyNumber: r.reorder_quantity,
      colorClass: 'text-red',
    };
  }
  if (r.flag === 'CLEAR') {
    return {
      text: `${Math.max(Math.round(r.units_expiring_unsold), 0)} ${r.unit} expire in ${r.days_until_expiry} days before they sell.`,
      keyNumber: r.days_until_expiry,
      colorClass: 'text-amber',
    };
  }
  if (r.flag === 'HOLD') {
    return {
      text: `${Math.round(r.days_remaining)} days of stock. Skip reorder this cycle.`,
      keyNumber: Math.round(r.days_remaining),
      colorClass: 'text-green',
    };
  }
  return { text: 'No action needed right now.', keyNumber: '—', colorClass: 'text-muted' };
}

// Renders the filtered product feed as expandable cards with review checkboxes.
function renderFeed() {
  const rows = getFilteredRows();
  const list = document.getElementById('feed-list');

  list.innerHTML = rows.map(r => {
    const reason = buildReason(r);
    const badgeClass = r.flag === 'RESTOCK' ? 'badge-red' : r.flag === 'CLEAR' ? 'badge-amber' : r.flag === 'HOLD' ? 'badge-green' : 'badge-muted';
    const reviewed = APP.reviewed.has(r.batch_id);
    return `<div class="product-card ${reviewed ? 'reviewed' : ''}" data-batch="${r.batch_id}">
      <div class="card-top-row">
        <span class="card-product-name" data-product="${escapeHtml(r.product_name)}">${escapeHtml(r.product_name)} <span class="card-brand">— ${escapeHtml(r.brand)}</span></span>
        <span class="badge ${badgeClass}">${r.flag || 'NONE'}</span>
      </div>
      <div class="card-second-row">
        <span class="tag">${escapeHtml(r.unit)}</span>
        <span class="tag">${escapeHtml(r.packaging_type)}</span>
        <span class="tag">${escapeHtml(r.sales_channel)}</span>
      </div>
      <div class="card-main">
        <p class="card-reason">${reason.text}</p>
        <span class="card-key-number ${reason.colorClass}">${reason.keyNumber}</span>
      </div>
      <button class="details-toggle" data-batch="${r.batch_id}">View details</button>
      <div class="card-details" id="details-${r.batch_id}" style="display:none;">
        <div class="details-grid">
          <span class="detail-label">In stock</span><span>${r.quantity_in_stock}</span>
          <span class="detail-label">Min threshold</span><span>${r.minimum_stock_threshold}</span>
          <span class="detail-label">Days until expiration</span><span>${r.days_until_expiration}</span>
          <span class="detail-label">Expected stock</span><span>${r.expected_stock}</span>
          <span class="detail-label">Stock discrepancy</span><span>${r.stock_discrepancy}</span>
          <span class="detail-label">Reorder qty</span><span>${r.reorder_quantity}</span>
        </div>
      </div>
      <label class="review-checkbox">
        <input type="checkbox" data-batch="${r.batch_id}" ${reviewed ? 'checked' : ''}>
        Mark as reviewed
      </label>
    </div>`;
  }).join('');

  list.querySelectorAll('.card-product-name').forEach(el => {
    el.addEventListener('click', () => openFefo(el.dataset.product));
  });
  list.querySelectorAll('.details-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(`details-${btn.dataset.batch}`);
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });
  });
  list.querySelectorAll('.review-checkbox input').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) APP.reviewed.add(cb.dataset.batch);
      else APP.reviewed.delete(cb.dataset.batch);
      document.querySelector(`.product-card[data-batch="${cb.dataset.batch}"]`).classList.toggle('reviewed', cb.checked);
      renderReviewFooter();
    });
  });
}

// Renders the sticky "X of Y reviewed" footer, updating live as checkboxes change.
function renderReviewFooter() {
  const total = APP.computed.length;
  const reviewedCount = APP.reviewed.size;
  const footer = document.getElementById('review-footer');
  const text = document.getElementById('review-footer-text');
  if (total === 0) {
    footer.style.display = 'none';
    return;
  }
  footer.style.display = '';
  text.textContent = reviewedCount === total
    ? 'All items reviewed — see you tomorrow 🌅'
    : `${reviewedCount} of ${total} items reviewed`;
}

// Escapes HTML-sensitive characters to prevent injection when interpolating CSV values.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ------------------------------------------------------------
// AI BRIEFING
// ------------------------------------------------------------

// Entry point for the briefing panel: routes to AI or rule-based path per CONFIG.
function renderBriefing() {
  if (CONFIG.USE_AI_BRIEFING) {
    renderAiBriefing();
  } else {
    renderRuleBasedBriefing();
  }
}

// Builds and types out the rule-based morning briefing sentence.
function renderRuleBasedBriefing() {
  const text = buildRuleBasedBriefingText();
  typewrite(document.getElementById('briefing-body'), text);
}

// Constructs the rule-based briefing sentence from real TODAY_DATA values.
function buildRuleBasedBriefingText() {
  const expired = APP.today.filter(r => r.days_until_expiration < 0).length;
  const urgent = APP.today.filter(r => r.days_until_expiration >= 0 && r.days_until_expiration <= 3).length;
  const zeroStock = APP.today.filter(r => r.quantity_in_stock === 0);

  const clearItems = APP.computed.filter(f => f.flag === 'CLEAR')
    .sort((a, b) => a.days_until_expiration - b.days_until_expiration || b.quantity_in_stock - a.quantity_in_stock);
  const topClear = clearItems[0];

  const restockItems = APP.computed.filter(f => f.flag === 'RESTOCK')
    .sort((a, b) => (a.quantity_in_stock / a.minimum_stock_threshold) - (b.quantity_in_stock / b.minimum_stock_threshold));
  const topRestock = restockItems[0];

  let text = `Good morning. Today's inventory has ${expired + urgent} items needing immediate attention — ` +
    `${expired} expired batch${expired === 1 ? '' : 'es'} to remove and ${urgent} expiring within 3 days. `;

  if (topClear) {
    text += `Your top priority is ${topClear.product_name} (${topClear.brand}, ${topClear.quantity_in_stock} ${topClear.unit}) ` +
      `expiring in ${topClear.days_until_expiration} day(s) — move or discount this stock now. `;
  }

  if (zeroStock.length > 0) {
    text += `${zeroStock[0].product_name} (${zeroStock[0].brand}) is completely out of stock against a threshold of ${zeroStock[0].minimum_stock_threshold}. `;
  } else if (topRestock) {
    text += `${topRestock.product_name} (${topRestock.brand}) is at ${topRestock.quantity_in_stock} ${topRestock.unit} against a threshold of ` +
      `${topRestock.minimum_stock_threshold} — reorder ${topRestock.reorder_quantity}. `;
  }

  text += 'Focus on the Clear items first before placing any restock orders.';
  return text;
}

// Types text into a target element one character at a time.
function typewrite(el, text) {
  el.textContent = '';
  let i = 0;
  const interval = setInterval(() => {
    el.textContent += text[i];
    i++;
    if (i >= text.length) clearInterval(interval);
  }, 18);
}

// Reads/updates the localStorage AI usage counter, resetting on a new day.
function getAiUsage() {
  const today = new Date().toISOString().slice(0, 10);
  let usage;
  try {
    usage = JSON.parse(localStorage.getItem('sp_ai_usage'));
  } catch (e) {
    usage = null;
  }
  if (!usage || usage.date !== today) {
    usage = { count: 0, date: today };
  }
  return usage;
}

// Increments and persists the AI usage counter for today.
function incrementAiUsage() {
  const usage = getAiUsage();
  usage.count += 1;
  localStorage.setItem('sp_ai_usage', JSON.stringify(usage));
}

// Entry point for the AI-backed briefing path, including daily limit and key handling.
function renderAiBriefing() {
  const usage = getAiUsage();
  if (usage.count >= CONFIG.AI_DAILY_LIMIT) {
    renderRuleBasedBriefing();
    return;
  }

  const apiKey = CONFIG.ANTHROPIC_API_KEY || sessionStorage.getItem('sp_api_key');
  if (!apiKey) {
    renderApiKeyPrompt();
    return;
  }

  requestAiBriefing(apiKey);
}

// Shows an inline API key input inside the briefing card.
function renderApiKeyPrompt() {
  const body = document.getElementById('briefing-body');
  body.innerHTML = `
    <div class="api-key-prompt">
      <input type="password" id="api-key-input" placeholder="Paste Anthropic API key" class="api-key-input">
      <button class="btn-primary btn-small" id="api-key-submit">Enable AI</button>
    </div>`;
  document.getElementById('api-key-submit').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return;
    sessionStorage.setItem('sp_api_key', key);
    requestAiBriefing(key);
  });
}

// Animates "Generating briefing..." dots while the API call is in flight.
function renderGeneratingPlaceholder() {
  const body = document.getElementById('briefing-body');
  let dots = 0;
  body.textContent = 'Generating briefing';
  const interval = setInterval(() => {
    dots = (dots + 1) % 4;
    body.textContent = 'Generating briefing' + '.'.repeat(dots);
  }, 400);
  return interval;
}

// Builds the top-5 priority item summary used in the AI prompt.
function buildTopItemsForPrompt() {
  return [...APP.computed]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);
}

// Sends the inventory summary to the Anthropic API and renders the response.
function requestAiBriefing(apiKey) {
  const placeholderInterval = renderGeneratingPlaceholder();

  const expired = APP.today.filter(r => r.days_until_expiration < 0).length;
  const urgent = APP.today.filter(r => r.days_until_expiration >= 0 && r.days_until_expiration <= 3).length;
  const expiringSoon = APP.today.filter(r => r.days_until_expiration >= 4 && r.days_until_expiration <= 7).length;
  const belowThreshold = APP.today.filter(r => r.quantity_in_stock <= r.minimum_stock_threshold).length;
  const topItems = buildTopItemsForPrompt();

  const prompt = `You are an assistant for a dairy inventory coordinator.
Today is ${new Date().toDateString()}.
Current inventory summary:
- ${expired} expired batches (remove immediately)
- ${urgent} expiring in 0–3 days (urgent action needed)
- ${expiringSoon} expiring in 4–7 days (plan to move)
- ${belowThreshold} products below minimum stock threshold
Top 5 items by priority: ${topItems.map(i => `${i.product_name} ${i.brand} (${i.quantity_in_stock} ${i.unit}, expires in ${i.days_until_expiration} days)`).join('; ')}

Write a 3–4 sentence plain-English morning briefing for the coordinator.
Be specific about product names and quantities.
Tell them what to focus on first and why.
Do not use bullet points. Do not use markdown.`;

  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
    .then(res => {
      if (!res.ok) throw new Error('AI request failed');
      return res.json();
    })
    .then(data => {
      clearInterval(placeholderInterval);
      const text = data.content[0].text;
      incrementAiUsage();
      typewrite(document.getElementById('briefing-body'), text);
    })
    .catch(() => {
      clearInterval(placeholderInterval);
      renderRuleBasedBriefing();
    });
}

// ------------------------------------------------------------
// INSIGHTS VIEW — HISTORICAL AGGREGATION
// ------------------------------------------------------------

// Pre-aggregates HIST_DATA into monthly sales, brand sales, channel sales, and spoilage datasets.
function aggregateHistorical() {
  const monthlyMap = new Map();
  const brandMap = new Map();
  const channelMap = new Map();
  const spoilageMap = new Map();

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  APP.hist.forEach(r => {
    const date = new Date(r.inventory_date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    if (!monthlyMap.has(key)) monthlyMap.set(key, { label, value: 0 });
    monthlyMap.get(key).value += r.quantity_sold;

    brandMap.set(r.brand, (brandMap.get(r.brand) || 0) + r.quantity_sold);
    channelMap.set(r.sales_channel, (channelMap.get(r.sales_channel) || 0) + r.quantity_sold);

    if (r.expiration_status === 'Expired') {
      spoilageMap.set(r.product_name, (spoilageMap.get(r.product_name) || 0) + r.quantity_in_stock);
    }
  });

  const monthlySales = [...monthlyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  const brandSales = [...brandMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const channelSales = [...channelMap.entries()].map(([label, value]) => ({ label, value }));
  const spoilage = [...spoilageMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  APP.aggregates = { monthlySales, brandSales, channelSales, spoilage };
}

// Draws the numeric value at the end of each bar (used on the horizontal brand chart).
const barEndLabelPlugin = {
  id: 'barEndLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "600 12px 'Inter', sans-serif";
    ctx.fillStyle = '#5F5E5A';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((bar, i) => {
        const value = dataset.data[i];
        ctx.textAlign = 'left';
        ctx.fillText(value.toLocaleString(), bar.x + 6, bar.y);
      });
    });
    ctx.restore();
  },
};

// Renders (or re-renders) all 4 insights charts using Chart.js.
function renderInsights() {
  Object.values(APP.charts).forEach(chart => chart.destroy());
  APP.charts = {};

  const fontFamily = 'Inter';

  APP.charts.monthly = new Chart(document.getElementById('chart-monthly'), {
    type: 'line',
    data: {
      labels: APP.aggregates.monthlySales.map(d => d.label),
      datasets: [{
        data: APP.aggregates.monthlySales.map(d => d.value),
        borderColor: '#7F77DD',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6,
      }],
    },
    options: chartOptions(fontFamily, false),
  });

  const brandColors = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517', '#E24B4A', '#534AB7', '#0F6E56', '#993C1D'];
  APP.charts.brand = new Chart(document.getElementById('chart-brand'), {
    type: 'bar',
    data: {
      labels: APP.aggregates.brandSales.map(d => d.label),
      datasets: [{
        data: APP.aggregates.brandSales.map(d => d.value),
        backgroundColor: APP.aggregates.brandSales.map((_, i) => brandColors[i % brandColors.length]),
      }],
    },
    options: Object.assign(chartOptions(fontFamily, false), { indexAxis: 'y' }),
    plugins: [barEndLabelPlugin],
  });

  const channelTotal = APP.aggregates.channelSales.reduce((s, d) => s + d.value, 0);
  APP.charts.channel = new Chart(document.getElementById('chart-channel'), {
    type: 'doughnut',
    data: {
      labels: APP.aggregates.channelSales.map(d => d.label),
      datasets: [{
        data: APP.aggregates.channelSales.map(d => d.value),
        backgroundColor: APP.aggregates.channelSales.map(d => (
          d.label === 'Retail' ? '#7F77DD' : d.label === 'Wholesale' ? '#1D9E75' : '#BA7517'
        )),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { family: fontFamily },
            generateLabels: (chart) => chart.data.labels.map((label, i) => {
              const value = chart.data.datasets[0].data[i];
              const pct = channelTotal ? Math.round((value / channelTotal) * 100) : 0;
              return {
                text: `${label} (${pct}%)`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                index: i,
              };
            }),
          },
        },
      },
    },
  });

  APP.charts.spoilage = new Chart(document.getElementById('chart-spoilage'), {
    type: 'bar',
    data: {
      labels: APP.aggregates.spoilage.map(d => d.label),
      datasets: [{
        data: APP.aggregates.spoilage.map(d => d.value),
        backgroundColor: '#D85A30',
      }],
    },
    options: chartOptions(fontFamily, false),
  });
}

// Returns shared Chart.js options (fonts, grid lines, responsiveness).
function chartOptions(fontFamily) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: fontFamily } },
      },
      y: {
        grid: { color: '#EDEBE4' },
        ticks: { font: { family: fontFamily } },
      },
    },
  };
}

// ------------------------------------------------------------
// FEFO VIEW
// ------------------------------------------------------------

// Opens the FEFO matrix view for a given product name.
function openFefo(productName) {
  const lots = APP.today.filter(r => r.product_name === productName)
    .sort((a, b) => new Date(a.expiration_date) - new Date(b.expiration_date));

  document.getElementById('fefo-title').textContent = `${productName} — FEFO Matrix`;

  const totalQty = lots.reduce((sum, r) => sum + r.quantity_in_stock, 0);
  const unit = lots[0] ? lots[0].unit : '';
  document.getElementById('fefo-summary').textContent = `${lots.length} lots · ${totalQty} ${unit} total in stock`;

  renderShelfBar(lots, totalQty);
  renderLotTable(lots);

  showView('fefo-view');
}

// Renders the shelf-life segmented bar (red/amber/green by expiry zone).
function renderShelfBar(lots, totalQty) {
  const red = lots.filter(r => r.days_until_expiration <= 2);
  const amber = lots.filter(r => r.days_until_expiration >= 3 && r.days_until_expiration <= 7);
  const green = lots.filter(r => r.days_until_expiration >= 8);

  const zones = [
    { qty: red.reduce((s, r) => s + r.quantity_in_stock, 0), color: '#D85A30' },
    { qty: amber.reduce((s, r) => s + r.quantity_in_stock, 0), color: '#BA7517' },
    { qty: green.reduce((s, r) => s + r.quantity_in_stock, 0), color: '#1D9E75' },
  ];

  const bar = document.getElementById('shelf-bar');
  bar.innerHTML = zones.filter(z => z.qty > 0).map(z => {
    const pct = totalQty ? (z.qty / totalQty) * 100 : 0;
    return `<div class="shelf-segment" style="width:${pct}%;background:${z.color};">${z.qty} (${pct.toFixed(0)}%)</div>`;
  }).join('');
}

// Renders the FEFO lot table sorted by expiration date ascending.
function renderLotTable(lots) {
  const body = document.getElementById('lot-table-body');
  body.innerHTML = lots.map(r => {
    const d = r.days_until_expiration;
    let status, badgeClass, rowClass = '';
    if (d < 0) { status = 'Expired'; badgeClass = 'badge-red'; rowClass = 'row-expired'; }
    else if (d <= 3) { status = 'Urgent'; badgeClass = 'badge-orange'; }
    else if (d <= 7) { status = 'Expiring Soon'; badgeClass = 'badge-amber'; }
    else { status = 'Safe'; badgeClass = 'badge-green'; }

    return `<tr class="${rowClass}">
      <td>${escapeHtml(r.batch_id)}</td>
      <td>${escapeHtml(r.brand)}</td>
      <td>${escapeHtml(r.production_date)}</td>
      <td>${escapeHtml(r.expiration_date)}</td>
      <td>${r.quantity_in_stock} ${escapeHtml(r.unit)}</td>
      <td>${d}</td>
      <td><span class="badge ${badgeClass}">${status}</span></td>
    </tr>`;
  }).join('');
}

// ------------------------------------------------------------
// BOOTSTRAP
// ------------------------------------------------------------

loadData();
