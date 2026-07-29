/**
 * Prj-Garments Firebase - Purchase Documents Module
 * Lists, views, edits and deletes RFQ / PO documents saved from Sales Report.
 * Also supports:
 *   - Convert RFQ → PO (loads latest cost prices from inventory)
 *   - Replenish stock directly from a PO
 */
var PurchaseDocs = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var COLLECTION = 'documents';
  var _allDocs      = [];
  var _currentDocId = null;
  var _currentDoc   = null;   // full doc object for the open document
  var _editItems    = [];     // working copy of line_items while editing or converting
  var _replenishMode = false;

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    if (typeof document === 'undefined') return;
    var container = document.querySelector('#screen-purchase-docs .screen-content');
    if (!container) return;
    container.innerHTML = _buildUI();
    _attachEventListeners();
    _loadDocs();
  }

  // ─── UI Builder ──────────────────────────────────────────────────────────────

  function _buildUI() {
    return '' +
      '<h2 class="screen-title">Purchase Documents</h2>' +
      '<div class="toolbar pd-toolbar">' +
        '<select id="pd-filter-type" class="inv-filter-select" aria-label="Filter by type">' +
          '<option value="">All Types</option>' +
          '<option value="RFQ">RFQ</option>' +
          '<option value="PO">PO</option>' +
        '</select>' +
        '<input type="date" id="pd-filter-from" class="form-input" aria-label="From date">' +
        '<input type="date" id="pd-filter-to" class="form-input" aria-label="To date">' +
        '<button type="button" id="pd-btn-filter" class="btn btn-secondary">Filter</button>' +
        '<button type="button" id="pd-btn-clear"  class="btn btn-cancel">Clear</button>' +
      '</div>' +

      /* ── List Panel ── */
      '<div id="pd-list-panel">' +
        '<div class="inv-table-container table-wrapper" role="region" aria-label="Purchase documents" tabindex="0">' +
          '<table class="data-table" id="pd-table">' +
            '<thead><tr>' +
              '<th>Doc Number</th><th>Type</th><th>Vendor</th>' +
              '<th>Date</th><th>Items</th><th>Total</th><th>Actions</th>' +
            '</tr></thead>' +
            '<tbody id="pd-tbody"></tbody>' +
          '</table>' +
          '<p id="pd-empty-msg" class="inv-empty-message" hidden>No documents found.</p>' +
        '</div>' +
      '</div>' +

      /* ── Detail Panel ── */
      '<div id="pd-detail-panel" class="pd-detail-panel" hidden>' +
        '<div class="pd-detail-header">' +
          '<div>' +
            '<h3 id="pd-detail-title" class="pd-detail-title"></h3>' +
            '<p id="pd-detail-meta" class="pd-detail-meta"></p>' +
          '</div>' +
          '<div class="pd-detail-actions">' +
            '<button type="button" id="pd-btn-edit"           class="btn btn-sm btn-secondary">✏️ Edit</button>' +
            '<button type="button" id="pd-btn-save"           class="btn btn-sm btn-primary"   hidden>💾 Save</button>' +
            '<button type="button" id="pd-btn-cancel-edit"    class="btn btn-sm btn-cancel"    hidden>Cancel</button>' +
            '<button type="button" id="pd-btn-convert-po"     class="btn btn-sm btn-success"   hidden>🔄 Convert to PO</button>' +
            '<button type="button" id="pd-btn-replenish"      class="btn btn-sm btn-success"   hidden>📦 Replenish Stock</button>' +
            '<button type="button" id="pd-btn-replenish-all"  class="btn btn-sm btn-primary"   hidden>✅ Replenish All</button>' +
            '<button type="button" id="pd-btn-replenish-sel"  class="btn btn-sm btn-secondary" hidden>☑️ Replenish Selected</button>' +
            '<button type="button" id="pd-btn-replenish-exit" class="btn btn-sm btn-cancel"    hidden>Cancel</button>' +
            '<button type="button" id="pd-btn-delete-doc"     class="btn btn-sm btn-danger">🗑️ Delete</button>' +
            '<button type="button" id="pd-btn-back"           class="btn btn-sm btn-cancel">← Back</button>' +
          '</div>' +
        '</div>' +
        '<div class="inv-table-container table-wrapper" style="margin-bottom:12px;">' +
          '<table class="data-table">' +
            '<thead><tr>' +
              '<th>Item Code</th>' +
              '<th>Item Name</th>' +
              '<th>Qty</th>' +
              '<th>Unit Price</th>' +
              '<th>Line Total</th>' +
              '<th id="pd-action-col" class="pd-action-col" hidden>Action</th>' +
              '<th id="pd-check-col"  class="pd-action-col" hidden>Select</th>' +
            '</tr></thead>' +
            '<tbody id="pd-detail-tbody"></tbody>' +
          '</table>' +
        '</div>' +
        '<div class="pd-detail-total">Total: <strong id="pd-detail-total-val"></strong></div>' +
        '<div id="pd-replenish-info" class="pd-replenish-info" hidden>' +
          '<span>☑️ Select items above, then tap <strong>Replenish Selected</strong>, or use <strong>Replenish All</strong>.</span>' +
        '</div>' +
      '</div>' +

      /* ── Convert to PO overlay ── */
      '<div id="pd-convert-overlay" class="pd-convert-overlay" hidden>' +
        '<div class="pd-convert-dialog">' +
          '<div class="pd-convert-header">' +
            '<div>' +
              '<h3 id="pd-convert-title" class="pd-convert-title"></h3>' +
              '<p id="pd-convert-meta"  class="pd-convert-meta"></p>' +
            '</div>' +
          '</div>' +
          '<div class="table-wrapper" style="margin-bottom:12px;">' +
            '<table class="data-table">' +
              '<thead><tr>' +
                '<th>Item Code</th><th>Item Name</th>' +
                '<th>Qty</th><th>Cost Price (₹)</th><th>Line Total</th><th></th>' +
              '</tr></thead>' +
              '<tbody id="pd-convert-tbody"></tbody>' +
            '</table>' +
          '</div>' +
          '<div class="pd-detail-total">Total: <strong id="pd-convert-total-val"></strong></div>' +
          '<div class="pd-convert-footer">' +
            '<button type="button" id="pd-convert-finalize" class="btn btn-primary">✅ Finalize as PO</button>' +
            '<button type="button" id="pd-convert-cancel"   class="btn btn-cancel">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────

  function _attachEventListeners() {
    _bind('pd-btn-filter',       'click', _applyFilter);
    _bind('pd-btn-clear',        'click', function () {
      document.getElementById('pd-filter-type').value = '';
      document.getElementById('pd-filter-from').value = '';
      document.getElementById('pd-filter-to').value   = '';
      _renderDocsList(_allDocs);
    });

    /* list-panel row buttons */
    var listTbody = document.getElementById('pd-tbody');
    if (listTbody) {
      listTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (btn.classList.contains('pd-btn-view')) _openDocument(id);
        else if (btn.classList.contains('pd-btn-del')) _handleDeleteDoc(id);
      });
    }

    /* detail panel – static buttons */
    _bind('pd-btn-back',           'click', _closeDocument);
    _bind('pd-btn-edit',           'click', _enterEditMode);
    _bind('pd-btn-save',           'click', _handleSaveDoc);
    _bind('pd-btn-cancel-edit',    'click', _exitEditMode);
    _bind('pd-btn-delete-doc',     'click', function () { if (_currentDocId) _handleDeleteDoc(_currentDocId); });
    _bind('pd-btn-convert-po',     'click', _openConvertToPO);
    _bind('pd-btn-replenish',      'click', _enterReplenishMode);
    _bind('pd-btn-replenish-all',  'click', function () { _doReplenish(null); });
    _bind('pd-btn-replenish-sel',  'click', function () { _doReplenish(_getSelectedReplenishIndices()); });
    _bind('pd-btn-replenish-exit', 'click', _exitReplenishMode);

    /* detail-tbody – edit line-delete and replenish checkboxes are delegated */
    var detailTbody = document.getElementById('pd-detail-tbody');
    if (detailTbody) {
      detailTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('.pd-del-line-btn');
        if (btn) _handleDeleteLineItem(parseInt(btn.getAttribute('data-idx'), 10));
      });
    }

    /* convert overlay */
    _bind('pd-convert-finalize', 'click', _handleConvertFinalize);
    _bind('pd-convert-cancel',   'click', _closeConvertOverlay);

    var convertTbody = document.getElementById('pd-convert-tbody');
    if (convertTbody) {
      convertTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('.pd-conv-del-btn');
        if (btn) {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          if (_editItems.length > 1) { _editItems.splice(idx, 1); _renderConvertTable(); }
          else Utils.showToast('Cannot remove the last item.', 'error');
        }
      });
      convertTbody.addEventListener('input', function (e) {
        var el = e.target;
        var idx = parseInt(el.getAttribute('data-idx'), 10);
        if (isNaN(idx)) return;
        if (el.classList.contains('pd-qty-input'))   _editItems[idx].qty        = Math.max(1, parseInt(el.value, 10) || 1);
        if (el.classList.contains('pd-price-input')) _editItems[idx].unit_price = Math.max(0, parseFloat(el.value) || 0);
        _updateConvertTotal();
      });
    }
  }

  function _bind(id, evt, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  }

  // ─── Load & Render List ──────────────────────────────────────────────────────

  async function _loadDocs() {
    try {
      _allDocs = await DataLayer.queryDocuments(COLLECTION, {
        orderBy: [{ field: 'date', direction: 'desc' }]
      });
    } catch (e) { _allDocs = []; }
    _renderDocsList(_allDocs);
  }

  function _applyFilter() {
    var typeVal = document.getElementById('pd-filter-type').value;
    var fromVal = document.getElementById('pd-filter-from').value;
    var toVal   = document.getElementById('pd-filter-to').value;

    var filtered = _allDocs.filter(function (doc) {
      if (typeVal && doc.doc_type !== typeVal) return false;
      var d = _parseDocDate(doc.date);
      if (fromVal && d < new Date(fromVal)) return false;
      if (toVal) {
        var toD = new Date(toVal);
        toD.setHours(23, 59, 59, 999);
        if (d > toD) return false;
      }
      return true;
    });
    _renderDocsList(filtered);
  }

  function _parseDocDate(raw) {
    if (!raw) return new Date(0);
    if (raw.toDate) return raw.toDate();
    return new Date(raw);
  }

  function _renderDocsList(docs) {
    var tbody    = document.getElementById('pd-tbody');
    var emptyMsg = document.getElementById('pd-empty-msg');
    if (!tbody) return;
    if (!docs || docs.length === 0) {
      tbody.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      return;
    }
    if (emptyMsg) emptyMsg.hidden = true;

    var html = '';
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var dateStr = _parseDocDate(doc.date).toLocaleDateString();
      var badge = doc.doc_type === 'RFQ'
        ? '<span class="pd-badge pd-badge-rfq">RFQ</span>'
        : '<span class="pd-badge pd-badge-po">PO</span>';
      var vendorLabel = doc.vendor_name
        ? Utils.escapeHtml(doc.vendor_name) + (doc.vendor_code ? ' <small>(' + Utils.escapeHtml(doc.vendor_code) + ')</small>' : '')
        : (doc.vendor_code ? Utils.escapeHtml(doc.vendor_code) : '—');

      html += '<tr>' +
        '<td><strong>' + Utils.escapeHtml(doc.doc_number || '') + '</strong></td>' +
        '<td>' + badge + '</td>' +
        '<td>' + vendorLabel + '</td>' +
        '<td>' + Utils.escapeHtml(dateStr) + '</td>' +
        '<td>' + ((doc.line_items || []).length) + '</td>' +
        '<td>' + Utils.formatCurrency(doc.total || 0) + '</td>' +
        '<td class="actions-cell">' +
          '<button type="button" class="btn btn-sm btn-secondary pd-btn-view" data-id="' + Utils.escapeHtml(doc.id) + '">View</button>' +
          '<button type="button" class="btn btn-sm btn-danger    pd-btn-del"  data-id="' + Utils.escapeHtml(doc.id) + '">Delete</button>' +
        '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }

  // ─── Document Detail ─────────────────────────────────────────────────────────

  function _openDocument(docId) {
    var doc = null;
    for (var i = 0; i < _allDocs.length; i++) {
      if (_allDocs[i].id === docId) { doc = _allDocs[i]; break; }
    }
    if (!doc) return;

    _currentDocId = docId;
    _currentDoc   = doc;
    _editItems    = (doc.line_items || []).map(function (li) { return Object.assign({}, li); });
    _replenishMode = false;

    document.getElementById('pd-list-panel').hidden   = false;
    document.getElementById('pd-detail-panel').hidden = false;

    var dateStr = _parseDocDate(doc.date).toLocaleDateString();
    var vendorPart = doc.vendor_name
      ? ' · Vendor: ' + doc.vendor_name + (doc.vendor_code ? ' (' + doc.vendor_code + ')' : '')
      : (doc.vendor_code ? ' · Vendor: ' + doc.vendor_code : '');

    document.getElementById('pd-detail-title').textContent = doc.doc_number + ' (' + doc.doc_type + ')';
    document.getElementById('pd-detail-meta').textContent  = 'Date: ' + dateStr + vendorPart;

    /* show doc-type-specific buttons */
    var convertBtn   = document.getElementById('pd-btn-convert-po');
    var replenishBtn = document.getElementById('pd-btn-replenish');
    if (convertBtn)   convertBtn.hidden   = (doc.doc_type !== 'RFQ');
    if (replenishBtn) replenishBtn.hidden = (doc.doc_type !== 'PO');

    _exitEditMode();
    _exitReplenishMode();

    /* scroll detail panel into view */
    var panel = document.getElementById('pd-detail-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _closeDocument() {
    _currentDocId  = null;
    _currentDoc    = null;
    _editItems     = [];
    _replenishMode = false;

    var listPanel   = document.getElementById('pd-list-panel');
    var detailPanel = document.getElementById('pd-detail-panel');
    if (listPanel)   listPanel.hidden   = false;
    if (detailPanel) detailPanel.hidden = true;

    _exitEditMode();
    _exitReplenishMode();
  }

  // ─── Detail Table ────────────────────────────────────────────────────────────

  // mode: 'view' | 'edit' | 'replenish'
  function _renderDetailTable(mode) {
    var tbody     = document.getElementById('pd-detail-tbody');
    var actionCol = document.getElementById('pd-action-col');
    var checkCol  = document.getElementById('pd-check-col');
    var totalEl   = document.getElementById('pd-detail-total-val');
    if (!tbody) return;

    if (actionCol) actionCol.hidden = (mode !== 'edit');
    if (checkCol)  checkCol.hidden  = (mode !== 'replenish');

    var total = 0;
    var html  = '';
    for (var i = 0; i < _editItems.length; i++) {
      var item      = _editItems[i];
      var lineTotal = (item.qty || 0) * (item.unit_price || 0);
      total += lineTotal;

      html += '<tr>';
      html += '<td>' + Utils.escapeHtml(item.item_code || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.item_name || '') + '</td>';

      if (mode === 'edit') {
        html += '<td><input type="number" class="pd-qty-input"   min="1"    max="99999" value="' + (item.qty || 1)        + '" data-idx="' + i + '"></td>';
        html += '<td><input type="number" class="pd-price-input" min="0.01" step="0.01" value="' + (item.unit_price || 0) + '" data-idx="' + i + '"></td>';
      } else {
        html += '<td>' + (item.qty || 0) + '</td>';
        html += '<td>' + Utils.formatCurrency(item.unit_price || 0) + '</td>';
      }

      html += '<td>' + Utils.formatCurrency(lineTotal) + '</td>';

      if (mode === 'edit') {
        html += '<td><button type="button" class="btn btn-sm btn-danger pd-del-line-btn" data-idx="' + i + '">Remove</button></td>';
      } else if (mode === 'replenish') {
        html += '<td style="text-align:center;"><input type="checkbox" class="pd-replenish-check" data-idx="' + i + '" checked></td>';
      }

      html += '</tr>';
    }
    tbody.innerHTML = html;
    if (totalEl) totalEl.textContent = Utils.formatCurrency(Math.round(total * 100) / 100);
  }

  function _enterEditMode() {
    document.getElementById('pd-btn-edit').hidden        = true;
    document.getElementById('pd-btn-save').hidden        = false;
    document.getElementById('pd-btn-cancel-edit').hidden = false;
    _setDocTypeButtons(false);
    _exitReplenishModeUI();
    _renderDetailTable('edit');
  }

  function _exitEditMode() {
    var e = document.getElementById('pd-btn-edit');
    var s = document.getElementById('pd-btn-save');
    var c = document.getElementById('pd-btn-cancel-edit');
    if (e) e.hidden = false;
    if (s) s.hidden = true;
    if (c) c.hidden = true;
    _setDocTypeButtons(true);
    _renderDetailTable('view');
  }

  /* show/hide the RFQ/PO-specific buttons based on doc type */
  function _setDocTypeButtons(visible) {
    var convertBtn   = document.getElementById('pd-btn-convert-po');
    var replenishBtn = document.getElementById('pd-btn-replenish');
    if (!_currentDoc) return;
    if (convertBtn)   convertBtn.hidden   = !visible || (_currentDoc.doc_type !== 'RFQ');
    if (replenishBtn) replenishBtn.hidden = !visible || (_currentDoc.doc_type !== 'PO');
  }

  function _handleDeleteLineItem(idx) {
    if (idx < 0 || idx >= _editItems.length) return;
    if (_editItems.length <= 1) {
      Utils.showToast('Cannot remove the last line item. Delete the document instead.', 'error');
      return;
    }
    _editItems.splice(idx, 1);
    _renderDetailTable('edit');
  }

  // ─── Save & Delete ───────────────────────────────────────────────────────────

  async function _handleSaveDoc() {
    var qtyInputs   = document.querySelectorAll('.pd-qty-input');
    var priceInputs = document.querySelectorAll('.pd-price-input');

    for (var i = 0; i < _editItems.length; i++) {
      var qty   = qtyInputs[i]   ? parseInt(qtyInputs[i].value, 10)   : _editItems[i].qty;
      var price = priceInputs[i] ? parseFloat(priceInputs[i].value)   : _editItems[i].unit_price;

      if (!qty || qty < 1)           { Utils.showToast('Quantity must be at least 1 for row ' + (i + 1) + '.', 'error'); return; }
      if (price == null || price < 0.01) { Utils.showToast('Price must be at least 0.01 for row ' + (i + 1) + '.', 'error'); return; }
      _editItems[i].qty = qty;
      _editItems[i].unit_price = price;
    }

    var total = 0;
    for (var j = 0; j < _editItems.length; j++) total += _editItems[j].qty * _editItems[j].unit_price;
    total = Math.round(total * 100) / 100;

    try {
      await DataLayer.updateDocument(COLLECTION, _currentDocId, { line_items: _editItems, total: total });
      for (var k = 0; k < _allDocs.length; k++) {
        if (_allDocs[k].id === _currentDocId) {
          _allDocs[k].line_items = _editItems.slice();
          _allDocs[k].total = total;
          if (_currentDoc) { _currentDoc.line_items = _editItems.slice(); _currentDoc.total = total; }
          break;
        }
      }
      Utils.showToast('Document saved.', 'success');
      _exitEditMode();
    } catch (e) {
      Utils.showToast('Failed to save: ' + e.message, 'error');
    }
  }

  async function _handleDeleteDoc(docId) {
    var confirmed = await Utils.showConfirmDialog('Delete this document? This cannot be undone.');
    if (!confirmed) return;
    try {
      await DataLayer.deleteDocument(COLLECTION, docId);
      _allDocs = _allDocs.filter(function (d) { return d.id !== docId; });
      Utils.showToast('Document deleted.', 'success');
      if (_currentDocId === docId) _closeDocument();
      else _renderDocsList(_allDocs);
    } catch (e) {
      Utils.showToast('Failed to delete: ' + e.message, 'error');
    }
  }

  // ─── Convert RFQ → PO ────────────────────────────────────────────────────────

  async function _openConvertToPO() {
    if (!_currentDoc) return;

    /* build a working copy of items */
    _editItems = (_currentDoc.line_items || []).map(function (li) { return Object.assign({}, li); });

    /* set overlay header */
    var titleEl = document.getElementById('pd-convert-title');
    var metaEl  = document.getElementById('pd-convert-meta');
    if (titleEl) titleEl.textContent = 'Convert ' + _currentDoc.doc_number + ' → PO';
    if (metaEl) {
      var vendorPart = _currentDoc.vendor_name
        ? 'Vendor: ' + _currentDoc.vendor_name + (_currentDoc.vendor_code ? ' (' + _currentDoc.vendor_code + ')' : '')
        : (_currentDoc.vendor_code ? 'Vendor: ' + _currentDoc.vendor_code : 'No vendor');
      metaEl.textContent = vendorPart + '  ·  Cost prices loaded from current inventory';
    }

    /* show overlay with spinner */
    var overlay = document.getElementById('pd-convert-overlay');
    if (overlay) overlay.removeAttribute('hidden');

    var tbody = document.getElementById('pd-convert-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;">Loading cost prices…</td></tr>';

    /* fetch latest cost prices for each item_code */
    for (var i = 0; i < _editItems.length; i++) {
      try {
        var results = await DataLayer.queryDocuments('items', {
          where: [{ field: 'item_code', op: '==', value: _editItems[i].item_code }],
          limit: 1
        });
        if (results.length > 0 && results[0].cost_price != null) {
          _editItems[i].unit_price = results[0].cost_price;
        }
      } catch (e) { /* keep original price on error */ }
    }

    _renderConvertTable();
  }

  function _renderConvertTable() {
    var tbody   = document.getElementById('pd-convert-tbody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < _editItems.length; i++) {
      var it        = _editItems[i];
      var lineTotal = (it.qty || 0) * (it.unit_price || 0);
      html += '<tr>' +
        '<td>' + Utils.escapeHtml(it.item_code || '') + '</td>' +
        '<td>' + Utils.escapeHtml(it.item_name || '') + '</td>' +
        '<td><input type="number" class="pd-qty-input"   min="1"    max="99999" value="' + (it.qty || 1)            + '" data-idx="' + i + '"></td>' +
        '<td><input type="number" class="pd-price-input" min="0.01" step="0.01" value="' + (it.unit_price || 0).toFixed(2) + '" data-idx="' + i + '"></td>' +
        '<td id="pd-conv-line-' + i + '">' + Utils.formatCurrency(lineTotal) + '</td>' +
        '<td><button type="button" class="btn btn-sm btn-danger pd-conv-del-btn" data-idx="' + i + '">✕</button></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    _updateConvertTotal();
  }

  function _updateConvertTotal() {
    var total = 0;
    for (var i = 0; i < _editItems.length; i++) total += ((_editItems[i].qty || 0) * (_editItems[i].unit_price || 0));
    var el = document.getElementById('pd-convert-total-val');
    if (el) el.textContent = Utils.formatCurrency(Math.round(total * 100) / 100);
    /* also update line totals from inputs */
    var qtyEls   = document.querySelectorAll('#pd-convert-tbody .pd-qty-input');
    var priceEls = document.querySelectorAll('#pd-convert-tbody .pd-price-input');
    for (var i = 0; i < _editItems.length; i++) {
      var lt = document.getElementById('pd-conv-line-' + i);
      var qty   = qtyEls[i]   ? Math.max(1, parseInt(qtyEls[i].value, 10) || 1)     : _editItems[i].qty;
      var price = priceEls[i] ? Math.max(0, parseFloat(priceEls[i].value) || 0) : _editItems[i].unit_price;
      if (lt) lt.textContent = Utils.formatCurrency(qty * price);
    }
  }

  function _closeConvertOverlay() {
    var overlay = document.getElementById('pd-convert-overlay');
    if (overlay) overlay.setAttribute('hidden', '');
    /* restore _editItems to current doc state */
    if (_currentDoc) {
      _editItems = (_currentDoc.line_items || []).map(function (li) { return Object.assign({}, li); });
    }
  }

  async function _handleConvertFinalize() {
    /* read latest input values */
    var qtyEls   = document.querySelectorAll('#pd-convert-tbody .pd-qty-input');
    var priceEls = document.querySelectorAll('#pd-convert-tbody .pd-price-input');
    for (var i = 0; i < _editItems.length; i++) {
      var qty   = qtyEls[i]   ? parseInt(qtyEls[i].value, 10)   : _editItems[i].qty;
      var price = priceEls[i] ? parseFloat(priceEls[i].value)   : _editItems[i].unit_price;
      if (!qty || qty < 1)          { Utils.showToast('Quantity must be ≥ 1 for row ' + (i + 1) + '.', 'error'); return; }
      if (price == null || price < 0.01) { Utils.showToast('Price must be ≥ 0.01 for row ' + (i + 1) + '.', 'error'); return; }
      _editItems[i].qty        = qty;
      _editItems[i].unit_price = price;
    }

    var total = _editItems.reduce(function (s, it) { return s + it.qty * it.unit_price; }, 0);
    total = Math.round(total * 100) / 100;

    var finalizeBtn = document.getElementById('pd-convert-finalize');
    if (finalizeBtn) { finalizeBtn.disabled = true; finalizeBtn.textContent = 'Saving…'; }

    try {
      var newDocNum = _genDocNumber('PO');
      var newDoc = {
        doc_number:  newDocNum,
        doc_type:    'PO',
        date:        new Date(),
        line_items:  _editItems.map(function (it) { return Object.assign({}, it); }),
        total:       total,
        vendor_code: _currentDoc.vendor_code || '',
        vendor_name: _currentDoc.vendor_name || '',
        converted_from: _currentDocId
      };
      var newId = await DataLayer.addDocument(COLLECTION, newDoc);
      newDoc.id = newId;
      _allDocs.unshift(newDoc);

      Utils.showToast('PO ' + newDocNum + ' created from RFQ!', 'success');
      _closeConvertOverlay();

      /* open the new PO so user can see it */
      _renderDocsList(_allDocs);
      _openDocument(newId);
    } catch (e) {
      Utils.showToast('Failed to create PO: ' + e.message, 'error');
    }
    if (finalizeBtn) { finalizeBtn.disabled = false; finalizeBtn.textContent = '✅ Finalize as PO'; }
  }

  function _genDocNumber(docType) {
    var d   = new Date();
    var ds  = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return docType + '-' + ds + '-' + rnd;
  }

  // ─── Replenish Stock from PO ─────────────────────────────────────────────────

  function _enterReplenishMode() {
    _replenishMode = true;
    _exitEditModeUI();
    /* show replenish buttons, hide edit/convert buttons */
    document.getElementById('pd-btn-edit').hidden            = true;
    document.getElementById('pd-btn-convert-po').hidden      = true;
    document.getElementById('pd-btn-replenish').hidden       = true;
    document.getElementById('pd-btn-replenish-all').hidden   = false;
    document.getElementById('pd-btn-replenish-sel').hidden   = false;
    document.getElementById('pd-btn-replenish-exit').hidden  = false;
    document.getElementById('pd-btn-delete-doc').hidden      = true;
    var infoEl = document.getElementById('pd-replenish-info');
    if (infoEl) infoEl.hidden = false;
    _renderDetailTable('replenish');
  }

  function _exitReplenishMode() {
    _replenishMode = false;
    _exitReplenishModeUI();
  }

  function _exitReplenishModeUI() {
    var ids = ['pd-btn-replenish-all', 'pd-btn-replenish-sel', 'pd-btn-replenish-exit'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.hidden = true;
    }
    var deleteBtn = document.getElementById('pd-btn-delete-doc');
    if (deleteBtn) deleteBtn.hidden = false;
    var infoEl = document.getElementById('pd-replenish-info');
    if (infoEl) infoEl.hidden = true;
  }

  function _exitEditModeUI() {
    var saveEl   = document.getElementById('pd-btn-save');
    var cancelEl = document.getElementById('pd-btn-cancel-edit');
    if (saveEl)   saveEl.hidden   = true;
    if (cancelEl) cancelEl.hidden = true;
  }

  function _getSelectedReplenishIndices() {
    var checks = document.querySelectorAll('.pd-replenish-check');
    var indices = [];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].checked) indices.push(parseInt(checks[i].getAttribute('data-idx'), 10));
    }
    return indices;
  }

  async function _doReplenish(indices) {
    /* null = replenish all */
    var items = (indices === null)
      ? _editItems.map(function (_, idx) { return idx; })
      : indices;

    if (!items || items.length === 0) {
      Utils.showToast('No items selected to replenish.', 'error');
      return;
    }

    var confirmed = await Utils.showConfirmDialog(
      'Replenish stock for ' + items.length + ' item(s) from PO ' + _currentDoc.doc_number + '?'
    );
    if (!confirmed) return;

    var replenishAllBtn = document.getElementById('pd-btn-replenish-all');
    var replenishSelBtn = document.getElementById('pd-btn-replenish-sel');
    if (replenishAllBtn) { replenishAllBtn.disabled = true; replenishAllBtn.textContent = 'Replenishing…'; }
    if (replenishSelBtn) replenishSelBtn.disabled = true;

    var succeeded = 0;
    var failed    = 0;

    for (var i = 0; i < items.length; i++) {
      var lineItem = _editItems[items[i]];
      if (!lineItem) continue;
      try {
        /* find inventory doc by item_code */
        var results = await DataLayer.queryDocuments('items', {
          where: [{ field: 'item_code', op: '==', value: lineItem.item_code }],
          limit: 1
        });
        if (results.length === 0) {
          Utils.showToast('Item ' + lineItem.item_code + ' not found in inventory — skipped.', 'error');
          failed++;
          continue;
        }
        var invItem = results[0];
        await DataLayer.incrementField('items', invItem.id, 'quantity', lineItem.qty || 0);
        await DataLayer.addDocument('replenishment_history', {
          item_code:  lineItem.item_code,
          item_name:  lineItem.item_name  || '',
          qty_added:  lineItem.qty        || 0,
          source:     'PO',
          po_number:  _currentDoc.doc_number,
          date:       new Date()
        });
        succeeded++;
      } catch (e) {
        Utils.showToast('Error replenishing ' + lineItem.item_code + ': ' + e.message, 'error');
        failed++;
      }
    }

    if (succeeded > 0) Utils.showToast(succeeded + ' item(s) replenished successfully!', 'success');
    if (failed > 0)    Utils.showToast(failed + ' item(s) failed — check errors above.', 'error');

    if (replenishAllBtn) { replenishAllBtn.disabled = false; replenishAllBtn.textContent = '✅ Replenish All'; }
    if (replenishSelBtn) { replenishSelBtn.disabled = false; }

    if (succeeded > 0) _exitReplenishMode();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return { init: init };

})();
