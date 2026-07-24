/**
 * Cloth Shop Firebase - Employee Master Module
 * Employee CRUD, validation, auto-generated employee codes, and UI.
 */
var Employee = (function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  var COLLECTION = 'employees';
  var CODE_PREFIX = 'EMP-';
  var MAX_NAME_LENGTH = 100;
  var MAX_PHONE_LENGTH = 15;
  var SEX_OPTIONS = ['Male', 'Female', 'Other'];

  // ─── Private State ──────────────────────────────────────────────────────────

  var _employees = [];
  var _filteredEmployees = [];

  // ─── Code Generation ────────────────────────────────────────────────────────

  /**
   * Generates the next employee code (EMP-XXXX).
   * @returns {Promise<string>}
   */
  async function _generateEmployeeCode() {
    try {
      var allEmployees = await DataLayer.queryDocuments(COLLECTION, {
        orderBy: [{ field: 'created_at', direction: 'desc' }]
      });

      var maxNum = 0;
      for (var i = 0; i < allEmployees.length; i++) {
        var code = allEmployees[i].employee_code || '';
        if (code.indexOf(CODE_PREFIX) === 0) {
          var numPart = parseInt(code.substring(CODE_PREFIX.length), 10);
          if (!isNaN(numPart) && numPart > maxNum) {
            maxNum = numPart;
          }
        }
      }

      var nextNum = maxNum + 1;
      return CODE_PREFIX + String(nextNum).padStart(4, '0');
    } catch (e) {
      // Fallback: timestamp-based
      return CODE_PREFIX + String(Date.now()).slice(-4);
    }
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validates employee data.
   * @param {object} data
   * @returns {{valid: boolean, errors: string[]}}
   */
  function _validateEmployee(data) {
    var errors = [];

    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Employee data must be a non-null object.'] };
    }

    // name: required, ≤100 chars
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Name is required.');
    } else if (data.name.trim().length > MAX_NAME_LENGTH) {
      errors.push('Name must not exceed 100 characters.');
    }

    // sex: must be from options
    if (!data.sex || SEX_OPTIONS.indexOf(data.sex) === -1) {
      errors.push('Sex must be one of: Male, Female, Other.');
    }

    // phone: digits only, ≤15
    if (data.phone !== undefined && data.phone !== null && data.phone !== '') {
      var phoneStr = String(data.phone).trim();
      if (!/^\d{0,15}$/.test(phoneStr)) {
        errors.push('Phone must be digits only, max 15 digits.');
      }
    }

    // monthly_salary: number ≥ 0
    if (data.monthly_salary === undefined || data.monthly_salary === null || data.monthly_salary === '') {
      errors.push('Monthly salary is required.');
    } else {
      var salary = Number(data.monthly_salary);
      if (isNaN(salary) || salary < 0) {
        errors.push('Monthly salary must be a number ≥ 0.');
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  /**
   * Adds a new employee.
   * @param {object} data - { name, sex, phone, monthly_salary }
   * @returns {Promise<{success: boolean, id?: string, errors?: string[]}>}
   */
  async function addEmployee(data) {
    var validation = _validateEmployee(data);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    try {
      var employeeCode = await _generateEmployeeCode();

      var docData = {
        employee_code: employeeCode,
        name: data.name.trim(),
        sex: data.sex,
        phone: data.phone ? String(data.phone).trim() : '',
        monthly_salary: Number(data.monthly_salary),
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      var docId = await DataLayer.addDocument(COLLECTION, docData);
      return { success: true, id: docId, employee_code: employeeCode };
    } catch (e) {
      return { success: false, errors: ['Failed to add employee: ' + e.message] };
    }
  }

  /**
   * Updates an existing employee.
   * @param {string} id - Document ID
   * @param {object} data - Fields to update
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async function updateEmployee(id, data) {
    if (!id) {
      return { success: false, errors: ['Employee ID is required.'] };
    }

    var validation = _validateEmployee(data);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    try {
      var updateData = {
        name: data.name.trim(),
        sex: data.sex,
        phone: data.phone ? String(data.phone).trim() : '',
        monthly_salary: Number(data.monthly_salary),
        updated_at: new Date().toISOString()
      };

      if (data.active !== undefined) {
        updateData.active = !!data.active;
      }

      await DataLayer.updateDocument(COLLECTION, id, updateData);
      return { success: true };
    } catch (e) {
      return { success: false, errors: ['Failed to update employee: ' + e.message] };
    }
  }

  /**
   * Gets all employees.
   * @returns {Promise<Array>}
   */
  async function getEmployees() {
    try {
      var results = await DataLayer.queryDocuments(COLLECTION, {
        orderBy: [{ field: 'created_at', direction: 'desc' }]
      });
      return results || [];
    } catch (e) {
      console.error('Employee: Failed to fetch employees:', e);
      return [];
    }
  }

  /**
   * Gets only active employees.
   * @returns {Promise<Array>}
   */
  async function getActiveEmployees() {
    try {
      var results = await DataLayer.queryDocuments(COLLECTION, {
        where: [{ field: 'active', op: '==', value: true }],
        orderBy: [{ field: 'name', direction: 'asc' }]
      });
      return results || [];
    } catch (e) {
      console.error('Employee: Failed to fetch active employees:', e);
      return [];
    }
  }

  // ─── UI Rendering ───────────────────────────────────────────────────────────

  /**
   * Initializes the Employee module UI.
   */
  function init() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-employees .screen-content');
    if (!container) return;

    container.innerHTML = _buildUI();
    _attachEventListeners();
    _loadEmployees();
  }

  /**
   * Builds the employee master UI HTML.
   * @private
   */
  function _buildUI() {
    var html = '';
    html += '<h2 class="section-heading">Employee Master</h2>';

    // Search/Filter
    html += '<div class="exp-filters">';
    html += '<input type="text" id="emp-search-input" class="form-input" placeholder="Search by name or code..." aria-label="Search employees">';
    html += '<button type="button" id="emp-add-btn" class="btn btn-primary">+ Add Employee</button>';
    html += '</div>';

    // Employee Table
    html += '<div class="table-wrapper mt-16">';
    html += '<table class="data-table" id="emp-table">';
    html += '<thead><tr>';
    html += '<th>Code</th><th>Name</th><th>Sex</th><th>Phone</th><th>Salary</th><th>Status</th><th>Actions</th>';
    html += '</tr></thead>';
    html += '<tbody id="emp-tbody"></tbody>';
    html += '</table>';
    html += '</div>';
    html += '<p id="emp-empty-msg" class="empty-state" hidden>No employees found.</p>';

    // Add/Edit Modal
    html += '<div id="emp-modal-overlay" class="modal-overlay" hidden>';
    html += '<div class="modal">';
    html += '<h2 id="emp-modal-title">Add Employee</h2>';
    html += '<form id="emp-form" novalidate>';
    html += '<div class="form-group"><label for="emp-f-name">Name *</label>';
    html += '<input type="text" id="emp-f-name" maxlength="100" required></div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label for="emp-f-sex">Sex *</label>';
    html += '<select id="emp-f-sex" required>';
    html += '<option value="">-- Select --</option>';
    html += '<option value="Male">Male</option>';
    html += '<option value="Female">Female</option>';
    html += '<option value="Other">Other</option>';
    html += '</select></div>';
    html += '<div class="form-group"><label for="emp-f-phone">Phone</label>';
    html += '<input type="tel" id="emp-f-phone" maxlength="15" placeholder="Digits only"></div>';
    html += '</div>';
    html += '<div class="form-group"><label for="emp-f-salary">Monthly Salary (₹) *</label>';
    html += '<input type="number" id="emp-f-salary" min="0" step="1" required></div>';
    html += '<div class="form-actions" style="display:flex;gap:12px;margin-top:16px;">';
    html += '<button type="submit" class="btn btn-primary" id="emp-form-submit">Save</button>';
    html += '<button type="button" class="btn btn-secondary" id="emp-form-cancel">Cancel</button>';
    html += '</div>';
    html += '</form>';
    html += '</div></div>';

    return html;
  }

  /**
   * Attaches event listeners.
   * @private
   */
  function _attachEventListeners() {
    var addBtn = document.getElementById('emp-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        _openModal(null);
      });
    }

    var form = document.getElementById('emp-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        _handleSave();
      });
    }

    var cancelBtn = document.getElementById('emp-form-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', _closeModal);
    }

    var searchInput = document.getElementById('emp-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _filterEmployees(this.value);
      });
    }
  }

  var _editingId = null;

  /**
   * Opens the add/edit modal.
   * @param {object|null} employee - Employee to edit, or null for new
   * @private
   */
  function _openModal(employee) {
    var overlay = document.getElementById('emp-modal-overlay');
    var title = document.getElementById('emp-modal-title');
    var nameInput = document.getElementById('emp-f-name');
    var sexInput = document.getElementById('emp-f-sex');
    var phoneInput = document.getElementById('emp-f-phone');
    var salaryInput = document.getElementById('emp-f-salary');

    if (employee) {
      _editingId = employee.id;
      title.textContent = 'Edit Employee';
      nameInput.value = employee.name || '';
      sexInput.value = employee.sex || '';
      phoneInput.value = employee.phone || '';
      salaryInput.value = employee.monthly_salary || '';
    } else {
      _editingId = null;
      title.textContent = 'Add Employee';
      document.getElementById('emp-form').reset();
    }

    if (overlay) overlay.removeAttribute('hidden');
  }

  /**
   * Closes the modal.
   * @private
   */
  function _closeModal() {
    var overlay = document.getElementById('emp-modal-overlay');
    if (overlay) overlay.setAttribute('hidden', '');
    _editingId = null;
  }

  /**
   * Handles save (add or update).
   * @private
   */
  async function _handleSave() {
    var data = {
      name: document.getElementById('emp-f-name').value,
      sex: document.getElementById('emp-f-sex').value,
      phone: document.getElementById('emp-f-phone').value,
      monthly_salary: document.getElementById('emp-f-salary').value
    };

    var result;
    if (_editingId) {
      result = await updateEmployee(_editingId, data);
    } else {
      result = await addEmployee(data);
    }

    if (result.success) {
      Utils.showToast(_editingId ? 'Employee updated.' : 'Employee added.', 'success');
      _closeModal();
      _loadEmployees();
    } else {
      Utils.showToast((result.errors && result.errors[0]) || 'Error saving employee.', 'error');
    }
  }

  /**
   * Loads employees from Firestore and renders the table.
   * @private
   */
  async function _loadEmployees() {
    _employees = await getEmployees();
    _filteredEmployees = _employees.slice();
    _renderTable(_filteredEmployees);
  }

  /**
   * Filters employees by search query.
   * @private
   */
  function _filterEmployees(query) {
    var q = (query || '').toLowerCase().trim();
    if (!q) {
      _filteredEmployees = _employees.slice();
    } else {
      _filteredEmployees = _employees.filter(function (emp) {
        return (emp.name && emp.name.toLowerCase().indexOf(q) !== -1) ||
               (emp.employee_code && emp.employee_code.toLowerCase().indexOf(q) !== -1);
      });
    }
    _renderTable(_filteredEmployees);
  }

  /**
   * Renders the employee table.
   * @private
   */
  function _renderTable(employees) {
    var tbody = document.getElementById('emp-tbody');
    var emptyMsg = document.getElementById('emp-empty-msg');
    if (!tbody) return;

    if (!employees || employees.length === 0) {
      tbody.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;

    var esc = Utils.escapeHtml;
    var html = '';
    for (var i = 0; i < employees.length; i++) {
      var emp = employees[i];
      var statusClass = emp.active ? 'success' : 'danger';
      var statusText = emp.active ? 'Active' : 'Inactive';
      html += '<tr>';
      html += '<td>' + esc(emp.employee_code || '') + '</td>';
      html += '<td>' + esc(emp.name || '') + '</td>';
      html += '<td>' + esc(emp.sex || '') + '</td>';
      html += '<td>' + esc(emp.phone || '') + '</td>';
      html += '<td>' + Utils.formatCurrency(emp.monthly_salary || 0) + '</td>';
      html += '<td><span class="status-badge ' + statusClass + '">' + statusText + '</span></td>';
      html += '<td>';
      html += '<button class="btn btn-secondary btn-sm emp-edit-btn" data-id="' + emp.id + '" type="button">Edit</button> ';
      html += '<button class="btn btn-sm ' + (emp.active ? 'btn-danger' : 'btn-primary') + ' emp-toggle-btn" data-id="' + emp.id + '" data-active="' + emp.active + '" type="button">';
      html += emp.active ? 'Deactivate' : 'Activate';
      html += '</button>';
      html += '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;

    // Attach edit handlers
    var editBtns = tbody.querySelectorAll('.emp-edit-btn');
    for (var j = 0; j < editBtns.length; j++) {
      editBtns[j].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var emp = _employees.find(function (e) { return e.id === id; });
        if (emp) _openModal(emp);
      });
    }

    // Attach toggle handlers
    var toggleBtns = tbody.querySelectorAll('.emp-toggle-btn');
    for (var k = 0; k < toggleBtns.length; k++) {
      toggleBtns[k].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var isActive = this.getAttribute('data-active') === 'true';
        _toggleActive(id, !isActive);
      });
    }
  }

  /**
   * Toggles employee active status.
   * @private
   */
  async function _toggleActive(id, newActive) {
    try {
      await DataLayer.updateDocument(COLLECTION, id, {
        active: newActive,
        updated_at: new Date().toISOString()
      });
      Utils.showToast('Employee ' + (newActive ? 'activated' : 'deactivated') + '.', 'success');
      _loadEmployees();
    } catch (e) {
      Utils.showToast('Failed to update status.', 'error');
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    addEmployee: addEmployee,
    updateEmployee: updateEmployee,
    getEmployees: getEmployees,
    getActiveEmployees: getActiveEmployees
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Employee;
}
