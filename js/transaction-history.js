/**
 * Cloth Shop Firebase - Transaction History Module
 * Transaction listing, date filtering, deletion with audit logging.
 * Uses DataLayer for Firestore operations, Utils for UI notifications and formatting.
 */
var TransactionHistory = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var _transactions = [];

  // ─── Load Transactions ──────────────────────────────────────────────────────

  /**
   * Queries the "transactions" collection sorted by date descending.
   * Optionally filters by start and end date range (inclusive).
   * @param {string|Date} [startDate] - Start date for filtering (inclusive)
   * @param {string|Date} [endDate] - End date for filtering (inclusive)
   * @returns {Promise<Array<object>>} Array of transaction documents
   */
  async function loadTransactions(startDate, endDate) {
    var queryConstraints = {
      orderBy: [{ field: 'date', direction: 'desc' }]
    };

    var whereClauses = [];

    if (startDate) {
      var start = (startDate instanceof Date) ? startDate : new Date(startDate);
      if (!isNaN(start.getTime())) {
        // Set to start of day
        start.setHours(0, 0, 0, 0);
        whereClauses.push({ field: 'date', op: '>=', value: start });
      }
    }

    if (endDate) {
      var end = (endDate instanceof Date) ? endDate : new Date(endDate);
      if (!isNaN(end.getTime())) {
        // Set to end of day
        end.setHours(23, 59, 59, 999);
        whereClauses.push({ field: 'date', op: '<=', value: end });
      }
    }

    if (whereClauses.length > 0) {
      queryConstraints.where = whereClauses;
    }

    try {
      var results = await DataLayer.queryDocuments('transactions', queryConstraints);
      _transactions = results || [];
      return _transactions;
    } catch (e) {
      Utils.showToast('Failed to load transactions: ' + e.message, 'error');
      _transactions = [];
      return _transactions;
    }
  }

  // ─── Delete Transaction ─────────────────────────────────────────────────────

  /**
   * Deletes a transaction after user confirmation.
   * On confirm: deletes from "transactions" and creates a "deletion_log" entry.
   * On cancel: does nothing.
   * On Firestore error: shows error toast.
   * @param {string} transactionId - Document ID of the transaction to delete
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function deleteTransaction(transactionId) {
    if (!transactionId) {
      return { success: false, error: 'Transaction ID is required.' };
    }

    // Find the transaction in local state to get bill_number and total
    var transaction = null;
    for (var i = 0; i < _transactions.length; i++) {
      if (_transactions[i].id === transactionId) {
        transaction = _transactions[i];
        break;
      }
    }

    // If not in local state, attempt to fetch from Firestore
    if (!transaction) {
      try {
        transaction = await DataLayer.getDocument('transactions', transactionId);
      } catch (e) {
        Utils.showToast('Error fetching transaction details.', 'error');
        return { success: false, error: 'Error fetching transaction details.' };
      }
    }

    if (!transaction) {
      Utils.showToast('Transaction not found.', 'error');
      return { success: false, error: 'Transaction not found.' };
    }

    var billNumber = transaction.bill_number || 'Unknown';
    var totalAmount = transaction.total || 0;

    // Show confirmation dialog
    var confirmed = await Utils.showConfirmDialog(
      'Are you sure you want to delete transaction ' + billNumber + '? This action cannot be undone.'
    );

    if (!confirmed) {
      return { success: false, error: 'Deletion cancelled.' };
    }

    // Perform deletion and create audit log
    try {
      await DataLayer.deleteDocument('transactions', transactionId);

      // Create deletion_log entry
      await DataLayer.addDocument('deletion_log', {
        deleted_at: new Date(),
        bill_number: billNumber,
        total_amount: totalAmount
      });

      // Remove from local state
      _transactions = _transactions.filter(function (t) {
        return t.id !== transactionId;
      });

      Utils.showToast('Transaction ' + billNumber + ' deleted successfully.', 'success');
      renderTransactions(_transactions);
      return { success: true };
    } catch (e) {
      Utils.showToast('Deletion failed: ' + e.message, 'error');
      return { success: false, error: 'Deletion failed: ' + e.message };
    }
  }

  // ─── Render Transactions ────────────────────────────────────────────────────

  /**
   * Renders the transaction table in the history screen.
   * Shows date, bill number, item names, quantities, total amount, and delete button per row.
   * Shows "No transactions found" message if the array is empty.
   * @param {Array<object>} transactions - Array of transaction objects to render
   */
  function renderTransactions(transactions) {
    if (typeof document === 'undefined') return;

    var tableContainer = document.getElementById('history-table-container');
    var emptyMsg = document.getElementById('history-empty-msg');

    if (!tableContainer) return;

    var items = transactions || _transactions;

    if (!items || items.length === 0) {
      tableContainer.style.display = 'none';
      if (emptyMsg) {
        emptyMsg.style.display = 'block';
        emptyMsg.textContent = 'No transactions found.';
      }
      return;
    }

    tableContainer.style.display = '';
    if (emptyMsg) emptyMsg.style.display = 'none';

    var esc = Utils.escapeHtml;
    var html = '<div class="table-wrapper">';
    html += '<table class="data-table" id="history-table">';
    html += '<thead><tr>';
    html += '<th>Date</th><th>Bill No.</th><th>Items</th><th>Quantities</th><th>Total</th><th>Action</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < items.length; i++) {
      var tx = items[i];
      var dateStr = _formatTransactionDate(tx.date);
      var itemNames = _getItemNames(tx.items);
      var quantities = _getItemQuantities(tx.items);

      html += '<tr>';
      html += '<td>' + esc(dateStr) + '</td>';
      html += '<td>' + esc(tx.bill_number || '') + '</td>';
      html += '<td>' + esc(itemNames) + '</td>';
      html += '<td>' + esc(quantities) + '</td>';
      html += '<td>' + Utils.formatCurrency(tx.total || 0) + '</td>';
      html += '<td><button class="btn-icon-sm btn-delete history-delete-btn" ';
      html += 'data-id="' + esc(tx.id || '') + '" type="button" aria-label="Delete transaction" title="Delete">🗑️</button></td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    html += '</div>'; // close .table-wrapper
    tableContainer.innerHTML = html;

    // Attach delete handlers
    var deleteBtns = tableContainer.querySelectorAll('.history-delete-btn');
    for (var j = 0; j < deleteBtns.length; j++) {
      deleteBtns[j].addEventListener('click', function () {
        var txId = this.getAttribute('data-id');
        if (txId) {
          deleteTransaction(txId);
        }
      });
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Formats a transaction date (Firestore Timestamp or Date) for display.
   * @param {object|Date|string} date - Date value from Firestore
   * @returns {string} Formatted date string
   * @private
   */
  function _formatTransactionDate(date) {
    if (!date) return '';

    // Handle Firestore Timestamp objects (with toDate method)
    if (date && typeof date.toDate === 'function') {
      return Utils.formatDate(date.toDate(), 'DD-MMM-YYYY');
    }

    return Utils.formatDate(date, 'DD-MMM-YYYY');
  }

  /**
   * Extracts item names from the transaction items array.
   * @param {Array} items - Array of sold items
   * @returns {string} Comma-separated item names
   * @private
   */
  function _getItemNames(items) {
    if (!items || !Array.isArray(items) || items.length === 0) return '-';
    var names = [];
    for (var i = 0; i < items.length; i++) {
      var name = items[i].name || items[i].item_code || items[i].item_type || '';
      if (name) names.push(name);
    }
    return names.join(', ') || '-';
  }

  /**
   * Extracts quantities from the transaction items array.
   * @param {Array} items - Array of sold items
   * @returns {string} Comma-separated quantities
   * @private
   */
  function _getItemQuantities(items) {
    if (!items || !Array.isArray(items) || items.length === 0) return '-';
    var quantities = [];
    for (var i = 0; i < items.length; i++) {
      quantities.push(String(items[i].qty || items[i].quantity || 0));
    }
    return quantities.join(', ');
  }

  // ─── UI Initialization ──────────────────────────────────────────────────────

  /**
   * Initializes the transaction history module.
   * Renders the UI in #screen-history .screen-content:
   * date range filter (start/end inputs + filter button + clear button),
   * transaction table, empty state message.
   * Loads all transactions on init.
   */
  function init() {
    _renderUI();
    loadTransactions().then(function (transactions) {
      renderTransactions(transactions);
    });
  }

  /**
   * Renders the transaction history screen UI.
   * @private
   */
  function _renderUI() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-history .screen-content');
    if (!container) return;

    var html = '';

    // ── Date Range Filter Section ──
    html += '<div class="history-section history-filters">';
    html += '<h2 class="section-heading">Transaction History</h2>';
    html += '<div class="form-row">';
    html += '<div class="form-group">';
    html += '<label for="history-start-date">Start Date</label>';
    html += '<input type="date" id="history-start-date" class="form-input" />';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="history-end-date">End Date</label>';
    html += '<input type="date" id="history-end-date" class="form-input" />';
    html += '</div>';
    html += '<div class="form-group form-group-btn">';
    html += '<button id="history-filter-btn" class="btn btn-primary" type="button">Filter</button>';
    html += '</div>';
    html += '<div class="form-group form-group-btn">';
    html += '<button id="history-clear-btn" class="btn btn-secondary" type="button">Clear</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // ── Transaction Table Container ──
    html += '<div class="history-section">';
    html += '<div class="table-wrapper" id="history-table-container"></div>';
    html += '<p id="history-empty-msg" class="empty-state" style="display:none;">No transactions found.</p>';
    html += '</div>';

    container.innerHTML = html;
    _attachListeners();
  }

  /**
   * Attaches event listeners to the filter controls.
   * @private
   */
  function _attachListeners() {
    if (typeof document === 'undefined') return;

    var filterBtn = document.getElementById('history-filter-btn');
    var clearBtn = document.getElementById('history-clear-btn');

    if (filterBtn) {
      filterBtn.addEventListener('click', _handleFilter);
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', _handleClear);
    }
  }

  /**
   * Handles the Filter button click — loads transactions with date range.
   * @private
   */
  async function _handleFilter() {
    var startInput = document.getElementById('history-start-date');
    var endInput = document.getElementById('history-end-date');

    var startDate = startInput ? startInput.value : '';
    var endDate = endInput ? endInput.value : '';

    if (!startDate && !endDate) {
      Utils.showToast('Please select at least a start or end date.', 'info');
      return;
    }

    var transactions = await loadTransactions(startDate || null, endDate || null);
    renderTransactions(transactions);
  }

  /**
   * Handles the Clear button click — clears date inputs and reloads all transactions.
   * @private
   */
  async function _handleClear() {
    var startInput = document.getElementById('history-start-date');
    var endInput = document.getElementById('history-end-date');

    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';

    var transactions = await loadTransactions();
    renderTransactions(transactions);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    loadTransactions: loadTransactions,
    deleteTransaction: deleteTransaction,
    renderTransactions: renderTransactions
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TransactionHistory;
}
