/**
 * Prj-Garments Firebase - Sales Engine Module
 * Atomic sale processing — stock validation, stock reduction + transaction recording
 * in a single Firestore batch write for all-or-nothing consistency.
 * Uses DataLayer for all Firestore operations.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
var SalesEngine = (function () {
  'use strict';

  // ─── Stock Validation ─────────────────────────────────────────────────────

  /**
   * Validates that all line items have sufficient stock available in Firestore.
   * For each line item, queries the "items" collection to check current quantity >= requested qty.
   *
   * @param {Array<object>} lineItems - Array of line item objects with item_code and quantity
   * @returns {Promise<{valid: boolean, insufficientItems: Array<{item_code: string, available: number, requested: number}>}>}
   */
  async function validateStock(lineItems) {
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return { valid: false, insufficientItems: [] };
    }

    var insufficientItems = [];

    for (var i = 0; i < lineItems.length; i++) {
      var lineItem = lineItems[i];
      var itemCode = lineItem.item_code;
      var requestedQty = Number(lineItem.quantity) || 0;
      var itemName = lineItem.name || lineItem.item_type || lineItem.brand || itemCode || 'unknown';

      if (!itemCode || requestedQty <= 0) {
        insufficientItems.push({
          item_code: itemCode || 'unknown',
          name: itemName,
          available: 0,
          requested: requestedQty
        });
        continue;
      }

      // Query Firestore "items" collection to find the item by item_code
      var results = await DataLayer.queryDocuments('items', {
        where: [{ field: 'item_code', op: '==', value: itemCode }],
        limit: 1
      });

      if (!results || results.length === 0) {
        // Item not found in stock
        insufficientItems.push({
          item_code: itemCode,
          name: itemName,
          available: 0,
          requested: requestedQty
        });
        continue;
      }

      var stockItem = results[0];
      var availableQty = Number(stockItem.quantity) || 0;

      if (availableQty < requestedQty) {
        insufficientItems.push({
          item_code: itemCode,
          name: stockItem.item_type || stockItem.brand || itemName,
          available: availableQty,
          requested: requestedQty
        });
      }
    }

    return {
      valid: insufficientItems.length === 0,
      insufficientItems: insufficientItems
    };
  }

  // ─── Batch Construction ───────────────────────────────────────────────────

  /**
   * Constructs an array of batch operations for stock decrements + transaction document creation.
   * Each line item generates an update operation to decrement its stock quantity.
   * The transaction document is added as a 'set' operation.
   *
   * @param {Array<object>} lineItems - Array of line item objects (must include item_code, quantity, and _docId from validation)
   * @param {object} transactionDoc - The full transaction document to save
   * @returns {Array<object>} Array of batch operation objects for DataLayer.executeBatch()
   */
  function buildSaleBatch(lineItems, transactionDoc) {
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return [];
    }

    var operations = [];

    // Stock decrement operations for each line item
    for (var i = 0; i < lineItems.length; i++) {
      var lineItem = lineItems[i];

      if (!lineItem._docId) {
        continue;
      }

      var decrementData = {};
      decrementData.quantity = firebase.firestore.FieldValue.increment(-Math.abs(Number(lineItem.quantity)));
      decrementData.updated_at = firebase.firestore.FieldValue.serverTimestamp();

      operations.push({
        type: 'update',
        collection: 'items',
        docId: lineItem._docId,
        data: decrementData
      });
    }

    // Transaction document creation
    if (transactionDoc) {
      operations.push({
        type: 'set',
        collection: 'transactions',
        data: transactionDoc
      });
    }

    return operations;
  }

  // ─── Sale Processing ──────────────────────────────────────────────────────

  /**
   * Processes a sale: validates stock → builds batch → executes batch atomically.
   * If any item has insufficient stock, rejects with error listing affected items.
   * On batch failure, no partial changes are persisted (guaranteed by Firestore batch).
   *
   * @param {Array<object>} lineItems - Array of line item objects from billing
   *   Each item has: item_code, item_type, brand, mrp, sales_price, quantity, line_total
   * @param {object} billData - Bill metadata object
   *   Contains: bill_number, date, subtotal, gst_rate, gst_amount, total, savings
   * @returns {Promise<{success: boolean, billNumber?: string, error?: string}>}
   */
  async function processSale(lineItems, billData) {
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return { success: false, error: 'No line items provided.' };
    }

    if (!billData || typeof billData !== 'object') {
      return { success: false, error: 'Bill data is required.' };
    }

    // Step 1: Validate stock and enrich with Firestore document IDs in a single pass
    var insufficientItems = [];
    var enrichedItems = [];

    for (var i = 0; i < lineItems.length; i++) {
      var lineItem = lineItems[i];
      var itemCode = lineItem.item_code;
      var requestedQty = Number(lineItem.quantity) || 0;
      var itemName = lineItem.name || lineItem.item_type || lineItem.brand || itemCode || 'unknown';

      if (!itemCode || requestedQty <= 0) {
        insufficientItems.push({
          item_code: itemCode || 'unknown',
          name: itemName,
          available: 0,
          requested: requestedQty
        });
        continue;
      }

      var results;
      try {
        results = await DataLayer.queryDocuments('items', {
          where: [{ field: 'item_code', op: '==', value: itemCode }],
          limit: 1
        });
      } catch (e) {
        return { success: false, error: 'Failed to query stock for item ' + itemCode + ': ' + (e.message || 'Unknown error') };
      }

      if (!results || results.length === 0) {
        insufficientItems.push({
          item_code: itemCode,
          name: itemName,
          available: 0,
          requested: requestedQty
        });
        continue;
      }

      var stockItem = results[0];
      var availableQty = Number(stockItem.quantity) || 0;

      if (availableQty < requestedQty) {
        insufficientItems.push({
          item_code: itemCode,
          name: stockItem.item_type || stockItem.brand || itemName,
          available: availableQty,
          requested: requestedQty
        });
      } else {
        // Enrich line item with Firestore doc ID for batch update
        var enriched = {};
        for (var key in lineItem) {
          if (lineItem.hasOwnProperty(key)) {
            enriched[key] = lineItem[key];
          }
        }
        enriched._docId = stockItem.id;
        enrichedItems.push(enriched);
      }
    }

    // If any items have insufficient stock, reject the entire sale
    if (insufficientItems.length > 0) {
      var errorParts = ['Insufficient stock for the following items:'];
      for (var j = 0; j < insufficientItems.length; j++) {
        var item = insufficientItems[j];
        errorParts.push(
          item.item_code + ' (available: ' + item.available + ', requested: ' + item.requested + ')'
        );
      }
      return { success: false, error: errorParts.join(' ') };
    }

    // Step 2: Build the transaction document
    var transactionDoc = _buildTransactionDoc(enrichedItems, billData);

    // Step 3: Build the batch operations
    var batchOps = buildSaleBatch(enrichedItems, transactionDoc);

    if (batchOps.length === 0) {
      return { success: false, error: 'Failed to build batch operations.' };
    }

    // Step 4: Execute the batch atomically
    try {
      await DataLayer.executeBatch(batchOps);
      return { success: true, billNumber: billData.bill_number };
    } catch (e) {
      // Batch failure — no partial changes persisted
      return { success: false, error: 'Sale processing failed: ' + (e.message || 'Unknown error') };
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Builds the transaction document to be saved in the "transactions" collection.
   * @param {Array<object>} lineItems - Enriched line items
   * @param {object} billData - Bill metadata
   * @returns {object} Transaction document
   * @private
   */
  function _buildTransactionDoc(lineItems, billData) {
    var items = [];
    for (var i = 0; i < lineItems.length; i++) {
      var li = lineItems[i];
      items.push({
        item_code: li.item_code || '',
        name: li.item_type || li.brand || li.item_code || '',
        qty: Number(li.quantity) || 0,
        unit_price: Number(li.sales_price) || 0,
        line_total: Number(li.line_total) || 0
      });
    }

    return {
      bill_number: billData.bill_number || '',
      date: billData.date || new Date(),
      items: items,
      subtotal: Number(billData.subtotal) || 0,
      gst_rate: Number(billData.gst_rate) || 0,
      gst_amount: Number(billData.gst_amount) || 0,
      total: Number(billData.total) || 0,
      savings: Number(billData.savings) || 0
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    processSale: processSale,
    validateStock: validateStock,
    buildSaleBatch: buildSaleBatch
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SalesEngine;
}
