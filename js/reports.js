/**
 * Prj-Garments Firebase - Reports Module
 * Sales reports, stock verification, end-of-sale reports, re-order reports, RFQ/PO generation.
 */
var Reports = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _salesReportData = [];
  var _stockReportData = [];
  var _reorderReportData = [];
  var _rfqPendingGroups = [];

  // ─── Constants ──────────────────────────────────────────────────────────────

  var MAX_DATE_RANGE_DAYS = 365;
  var COLLECTIONS = {
    TRANSACTIONS: 'transactions',
    ITEMS: 'items',
    DOCUMENTS: 'documents'
  };

  // ─── Initialization ─────────────────────────────────────────────────────────

  /**
   * Initializes the Reports module UI in the relevant screen sections.
   */
  function init() {
    _renderSalesReportUI();
    _renderStockReportUI();
  }

  // ─── Sales Report ───────────────────────────────────────────────────────────

  /**
   * Generates a sales report for a given date range.
   * Validates dates, queries transactions, and aggregates by item.
   * @param {Date|string} startDate - Start of date range
   * @param {Date|string} endDate - End of date range
   * @returns {Promise<object>} Report data with items array or error
   */
  async function getSalesReport(startDate, endDate) {
    var validation = _validateDateRange(startDate, endDate);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    var start = validation.start;
    var end = validation.end;

    try {
      var transactions = await DataLayer.queryDocuments(COLLECTIONS.TRANSACTIONS, {
        where: [
          { field: 'date', op: '>=', value: start },
          { field: 'date', op: '<=', value: end }
        ],
        orderBy: [{ field: 'date', direction: 'asc' }]
      });

      if (!transactions || transactions.length === 0) {
        return { success: true, items: [], message: 'No sales records found for the selected period.' };
      }

      var aggregated = _aggregateSalesByItem(transactions);
      _salesReportData = aggregated;

      return { success: true, items: aggregated };
    } catch (e) {
      return { success: false, error: 'Failed to fetch sales report: ' + e.message };
    }
  }

  // ─── Stock Verification Report ──────────────────────────────────────────────

  /**
   * Generates a stock verification report.
   * Queries all items and classifies stock status based on quantity vs reorder_level.
   * @returns {Promise<object>} Report with items classified by stock status
   */
  async function getStockVerificationReport() {
    try {
      var items = await DataLayer.queryDocuments(COLLECTIONS.ITEMS);

      if (!items || items.length === 0) {
        return { success: true, items: [], message: 'No items found in inventory.' };
      }

      var classified = items.map(function (item) {
        var qty = item.quantity || 0;
        var reorderLevel = item.reorder_level || 0;
        var status;

        if (qty === 0) {
          status = 'Out of Stock';
        } else if (reorderLevel > 0 && qty <= reorderLevel) {
          status = 'Low Stock';
        } else {
          status = 'In Stock';
        }

        return {
          id: item.id,
          item_code: item.item_code || '',
          item_name: item.item_type || '',
          category: item.item_type || '',
          brand: item.brand || '',
          quantity: qty,
          reorder_level: reorderLevel,
          updated_at: item.updated_at || item.created_at || null,
          status: status
        };
      });

      _stockReportData = classified;
      return { success: true, items: classified };
    } catch (e) {
      return { success: false, error: 'Failed to fetch stock report: ' + e.message };
    }
  }

  // ─── End of Sale Report ─────────────────────────────────────────────────────

  /**
   * Generates an end-of-sale report for a given date range.
   * Shows total transactions, total revenue, and distinct items sold with qty.
   * @param {Date|string} startDate - Start of date range
   * @param {Date|string} endDate - End of date range
   * @returns {Promise<object>} End-of-sale summary
   */
  async function getEndOfSaleReport(startDate, endDate) {
    var validation = _validateDateRange(startDate, endDate);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    var start = validation.start;
    var end = validation.end;

    try {
      var transactions = await DataLayer.queryDocuments(COLLECTIONS.TRANSACTIONS, {
        where: [
          { field: 'date', op: '>=', value: start },
          { field: 'date', op: '<=', value: end }
        ],
        orderBy: [{ field: 'date', direction: 'asc' }]
      });

      if (!transactions || transactions.length === 0) {
        return {
          success: true,
          total_transactions: 0,
          total_revenue: 0,
          items_sold: [],
          message: 'No sales were recorded for the selected period.'
        };
      }

      var totalRevenue = 0;
      var itemMap = {};

      for (var i = 0; i < transactions.length; i++) {
        var txn = transactions[i];
        totalRevenue += (txn.total || 0);

        var txnItems = txn.items || [];
        for (var j = 0; j < txnItems.length; j++) {
          var item = txnItems[j];
          var key = item.item_code || item.name || ('item_' + j);
          if (!itemMap[key]) {
            itemMap[key] = {
              item_code: item.item_code || '',
              item_name: item.name || '',
              total_qty_sold: 0
            };
          }
          itemMap[key].total_qty_sold += (item.qty || 0);
        }
      }

      var itemsSold = [];
      var keys = Object.keys(itemMap);
      for (var k = 0; k < keys.length; k++) {
        itemsSold.push(itemMap[keys[k]]);
      }

      return {
        success: true,
        total_transactions: transactions.length,
        total_revenue: Utils.roundTo2(totalRevenue),
        items_sold: itemsSold
      };
    } catch (e) {
      return { success: false, error: 'Failed to fetch end-of-sale report: ' + e.message };
    }
  }

  // ─── Reorder Report ─────────────────────────────────────────────────────────

  /**
   * Generates a reorder report showing items below their reorder level.
   * Sorted by category then brand alphabetically.
   * @returns {Promise<object>} Reorder report data
   */
  async function getReorderReport() {
    try {
      var items = await DataLayer.queryDocuments(COLLECTIONS.ITEMS);

      if (!items || items.length === 0) {
        return { success: true, items: [], message: 'No items found in inventory.' };
      }

      var reorderItems = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var qty = item.quantity || 0;
        var reorderLevel = item.reorder_level || 0;

        if (reorderLevel > 0 && qty < reorderLevel) {
          reorderItems.push({
            id: item.id,
            item_code: item.item_code || '',
            item_name: item.item_type || '',
            category: item.item_type || '',
            brand: item.brand || '',
            quantity: qty,
            reorder_level: reorderLevel,
            reorder_qty: item.reorder_qty || 0,
            cost_price: item.cost_price || 0,
            indicator: 'Reorder Required'
          });
        }
      }

      // Sort by category then brand alphabetically
      reorderItems.sort(function (a, b) {
        var catCompare = (a.category || '').localeCompare(b.category || '');
        if (catCompare !== 0) return catCompare;
        return (a.brand || '').localeCompare(b.brand || '');
      });

      _reorderReportData = reorderItems;
      return { success: true, items: reorderItems };
    } catch (e) {
      return { success: false, error: 'Failed to fetch reorder report: ' + e.message };
    }
  }

  // ─── RFQ / PO Generation ────────────────────────────────────────────────────

  /**
   * Generates an RFQ (Request for Quotation) document from given items.
   * Defaults qty to total sold qty, price to cost_price. Allows edits (qty≥1, price≥0.01).
   * @param {Array} items - Array of item objects from sales report
   * @returns {object} RFQ document with editable line items
   */
  function generateRFQ(items) {
    return _generateDocument('RFQ', items);
  }

  /**
   * Generates a PO (Purchase Order) document from given items.
   * Defaults qty to total sold qty, price to cost_price. Allows edits (qty≥1, price≥0.01).
   * @param {Array} items - Array of item objects from sales report
   * @returns {object} PO document with editable line items
   */
  function generatePO(items) {
    return _generateDocument('PO', items);
  }

  /**
   * Internal helper to generate RFQ or PO document structure.
   * @param {string} docType - 'RFQ' or 'PO'
   * @param {Array} items - Items array
   * @returns {object} Document with line items
   * @private
   */
  function _generateDocument(docType, items) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'No items provided for ' + docType + ' generation.' };
    }

    var lineItems = items.map(function (item) {
      var qty = item.total_qty_sold || item.quantity || 1;
      var price = item.cost_price || 0.01;

      return {
        item_code: item.item_code || '',
        item_name: item.item_name || item.name || '',
        qty: Math.max(1, qty),
        unit_price: Math.max(0.01, price)
      };
    });

    return {
      success: true,
      doc_type: docType,
      line_items: lineItems
    };
  }

  // ─── Save Document ──────────────────────────────────────────────────────────

  /**
   * Saves a finalized RFQ or PO document to Firestore "documents" collection.
   * Validates line items (qty≥1, price≥0.01), generates unique doc_number.
   * @param {string} docType - 'RFQ' or 'PO'
   * @param {Array} lineItems - Array of {item_code, item_name, qty, unit_price}
   * @returns {Promise<object>} Result with saved document info or error
   */
  async function saveDocument(docType, lineItems, vendorInfo) {
    if (!docType || (docType !== 'RFQ' && docType !== 'PO')) {
      return { success: false, error: 'Invalid document type. Must be "RFQ" or "PO".' };
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return { success: false, error: 'Line items are required.' };
    }

    // Validate each line item
    for (var i = 0; i < lineItems.length; i++) {
      var item = lineItems[i];
      if (!item.qty || item.qty < 1) {
        return { success: false, error: 'Quantity must be at least 1 for item at position ' + (i + 1) + '.' };
      }
      if (!item.unit_price || item.unit_price < 0.01) {
        return { success: false, error: 'Price must be at least 0.01 for item at position ' + (i + 1) + '.' };
      }
    }

    // Calculate total
    var total = 0;
    for (var j = 0; j < lineItems.length; j++) {
      total += (lineItems[j].qty * lineItems[j].unit_price);
    }
    total = Utils.roundTo2(total);

    // Generate unique document number
    var docNumber = _generateDocNumber(docType);

    var docData = {
      doc_number: docNumber,
      doc_type: docType,
      date: new Date(),
      line_items: lineItems,
      total: total,
      vendor_code: vendorInfo ? (vendorInfo.vendor_code || '') : '',
      vendor_name: vendorInfo ? (vendorInfo.vendor_name || '') : ''
    };

    try {
      var docId = await DataLayer.addDocument(COLLECTIONS.DOCUMENTS, docData);
      return {
        success: true,
        doc_id: docId,
        doc_number: docNumber,
        total: total
      };
    } catch (e) {
      return { success: false, error: 'Failed to save document: ' + e.message };
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Validates a date range: start ≤ end, max 365 days span.
   * @param {Date|string} startDate
   * @param {Date|string} endDate
   * @returns {object} {valid, start, end, error}
   * @private
   */
  function _validateDateRange(startDate, endDate) {
    var start = startDate instanceof Date ? startDate : new Date(startDate);
    var end = endDate instanceof Date ? endDate : new Date(endDate);

    if (isNaN(start.getTime())) {
      return { valid: false, error: 'Invalid start date.' };
    }
    if (isNaN(end.getTime())) {
      return { valid: false, error: 'Invalid end date.' };
    }

    // Normalize to start of day for comparison
    var startNorm = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var endNorm = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    if (startNorm > endNorm) {
      return { valid: false, error: 'Start date must be on or before the end date.' };
    }

    var diffMs = endNorm.getTime() - startNorm.getTime();
    var diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > MAX_DATE_RANGE_DAYS) {
      return { valid: false, error: 'Date range cannot exceed ' + MAX_DATE_RANGE_DAYS + ' days.' };
    }

    // Set end to end of day for inclusive query
    var endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);

    return { valid: true, start: startNorm, end: endOfDay };
  }

  /**
   * Aggregates transaction items by item_code.
   * @param {Array} transactions - Array of transaction documents
   * @returns {Array} Aggregated items with totals
   * @private
   */
  function _aggregateSalesByItem(transactions) {
    var itemMap = {};

    for (var i = 0; i < transactions.length; i++) {
      var txn = transactions[i];
      var txnItems = txn.items || [];

      for (var j = 0; j < txnItems.length; j++) {
        var item = txnItems[j];
        var key = item.item_code || item.name || ('item_' + i + '_' + j);

        if (!itemMap[key]) {
          itemMap[key] = {
            item_code: item.item_code || '',
            item_name: item.name || '',
            total_qty_sold: 0,
            selling_price: item.unit_price || 0,
            cost_price: item.cost_price || 0
          };
        }
        itemMap[key].total_qty_sold += (item.qty || 0);
      }
    }

    var result = [];
    var keys = Object.keys(itemMap);
    for (var k = 0; k < keys.length; k++) {
      result.push(itemMap[keys[k]]);
    }

    return result;
  }

  /**
   * Generates a unique document number with format: {TYPE}-{YYYYMMDD}-{XXXX}
   * @param {string} docType - 'RFQ' or 'PO'
   * @returns {string} Unique document number
   * @private
   */
  function _generateDocNumber(docType) {
    var now = new Date();
    var datePart = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    var randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    return docType + '-' + datePart + '-' + randomPart;
  }

  // ─── UI Rendering ───────────────────────────────────────────────────────────

  /**
   * Renders the Sales Report UI in #screen-sales-report.
   * @private
   */
  function _renderSalesReportUI() {
    if (typeof document === 'undefined') return;

    var screen = document.querySelector('#screen-sales-report .screen-content');
    if (!screen) return;

    screen.innerHTML = '';

    // Header
    var header = document.createElement('h2');
    header.textContent = 'Sales Report';
    screen.appendChild(header);

    // Tab navigation
    var tabNav = document.createElement('div');
    tabNav.className = 'report-tabs';
    tabNav.setAttribute('role', 'tablist');

    var salesTab = _createTab('sales-tab', 'Sold Items', true);
    var eosTab = _createTab('eos-tab', 'End of Sale', false);
    var empTab = _createTab('emp-sales-tab', 'By Employee', false);
    tabNav.appendChild(salesTab);
    tabNav.appendChild(eosTab);
    tabNav.appendChild(empTab);
    screen.appendChild(tabNav);

    // Date range controls
    var dateControls = document.createElement('div');
    dateControls.className = 'report-date-controls';

    var startLabel = document.createElement('label');
    startLabel.textContent = 'Start Date: ';
    startLabel.setAttribute('for', 'sales-start-date');
    var startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.id = 'sales-start-date';
    startInput.className = 'form-input';

    var endLabel = document.createElement('label');
    endLabel.textContent = 'End Date: ';
    endLabel.setAttribute('for', 'sales-end-date');
    var endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.id = 'sales-end-date';
    endInput.className = 'form-input';

    var generateBtn = document.createElement('button');
    generateBtn.type = 'button';
    generateBtn.className = 'btn btn-primary';
    generateBtn.textContent = 'Generate Report';
    generateBtn.id = 'btn-generate-sales-report';

    dateControls.appendChild(startLabel);
    dateControls.appendChild(startInput);
    dateControls.appendChild(endLabel);
    dateControls.appendChild(endInput);
    dateControls.appendChild(generateBtn);
    screen.appendChild(dateControls);

    // Report content areas
    var salesContent = document.createElement('div');
    salesContent.id = 'sales-report-content';
    salesContent.className = 'report-panel active';
    screen.appendChild(salesContent);

    var eosContent = document.createElement('div');
    eosContent.id = 'eos-report-content';
    eosContent.className = 'report-panel';
    eosContent.style.display = 'none';
    screen.appendChild(eosContent);

    // By Employee content area
    var empContent = document.createElement('div');
    empContent.id = 'emp-sales-report-content';
    empContent.className = 'report-panel';
    empContent.style.display = 'none';
    screen.appendChild(empContent);

    // RFQ / PO buttons
    var actionBar = document.createElement('div');
    actionBar.className = 'report-actions';
    actionBar.id = 'sales-report-actions';
    actionBar.style.display = 'none';

    var rfqBtn = document.createElement('button');
    rfqBtn.type = 'button';
    rfqBtn.className = 'btn btn-secondary';
    rfqBtn.textContent = 'Generate RFQ';
    rfqBtn.id = 'btn-generate-rfq';

    var poBtn = document.createElement('button');
    poBtn.type = 'button';
    poBtn.className = 'btn btn-secondary';
    poBtn.textContent = 'Generate PO';
    poBtn.id = 'btn-generate-po';

    actionBar.appendChild(rfqBtn);
    actionBar.appendChild(poBtn);
    screen.appendChild(actionBar);

    // RFQ vendor-selection modal and compose modal
    _setupRFQModal(screen);
    _setupRFQComposeModal(screen);

    // Event listeners
    generateBtn.addEventListener('click', _handleGenerateSalesReport);
    rfqBtn.addEventListener('click', function () { _handleGenerateDoc('RFQ'); });
    poBtn.addEventListener('click', function () { _handleGenerateDoc('PO'); });

    salesTab.addEventListener('click', function () {
      _switchSalesTab('sales-tab', 'sales-report-content');
    });
    eosTab.addEventListener('click', function () {
      _switchSalesTab('eos-tab', 'eos-report-content');
    });
    empTab.addEventListener('click', function () {
      _switchSalesTab('emp-sales-tab', 'emp-sales-report-content');
    });
  }

  /**
   * Renders the Stock Report UI in #screen-stock-report.
   * @private
   */
  function _renderStockReportUI() {
    if (typeof document === 'undefined') return;

    var screen = document.querySelector('#screen-stock-report .screen-content');
    if (!screen) return;

    screen.innerHTML = '';

    // Header
    var header = document.createElement('h2');
    header.textContent = 'Stock Reports';
    screen.appendChild(header);

    // Tab navigation
    var tabNav = document.createElement('div');
    tabNav.className = 'report-tabs';
    tabNav.setAttribute('role', 'tablist');

    var stockTab = _createTab('stock-tab', 'Stock Verification', true);
    var reorderTab = _createTab('reorder-tab', 'Reorder Report', false);
    tabNav.appendChild(stockTab);
    tabNav.appendChild(reorderTab);
    screen.appendChild(tabNav);

    // Generate buttons
    var controlBar = document.createElement('div');
    controlBar.className = 'report-date-controls';

    var stockBtn = document.createElement('button');
    stockBtn.type = 'button';
    stockBtn.className = 'btn btn-primary';
    stockBtn.textContent = 'Generate Stock Report';
    stockBtn.id = 'btn-generate-stock-report';

    var reorderBtn = document.createElement('button');
    reorderBtn.type = 'button';
    reorderBtn.className = 'btn btn-primary';
    reorderBtn.textContent = 'Generate Reorder Report';
    reorderBtn.id = 'btn-generate-reorder-report';
    reorderBtn.style.display = 'none';

    controlBar.appendChild(stockBtn);
    controlBar.appendChild(reorderBtn);
    screen.appendChild(controlBar);

    // Report content areas
    var stockContent = document.createElement('div');
    stockContent.id = 'stock-report-content';
    stockContent.className = 'report-panel active';
    screen.appendChild(stockContent);

    var reorderContent = document.createElement('div');
    reorderContent.id = 'reorder-report-content';
    reorderContent.className = 'report-panel';
    reorderContent.style.display = 'none';
    screen.appendChild(reorderContent);

    // Event listeners
    stockBtn.addEventListener('click', _handleGenerateStockReport);
    reorderBtn.addEventListener('click', _handleGenerateReorderReport);

    stockTab.addEventListener('click', function () {
      _switchStockTab('stock-tab', 'stock-report-content', 'reorder-report-content',
        'btn-generate-stock-report', 'btn-generate-reorder-report');
    });
    reorderTab.addEventListener('click', function () {
      _switchStockTab('reorder-tab', 'reorder-report-content', 'stock-report-content',
        'btn-generate-reorder-report', 'btn-generate-stock-report');
    });
  }

  // ─── Missing Helper Functions ───────────────────────────────────────────────

  /**
   * Creates a tab button element for report navigation.
   * @param {string} id - Tab button ID
   * @param {string} label - Tab label text
   * @param {boolean} active - Whether this tab is active by default
   * @returns {HTMLElement} Button element
   * @private
   */
  function _createTab(id, label, active) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'report-tab' + (active ? ' active' : '');
    btn.textContent = label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    return btn;
  }

  /**
   * Switches between stock/reorder tabs.
   * @param {string} activeTabId - ID of the tab to activate
   * @param {string} showContentId - ID of content to show
   * @param {string} hideContentId - ID of content to hide
   * @param {string} showBtnId - ID of button to show
   * @param {string} hideBtnId - ID of button to hide
   * @private
   */
  function _switchStockTab(activeTabId, showContentId, hideContentId, showBtnId, hideBtnId) {
    // Update tab styles
    var activeTab = document.getElementById(activeTabId);
    if (activeTab) {
      var tabNav = activeTab.parentNode;
      if (tabNav) {
        var tabs = tabNav.querySelectorAll('.report-tab');
        tabs.forEach(function(tab) {
          tab.classList.remove('active');
          tab.setAttribute('aria-selected', 'false');
        });
      }
      activeTab.classList.add('active');
      activeTab.setAttribute('aria-selected', 'true');
    }

    // Show/hide content
    var showContent = document.getElementById(showContentId);
    var hideContent = document.getElementById(hideContentId);
    if (showContent) showContent.style.display = '';
    if (hideContent) hideContent.style.display = 'none';

    // Show/hide buttons
    var showBtn = document.getElementById(showBtnId);
    var hideBtn = document.getElementById(hideBtnId);
    if (showBtn) showBtn.style.display = '';
    if (hideBtn) hideBtn.style.display = 'none';
  }

  /**
   * Switches between sales report tabs (Sold Items / End of Sale / By Employee).
   * @param {string} activeTabId - ID of the tab button to activate
   * @param {string} showContentId - ID of the panel to show
   * @private
   */
  function _switchSalesTab(activeTabId, showContentId) {
    var panelIds = ['sales-report-content', 'eos-report-content', 'emp-sales-report-content'];
    var activeTab = document.getElementById(activeTabId);

    // Update tab button styles
    if (activeTab) {
      var tabNav = activeTab.parentNode;
      if (tabNav) {
        var allTabs = tabNav.querySelectorAll('.report-tab');
        allTabs.forEach(function (tab) {
          tab.classList.remove('active');
          tab.setAttribute('aria-selected', 'false');
        });
      }
      activeTab.classList.add('active');
      activeTab.setAttribute('aria-selected', 'true');
    }

    // Show/hide panels
    for (var i = 0; i < panelIds.length; i++) {
      var panel = document.getElementById(panelIds[i]);
      if (panel) {
        panel.style.display = (panelIds[i] === showContentId) ? '' : 'none';
      }
    }
  }

  // ─── Tab Switching ───────────────────────────────────────────────────────────

  /**
   * Switches between sales report tabs (Sold Items / End of Sale).
   * @param {string} activeTabId - ID of the tab button to activate
   * @param {string} showContentId - ID of the panel to show
   * @param {string} hideContentId - ID of the panel to hide
   * @private
   */
  function _switchTab(activeTabId, showContentId, hideContentId) {
    // Update tab button styles within the same parent
    var activeTab = document.getElementById(activeTabId);
    if (activeTab) {
      var tabNav = activeTab.parentNode;
      if (tabNav) {
        var allTabs = tabNav.querySelectorAll('.report-tab');
        allTabs.forEach(function (tab) {
          tab.classList.remove('active');
          tab.setAttribute('aria-selected', 'false');
        });
      }
      activeTab.classList.add('active');
      activeTab.setAttribute('aria-selected', 'true');
    }

    // Show/hide content panels
    var showContent = document.getElementById(showContentId);
    var hideContent = document.getElementById(hideContentId);
    if (showContent) { showContent.style.display = ''; }
    if (hideContent) { hideContent.style.display = 'none'; }
  }

  // ─── Event Handlers ─────────────────────────────────────────────────────────

  /**
   * Handles the "Generate Report" button for sales report.
   * Reads date inputs, calls getSalesReport/getEndOfSaleReport, and renders results.
   * @private
   */
  async function _handleGenerateSalesReport() {
    var startInput = document.getElementById('sales-start-date');
    var endInput = document.getElementById('sales-end-date');

    if (!startInput || !startInput.value || !endInput || !endInput.value) {
      Utils.showToast('Please select both start and end dates.', 'error');
      return;
    }

    var startDate = startInput.value;
    var endDate = endInput.value;

    // Generate sold items report
    var salesResult = await getSalesReport(startDate, endDate);
    var salesContainer = document.getElementById('sales-report-content');
    if (salesContainer) {
      if (!salesResult.success) {
        salesContainer.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(salesResult.error || 'Error') + '</p>';
      } else if (!salesResult.items || salesResult.items.length === 0) {
        salesContainer.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(salesResult.message || 'No sales found.') + '</p>';
      } else {
        var html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
        html += '<th>Item Code</th><th>Item Name</th><th>Qty Sold</th><th>Selling Price</th>';
        html += '</tr></thead><tbody>';
        for (var i = 0; i < salesResult.items.length; i++) {
          var item = salesResult.items[i];
          html += '<tr>';
          html += '<td>' + Utils.escapeHtml(item.item_code || '') + '</td>';
          html += '<td>' + Utils.escapeHtml(item.item_name || '') + '</td>';
          html += '<td>' + (item.total_qty_sold || 0) + '</td>';
          html += '<td>' + Utils.formatCurrency(item.selling_price) + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table></div>';
        salesContainer.innerHTML = html;

        // Show RFQ/PO action buttons
        var actionsBar = document.getElementById('sales-report-actions');
        if (actionsBar) actionsBar.style.display = '';
      }
    }

    // Generate end-of-sale report
    var eosResult = await getEndOfSaleReport(startDate, endDate);
    var eosContainer = document.getElementById('eos-report-content');
    if (eosContainer) {
      if (!eosResult.success) {
        eosContainer.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(eosResult.error || 'Error') + '</p>';
      } else {
        var eosHtml = '<div class="eos-summary">';
        eosHtml += '<p><strong>Total Transactions:</strong> ' + (eosResult.total_transactions || 0) + '</p>';
        eosHtml += '<p><strong>Total Revenue:</strong> ' + Utils.formatCurrency(eosResult.total_revenue || 0) + '</p>';
        eosHtml += '</div>';
        if (eosResult.items_sold && eosResult.items_sold.length > 0) {
          eosHtml += '<div class="table-wrapper"><table class="data-table"><thead><tr>';
          eosHtml += '<th>Item Code</th><th>Item Name</th><th>Total Qty Sold</th>';
          eosHtml += '</tr></thead><tbody>';
          for (var j = 0; j < eosResult.items_sold.length; j++) {
            var eosItem = eosResult.items_sold[j];
            eosHtml += '<tr>';
            eosHtml += '<td>' + Utils.escapeHtml(eosItem.item_code || '') + '</td>';
            eosHtml += '<td>' + Utils.escapeHtml(eosItem.item_name || '') + '</td>';
            eosHtml += '<td>' + (eosItem.total_qty_sold || 0) + '</td>';
            eosHtml += '</tr>';
          }
          eosHtml += '</tbody></table></div>';
        }
        eosContainer.innerHTML = eosHtml;
      }
    }

    // Generate "By Employee" report
    _handleGenerateByEmployeeReport(startDate, endDate);
  }

  /**
   * Handles the "Generate Stock Report" button.
   * @private
   */
  async function _handleGenerateStockReport() {
    var container = document.getElementById('stock-report-content');
    if (!container) return;

    var result = await getStockVerificationReport();
    if (!result.success) {
      container.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(result.error || 'Error') + '</p>';
      return;
    }

    if (!result.items || result.items.length === 0) {
      container.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(result.message || 'No items found.') + '</p>';
      return;
    }

    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
    html += '<th>Code</th><th>Type</th><th>Brand</th><th>Qty</th><th>Reorder Level</th><th>Status</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < result.items.length; i++) {
      var item = result.items[i];
      var statusClass = item.status === 'Out of Stock' ? 'danger' : (item.status === 'Low Stock' ? 'warning' : 'success');
      html += '<tr>';
      html += '<td>' + Utils.escapeHtml(item.item_code || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.category || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.brand || '') + '</td>';
      html += '<td>' + item.quantity + '</td>';
      html += '<td>' + (item.reorder_level || '-') + '</td>';
      html += '<td><span class="status-badge ' + statusClass + '">' + Utils.escapeHtml(item.status) + '</span></td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  /**
   * Handles the "Generate Reorder Report" button.
   * @private
   */
  async function _handleGenerateReorderReport() {
    var container = document.getElementById('reorder-report-content');
    if (!container) return;

    var result = await getReorderReport();
    if (!result.success) {
      container.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(result.error || 'Error') + '</p>';
      return;
    }

    if (!result.items || result.items.length === 0) {
      container.innerHTML = '<p class="empty-state">No items require reorder at this time.</p>';
      return;
    }

    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
    html += '<th>Code</th><th>Category</th><th>Brand</th><th>Qty</th><th>Reorder Level</th><th>Reorder Qty</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < result.items.length; i++) {
      var item = result.items[i];
      html += '<tr>';
      html += '<td>' + Utils.escapeHtml(item.item_code || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.category || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.brand || '') + '</td>';
      html += '<td>' + item.quantity + '</td>';
      html += '<td>' + item.reorder_level + '</td>';
      html += '<td>' + (item.reorder_qty || '-') + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  /**
  /**
   * Generates the "By Employee" sales report.
   * Groups line items by employee_code and shows items sold count and total sales amount.
   * @param {string} startDate
   * @param {string} endDate
   * @private
   */
  async function _handleGenerateByEmployeeReport(startDate, endDate) {
    var container = document.getElementById('emp-sales-report-content');
    if (!container) return;

    var validation = _validateDateRange(startDate, endDate);
    if (!validation.valid) {
      container.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(validation.error) + '</p>';
      return;
    }

    try {
      var transactions = await DataLayer.queryDocuments(COLLECTIONS.TRANSACTIONS, {
        where: [
          { field: 'date', op: '>=', value: validation.start },
          { field: 'date', op: '<=', value: validation.end }
        ]
      });

      if (!transactions || transactions.length === 0) {
        container.innerHTML = '<p class="empty-state">No sales found for the selected period.</p>';
        return;
      }

      // Group items by employee_code
      var empMap = {};
      for (var i = 0; i < transactions.length; i++) {
        var txnItems = transactions[i].items || [];
        for (var j = 0; j < txnItems.length; j++) {
          var item = txnItems[j];
          var empCode = item.employee_code || 'Unassigned';
          if (!empMap[empCode]) {
            empMap[empCode] = { items_sold: 0, total_amount: 0 };
          }
          empMap[empCode].items_sold += (item.qty || item.quantity || 0);
          empMap[empCode].total_amount += (item.line_total || 0);
        }
      }

      // Get employee names
      var employees = [];
      if (typeof Employee !== 'undefined' && Employee.getEmployees) {
        employees = await Employee.getEmployees();
      }
      var empNameMap = {};
      for (var k = 0; k < employees.length; k++) {
        empNameMap[employees[k].employee_code] = employees[k].name;
      }

      // Build table
      var keys = Object.keys(empMap);
      if (keys.length === 0) {
        container.innerHTML = '<p class="empty-state">No employee-wise data found.</p>';
        return;
      }

      var html = '<div class="table-wrapper"><table class="data-table" id="emp-sales-table"><thead><tr>';
      html += '<th>Employee Code</th><th>Employee Name</th><th>Items Sold</th><th>Total Sales</th>';
      html += '</tr></thead><tbody>';

      for (var m = 0; m < keys.length; m++) {
        var code = keys[m];
        var data = empMap[code];
        var empName = empNameMap[code] || (code === 'Unassigned' ? '(Unassigned)' : 'Unknown');
        html += '<tr>';
        html += '<td>' + Utils.escapeHtml(code) + '</td>';
        html += '<td>' + Utils.escapeHtml(empName) + '</td>';
        html += '<td>' + data.items_sold + '</td>';
        html += '<td>' + Utils.formatCurrency(data.total_amount) + '</td>';
        html += '</tr>';
      }

      html += '</tbody></table></div>';
      html += '<div class="mt-16"><button type="button" class="btn btn-secondary" id="emp-sales-print-btn">Print Report</button></div>';
      container.innerHTML = html;

      // Attach print handler
      var printBtn = document.getElementById('emp-sales-print-btn');
      if (printBtn) {
        printBtn.addEventListener('click', function () {
          _printEmployeeSalesReport(startDate, endDate);
        });
      }
    } catch (e) {
      container.innerHTML = '<p class="empty-state">Error: ' + Utils.escapeHtml(e.message) + '</p>';
    }
  }

  /**
   * Prints the employee sales report.
   * @param {string} startDate
   * @param {string} endDate
   * @private
   */
  function _printEmployeeSalesReport(startDate, endDate) {
    var table = document.getElementById('emp-sales-table');
    if (!table) {
      Utils.showToast('No report to print.', 'error');
      return;
    }

    var dateRange = startDate + ' to ' + endDate;
    var printHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    printHtml += '<title>Sales By Employee Report</title>';
    printHtml += '<style>body{font-family:sans-serif;font-size:12px;margin:20px;}';
    printHtml += 'table{width:100%;border-collapse:collapse;}';
    printHtml += 'th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}';
    printHtml += 'th{background:#f0f0f0;font-weight:bold;}';
    printHtml += 'h2{margin-bottom:4px;}p{margin:4px 0;}</style></head><body>';
    printHtml += '<h2>Sales By Employee Report</h2>';
    printHtml += '<p>Period: ' + Utils.escapeHtml(dateRange) + '</p>';
    printHtml += table.outerHTML;
    printHtml += '</body></html>';

    var printWindow = window.open('', '_blank', 'width=800,height=600');
    if (printWindow) {
      printWindow.document.write(printHtml);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  }

  // ─── RFQ Modal ──────────────────────────────────────────────────────────────

  function _setupRFQModal(screen) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div id="rfq-modal" class="modal-overlay" hidden>' +
        '<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="rfq-modal-title">' +
          '<h3 id="rfq-modal-title">Generate RFQ</h3>' +
          '<p class="rfq-modal-desc">How would you like to create the RFQ?</p>' +
          '<div class="rfq-type-options">' +
            '<div class="rfq-type-card" id="rfq-card-per" tabindex="0" role="button" aria-pressed="false">' +
              '<span class="rfq-card-icon">📦</span>' +
              '<span class="rfq-card-title">Per Vendor</span>' +
              '<span class="rfq-card-desc">One RFQ per vendor, grouped by each item\'s vendor code</span>' +
            '</div>' +
            '<div class="rfq-type-card" id="rfq-card-single" tabindex="0" role="button" aria-pressed="false">' +
              '<span class="rfq-card-icon">🏭</span>' +
              '<span class="rfq-card-title">Single Vendor</span>' +
              '<span class="rfq-card-desc">Choose one vendor — one RFQ for all items</span>' +
            '</div>' +
          '</div>' +
          '<div id="rfq-vendor-picker" hidden>' +
            '<div class="form-row" style="margin-top:14px;">' +
              '<label for="rfq-vendor-sel">Select Vendor *</label>' +
              '<select id="rfq-vendor-sel" class="form-input"><option value="">-- Select a vendor --</option></select>' +
            '</div>' +
          '</div>' +
          '<div class="form-actions">' +
            '<button type="button" id="rfq-confirm-btn" class="btn btn-primary" disabled>Generate</button>' +
            '<button type="button" id="rfq-cancel-btn" class="btn btn-cancel">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    screen.appendChild(wrapper.firstElementChild);

    var perCard    = document.getElementById('rfq-card-per');
    var singleCard = document.getElementById('rfq-card-single');
    var picker     = document.getElementById('rfq-vendor-picker');
    var vendorSel  = document.getElementById('rfq-vendor-sel');
    var confirmBtn = document.getElementById('rfq-confirm-btn');
    var cancelBtn  = document.getElementById('rfq-cancel-btn');

    function selectPer() {
      perCard.classList.add('rfq-card-selected');
      perCard.setAttribute('aria-pressed', 'true');
      singleCard.classList.remove('rfq-card-selected');
      singleCard.setAttribute('aria-pressed', 'false');
      picker.hidden = true;
      confirmBtn.disabled = false;
    }

    function selectSingle() {
      singleCard.classList.add('rfq-card-selected');
      singleCard.setAttribute('aria-pressed', 'true');
      perCard.classList.remove('rfq-card-selected');
      perCard.setAttribute('aria-pressed', 'false');
      picker.hidden = false;
      confirmBtn.disabled = vendorSel.value === '';
    }

    perCard.addEventListener('click', selectPer);
    perCard.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') selectPer(); });
    singleCard.addEventListener('click', selectSingle);
    singleCard.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') selectSingle(); });

    vendorSel.addEventListener('change', function () {
      if (singleCard.classList.contains('rfq-card-selected')) {
        confirmBtn.disabled = vendorSel.value === '';
      }
    });

    cancelBtn.addEventListener('click', _closeRFQModal);

    confirmBtn.addEventListener('click', function () {
      if (perCard.classList.contains('rfq-card-selected')) {
        _closeRFQModal();
        _handleRFQPerVendor();
      } else if (singleCard.classList.contains('rfq-card-selected')) {
        var code = vendorSel.value;
        if (!code) { Utils.showToast('Please select a vendor.', 'error'); return; }
        var name = vendorSel.options[vendorSel.selectedIndex].text;
        _closeRFQModal();
        _handleRFQSingleVendor(code, name);
      }
    });
  }

  function _openRFQModal() {
    var modal = document.getElementById('rfq-modal');
    if (!modal) return;

    var perCard    = document.getElementById('rfq-card-per');
    var singleCard = document.getElementById('rfq-card-single');
    var picker     = document.getElementById('rfq-vendor-picker');
    var confirmBtn = document.getElementById('rfq-confirm-btn');
    var vendorSel  = document.getElementById('rfq-vendor-sel');

    if (perCard)    { perCard.classList.remove('rfq-card-selected'); perCard.setAttribute('aria-pressed', 'false'); }
    if (singleCard) { singleCard.classList.remove('rfq-card-selected'); singleCard.setAttribute('aria-pressed', 'false'); }
    if (picker)     picker.hidden = true;
    if (confirmBtn) confirmBtn.disabled = true;

    if (vendorSel && typeof Vendor !== 'undefined' && Vendor.getAllVendors) {
      Vendor.getAllVendors().then(function (vendors) {
        var html = '<option value="">-- Select a vendor --</option>';
        for (var i = 0; i < vendors.length; i++) {
          html += '<option value="' + Utils.escapeHtml(vendors[i].vendor_code) + '">' +
            Utils.escapeHtml(vendors[i].vendor_code + ' — ' + vendors[i].name) + '</option>';
        }
        vendorSel.innerHTML = html;
      });
    }

    modal.hidden = false;
  }

  function _closeRFQModal() {
    var modal = document.getElementById('rfq-modal');
    if (modal) modal.hidden = true;
  }

  // ─── RFQ Compose Modal ───────────────────────────────────────────────────────

  function _setupRFQComposeModal(screen) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div id="rfq-compose-modal" class="rfq-compose-overlay" hidden>' +
        '<div class="rfq-compose-dialog" role="dialog" aria-modal="true" aria-labelledby="rfq-compose-title">' +
          '<div class="rfq-compose-header">' +
            '<h3 id="rfq-compose-title">Compose RFQ</h3>' +
            '<span id="rfq-compose-vendor-info" class="rfq-compose-vendor-info"></span>' +
          '</div>' +
          '<div class="rfq-compose-body">' +
            '<div class="form-row">' +
              '<label for="rfq-compose-message">Quote Request Message</label>' +
              '<textarea id="rfq-compose-message" class="rfq-compose-textarea" rows="6"></textarea>' +
            '</div>' +
            '<div class="rfq-compose-options">' +
              '<label class="rfq-toggle-label">' +
                '<input type="checkbox" id="rfq-hide-prices">' +
                '<span>Hide unit prices on PDF</span>' +
              '</label>' +
            '</div>' +
            '<div id="rfq-compose-preview" class="rfq-compose-preview"></div>' +
          '</div>' +
          '<div class="rfq-compose-footer">' +
            '<button type="button" id="rfq-compose-save" class="btn btn-secondary">💾 Save to Firestore</button>' +
            '<button type="button" id="rfq-compose-print" class="btn btn-primary">🖨️ Print PDF</button>' +
            '<button type="button" id="rfq-compose-wa" class="btn btn-whatsapp">💬 WhatsApp</button>' +
            '<button type="button" id="rfq-compose-cancel" class="btn btn-cancel">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    screen.appendChild(wrapper.firstElementChild);

    document.getElementById('rfq-hide-prices').addEventListener('change', function () {
      _renderRFQComposePreview(_rfqPendingGroups, this.checked);
    });
    document.getElementById('rfq-compose-save').addEventListener('click', function () {
      _rfqSaveToFirestore(_rfqPendingGroups);
    });
    document.getElementById('rfq-compose-print').addEventListener('click', function () {
      _rfqPrintPreview(_rfqPendingGroups, _getRFQComposeOptions());
    });
    document.getElementById('rfq-compose-wa').addEventListener('click', function () {
      _rfqShareWhatsApp(_rfqPendingGroups, _getRFQComposeOptions());
    });
    document.getElementById('rfq-compose-cancel').addEventListener('click', _closeRFQComposeModal);
  }

  function _openRFQComposeModal(groups) {
    _rfqPendingGroups = groups;

    var info = document.getElementById('rfq-compose-vendor-info');
    if (info) {
      info.textContent = groups.length === 1
        ? groups[0].vendorInfo.vendor_name + ' (' + groups[0].vendorInfo.vendor_code + ')'
        : groups.length + ' vendors';
    }

    var msgArea = document.getElementById('rfq-compose-message');
    if (msgArea) {
      var storeInfo = (typeof Settings !== 'undefined' && Settings.getStoreInfo) ? Settings.getStoreInfo() : {};
      var storeName = storeInfo.store_name || '';
      var greeting = groups.length === 1 ? groups[0].vendorInfo.vendor_name : 'Sir/Madam';
      msgArea.value =
        'Dear ' + greeting + ',\n\n' +
        'We kindly request you to provide your best quotation for the items listed below. ' +
        'Please include the unit price, availability, and expected delivery date for each item.\n\n' +
        'Kindly respond at your earliest convenience.\n\n' +
        'Thank you.\n\nRegards,\n' + (storeName || 'Our Company');
    }

    var hp = document.getElementById('rfq-hide-prices');
    if (hp) hp.checked = false;

    _renderRFQComposePreview(groups, false);
    document.getElementById('rfq-compose-modal').hidden = false;
  }

  function _closeRFQComposeModal() {
    var modal = document.getElementById('rfq-compose-modal');
    if (modal) modal.hidden = true;
  }

  function _getRFQComposeOptions() {
    var msg = document.getElementById('rfq-compose-message');
    var hp  = document.getElementById('rfq-hide-prices');
    return {
      message:    msg ? msg.value : '',
      hidePrices: hp  ? hp.checked : false
    };
  }

  function _renderRFQComposePreview(groups, hidePrices) {
    var container = document.getElementById('rfq-compose-preview');
    if (!container) return;
    var html = '';
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      html += '<div class="rfq-preview-group">';
      if (groups.length > 1) {
        html += '<div class="rfq-preview-group-header">' +
          Utils.escapeHtml(g.vendorInfo.vendor_name) + ' (' + Utils.escapeHtml(g.vendorInfo.vendor_code) + ')' +
          '</div>';
      }
      html += '<div class="inv-table-container table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Item Code</th><th>Item Name</th><th>Qty</th>';
      if (!hidePrices) html += '<th>Cost Price</th><th>Total</th>';
      html += '</tr></thead><tbody>';
      var total = 0;
      for (var j = 0; j < g.lineItems.length; j++) {
        var item = g.lineItems[j];
        var lt = (item.qty || 0) * (item.unit_price || 0);
        total += lt;
        html += '<tr><td>' + Utils.escapeHtml(item.item_code || '') + '</td>' +
          '<td>' + Utils.escapeHtml(item.item_name || '') + '</td>' +
          '<td style="text-align:right">' + (item.qty || 0) + '</td>';
        if (!hidePrices) {
          html += '<td style="text-align:right">' + Utils.formatCurrency(item.unit_price || 0) + '</td>' +
            '<td style="text-align:right">' + Utils.formatCurrency(lt) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody>';
      if (!hidePrices) {
        html += '<tfoot><tr><td colspan="3"></td>' +
          '<td style="text-align:right"><strong>Total</strong></td>' +
          '<td style="text-align:right"><strong>' + Utils.formatCurrency(Math.round(total * 100) / 100) + '</strong></td>' +
          '</tr></tfoot>';
      }
      html += '</table></div></div>';
    }
    container.innerHTML = html;
  }

  async function _rfqSaveToFirestore(groups) {
    var btn = document.getElementById('rfq-compose-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var created = 0, failed = 0;
    for (var i = 0; i < groups.length; i++) {
      var result = await saveDocument('RFQ', groups[i].lineItems, groups[i].vendorInfo);
      if (result.success) { groups[i].savedDocNumber = result.doc_number; created++; }
      else failed++;
    }
    if (btn) { btn.disabled = false; btn.textContent = created > 0 ? '✅ Saved' : '💾 Save to Firestore'; }
    if (created > 0) {
      Utils.showToast(created + ' RFQ' + (created > 1 ? 's' : '') + ' saved.' + (failed > 0 ? ' ' + failed + ' failed.' : ''), 'success');
    } else {
      Utils.showToast('Failed to save.', 'error');
    }
  }

  function _rfqPrintPreview(groups, options) {
    var storeInfo = (typeof Settings !== 'undefined' && Settings.getStoreInfo) ? Settings.getStoreInfo() : {};
    var storeName   = storeInfo.store_name    || 'Our Company';
    var storeAddr   = storeInfo.store_address || '';
    var storePhone  = storeInfo.store_phone   || '';
    var today       = new Date().toLocaleDateString();
    var waText      = _buildWhatsAppText(groups, options, storeName, storePhone, today);

    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>Request for Quotation</title><style>' + _getRFQPrintCSS() + '</style></head><body>' +
      '<div class="print-controls">' +
        '<button class="btn-print" onclick="window.print()">🖨️ Print / Save PDF</button>' +
        '<button class="btn-wa" onclick="shareWA()">💬 Share via WhatsApp</button>' +
        '<button class="btn-cls" onclick="window.close()">✕ Close</button>' +
        '<span class="print-hint">In print dialog → choose "Save as PDF" as destination</span>' +
      '</div>';

    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var docNum = g.savedDocNumber || ('RFQ-DRAFT-' + (i + 1));
      var msg = _escPrint(options.message);
      html += '<div class="rfq-page">' +
        '<div class="rfq-hdr">' +
          '<div class="rfq-company">' +
            '<h1>' + _escPrint(storeName) + '</h1>' +
            (storeAddr  ? '<p>' + _escPrint(storeAddr)  + '</p>' : '') +
            (storePhone ? '<p>' + _escPrint(storePhone) + '</p>' : '') +
          '</div>' +
          '<div class="rfq-meta">' +
            '<div class="rfq-doc-type">REQUEST FOR QUOTATION</div>' +
            '<p><b>Doc No:</b> ' + _escPrint(docNum) + '</p>' +
            '<p><b>Date:</b> '   + _escPrint(today)  + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="rfq-to"><b>To:</b> ' +
          _escPrint(g.vendorInfo.vendor_name) +
          (g.vendorInfo.vendor_code ? ' (' + _escPrint(g.vendorInfo.vendor_code) + ')' : '') +
        '</div>' +
        (msg ? '<div class="rfq-msg">' + msg + '</div>' : '') +
        '<table><thead><tr>' +
          '<th>#</th><th>Item Code</th><th>Item Name</th><th class="r">Qty</th>' +
          (!options.hidePrices ? '<th class="r">Unit Price</th><th class="r">Line Total</th>' : '') +
        '</tr></thead><tbody>';

      var total = 0;
      for (var j = 0; j < g.lineItems.length; j++) {
        var li = g.lineItems[j];
        var lt = (li.qty || 0) * (li.unit_price || 0);
        total += lt;
        html += '<tr>' +
          '<td>' + (j + 1) + '</td>' +
          '<td>' + _escPrint(li.item_code || '') + '</td>' +
          '<td>' + _escPrint(li.item_name || '') + '</td>' +
          '<td class="r">' + (li.qty || 0) + '</td>';
        if (!options.hidePrices) {
          html += '<td class="r">&#8377;' + (li.unit_price || 0).toFixed(2) + '</td>' +
            '<td class="r">&#8377;' + lt.toFixed(2) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody>';
      if (!options.hidePrices) {
        html += '<tfoot><tr>' +
          '<td colspan="4"></td>' +
          '<td class="r"><b>Total</b></td>' +
          '<td class="r"><b>&#8377;' + (Math.round(total * 100) / 100).toFixed(2) + '</b></td>' +
          '</tr></tfoot>';
      }
      html += '</table>' +
        '<div class="rfq-footer">' +
          '<span>This is a Request for Quotation only — not a purchase order.</span>' +
          '<span>' + _escPrint(storeName) + (storePhone ? ' | ' + _escPrint(storePhone) : '') + '</span>' +
        '</div>' +
        '</div>';
    }

    html += '<scr' + 'ipt>var _wa=' + JSON.stringify(waText) + ';' +
      'function shareWA(){' +
        'if(navigator.share){navigator.share({title:"RFQ",text:_wa}).catch(function(){});}' +
        'else{window.open("https://wa.me/?text="+encodeURIComponent(_wa),"_blank");}' +
      '}' +
      '</scr' + 'ipt></body></html>';

    var win = window.open('', '_blank', 'width=960,height=720,menubar=yes,toolbar=yes,scrollbars=yes');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
    } else {
      Utils.showToast('Please allow popups to preview the PDF.', 'error');
    }
  }

  function _rfqShareWhatsApp(groups, options) {
    var storeInfo  = (typeof Settings !== 'undefined' && Settings.getStoreInfo) ? Settings.getStoreInfo() : {};
    var storeName  = storeInfo.store_name  || 'Our Company';
    var storePhone = storeInfo.store_phone || '';
    var today      = new Date().toLocaleDateString();
    var text = _buildWhatsAppText(groups, options, storeName, storePhone, today);
    if (navigator.share) {
      navigator.share({ title: 'Request for Quotation', text: text }).catch(function () {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  }

  function _buildWhatsAppText(groups, options, storeName, storePhone, today) {
    var lines = ['*REQUEST FOR QUOTATION*', 'Date: ' + today, ''];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var docNum = g.savedDocNumber || '';
      if (groups.length > 1) {
        lines.push('*Vendor: ' + g.vendorInfo.vendor_name + ' (' + g.vendorInfo.vendor_code + ')*');
      }
      if (docNum) lines.push('Doc No: ' + docNum);
      if (options.message) { lines.push(''); lines.push(options.message); }
      lines.push('');
      lines.push('*Items:*');
      var total = 0;
      for (var j = 0; j < g.lineItems.length; j++) {
        var li = g.lineItems[j];
        var lt = (li.qty || 0) * (li.unit_price || 0);
        total += lt;
        var line = (j + 1) + '. ' + li.item_name + ' (' + li.item_code + ') — Qty: ' + li.qty;
        if (!options.hidePrices) line += ' @ ₹' + (li.unit_price || 0).toFixed(2);
        lines.push(line);
      }
      if (!options.hidePrices) {
        lines.push('*Total: ₹' + (Math.round(total * 100) / 100).toFixed(2) + '*');
      }
      lines.push('');
    }
    lines.push('Regards,');
    lines.push(storeName + (storePhone ? ' | ' + storePhone : ''));
    return lines.join('\n');
  }

  function _getRFQPrintCSS() {
    return '@page{margin:18mm 14mm}' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111;background:#fff}' +
      '.rfq-page{padding:0;page-break-after:always}' +
      '.rfq-page:last-child{page-break-after:avoid}' +
      '.rfq-hdr{display:flex;justify-content:space-between;align-items:flex-start;' +
        'border-bottom:2.5px solid #222;padding-bottom:14px;margin-bottom:18px;gap:16px}' +
      '.rfq-company h1{font-size:17pt;font-weight:800;margin-bottom:5px}' +
      '.rfq-company p{font-size:9.5pt;color:#555;margin-top:2px}' +
      '.rfq-meta{text-align:right;flex-shrink:0}' +
      '.rfq-doc-type{font-size:14pt;font-weight:700;color:#222;margin-bottom:6px;letter-spacing:.04em}' +
      '.rfq-meta p{font-size:10pt;margin-top:3px}' +
      '.rfq-to{margin:14px 0;padding:10px 14px;background:#f5f5f5;border-left:4px solid #333;font-size:10.5pt}' +
      '.rfq-msg{margin:16px 0;font-size:10.5pt;white-space:pre-wrap;line-height:1.65;color:#222}' +
      'table{width:100%;border-collapse:collapse;margin-top:18px}' +
      'thead th{background:#333;color:#fff;padding:8px 10px;text-align:left;font-size:10pt;font-weight:600}' +
      'tbody td{padding:7px 10px;border-bottom:1px solid #ddd;font-size:10pt}' +
      'tbody tr:nth-child(even) td{background:#f9f9f9}' +
      'tfoot td{padding:8px 10px;font-size:10.5pt;border-top:2px solid #333}' +
      '.r{text-align:right}' +
      '.rfq-footer{display:flex;justify-content:space-between;border-top:1px solid #ccc;' +
        'margin-top:28px;padding-top:10px;font-size:9pt;color:#777}' +
      '.print-controls{display:flex;gap:10px;align-items:center;background:#f0f4ff;' +
        'padding:10px 16px;border-bottom:1px solid #bbd;margin-bottom:20px;flex-wrap:wrap}' +
      '.print-controls button{padding:8px 14px;cursor:pointer;border:none;border-radius:6px;' +
        'font-size:12px;font-weight:600}' +
      '.btn-print{background:#6200ea;color:#fff}' +
      '.btn-wa{background:#25D366;color:#fff}' +
      '.btn-cls{background:#e0e0e0;color:#333}' +
      '.print-hint{margin-left:auto;font-size:10px;color:#888;font-style:italic}' +
      '@media print{.print-controls{display:none!important}}';
  }

  function _escPrint(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function _lookupItemVendors(itemCodes) {
    var result = {};
    try {
      var allItems = await DataLayer.queryDocuments(COLLECTIONS.ITEMS, {});
      var vendorNameMap = {};
      if (typeof Vendor !== 'undefined' && Vendor.getAllVendors) {
        var vendors = await Vendor.getAllVendors();
        for (var v = 0; v < vendors.length; v++) {
          vendorNameMap[vendors[v].vendor_code] = vendors[v].name;
        }
      }
      for (var i = 0; i < allItems.length; i++) {
        var itm = allItems[i];
        if (itm.vendor_code && itemCodes.indexOf(itm.item_code) !== -1) {
          result[itm.item_code] = {
            vendor_code: itm.vendor_code,
            vendor_name: vendorNameMap[itm.vendor_code] || itm.vendor_code
          };
        }
      }
    } catch (e) { /* silently ignore */ }
    return result;
  }

  async function _handleRFQPerVendor() {
    Utils.showToast('Looking up vendor info…', 'info');
    var itemCodes = _salesReportData.map(function (i) { return i.item_code; });
    var vendorLookup = await _lookupItemVendors(itemCodes);

    var vendorGroupMap = {};
    for (var i = 0; i < _salesReportData.length; i++) {
      var item = _salesReportData[i];
      var vi = vendorLookup[item.item_code] || { vendor_code: 'UNKNOWN', vendor_name: 'Unknown Vendor' };
      if (!vendorGroupMap[vi.vendor_code]) {
        vendorGroupMap[vi.vendor_code] = { vendorInfo: vi, items: [] };
      }
      vendorGroupMap[vi.vendor_code].items.push(item);
    }

    var groups = [];
    var codes = Object.keys(vendorGroupMap);
    for (var j = 0; j < codes.length; j++) {
      var g = vendorGroupMap[codes[j]];
      var doc = generateRFQ(g.items);
      if (doc.success) groups.push({ vendorInfo: g.vendorInfo, lineItems: doc.line_items, savedDocNumber: null });
    }

    if (groups.length === 0) {
      Utils.showToast('No valid items to generate RFQ.', 'error');
      return;
    }
    _openRFQComposeModal(groups);
  }

  async function _handleRFQSingleVendor(vendorCode, vendorName) {
    var doc = generateRFQ(_salesReportData);
    if (!doc.success) {
      Utils.showToast(doc.error || 'Failed to generate RFQ.', 'error');
      return;
    }
    _openRFQComposeModal([{ vendorInfo: { vendor_code: vendorCode, vendor_name: vendorName }, lineItems: doc.line_items, savedDocNumber: null }]);
  }

  /**
   * Handles RFQ/PO document generation.
   * @param {string} docType - 'RFQ' or 'PO'
   * @private
   */
  async function _handleGenerateDoc(docType) {
    if (!_salesReportData || _salesReportData.length === 0) {
      Utils.showToast('Generate a sales report first before creating ' + docType + '.', 'error');
      return;
    }

    if (docType === 'RFQ') {
      _openRFQModal();
      return;
    }

    // PO: direct generation without vendor dialog
    var doc = generatePO(_salesReportData);
    if (!doc.success) {
      Utils.showToast(doc.error || 'Failed to generate PO.', 'error');
      return;
    }

    var saveResult = await saveDocument('PO', doc.line_items, null);
    if (saveResult.success) {
      Utils.showToast('PO ' + saveResult.doc_number + ' saved successfully.', 'success');
    } else {
      Utils.showToast(saveResult.error || 'Failed to save PO.', 'error');
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    getSalesReport: getSalesReport,
    getStockVerificationReport: getStockVerificationReport,
    getEndOfSaleReport: getEndOfSaleReport,
    getReorderReport: getReorderReport,
    generateRFQ: generateRFQ,
    generatePO: generatePO,
    saveDocument: saveDocument
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Reports;
}
