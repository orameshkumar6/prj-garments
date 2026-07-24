/**
 * Cloth Shop Firebase - Reports Module
 * Sales reports, stock verification, end-of-sale reports, re-order reports, RFQ/PO generation.
 */
var Reports = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _salesReportData = [];
  var _stockReportData = [];
  var _reorderReportData = [];

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
  async function saveDocument(docType, lineItems) {
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
      total: total
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
    tabNav.appendChild(salesTab);
    tabNav.appendChild(eosTab);
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

    // Event listeners
    generateBtn.addEventListener('click', _handleGenerateSalesReport);
    rfqBtn.addEventListener('click', function () { _handleGenerateDoc('RFQ'); });
    poBtn.addEventListener('click', function () { _handleGenerateDoc('PO'); });

    salesTab.addEventListener('click', function () {
      _switchTab('sales-tab', 'sales-report-content', 'eos-report-content');
    });
    eosTab.addEventListener('click', function () {
      _switchTab('eos-tab', 'eos-report-content', 'sales-report-content');
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
