/**
 * Prj-Garments Firebase - Inventory Module
 * Item CRUD, stock replenishment, item code generation, re-order level configuration,
 * duplicate validation, and inventory UI rendering.
 */
var Inventory = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _generatedCodes = {};
  var _currentEditId = null;
  var _allItems = [];
  var _filteredItems = [];
  var _replenishList = [];
  var _addingForReplenish = false;

  // ─── Constants ──────────────────────────────────────────────────────────────

  var COLLECTION_ITEMS = 'items';
  var COLLECTION_REPLENISHMENT = 'replenishment_history';
  var ITEM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var ITEM_CODE_LENGTH = 5;
  var MAX_PRICE = 9999999.99;
  var MAX_REORDER = 99999;

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validates item data against business rules.
   * @param {object} itemData - Item data to validate
   * @returns {{valid: boolean, errors: string[]}}
   */
  function validateItem(itemData) {
    var errors = [];

    if (!itemData || typeof itemData !== 'object') {
      return { valid: false, errors: ['Item data must be a non-null object.'] };
    }

    // item_type: non-empty string, max 50 chars
    if (!itemData.item_type || typeof itemData.item_type !== 'string' ||
        itemData.item_type.trim().length === 0) {
      errors.push('Item type is required.');
    } else if (itemData.item_type.trim().length > 50) {
      errors.push('Item type must not exceed 50 characters.');
    }

    // vendor_code: non-empty, alphanumeric, max 20 chars
    if (!itemData.vendor_code || typeof itemData.vendor_code !== 'string' ||
        itemData.vendor_code.trim().length === 0) {
      errors.push('Vendor code is required.');
    } else if (itemData.vendor_code.trim().length > 20) {
      errors.push('Vendor code must not exceed 20 characters.');
    } else if (!/^[A-Za-z0-9]+$/.test(itemData.vendor_code.trim())) {
      errors.push('Vendor code must be alphanumeric.');
    }

    // batch_code: non-empty, alphanumeric, max 20 chars
    if (!itemData.batch_code || typeof itemData.batch_code !== 'string' ||
        itemData.batch_code.trim().length === 0) {
      errors.push('Batch code is required.');
    } else if (itemData.batch_code.trim().length > 20) {
      errors.push('Batch code must not exceed 20 characters.');
    } else if (!/^[A-Za-z0-9]+$/.test(itemData.batch_code.trim())) {
      errors.push('Batch code must be alphanumeric.');
    }

    // cost_price: number in (0, 9999999.99]
    var costPrice = Number(itemData.cost_price);
    if (itemData.cost_price === undefined || itemData.cost_price === null ||
        itemData.cost_price === '' || isNaN(costPrice)) {
      errors.push('Cost price must be a valid number.');
    } else if (costPrice <= 0 || costPrice > MAX_PRICE) {
      errors.push('Cost price must be between 0.01 and 9,999,999.99.');
    }

    // mrp: number in (0, 9999999.99]
    var mrp = Number(itemData.mrp);
    if (itemData.mrp === undefined || itemData.mrp === null ||
        itemData.mrp === '' || isNaN(mrp)) {
      errors.push('MRP must be a valid number.');
    } else if (mrp <= 0 || mrp > MAX_PRICE) {
      errors.push('MRP must be between 0.01 and 9,999,999.99.');
    }

    // sales_price: number in (0, 9999999.99], must be <= mrp
    var salesPrice = Number(itemData.sales_price);
    if (itemData.sales_price === undefined || itemData.sales_price === null ||
        itemData.sales_price === '' || isNaN(salesPrice)) {
      errors.push('Sales price must be a valid number.');
    } else if (salesPrice <= 0 || salesPrice > MAX_PRICE) {
      errors.push('Sales price must be between 0.01 and 9,999,999.99.');
    } else if (!isNaN(mrp) && mrp > 0 && salesPrice > mrp) {
      errors.push('Sales price must not exceed MRP.');
    }

    // quantity: non-negative integer
    var qty = Number(itemData.quantity);
    if (itemData.quantity === undefined || itemData.quantity === null ||
        itemData.quantity === '' || isNaN(qty)) {
      errors.push('Quantity must be a valid number.');
    } else if (!Number.isInteger(qty) || qty < 0) {
      errors.push('Quantity must be a non-negative integer.');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── Item Code Generation ───────────────────────────────────────────────────

  /**
   * Generates a unique item code in the format "ITM-XXXXX" where X is A-Z or 0-9.
   * @returns {string} Unique item code
   */
  function generateItemCode() {
    var code;
    var attempts = 0;
    var maxAttempts = 1000;

    do {
      var suffix = '';
      for (var i = 0; i < ITEM_CODE_LENGTH; i++) {
        var idx = Math.floor(Math.random() * ITEM_CODE_CHARS.length);
        suffix += ITEM_CODE_CHARS.charAt(idx);
      }
      code = 'ITM-' + suffix;
      attempts++;
    } while (_generatedCodes[code] && attempts < maxAttempts);

    _generatedCodes[code] = true;
    return code;
  }

  // ─── Discount Calculation ──────────────────────────────────────────────────

  /**
   * Calculates discount percentage from MRP and sales price.
   * @param {number} mrp - Maximum retail price
   * @param {number} salesPrice - Actual selling price
   * @returns {number} Discount percentage rounded to 2 decimal places
   */
  function calculateDiscount(mrp, salesPrice) {
    var m = Number(mrp);
    var sp = Number(salesPrice);
    if (isNaN(m) || isNaN(sp) || m <= 0) return 0;
    if (sp > m) return 0;
    var discount = ((m - sp) / m) * 100;
    return Math.round(discount * 100) / 100;
  }

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  /**
   * Adds a new item to the inventory.
   * Validates, checks duplicate vendor_code+batch_code, generates item_code, saves to Firestore.
   * @param {object} itemData - Item data to add
   * @returns {Promise<{success: boolean, id?: string, errors?: string[]}>}
   */
  async function addItem(itemData) {
    var validation = validateItem(itemData);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Check for duplicate vendor_code + batch_code
    try {
      var duplicates = await DataLayer.queryDocuments(COLLECTION_ITEMS, {
        where: [
          { field: 'vendor_code', op: '==', value: itemData.vendor_code.trim() },
          { field: 'batch_code', op: '==', value: itemData.batch_code.trim() }
        ]
      });

      if (duplicates && duplicates.length > 0) {
        return { success: false, errors: ['An item with this vendor code and batch code combination already exists.'] };
      }
    } catch (e) {
      return { success: false, errors: ['Failed to check for duplicates: ' + e.message] };
    }

    // Generate item code and compute discount
    var itemCode = generateItemCode();
    var discountPct = calculateDiscount(itemData.mrp, itemData.sales_price);

    var doc = {
      item_code: itemCode,
      item_type: itemData.item_type.trim(),
      brand: (itemData.brand || '').trim(),
      vendor_code: itemData.vendor_code.trim(),
      batch_code: itemData.batch_code.trim(),
      cost_price: Number(itemData.cost_price),
      mrp: Number(itemData.mrp),
      sales_price: Number(itemData.sales_price),
      discount_pct: discountPct,
      quantity: Number(itemData.quantity),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add optional reorder fields
    if (itemData.reorder_level !== undefined && itemData.reorder_level !== '') {
      doc.reorder_level = Number(itemData.reorder_level);
    }
    if (itemData.reorder_qty !== undefined && itemData.reorder_qty !== '') {
      doc.reorder_qty = Number(itemData.reorder_qty);
    }

    try {
      var docId = await DataLayer.addDocument(COLLECTION_ITEMS, doc);
      return { success: true, id: docId, item_code: itemCode };
    } catch (e) {
      return { success: false, errors: ['Failed to save item: ' + e.message] };
    }
  }

  /**
   * Updates an existing item in the inventory.
   * @param {string} itemId - Document ID of the item to update
   * @param {object} itemData - Updated item fields
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async function updateItem(itemId, itemData) {
    if (!itemId) {
      return { success: false, errors: ['Item ID is required.'] };
    }

    var validation = validateItem(itemData);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Check for duplicate vendor_code + batch_code (excluding current item)
    try {
      var duplicates = await DataLayer.queryDocuments(COLLECTION_ITEMS, {
        where: [
          { field: 'vendor_code', op: '==', value: itemData.vendor_code.trim() },
          { field: 'batch_code', op: '==', value: itemData.batch_code.trim() }
        ]
      });

      if (duplicates && duplicates.length > 0) {
        var isDifferentItem = duplicates.some(function (d) { return d.id !== itemId; });
        if (isDifferentItem) {
          return { success: false, errors: ['An item with this vendor code and batch code combination already exists.'] };
        }
      }
    } catch (e) {
      return { success: false, errors: ['Failed to check for duplicates: ' + e.message] };
    }

    var discountPct = calculateDiscount(itemData.mrp, itemData.sales_price);

    var updateData = {
      item_type: itemData.item_type.trim(),
      brand: (itemData.brand || '').trim(),
      vendor_code: itemData.vendor_code.trim(),
      batch_code: itemData.batch_code.trim(),
      cost_price: Number(itemData.cost_price),
      mrp: Number(itemData.mrp),
      sales_price: Number(itemData.sales_price),
      discount_pct: discountPct,
      quantity: Number(itemData.quantity),
      updated_at: new Date().toISOString()
    };

    if (itemData.reorder_level !== undefined && itemData.reorder_level !== '') {
      updateData.reorder_level = Number(itemData.reorder_level);
    }
    if (itemData.reorder_qty !== undefined && itemData.reorder_qty !== '') {
      updateData.reorder_qty = Number(itemData.reorder_qty);
    }

    try {
      await DataLayer.updateDocument(COLLECTION_ITEMS, itemId, updateData);
      return { success: true };
    } catch (e) {
      return { success: false, errors: ['Failed to update item: ' + e.message] };
    }
  }

  /**
   * Deletes an item from the inventory.
   * @param {string} itemId - Document ID of the item to delete
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async function deleteItem(itemId) {
    if (!itemId) {
      return { success: false, errors: ['Item ID is required.'] };
    }

    try {
      await DataLayer.deleteDocument(COLLECTION_ITEMS, itemId);
      return { success: true };
    } catch (e) {
      return { success: false, errors: ['Failed to delete item: ' + e.message] };
    }
  }

  /**
   * Retrieves a single item by its document ID.
   * @param {string} itemId - Document ID
   * @returns {Promise<object|null>}
   */
  async function getItem(itemId) {
    if (!itemId) return null;
    try {
      return await DataLayer.getDocument(COLLECTION_ITEMS, itemId);
    } catch (e) {
      return null;
    }
  }

  /**
   * Retrieves all items from the inventory.
   * @returns {Promise<Array<object>>}
   */
  async function getAllItems() {
    try {
      return await DataLayer.queryDocuments(COLLECTION_ITEMS, {});
    } catch (e) {
      return [];
    }
  }

  // ─── Stock Replenishment ─────────────────────────────────────────────────────

  /**
   * Replenishes stock for an existing item.
   * Validates item exists, uses atomic increment, creates replenishment_history document.
   * @param {object} replenishData - { item_code, batch_code, vendor_code, quantity }
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async function replenishStock(replenishData) {
    var errors = [];

    if (!replenishData || typeof replenishData !== 'object') {
      return { success: false, errors: ['Replenishment data is required.'] };
    }

    // Validate required fields
    if (!replenishData.item_code || typeof replenishData.item_code !== 'string' ||
        replenishData.item_code.trim().length === 0) {
      errors.push('Item code is required.');
    }
    if (!replenishData.batch_code || typeof replenishData.batch_code !== 'string' ||
        replenishData.batch_code.trim().length === 0) {
      errors.push('Batch code is required.');
    } else if (replenishData.batch_code.trim().length > 20) {
      errors.push('Batch code must not exceed 20 characters.');
    }
    if (!replenishData.vendor_code || typeof replenishData.vendor_code !== 'string' ||
        replenishData.vendor_code.trim().length === 0) {
      errors.push('Vendor code is required.');
    } else if (replenishData.vendor_code.trim().length > 20) {
      errors.push('Vendor code must not exceed 20 characters.');
    }

    var qty = Number(replenishData.quantity);
    if (replenishData.quantity === undefined || replenishData.quantity === null ||
        replenishData.quantity === '' || isNaN(qty)) {
      errors.push('Quantity must be a valid number.');
    } else if (!Number.isInteger(qty) || qty < 1 || qty > 99999) {
      errors.push('Quantity must be an integer between 1 and 99,999.');
    }

    if (errors.length > 0) {
      return { success: false, errors: errors };
    }

    // Find item by item_code
    var items;
    try {
      items = await DataLayer.queryDocuments(COLLECTION_ITEMS, {
        where: [{ field: 'item_code', op: '==', value: replenishData.item_code.trim() }]
      });
    } catch (e) {
      return { success: false, errors: ['Failed to look up item: ' + e.message] };
    }

    if (!items || items.length === 0) {
      return { success: false, errors: ['Item not found with the specified item code.'] };
    }

    var item = items[0];

    // Atomic increment of quantity
    try {
      await DataLayer.incrementField(COLLECTION_ITEMS, item.id, 'quantity', qty);
    } catch (e) {
      return { success: false, errors: ['Failed to update stock: ' + e.message] };
    }

    // Create replenishment history entry
    try {
      await DataLayer.addDocument(COLLECTION_REPLENISHMENT, {
        item_code: replenishData.item_code.trim(),
        batch_code: replenishData.batch_code.trim(),
        vendor_code: replenishData.vendor_code.trim(),
        quantity: qty,
        date: new Date().toISOString()
      });
    } catch (e) {
      // Stock was already incremented; log but don't fail the operation
      if (typeof console !== 'undefined') {
        console.error('Inventory: Failed to log replenishment history:', e);
      }
    }

    return { success: true };
  }

  // ─── Reorder Configuration ───────────────────────────────────────────────────

  /**
   * Sets reorder configuration (reorder_level and reorder_qty) for a category+brand combination.
   * Updates all items matching the category and brand.
   * @param {string} category - Item type / category
   * @param {string} brand - Brand name
   * @param {object} config - { reorder_level, reorder_qty }
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async function setReorderConfig(category, brand, config) {
    var errors = [];

    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      errors.push('Category is required.');
    }
    if (!brand || typeof brand !== 'string' || brand.trim().length === 0) {
      errors.push('Brand is required.');
    }

    var level = Number(config && config.reorder_level);
    var qty = Number(config && config.reorder_qty);

    if (isNaN(level) || !Number.isInteger(level) || level < 1 || level > MAX_REORDER) {
      errors.push('Reorder level must be an integer between 1 and 99,999.');
    }
    if (isNaN(qty) || !Number.isInteger(qty) || qty < 1 || qty > MAX_REORDER) {
      errors.push('Reorder quantity must be an integer between 1 and 99,999.');
    }

    if (errors.length > 0) {
      return { success: false, errors: errors };
    }

    // Find items matching category + brand
    try {
      var items = await DataLayer.queryDocuments(COLLECTION_ITEMS, {
        where: [
          { field: 'item_type', op: '==', value: category.trim() },
          { field: 'brand', op: '==', value: brand.trim() }
        ]
      });

      if (!items || items.length === 0) {
        return { success: false, errors: ['No items found for this category and brand.'] };
      }

      // Update each item with the reorder config
      for (var i = 0; i < items.length; i++) {
        await DataLayer.updateDocument(COLLECTION_ITEMS, items[i].id, {
          reorder_level: level,
          reorder_qty: qty,
          updated_at: new Date().toISOString()
        });
      }

      return { success: true };
    } catch (e) {
      return { success: false, errors: ['Failed to save reorder config: ' + e.message] };
    }
  }

  /**
   * Gets reorder configuration for a category+brand combination.
   * Returns reorder_level and reorder_qty from the first matching item.
   * @param {string} category - Item type / category
   * @param {string} brand - Brand name
   * @returns {Promise<{reorder_level: number|null, reorder_qty: number|null}>}
   */
  async function getReorderConfig(category, brand) {
    if (!category || !brand) {
      return { reorder_level: null, reorder_qty: null };
    }

    try {
      var items = await DataLayer.queryDocuments(COLLECTION_ITEMS, {
        where: [
          { field: 'item_type', op: '==', value: category.trim() },
          { field: 'brand', op: '==', value: brand.trim() }
        ],
        limit: 1
      });

      if (items && items.length > 0) {
        return {
          reorder_level: items[0].reorder_level || null,
          reorder_qty: items[0].reorder_qty || null
        };
      }
    } catch (e) {
      // Silently fail; return defaults
    }

    return { reorder_level: null, reorder_qty: null };
  }

  // ─── UI Rendering ────────────────────────────────────────────────────────────

  /**
   * Initializes the inventory module: renders UI into #screen-inventory .screen-content.
   */
  function init() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-inventory .screen-content');
    if (!container) return;

    container.innerHTML = _buildInventoryUI();
    _attachEventListeners();
    _loadItemList();
  }

  /**
   * Builds the full inventory UI HTML.
   * @private
   * @returns {string}
   */
  function _buildInventoryUI() {
    return '' +
      '<h2 class="screen-title">Inventory Management</h2>' +
      '<!-- Search and Filter Bar -->' +
      '<div class="inv-toolbar toolbar">' +
        '<input type="text" id="inv-search" class="inv-search-input" ' +
          'placeholder="Search by item type, brand, vendor or batch code..." ' +
          'aria-label="Search inventory items">' +
        '<select id="inv-filter-type" class="inv-filter-select" aria-label="Filter by item type">' +
          '<option value="">All Types</option>' +
        '</select>' +
        '<button type="button" id="inv-btn-add" class="btn btn-primary">' +
          '➕ Add Item' +
        '</button>' +
        '<button type="button" id="inv-btn-replenish" class="btn btn-secondary">' +
          '📦 Replenish' +
        '</button>' +
        '<button type="button" id="inv-btn-load-defaults" class="btn btn-secondary">' +
          '📥 Load Samples' +
        '</button>' +
      '</div>' +
      '<!-- Bulk Action Bar -->' +
      '<div id="inv-bulk-bar" class="bulk-action-bar" hidden>' +
        '<span class="bulk-count" id="inv-bulk-count">0 selected</span>' +
        '<button type="button" class="btn btn-sm" id="inv-bulk-delete">🗑️ Delete Selected</button>' +
      '</div>' +
      '<!-- Items Table -->' +
      '<div class="inv-table-container table-wrapper" role="region" aria-label="Inventory items table" tabindex="0">' +
        '<table class="inv-table data-table" id="inv-items-table">' +
          '<thead><tr>' +
            '<th class="check-cell"><input type="checkbox" id="inv-select-all" aria-label="Select all items"></th>' +
            '<th>Code</th><th>Type</th><th>Brand</th>' +
            '<th>Vendor</th><th>Batch</th><th>MRP</th>' +
            '<th>Sales Price</th><th>Qty</th><th>Actions</th>' +
          '</tr></thead>' +
          '<tbody id="inv-items-tbody"></tbody>' +
        '</table>' +
        '<p id="inv-empty-msg" class="inv-empty-message" hidden>No items found.</p>' +
      '</div>' +
      '<!-- Add/Edit Modal -->' +
      _buildItemModal() +
      '<!-- Replenishment Screen -->' +
      _buildReplenishScreen();
  }

  /**
   * Builds the add/edit item modal HTML.
   * @private
   */
  function _buildItemModal() {
    return '' +
      '<div id="inv-item-modal" class="modal-overlay" hidden>' +
        '<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="inv-modal-title">' +
          '<h3 id="inv-modal-title">Add Item</h3>' +
          '<form id="inv-item-form" novalidate>' +
            '<div class="form-row">' +
              '<label for="inv-f-item-type">Item Type *</label>' +
              '<input type="text" id="inv-f-item-type" maxlength="50" required>' +
              '<span class="field-error" id="inv-err-item-type"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-brand">Brand</label>' +
              '<input type="text" id="inv-f-brand" maxlength="100">' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-vendor-code">Vendor Code *</label>' +
              '<input type="text" id="inv-f-vendor-code" maxlength="20" required list="inv-vendor-datalist">' +
              '<datalist id="inv-vendor-datalist"></datalist>' +
              '<span class="field-error" id="inv-err-vendor-code"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-batch-code">Batch Code *</label>' +
              '<input type="text" id="inv-f-batch-code" maxlength="20" required>' +
              '<span class="field-error" id="inv-err-batch-code"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-cost-price">Cost Price *</label>' +
              '<input type="number" id="inv-f-cost-price" min="0.01" max="9999999.99" step="0.01" required>' +
              '<span class="field-error" id="inv-err-cost-price"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-mrp">MRP *</label>' +
              '<input type="number" id="inv-f-mrp" min="0.01" max="9999999.99" step="0.01" required>' +
              '<span class="field-error" id="inv-err-mrp"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-sales-price">Sales Price *</label>' +
              '<input type="number" id="inv-f-sales-price" min="0.01" max="9999999.99" step="0.01" required>' +
              '<span class="field-error" id="inv-err-sales-price"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-quantity">Quantity *</label>' +
              '<input type="number" id="inv-f-quantity" min="0" step="1" required>' +
              '<span class="field-error" id="inv-err-quantity"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-reorder-level">Reorder Level</label>' +
              '<input type="number" id="inv-f-reorder-level" min="1" max="99999" step="1" placeholder="Optional">' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="inv-f-reorder-qty">Reorder Quantity</label>' +
              '<input type="number" id="inv-f-reorder-qty" min="1" max="99999" step="1" placeholder="Optional">' +
            '</div>' +
            '<div class="form-actions">' +
              '<button type="submit" class="btn btn-primary">Save</button>' +
              '<button type="button" class="btn btn-cancel" id="inv-btn-cancel-item">Cancel</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
  }

  /**
   * Builds the full-screen replenishment overlay HTML.
   * @private
   */
  function _buildReplenishScreen() {
    return '' +
      '<div id="inv-replenish-screen" class="inv-replenish-screen" hidden>' +
        '<div class="inv-replenish-screen-header">' +
          '<h3>Replenish Stock</h3>' +
          '<button type="button" id="inv-replenish-close" class="btn btn-cancel" aria-label="Close">✕ Close</button>' +
        '</div>' +
        '<div class="inv-replenish-body">' +
          '<div class="inv-replenish-search-pane">' +
            '<div class="inv-replenish-pane-title">Search Items</div>' +
            '<input type="text" id="inv-rs-search" class="inv-rs-search-input" placeholder="Search by code, type, brand, vendor...">' +
            '<div id="inv-rs-results" class="inv-rs-results"></div>' +
            '<button type="button" id="inv-rs-create-new" class="btn btn-secondary" style="width:100%">➕ Create New Item</button>' +
          '</div>' +
          '<div class="inv-replenish-list-pane">' +
            '<div class="inv-replenish-pane-title">To Be Confirmed</div>' +
            '<div id="inv-rs-list-container" class="inv-rs-list-container">' +
              '<p id="inv-rs-empty" class="inv-rs-empty-msg">No items added yet. Search and add items on the left.</p>' +
              '<div class="inv-rs-table-wrap">' +
                '<table id="inv-rs-list-table" class="data-table inv-rs-list-table" hidden>' +
                  '<thead><tr>' +
                    '<th>Code</th><th>Type</th><th>Brand</th><th>Current Stock</th><th>Add Qty</th><th></th>' +
                  '</tr></thead>' +
                  '<tbody id="inv-rs-list-tbody"></tbody>' +
                '</table>' +
              '</div>' +
            '</div>' +
            '<div class="inv-replenish-footer">' +
              '<button type="button" id="inv-rs-confirm-all" class="btn btn-primary" disabled>✅ Confirm All</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ─── Event Listeners ────────────────────────────────────────────────────────

  /**
   * Attaches event listeners for UI interactions.
   * @private
   */
  function _attachEventListeners() {
    // Add Item button
    var addBtn = document.getElementById('inv-btn-add');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        _openItemModal(null);
      });
    }

    // Replenish button
    var replenishBtn = document.getElementById('inv-btn-replenish');
    if (replenishBtn) {
      replenishBtn.addEventListener('click', function () {
        _openReplenishScreen();
      });
    }

    // Load Sample Items button
    var loadDefaultsBtn = document.getElementById('inv-btn-load-defaults');
    if (loadDefaultsBtn) {
      loadDefaultsBtn.addEventListener('click', _handleLoadDefaults);
    }

    // Cancel item modal button
    var cancelItem = document.getElementById('inv-btn-cancel-item');
    if (cancelItem) cancelItem.addEventListener('click', _closeItemModal);

    // Item form submit
    var itemForm = document.getElementById('inv-item-form');
    if (itemForm) {
      itemForm.addEventListener('submit', function (e) {
        e.preventDefault();
        _handleItemSave();
      });
    }

    // Replenish screen close button
    var replenishClose = document.getElementById('inv-replenish-close');
    if (replenishClose) {
      replenishClose.addEventListener('click', _closeReplenishScreen);
    }

    // Replenish screen: search
    var rsSearch = document.getElementById('inv-rs-search');
    if (rsSearch) {
      rsSearch.addEventListener('input', Utils.debounce(function () {
        _renderReplenishResults(rsSearch.value);
      }, 250));
    }

    // Replenish screen: create new item
    var rsCreateNew = document.getElementById('inv-rs-create-new');
    if (rsCreateNew) {
      rsCreateNew.addEventListener('click', function () {
        _addingForReplenish = true;
        _openItemModal(null);
      });
    }

    // Replenish screen: add to list (delegated on results container)
    var rsResults = document.getElementById('inv-rs-results');
    if (rsResults) {
      rsResults.addEventListener('click', function (e) {
        var btn = e.target.closest('.inv-rs-add-btn');
        if (!btn) return;
        var itemId = btn.getAttribute('data-id');
        var qtyInput = rsResults.querySelector('.inv-rs-qty-input[data-id="' + itemId + '"]');
        var qty = qtyInput ? parseInt(qtyInput.value, 10) : 1;
        if (!qty || qty < 1) qty = 1;
        _addToReplenishList(itemId, qty);
      });
    }

    // Replenish screen: remove from list + qty change (delegated on list tbody)
    var rsListContainer = document.getElementById('inv-rs-list-container');
    if (rsListContainer) {
      rsListContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('.inv-rs-remove-btn');
        if (!btn) return;
        _removeFromReplenishList(btn.getAttribute('data-id'));
      });
    }

    // Replenish screen: confirm all
    var rsConfirmAll = document.getElementById('inv-rs-confirm-all');
    if (rsConfirmAll) {
      rsConfirmAll.addEventListener('click', _handleConfirmReplenish);
    }

    // Search input
    var searchInput = document.getElementById('inv-search');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce(function () {
        _filterItems(searchInput.value);
      }, 300));
    }

    // Filter by type
    var filterType = document.getElementById('inv-filter-type');
    if (filterType) {
      filterType.addEventListener('change', function () {
        _filterItems(document.getElementById('inv-search').value, filterType.value);
      });
    }

    // Delegate clicks on items table (edit/delete)
    var tbody = document.getElementById('inv-items-tbody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var itemId = btn.getAttribute('data-id');
        if (btn.classList.contains('inv-btn-edit')) {
          _openItemModal(itemId);
        } else if (btn.classList.contains('inv-btn-delete')) {
          _handleDelete(itemId);
        }
      });

      // Individual checkbox change: update bulk bar and select-all state
      tbody.addEventListener('change', function (e) {
        if (e.target.classList.contains('inv-item-check')) {
          _updateBulkBar();
        }
      });
    }

    // Select All checkbox
    var selectAll = document.getElementById('inv-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', function () {
        var checkboxes = document.querySelectorAll('.inv-item-check');
        for (var i = 0; i < checkboxes.length; i++) {
          checkboxes[i].checked = selectAll.checked;
        }
        _updateBulkBar();
      });
    }

    // Bulk Delete button
    var bulkDeleteBtn = document.getElementById('inv-bulk-delete');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', _handleBulkDelete);
    }
  }

  // ─── UI Helpers ──────────────────────────────────────────────────────────────

  /**
   * Loads the items list and renders table.
   * @private
   */
  async function _loadItemList() {
    try {
      _allItems = await getAllItems();
    } catch (e) {
      _allItems = [];
    }
    _updateTypeFilter();
    _filteredItems = _allItems.slice();
    _renderItemsTable(_filteredItems);
  }

  /**
   * Updates the type filter dropdown with distinct item types.
   * @private
   */
  function _updateTypeFilter() {
    var select = document.getElementById('inv-filter-type');
    if (!select) return;

    var types = {};
    for (var i = 0; i < _allItems.length; i++) {
      if (_allItems[i].item_type) {
        types[_allItems[i].item_type] = true;
      }
    }

    var optionsHtml = '<option value="">All Types</option>';
    var sortedTypes = Object.keys(types).sort();
    for (var j = 0; j < sortedTypes.length; j++) {
      optionsHtml += '<option value="' + Utils.escapeHtml(sortedTypes[j]) + '">' +
        Utils.escapeHtml(sortedTypes[j]) + '</option>';
    }
    select.innerHTML = optionsHtml;
  }

  /**
   * Filters items based on search text and type filter.
   * @private
   */
  function _filterItems(searchText, typeFilter) {
    var search = (searchText || '').toLowerCase().trim();
    typeFilter = typeFilter || (document.getElementById('inv-filter-type') || {}).value || '';

    _filteredItems = _allItems.filter(function (item) {
      var matchesType = !typeFilter || item.item_type === typeFilter;
      if (!matchesType) return false;
      if (!search) return true;

      return (item.item_type || '').toLowerCase().indexOf(search) !== -1 ||
             (item.brand || '').toLowerCase().indexOf(search) !== -1 ||
             (item.vendor_code || '').toLowerCase().indexOf(search) !== -1 ||
             (item.batch_code || '').toLowerCase().indexOf(search) !== -1 ||
             (item.item_code || '').toLowerCase().indexOf(search) !== -1;
    });

    _renderItemsTable(_filteredItems);
  }

  /**
   * Renders the items table body.
   * @private
   */
  function _renderItemsTable(items) {
    var tbody = document.getElementById('inv-items-tbody');
    var emptyMsg = document.getElementById('inv-empty-msg');
    var bulkBar = document.getElementById('inv-bulk-bar');
    var selectAll = document.getElementById('inv-select-all');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      if (bulkBar) bulkBar.hidden = true;
      if (selectAll) selectAll.checked = false;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      html += '<tr>';
      html += '<td class="check-cell"><input type="checkbox" class="inv-item-check" data-id="' + Utils.escapeHtml(item.id) + '" aria-label="Select ' + Utils.escapeHtml(item.item_code || '') + '"></td>';
      html += '<td>' + Utils.escapeHtml(item.item_code || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.item_type || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.brand || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.vendor_code || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(item.batch_code || '') + '</td>';
      html += '<td>' + Utils.formatCurrency(item.mrp) + '</td>';
      html += '<td>' + Utils.formatCurrency(item.sales_price) + '</td>';
      html += '<td>' + (item.quantity || 0) + '</td>';
      html += '<td class="actions-cell">';
      html += '<button type="button" class="btn-icon-sm edit inv-btn-edit" data-id="' + Utils.escapeHtml(item.id) + '" aria-label="Edit item" title="Edit">✏️</button>';
      html += '<button type="button" class="btn-icon-sm delete inv-btn-delete" data-id="' + Utils.escapeHtml(item.id) + '" aria-label="Delete item" title="Delete">🗑️</button>';
      html += '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;

    // Reset select-all and bulk bar after re-render
    if (selectAll) selectAll.checked = false;
    if (bulkBar) bulkBar.hidden = true;
  }

  // ─── Modal Handlers ─────────────────────────────────────────────────────────

  /**
   * Opens the add/edit item modal.
   * @private
   */
  async function _loadVendorDatalist() {
    var datalist = document.getElementById('inv-vendor-datalist');
    if (!datalist) return;
    if (typeof Vendor === 'undefined' || !Vendor.getAllVendors) return;
    try {
      var vendors = await Vendor.getAllVendors();
      var html = '';
      for (var i = 0; i < vendors.length; i++) {
        html += '<option value="' + Utils.escapeHtml(vendors[i].vendor_code) + '">' +
          Utils.escapeHtml(vendors[i].name) + '</option>';
      }
      datalist.innerHTML = html;
    } catch (e) {
      // silently ignore — input still works as free text
    }
  }

  async function _openItemModal(itemId) {
    _currentEditId = itemId;
    var modal = document.getElementById('inv-item-modal');
    var title = document.getElementById('inv-modal-title');
    if (!modal) return;

    _clearFormErrors('inv-item-form');
    _loadVendorDatalist();

    if (itemId) {
      title.textContent = 'Edit Item';
      var item = await getItem(itemId);
      if (item) {
        document.getElementById('inv-f-item-type').value = item.item_type || '';
        document.getElementById('inv-f-brand').value = item.brand || '';
        document.getElementById('inv-f-vendor-code').value = item.vendor_code || '';
        document.getElementById('inv-f-batch-code').value = item.batch_code || '';
        document.getElementById('inv-f-cost-price').value = item.cost_price || '';
        document.getElementById('inv-f-mrp').value = item.mrp || '';
        document.getElementById('inv-f-sales-price').value = item.sales_price || '';
        document.getElementById('inv-f-quantity').value = item.quantity || 0;
        document.getElementById('inv-f-reorder-level').value = item.reorder_level != null ? item.reorder_level : '';
        document.getElementById('inv-f-reorder-qty').value = item.reorder_qty != null ? item.reorder_qty : '';
      }
    } else {
      title.textContent = 'Add Item';
      document.getElementById('inv-item-form').reset();
    }

    modal.hidden = false;
  }

  function _closeItemModal() {
    var modal = document.getElementById('inv-item-modal');
    if (modal) modal.hidden = true;
    _currentEditId = null;
  }

  function _openReplenishScreen() {
    _replenishList = [];
    var screen = document.getElementById('inv-replenish-screen');
    if (!screen) return;
    screen.hidden = false;
    var searchInput = document.getElementById('inv-rs-search');
    if (searchInput) searchInput.value = '';
    _renderReplenishResults('');
    _renderReplenishList();
  }

  function _closeReplenishScreen() {
    var screen = document.getElementById('inv-replenish-screen');
    if (screen) screen.hidden = true;
    _replenishList = [];
  }

  function _renderReplenishResults(searchText) {
    var container = document.getElementById('inv-rs-results');
    if (!container) return;

    var search = (searchText || '').toLowerCase().trim();
    var results;
    if (search) {
      results = [];
      for (var i = 0; i < _allItems.length; i++) {
        var it = _allItems[i];
        if ((it.item_code || '').toLowerCase().indexOf(search) !== -1 ||
            (it.item_type || '').toLowerCase().indexOf(search) !== -1 ||
            (it.brand || '').toLowerCase().indexOf(search) !== -1 ||
            (it.vendor_code || '').toLowerCase().indexOf(search) !== -1) {
          results.push(it);
          if (results.length >= 20) break;
        }
      }
    } else {
      results = _allItems.slice(0, 20);
    }

    if (results.length === 0) {
      container.innerHTML = '<p class="inv-rs-no-results">No items found.</p>';
      return;
    }

    var html = '';
    for (var j = 0; j < results.length; j++) {
      var item = results[j];
      var alreadyAdded = false;
      for (var n = 0; n < _replenishList.length; n++) {
        if (_replenishList[n].item.id === item.id) { alreadyAdded = true; break; }
      }
      var safeId = Utils.escapeHtml(item.id);
      html += '<div class="inv-rs-result-row">';
      html += '<div class="inv-rs-result-info">';
      html += '<span class="inv-rs-result-code">' + Utils.escapeHtml(item.item_code || '') + '</span>';
      html += '<span class="inv-rs-result-type">' + Utils.escapeHtml(item.item_type || '') + (item.brand ? ' · ' + Utils.escapeHtml(item.brand) : '') + '</span>';
      html += '<span class="inv-rs-result-stock">Stock: ' + (item.quantity || 0) + '</span>';
      html += '</div>';
      html += '<div class="inv-rs-result-actions">';
      if (alreadyAdded) {
        html += '<span class="inv-rs-added-badge">✓ Added</span>';
      } else {
        html += '<input type="number" class="inv-rs-qty-input" min="1" max="99999" value="1" data-id="' + safeId + '">';
        html += '<button type="button" class="btn btn-sm btn-primary inv-rs-add-btn" data-id="' + safeId + '">Add</button>';
      }
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function _addToReplenishList(itemId, qty) {
    var item = null;
    for (var i = 0; i < _allItems.length; i++) {
      if (_allItems[i].id === itemId) { item = _allItems[i]; break; }
    }
    if (!item) return;

    for (var j = 0; j < _replenishList.length; j++) {
      if (_replenishList[j].item.id === itemId) {
        Utils.showToast('Item already in the list.', 'info');
        return;
      }
    }

    _replenishList.push({ item: item, qty: qty });
    _renderReplenishList();
    _renderReplenishResults(
      (document.getElementById('inv-rs-search') || {}).value || ''
    );
  }

  function _removeFromReplenishList(itemId) {
    var newList = [];
    for (var i = 0; i < _replenishList.length; i++) {
      if (_replenishList[i].item.id !== itemId) newList.push(_replenishList[i]);
    }
    _replenishList = newList;
    _renderReplenishList();
    _renderReplenishResults(
      (document.getElementById('inv-rs-search') || {}).value || ''
    );
  }

  function _renderReplenishList() {
    var emptyMsg = document.getElementById('inv-rs-empty');
    var table = document.getElementById('inv-rs-list-table');
    var tbody = document.getElementById('inv-rs-list-tbody');
    var confirmBtn = document.getElementById('inv-rs-confirm-all');

    if (!tbody) return;

    if (_replenishList.length === 0) {
      if (emptyMsg) emptyMsg.hidden = false;
      if (table) table.hidden = true;
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;
    if (table) table.hidden = false;
    if (confirmBtn) confirmBtn.disabled = false;

    var html = '';
    for (var i = 0; i < _replenishList.length; i++) {
      var row = _replenishList[i];
      var safeId = Utils.escapeHtml(row.item.id);
      html += '<tr>';
      html += '<td>' + Utils.escapeHtml(row.item.item_code || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(row.item.item_type || '') + '</td>';
      html += '<td>' + Utils.escapeHtml(row.item.brand || '') + '</td>';
      html += '<td>' + (row.item.quantity || 0) + '</td>';
      html += '<td><input type="number" class="inv-rs-list-qty" min="1" max="99999" value="' + row.qty + '" data-id="' + safeId + '"></td>';
      html += '<td><button type="button" class="btn btn-sm btn-danger inv-rs-remove-btn" data-id="' + safeId + '">Remove</button></td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  async function _handleConfirmReplenish() {
    if (_replenishList.length === 0) return;

    var items = [];
    for (var i = 0; i < _replenishList.length; i++) {
      var qtyInput = document.querySelector('.inv-rs-list-qty[data-id="' + _replenishList[i].item.id + '"]');
      var qty = qtyInput ? parseInt(qtyInput.value, 10) : _replenishList[i].qty;
      if (!qty || qty < 1 || qty > 99999) {
        Utils.showToast('Invalid quantity for ' + (_replenishList[i].item.item_code || 'item') + '.', 'error');
        return;
      }
      items.push({ item: _replenishList[i].item, qty: qty });
    }

    var confirmBtn = document.getElementById('inv-rs-confirm-all');
    if (confirmBtn) confirmBtn.disabled = true;

    var successCount = 0;
    var failCount = 0;

    for (var j = 0; j < items.length; j++) {
      try {
        await DataLayer.incrementField(COLLECTION_ITEMS, items[j].item.id, 'quantity', items[j].qty);
        await DataLayer.addDocument(COLLECTION_REPLENISHMENT, {
          item_code: items[j].item.item_code || '',
          item_type: items[j].item.item_type || '',
          brand: items[j].item.brand || '',
          batch_code: items[j].item.batch_code || '',
          vendor_code: items[j].item.vendor_code || '',
          quantity: items[j].qty,
          date: new Date().toISOString()
        });
        successCount++;
      } catch (e) {
        failCount++;
      }
    }

    if (failCount === 0) {
      Utils.showToast('Stock replenished for ' + successCount + ' item(s).', 'success');
    } else {
      Utils.showToast(successCount + ' updated, ' + failCount + ' failed.', 'warning');
    }

    _closeReplenishScreen();
    _loadItemList();
  }

  /**
   * Clears all inline validation error messages in a form.
   * @private
   */
  function _clearFormErrors(formId) {
    var form = document.getElementById(formId);
    if (!form) return;
    var errorSpans = form.querySelectorAll('.field-error');
    for (var i = 0; i < errorSpans.length; i++) {
      errorSpans[i].textContent = '';
    }
  }

  /**
   * Shows inline validation errors on the item form.
   * @private
   */
  function _showItemFormErrors(errors) {
    // Map error messages to field IDs
    var fieldMap = {
      'item type': 'inv-err-item-type',
      'vendor code': 'inv-err-vendor-code',
      'batch code': 'inv-err-batch-code',
      'cost price': 'inv-err-cost-price',
      'mrp': 'inv-err-mrp',
      'sales price': 'inv-err-sales-price',
      'quantity': 'inv-err-quantity'
    };

    for (var i = 0; i < errors.length; i++) {
      var msg = errors[i].toLowerCase();
      var placed = false;
      for (var key in fieldMap) {
        if (msg.indexOf(key) !== -1) {
          var el = document.getElementById(fieldMap[key]);
          if (el) el.textContent = errors[i];
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Show duplicate or general errors in first available error span
        var generalEl = document.getElementById('inv-err-vendor-code');
        if (generalEl && msg.indexOf('duplicate') !== -1) {
          generalEl.textContent = errors[i];
        } else if (msg.indexOf('already exists') !== -1 && generalEl) {
          generalEl.textContent = errors[i];
        }
      }
    }
  }

  // ─── Form Handlers ──────────────────────────────────────────────────────────

  /**
   * Handles saving an item (add or edit).
   * @private
   */
  async function _handleItemSave() {
    _clearFormErrors('inv-item-form');

    var itemData = {
      item_type: document.getElementById('inv-f-item-type').value,
      brand: document.getElementById('inv-f-brand').value,
      vendor_code: document.getElementById('inv-f-vendor-code').value,
      batch_code: document.getElementById('inv-f-batch-code').value,
      cost_price: document.getElementById('inv-f-cost-price').value,
      mrp: document.getElementById('inv-f-mrp').value,
      sales_price: document.getElementById('inv-f-sales-price').value,
      quantity: document.getElementById('inv-f-quantity').value,
      reorder_level: document.getElementById('inv-f-reorder-level').value,
      reorder_qty: document.getElementById('inv-f-reorder-qty').value
    };

    var isNew = !_currentEditId;
    var result;
    if (_currentEditId) {
      result = await updateItem(_currentEditId, itemData);
    } else {
      result = await addItem(itemData);
    }

    if (result.success) {
      Utils.showToast(_currentEditId ? 'Item updated successfully.' : 'Item added successfully.', 'success');
      _closeItemModal();
      if (isNew && _addingForReplenish && result.id) {
        _addingForReplenish = false;
        await _loadItemList();
        var newId = result.id;
        var newItem = null;
        for (var k = 0; k < _allItems.length; k++) {
          if (_allItems[k].id === newId) { newItem = _allItems[k]; break; }
        }
        if (newItem) _addToReplenishList(newItem.id, 1);
      } else {
        _addingForReplenish = false;
        _loadItemList();
      }
    } else {
      _showItemFormErrors(result.errors || ['An unknown error occurred.']);
    }
  }


  /**
   * Updates the bulk action bar visibility and count.
   * @private
   */
  function _updateBulkBar() {
    var checkboxes = document.querySelectorAll('.inv-item-check');
    var checked = document.querySelectorAll('.inv-item-check:checked');
    var bulkBar = document.getElementById('inv-bulk-bar');
    var bulkCount = document.getElementById('inv-bulk-count');
    var selectAll = document.getElementById('inv-select-all');

    if (bulkBar) {
      bulkBar.hidden = checked.length === 0;
    }
    if (bulkCount) {
      bulkCount.textContent = checked.length + ' selected';
    }
    if (selectAll) {
      selectAll.checked = checkboxes.length > 0 && checked.length === checkboxes.length;
    }
  }

  /**
   * Handles bulk delete of all selected items.
   * @private
   */
  async function _handleBulkDelete() {
    var checked = document.querySelectorAll('.inv-item-check:checked');
    if (checked.length === 0) return;

    var confirmed = await Utils.showConfirmDialog(
      'Are you sure you want to delete ' + checked.length + ' selected item(s)? This cannot be undone.'
    );
    if (!confirmed) return;

    var deleted = 0;
    var failed = 0;
    for (var i = 0; i < checked.length; i++) {
      var itemId = checked[i].getAttribute('data-id');
      var result = await deleteItem(itemId);
      if (result.success) {
        deleted++;
      } else {
        failed++;
      }
    }

    var msg = 'Deleted: ' + deleted;
    if (failed > 0) msg += ', Failed: ' + failed;
    Utils.showToast(msg, deleted > 0 ? 'success' : 'error');
    _loadItemList();
  }

  /**
   * Handles item deletion with confirmation.
   * @private
   */
  async function _handleDelete(itemId) {
    var confirmed = await Utils.showConfirmDialog('Are you sure you want to delete this item?');
    if (!confirmed) return;

    var result = await deleteItem(itemId);
    if (result.success) {
      Utils.showToast('Item deleted.', 'success');
      _loadItemList();
    } else {
      Utils.showToast((result.errors && result.errors[0]) || 'Failed to delete item.', 'error');
    }
  }

  // ─── Load Sample/Default Items ──────────────────────────────────────────────

  var DEFAULT_ITEMS = [
    { item_type: 'Shirt', brand: 'Raymond', vendor_code: 'VNDRAY01', batch_code: 'BAT2025A', cost_price: 450, mrp: 999, sales_price: 799, quantity: 50 },
    { item_type: 'Shirt', brand: 'Van Heusen', vendor_code: 'VNDVH01', batch_code: 'BAT2025A', cost_price: 520, mrp: 1299, sales_price: 999, quantity: 40 },
    { item_type: 'Shirt', brand: 'Peter England', vendor_code: 'VNDPE01', batch_code: 'BAT2025A', cost_price: 380, mrp: 899, sales_price: 699, quantity: 60 },
    { item_type: 'Shirt', brand: 'Allen Solly', vendor_code: 'VNDAS01', batch_code: 'BAT2025A', cost_price: 490, mrp: 1199, sales_price: 899, quantity: 35 },
    { item_type: 'Trouser', brand: 'Raymond', vendor_code: 'VNDRAY02', batch_code: 'BAT2025A', cost_price: 600, mrp: 1499, sales_price: 1199, quantity: 30 },
    { item_type: 'Trouser', brand: 'Van Heusen', vendor_code: 'VNDVH02', batch_code: 'BAT2025A', cost_price: 550, mrp: 1399, sales_price: 1099, quantity: 25 },
    { item_type: 'Trouser', brand: 'Arrow', vendor_code: 'VNDARW01', batch_code: 'BAT2025A', cost_price: 650, mrp: 1599, sales_price: 1299, quantity: 20 },
    { item_type: 'T-Shirt', brand: 'US Polo', vendor_code: 'VNDUSP01', batch_code: 'BAT2025A', cost_price: 320, mrp: 799, sales_price: 599, quantity: 80 },
    { item_type: 'T-Shirt', brand: 'Levis', vendor_code: 'VNDLEV01', batch_code: 'BAT2025A', cost_price: 400, mrp: 999, sales_price: 799, quantity: 45 },
    { item_type: 'T-Shirt', brand: 'Jack Jones', vendor_code: 'VNDJJ01', batch_code: 'BAT2025A', cost_price: 280, mrp: 699, sales_price: 549, quantity: 70 },
    { item_type: 'Jeans', brand: 'Levis', vendor_code: 'VNDLEV02', batch_code: 'BAT2025A', cost_price: 800, mrp: 1999, sales_price: 1599, quantity: 35 },
    { item_type: 'Jeans', brand: 'Wrangler', vendor_code: 'VNDWRG01', batch_code: 'BAT2025A', cost_price: 700, mrp: 1799, sales_price: 1399, quantity: 40 },
    { item_type: 'Jeans', brand: 'Pepe Jeans', vendor_code: 'VNDPPJ01', batch_code: 'BAT2025A', cost_price: 650, mrp: 1699, sales_price: 1299, quantity: 30 },
    { item_type: 'Saree', brand: 'Kanchipuram Silk', vendor_code: 'VNDKAN01', batch_code: 'BAT2025A', cost_price: 2500, mrp: 5999, sales_price: 4999, quantity: 15 },
    { item_type: 'Saree', brand: 'Banarasi', vendor_code: 'VNDBAN01', batch_code: 'BAT2025A', cost_price: 1800, mrp: 3999, sales_price: 3499, quantity: 20 },
    { item_type: 'Saree', brand: 'Cotton Handloom', vendor_code: 'VNDCTH01', batch_code: 'BAT2025A', cost_price: 600, mrp: 1499, sales_price: 1199, quantity: 40 },
    { item_type: 'Kurta', brand: 'Fabindia', vendor_code: 'VNDFAB01', batch_code: 'BAT2025A', cost_price: 500, mrp: 1299, sales_price: 999, quantity: 30 },
    { item_type: 'Kurta', brand: 'Manyavar', vendor_code: 'VNDMNY01', batch_code: 'BAT2025A', cost_price: 750, mrp: 1799, sales_price: 1499, quantity: 25 },
    { item_type: 'Innerwear', brand: 'Jockey', vendor_code: 'VNDJKY01', batch_code: 'BAT2025A', cost_price: 150, mrp: 399, sales_price: 349, quantity: 100 },
    { item_type: 'Innerwear', brand: 'Rupa', vendor_code: 'VNDRUP01', batch_code: 'BAT2025A', cost_price: 80, mrp: 199, sales_price: 179, quantity: 150 },
    { item_type: 'Kids Wear', brand: 'Gini Jony', vendor_code: 'VNDGJ01', batch_code: 'BAT2025A', cost_price: 250, mrp: 599, sales_price: 499, quantity: 50 },
    { item_type: 'Kids Wear', brand: 'Biba Girls', vendor_code: 'VNDBG01', batch_code: 'BAT2025A', cost_price: 300, mrp: 699, sales_price: 599, quantity: 40 },
    { item_type: 'Accessories', brand: 'Park Avenue', vendor_code: 'VNDPA01', batch_code: 'BAT2025A', cost_price: 200, mrp: 499, sales_price: 399, quantity: 60 },
    { item_type: 'Accessories', brand: 'Wildcraft', vendor_code: 'VNDWC01', batch_code: 'BAT2025A', cost_price: 350, mrp: 899, sales_price: 699, quantity: 30 },
    { item_type: 'Ethnic Wear', brand: 'Manyavar', vendor_code: 'VNDMNY02', batch_code: 'BAT2025A', cost_price: 1200, mrp: 2999, sales_price: 2499, quantity: 15 }
  ];

  /**
   * Handles the "Load Sample Items" button click.
   * Checks for duplicates before adding each item.
   * @private
   */
  async function _handleLoadDefaults() {
    var confirmed = await Utils.showConfirmDialog(
      'Load 25 sample clothing items? Existing items with same vendor+batch code will be skipped.'
    );
    if (!confirmed) return;

    Utils.showToast('Loading sample items...', 'info');

    var added = 0;
    var skipped = 0;
    var failed = 0;

    for (var i = 0; i < DEFAULT_ITEMS.length; i++) {
      var item = DEFAULT_ITEMS[i];
      var result = await addItem(item);
      if (result.success) {
        added++;
      } else {
        // Check if it's a duplicate error
        var errMsg = (result.errors || []).join(' ').toLowerCase();
        if (errMsg.indexOf('already exists') !== -1 || errMsg.indexOf('duplicate') !== -1) {
          skipped++;
        } else {
          failed++;
        }
      }
    }

    var msg = 'Added: ' + added + ', Skipped (duplicates): ' + skipped;
    if (failed > 0) msg += ', Failed: ' + failed;

    Utils.showToast(msg, added > 0 ? 'success' : 'info');
    _loadItemList();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    init: init,
    addItem: addItem,
    updateItem: updateItem,
    deleteItem: deleteItem,
    getItem: getItem,
    getAllItems: getAllItems,
    replenishStock: replenishStock,
    generateItemCode: generateItemCode,
    calculateDiscount: calculateDiscount,
    validateItem: validateItem,
    setReorderConfig: setReorderConfig,
    getReorderConfig: getReorderConfig
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Inventory;
}
