const REQUIRED_COLUMNS = [
  'product_name',
  'category',
  'quantity_on_hand',
  'reorder_threshold',
  'reorder_quantity',
  'expiration_date',
  'sales_rate',
];

const RESTOCK_DAYS_THRESHOLD = 5;
const CLEAR_DAYS_THRESHOLD = 7;
const FEFO_RED_MAX_DAYS = 2;
const FEFO_YELLOW_MAX_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MIN_LOADING_MS = 1000;
const VIEW_TRANSITION_MS = 300;

const SECTION_DESCRIPTIONS = {
  RESTOCK: "Running low on stock — order more before it runs out.",
  CLEAR: "Won't sell through before it expires — move or discount it now.",
  HOLD: "Well stocked for the cycle ahead — skip reordering for now.",
};

const SAMPLE_CSV = `product_name,category,quantity_on_hand,reorder_threshold,reorder_quantity,expiration_date,sales_rate,lot_number,storage_bin
Whole Milk 1L,Milk,40,50,100,2026-07-25,8,LOT-2026-A01,BIN-A1
Greek Yogurt 500g,Yogurt,15,20,60,2026-07-28,3,LOT-2026-A02,BIN-A2
Heavy Cream 500ml,Cream,45,20,50,2026-07-26,1,LOT-2026-A03,BIN-A3
Skim Milk 1L,Milk,80,50,100,2026-08-17,5,LOT-2026-B01,BIN-B1
Skim Milk 1L,Milk,40,50,100,2026-07-28,5,LOT-2026-B02,BIN-B2
Salted Butter 250g,Butter,55,10,30,2026-09-05,3,LOT-2026-A04,BIN-A4
Cheddar Cheese 500g,Cheese,10,15,40,2026-08-20,2,LOT-2026-A05,BIN-A5
Mozzarella 250g,Cheese,90,20,50,2026-08-18,3,LOT-2026-A06,BIN-A6
Whipping Cream 250ml,Cream,80,25,60,2026-08-05,6,LOT-2026-A07,BIN-A7
Unsalted Butter 250g,Butter,8,10,30,2026-09-01,2,LOT-2026-A08,BIN-A8
Strawberry Yogurt 200g,Yogurt,200,30,80,2026-08-15,4,LOT-2026-A09,BIN-A9
`;

class AppError extends Error {}

const uploadView = document.getElementById('upload-view');
const resultsView = document.getElementById('results-view');

const dropzone = document.getElementById('dropzone');
const dropzoneIdle = document.getElementById('dropzone-idle');
const dropzoneLoading = document.getElementById('dropzone-loading');
const fileInput = document.getElementById('file-input');
const filenameEl = document.getElementById('filename');
const errorMessageEl = document.getElementById('error-message');
const submitBtn = document.getElementById('submit-btn');
const uploadForm = document.getElementById('upload-form');
const downloadSampleBtn = document.getElementById('download-sample-btn');

const newUploadBtn = document.getElementById('new-upload-btn');
const resultsCount = document.getElementById('results-count');
const resultsMeta = document.getElementById('results-meta');
const resultsFeed = document.getElementById('results-feed');
const summaryCardsEl = document.getElementById('summary-cards');
const emptyState = document.getElementById('empty-state');
const resultsFooter = document.getElementById('results-footer');

const productView = document.getElementById('product-view');
const productViewName = document.getElementById('product-view-name');
const productViewMeta = document.getElementById('product-view-meta');
const fefoBar = document.getElementById('fefo-bar');
const fefoBarLegend = document.getElementById('fefo-bar-legend');
const lotTableWrap = document.getElementById('lot-table-wrap');
const backToResultsBtn = document.getElementById('back-to-results-btn');

let reviewedCount = 0;
let totalFlaggedCount = 0;
let currentCatalog = {};

/* File selection */

function setSelectedFile(file) {
  clearError();
  filenameEl.textContent = file.name;
  submitBtn.disabled = false;
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) setSelectedFile(file);
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  fileInput.files = event.dataTransfer.files;
  setSelectedFile(file);
});

/* Errors */

function showError(message) {
  errorMessageEl.textContent = message;
  errorMessageEl.hidden = false;
}

function clearError() {
  errorMessageEl.textContent = '';
  errorMessageEl.hidden = true;
}

/* CSV parsing */

function isCSVFile(file) {
  return file.name.toLowerCase().endsWith('.csv');
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new AppError("Couldn't read this file."));
    reader.readAsText(file);
  });
}

function isValidRow(row) {
  if (!row.product_name || !row.category) return false;
  const numericFields = [row.quantity_on_hand, row.reorder_threshold, row.reorder_quantity, row.sales_rate];
  if (numericFields.some((value) => value === undefined || value === '' || Number.isNaN(parseFloat(value)))) {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiration_date || '')) return false;
  if (Number.isNaN(parseDateUTC(row.expiration_date))) return false;
  return true;
}

function parseCSVText(text) {
  const lines = text.split(/\r\n|\n/).filter((line) => line.trim() !== '');

  if (lines.length === 0) {
    throw new AppError('This file is empty.');
  }

  const headers = lines[0].split(',').map((header) => header.trim());
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    throw new AppError(`Missing required columns: ${missingColumns.join(', ')}`);
  }

  const indexByColumn = {};
  headers.forEach((header, i) => {
    indexByColumn[header] = i;
  });

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((value) => value.trim());
    if (values.length < headers.length) continue;

    const row = {};
    REQUIRED_COLUMNS.forEach((column) => {
      row[column] = values[indexByColumn[column]];
    });
    row.lot_number = indexByColumn.lot_number !== undefined ? values[indexByColumn.lot_number] : `LOT-${i}`;
    row.storage_bin = indexByColumn.storage_bin !== undefined ? values[indexByColumn.storage_bin] : '—';

    if (isValidRow(row)) rows.push(row);
  }

  if (rows.length === 0) {
    throw new AppError("Couldn't read any valid rows from this file.");
  }

  return rows;
}

/* Calculations */

function parseDateUTC(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function todayUTC() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDateDisplay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function evaluateProduct(row) {
  const quantityOnHand = parseFloat(row.quantity_on_hand);
  const reorderThreshold = parseFloat(row.reorder_threshold);
  const reorderQuantity = parseFloat(row.reorder_quantity);
  const salesRate = parseFloat(row.sales_rate);

  const daysRemaining = quantityOnHand / salesRate;
  const daysUntilExpiry = (parseDateUTC(row.expiration_date) - todayUTC()) / MS_PER_DAY;
  const unitsExpiringUnsold = quantityOnHand - salesRate * daysUntilExpiry;
  const normalCycle = reorderThreshold / salesRate;

  const base = {
    productName: row.product_name,
    category: row.category,
    lotNumber: row.lot_number,
    storageBin: row.storage_bin,
  };

  const inputRows = [
    { label: 'Quantity on hand', value: `${formatNumber(quantityOnHand)} units` },
    { label: 'Sales rate', value: `${formatNumber(salesRate)} units/day` },
    { label: 'Reorder threshold', value: `${formatNumber(reorderThreshold)} units` },
    { label: 'Reorder quantity', value: `${formatNumber(reorderQuantity)} units` },
    { label: 'Expiration date', value: formatDateDisplay(row.expiration_date) },
  ];

  if (daysRemaining <= RESTOCK_DAYS_THRESHOLD) {
    return {
      ...base,
      flag: 'RESTOCK',
      reason: `Runs out in ${formatNumber(daysRemaining)} days. Order ${formatNumber(reorderQuantity)} units.`,
      value: formatNumber(reorderQuantity),
      unitLabel: 'units',
      details: {
        rows: [
          ...inputRows,
          { label: 'Days of stock remaining', value: `${formatNumber(quantityOnHand)} ÷ ${formatNumber(salesRate)} = ${formatNumber(daysRemaining)} days` },
        ],
        explanation: `Flagged RESTOCK because ${formatNumber(daysRemaining)} days of stock remaining is ${RESTOCK_DAYS_THRESHOLD} days or fewer.`,
      },
    };
  }

  if (unitsExpiringUnsold > 0 && daysUntilExpiry <= CLEAR_DAYS_THRESHOLD) {
    return {
      ...base,
      flag: 'CLEAR',
      reason: `${formatNumber(unitsExpiringUnsold)} units expire in ${formatNumber(daysUntilExpiry)} days before they sell.`,
      value: formatNumber(daysUntilExpiry),
      unitLabel: 'days left',
      details: {
        rows: [
          ...inputRows,
          { label: 'Days until expiry', value: `${formatNumber(daysUntilExpiry)} days` },
          { label: 'Units expiring unsold', value: `${formatNumber(quantityOnHand)} − (${formatNumber(salesRate)} × ${formatNumber(daysUntilExpiry)}) = ${formatNumber(unitsExpiringUnsold)}` },
        ],
        explanation: `Flagged CLEAR because ${formatNumber(unitsExpiringUnsold)} units would still be unsold when this expires in ${formatNumber(daysUntilExpiry)} days (${CLEAR_DAYS_THRESHOLD} days or fewer away).`,
      },
    };
  }

  if (daysRemaining > normalCycle * 2) {
    return {
      ...base,
      flag: 'HOLD',
      reason: `${formatNumber(daysRemaining)} days of stock. Skip reorder this cycle.`,
      value: formatNumber(daysRemaining),
      unitLabel: 'days',
      details: {
        rows: [
          ...inputRows,
          { label: 'Days of stock remaining', value: `${formatNumber(quantityOnHand)} ÷ ${formatNumber(salesRate)} = ${formatNumber(daysRemaining)} days` },
          { label: 'Normal reorder cycle', value: `${formatNumber(reorderThreshold)} ÷ ${formatNumber(salesRate)} = ${formatNumber(normalCycle)} days` },
        ],
        explanation: `Flagged HOLD because ${formatNumber(daysRemaining)} days of stock remaining is more than double the normal ${formatNumber(normalCycle)}-day reorder cycle.`,
      },
    };
  }

  return null;
}

function groupByFlag(rows) {
  const grouped = { RESTOCK: [], CLEAR: [], HOLD: [] };
  rows.forEach((row) => {
    const result = evaluateProduct(row);
    if (result) grouped[result.flag].push(result);
  });
  return grouped;
}

/* FEFO catalog (per-product lot grouping) */

function bucketForDays(days) {
  if (days <= FEFO_RED_MAX_DAYS) return 'RED';
  if (days <= FEFO_YELLOW_MAX_DAYS) return 'YELLOW';
  return 'GREEN';
}

function buildCatalog(rows) {
  const catalog = {};
  rows.forEach((row) => {
    const quantityOnHand = parseFloat(row.quantity_on_hand);
    const daysUntilExpiry = (parseDateUTC(row.expiration_date) - todayUTC()) / MS_PER_DAY;

    if (!catalog[row.product_name]) {
      catalog[row.product_name] = { category: row.category, totalQuantity: 0, lots: [] };
    }
    catalog[row.product_name].totalQuantity += quantityOnHand;
    catalog[row.product_name].lots.push({
      lotNumber: row.lot_number,
      storageBin: row.storage_bin,
      quantityOnHand,
      expirationDate: row.expiration_date,
      daysUntilExpiry,
      bucket: bucketForDays(daysUntilExpiry),
    });
  });

  Object.values(catalog).forEach((product) => {
    product.lots.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  });

  return catalog;
}

/* Formatting helpers */

function formatScannedAt(date) {
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} • ${timePart}`;
}

/* Rendering results */

function buildDetailsPanel(details) {
  const panel = document.createElement('div');
  panel.className = 'result-card-details';
  panel.hidden = true;

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  details.rows.forEach(({ label, value }) => {
    const row = document.createElement('div');
    row.className = 'detail-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'detail-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'detail-value';
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    grid.appendChild(row);
  });

  const explanation = document.createElement('p');
  explanation.className = 'detail-explanation';
  explanation.textContent = details.explanation;

  panel.appendChild(grid);
  panel.appendChild(explanation);
  return panel;
}

function buildResultCard(sectionClassName, item) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const row = document.createElement('div');
  row.className = 'result-card-row';

  const main = document.createElement('div');
  main.className = 'result-card-main';

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'result-card-name product-name-btn';
  name.textContent = item.productName;
  name.addEventListener('click', () => showProductDetail(item.productName));

  const category = document.createElement('p');
  category.className = 'result-card-category';
  category.textContent = item.category;

  const reason = document.createElement('p');
  reason.className = 'result-card-reason';
  reason.textContent = item.reason;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'result-card-toggle';
  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = 'View calculation';
  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'result-card-toggle-icon';
  toggleIcon.textContent = '▾';
  toggle.appendChild(toggleLabel);
  toggle.appendChild(toggleIcon);

  main.appendChild(name);
  main.appendChild(category);

  const product = currentCatalog[item.productName];
  if (product && product.lots.length > 1) {
    const lotBadge = document.createElement('p');
    lotBadge.className = 'result-card-lot';
    lotBadge.textContent = `Lot ${item.lotNumber} • Bin ${item.storageBin}`;
    main.appendChild(lotBadge);
  }

  main.appendChild(reason);
  main.appendChild(toggle);

  const side = document.createElement('div');
  side.className = 'result-card-side';

  const value = document.createElement('p');
  value.className = 'result-card-value';
  value.textContent = item.value;
  const unit = document.createElement('span');
  unit.textContent = item.unitLabel;
  value.appendChild(unit);

  const checkboxLabel = document.createElement('label');
  checkboxLabel.className = 'result-card-checkbox';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  const checkboxText = document.createElement('span');
  checkboxText.textContent = 'Mark as reviewed';
  checkboxLabel.appendChild(checkbox);
  checkboxLabel.appendChild(checkboxText);

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      reviewedCount += 1;
      card.classList.add('is-reviewed');
      checkboxText.textContent = 'Reviewed ✓';
    } else {
      reviewedCount -= 1;
      card.classList.remove('is-reviewed');
      checkboxText.textContent = 'Mark as reviewed';
    }
    updateFooter();
  });

  side.appendChild(value);
  side.appendChild(checkboxLabel);

  row.appendChild(main);
  row.appendChild(side);

  const detailsPanel = buildDetailsPanel(item.details);

  toggle.addEventListener('click', () => {
    const isExpanded = toggle.classList.toggle('is-expanded');
    detailsPanel.hidden = !isExpanded;
    toggleLabel.textContent = isExpanded ? 'Hide calculation' : 'View calculation';
  });

  card.appendChild(row);
  card.appendChild(detailsPanel);
  return card;
}

function buildSectionPanel(key, items) {
  const panel = document.createElement('div');
  panel.className = `results-panel results-panel--${key.toLowerCase()}`;

  const description = document.createElement('p');
  description.className = 'results-panel-description';
  description.textContent = SECTION_DESCRIPTIONS[key];
  panel.appendChild(description);

  items.forEach((item) => panel.appendChild(buildResultCard(key.toLowerCase(), item)));
  return panel;
}

function activateTab(tabsBar, panelsWrap, key) {
  tabsBar.querySelectorAll('.results-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.section === key);
  });
  panelsWrap.querySelectorAll('.results-panel').forEach((panel) => {
    panel.hidden = panel.dataset.section !== key;
  });
}

function buildResultsTabs(sections) {
  const tabsBar = document.createElement('div');
  tabsBar.className = 'results-tabs';
  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'results-panels';

  sections.forEach(({ key, label, items }) => {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = `results-tab results-tab--${key.toLowerCase()}`;
    tabBtn.dataset.section = key;

    const dot = document.createElement('span');
    dot.className = 'results-tab-dot';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const count = document.createElement('span');
    count.className = 'results-tab-count';
    count.textContent = items.length;

    tabBtn.appendChild(dot);
    tabBtn.appendChild(labelEl);
    tabBtn.appendChild(count);
    tabBtn.addEventListener('click', () => activateTab(tabsBar, panelsWrap, key));
    tabsBar.appendChild(tabBtn);

    const panel = buildSectionPanel(key, items);
    panel.dataset.section = key;
    panelsWrap.appendChild(panel);
  });

  activateTab(tabsBar, panelsWrap, sections[0].key);

  const wrapper = document.createElement('div');
  wrapper.appendChild(tabsBar);
  wrapper.appendChild(panelsWrap);
  return wrapper;
}

function renderSummaryCards(grouped) {
  summaryCardsEl.innerHTML = '';

  [
    { key: 'RESTOCK', label: 'Restock', count: grouped.RESTOCK.length },
    { key: 'CLEAR', label: 'Clear', count: grouped.CLEAR.length },
    { key: 'HOLD', label: 'Hold', count: grouped.HOLD.length },
  ].forEach(({ key, label, count }) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `summary-card summary-card--${key.toLowerCase()}`;
    card.disabled = count === 0;

    const countEl = document.createElement('p');
    countEl.className = 'summary-card-count';
    countEl.textContent = count;

    const labelEl = document.createElement('p');
    labelEl.className = 'summary-card-label';
    labelEl.textContent = label;

    card.appendChild(countEl);
    card.appendChild(labelEl);

    if (count > 0) {
      card.addEventListener('click', () => {
        const tabBtn = resultsFeed.querySelector(`.results-tab[data-section="${key}"]`);
        if (tabBtn) tabBtn.click();
      });
    }

    summaryCardsEl.appendChild(card);
  });
}

function updateFooter() {
  if (reviewedCount === totalFlaggedCount) {
    resultsFooter.classList.add('is-complete');
    resultsFooter.innerHTML = '';
    const headline = document.createElement('p');
    headline.className = 'results-footer-complete-headline';
    headline.textContent = "You're on top of it.";
    const subtext = document.createElement('p');
    subtext.textContent = 'See you tomorrow morning.';
    resultsFooter.appendChild(headline);
    resultsFooter.appendChild(subtext);
  } else {
    resultsFooter.classList.remove('is-complete');
    resultsFooter.textContent = `${reviewedCount} of ${totalFlaggedCount} items reviewed`;
  }
}

function renderResults(grouped, totalScanned) {
  reviewedCount = 0;
  totalFlaggedCount = grouped.RESTOCK.length + grouped.CLEAR.length + grouped.HOLD.length;

  resultsFeed.innerHTML = '';
  resultsMeta.textContent = `Scanned ${totalScanned} product${totalScanned === 1 ? '' : 's'} • ${formatScannedAt(new Date())}`;

  if (totalFlaggedCount === 0) {
    resultsCount.textContent = "You're on top of it.";
    summaryCardsEl.hidden = true;
    resultsFeed.hidden = true;
    emptyState.hidden = false;
    resultsFooter.hidden = true;
    return;
  }

  resultsCount.textContent = `${totalFlaggedCount} product${totalFlaggedCount === 1 ? '' : 's'} need attention.`;
  summaryCardsEl.hidden = false;
  emptyState.hidden = true;
  resultsFeed.hidden = false;
  resultsFooter.hidden = false;

  renderSummaryCards(grouped);

  const sections = [
    { key: 'RESTOCK', label: 'Restock', items: grouped.RESTOCK },
    { key: 'CLEAR', label: 'Clear', items: grouped.CLEAR },
    { key: 'HOLD', label: 'Hold', items: grouped.HOLD },
  ].filter((section) => section.items.length > 0);

  resultsFeed.appendChild(buildResultsTabs(sections));

  updateFooter();
}

/* Product detail (FEFO Matrix) */

function buildFefoBar(product) {
  fefoBar.innerHTML = '';
  fefoBarLegend.innerHTML = '';

  const totals = { RED: 0, YELLOW: 0, GREEN: 0 };
  product.lots.forEach((lot) => {
    totals[lot.bucket] += lot.quantityOnHand;
  });

  ['RED', 'YELLOW', 'GREEN'].forEach((bucket) => {
    const pct = product.totalQuantity > 0 ? (totals[bucket] / product.totalQuantity) * 100 : 0;
    if (pct > 0) {
      const segment = document.createElement('div');
      segment.className = `fefo-bar-segment fefo-bar-segment--${bucket.toLowerCase()}`;
      segment.style.width = `${pct}%`;
      fefoBar.appendChild(segment);
    }

    const legendItem = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = 'fefo-bar-legend-dot';
    dot.style.background = `var(--${bucket === 'RED' ? 'restock' : bucket === 'YELLOW' ? 'yellow' : 'green'})`;
    legendItem.appendChild(dot);
    legendItem.appendChild(document.createTextNode(`${bucket === 'RED' ? 'Red' : bucket === 'YELLOW' ? 'Yellow' : 'Green'}: ${formatNumber(pct)}%`));
    fefoBarLegend.appendChild(legendItem);
  });
}

function buildLotTable(product) {
  lotTableWrap.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'lot-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Lot</th><th>Bin</th><th>Quantity</th><th>Expires</th><th>Days to expiry</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  product.lots.forEach((lot) => {
    const tr = document.createElement('tr');

    const daysLabel = lot.daysUntilExpiry < 0
      ? `Expired ${formatNumber(Math.abs(lot.daysUntilExpiry))}d ago`
      : `${formatNumber(lot.daysUntilExpiry)} days`;

    const badge = `<span class="bucket-badge bucket-badge--${lot.bucket.toLowerCase()}">${lot.bucket}</span>`;

    const cells = [
      lot.lotNumber,
      lot.storageBin,
      `${formatNumber(lot.quantityOnHand)} units`,
      formatDateDisplay(lot.expirationDate),
      `${daysLabel} ${badge}`,
    ];

    cells.forEach((html, i) => {
      const td = document.createElement('td');
      if (i === cells.length - 1) {
        td.innerHTML = html;
      } else {
        td.textContent = html;
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  lotTableWrap.appendChild(table);
}

function showProductDetail(productName) {
  const product = currentCatalog[productName];
  if (!product) return;

  productViewName.textContent = productName;
  productViewMeta.textContent = `${product.category} • ${formatNumber(product.totalQuantity)} units across ${product.lots.length} lot${product.lots.length === 1 ? '' : 's'}`;

  buildFefoBar(product);
  buildLotTable(product);

  switchView(resultsView, productView);
}

backToResultsBtn.addEventListener('click', () => {
  switchView(productView, resultsView);
});

/* View + loading state */

function switchView(fromEl, toEl) {
  fromEl.classList.add('view-hidden');
  setTimeout(() => {
    fromEl.hidden = true;
    fromEl.classList.remove('view-hidden');
    toEl.hidden = false;
    toEl.classList.add('view-hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toEl.classList.remove('view-hidden');
      });
    });
  }, VIEW_TRANSITION_MS);
}

function startLoading() {
  uploadView.classList.add('is-loading');
  dropzoneIdle.hidden = true;
  dropzoneLoading.hidden = false;
}

function stopLoading() {
  uploadView.classList.remove('is-loading');
  dropzoneIdle.hidden = false;
  dropzoneLoading.hidden = true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Submit handling */

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const file = fileInput.files[0];
  if (!file) return;

  if (!isCSVFile(file)) {
    showError('Please upload a CSV file (.csv).');
    return;
  }

  startLoading();
  const minDelay = wait(MIN_LOADING_MS);

  try {
    const text = await readFileAsText(file);
    const rows = parseCSVText(text);
    await minDelay;
    currentCatalog = buildCatalog(rows);
    const grouped = groupByFlag(rows);
    renderResults(grouped, rows.length);
    stopLoading();
    newUploadBtn.hidden = false;
    switchView(uploadView, resultsView);
  } catch (err) {
    await minDelay;
    stopLoading();
    showError(err.message || 'Something went wrong reading this file.');
  }
});

newUploadBtn.addEventListener('click', () => {
  fileInput.value = '';
  filenameEl.textContent = '';
  submitBtn.disabled = true;
  clearError();
  switchView(resultsView, uploadView);
});

/* Sample CSV download */

downloadSampleBtn.addEventListener('click', () => {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sample_inventory.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});
