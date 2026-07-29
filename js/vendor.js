/**
 * Prj-Garments Firebase - Vendor Module
 * Vendor master CRUD, unique vendor code enforcement, and vendor UI.
 */
var Vendor = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _currentEditId = null;
  var _allVendors = [];

  // ─── Constants ──────────────────────────────────────────────────────────────

  var COLLECTION_VENDORS = 'vendors';

  // ─── Validation ─────────────────────────────────────────────────────────────

  function validateVendor(data) {
    var errors = [];

    if (!data.vendor_code || typeof data.vendor_code !== 'string' ||
        data.vendor_code.trim().length === 0) {
      errors.push('Vendor code is required.');
    } else if (data.vendor_code.trim().length > 20) {
      errors.push('Vendor code must not exceed 20 characters.');
    } else if (!/^[A-Za-z0-9]+$/.test(data.vendor_code.trim())) {
      errors.push('Vendor code must be alphanumeric (letters and numbers only).');
    }

    if (!data.name || typeof data.name !== 'string' ||
        data.name.trim().length === 0) {
      errors.push('Vendor name is required.');
    } else if (data.name.trim().length > 100) {
      errors.push('Vendor name must not exceed 100 characters.');
    }

    if (data.phone && data.phone.trim().length > 20) {
      errors.push('Phone must not exceed 20 characters.');
    }

    if (data.address && data.address.trim().length > 300) {
      errors.push('Address must not exceed 300 characters.');
    }

    if (data.gst_number && data.gst_number.trim().length > 0) {
      var gst = data.gst_number.trim().toUpperCase();
      if (gst.length !== 15) {
        errors.push('GST number must be exactly 15 characters.');
      } else if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gst)) {
        errors.push('GST number format is invalid (e.g. 27AAPFU0939F1ZV).');
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  async function addVendor(data) {
    var validation = validateVendor(data);
    if (!validation.valid) return { success: false, errors: validation.errors };

    try {
      var existing = await DataLayer.queryDocuments(COLLECTION_VENDORS, {
        where: [{ field: 'vendor_code', op: '==', value: data.vendor_code.trim() }]
      });
      if (existing && existing.length > 0) {
        return { success: false, errors: ['Vendor code already exists. Please use a different code.'] };
      }
    } catch (e) {
      return { success: false, errors: ['Failed to check for duplicates: ' + e.message] };
    }

    try {
      var id = await DataLayer.addDocument(COLLECTION_VENDORS, {
        vendor_code: data.vendor_code.trim(),
        name: data.name.trim(),
        phone: (data.phone || '').trim(),
        address: (data.address || '').trim(),
        gst_number: (data.gst_number || '').trim().toUpperCase(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return { success: true, id: id };
    } catch (e) {
      return { success: false, errors: ['Failed to save vendor: ' + e.message] };
    }
  }

  async function updateVendor(vendorId, data) {
    if (!vendorId) return { success: false, errors: ['Vendor ID is required.'] };

    var validation = validateVendor(data);
    if (!validation.valid) return { success: false, errors: validation.errors };

    try {
      var existing = await DataLayer.queryDocuments(COLLECTION_VENDORS, {
        where: [{ field: 'vendor_code', op: '==', value: data.vendor_code.trim() }]
      });
      if (existing && existing.length > 0) {
        var isDifferent = false;
        for (var i = 0; i < existing.length; i++) {
          if (existing[i].id !== vendorId) { isDifferent = true; break; }
        }
        if (isDifferent) {
          return { success: false, errors: ['Vendor code already exists. Please use a different code.'] };
        }
      }
    } catch (e) {
      return { success: false, errors: ['Failed to check for duplicates: ' + e.message] };
    }

    try {
      await DataLayer.updateDocument(COLLECTION_VENDORS, vendorId, {
        vendor_code: data.vendor_code.trim(),
        name: data.name.trim(),
        phone: (data.phone || '').trim(),
        address: (data.address || '').trim(),
        gst_number: (data.gst_number || '').trim().toUpperCase(),
        updated_at: new Date().toISOString()
      });
      return { success: true };
    } catch (e) {
      return { success: false, errors: ['Failed to update vendor: ' + e.message] };
    }
  }

  async function deleteVendor(vendorId) {
    if (!vendorId) return { success: false, errors: ['Vendor ID is required.'] };
    try {
      await DataLayer.deleteDocument(COLLECTION_VENDORS, vendorId);
      return { success: true };
    } catch (e) {
      return { success: false, errors: ['Failed to delete vendor: ' + e.message] };
    }
  }

  async function getAllVendors() {
    try {
      return await DataLayer.queryDocuments(COLLECTION_VENDORS, {
        orderBy: [{ field: 'vendor_code', direction: 'asc' }]
      });
    } catch (e) {
      return [];
    }
  }

  // ─── UI Initialization ───────────────────────────────────────────────────────

  function init() {
    if (typeof document === 'undefined') return;
    var container = document.querySelector('#screen-vendors .screen-content');
    if (!container) return;
    container.innerHTML = _buildVendorUI();
    _attachEventListeners();
    _loadVendorList();
  }

  // ─── UI Builders ─────────────────────────────────────────────────────────────

  function _buildVendorUI() {
    return '' +
      '<h2 class="screen-title">Vendor Management</h2>' +
      '<div class="vendor-toolbar toolbar">' +
        '<button type="button" id="vnd-btn-add" class="btn btn-primary">➕ Add Vendor</button>' +
      '</div>' +
      '<div class="inv-table-container table-wrapper" role="region" aria-label="Vendors table" tabindex="0">' +
        '<table class="data-table" id="vnd-table">' +
          '<thead><tr>' +
            '<th>Vendor Code</th>' +
            '<th>Name</th>' +
            '<th>Phone</th>' +
            '<th>GST No.</th>' +
            '<th>Address</th>' +
            '<th>Actions</th>' +
          '</tr></thead>' +
          '<tbody id="vnd-tbody"></tbody>' +
        '</table>' +
        '<p id="vnd-empty-msg" class="inv-empty-message" hidden>No vendors found. Add your first vendor.</p>' +
      '</div>' +
      _buildVendorModal();
  }

  function _buildVendorModal() {
    return '' +
      '<div id="vnd-modal" class="modal-overlay" hidden>' +
        '<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="vnd-modal-title">' +
          '<h3 id="vnd-modal-title">Add Vendor</h3>' +
          '<form id="vnd-form" novalidate>' +
            '<div class="form-row">' +
              '<label for="vnd-f-code">Vendor Code *</label>' +
              '<input type="text" id="vnd-f-code" maxlength="20" required ' +
                'placeholder="e.g. VNDRAY01 (alphanumeric, max 20)">' +
              '<span class="field-error" id="vnd-err-code"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="vnd-f-name">Vendor Name *</label>' +
              '<input type="text" id="vnd-f-name" maxlength="100" required>' +
              '<span class="field-error" id="vnd-err-name"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="vnd-f-phone">Phone</label>' +
              '<input type="tel" id="vnd-f-phone" maxlength="20" placeholder="Optional">' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="vnd-f-gst">GST Number</label>' +
              '<input type="text" id="vnd-f-gst" maxlength="15" ' +
                'placeholder="e.g. 27AAPFU0939F1ZV (optional)">' +
              '<span class="field-error" id="vnd-err-gst"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="vnd-f-address">Address</label>' +
              '<textarea id="vnd-f-address" maxlength="300" rows="3" ' +
                'placeholder="Optional"></textarea>' +
            '</div>' +
            '<div class="form-actions">' +
              '<button type="submit" class="btn btn-primary">Save</button>' +
              '<button type="button" class="btn btn-cancel" id="vnd-btn-cancel">Cancel</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────

  function _attachEventListeners() {
    var addBtn = document.getElementById('vnd-btn-add');
    if (addBtn) addBtn.addEventListener('click', function () { _openModal(null); });

    var cancelBtn = document.getElementById('vnd-btn-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', _closeModal);

    var form = document.getElementById('vnd-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        _handleSave();
      });
    }

    var tbody = document.getElementById('vnd-tbody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (btn.classList.contains('vnd-btn-edit')) {
          _openModal(id);
        } else if (btn.classList.contains('vnd-btn-delete')) {
          _handleDelete(id);
        }
      });
    }
  }

  // ─── List Loading & Rendering ────────────────────────────────────────────────

  async function _loadVendorList() {
    try {
      _allVendors = await getAllVendors();
    } catch (e) {
      _allVendors = [];
    }
    _renderTable(_allVendors);
  }

  function _renderTable(vendors) {
    var tbody = document.getElementById('vnd-tbody');
    var emptyMsg = document.getElementById('vnd-empty-msg');
    if (!tbody) return;

    if (!vendors || vendors.length === 0) {
      tbody.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;

    var html = '';
    for (var i = 0; i < vendors.length; i++) {
      var v = vendors[i];
      var address = v.address || '';
      var addressDisplay = address.length > 60
        ? address.substring(0, 60) + '…'
        : address;

      html += '<tr>';
      html += '<td><strong>' + Utils.escapeHtml(v.vendor_code || '') + '</strong></td>';
      html += '<td>' + Utils.escapeHtml(v.name || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(v.phone || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(v.gst_number || '') + '</td>';
      html += '<td title="' + Utils.escapeHtml(address) + '">' + Utils.escapeHtml(addressDisplay) + '</td>';
      html += '<td class="actions-cell">';
      html += '<button type="button" class="btn-icon-sm edit vnd-btn-edit" data-id="' +
        Utils.escapeHtml(v.id) + '" aria-label="Edit vendor" title="Edit">✏️</button>';
      html += '<button type="button" class="btn-icon-sm delete vnd-btn-delete" data-id="' +
        Utils.escapeHtml(v.id) + '" aria-label="Delete vendor" title="Delete">🗑️</button>';
      html += '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  // ─── Modal Handlers ──────────────────────────────────────────────────────────

  function _openModal(vendorId) {
    _currentEditId = vendorId;
    var modal = document.getElementById('vnd-modal');
    var title = document.getElementById('vnd-modal-title');
    if (!modal) return;

    _clearErrors();

    if (vendorId) {
      title.textContent = 'Edit Vendor';
      var vendor = null;
      for (var i = 0; i < _allVendors.length; i++) {
        if (_allVendors[i].id === vendorId) { vendor = _allVendors[i]; break; }
      }
      if (vendor) {
        document.getElementById('vnd-f-code').value    = vendor.vendor_code || '';
        document.getElementById('vnd-f-name').value    = vendor.name || '';
        document.getElementById('vnd-f-phone').value   = vendor.phone || '';
        document.getElementById('vnd-f-gst').value     = vendor.gst_number || '';
        document.getElementById('vnd-f-address').value = vendor.address || '';
      }
    } else {
      title.textContent = 'Add Vendor';
      document.getElementById('vnd-form').reset();
    }

    modal.hidden = false;
  }

  function _closeModal() {
    var modal = document.getElementById('vnd-modal');
    if (modal) modal.hidden = true;
    _currentEditId = null;
  }

  function _clearErrors() {
    var codeErr = document.getElementById('vnd-err-code');
    var nameErr = document.getElementById('vnd-err-name');
    var gstErr  = document.getElementById('vnd-err-gst');
    if (codeErr) codeErr.textContent = '';
    if (nameErr) nameErr.textContent = '';
    if (gstErr)  gstErr.textContent  = '';
  }

  // ─── Form Handler ────────────────────────────────────────────────────────────

  async function _handleSave() {
    _clearErrors();

    var data = {
      vendor_code: document.getElementById('vnd-f-code').value,
      name:        document.getElementById('vnd-f-name').value,
      phone:       document.getElementById('vnd-f-phone').value,
      gst_number:  document.getElementById('vnd-f-gst').value,
      address:     document.getElementById('vnd-f-address').value
    };

    var result;
    if (_currentEditId) {
      result = await updateVendor(_currentEditId, data);
    } else {
      result = await addVendor(data);
    }

    if (result.success) {
      Utils.showToast(_currentEditId ? 'Vendor updated successfully.' : 'Vendor added successfully.', 'success');
      _closeModal();
      _loadVendorList();
    } else {
      var errors = result.errors || [];
      for (var i = 0; i < errors.length; i++) {
        var msg = errors[i].toLowerCase();
        if (msg.indexOf('vendor code') !== -1 || msg.indexOf('code') !== -1) {
          var codeEl = document.getElementById('vnd-err-code');
          if (codeEl) codeEl.textContent = errors[i];
        } else if (msg.indexOf('name') !== -1) {
          var nameEl = document.getElementById('vnd-err-name');
          if (nameEl) nameEl.textContent = errors[i];
        } else if (msg.indexOf('gst') !== -1) {
          var gstEl = document.getElementById('vnd-err-gst');
          if (gstEl) gstEl.textContent = errors[i];
        }
      }
      Utils.showToast(errors[0] || 'Failed to save vendor.', 'error');
    }
  }

  async function _handleDelete(vendorId) {
    var confirmed = await Utils.showConfirmDialog(
      'Are you sure you want to delete this vendor? Items using this vendor code will not be affected.'
    );
    if (!confirmed) return;

    var result = await deleteVendor(vendorId);
    if (result.success) {
      Utils.showToast('Vendor deleted successfully.', 'success');
      _loadVendorList();
    } else {
      Utils.showToast((result.errors && result.errors[0]) || 'Failed to delete vendor.', 'error');
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    init: init,
    getAllVendors: getAllVendors
  };

})();
