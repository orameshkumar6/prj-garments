/**
 * Prj-Garments Firebase - Material Request Module
 * Material request creation, approval workflow, return processing, and UI rendering.
 * Uses DataLayer for all Firestore operations and Utils for shared helpers.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
var MaterialRequest = (function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  var COLLECTION_REQUESTS = 'material_requests';
  var COLLECTION_LOG = 'material_request_log';
  var COLLECTION_ITEMS = 'items';

  var STATUS_PENDING = 'Pending';
  var STATUS_APPROVED = 'Approved';
  var STATUS_REJECTED = 'Rejected';
  var STATUS_RETURNED = 'Returned';

  var MAX_EMPLOYEE_NAME = 100;
  var MAX_ITEMS_PER_REQUEST = 20;
  var MIN_QTY = 1;
  var MAX_QTY = 9999;

  // ─── Private State ──────────────────────────────────────────────────────────

  var _allRequests = [];
  var _allItems = [];
  var _currentFilter = 'all';

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function _getTodayString() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validates a material request data object.
   * Enforces: employee_name ≤ 100 chars, 1-20 items, qty 1-9999 per item.
   * @param {object} data - Request data with employee_name and items array
   * @returns {{valid: boolean, errors: string[]}}
   */
  function validateRequest(data) {
    var errors = [];

    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Request data must be a non-null object.'] };
    }

    // employee_name validation
    if (!data.employee_name || typeof data.employee_name !== 'string' ||
        data.employee_name.trim().length === 0) {
      errors.push('Employee name is required.');
    } else if (data.employee_name.trim().length > MAX_EMPLOYEE_NAME) {
      errors.push('Employee name must not exceed ' + MAX_EMPLOYEE_NAME + ' characters.');
    }

    // items validation
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      errors.push('At least one item is required.');
    } else if (data.items.length > MAX_ITEMS_PER_REQUEST) {
      errors.push('Maximum ' + MAX_ITEMS_PER_REQUEST + ' items per request.');
    } else {
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        if (!item || typeof item !== 'object') {
          errors.push('Item at index ' + i + ' is invalid.');
          continue;
        }
        if (!item.item_code || typeof item.item_code !== 'string' ||
            item.item_code.trim().length === 0) {
          errors.push('Item at index ' + i + ' must have a valid item_code.');
          continue;
        }
        var qty = Number(item.qty_requested);
        if (isNaN(qty) || !Number.isInteger(qty) || qty < MIN_QTY || qty > MAX_QTY) {
          errors.push('Item "' + item.item_code + '" quantity must be an integer between ' + MIN_QTY + ' and ' + MAX_QTY + '.');
        }
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  /**
   * Validates return items against an approved request.
   * Ensures returned qty per item does not exceed (issued - previously returned).
   * @param {string} requestId - ID of the material request
   * @param {Array<object>} returnItems - Array of {item_code, qty_returned}
   * @returns {Promise<{valid: boolean, errors: string[]}>}
   */
  async function validateReturn(requestId, returnItems) {
    var errors = [];

    if (!requestId || typeof requestId !== 'string') {
      return { valid: false, errors: ['Request ID is required.'] };
    }

    if (!returnItems || !Array.isArray(returnItems) || returnItems.length === 0) {
      return { valid: false, errors: ['At least one return item is required.'] };
    }

    // Fetch the request document
    var request = await DataLayer.getDocument(COLLECTION_REQUESTS, requestId);
    if (!request) {
      return { valid: false, errors: ['Material request not found.'] };
    }

    if (request.status !== STATUS_APPROVED) {
      return { valid: false, errors: ['Only approved requests can have returns processed.'] };
    }

    // Check each return item against issued quantities
    for (var i = 0; i < returnItems.length; i++) {
      var returnItem = returnItems[i];
      if (!returnItem || !returnItem.item_code) {
        errors.push('Return item at index ' + i + ' is invalid.');
        continue;
      }

      var qtyReturning = Number(returnItem.qty_returned) || 0;
      if (qtyReturning <= 0) {
        errors.push('Return quantity for "' + returnItem.item_code + '" must be greater than 0.');
        continue;
      }

      // Find matching item in the request
      var found = false;
      for (var j = 0; j < request.items.length; j++) {
        var reqItem = request.items[j];
        if (reqItem.item_code === returnItem.item_code) {
          found = true;
          var issued = Number(reqItem.qty_requested) || 0;
          var previouslyReturned = Number(reqItem.qty_returned) || 0;
          var outstanding = issued - previouslyReturned;

          if (qtyReturning > outstanding) {
            errors.push('Return quantity for "' + returnItem.item_code + '" (' + qtyReturning + ') exceeds outstanding quantity (' + outstanding + ').');
          }
          break;
        }
      }

      if (!found) {
        errors.push('Item "' + returnItem.item_code + '" not found in the original request.');
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  /**
   * Creates a new material request.
   * Validates data, saves to "material_requests" with status "Pending",
   * and logs to "material_request_log".
   * @param {object} data - Request data {employee_name, items: [{item_code, name, qty_requested}]}
   * @returns {Promise<{success: boolean, id?: string, error?: string}>}
   */
  async function createRequest(data) {
    // Validate request data
    var validation = validateRequest(data);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' ') };
    }

    // Build the request document
    var requestDoc = {
      employee_name: data.employee_name.trim(),
      items: [],
      status: STATUS_PENDING,
      request_date: data.request_date ? new Date(data.request_date) : new Date(),
      updated_at: new Date()
    };

    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      requestDoc.items.push({
        item_code: item.item_code.trim(),
        name: item.name || item.item_code.trim(),
        qty_requested: Number(item.qty_requested),
        qty_returned: 0
      });
    }

    try {
      // Save the request document
      var requestId = await DataLayer.addDocument(COLLECTION_REQUESTS, requestDoc);

      // Create log entry
      var logDoc = {
        request_id: requestId,
        type: 'request',
        employee_name: requestDoc.employee_name,
        items: requestDoc.items,
        date: new Date(),
        resulting_status: STATUS_PENDING
      };
      await DataLayer.addDocument(COLLECTION_LOG, logDoc);

      return { success: true, id: requestId };
    } catch (e) {
      return { success: false, error: 'Failed to create request: ' + (e.message || 'Unknown error') };
    }
  }

  /**
   * Approves a material request.
   * Validates stock for all items, then batch writes: decrement stock + update status + log entry.
   * Rejects if insufficient stock for any item.
   * @param {string} requestId - ID of the request to approve
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function approveRequest(requestId) {
    if (!requestId || typeof requestId !== 'string') {
      return { success: false, error: 'Request ID is required.' };
    }

    // Fetch the request
    var request = await DataLayer.getDocument(COLLECTION_REQUESTS, requestId);
    if (!request) {
      return { success: false, error: 'Material request not found.' };
    }

    if (request.status !== STATUS_PENDING) {
      return { success: false, error: 'Only pending requests can be approved.' };
    }

    // Validate stock for all items
    var insufficientItems = [];
    var itemDocs = [];

    for (var i = 0; i < request.items.length; i++) {
      var reqItem = request.items[i];
      var results = await DataLayer.queryDocuments(COLLECTION_ITEMS, {
        where: [{ field: 'item_code', op: '==', value: reqItem.item_code }],
        limit: 1
      });

      if (!results || results.length === 0) {
        insufficientItems.push({
          item_code: reqItem.item_code,
          available: 0,
          requested: reqItem.qty_requested
        });
        continue;
      }

      var stockItem = results[0];
      var available = Number(stockItem.quantity) || 0;

      if (available < reqItem.qty_requested) {
        insufficientItems.push({
          item_code: reqItem.item_code,
          available: available,
          requested: reqItem.qty_requested
        });
      } else {
        itemDocs.push({ docId: stockItem.id, qty: reqItem.qty_requested });
      }
    }

    if (insufficientItems.length > 0) {
      var errorParts = ['Insufficient stock:'];
      for (var k = 0; k < insufficientItems.length; k++) {
        var insItem = insufficientItems[k];
        errorParts.push(insItem.item_code + ' (available: ' + insItem.available + ', requested: ' + insItem.requested + ')');
      }
      return { success: false, error: errorParts.join(' ') };
    }

    // Build batch operations: decrement stock + update request status + log
    var operations = [];

    // Stock decrement operations
    for (var m = 0; m < itemDocs.length; m++) {
      var decrementData = {};
      decrementData.quantity = firebase.firestore.FieldValue.increment(-itemDocs[m].qty);
      decrementData.updated_at = firebase.firestore.FieldValue.serverTimestamp();

      operations.push({
        type: 'update',
        collection: COLLECTION_ITEMS,
        docId: itemDocs[m].docId,
        data: decrementData
      });
    }

    // Update request status
    operations.push({
      type: 'update',
      collection: COLLECTION_REQUESTS,
      docId: requestId,
      data: {
        status: STATUS_APPROVED,
        approval_date: new Date(),
        updated_at: new Date()
      }
    });

    // Log entry
    operations.push({
      type: 'set',
      collection: COLLECTION_LOG,
      data: {
        request_id: requestId,
        type: 'request',
        employee_name: request.employee_name,
        items: request.items,
        date: new Date(),
        resulting_status: STATUS_APPROVED
      }
    });

    try {
      await DataLayer.executeBatch(operations);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Approval failed: ' + (e.message || 'Unknown error') };
    }
  }

  /**
   * Rejects a material request.
   * Updates status to "Rejected" and creates a log entry.
   * @param {string} requestId - ID of the request to reject
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function rejectRequest(requestId) {
    if (!requestId || typeof requestId !== 'string') {
      return { success: false, error: 'Request ID is required.' };
    }

    var request = await DataLayer.getDocument(COLLECTION_REQUESTS, requestId);
    if (!request) {
      return { success: false, error: 'Material request not found.' };
    }

    if (request.status !== STATUS_PENDING) {
      return { success: false, error: 'Only pending requests can be rejected.' };
    }

    try {
      // Update request status
      await DataLayer.updateDocument(COLLECTION_REQUESTS, requestId, {
        status: STATUS_REJECTED,
        approval_date: new Date(),
        updated_at: new Date()
      });

      // Create log entry
      await DataLayer.addDocument(COLLECTION_LOG, {
        request_id: requestId,
        type: 'request',
        employee_name: request.employee_name,
        items: request.items,
        date: new Date(),
        resulting_status: STATUS_REJECTED
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: 'Rejection failed: ' + (e.message || 'Unknown error') };
    }
  }

  /**
   * Processes a return against an approved material request.
   * Validates return quantities, then batch writes: increment stock + update request items + log.
   * @param {string} requestId - ID of the approved request
   * @param {Array<object>} returnItems - Array of {item_code, qty_returned}
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function processReturn(requestId, returnItems) {
    // Validate the return
    var validation = await validateReturn(requestId, returnItems);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' ') };
    }

    // Fetch the request again for building batch operations
    var request = await DataLayer.getDocument(COLLECTION_REQUESTS, requestId);
    if (!request) {
      return { success: false, error: 'Material request not found.' };
    }

    // Build batch operations
    var operations = [];
    var updatedItems = [];

    // Copy existing items and update returned quantities
    for (var i = 0; i < request.items.length; i++) {
      var reqItem = request.items[i];
      var updatedItem = {
        item_code: reqItem.item_code,
        name: reqItem.name || reqItem.item_code,
        qty_requested: reqItem.qty_requested,
        qty_returned: reqItem.qty_returned || 0
      };

      // Check if this item is being returned
      for (var j = 0; j < returnItems.length; j++) {
        if (returnItems[j].item_code === reqItem.item_code) {
          updatedItem.qty_returned += Number(returnItems[j].qty_returned);
          break;
        }
      }

      updatedItems.push(updatedItem);
    }

    // Increment stock for each returned item
    for (var k = 0; k < returnItems.length; k++) {
      var retItem = returnItems[k];
      var qtyReturning = Number(retItem.qty_returned);

      // Find the item document in Firestore
      var results = await DataLayer.queryDocuments(COLLECTION_ITEMS, {
        where: [{ field: 'item_code', op: '==', value: retItem.item_code }],
        limit: 1
      });

      if (results && results.length > 0) {
        var incrementData = {};
        incrementData.quantity = firebase.firestore.FieldValue.increment(qtyReturning);
        incrementData.updated_at = firebase.firestore.FieldValue.serverTimestamp();

        operations.push({
          type: 'update',
          collection: COLLECTION_ITEMS,
          docId: results[0].id,
          data: incrementData
        });
      }
    }

    // Determine new status - if all items fully returned, mark as Returned
    var allReturned = true;
    for (var n = 0; n < updatedItems.length; n++) {
      if (updatedItems[n].qty_returned < updatedItems[n].qty_requested) {
        allReturned = false;
        break;
      }
    }

    var newStatus = allReturned ? STATUS_RETURNED : STATUS_APPROVED;

    // Update the request document with new item quantities and status
    operations.push({
      type: 'update',
      collection: COLLECTION_REQUESTS,
      docId: requestId,
      data: {
        items: updatedItems,
        status: newStatus,
        updated_at: new Date()
      }
    });

    // Create log entry for the return
    operations.push({
      type: 'set',
      collection: COLLECTION_LOG,
      data: {
        request_id: requestId,
        type: 'return',
        employee_name: request.employee_name,
        items: returnItems,
        date: new Date(),
        resulting_status: newStatus
      }
    });

    try {
      await DataLayer.executeBatch(operations);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Return processing failed: ' + (e.message || 'Unknown error') };
    }
  }

  // ─── Query Operations ───────────────────────────────────────────────────────

  /**
   * Queries material requests with optional filters.
   * @param {object} [filters] - Optional filter object
   * @param {string} [filters.status] - Filter by status (Pending, Approved, Rejected, Returned)
   * @param {string} [filters.employee_name] - Filter by employee name
   * @returns {Promise<Array<object>>} Array of request documents
   */
  async function getRequests(filters) {
    var queryConstraints = {
      orderBy: [{ field: 'request_date', direction: 'desc' }]
    };

    if (filters && typeof filters === 'object') {
      var whereClauses = [];

      if (filters.status && typeof filters.status === 'string') {
        whereClauses.push({ field: 'status', op: '==', value: filters.status });
      }

      if (filters.employee_name && typeof filters.employee_name === 'string') {
        whereClauses.push({ field: 'employee_name', op: '==', value: filters.employee_name });
      }

      if (whereClauses.length > 0) {
        queryConstraints.where = whereClauses;
      }
    }

    try {
      var results = await DataLayer.queryDocuments(COLLECTION_REQUESTS, queryConstraints);
      return results;
    } catch (e) {
      if (typeof Utils !== 'undefined') {
        Utils.showToast('Failed to load requests: ' + (e.message || 'Unknown error'), 'error');
      }
      return [];
    }
  }

  // ─── UI Rendering ───────────────────────────────────────────────────────────

  /**
   * Initializes the Material Request module UI.
   * Renders the request form, list, and actions in #screen-material-request .screen-content.
   */
  function init() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-material-request .screen-content');
    if (!container) return;

    container.innerHTML = _buildUI();
    _bindEvents();
    _loadItems();
    _loadRequests();
  }

  /**
   * Builds the HTML UI for the material request screen.
   * @returns {string} HTML string
   * @private
   */
  function _buildUI() {
    return '<h2 class="screen-title">Material Requests</h2>' +
      '<div class="material-request-container">' +
        // New Request Form
        '<div class="card mr-form-card">' +
          '<h3 class="card-title">New Material Request</h3>' +
          '<form id="mr-form" class="mr-form" novalidate>' +
            '<div class="form-group">' +
              '<label for="mr-employee-name">Employee Name</label>' +
              '<input type="text" id="mr-employee-name" maxlength="100" placeholder="Enter employee name" required />' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="mr-request-date">Request Date</label>' +
              '<input type="date" id="mr-request-date" value="' + _getTodayString() + '" required />' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Request Items</label>' +
              '<div id="mr-items-container" class="mr-items-container"></div>' +
              '<button type="button" id="mr-add-item-btn" class="btn btn-secondary btn-sm">+ Add Item</button>' +
            '</div>' +
            '<div id="mr-form-errors" class="form-errors" role="alert"></div>' +
            '<button type="submit" class="btn btn-primary">Submit Request</button>' +
          '</form>' +
        '</div>' +
        // Request List
        '<div class="card mr-list-card">' +
          '<h3 class="card-title">Request History</h3>' +
          '<div class="mr-filters">' +
            '<select id="mr-status-filter" class="form-input" aria-label="Filter by request status">' +
              '<option value="all">All Statuses</option>' +
              '<option value="Pending">Pending</option>' +
              '<option value="Approved">Approved</option>' +
              '<option value="Rejected">Rejected</option>' +
              '<option value="Returned">Returned</option>' +
            '</select>' +
          '</div>' +
          '<div id="mr-request-list" class="mr-request-list"></div>' +
        '</div>' +
      '</div>';
  }

  /**
   * Binds event listeners for the material request form and controls.
   * @private
   */
  function _bindEvents() {
    var form = document.getElementById('mr-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        _handleSubmitRequest();
      });
    }

    var addItemBtn = document.getElementById('mr-add-item-btn');
    if (addItemBtn) {
      addItemBtn.addEventListener('click', _addItemRow);
    }

    var statusFilter = document.getElementById('mr-status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', function () {
        _currentFilter = statusFilter.value;
        _loadRequests();
      });
    }
  }

  /**
   * Loads available inventory items for the item selection dropdown.
   * @private
   */
  async function _loadItems() {
    try {
      _allItems = await DataLayer.queryDocuments(COLLECTION_ITEMS, {});
    } catch (e) {
      _allItems = [];
    }

    // Add one initial item row
    _addItemRow();
  }

  /**
   * Adds an item row to the request form.
   * @private
   */
  function _addItemRow() {
    var container = document.getElementById('mr-items-container');
    if (!container) return;

    var rowCount = container.querySelectorAll('.mr-item-row').length;
    if (rowCount >= MAX_ITEMS_PER_REQUEST) {
      if (typeof Utils !== 'undefined') {
        Utils.showToast('Maximum ' + MAX_ITEMS_PER_REQUEST + ' items per request.', 'error');
      }
      return;
    }

    var row = document.createElement('div');
    row.className = 'mr-item-row';

    var itemOptions = '<option value="">Select item...</option>';
    for (var i = 0; i < _allItems.length; i++) {
      var it = _allItems[i];
      var esc = typeof Utils !== 'undefined' ? Utils.escapeHtml : function (s) { return s; };
      itemOptions += '<option value="' + esc(it.item_code) + '" data-name="' + esc(it.item_type || it.brand || it.item_code) + '">' +
        esc(it.item_code) + ' - ' + esc(it.item_type || '') + ' ' + esc(it.brand || '') +
        '</option>';
    }

    row.innerHTML =
      '<select class="mr-item-select form-input" aria-label="Select item for row ' + (rowCount + 1) + '">' + itemOptions + '</select>' +
      '<input type="number" class="mr-item-qty form-input" min="1" max="9999" value="1" placeholder="Qty" aria-label="Quantity for row ' + (rowCount + 1) + '" />' +
      '<button type="button" class="btn btn-danger btn-sm mr-remove-item">&times;</button>';

    // Remove button event
    row.querySelector('.mr-remove-item').addEventListener('click', function () {
      row.parentNode.removeChild(row);
    });

    container.appendChild(row);
  }

  /**
   * Handles form submission for creating a new request.
   * @private
   */
  async function _handleSubmitRequest() {
    var errContainer = document.getElementById('mr-form-errors');
    if (errContainer) errContainer.innerHTML = '';

    var employeeName = document.getElementById('mr-employee-name');
    var itemRows = document.querySelectorAll('#mr-items-container .mr-item-row');

    var items = [];
    for (var i = 0; i < itemRows.length; i++) {
      var select = itemRows[i].querySelector('.mr-item-select');
      var qtyInput = itemRows[i].querySelector('.mr-item-qty');
      if (select && select.value) {
        var selectedOption = select.options[select.selectedIndex];
        items.push({
          item_code: select.value,
          name: selectedOption.getAttribute('data-name') || select.value,
          qty_requested: parseInt(qtyInput.value, 10) || 1
        });
      }
    }

    var data = {
      employee_name: employeeName ? employeeName.value : '',
      items: items,
      request_date: document.getElementById('mr-request-date') ? document.getElementById('mr-request-date').value : _getTodayString()
    };

    var result = await createRequest(data);

    if (result.success) {
      if (typeof Utils !== 'undefined') Utils.showToast('Request submitted successfully.', 'success');
      // Reset form
      if (employeeName) employeeName.value = '';
      var container = document.getElementById('mr-items-container');
      if (container) container.innerHTML = '';
      _addItemRow();
      _loadRequests();
    } else {
      if (errContainer) {
        errContainer.textContent = result.error || 'Failed to submit request.';
      }
    }
  }

  // ─── Missing Helper: _loadRequests ──────────────────────────────────────────

  /**
   * Loads all material requests from Firestore and renders them.
   * @private
   */
  async function _loadRequests() {
    var listContainer = document.getElementById('mr-request-list');
    if (!listContainer) return;

    try {
      var constraints = {};
      if (_currentFilter && _currentFilter !== 'all') {
        constraints.where = [{ field: 'status', op: '==', value: _currentFilter }];
      }
      constraints.orderBy = [{ field: 'request_date', direction: 'desc' }];

      var requests = await DataLayer.queryDocuments(COLLECTION_REQUESTS, constraints);
      _renderRequestsList(requests, listContainer);
    } catch (e) {
      listContainer.innerHTML = '<p class="empty-state">Failed to load requests: ' + Utils.escapeHtml(e.message) + '</p>';
    }
  }

  /**
   * Renders the requests list table.
   * @param {Array} requests - Array of request documents
   * @param {HTMLElement} container - DOM container
   * @private
   */
  function _renderRequestsList(requests, container) {
    if (!requests || requests.length === 0) {
      container.innerHTML = '<p class="empty-state">No material requests found.</p>';
      return;
    }

    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
    html += '<th>Employee</th><th>Date</th><th>Items</th><th>Status</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < requests.length; i++) {
      var req = requests[i];
      var dateStr = Utils.formatDate(req.request_date ? new Date(req.request_date) : new Date());
      var itemCount = req.items ? req.items.length : 0;
      var statusClass = req.status === 'Approved' ? 'success' : (req.status === 'Pending' ? 'warning' : 'danger');

      html += '<tr>';
      html += '<td>' + Utils.escapeHtml(req.employee_name || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(dateStr) + '</td>';
      html += '<td>' + itemCount + ' item(s)</td>';
      html += '<td><span class="status-badge ' + statusClass + '">' + Utils.escapeHtml(req.status || '') + '</span></td>';
      html += '<td class="actions-cell">';
      if (req.status === 'Pending') {
        html += '<button class="btn-icon-sm btn-approve mr-approve-btn" data-id="' + Utils.escapeHtml(req.id) + '" aria-label="Approve request" title="Approve">✅</button>';
        html += '<button class="btn-icon-sm btn-reject mr-reject-btn" data-id="' + Utils.escapeHtml(req.id) + '" aria-label="Reject request" title="Reject">❌</button>';
      } else if (req.status === 'Approved') {
        html += '<button class="btn-icon-sm btn-return mr-return-btn" data-id="' + Utils.escapeHtml(req.id) + '" aria-label="Return materials" title="Return">↩️</button>';
      } else {
        html += '-';
      }
      html += '</td></tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Attach action listeners
    container.querySelectorAll('.mr-approve-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { _handleApprove(btn.dataset.id); });
    });
    container.querySelectorAll('.mr-reject-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { _handleReject(btn.dataset.id); });
    });
    container.querySelectorAll('.mr-return-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { _handleReturn(btn.dataset.id); });
    });
  }

  /**
   * Handles approve action.
   * @private
   */
  async function _handleApprove(requestId) {
    var result = await approveRequest(requestId);
    if (result.success) {
      Utils.showToast('Request approved.', 'success');
      _loadRequests();
    } else {
      Utils.showToast(result.error || 'Approval failed.', 'error');
    }
  }

  /**
   * Handles reject action.
   * @private
   */
  async function _handleReject(requestId) {
    var result = await rejectRequest(requestId);
    if (result.success) {
      Utils.showToast('Request rejected.', 'success');
      _loadRequests();
    } else {
      Utils.showToast(result.error || 'Rejection failed.', 'error');
    }
  }

  /**
   * Handles return action.
   * @private
   */
  async function _handleReturn(requestId) {
    var req = await DataLayer.getDocument(COLLECTION_REQUESTS, requestId);
    if (!req || !req.items) { Utils.showToast('Request not found.', 'error'); return; }

    // Check if there's anything to return
    var hasOutstanding = false;
    for (var i = 0; i < req.items.length; i++) {
      if ((req.items[i].qty_requested || 0) - (req.items[i].qty_returned || 0) > 0) {
        hasOutstanding = true;
        break;
      }
    }
    if (!hasOutstanding) { Utils.showToast('All items already returned.', 'info'); return; }

    // Build return form modal
    var esc = Utils.escapeHtml;
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'mr-return-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:24px;';

    var modalHtml = '<div class="modal" style="max-width:500px;">';
    modalHtml += '<h2>Return Materials</h2>';
    modalHtml += '<p style="margin-bottom:12px;color:var(--color-text-secondary);">Employee: <strong>' + esc(req.employee_name || '') + '</strong></p>';
    modalHtml += '<div class="table-wrapper"><table class="data-table"><thead><tr>';
    modalHtml += '<th>Item</th><th>Issued</th><th>Returned</th><th>Outstanding</th><th>Return Qty</th>';
    modalHtml += '</tr></thead><tbody>';

    for (var j = 0; j < req.items.length; j++) {
      var item = req.items[j];
      var issued = item.qty_requested || 0;
      var returned = item.qty_returned || 0;
      var outstanding = issued - returned;
      modalHtml += '<tr>';
      modalHtml += '<td>' + esc(item.name || item.item_code || '') + '</td>';
      modalHtml += '<td>' + issued + '</td>';
      modalHtml += '<td>' + returned + '</td>';
      modalHtml += '<td>' + outstanding + '</td>';
      modalHtml += '<td>';
      if (outstanding > 0) {
        modalHtml += '<input type="number" class="mr-return-qty-input form-input" data-code="' + esc(item.item_code) + '" min="0" max="' + outstanding + '" value="' + outstanding + '" style="width:70px;height:32px;" aria-label="Return qty for ' + esc(item.name || item.item_code) + '">';
      } else {
        modalHtml += '<span style="color:var(--color-text-secondary);">-</span>';
      }
      modalHtml += '</td></tr>';
    }

    modalHtml += '</tbody></table></div>';
    modalHtml += '<div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">';
    modalHtml += '<button type="button" class="btn btn-secondary" id="mr-return-cancel">Cancel</button>';
    modalHtml += '<button type="button" class="btn btn-primary" id="mr-return-submit">Submit Return</button>';
    modalHtml += '</div></div>';

    overlay.innerHTML = modalHtml;
    document.body.appendChild(overlay);

    // Cancel button
    document.getElementById('mr-return-cancel').addEventListener('click', function () {
      overlay.parentNode.removeChild(overlay);
    });

    // Submit button
    document.getElementById('mr-return-submit').addEventListener('click', async function () {
      var inputs = overlay.querySelectorAll('.mr-return-qty-input');
      var returnItems = [];

      for (var k = 0; k < inputs.length; k++) {
        var qty = parseInt(inputs[k].value, 10);
        if (!isNaN(qty) && qty > 0) {
          returnItems.push({ item_code: inputs[k].getAttribute('data-code'), qty_returned: qty });
        }
      }

      if (returnItems.length === 0) {
        Utils.showToast('Enter at least one return quantity.', 'error');
        return;
      }

      var result = await processReturn(requestId, returnItems);
      overlay.parentNode.removeChild(overlay);

      if (result.success) {
        Utils.showToast('Materials returned successfully.', 'success');
        _loadRequests();
      } else {
        Utils.showToast(result.error || 'Return failed.', 'error');
      }
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    createRequest: createRequest,
    approveRequest: approveRequest,
    rejectRequest: rejectRequest,
    processReturn: processReturn,
    getRequests: getRequests,
    validateRequest: validateRequest,
    validateReturn: validateReturn
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MaterialRequest;
}
