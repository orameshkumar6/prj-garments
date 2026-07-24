/**
 * Cloth Shop Firebase - Expense Tracker Module
 * Expense recording with classification, validation, filtering, and summary computation.
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
var ExpenseTracker = (function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  var COLLECTION_EXPENSES = 'expenses';
  var CATEGORIES = ['Operational', 'Raw Material', 'Miscellaneous'];
  var MIN_AMOUNT = 0.01;
  var MAX_AMOUNT = 9999999.99;
  var MAX_DESCRIPTION_LENGTH = 200;

  // ─── Private State ──────────────────────────────────────────────────────────

  var _expenses = [];

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validates expense data against business rules.
   * @param {object} expenseData - Expense data to validate
   * @returns {{valid: boolean, errors: string[]}}
   */
  function validateExpense(expenseData) {
    var errors = [];

    if (!expenseData || typeof expenseData !== 'object') {
      return { valid: false, errors: ['Expense data must be a non-null object.'] };
    }

    // amount: number in [0.01, 9999999.99]
    var amount = Number(expenseData.amount);
    if (expenseData.amount === undefined || expenseData.amount === null ||
        expenseData.amount === '' || isNaN(amount)) {
      errors.push('Amount must be a valid number.');
    } else if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      errors.push('Amount must be between 0.01 and 99,99,999.99.');
    }

    // description: 1-200 characters
    if (!expenseData.description || typeof expenseData.description !== 'string' ||
        expenseData.description.trim().length === 0) {
      errors.push('Description is required.');
    } else if (expenseData.description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.push('Description must not exceed 200 characters.');
    }

    // category: must be one of CATEGORIES
    if (!expenseData.category || typeof expenseData.category !== 'string') {
      errors.push('Category is required.');
    } else if (CATEGORIES.indexOf(expenseData.category) === -1) {
      errors.push('Category must be one of: Operational, Raw Material, Miscellaneous.');
    }

    // date: not in the future
    if (!expenseData.date) {
      errors.push('Date is required.');
    } else {
      var expenseDate = new Date(expenseData.date);
      if (isNaN(expenseDate.getTime())) {
        errors.push('Date must be a valid date.');
      } else {
        var today = new Date();
        today.setHours(23, 59, 59, 999);
        if (expenseDate.getTime() > today.getTime()) {
          errors.push('Date cannot be in the future.');
        }
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  /**
   * Adds a new expense after validation.
   * @param {object} expenseData - { date, amount, description, category }
   * @returns {Promise<{success: boolean, id?: string, errors?: string[]}>}
   */
  async function addExpense(expenseData) {
    var validation = validateExpense(expenseData);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    try {
      var docData = {
        date: new Date(expenseData.date).toISOString(),
        amount: Utils.roundTo2(Number(expenseData.amount)),
        description: expenseData.description.trim(),
        category: expenseData.category,
        created_at: new Date().toISOString()
      };

      var docId = await DataLayer.addDocument(COLLECTION_EXPENSES, docData);
      return { success: true, id: docId };
    } catch (e) {
      return { success: false, errors: ['Failed to save expense: ' + e.message] };
    }
  }

  /**
   * Queries expenses with optional date and category filters.
   * @param {object} [filters] - { startDate, endDate, category }
   * @returns {Promise<Array<object>>}
   */
  async function getExpenses(filters) {
    var queryConstraints = {
      where: [],
      orderBy: [{ field: 'date', direction: 'desc' }]
    };

    if (filters) {
      if (filters.startDate) {
        var start = new Date(filters.startDate);
        if (!isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          queryConstraints.where.push({
            field: 'date',
            op: '>=',
            value: start.toISOString()
          });
        }
      }

      if (filters.endDate) {
        var end = new Date(filters.endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          queryConstraints.where.push({
            field: 'date',
            op: '<=',
            value: end.toISOString()
          });
        }
      }

      if (filters.category && CATEGORIES.indexOf(filters.category) !== -1) {
        queryConstraints.where.push({
          field: 'category',
          op: '==',
          value: filters.category
        });
      }
    }

    try {
      var results = await DataLayer.queryDocuments(COLLECTION_EXPENSES, queryConstraints);
      return results || [];
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.error('ExpenseTracker: Failed to fetch expenses:', e);
      }
      return [];
    }
  }

  /**
   * Computes total amount and count per category from all expenses.
   * @returns {Promise<object>} { Operational: {total, count}, 'Raw Material': {total, count}, Miscellaneous: {total, count} }
   */
  async function getSummaryByCategory() {
    var summary = {};
    for (var i = 0; i < CATEGORIES.length; i++) {
      summary[CATEGORIES[i]] = { total: 0, count: 0 };
    }

    try {
      var allExpenses = await DataLayer.queryDocuments(COLLECTION_EXPENSES, {});
      if (allExpenses && allExpenses.length > 0) {
        for (var j = 0; j < allExpenses.length; j++) {
          var expense = allExpenses[j];
          var cat = expense.category;
          if (summary[cat]) {
            summary[cat].total = Utils.roundTo2(summary[cat].total + Number(expense.amount || 0));
            summary[cat].count += 1;
          }
        }
      }
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.error('ExpenseTracker: Failed to compute summary:', e);
      }
    }

    return summary;
  }

  // ─── UI Rendering ────────────────────────────────────────────────────────────

  /**
   * Initializes the expense tracker module: renders UI into #screen-expenses .screen-content.
   */
  function init() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-expenses .screen-content');
    if (!container) return;

    container.innerHTML = _buildExpenseUI();
    _attachEventListeners();
    _loadExpenses();
    _loadSummary();
  }

  /**
   * Builds the full expense tracker UI HTML.
   * @private
   * @returns {string}
   */
  function _buildExpenseUI() {
    var todayStr = _getTodayString();

    return '' +
      '<h2 class="section-heading">Expense Tracker</h2>' +
      '<!-- Add Expense Form -->' +
      '<div class="exp-form-container">' +
        '<h3 class="form-title">Add Expense</h3>' +
        '<form id="exp-add-form" novalidate>' +
          '<div class="form-grid">' +
            '<div class="form-row">' +
              '<label for="exp-f-date">Date *</label>' +
              '<input type="date" id="exp-f-date" max="' + todayStr + '" required ' +
                'aria-label="Expense date">' +
              '<span class="field-error" id="exp-err-date"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="exp-f-amount">Amount (₹) *</label>' +
              '<input type="number" id="exp-f-amount" min="0.01" max="9999999.99" ' +
                'step="0.01" required aria-label="Expense amount">' +
              '<span class="field-error" id="exp-err-amount"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="exp-f-description">Description *</label>' +
              '<input type="text" id="exp-f-description" maxlength="200" required ' +
                'placeholder="Enter expense description" aria-label="Expense description">' +
              '<span class="field-error" id="exp-err-description"></span>' +
            '</div>' +
            '<div class="form-row">' +
              '<label for="exp-f-category">Category *</label>' +
              '<select id="exp-f-category" required aria-label="Expense category">' +
                '<option value="">-- Select Category --</option>' +
                '<option value="Operational">Operational</option>' +
                '<option value="Raw Material">Raw Material</option>' +
                '<option value="Miscellaneous">Miscellaneous</option>' +
              '</select>' +
              '<span class="field-error" id="exp-err-category"></span>' +
            '</div>' +
          '</div>' +
          '<div class="form-actions">' +
            '<button type="submit" class="btn btn-primary">Add Expense</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '<!-- Category Summary Cards -->' +
      '<div class="exp-summary-section">' +
        '<h3 class="section-subheading">Category Summary</h3>' +
        '<div id="exp-summary-cards" class="exp-summary-cards">' +
          '<p class="placeholder-text">Loading summary...</p>' +
        '</div>' +
      '</div>' +
      '<!-- Expense List with Filters -->' +
      '<div class="exp-list-section">' +
        '<h3 class="section-subheading">Expenses</h3>' +
        '<div class="exp-filters">' +
          '<input type="date" id="exp-filter-start" aria-label="Filter start date">' +
          '<input type="date" id="exp-filter-end" aria-label="Filter end date">' +
          '<select id="exp-filter-category" aria-label="Filter by category">' +
            '<option value="">All Categories</option>' +
            '<option value="Operational">Operational</option>' +
            '<option value="Raw Material">Raw Material</option>' +
            '<option value="Miscellaneous">Miscellaneous</option>' +
          '</select>' +
          '<button type="button" id="exp-btn-filter" class="btn btn-secondary">Filter</button>' +
        '</div>' +
        '<div class="exp-table-container" role="region" aria-label="Expenses table" tabindex="0">' +
          '<table class="exp-table" id="exp-table">' +
            '<thead><tr>' +
              '<th>Date</th><th>Description</th><th>Category</th><th>Amount</th>' +
            '</tr></thead>' +
            '<tbody id="exp-tbody"></tbody>' +
          '</table>' +
          '<p id="exp-empty-msg" class="exp-empty-message" hidden>' +
            'No expenses have been recorded.' +
          '</p>' +
        '</div>' +
      '</div>';
  }

  /**
   * Returns today's date as YYYY-MM-DD string for input max attribute.
   * @private
   * @returns {string}
   */
  function _getTodayString() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // ─── Event Listeners ────────────────────────────────────────────────────────

  /**
   * Attaches event listeners for UI interactions.
   * @private
   */
  function _attachEventListeners() {
    // Add expense form submit
    var addForm = document.getElementById('exp-add-form');
    if (addForm) {
      addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        _handleAddExpense();
      });
    }

    // Filter button
    var filterBtn = document.getElementById('exp-btn-filter');
    if (filterBtn) {
      filterBtn.addEventListener('click', function () {
        _loadExpenses();
      });
    }
  }

  // ─── UI Handlers ────────────────────────────────────────────────────────────

  /**
   * Handles adding a new expense from the form.
   * @private
   */
  async function _handleAddExpense() {
    _clearFormErrors();

    var expenseData = {
      date: document.getElementById('exp-f-date').value,
      amount: document.getElementById('exp-f-amount').value,
      description: document.getElementById('exp-f-description').value,
      category: document.getElementById('exp-f-category').value
    };

    var result = await addExpense(expenseData);

    if (result.success) {
      Utils.showToast('Expense added successfully.', 'success');
      document.getElementById('exp-add-form').reset();
      // Update the date max attribute in case day changed
      var dateInput = document.getElementById('exp-f-date');
      if (dateInput) dateInput.setAttribute('max', _getTodayString());
      _loadExpenses();
      _loadSummary();
    } else {
      _showFormErrors(result.errors || []);
    }
  }

  /**
   * Loads and renders the expense list based on current filters.
   * @private
   */
  async function _loadExpenses() {
    var filters = {};

    var startDate = document.getElementById('exp-filter-start');
    var endDate = document.getElementById('exp-filter-end');
    var category = document.getElementById('exp-filter-category');

    if (startDate && startDate.value) {
      filters.startDate = startDate.value;
    }
    if (endDate && endDate.value) {
      filters.endDate = endDate.value;
    }
    if (category && category.value) {
      filters.category = category.value;
    }

    try {
      _expenses = await getExpenses(filters);
    } catch (e) {
      _expenses = [];
    }

    _renderExpenseTable(_expenses);
  }

  /**
   * Loads and renders the category summary cards.
   * @private
   */
  async function _loadSummary() {
    var summaryContainer = document.getElementById('exp-summary-cards');
    if (!summaryContainer) return;

    try {
      var summary = await getSummaryByCategory();
      var totalCount = 0;
      for (var i = 0; i < CATEGORIES.length; i++) {
        totalCount += summary[CATEGORIES[i]].count;
      }

      if (totalCount === 0) {
        summaryContainer.innerHTML = '<p class="exp-empty-message">No expenses have been recorded.</p>';
        return;
      }

      var html = '';
      for (var j = 0; j < CATEGORIES.length; j++) {
        var cat = CATEGORIES[j];
        var data = summary[cat];
        html += '' +
          '<div class="exp-summary-card">' +
            '<h4 class="exp-card-title">' + Utils.escapeHtml(cat) + '</h4>' +
            '<p class="exp-card-total">' + Utils.formatCurrency(data.total) + '</p>' +
            '<p class="exp-card-count">' + data.count + ' entries</p>' +
          '</div>';
      }
      summaryContainer.innerHTML = html;
    } catch (e) {
      summaryContainer.innerHTML = '<p class="exp-empty-message">Failed to load summary.</p>';
    }
  }

  /**
   * Renders the expenses table body.
   * @private
   */
  function _renderExpenseTable(expenses) {
    var tbody = document.getElementById('exp-tbody');
    var emptyMsg = document.getElementById('exp-empty-msg');
    if (!tbody) return;

    if (!expenses || expenses.length === 0) {
      tbody.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;

    var html = '';
    for (var i = 0; i < expenses.length; i++) {
      var exp = expenses[i];
      html += '<tr>' +
        '<td>' + Utils.escapeHtml(Utils.formatDate(exp.date)) + '</td>' +
        '<td>' + Utils.escapeHtml(exp.description || '') + '</td>' +
        '<td>' + Utils.escapeHtml(exp.category || '') + '</td>' +
        '<td>' + Utils.formatCurrency(exp.amount) + '</td>' +
      '</tr>';
    }
    tbody.innerHTML = html;
  }

  /**
   * Clears all inline validation error messages.
   * @private
   */
  function _clearFormErrors() {
    var errorSpans = ['exp-err-date', 'exp-err-amount', 'exp-err-description', 'exp-err-category'];
    for (var i = 0; i < errorSpans.length; i++) {
      var el = document.getElementById(errorSpans[i]);
      if (el) el.textContent = '';
    }
  }

  /**
   * Shows inline validation errors on the add form.
   * @private
   */
  function _showFormErrors(errors) {
    for (var i = 0; i < errors.length; i++) {
      var msg = errors[i].toLowerCase();
      if (msg.indexOf('amount') !== -1) {
        var el = document.getElementById('exp-err-amount');
        if (el) el.textContent = errors[i];
      } else if (msg.indexOf('description') !== -1) {
        var el2 = document.getElementById('exp-err-description');
        if (el2) el2.textContent = errors[i];
      } else if (msg.indexOf('category') !== -1) {
        var el3 = document.getElementById('exp-err-category');
        if (el3) el3.textContent = errors[i];
      } else if (msg.indexOf('date') !== -1) {
        var el4 = document.getElementById('exp-err-date');
        if (el4) el4.textContent = errors[i];
      }
    }

    // Show first error as toast as well
    if (errors.length > 0) {
      Utils.showToast(errors[0], 'error');
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    init: init,
    addExpense: addExpense,
    getExpenses: getExpenses,
    getSummaryByCategory: getSummaryByCategory,
    validateExpense: validateExpense,
    CATEGORIES: CATEGORIES
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExpenseTracker;
}
