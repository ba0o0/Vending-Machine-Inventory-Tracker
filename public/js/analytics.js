(function () {
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  function toIsoDay(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseTxnDate(data) {
    if (data && data.date && data.date.toDate) {
      const dt = data.date.toDate();
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    if (data && data.dateIso) {
      const dt = new Date(data.dateIso);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    if (data && data.date) {
      const dt = new Date(data.date);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return new Date();
  }

  function addDays(dateObj, days) {
    const next = new Date(dateObj);
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfDay(dateObj) {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfDay(dateObj) {
    const d = new Date(dateObj);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  let chartInstance = null;

  const state = {
    transactions: [],
    restockEvents: [],
    itemsById: new Map(),
    machineNameById: new Map(),
    lockedMachineId: null,
    selectedRange: '30',
    selectedMachineId: 'all',
    selectedProduct: 'all',
    chartMode: 'transactions',
    rowsByDay: new Map(),
    currentItems: new Map(),
  };

  const els = {
    status: null,
    canvas: null,
    rangeSelect: null,
    customDateWrap: null,
    customStart: null,
    customEnd: null,
    machineFilterWrap: null,
    machineSelect: null,
    productSelect: null,
    chartModeSelect: null,
    pageTitle: null,
    subtitle: null,
    resetZoomBtn: null,
    drilldownTitle: null,
    drilldownEmpty: null,
    drilldownTableWrap: null,
    drilldownTbody: null,
    consumptionMetricsGrid: null,
    consumptionEmpty: null,
    chartNote: null,
    statTotalTxns: null,
    statTotalRestocks: null,
    statTxnPerRestock: null,
    outpaceProductsList: null,
    outpaceEmpty: null,
  };

  function hydrateElements() {
    els.status = document.getElementById('analytics-status');
    els.canvas = document.getElementById('txnChart');
    els.rangeSelect = document.getElementById('range-select');
    els.customDateWrap = document.getElementById('custom-date-wrap');
    els.customStart = document.getElementById('custom-start');
    els.customEnd = document.getElementById('custom-end');
    els.machineFilterWrap = document.getElementById('machine-filter-wrap');
    els.machineSelect = document.getElementById('machine-select');
    els.productSelect = document.getElementById('product-select');
    els.chartModeSelect = document.getElementById('chart-mode-select');
    els.pageTitle = document.querySelector('h1');
    els.subtitle = document.getElementById('analytics-subtitle');
    els.resetZoomBtn = document.getElementById('reset-zoom-btn');
    els.drilldownTitle = document.getElementById('drilldown-title');
    els.drilldownEmpty = document.getElementById('drilldown-empty');
    els.drilldownTableWrap = document.getElementById('drilldown-table-wrap');
    els.drilldownTbody = document.getElementById('drilldown-tbody');
    els.consumptionMetricsGrid = document.getElementById('consumption-metrics-grid');
    els.consumptionEmpty = document.getElementById('consumption-empty');
    els.chartNote = document.getElementById('chart-note');
    els.statTotalTxns = document.getElementById('stat-total-txns');
    els.statTotalRestocks = document.getElementById('stat-total-restocks');
    els.statTxnPerRestock = document.getElementById('stat-txn-per-restock');
    els.outpaceProductsList = document.getElementById('outpace-products-list');
    els.outpaceEmpty = document.getElementById('outpace-empty');
  }

  function formatDateTime(value) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'N/A';
    return dt.toLocaleString();
  }

  function setStatus(msg) {
    if (els.status) {
      els.status.textContent = msg;
    }
  }

  function fillSelect(selectEl, options, selectedValue) {
    if (!selectEl) return;
    selectEl.innerHTML = options
      .map((opt) => `<option value="${String(opt.value)}">${String(opt.label)}</option>`)
      .join('');
    if (typeof selectedValue !== 'undefined') {
      selectEl.value = selectedValue;
    }
  }

  function loadControlDefaults() {
    const now = new Date();
    const defaultStart = addDays(now, -29);
    if (els.customStart) els.customStart.value = toIsoDay(defaultStart);
    if (els.customEnd) els.customEnd.value = toIsoDay(now);
  }

  async function loadItemsLookup(db) {
    const snapshot = await db.collection('items').get();
    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      state.itemsById.set(doc.id, {
        name: String(data.name || '').trim(),
        category: String(data.category || data.itemCategory || '').trim(),
      });
    });
  }

  async function loadTransactions(db) {
    let query = db.collection('transactions').orderBy('date');
    if (state.lockedMachineId) {
      query = query.where('machineId', '==', state.lockedMachineId);
    }
    const snapshot = await query.get();

    state.transactions = [];
    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      const dt = parseTxnDate(data);
      const machineId = String(data.machineId || '').trim();
      const rawMachineName = String(data.machineName || '').trim();
      const existingMachineName = machineId ? String(state.machineNameById.get(machineId) || '').trim() : '';
      const machineName = rawMachineName && rawMachineName !== machineId
        ? rawMachineName
        : existingMachineName || machineId || 'Unknown Machine';
      const itemId = String(data.itemId || '').trim();
      const itemInfo = state.itemsById.get(itemId) || null;
      const productName = String(data.itemName || (itemInfo && itemInfo.name) || (itemId ? `Item ${itemId.slice(0, 6)}` : 'Unknown Product')).trim();

      if (machineId && (!state.machineNameById.has(machineId) || state.machineNameById.get(machineId) === machineId)) {
        state.machineNameById.set(machineId, machineName);
      }

      state.transactions.push({
        id: doc.id,
        date: dt,
        day: toIsoDay(dt),
        machineId,
        machineName,
        itemId,
        productName,
        oldQuantity: typeof data.oldQuantity === 'number' ? data.oldQuantity : null,
        newQuantity: typeof data.newQuantity === 'number' ? data.newQuantity : null,
      });
    });
  }

  async function loadCurrentItems(db) {
    const snapshot = await db.collection('items').get();
    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      state.currentItems.set(doc.id, {
        name: String(data.name || '').trim(),
        quantity: typeof data.quantity === 'number' ? data.quantity : 0,
        lowStockThreshold: typeof data.lowStockThreshold === 'number' ? data.lowStockThreshold : 5,
      });
    });
  }

  async function loadRestockEvents(db) {
    state.restockEvents = [];

    try {
      const machineIds = new Set();

      const machineSnapshot = await db.collection('vendingMachines').get();
      machineSnapshot.forEach((doc) => {
        const data = doc.data() || {};
        const machineName = String(data.name || data.machineName || doc.id || 'Unknown Machine').trim();
        const existingName = String(state.machineNameById.get(doc.id) || '').trim();
        if (!existingName || existingName === doc.id || existingName === 'Unknown Machine') {
          state.machineNameById.set(doc.id, machineName);
        } else if (machineName && machineName !== doc.id && existingName === machineName) {
          state.machineNameById.set(doc.id, machineName);
        }
        machineIds.add(doc.id);
      });

      if (state.lockedMachineId) {
        machineIds.clear();
        machineIds.add(state.lockedMachineId);
      } else {
        Array.from(state.machineNameById.keys()).forEach((machineId) => machineIds.add(machineId));
      }

      if (machineIds.size === 0) {
        console.log('No machines found to load restock events');
        return;
      }

      // Load restock events from each machine's subcollection
      for (const machineId of machineIds) {
        try {
          const snapshot = await db
            .collection('vendingMachines')
            .doc(machineId)
            .collection('restockEvents')
            .orderBy('timestamp')
            .get();

          console.log(`Loaded ${snapshot.size} restock events from machine ${machineId}`);

          snapshot.forEach((doc) => {
            const data = doc.data() || {};
            let timestamp = null;

            // Handle different timestamp formats
            if (data.timestamp && typeof data.timestamp.toDate === 'function') {
              timestamp = data.timestamp.toDate();
            } else if (data.timestamp instanceof Date) {
              timestamp = data.timestamp;
            } else if (typeof data.timestamp === 'number') {
              timestamp = new Date(data.timestamp);
            } else if (typeof data.timestamp === 'string') {
              timestamp = new Date(data.timestamp);
            }

            if (timestamp && !Number.isNaN(timestamp.getTime())) {
              state.restockEvents.push({
                id: doc.id,
                machineId,
                productId: String(data.productId || '').trim(),
                productName: String(data.productName || '').trim(),
                quantityAdded: typeof data.quantityAdded === 'number' ? data.quantityAdded : (data.newQuantity - data.previousQuantity),
                timestamp,
                date: timestamp,
              });
            }
          });
        } catch (err) {
          console.warn(`Failed to load restock events for machine ${machineId}:`, err.message);
        }
      }

      console.log(`Total restock events loaded: ${state.restockEvents.length}`);
    } catch (err) {
      console.error('Error in loadRestockEvents:', err);
    }
  }

  function getFilteredRestockRows() {
    const bounds = getDateRangeBounds();
    if (!bounds) return [];

    let rows = state.restockEvents.filter((row) => row.date >= bounds.start && row.date <= bounds.end);

    const machineId = state.lockedMachineId || state.selectedMachineId;
    if (machineId && machineId !== 'all') {
      rows = rows.filter((row) => row.machineId === machineId);
    }

    if (state.selectedProduct !== 'all') {
      rows = rows.filter((row) => {
        const rowKey = row.productId || `name:${row.productName}`;
        return rowKey === state.selectedProduct;
      });
    }

    return rows;
  }

  function aggregateRowsByDay(rows, getDay) {
    const counts = new Map();
    const rowsByDay = new Map();

    rows.forEach((row) => {
      const day = getDay(row);
      if (!day) return;
      counts.set(day, (counts.get(day) || 0) + 1);
      if (!rowsByDay.has(day)) rowsByDay.set(day, []);
      rowsByDay.get(day).push(row);
    });

    const labels = Array.from(counts.keys()).sort();
    const values = labels.map((day) => counts.get(day));
    return { labels, values, rowsByDay };
  }

  function calculateRestockCorrelation() {
    const bounds = getDateRangeBounds();
    if (!bounds) {
      renderRestockCorrelation(null);
      return;
    }

    // Filter to selected date range
    const txnInRange = state.transactions.filter((txn) => txn.date >= bounds.start && txn.date <= bounds.end);
    const restocksInRange = getFilteredRestockRows();

    // Apply machine filter
    let machineIds = null;
    if (state.lockedMachineId || state.selectedMachineId !== 'all') {
      const filteredMachineId = state.lockedMachineId || state.selectedMachineId;
      machineIds = new Set([filteredMachineId]);
    }

    const filteredTxn = machineIds ? txnInRange.filter((t) => machineIds.has(t.machineId)) : txnInRange;
    const filteredRestocks = machineIds ? restocksInRange.filter((r) => machineIds.has(r.machineId)) : restocksInRange;

    // Calculate metrics per product
    const productMetrics = new Map();

    filteredTxn.forEach((txn) => {
      const productId = txn.itemId || txn.productName;
      if (!productMetrics.has(productId)) {
        productMetrics.set(productId, {
          productName: txn.productName,
          transactionCount: 0,
          restockCount: 0,
        });
      }
      const m = productMetrics.get(productId);
      m.transactionCount += 1;
    });

    filteredRestocks.forEach((restock) => {
      const productId = restock.productId;
      if (!productMetrics.has(productId)) {
        productMetrics.set(productId, {
          productName: restock.productName,
          transactionCount: 0,
          restockCount: 0,
        });
      }
      const m = productMetrics.get(productId);
      m.restockCount += 1;
    });

    // Calculate outpace ratio and identify candidates
    const outpaceProducts = [];
    productMetrics.forEach((metric, productId) => {
      if (metric.restockCount > 0) {
        metric.ratio = metric.transactionCount / metric.restockCount;
        // Flag products where transactions significantly outpace restocks (>2x transactions per restock)
        if (metric.ratio > 2) {
          outpaceProducts.push(metric);
        }
      }
    });

    // Sort by ratio (highest outpace first)
    outpaceProducts.sort((a, b) => b.ratio - a.ratio);

    const stats = {
      totalTransactions: filteredTxn.length,
      totalRestocks: filteredRestocks.length,
      averageTxnPerRestock: filteredRestocks.length > 0 ? filteredTxn.length / filteredRestocks.length : 0,
      outpaceProducts,
    };

    renderRestockCorrelation(stats);
  }

  function renderRestockCorrelation(stats) {
    if (!stats) {
      if (els.statTotalTxns) els.statTotalTxns.textContent = '—';
      if (els.statTotalRestocks) els.statTotalRestocks.textContent = '—';
      if (els.statTxnPerRestock) els.statTxnPerRestock.textContent = '—';
      if (els.outpaceProductsList) {
        els.outpaceProductsList.innerHTML = '<div class="outpace-empty">No data available</div>';
      }
      if (els.chartNote) els.chartNote.textContent = '';
      return;
    }

    if (els.statTotalTxns) els.statTotalTxns.textContent = stats.totalTransactions;
    if (els.statTotalRestocks) els.statTotalRestocks.textContent = stats.totalRestocks;
    if (els.statTxnPerRestock) {
      els.statTxnPerRestock.textContent = stats.averageTxnPerRestock.toFixed(1);
    }

    if (els.outpaceProductsList) {
      if (!stats.outpaceProducts || !stats.outpaceProducts.length) {
        els.outpaceProductsList.innerHTML = '<div class="outpace-empty">No products exceeding restock cadence</div>';
      } else {
        const html = stats.outpaceProducts
          .map((product) => {
            const ratio = product.ratio.toFixed(1);
            return `
              <div class="outpace-product-item">
                <div class="outpace-product-name">${product.productName}</div>
                <div class="outpace-product-ratio">${ratio}x txns per restock</div>
              </div>
            `;
          })
          .join('');
        els.outpaceProductsList.innerHTML = html;
      }
    }

    if (els.chartNote) {
      if (stats.totalRestocks > 0) {
        els.chartNote.textContent = `Select Restocks or Transactions + Restocks in Chart View to plot restock activity as a daily line series. If a product is sold a lot between restocks, it may need more stock each time or to be restocked more often.`;
      } else {
        els.chartNote.textContent = '';
      }
    }
  }

  function calculateConsumptionMetrics() {
    if (state.selectedProduct === 'all') {
      renderConsumptionMetrics(null);
      return;
    }

    const productKey = state.selectedProduct;
    const txnForProduct = state.transactions.filter((txn) => {
      const key = txn.itemId || `name:${txn.productName}`;
      return key === productKey;
    });

    if (!txnForProduct.length) {
      renderConsumptionMetrics(null);
      return;
    }

    // Filter to selected date range
    const bounds = getDateRangeBounds();
    if (!bounds) {
      renderConsumptionMetrics(null);
      return;
    }

    const txnInRange = txnForProduct.filter((txn) => txn.date >= bounds.start && txn.date <= bounds.end);
    if (!txnInRange.length) {
      renderConsumptionMetrics(null);
      return;
    }

    // Calculate consumption rate from quantity deltas where available
    let totalUnitsSold = 0;
    let restockEvents = 0;

    txnInRange.forEach((txn) => {
      if (typeof txn.oldQuantity === 'number' && typeof txn.newQuantity === 'number') {
        const delta = txn.oldQuantity - txn.newQuantity;
        if (delta > 0) {
          totalUnitsSold += delta;
        } else if (delta < 0) {
          restockEvents += 1;
        }
      } else {
        // Count individual transactions if quantity data is missing
        totalUnitsSold += 1;
      }
    });

    // Calculate days covered
    const daysCovered = Math.max(1, Math.ceil((bounds.end - bounds.start) / (24 * 60 * 60 * 1000)));
    const dailyConsumptionRate = totalUnitsSold / daysCovered;

    // Get current item inventory
    const itemId = String(productKey).replace(/^name:/, '');
    const currentItem = state.currentItems.get(itemId);
    let daysUntilEmpty = null;
    let currentQuantity = null;

    if (currentItem && currentItem.quantity !== undefined) {
      currentQuantity = currentItem.quantity;
      if (dailyConsumptionRate > 0) {
        daysUntilEmpty = currentQuantity / dailyConsumptionRate;
      }
    }

    const metrics = {
      totalUnitsSold,
      restockEvents,
      daysCovered,
      dailyConsumptionRate,
      currentQuantity,
      daysUntilEmpty,
      lowStockThreshold: currentItem ? currentItem.lowStockThreshold : 5,
      productName: txnInRange[0].productName,
    };

    renderConsumptionMetrics(metrics);
  }

  function renderConsumptionMetrics(metrics) {
    if (!els.consumptionMetricsGrid) return;

    if (!metrics) {
      els.consumptionMetricsGrid.innerHTML = '<div class="consumption-empty" id="consumption-empty">Select a product to view consumption metrics</div>';
      return;
    }

    const cards = [];

    // Daily consumption rate
    cards.push(`
      <div class="metric-card">
        <div class="metric-label">Daily Consumption</div>
        <div class="metric-value">${metrics.dailyConsumptionRate.toFixed(2)}</div>
        <div class="metric-subtext">units per day</div>
        <div class="metric-formula">Formula: Total Units Sold ÷ Days Covered<br>${metrics.totalUnitsSold} ÷ ${metrics.daysCovered} = ${metrics.dailyConsumptionRate.toFixed(2)}</div>
      </div>
    `);

    // Total units sold in period
    cards.push(`
      <div class="metric-card">
        <div class="metric-label">Total Sold (Period)</div>
        <div class="metric-value">${metrics.totalUnitsSold}</div>
        <div class="metric-subtext">${metrics.daysCovered} days analyzed</div>
      </div>
    `);

    // Current inventory
    if (metrics.currentQuantity !== null) {
      cards.push(`
        <div class="metric-card">
          <div class="metric-label">Current Stock</div>
          <div class="metric-value">${metrics.currentQuantity}</div>
          <div class="metric-subtext">Low threshold: ${metrics.lowStockThreshold}</div>
        </div>
      `);
    }

    // Days until empty
    if (metrics.daysUntilEmpty !== null) {
      let statusColor = '#f5a623';
      let statusText = 'estimated';

      if (metrics.daysUntilEmpty < metrics.lowStockThreshold) {
        statusColor = '#ff6b6b';
        statusText = 'below low threshold!';
      } else if (metrics.daysUntilEmpty < 7) {
        statusColor = '#ffc93d';
        statusText = 'approaching low stock';
      }

      const daysDisplay = metrics.daysUntilEmpty > 0 ? metrics.daysUntilEmpty.toFixed(1) : '—';
      const formula = `${metrics.currentQuantity} ÷ ${metrics.dailyConsumptionRate.toFixed(2)}`;

      cards.push(`
        <div class="metric-card" style="border-color: ${statusColor}4d;">
          <div class="metric-label">Est. Days Until Empty</div>
          <div class="metric-value" style="color: ${statusColor};">${daysDisplay}</div>
          <div class="metric-subtext">${statusText}</div>
          <div class="metric-formula">Current Stock ÷ Daily Rate<br>${formula}</div>
        </div>
      `);
    }

    // Restock events
    cards.push(`
      <div class="metric-card">
        <div class="metric-label">Restock Events</div>
        <div class="metric-value">${metrics.restockEvents}</div>
        <div class="metric-subtext">during period</div>
      </div>
    `);

    els.consumptionMetricsGrid.innerHTML = cards.join('');
  }

  function populateMachineOptions() {
    if (state.lockedMachineId) {
      if (els.machineFilterWrap) {
        els.machineFilterWrap.classList.add('is-hidden');
      }
      state.selectedMachineId = state.lockedMachineId;
      if (els.pageTitle) {
        els.pageTitle.textContent = 'Machine Analytics';
      }
      if (els.subtitle) {
        els.subtitle.textContent = 'Transaction history and trend visualizations for this machine';
      }
      return;
    }

    const machineEntries = Array.from(state.machineNameById.entries())
      .sort((a, b) => a[1].localeCompare(b[1]));
    const options = [{ value: 'all', label: 'All Machines' }].concat(
      machineEntries.map(([id, name]) => ({ value: id, label: name && name !== id ? name : `Machine ${id}` }))
    );
    fillSelect(els.machineSelect, options, state.selectedMachineId);
  }

  function getFilteredByMachine() {
    const machineId = state.lockedMachineId || state.selectedMachineId;
    if (!machineId || machineId === 'all') {
      return state.transactions.slice();
    }
    return state.transactions.filter((txn) => txn.machineId === machineId);
  }

  function populateProductOptions() {
    const scoped = getFilteredByMachine();
    const productMap = new Map();
    scoped.forEach((txn) => {
      const key = txn.itemId || `name:${txn.productName}`;
      if (!productMap.has(key)) {
        productMap.set(key, txn.productName || 'Unknown Product');
      }
    });

    const options = [{ value: 'all', label: 'All Products' }].concat(
      Array.from(productMap.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label }))
    );

    const validValues = new Set(options.map((o) => o.value));
    if (!validValues.has(state.selectedProduct)) {
      state.selectedProduct = 'all';
    }
    fillSelect(els.productSelect, options, state.selectedProduct);
  }

  function getDateRangeBounds() {
    const now = new Date();
    const rangeKey = state.selectedRange;

    if (rangeKey === 'custom') {
      const startText = els.customStart && els.customStart.value ? `${els.customStart.value}T00:00:00` : '';
      const endText = els.customEnd && els.customEnd.value ? `${els.customEnd.value}T23:59:59` : '';
      if (!startText || !endText) {
        return null;
      }
      const start = new Date(startText);
      const end = new Date(endText);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return null;
      }
      return { start, end };
    }

    const days = Number.parseInt(rangeKey, 10);
    if (!Number.isFinite(days) || days <= 0) {
      return null;
    }
    const end = endOfDay(now);
    const start = startOfDay(addDays(end, -(days - 1)));
    return { start, end };
  }

  function applyAllFilters() {
    let rows = getFilteredByMachine();

    if (state.selectedProduct !== 'all') {
      rows = rows.filter((txn) => {
        const productKey = txn.itemId || `name:${txn.productName}`;
        return productKey === state.selectedProduct;
      });
    }

    const bounds = getDateRangeBounds();
    if (!bounds) {
      return { rows: [], invalidDateRange: true };
    }

    rows = rows.filter((txn) => txn.date >= bounds.start && txn.date <= bounds.end);
    return { rows, invalidDateRange: false };
  }

  function aggregateByDay(rows) {
    const map = new Map();
    const rowsByDay = new Map();
    rows.forEach((row) => {
      map.set(row.day, (map.get(row.day) || 0) + 1);
      if (!rowsByDay.has(row.day)) rowsByDay.set(row.day, []);
      rowsByDay.get(row.day).push(row);
    });
    const labels = Array.from(map.keys()).sort();
    const values = labels.map((d) => map.get(d));
    return { labels, values, rowsByDay };
  }

  function buildMachineContributionLines(rows) {
    const counts = new Map();
    rows.forEach((row) => {
      const name = row.machineName || row.machineId || 'Unknown Machine';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    const lines = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    return lines.length ? lines : ['No machine details'];
  }

  function renderDrilldown(dayLabel, rows) {
    if (!els.drilldownTitle || !els.drilldownEmpty || !els.drilldownTableWrap || !els.drilldownTbody) return;

    if (!rows || !rows.length) {
      els.drilldownTitle.textContent = 'Daily Transaction Details';
      els.drilldownEmpty.textContent = 'No transactions available for this day.';
      els.drilldownEmpty.classList.remove('is-hidden');
      els.drilldownTableWrap.classList.add('is-hidden');
      els.drilldownTbody.innerHTML = '';
      return;
    }

    els.drilldownTitle.textContent = `Daily Transaction Details - ${dayLabel}`;
    els.drilldownEmpty.classList.add('is-hidden');
    els.drilldownTableWrap.classList.remove('is-hidden');
    els.drilldownTbody.innerHTML = rows
      .slice()
      .sort((a, b) => a.date - b.date)
      .map((row) => {
        const when = formatDateTime(row.date);
        const machine = row.machineName || row.machineId || 'Unknown Machine';
        const product = row.productName || 'Unknown Product';
        const itemIdAttr = row.itemId ? ` data-item-id="${row.itemId}"` : '';
        return `<tr><td>${when}</td><td>${machine}</td><td><span class="drilldown-product-cell"${itemIdAttr}>${product}</span></td></tr>`;
      })
      .join('');

    // Attach click handlers to product cells
    const productCells = els.drilldownTbody.querySelectorAll('.drilldown-product-cell');
    productCells.forEach((cell) => {
      cell.addEventListener('click', function (e) {
        e.stopPropagation();
        const itemId = this.getAttribute('data-item-id');
        if (itemId && els.productSelect) {
          els.productSelect.value = itemId;
          onProductChanged();
        }
      });
    });
  }

  function renderRestockDrilldown(dayLabel, rows) {
    if (!els.drilldownTitle || !els.drilldownEmpty || !els.drilldownTableWrap || !els.drilldownTbody) return;

    if (!rows || !rows.length) {
      els.drilldownTitle.textContent = 'Daily Restock Details';
      els.drilldownEmpty.textContent = 'No restock events available for this day.';
      els.drilldownEmpty.classList.remove('is-hidden');
      els.drilldownTableWrap.classList.add('is-hidden');
      els.drilldownTbody.innerHTML = '';
      return;
    }

    els.drilldownTitle.textContent = `Daily Restock Details - ${dayLabel}`;
    els.drilldownEmpty.classList.add('is-hidden');
    els.drilldownTableWrap.classList.remove('is-hidden');
    els.drilldownTbody.innerHTML = rows
      .slice()
      .sort((a, b) => a.date - b.date)
      .map((row) => {
        const when = formatDateTime(row.date);
        const machine = row.machineName || row.machineId || 'Unknown Machine';
        const product = row.productName || 'Unknown Product';
        const quantityAdded = typeof row.quantityAdded === 'number' ? row.quantityAdded : '—';
        return `<tr><td>${when}</td><td>${machine}</td><td>${product}</td><td>${quantityAdded}</td></tr>`;
      })
      .join('');
  }

  function destroyExistingChart() {
    if (chartInstance && typeof chartInstance.destroy === 'function') {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  function renderChart(labels, data, datasetLabel) {
    if (!els.canvas) return;
    const ctx = els.canvas.getContext('2d');
    if (!ctx) return;

    destroyExistingChart();

    const bounds = getDateRangeBounds();
    const restockRows = getFilteredRestockRows();
    const txnRows = bounds
      ? state.transactions.filter((txn) => txn.date >= bounds.start && txn.date <= bounds.end)
      : [];

    const txnAgg = aggregateRowsByDay(txnRows, (row) => row.day);
    const restockAgg = aggregateRowsByDay(restockRows, (row) => toIsoDay(row.date));
    const labelSet = new Set([...txnAgg.labels, ...restockAgg.labels]);
    const allLabels = Array.from(labelSet).sort();

    const datasets = [];
    if (state.chartMode === 'transactions' || state.chartMode === 'both') {
      datasets.push({
        label: datasetLabel,
        data: allLabels.map((day) => (txnAgg.rowsByDay.get(day) || []).length),
        borderColor: '#f5a623',
        backgroundColor: 'rgba(245,166,35,0.18)',
        pointBackgroundColor: '#ffd58a',
      });
    }

    if (state.chartMode === 'restocks' || state.chartMode === 'both') {
      datasets.push({
        label: datasetLabel.replace('Transactions', 'Restocks'),
        data: allLabels.map((day) => (restockAgg.rowsByDay.get(day) || []).length),
        borderColor: '#7dd87d',
        backgroundColor: 'rgba(125,216,125,0.16)',
        pointBackgroundColor: '#c8f7c8',
      });
    }

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets: datasets.map((dataset) => ({
          label: dataset.label,
          data: dataset.data,
          borderColor: dataset.borderColor,
          backgroundColor: dataset.backgroundColor,
          pointBackgroundColor: dataset.pointBackgroundColor,
          pointBorderColor: '#1a1d23',
          pointRadius: 3,
          fill: true,
          tension: 0.2,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: {
              color: '#f2f6fb',
              font: { size: 13 },
            },
          },
          tooltip: {
            titleColor: '#f2f6fb',
            bodyColor: '#f2f6fb',
            backgroundColor: 'rgba(26,29,35,0.94)',
            borderColor: '#f5a623',
            borderWidth: 1,
            callbacks: {
              title: function (items) {
                const label = items && items[0] ? items[0].label : '';
                return `Date: ${label}`;
              },
              label: function (context) {
                return `Transactions: ${context.parsed.y}`;
              },
              afterLabel: function (context) {
                const day = context.label;
                const rows = state.rowsByDay.get(day) || [];
                const lines = buildMachineContributionLines(rows);
                return ['Machines:'].concat(lines);
              },
            },
          },
          zoom: {
            pan: {
              enabled: true,
              mode: 'x',
            },
            zoom: {
              wheel: {
                enabled: true,
              },
              pinch: {
                enabled: true,
              },
              drag: {
                enabled: true,
                backgroundColor: 'rgba(245,166,35,0.15)',
              },
              mode: 'x',
            },
          },
          restockMarkers: {},
        },
        onClick: function (_event, elements) {
          if (!elements || !elements.length) return;
          const idx = elements[0].index;
          const day = allLabels[idx];
          if (state.chartMode === 'restocks') {
            const rows = restockAgg.rowsByDay.get(day) || [];
            renderRestockDrilldown(day, rows);
          } else {
            const rows = txnAgg.rowsByDay.get(day) || [];
            renderDrilldown(day, rows);
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Date',
              color: '#f2f6fb',
              font: { size: 12, weight: '600' },
            },
            ticks: {
              color: '#d9e2ee',
              maxRotation: 45,
              minRotation: 0,
            },
            grid: {
              color: 'rgba(233,240,248,0.16)',
            },
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Transactions',
              color: '#f2f6fb',
              font: { size: 12, weight: '600' },
            },
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: '#d9e2ee',
            },
            grid: {
              color: 'rgba(233,240,248,0.16)',
            },
          },
        },
      },
    });
  }

  function currentDatasetLabel() {
    if (state.lockedMachineId) {
      const lockedName = state.machineNameById.get(state.lockedMachineId) || 'Selected Machine';
      return `${lockedName} Transactions`;
    }
    if (state.selectedMachineId && state.selectedMachineId !== 'all') {
      const name = state.machineNameById.get(state.selectedMachineId) || 'Machine';
      return `${name} Transactions`;
    }
    return 'All Transactions';
  }

  function toggleCustomDateVisibility() {
    if (!els.customDateWrap) return;
    if (state.selectedRange === 'custom') {
      els.customDateWrap.classList.remove('is-hidden');
    } else {
      els.customDateWrap.classList.add('is-hidden');
    }
  }

  function refreshChartFromState() {
    const result = applyAllFilters();
    if (result.invalidDateRange) {
      destroyExistingChart();
      setStatus('Invalid custom date range. Please choose valid start and end dates.');
      calculateRestockCorrelation();
      return;
    }

    if (!result.rows.length) {
      destroyExistingChart();
      setStatus('No transaction data found for the selected filters.');
      calculateConsumptionMetrics();
      calculateRestockCorrelation();
      return;
    }

    const agg = aggregateByDay(result.rows);
    if (!agg.labels.length) {
      destroyExistingChart();
      setStatus('No transaction data found for the selected filters.');
      calculateConsumptionMetrics();
      calculateRestockCorrelation();
      return;
    }

    setStatus('');
    state.rowsByDay = agg.rowsByDay;
    renderChart(agg.labels, agg.values, currentDatasetLabel());
    renderDrilldown('', []);
    calculateConsumptionMetrics();
    calculateRestockCorrelation();
  }

  function onMachineChanged() {
    state.selectedMachineId = els.machineSelect ? els.machineSelect.value : 'all';
    state.selectedProduct = 'all';
    populateProductOptions();
    refreshChartFromState();
  }

  function onProductChanged() {
    state.selectedProduct = els.productSelect ? els.productSelect.value : 'all';
    refreshChartFromState();
    calculateConsumptionMetrics();
  }

  function onChartModeChanged() {
    state.chartMode = els.chartModeSelect ? els.chartModeSelect.value : 'transactions';
    refreshChartFromState();
  }

  function onRangeChanged() {
    state.selectedRange = els.rangeSelect ? els.rangeSelect.value : '30';
    toggleCustomDateVisibility();
    refreshChartFromState();
  }

  function bindControlEvents() {
    if (els.rangeSelect) {
      els.rangeSelect.addEventListener('change', onRangeChanged);
    }
    if (els.machineSelect) {
      els.machineSelect.addEventListener('change', onMachineChanged);
    }
    if (els.productSelect) {
      els.productSelect.addEventListener('change', onProductChanged);
    }
    if (els.chartModeSelect) {
      els.chartModeSelect.addEventListener('change', onChartModeChanged);
    }
    if (els.customStart) {
      els.customStart.addEventListener('change', refreshChartFromState);
    }
    if (els.customEnd) {
      els.customEnd.addEventListener('change', refreshChartFromState);
    }
    if (els.resetZoomBtn) {
      els.resetZoomBtn.addEventListener('click', function () {
        if (chartInstance && typeof chartInstance.resetZoom === 'function') {
          chartInstance.resetZoom();
        }
      });
    }
  }

  async function loadAnalytics() {
    hydrateElements();
    if (!els.canvas) return;

    state.lockedMachineId = getQueryParam('machineId');

    try {
      if (typeof firebase === 'undefined' || !firebase.firestore || typeof Chart === 'undefined') {
        setStatus('Firebase or chart library is not available.');
        return;
      }

      if (window['chartjs-plugin-zoom']) {
        Chart.register(window['chartjs-plugin-zoom']);
      }

      const db = firebase.firestore();

      setStatus('Loading transaction history, restock events, and inventory data...');
      loadControlDefaults();

      await loadItemsLookup(db);
      await loadCurrentItems(db);
      await loadTransactions(db);
      await loadRestockEvents(db);

      if (!state.transactions.length) {
        populateMachineOptions();
        populateProductOptions();
        toggleCustomDateVisibility();
        setStatus('No transaction data found yet. Restock data may still be available.');
      } else {
        populateMachineOptions();
        populateProductOptions();
        toggleCustomDateVisibility();
      }

      bindControlEvents();
      refreshChartFromState();
    } catch (err) {
      console.error(err);
      setStatus('Failed to load analytics: ' + (err && err.message ? err.message : String(err)));
    }
  }

  document.addEventListener('DOMContentLoaded', loadAnalytics);
})();
