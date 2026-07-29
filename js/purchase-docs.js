/**
 * Prj-Garments Firebase - Purchase Documents Module
 * Lists, views, edits and deletes RFQ / PO documents saved from Sales Report.
 */
var PurchaseDocs = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var COLLECTION = 'documents';
  var _allDocs = [];
  var _currentDocId = null;
  var _editItems = [];

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
        '<button type="button" id="pd-btn-clear" class="btn btn-cancel">Clear</button>' +
      '</div>' +

      '<div id="pd-list-panel">' +
        '<div class="inv-table-container table-wrapper" role="region" aria-label="Purchase documents" tabindex="0">' +
          '<table class="data-table" id="pd-table">' +
            '<thead><tr>' +
              '<th>Doc Number</th>' +
              '<th>Type</th>' +
              '<th>Vendor</th>' +
              '<th>Date</th>' +
              '<th>Items</th>' +
              '<th>Total</th>' +
              '<th>Actions</th>' +
            '</tr></thead>' +
            '<tbody id="pd-tbody"></tbody>' +
          '</table>' +
          '<p id="pd-empty-msg" class="inv-empty-message" hidden>No documents found.</p>' +
        '</div>' +
      '</div>' +

      '<div id="pd-detail-panel" class="pd-detail-panel" hidden>' +
        '<div class="pd-detail-header">' +
          '<div>' +
            '<h3 id="pd-detail-title" class="pd-detail-title"></h3>' +
            '<p id="pd-detail-meta" class="pd-detail-meta"></p>' +
          '</div>' +
          '<div class="pd-detail-actions">' +
            '<button type="button" id="pd-btn-edit" class="btn btn-sm btn-secondary">✏️ Edit</button>' +
            '<button type="button" id="pd-btn-save" class="btn btn-sm btn-primary" hidden>💾 Save</button>' +
            '<button type="button" id="pd-btn-cancel-edit" class="btn btn-sm btn-cancel" hidden>Cancel</button>' +
            '<button type="button" id="pd-btn-delete-doc" class="btn btn-sm btn-danger">🗑️ Delete</button>' +
            '<button type="button" id="pd-btn-back" class="btn btn-sm btn-cancel">← Back to List</button>' +
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
            '</tr></thead>' +
            '<tbody id="pd-detail-tbody"></tbody>' +
          '</table>' +
        '</div>' +
        '<div class="pd-detail-total">Total: <strong id="pd-detail-total-val"></strong></div>' +
      '</div>';
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────

  function _attachEventListeners() {
    var filterBtn = document.getElementById('pd-btn-filter');
    if (filterBtn) filterBtn.addEventListener('click', _applyFilter);

    var clearBtn = document.getElementById('pd-btn-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        document.getElementById('pd-filter-type').value = '';
        document.getElementById('pd-filter-from').value = '';
        document.getElementById('pd-filter-to').value = '';
        _renderDocsList(_allDocs);
      });
    }

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

    var backBtn = document.getElementById('pd-btn-back');
    if (backBtn) backBtn.addEventListener('click', _closeDocument);

    var editBtn = document.getElementById('pd-btn-edit');
    if (editBtn) editBtn.addEventListener('click', _enterEditMode);

    var saveBtn = document.getElementById('pd-btn-save');
    if (saveBtn) saveBtn.addEventListener('click', _handleSaveDoc);

    var cancelEditBtn = document.getElementById('pd-btn-cancel-edit');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', _exitEditMode);

    var deleteDocBtn = document.getElementById('pd-btn-delete-doc');
    if (deleteDocBtn) {
      deleteDocBtn.addEventListener('click', function () {
        if (_currentDocId) _handleDeleteDoc(_currentDocId);
      });
    }

    var detailTbody = document.getElementById('pd-detail-tbody');
    if (detailTbody) {
      detailTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('.pd-del-line-btn');
        if (!btn) return;
        _handleDeleteLineItem(parseInt(btn.getAttribute('data-idx'), 10));
      });
    }
  }

  // ─── Load & Render List ──────────────────────────────────────────────────────

  async function _loadDocs() {
    try {
      _allDocs = await DataLayer.queryDocuments(COLLECTION, {
        orderBy: [{ field: 'date', direction: 'desc' }]
      });
    } catch (e) {
      _allDocs = [];
    }
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
    var tbody = document.getElementById('pd-tbody');
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

      html += '<tr>';
      html += '<td><strong>' + Utils.escapeHtml(doc.doc_number || '') + '</strong></td>';
      html += '<td>' + badge + '</td>';
      html += '<td>' + vendorLabel + '</td>';
      html += '<td>' + Utils.escapeHtml(dateStr) + '</td>';
      html += '<td>' + ((doc.line_items || []).length) + '</td>';
      html += '<td>' + Utils.formatCurrency(doc.total || 0) + '</td>';
      html += '<td class="actions-cell">';
      html += '<button type="button" class="btn btn-sm btn-secondary pd-btn-view" data-id="' + Utils.escapeHtml(doc.id) + '">View / Edit</button>';
      html += '<button type="button" class="btn btn-sm btn-danger pd-btn-del" data-id="' + Utils.escapeHtml(doc.id) + '">Delete</button>';
      html += '</td>';
      html += '</tr>';
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
    _editItems = (doc.line_items || []).map(function (li) { return Object.assign({}, li); });

    document.getElementById('pd-list-panel').hidden = true;
    document.getElementById('pd-detail-panel').hidden = false;

    var dateStr = _parseDocDate(doc.date).toLocaleDateString();
    var vendorPart = doc.vendor_name
      ? ' · Vendor: ' + doc.vendor_name + (doc.vendor_code ? ' (' + doc.vendor_code + ')' : '')
      : (doc.vendor_code ? ' · Vendor: ' + doc.vendor_code : '');

    document.getElementById('pd-detail-title').textContent = doc.doc_number + ' (' + doc.doc_type + ')';
    document.getElementById('pd-detail-meta').textContent = 'Date: ' + dateStr + vendorPart;

    _exitEditMode();
  }

  function _closeDocument() {
    _currentDocId = null;
    _editItems = [];
    document.getElementById('pd-list-panel').hidden = false;
    document.getElementById('pd-detail-panel').hidden = true;
    _exitEditMode();
  }

  // ─── Detail Table ────────────────────────────────────────────────────────────

  function _renderDetailTable(editable) {
    var tbody = document.getElementById('pd-detail-tbody');
    var actionCol = document.getElementById('pd-action-col');
    var totalEl = document.getElementById('pd-detail-total-val');
    if (!tbody) return;

    if (actionCol) actionCol.hidden = !editable;

    var total = 0;
    var html = '';
    for (var i = 0; i < _editItems.length; i++) {
      var item = _editItems[i];
      var lineTotal = (item.qty || 0) * (item.unit_price || 0);
      total += lineTotal;

      html += '<tr>';
      html += '<td>' + Utils.escapeHtml(item.item_code || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.item_name || '') + '</td>';

      if (editable) {
        html += '<td><input type="number" class="pd-qty-input" min="1" max="99999" value="' + (item.qty || 1) + '" data-idx="' + i + '"></td>';
        html += '<td><input type="number" class="pd-price-input" min="0.01" step="0.01" value="' + (item.unit_price || 0) + '" data-idx="' + i + '"></td>';
      } else {
        html += '<td>' + (item.qty || 0) + '</td>';
        html += '<td>' + Utils.formatCurrency(item.unit_price || 0) + '</td>';
      }

      html += '<td>' + Utils.formatCurrency(lineTotal) + '</td>';

      if (editable) {
        html += '<td><button type="button" class="btn btn-sm btn-danger pd-del-line-btn" data-idx="' + i + '">Remove</button></td>';
      }

      html += '</tr>';
    }
    tbody.innerHTML = html;

    if (totalEl) totalEl.textContent = Utils.formatCurrency(Math.round(total * 100) / 100);
  }

  function _enterEditMode() {
    document.getElementById('pd-btn-edit').hidden = true;
    document.getElementById('pd-btn-save').hidden = false;
    document.getElementById('pd-btn-cancel-edit').hidden = false;
    _renderDetailTable(true);
  }

  function _exitEditMode() {
    var e = document.getElementById('pd-btn-edit');
    var s = document.getElementById('pd-btn-save');
    var c = document.getElementById('pd-btn-cancel-edit');
    if (e) e.hidden = false;
    if (s) s.hidden = true;
    if (c) c.hidden = true;
    _renderDetailTable(false);
  }

  function _handleDeleteLineItem(idx) {
    if (idx < 0 || idx >= _editItems.length) return;
    if (_editItems.length <= 1) {
      Utils.showToast('Cannot remove the last line item. Delete the document instead.', 'error');
      return;
    }
    _editItems.splice(idx, 1);
    _renderDetailTable(true);
  }

  // ─── Save & Delete ───────────────────────────────────────────────────────────

  async function _handleSaveDoc() {
    var qtyInputs   = document.querySelectorAll('.pd-qty-input');
    var priceInputs = document.querySelectorAll('.pd-price-input');

    for (var i = 0; i < _editItems.length; i++) {
      var qty   = qtyInputs[i]   ? parseInt(qtyInputs[i].value, 10)      : _editItems[i].qty;
      var price = priceInputs[i] ? parseFloat(priceInputs[i].value) : _editItems[i].unit_price;

      if (!qty || qty < 1) {
        Utils.showToast('Quantity must be at least 1 for row ' + (i + 1) + '.', 'error');
        return;
      }
      if (!price || price < 0.01) {
        Utils.showToast('Price must be at least 0.01 for row ' + (i + 1) + '.', 'error');
        return;
      }
      _editItems[i].qty = qty;
      _editItems[i].unit_price = price;
    }

    var total = 0;
    for (var j = 0; j < _editItems.length; j++) {
      total += _editItems[j].qty * _editItems[j].unit_price;
    }
    total = Math.round(total * 100) / 100;

    try {
      await DataLayer.updateDocument(COLLECTION, _currentDocId, {
        line_items: _editItems,
        total: total
      });
      for (var k = 0; k < _allDocs.length; k++) {
        if (_allDocs[k].id === _currentDocId) {
          _allDocs[k].line_items = _editItems.slice();
          _allDocs[k].total = total;
          break;
        }
      }
      Utils.showToast('Document saved successfully.', 'success');
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

  // ─── Public API ──────────────────────────────────────────────────────────────

  return { init: init };

})();
