/**
 * Prj-Garments Firebase - Purchase Orders Screen
 * Dedicated screen for building RFQ / PO documents from inventory items.
 * Similar UX to the Replenish screen: search items, build an order list, generate.
 */
var PurchaseOrders = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _orderItems    = [];  // [{item_code, item_name, qty, unit_price, item_id}]
  var _inventoryCache = [];
  var _savedDocNumber = null; // set after saving to Firestore

  // ─── Init ────────────────────────────────────────────────────────────────────

  async function init() {
    var container = document.querySelector('#screen-purchase-orders .screen-content');
    if (!container) return;
    container.innerHTML = _buildUI();
    _attachListeners();
    await Promise.all([_loadVendors(), _loadInventory()]);
  }

  // ─── UI Builder ──────────────────────────────────────────────────────────────

  function _buildUI() {
    return (
      '<h2 class="section-heading" style="margin:0 0 16px">Generate RFQ / PO</h2>' +
      '<div class="po-screen-body">' +

        // ── Left pane: search ──
        '<div class="po-search-pane">' +
          '<div class="po-pane-title">Add Items</div>' +
          '<input id="po-search-input" type="text" class="form-input po-search-input" placeholder="Search by code, type, brand…">' +
          '<div id="po-search-results" class="po-search-results"></div>' +
        '</div>' +

        // ── Right pane: order list ──
        '<div class="po-order-pane">' +
          '<div class="po-pane-title">Order List</div>' +
          '<div class="po-vendor-row">' +
            '<label class="po-label" for="po-vendor-select">Vendor</label>' +
            '<select id="po-vendor-select" class="form-input po-vendor-select"><option value="">— No vendor —</option></select>' +
          '</div>' +
          '<p id="po-order-empty" class="po-empty-msg">No items added yet.</p>' +
          '<div id="po-table-wrap" class="table-wrapper" hidden>' +
            '<table class="data-table" id="po-order-table">' +
              '<thead><tr>' +
                '<th>Code</th><th>Name</th><th>Qty</th>' +
                '<th>Price (₹)</th><th>Line Total</th><th></th>' +
              '</tr></thead>' +
              '<tbody id="po-order-tbody"></tbody>' +
            '</table>' +
          '</div>' +
          '<div class="po-order-total-row" id="po-total-row" hidden>' +
            'Total: <strong id="po-order-total">₹0.00</strong>' +
          '</div>' +
          '<div class="po-order-footer">' +
            '<button type="button" id="po-btn-rfq" class="btn btn-secondary" disabled>📋 Generate RFQ</button>' +
            '<button type="button" id="po-btn-po"  class="btn btn-primary"   disabled>✅ Finalize PO</button>' +
            '<button type="button" id="po-btn-clear" class="btn btn-cancel">Clear All</button>' +
          '</div>' +
        '</div>' +

      '</div>' +

      // ── RFQ Compose overlay ──
      '<div id="po-compose-overlay" class="po-compose-overlay" hidden>' +
        '<div class="po-compose-dialog">' +
          '<div class="po-compose-header">' +
            '<span class="po-compose-title">Compose RFQ</span>' +
            '<span id="po-compose-vendor-chip" class="po-compose-vendor-chip"></span>' +
          '</div>' +
          '<div class="po-compose-body">' +
            '<label class="po-label">Quote Request Message</label>' +
            '<textarea id="po-compose-message" class="po-compose-textarea" rows="5"></textarea>' +
            '<label class="rfq-toggle-label" style="margin-top:10px;">' +
              '<input type="checkbox" id="po-hide-prices"> Hide unit prices on PDF' +
            '</label>' +
            '<div id="po-compose-preview" class="po-compose-preview" style="margin-top:12px;"></div>' +
          '</div>' +
          '<div class="po-compose-footer">' +
            '<button type="button" id="po-compose-save"   class="btn btn-secondary">💾 Save to Firestore</button>' +
            '<button type="button" id="po-compose-print"  class="btn btn-primary">🖨️ Print PDF</button>' +
            '<button type="button" id="po-compose-wa"     class="btn btn-whatsapp">💬 WhatsApp</button>' +
            '<button type="button" id="po-compose-cancel" class="btn btn-cancel">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────

  function _attachListeners() {
    var searchInput = document.getElementById('po-search-input');
    if (searchInput) searchInput.addEventListener('input', function () { _renderSearchResults(this.value.trim()); });

    var resultsDiv = document.getElementById('po-search-results');
    if (resultsDiv) {
      resultsDiv.addEventListener('click', function (e) {
        var btn = e.target.closest('.po-add-btn');
        if (btn) _addItemByIdx(parseInt(btn.getAttribute('data-idx'), 10));
      });
    }

    var tbody = document.getElementById('po-order-tbody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var btn = e.target.closest('.po-remove-btn');
        if (btn) _removeItem(parseInt(btn.getAttribute('data-idx'), 10));
      });
      tbody.addEventListener('input', function (e) {
        var el = e.target;
        var idx = parseInt(el.getAttribute('data-idx'), 10);
        if (isNaN(idx)) return;
        if (el.classList.contains('po-qty-input')) {
          _orderItems[idx].qty = Math.max(1, parseInt(el.value, 10) || 1);
          _refreshLineTotals();
        }
        if (el.classList.contains('po-price-input')) {
          _orderItems[idx].unit_price = Math.max(0, parseFloat(el.value) || 0);
          _refreshLineTotals();
        }
      });
    }

    _bind('po-btn-rfq',   'click', _handleGenerateRFQ);
    _bind('po-btn-po',    'click', _handleFinalizePO);
    _bind('po-btn-clear', 'click', _clearAll);

    _bind('po-compose-save',   'click', _composeSave);
    _bind('po-compose-print',  'click', _composePrint);
    _bind('po-compose-wa',     'click', _composeWhatsApp);
    _bind('po-compose-cancel', 'click', _closeCompose);
    _bind('po-hide-prices',    'change', _renderComposePreview);
  }

  function _bind(id, evt, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  }

  // ─── Load Data ────────────────────────────────────────────────────────────────

  async function _loadVendors() {
    try {
      var vendors = await DataLayer.queryDocuments('vendors', {});
      vendors.sort(function (a, b) {
        var ac = (a.vendor_code || '').toLowerCase();
        var bc = (b.vendor_code || '').toLowerCase();
        return ac < bc ? -1 : ac > bc ? 1 : 0;
      });
      var sel = document.getElementById('po-vendor-select');
      if (!sel) return;
      var html = '<option value="">— No vendor —</option>';
      for (var i = 0; i < vendors.length; i++) {
        var v = vendors[i];
        var code = v.vendor_code || v.id;
        var name = v.name || v.vendor_name || code;
        html += '<option value="' + _esc(code) + '" data-name="' + _esc(name) + '">' +
          _esc(name + ' (' + code + ')') + '</option>';
      }
      sel.innerHTML = html;
    } catch (e) { /* ignore */ }
  }

  async function _loadInventory() {
    try {
      _inventoryCache = await DataLayer.queryDocuments('items', {
        orderBy: [{ field: 'item_code', direction: 'asc' }]
      });
    } catch (e) { _inventoryCache = []; }
    _renderSearchResults('');
  }

  // ─── Search ──────────────────────────────────────────────────────────────────

  function _renderSearchResults(query) {
    var container = document.getElementById('po-search-results');
    if (!container) return;
    var q = (query || '').toLowerCase();
    var list = q
      ? _inventoryCache.filter(function (it) {
          return (it.item_code || '').toLowerCase().includes(q) ||
                 (it.item_type || '').toLowerCase().includes(q) ||
                 (it.brand || '').toLowerCase().includes(q);
        })
      : _inventoryCache.slice(0, 30);

    if (list.length === 0) {
      container.innerHTML = '<p class="po-no-results">No items found.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var origIdx = _inventoryCache.indexOf(item);
      html += '<div class="po-result-item">' +
        '<div class="po-result-info">' +
          '<span class="po-result-code">' + _esc(item.item_code || '') + '</span> ' +
          '<span class="po-result-desc">' + _esc((item.item_type || '') + (item.brand ? ' · ' + item.brand : '')) + '</span>' +
          '<span class="po-result-stock">Stock: ' + (item.quantity || 0) +
            ' &nbsp;·&nbsp; Cost: ' + Utils.formatCurrency(item.cost_price || 0) + '</span>' +
        '</div>' +
        '<button type="button" class="btn btn-sm btn-secondary po-add-btn" data-idx="' + origIdx + '">+ Add</button>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  // ─── Order List Management ────────────────────────────────────────────────────

  function _addItemByIdx(cacheIdx) {
    var item = _inventoryCache[cacheIdx];
    if (!item) return;
    for (var i = 0; i < _orderItems.length; i++) {
      if (_orderItems[i].item_code === item.item_code) {
        _orderItems[i].qty += 1;
        _renderOrderTable();
        return;
      }
    }
    _orderItems.push({
      item_code:  item.item_code  || '',
      item_name:  item.item_type  || '',
      qty:        1,
      unit_price: item.cost_price || 0,
      item_id:    item.id
    });
    _renderOrderTable();
  }

  function _removeItem(idx) {
    _orderItems.splice(idx, 1);
    _renderOrderTable();
  }

  function _clearAll() {
    _orderItems = [];
    _renderOrderTable();
    var si = document.getElementById('po-search-input');
    if (si) { si.value = ''; _renderSearchResults(''); }
  }

  function _renderOrderTable() {
    var tbody     = document.getElementById('po-order-tbody');
    var emptyMsg  = document.getElementById('po-order-empty');
    var tableWrap = document.getElementById('po-table-wrap');
    var totalRow  = document.getElementById('po-total-row');
    var rfqBtn    = document.getElementById('po-btn-rfq');
    var poBtn     = document.getElementById('po-btn-po');
    if (!tbody) return;

    var has = _orderItems.length > 0;
    if (emptyMsg)  emptyMsg.hidden   = has;
    if (tableWrap) tableWrap.hidden  = !has;
    if (totalRow)  totalRow.hidden   = !has;
    if (rfqBtn)    rfqBtn.disabled   = !has;
    if (poBtn)     poBtn.disabled    = !has;
    if (!has) { tbody.innerHTML = ''; _updateGrandTotal(); return; }

    var html = '';
    for (var i = 0; i < _orderItems.length; i++) {
      var it = _orderItems[i];
      var lineTotal = it.qty * it.unit_price;
      html += '<tr>' +
        '<td>' + _esc(it.item_code) + '</td>' +
        '<td>' + _esc(it.item_name) + '</td>' +
        '<td><input type="number" class="po-qty-input pd-qty-input" min="1" max="99999" value="' + it.qty + '" data-idx="' + i + '"></td>' +
        '<td><input type="number" class="po-price-input pd-price-input" min="0" step="0.01" value="' + it.unit_price.toFixed(2) + '" data-idx="' + i + '"></td>' +
        '<td id="po-line-' + i + '">' + Utils.formatCurrency(lineTotal) + '</td>' +
        '<td><button type="button" class="btn btn-sm btn-danger po-remove-btn" data-idx="' + i + '">✕</button></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    _updateGrandTotal();
  }

  function _refreshLineTotals() {
    for (var i = 0; i < _orderItems.length; i++) {
      var cell = document.getElementById('po-line-' + i);
      if (cell) cell.textContent = Utils.formatCurrency(_orderItems[i].qty * _orderItems[i].unit_price);
    }
    _updateGrandTotal();
  }

  function _updateGrandTotal() {
    var total = 0;
    for (var i = 0; i < _orderItems.length; i++) total += _orderItems[i].qty * _orderItems[i].unit_price;
    var el = document.getElementById('po-order-total');
    if (el) el.textContent = Utils.formatCurrency(Math.round(total * 100) / 100);
  }

  // ─── Vendor Helper ────────────────────────────────────────────────────────────

  function _getVendorInfo() {
    var sel = document.getElementById('po-vendor-select');
    if (!sel || !sel.value) return null;
    var opt = sel.options[sel.selectedIndex];
    return {
      vendor_code: sel.value,
      vendor_name: (opt && opt.getAttribute('data-name')) || sel.value
    };
  }

  // ─── Read Current Input Values ────────────────────────────────────────────────

  function _syncInputValues() {
    var qtyEls   = document.querySelectorAll('#po-order-tbody .po-qty-input');
    var priceEls = document.querySelectorAll('#po-order-tbody .po-price-input');
    for (var i = 0; i < _orderItems.length; i++) {
      if (qtyEls[i])   _orderItems[i].qty        = Math.max(1, parseInt(qtyEls[i].value, 10) || 1);
      if (priceEls[i]) _orderItems[i].unit_price  = Math.max(0, parseFloat(priceEls[i].value) || 0);
    }
  }

  // ─── Generate RFQ ────────────────────────────────────────────────────────────

  function _handleGenerateRFQ() {
    _syncInputValues();
    if (_orderItems.length === 0) { Utils.showToast('Add items to the order list first.', 'error'); return; }
    _openCompose();
  }

  function _openCompose() {
    _savedDocNumber = null;
    var saveBtn = document.getElementById('po-compose-save');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save to Firestore'; }

    var vendorInfo = _getVendorInfo();
    var chip = document.getElementById('po-compose-vendor-chip');
    if (chip) chip.textContent = vendorInfo ? (vendorInfo.vendor_name || vendorInfo.vendor_code) : 'No vendor';

    var msgArea = document.getElementById('po-compose-message');
    if (msgArea) {
      var si = (typeof Settings !== 'undefined' && Settings.getStoreInfo) ? Settings.getStoreInfo() : {};
      msgArea.value = 'Dear Sir/Madam,\n\nWe kindly request your best quotation for the items listed below. Please include unit price, availability, and expected delivery date.\n\nRegards,\n' + (si.store_name || 'Our Store');
    }

    var hidePrices = document.getElementById('po-hide-prices');
    if (hidePrices) hidePrices.checked = false;

    _renderComposePreview();
    var overlay = document.getElementById('po-compose-overlay');
    if (overlay) overlay.removeAttribute('hidden');
  }

  function _closeCompose() {
    var overlay = document.getElementById('po-compose-overlay');
    if (overlay) overlay.setAttribute('hidden', '');
  }

  function _renderComposePreview() {
    var previewEl  = document.getElementById('po-compose-preview');
    if (!previewEl) return;
    var hidePrices = document.getElementById('po-hide-prices');
    var hide       = hidePrices && hidePrices.checked;
    var vendorInfo = _getVendorInfo();

    var html = '<div class="rfq-preview-group-header">' +
      _esc(vendorInfo ? (vendorInfo.vendor_name || vendorInfo.vendor_code) : '— No vendor —') + '</div>';
    html += '<table class="data-table" style="font-size:0.8rem;"><thead><tr>' +
      '<th>Code</th><th>Name</th><th>Qty</th>' + (hide ? '' : '<th>Cost Price</th>') +
      '</tr></thead><tbody>';
    for (var i = 0; i < _orderItems.length; i++) {
      var it = _orderItems[i];
      html += '<tr><td>' + _esc(it.item_code) + '</td><td>' + _esc(it.item_name) + '</td><td>' + it.qty + '</td>';
      if (!hide) html += '<td>' + Utils.formatCurrency(it.unit_price) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    previewEl.innerHTML = html;
  }

  async function _composeSave() {
    var btn = document.getElementById('po-compose-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      var docData = await _persistDoc('RFQ');
      _savedDocNumber = docData.doc_number;
      if (btn) { btn.textContent = '✅ Saved (' + _savedDocNumber + ')'; }
      Utils.showToast('RFQ ' + _savedDocNumber + ' saved!', 'success');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save to Firestore'; }
      Utils.showToast('Save failed: ' + e.message, 'error');
    }
  }

  function _composePrint() {
    var msgArea    = document.getElementById('po-compose-message');
    var hidePrices = document.getElementById('po-hide-prices');
    _openPrintWindow({
      items:      _orderItems,
      message:    msgArea ? msgArea.value : '',
      hidePrices: hidePrices && hidePrices.checked,
      vendorInfo: _getVendorInfo(),
      storeInfo:  (typeof Settings !== 'undefined' && Settings.getStoreInfo) ? Settings.getStoreInfo() : {}
    });
  }

  function _composeWhatsApp() {
    var msgArea    = document.getElementById('po-compose-message');
    var hidePrices = document.getElementById('po-hide-prices');
    var message    = msgArea ? msgArea.value : '';
    var hide       = hidePrices && hidePrices.checked;
    var vendorInfo = _getVendorInfo();
    var si         = (typeof Settings !== 'undefined' && Settings.getStoreInfo) ? Settings.getStoreInfo() : {};
    var today      = new Date().toLocaleDateString('en-IN');

    var text = '*REQUEST FOR QUOTATION*\n';
    text += 'From: ' + (si.store_name || 'Our Store') + '\n';
    text += 'Date: ' + today + '\n';
    if (vendorInfo) text += 'To: ' + (vendorInfo.vendor_name || vendorInfo.vendor_code) + '\n';
    text += '\n' + message + '\n\n*Items:*\n';
    for (var i = 0; i < _orderItems.length; i++) {
      var it = _orderItems[i];
      text += (i + 1) + '. ' + it.item_code + ' – ' + it.item_name + ' × ' + it.qty;
      if (!hide) text += ' @ ' + Utils.formatCurrency(it.unit_price);
      text += '\n';
    }
    if (si.store_phone) text += '\nContact: ' + si.store_phone;

    if (navigator.share) {
      navigator.share({ title: 'RFQ', text: text }).catch(function () {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  }

  // ─── Finalize PO ─────────────────────────────────────────────────────────────

  async function _handleFinalizePO() {
    _syncInputValues();
    if (_orderItems.length === 0) { Utils.showToast('Add items to the order list first.', 'error'); return; }
    var confirmed = await Utils.showConfirmDialog(
      'Save ' + _orderItems.length + ' item(s) as a Purchase Order?'
    );
    if (!confirmed) return;

    var btn = document.getElementById('po-btn-po');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      var docData = await _persistDoc('PO');
      Utils.showToast('PO ' + docData.doc_number + ' saved!', 'success');
      _clearAll();
    } catch (e) {
      Utils.showToast('Failed to save PO: ' + e.message, 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = '✅ Finalize PO'; }
  }

  // ─── Persist to Firestore ─────────────────────────────────────────────────────

  async function _persistDoc(docType) {
    _syncInputValues();
    var vendorInfo = _getVendorInfo();
    var lineItems  = _orderItems.map(function (it) {
      return { item_code: it.item_code, item_name: it.item_name, qty: it.qty, unit_price: it.unit_price };
    });
    var total = lineItems.reduce(function (s, li) { return s + li.qty * li.unit_price; }, 0);
    var docData = {
      doc_number:  _genDocNumber(docType),
      doc_type:    docType,
      date:        new Date(),
      line_items:  lineItems,
      total:       Math.round(total * 100) / 100,
      vendor_code: vendorInfo ? (vendorInfo.vendor_code || '') : '',
      vendor_name: vendorInfo ? (vendorInfo.vendor_name || '') : ''
    };
    await DataLayer.addDocument('documents', docData);
    return docData;
  }

  // ─── Print Window ─────────────────────────────────────────────────────────────

  function _openPrintWindow(opts) {
    var win = window.open('', '_blank', 'width=820,height=640');
    if (!win) { Utils.showToast('Popup blocked — allow popups and try again.', 'error'); return; }
    var items      = opts.items;
    var message    = opts.message || '';
    var hide       = !!opts.hidePrices;
    var si         = opts.storeInfo || {};
    var vi         = opts.vendorInfo;
    var today      = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    var docNum     = _genDocNumber('RFQ');
    var vendorLabel = vi ? (vi.vendor_name || vi.vendor_code) : '—';

    var priceHdr = hide ? '' : '<th>Unit Price</th><th>Line Total</th>';
    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      rows += '<tr><td>' + (i + 1) + '</td><td>' + _esc(it.item_code) + '</td><td>' +
        _esc(it.item_name) + '</td><td style="text-align:center">' + it.qty + '</td>';
      if (!hide) rows += '<td style="text-align:right">' + Utils.formatCurrency(it.unit_price) +
        '</td><td style="text-align:right">' + Utils.formatCurrency(it.qty * it.unit_price) + '</td>';
      rows += '</tr>';
    }

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>RFQ – ' + docNum + '</title><style>' +
      'body{font-family:Arial,sans-serif;margin:24px;color:#222;font-size:13px;}' +
      '.store-header{text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:14px;}' +
      '.store-header h1{margin:0 0 4px;font-size:1.3rem;}' +
      '.store-header p{margin:2px 0;color:#555;font-size:12px;}' +
      '.rfq-title{font-size:1rem;font-weight:700;color:#6200ea;margin:10px 0 4px;}' +
      '.meta{display:flex;justify-content:space-between;font-size:12px;margin:4px 0;}' +
      '.message-box{border:1px solid #ddd;background:#fafafa;padding:10px 12px;margin:12px 0;' +
        'white-space:pre-wrap;font-size:12px;line-height:1.5;}' +
      'table{width:100%;border-collapse:collapse;margin:12px 0;}' +
      'th,td{border:1px solid #ccc;padding:6px 10px;}' +
      'th{background:#f0f0f0;font-size:11px;text-transform:uppercase;letter-spacing:.04em;}' +
      '.footer{border-top:1px solid #ccc;margin-top:16px;padding-top:8px;font-size:11px;color:#666;text-align:center;}' +
      '.ctrl{margin-bottom:10px;} .ctrl button{margin-right:8px;padding:4px 14px;}' +
      '@media print{.ctrl{display:none;}}' +
      '</style></head><body>' +
      '<div class="ctrl"><button onclick="window.print()">🖨️ Print</button>' +
        '<button onclick="window.close()">✕ Close</button></div>' +
      '<div class="store-header"><h1>' + _esc(si.store_name || 'Store') + '</h1>' +
        '<p>' + _esc(si.store_address || '') + '</p>' +
        (si.store_phone ? '<p>📞 ' + _esc(si.store_phone) + '</p>' : '') + '</div>' +
      '<div class="rfq-title">REQUEST FOR QUOTATION</div>' +
      '<div class="meta"><span><strong>Doc:</strong> ' + docNum + '</span><span><strong>Date:</strong> ' + today + '</span></div>' +
      '<div class="meta"><span><strong>Vendor:</strong> ' + _esc(vendorLabel) + '</span></div>' +
      '<div class="message-box">' + _esc(message) + '</div>' +
      '<table><thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th>Qty</th>' + priceHdr + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="footer">Prices in INR · Valid 7 days · ' + _esc(si.store_name || '') + '</div>' +
      '</body></html>';

    win.document.write(html);
    win.document.close();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function _genDocNumber(docType) {
    var d   = new Date();
    var ds  = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return docType + '-' + ds + '-' + rnd;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return { init: init };

})();
