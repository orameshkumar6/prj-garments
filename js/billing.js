/**
 * Cloth Shop Firebase - Billing Module
 * Bill creation, GST calculation, savings calculation, bill formatting, print orchestration.
 * Uses Settings for config values, Utils for formatting/toasts/escaping, Printer for print output.
 */
var Billing = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _lineItems = [];
  var _billCounter = 0;
  var _activeEmployees = [];

  // ─── Line Item Management ───────────────────────────────────────────────────

  /**
   * Adds an item to the current bill.
   * @param {object} item - Item object with item_code, item_type, brand, mrp, sales_price, quantity (available stock)
   * @param {number} quantity - Quantity to bill (must be positive integer)
   * @returns {{success: boolean, error?: string}}
   */
  function addLineItem(item, quantity) {
    if (!item || typeof item !== 'object') {
      return { success: false, error: 'Invalid item.' };
    }

    var qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return { success: false, error: 'Quantity must be a positive integer.' };
    }

    if (!item.sales_price || Number(item.sales_price) <= 0) {
      return { success: false, error: 'Item must have a valid sales price.' };
    }

    var salesPrice = Number(item.sales_price);
    var mrp = Number(item.mrp) || salesPrice;
    var lineTotal = Utils.roundTo2(salesPrice * qty);

    _lineItems.push({
      item_code: item.item_code || '',
      item_type: item.item_type || '',
      brand: item.brand || '',
      mrp: mrp,
      sales_price: salesPrice,
      quantity: qty,
      line_total: lineTotal,
      employee_code: item.employee_code || ''
    });

    _updateUI();
    return { success: true };
  }

  /**
   * Removes a line item at the given index.
   * @param {number} index - Zero-based index of the line item to remove
   * @returns {{success: boolean, error?: string}}
   */
  function removeLineItem(index) {
    var idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= _lineItems.length) {
      return { success: false, error: 'Invalid line item index.' };
    }

    _lineItems.splice(idx, 1);
    _updateUI();
    return { success: true };
  }

  /**
   * Returns a copy of the current line items array.
   * @returns {Array<object>}
   */
  function getLineItems() {
    return _lineItems.slice();
  }

  /**
   * Resets all line items and totals, clearing the current bill.
   */
  function clearBill() {
    _lineItems = [];
    _updateUI();
  }

  // ─── Calculations ─────────────────────────────────────────────────────────

  /**
   * Calculates the subtotal of all line items.
   * @returns {number} Sum of all line totals, rounded to 2 decimal places
   */
  function calculateSubtotal() {
    var sum = 0;
    for (var i = 0; i < _lineItems.length; i++) {
      sum += _lineItems[i].line_total;
    }
    return Utils.roundTo2(sum);
  }

  /**
   * Calculates GST amount from subtotal and rate.
   * @param {number} subtotal - Bill subtotal
   * @param {number} gstRate - GST percentage (0-100)
   * @returns {number} GST amount rounded to 2 decimal places
   */
  function calculateGST(subtotal, gstRate) {
    var sub = Number(subtotal) || 0;
    var rate = Number(gstRate) || 0;
    return Utils.roundTo2(sub * rate / 100);
  }

  /**
   * Calculates total savings for all line items.
   * Savings = sum((mrp - salesPrice) × qty) for all items, result ≥ 0.
   * @param {Array<object>} lineItems - Array of line item objects
   * @returns {number} Total savings rounded to 2 decimal places, minimum 0
   */
  function calculateSavings(lineItems) {
    var items = lineItems || _lineItems;
    var totalSavings = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var mrp = Number(item.mrp) || 0;
      var sp = Number(item.sales_price) || 0;
      var qty = Number(item.quantity) || 0;
      totalSavings += (mrp - sp) * qty;
    }
    var result = Utils.roundTo2(totalSavings);
    return result >= 0 ? result : 0;
  }

  // ─── Bill Number Generation ───────────────────────────────────────────────

  /**
   * Generates a sequential unique bill number in format "B-YYYYMMDD-NNN".
   * @returns {string} Bill number string
   */
  function generateBillNumber() {
    _billCounter++;
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var seq = String(_billCounter).padStart(3, '0');
    return 'B-' + year + month + day + '-' + seq;
  }

  // ─── Bill Formatting ──────────────────────────────────────────────────────

  /**
   * Composes a formatted bill object from bill data.
   * Includes header (store info), metadata (bill number, date, time),
   * line items, subtotal, GST, total, savings, and footer.
   * @param {object} billData - Object with billNumber, lineItems, subtotal, gstRate, gstAmount, total, savings
   * @returns {object} Formatted bill object with header, metadata, items, totals, footer
   */
  function formatBill(billData) {
    var storeInfo = (typeof Settings !== 'undefined' && Settings.getStoreInfo)
      ? Settings.getStoreInfo()
      : { store_name: '', store_address: '', store_phone: '' };

    var footer = (typeof Settings !== 'undefined' && Settings.getBillFooter)
      ? Settings.getBillFooter()
      : 'Thank you for your purchase!';

    var now = billData.date ? new Date(billData.date) : new Date();
    var dateStr = Utils.formatDate(now, 'DD-MMM-YYYY');
    var timeStr = String(now.getHours()).padStart(2, '0') + ':' +
                  String(now.getMinutes()).padStart(2, '0') + ':' +
                  String(now.getSeconds()).padStart(2, '0');

    return {
      header: {
        store_name: storeInfo.store_name,
        store_address: storeInfo.store_address,
        store_phone: storeInfo.store_phone
      },
      metadata: {
        bill_number: billData.billNumber || '',
        date: dateStr,
        time: timeStr
      },
      items: (billData.lineItems || []).map(function (item) {
        return {
          name: item.item_type || item.item_code || '',
          quantity: item.quantity,
          mrp: item.mrp,
          sales_price: item.sales_price,
          line_total: item.line_total,
          employee_code: item.employee_code || ''
        };
      }),
      totals: {
        subtotal: billData.subtotal || 0,
        gst_rate: billData.gstRate || 0,
        gst_amount: billData.gstAmount || 0,
        total: billData.total || 0,
        savings: billData.savings || 0
      },
      footer: footer
    };
  }

  // ─── Printing ─────────────────────────────────────────────────────────────

  /**
   * Orchestrates bill printing via Printer module if available, otherwise browser print.
   * @param {object} billData - Formatted bill object from formatBill()
   */
  function printBill(billData) {
    if (!billData) return;

    var formatted = billData;
    var htmlContent = _buildPrintHTML(formatted);

    if (typeof Printer !== 'undefined' && Printer.print) {
      Printer.print(htmlContent, { type: 'bill' });
    } else {
      _browserPrint(htmlContent);
    }
  }

  /**
   * Opens a new window with bill HTML and invokes browser print.
   * @param {string} htmlContent - HTML string to print
   * @private
   */
  function _browserPrint(htmlContent) {
    if (typeof window === 'undefined') return;

    var printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  }

  /**
   * Builds printable HTML from a formatted bill object.
   * @param {object} bill - Formatted bill from formatBill()
   * @returns {string} HTML string
   * @private
   */
  function _buildPrintHTML(bill) {
    var esc = Utils.escapeHtml;
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<title>Bill - ' + esc(bill.metadata.bill_number) + '</title>';
    html += '<style>body{font-family:monospace;font-size:12px;margin:10px;}';
    html += '.center{text-align:center;}.right{text-align:right;}';
    html += 'table{width:100%;border-collapse:collapse;}';
    html += 'th,td{padding:2px 4px;text-align:left;}';
    html += '.line{border-top:1px dashed #000;margin:4px 0;}';
    html += '</style></head><body>';

    // Header
    html += '<div class="center">';
    if (bill.header.store_name) {
      html += '<strong>' + esc(bill.header.store_name) + '</strong><br>';
    }
    if (bill.header.store_address) {
      html += esc(bill.header.store_address) + '<br>';
    }
    if (bill.header.store_phone) {
      html += 'Ph: ' + esc(bill.header.store_phone) + '<br>';
    }
    html += '</div>';

    // Metadata
    html += '<div class="line"></div>';
    html += '<div>Bill No: ' + esc(bill.metadata.bill_number) + '<br>';
    html += 'Date: ' + esc(bill.metadata.date) + '  Time: ' + esc(bill.metadata.time) + '</div>';
    html += '<div class="line"></div>';

    // Line items table
    html += '<table><thead><tr>';
    html += '<th>Item</th><th>Qty</th><th>MRP</th><th>Price</th><th>Total</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < bill.items.length; i++) {
      var item = bill.items[i];
      html += '<tr>';
      html += '<td>' + esc(String(item.name)) + '</td>';
      html += '<td>' + item.quantity + '</td>';
      html += '<td>' + Utils.formatCurrency(item.mrp) + '</td>';
      html += '<td>' + Utils.formatCurrency(item.sales_price) + '</td>';
      html += '<td>' + Utils.formatCurrency(item.line_total) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    // Totals
    html += '<div class="line"></div>';
    html += '<div class="right">Subtotal: ' + Utils.formatCurrency(bill.totals.subtotal) + '</div>';
    html += '<div class="right">GST (' + bill.totals.gst_rate + '%): ' + Utils.formatCurrency(bill.totals.gst_amount) + '</div>';
    html += '<div class="right"><strong>Total: ' + Utils.formatCurrency(bill.totals.total) + '</strong></div>';

    // Savings (only if > 0)
    if (bill.totals.savings > 0) {
      html += '<div class="right">You saved: ' + Utils.formatCurrency(bill.totals.savings) + '</div>';
    }

    // Footer
    html += '<div class="line"></div>';
    html += '<div class="center">' + esc(bill.footer) + '</div>';
    html += '</body></html>';

    return html;
  }

  // ─── Complete Sale ────────────────────────────────────────────────────────

  /**
   * Validates non-empty bill, builds bill data, calls SalesEngine.processSale() if available.
   * @returns {Promise<{success: boolean, billData?: object, error?: string}>}
   */
  async function completeSale() {
    if (_lineItems.length === 0) {
      Utils.showToast('Cannot complete sale: bill is empty.', 'error');
      return { success: false, error: 'Bill is empty.' };
    }

    var gstRate = (typeof Settings !== 'undefined' && Settings.getGSTRate)
      ? Settings.getGSTRate()
      : 0;

    var subtotal = calculateSubtotal();
    var gstAmount = calculateGST(subtotal, gstRate);
    var total = Utils.roundTo2(subtotal + gstAmount);
    var savings = calculateSavings(_lineItems);
    var billNumber = generateBillNumber();

    var billData = {
      billNumber: billNumber,
      date: new Date(),
      lineItems: getLineItems(),
      subtotal: subtotal,
      gstRate: gstRate,
      gstAmount: gstAmount,
      total: total,
      savings: savings
    };

    // Call SalesEngine if available
    if (typeof SalesEngine !== 'undefined' && SalesEngine.processSale) {
      try {
        var result = await SalesEngine.processSale(billData.lineItems, {
          bill_number: billNumber,
          date: billData.date,
          subtotal: subtotal,
          gst_rate: gstRate,
          gst_amount: gstAmount,
          total: total,
          savings: savings
        });

        if (!result || !result.success) {
          var errMsg = (result && result.error) ? result.error : 'Sale processing failed.';
          Utils.showToast(errMsg, 'error');
          return { success: false, error: errMsg };
        }
      } catch (e) {
        Utils.showToast('Sale processing error: ' + e.message, 'error');
        return { success: false, error: e.message };
      }
    }

    // Format and print
    var formattedBill = formatBill(billData);
    Utils.showToast('Sale completed! Bill #' + billNumber, 'success');
    clearBill();

    return { success: true, billData: formattedBill };
  }

  // ─── UI Rendering ───────────────────────────────────────────────────────────

  /**
   * Initializes the billing module — renders billing UI in #screen-billing .screen-content.
   * Includes: item search/select, line items table, running totals, complete sale button, print button.
   */
  function init() {
    _loadActiveEmployees();
    _renderUI();
  }

  /**
   * Loads active employees for the employee dropdown.
   * @private
   */
  async function _loadActiveEmployees() {
    if (typeof Employee !== 'undefined' && Employee.getActiveEmployees) {
      try {
        _activeEmployees = await Employee.getActiveEmployees();
      } catch (e) {
        _activeEmployees = [];
      }
    }
  }

  /**
   * Renders the billing screen UI.
   * @private
   */
  function _renderUI() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-billing .screen-content');
    if (!container) return;

    var html = '';

    // ── Barcode Scanner Input Section ──
    html += '<div class="billing-section billing-barcode-section">';
    html += '<input type="text" id="billing-barcode-input" class="form-input" ';
    html += 'placeholder="Scan barcode or enter item code..." autofocus aria-label="Barcode scanner input" />';
    html += '</div>';

    // ── Item Search/Add Section ──
    html += '<div class="billing-section billing-add">';
    html += '<h2 class="section-heading">Add Items to Bill</h2>';
    html += '<div class="form-row">';
    html += '<div class="form-group form-group-grow">';
    html += '<label for="billing-item-search">Search Item</label>';
    html += '<input type="text" id="billing-item-search" class="form-input" ';
    html += 'placeholder="Type item code, type, or brand..." autocomplete="off" />';
    html += '<div id="billing-search-results" class="search-results-dropdown"></div>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="billing-item-qty">Qty</label>';
    html += '<input type="number" id="billing-item-qty" class="form-input" ';
    html += 'min="1" value="1" style="width:80px;" />';
    html += '</div>';
    html += '<div class="form-group form-group-btn">';
    html += '<button id="billing-add-btn" class="btn btn-primary" type="button">Add</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // ── Line Items Table ──
    html += '<div class="billing-section billing-items">';
    html += '<h2 class="section-heading">Bill Items</h2>';
    html += '<div class="table-wrapper">';
    html += '<table class="data-table" id="billing-items-table">';
    html += '<thead><tr>';
    html += '<th>#</th><th>Item</th><th>Qty</th>';
    html += '<th>MRP</th><th>Price</th><th>Total</th><th>Employee</th><th>Action</th>';
    html += '</tr></thead>';
    html += '<tbody id="billing-items-body"></tbody>';
    html += '</table>';
    html += '</div>';
    html += '<p id="billing-empty-msg" class="empty-state">No items added to bill.</p>';
    html += '</div>';

    // ── Totals Section ──
    html += '<div class="billing-section billing-totals">';
    html += '<div class="totals-row"><span>Subtotal:</span><span id="billing-subtotal">₹0.00</span></div>';
    html += '<div class="totals-row"><span>GST (<span id="billing-gst-rate">0</span>%):</span>';
    html += '<span id="billing-gst-amount">₹0.00</span></div>';
    html += '<div class="totals-row totals-grand"><span>Grand Total:</span>';
    html += '<span id="billing-total">₹0.00</span></div>';
    html += '<div class="totals-row" id="billing-savings-row" style="display:none;">';
    html += '<span>You Save:</span><span id="billing-savings">₹0.00</span></div>';
    html += '</div>';

    // ── Payment Type Section ──
    html += '<div class="billing-section billing-payment">';
    html += '<div class="form-group">';
    html += '<label for="billing-payment-type">Payment Type</label>';
    html += '<select id="billing-payment-type" class="form-input">';
    html += '<option value="UPI" selected>UPI</option>';
    html += '<option value="Cash">Cash</option>';
    html += '<option value="Card">Card</option>';
    html += '</select>';
    html += '</div>';
    html += '</div>';

    // ── Actions ──
    html += '<div class="billing-section billing-actions">';
    html += '<button id="billing-complete-btn" class="btn btn-primary" type="button">Complete Sale</button>';
    html += '<button id="billing-print-btn" class="btn btn-secondary" type="button">Print Bill</button>';
    html += '<button id="billing-clear-btn" class="btn btn-danger" type="button">Clear Bill</button>';
    html += '</div>';

    container.innerHTML = html;
    _attachListeners();
    _updateUI();
  }

  /**
   * Attaches event listeners to billing UI elements.
   * @private
   */
  function _attachListeners() {
    if (typeof document === 'undefined') return;

    var searchInput = document.getElementById('billing-item-search');
    var addBtn = document.getElementById('billing-add-btn');
    var completeBtn = document.getElementById('billing-complete-btn');
    var printBtn = document.getElementById('billing-print-btn');
    var clearBtn = document.getElementById('billing-clear-btn');
    var barcodeInput = document.getElementById('billing-barcode-input');

    if (searchInput) {
      var debouncedSearch = Utils.debounce(_handleSearch, 300);
      searchInput.addEventListener('input', debouncedSearch);
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          _hideSearchResults();
        }
      });
    }

    if (addBtn) {
      addBtn.addEventListener('click', _handleAddItem);
    }

    if (completeBtn) {
      completeBtn.addEventListener('click', function () { _handleCompleteSale(); });
    }

    if (printBtn) {
      printBtn.addEventListener('click', _handlePrint);
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (_lineItems.length > 0) {
          Utils.showConfirmDialog('Clear all items from the bill?').then(function (confirmed) {
            if (confirmed) { clearBill(); }
          });
        }
      });
    }

    // ── Barcode Input Listener ──
    if (barcodeInput) {
      var _barcodeDebounceTimer = null;

      barcodeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (_barcodeDebounceTimer) {
            clearTimeout(_barcodeDebounceTimer);
            _barcodeDebounceTimer = null;
          }
          _handleBarcodeInput(barcodeInput.value.trim());
        }
      });

      barcodeInput.addEventListener('input', function () {
        if (_barcodeDebounceTimer) {
          clearTimeout(_barcodeDebounceTimer);
        }
        _barcodeDebounceTimer = setTimeout(function () {
          var val = barcodeInput.value.trim();
          if (val.length > 0) {
            _handleBarcodeInput(val);
          }
        }, 300);
      });
    }
  }

  // ─── Private: Selected item for adding ──────────────────────────────────────

  var _selectedItem = null;

  /**
   * Handles item search input — queries Inventory for matching items.
   * @private
   */
  async function _handleSearch() {
    var input = document.getElementById('billing-item-search');
    if (!input) return;

    var query = input.value.trim();
    if (query.length < 2) {
      _hideSearchResults();
      return;
    }

    var items = [];
    if (typeof Inventory !== 'undefined' && Inventory.getAllItems) {
      try {
        items = await Inventory.getAllItems();
      } catch (e) {
        items = [];
      }
    }

    // Filter items by search query
    var lowerQuery = query.toLowerCase();
    var matches = items.filter(function (item) {
      return (item.item_code && item.item_code.toLowerCase().indexOf(lowerQuery) !== -1) ||
             (item.item_type && item.item_type.toLowerCase().indexOf(lowerQuery) !== -1) ||
             (item.brand && item.brand.toLowerCase().indexOf(lowerQuery) !== -1) ||
             (item.vendor_code && item.vendor_code.toLowerCase().indexOf(lowerQuery) !== -1);
    }).slice(0, 10);

    _showSearchResults(matches);
  }

  /**
   * Displays search results dropdown.
   * @param {Array} items - Matching items
   * @private
   */
  function _showSearchResults(items) {
    var container = document.getElementById('billing-search-results');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = '<div class="search-result-item">No items found</div>';
      container.style.display = 'block';
      return;
    }

    var esc = Utils.escapeHtml;
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      html += '<div class="search-result-item" data-index="' + i + '">';
      html += '<strong>' + esc(item.item_code || '') + '</strong> - ';
      html += esc(item.item_type || '') + ' (' + esc(item.brand || '') + ')';
      html += ' | ' + Utils.formatCurrency(item.sales_price);
      html += ' | Stock: ' + (item.quantity || 0);
      html += '</div>';
    }

    container.innerHTML = html;
    container.style.display = 'block';

    // Attach click handlers to results
    var resultItems = container.querySelectorAll('.search-result-item[data-index]');
    for (var j = 0; j < resultItems.length; j++) {
      (function (idx) {
        resultItems[idx].addEventListener('click', function () {
          _selectedItem = items[idx];
          var input = document.getElementById('billing-item-search');
          if (input) {
            input.value = items[idx].item_code + ' - ' + (items[idx].item_type || '');
          }
          _hideSearchResults();
        });
      })(j);
    }
  }

  /**
   * Hides the search results dropdown.
   * @private
   */
  function _hideSearchResults() {
    var container = document.getElementById('billing-search-results');
    if (container) {
      container.style.display = 'none';
      container.innerHTML = '';
    }
  }

  /**
   * Handles the Add button click — adds selected item to bill.
   * @private
   */
  function _handleAddItem() {
    if (!_selectedItem) {
      Utils.showToast('Please search and select an item first.', 'error');
      return;
    }

    var qtyInput = document.getElementById('billing-item-qty');
    var qty = qtyInput ? parseInt(qtyInput.value, 10) : 1;

    var result = addLineItem(_selectedItem, qty);
    if (result.success) {
      // Clear inputs
      var searchInput = document.getElementById('billing-item-search');
      if (searchInput) searchInput.value = '';
      if (qtyInput) qtyInput.value = '1';
      _selectedItem = null;
    } else {
      Utils.showToast(result.error, 'error');
    }
  }

  /**
   * Handles the Print button click — formats and prints current bill.
   * @private
   */
  function _handlePrint() {
    if (_lineItems.length === 0) {
      Utils.showToast('Cannot print: bill is empty.', 'error');
      return;
    }

    var gstRate = (typeof Settings !== 'undefined' && Settings.getGSTRate)
      ? Settings.getGSTRate()
      : 0;

    var subtotal = calculateSubtotal();
    var gstAmount = calculateGST(subtotal, gstRate);
    var total = Utils.roundTo2(subtotal + gstAmount);
    var savings = calculateSavings(_lineItems);

    var billData = {
      billNumber: generateBillNumber(),
      date: new Date(),
      lineItems: getLineItems(),
      subtotal: subtotal,
      gstRate: gstRate,
      gstAmount: gstAmount,
      total: total,
      savings: savings
    };

    var formatted = formatBill(billData);
    printBill(formatted);
  }

  /**
   * Updates the billing UI — line items table, totals, visibility.
   * @private
   */
  function _updateUI() {
    if (typeof document === 'undefined') return;

    var tbody = document.getElementById('billing-items-body');
    var emptyMsg = document.getElementById('billing-empty-msg');
    var subtotalEl = document.getElementById('billing-subtotal');
    var gstRateEl = document.getElementById('billing-gst-rate');
    var gstAmountEl = document.getElementById('billing-gst-amount');
    var totalEl = document.getElementById('billing-total');
    var savingsRow = document.getElementById('billing-savings-row');
    var savingsEl = document.getElementById('billing-savings');

    if (!tbody) return;

    // Render line items
    var esc = Utils.escapeHtml;
    if (_lineItems.length === 0) {
      tbody.innerHTML = '';
      if (emptyMsg) emptyMsg.style.display = 'block';
    } else {
      if (emptyMsg) emptyMsg.style.display = 'none';
      var rows = '';
      for (var i = 0; i < _lineItems.length; i++) {
        var item = _lineItems[i];
        rows += '<tr>';
        rows += '<td>' + (i + 1) + '</td>';
        rows += '<td>' + esc(item.item_type || item.item_code || '') + '</td>';
        rows += '<td><input type="number" class="billing-qty-input" data-index="' + i + '" ';
        rows += 'min="1" value="' + item.quantity + '" aria-label="Quantity for item ' + (i + 1) + '" /></td>';
        rows += '<td>' + Utils.formatCurrency(item.mrp) + '</td>';
        rows += '<td>' + Utils.formatCurrency(item.sales_price) + '</td>';
        rows += '<td>' + Utils.formatCurrency(item.line_total) + '</td>';
        rows += '<td><select class="billing-emp-select" data-index="' + i + '" style="min-width:100px;height:32px;font-size:0.8125rem;" aria-label="Employee for item ' + (i + 1) + '">';
        rows += '<option value="">--</option>';
        for (var ei = 0; ei < _activeEmployees.length; ei++) {
          var emp = _activeEmployees[ei];
          var selected = (item.employee_code === emp.employee_code) ? ' selected' : '';
          rows += '<option value="' + esc(emp.employee_code) + '"' + selected + '>' + esc(emp.employee_code + ' - ' + emp.name) + '</option>';
        }
        rows += '</select></td>';
        rows += '<td><button class="btn-icon-sm btn-delete billing-remove-btn" ';
        rows += 'data-index="' + i + '" type="button" aria-label="Remove item" title="Remove">🗑️</button></td>';
        rows += '</tr>';
      }
      tbody.innerHTML = rows;

      // Attach remove handlers
      var removeBtns = tbody.querySelectorAll('.billing-remove-btn');
      for (var j = 0; j < removeBtns.length; j++) {
        removeBtns[j].addEventListener('click', function () {
          var idx = parseInt(this.getAttribute('data-index'), 10);
          removeLineItem(idx);
        });
      }

      // Attach quantity change handlers
      var qtyInputs = tbody.querySelectorAll('.billing-qty-input');
      for (var k = 0; k < qtyInputs.length; k++) {
        qtyInputs[k].addEventListener('change', function () {
          var idx = parseInt(this.getAttribute('data-index'), 10);
          var newQty = parseInt(this.value, 10);
          if (!isNaN(newQty) && newQty > 0 && idx >= 0 && idx < _lineItems.length) {
            _lineItems[idx].quantity = newQty;
            _lineItems[idx].line_total = Utils.roundTo2(_lineItems[idx].sales_price * newQty);
            _updateUI();
          } else {
            this.value = _lineItems[idx].quantity;
          }
        });
      }

      // Attach employee select change handlers
      var empSelects = tbody.querySelectorAll('.billing-emp-select');
      for (var m = 0; m < empSelects.length; m++) {
        empSelects[m].addEventListener('change', function () {
          var idx = parseInt(this.getAttribute('data-index'), 10);
          if (idx >= 0 && idx < _lineItems.length) {
            _lineItems[idx].employee_code = this.value;
          }
        });
      }
    }

    // Update totals
    var gstRate = (typeof Settings !== 'undefined' && Settings.getGSTRate)
      ? Settings.getGSTRate()
      : 0;

    var subtotal = calculateSubtotal();
    var gstAmount = calculateGST(subtotal, gstRate);
    var total = Utils.roundTo2(subtotal + gstAmount);
    var savings = calculateSavings(_lineItems);

    if (subtotalEl) subtotalEl.textContent = Utils.formatCurrency(subtotal);
    if (gstRateEl) gstRateEl.textContent = String(gstRate);
    if (gstAmountEl) gstAmountEl.textContent = Utils.formatCurrency(gstAmount);
    if (totalEl) totalEl.textContent = Utils.formatCurrency(total);

    if (savingsRow && savingsEl) {
      if (savings > 0) {
        savingsRow.style.display = '';
        savingsEl.textContent = Utils.formatCurrency(savings);
      } else {
        savingsRow.style.display = 'none';
      }
    }

    // Disable/enable action buttons based on line items
    var completeBtn = document.getElementById('billing-complete-btn');
    var printBtn = document.getElementById('billing-print-btn');
    if (completeBtn) completeBtn.disabled = (_lineItems.length === 0);
    if (printBtn) printBtn.disabled = (_lineItems.length === 0);
  }

  // ─── Barcode Input Handler ─────────────────────────────────────────────────

  /**
   * Handles barcode/item code input — searches by exact item_code match and auto-adds.
   * @param {string} code - The scanned/entered item code
   * @private
   */
  async function _handleBarcodeInput(code) {
    if (!code) return;

    var barcodeInput = document.getElementById('billing-barcode-input');

    var items = [];
    if (typeof DataLayer !== 'undefined' && DataLayer.queryDocuments) {
      try {
        items = await DataLayer.queryDocuments('items', {
          where: [{ field: 'item_code', op: '==', value: code }]
        });
      } catch (e) {
        items = [];
      }
    }

    if (items.length === 0) {
      Utils.showToast('Item not found: ' + code, 'error');
    } else if (items.length === 1) {
      var item = items[0];
      var result = addLineItem(item, 1);
      if (result.success) {
        Utils.showToast('Added: ' + (item.item_type || '') + ' - ' + (item.brand || ''), 'success');
        // Clear input only on successful add
        if (barcodeInput) {
          barcodeInput.value = '';
        }
      } else {
        Utils.showToast(result.error, 'error');
      }
    } else {
      Utils.showToast('Multiple items found for: ' + code, 'error');
    }

    // Refocus input for next scan
    if (barcodeInput) {
      barcodeInput.focus();
    }
  }

  // ─── Payment Type & UPI QR Code ──────────────────────────────────────────────

  /**
   * Handles the Complete Sale button — checks payment type and shows UPI QR if needed.
   * @private
   */
  async function _handleCompleteSale() {
    if (_lineItems.length === 0) {
      Utils.showToast('Cannot complete sale: bill is empty.', 'error');
      return;
    }

    var paymentTypeEl = document.getElementById('billing-payment-type');
    var paymentType = paymentTypeEl ? paymentTypeEl.value : 'Cash';

    if (paymentType === 'UPI') {
      // Calculate total for QR
      var gstRate = (typeof Settings !== 'undefined' && Settings.getGSTRate)
        ? Settings.getGSTRate()
        : 0;
      var subtotal = calculateSubtotal();
      var gstAmount = calculateGST(subtotal, gstRate);
      var total = Utils.roundTo2(subtotal + gstAmount);
      var billNumber = generateBillNumber();

      _showUPIQRModal(total, billNumber);
    } else {
      // Cash or Card — proceed directly
      await completeSale();
    }
  }

  /**
   * Shows a UPI QR code modal for payment.
   * @param {number} total - Total amount for UPI payment
   * @param {string} billNumber - Bill number for transaction note
   * @private
   */
  function _showUPIQRModal(total, billNumber) {
    var upiConfig = (typeof Settings !== 'undefined' && Settings.getUPIConfig)
      ? Settings.getUPIConfig()
      : { upi_id: '', merchant_name: '', merchant_code: '' };

    if (!upiConfig.upi_id) {
      Utils.showToast('UPI ID not configured. Please set it in Settings.', 'error');
      // Fall back to direct sale
      completeSale();
      return;
    }

    // Build UPI intent string
    var upiString = 'upi://pay?pa=' + encodeURIComponent(upiConfig.upi_id) +
      '&pn=' + encodeURIComponent(upiConfig.merchant_name) +
      '&mc=' + encodeURIComponent(upiConfig.merchant_code) +
      '&am=' + encodeURIComponent(String(total)) +
      '&cu=INR' +
      '&tn=' + encodeURIComponent('Bill ' + billNumber);

    // Create modal overlay
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'upi-qr-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'modal upi-qr-modal';

    var html = '<h2>UPI Payment</h2>';
    html += '<div class="upi-amount">' + Utils.formatCurrency(total) + '</div>';
    html += '<div class="upi-bill-info">Bill: ' + Utils.escapeHtml(billNumber) + '</div>';
    html += '<div id="upi-qr-container"></div>';
    html += '<div class="upi-modal-actions">';
    html += '<button id="upi-payment-complete-btn" class="btn btn-primary" type="button">Payment Complete</button>';
    html += '<button id="upi-payment-cancel-btn" class="btn btn-secondary" type="button">Cancel</button>';
    html += '</div>';

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Generate QR code
    var qrContainer = document.getElementById('upi-qr-container');
    if (qrContainer && typeof QRCode !== 'undefined') {
      // QRCode library from CDN: use QRCode.toCanvas or QRCode.toDataURL
      if (QRCode.toCanvas) {
        var canvas = document.createElement('canvas');
        qrContainer.appendChild(canvas);
        QRCode.toCanvas(canvas, upiString, { width: 250, margin: 2 }, function (error) {
          if (error) {
            console.error('QR generation error:', error);
            qrContainer.innerHTML = '<p>QR Code generation failed.</p>';
          }
        });
      } else if (QRCode.toDataURL) {
        QRCode.toDataURL(upiString, { width: 250, margin: 2 }, function (error, url) {
          if (error) {
            qrContainer.innerHTML = '<p>QR Code generation failed.</p>';
          } else {
            var img = document.createElement('img');
            img.src = url;
            img.alt = 'UPI QR Code';
            qrContainer.appendChild(img);
          }
        });
      }
    }

    // Event listeners for modal buttons
    var completePayBtn = document.getElementById('upi-payment-complete-btn');
    var cancelPayBtn = document.getElementById('upi-payment-cancel-btn');

    if (completePayBtn) {
      completePayBtn.addEventListener('click', function () {
        _closeUPIQRModal();
        completeSale();
      });
    }

    if (cancelPayBtn) {
      cancelPayBtn.addEventListener('click', function () {
        _closeUPIQRModal();
      });
    }
  }

  /**
   * Closes and removes the UPI QR modal.
   * @private
   */
  function _closeUPIQRModal() {
    var overlay = document.getElementById('upi-qr-modal-overlay');
    if (overlay) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    addLineItem: addLineItem,
    removeLineItem: removeLineItem,
    getLineItems: getLineItems,
    calculateSubtotal: calculateSubtotal,
    calculateGST: calculateGST,
    calculateSavings: calculateSavings,
    generateBillNumber: generateBillNumber,
    formatBill: formatBill,
    printBill: printBill,
    completeSale: completeSale,
    clearBill: clearBill
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Billing;
}
