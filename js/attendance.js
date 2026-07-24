/**
 * Cloth Shop Firebase - Attendance & Salary Report Module
 * Mark attendance, view attendance, generate salary reports.
 */
var Attendance = (function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  var COLLECTION = 'attendance';
  var STATUS_OPTIONS = ['Present', 'Absent', 'Half Day'];

  // ─── Private State ──────────────────────────────────────────────────────────

  var _activeEmployees = [];
  var _currentDate = '';
  var _existingAttendance = {};

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Returns today as YYYY-MM-DD.
   * @returns {string}
   */
  function _getTodayString() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  /**
   * Marks attendance for one employee on a given date.
   * Enforces unique constraint: one record per employee per date.
   * @param {object} data - { employee_code, employee_name, date, status }
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function markAttendance(data) {
    if (!data || !data.employee_code || !data.date || !data.status) {
      return { success: false, error: 'Employee code, date, and status are required.' };
    }

    if (STATUS_OPTIONS.indexOf(data.status) === -1) {
      return { success: false, error: 'Status must be one of: Present, Absent, Half Day.' };
    }

    try {
      // Check if record already exists
      var existing = await DataLayer.queryDocuments(COLLECTION, {
        where: [
          { field: 'employee_code', op: '==', value: data.employee_code },
          { field: 'date', op: '==', value: data.date }
        ]
      });

      var docData = {
        employee_code: data.employee_code,
        employee_name: data.employee_name || '',
        date: data.date,
        status: data.status,
        created_at: new Date().toISOString()
      };

      if (existing && existing.length > 0) {
        // Update existing record
        await DataLayer.updateDocument(COLLECTION, existing[0].id, {
          status: data.status,
          employee_name: data.employee_name || existing[0].employee_name
        });
      } else {
        // Create new record
        await DataLayer.addDocument(COLLECTION, docData);
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: 'Failed to mark attendance: ' + e.message };
    }
  }

  /**
   * Gets attendance records with filters.
   * @param {object} filters - { date, employee_code, startDate, endDate }
   * @returns {Promise<Array>}
   */
  async function getAttendance(filters) {
    var queryConstraints = { where: [] };

    if (filters) {
      if (filters.date) {
        queryConstraints.where.push({ field: 'date', op: '==', value: filters.date });
      }
      if (filters.employee_code) {
        queryConstraints.where.push({ field: 'employee_code', op: '==', value: filters.employee_code });
      }
      if (filters.startDate) {
        queryConstraints.where.push({ field: 'date', op: '>=', value: filters.startDate });
      }
      if (filters.endDate) {
        queryConstraints.where.push({ field: 'date', op: '<=', value: filters.endDate });
      }
    }

    try {
      var results = await DataLayer.queryDocuments(COLLECTION, queryConstraints);
      return results || [];
    } catch (e) {
      console.error('Attendance: Failed to fetch:', e);
      return [];
    }
  }

  /**
   * Generates a salary report for the given date range.
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<object>} Report data
   */
  async function getSalaryReport(startDate, endDate) {
    if (!startDate || !endDate) {
      return { success: false, error: 'Start date and end date are required.' };
    }

    try {
      // Get all active employees
      var employees = [];
      if (typeof Employee !== 'undefined' && Employee.getEmployees) {
        employees = await Employee.getEmployees();
      }

      // Get attendance records in range
      var records = await getAttendance({ startDate: startDate, endDate: endDate });

      // Calculate total calendar days in range
      var start = new Date(startDate);
      var end = new Date(endDate);
      var totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // Group attendance by employee
      var attendanceMap = {};
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (!attendanceMap[rec.employee_code]) {
          attendanceMap[rec.employee_code] = { present: 0, absent: 0, halfDay: 0 };
        }
        if (rec.status === 'Present') {
          attendanceMap[rec.employee_code].present++;
        } else if (rec.status === 'Absent') {
          attendanceMap[rec.employee_code].absent++;
        } else if (rec.status === 'Half Day') {
          attendanceMap[rec.employee_code].halfDay++;
        }
      }

      // Build report rows
      var reportRows = [];
      for (var j = 0; j < employees.length; j++) {
        var emp = employees[j];
        var att = attendanceMap[emp.employee_code] || { present: 0, absent: 0, halfDay: 0 };
        var monthlySalary = Number(emp.monthly_salary) || 0;
        var effectiveDays = att.present + (att.halfDay * 0.5);
        var payable = (monthlySalary / totalDays) * effectiveDays;

        reportRows.push({
          employee_code: emp.employee_code,
          name: emp.name,
          days_present: att.present,
          days_half_day: att.halfDay,
          days_absent: att.absent,
          total_working_days: totalDays,
          monthly_salary: monthlySalary,
          payable_amount: Math.round(payable * 100) / 100
        });
      }

      return { success: true, rows: reportRows, totalDays: totalDays };
    } catch (e) {
      return { success: false, error: 'Failed to generate salary report: ' + e.message };
    }
  }

  // ─── UI Rendering ───────────────────────────────────────────────────────────

  /**
   * Initializes the Attendance module UI.
   */
  function init() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-attendance .screen-content');
    if (!container) return;

    container.innerHTML = _buildUI();
    _attachEventListeners();
    _currentDate = _getTodayString();
    document.getElementById('att-date-picker').value = _currentDate;
    _loadAttendanceView();
  }

  /**
   * Builds attendance UI HTML.
   * @private
   */
  function _buildUI() {
    var html = '';
    html += '<h2 class="section-heading">Attendance & Salary Report</h2>';

    // Tabs
    html += '<div class="report-tabs" role="tablist">';
    html += '<button type="button" class="report-tab active" id="att-tab-mark" role="tab" aria-selected="true">Mark Attendance</button>';
    html += '<button type="button" class="report-tab" id="att-tab-salary" role="tab" aria-selected="false">Salary Report</button>';
    html += '</div>';

    // ─── Mark Attendance Panel ───
    html += '<div id="att-panel-mark" class="report-panel">';
    html += '<div class="exp-filters">';
    html += '<label for="att-date-picker">Date:</label>';
    html += '<input type="date" id="att-date-picker" class="form-input">';
    html += '<button type="button" id="att-load-btn" class="btn btn-secondary">Load</button>';
    html += '</div>';
    html += '<div id="att-employee-list" class="mt-16"></div>';
    html += '<div class="form-actions mt-16">';
    html += '<button type="button" id="att-save-btn" class="btn btn-primary">Save Attendance</button>';
    html += '</div>';
    html += '</div>';

    // ─── Salary Report Panel ───
    html += '<div id="att-panel-salary" class="report-panel" style="display:none;">';
    html += '<div class="exp-filters">';
    html += '<label for="att-sal-start">Start:</label>';
    html += '<input type="date" id="att-sal-start" class="form-input">';
    html += '<label for="att-sal-end">End:</label>';
    html += '<input type="date" id="att-sal-end" class="form-input">';
    html += '<button type="button" id="att-sal-generate" class="btn btn-primary">Generate</button>';
    html += '<button type="button" id="att-sal-print" class="btn btn-secondary">Print Report</button>';
    html += '</div>';
    html += '<div id="att-salary-content" class="mt-16"></div>';
    html += '</div>';

    return html;
  }

  /**
   * Attaches event listeners.
   * @private
   */
  function _attachEventListeners() {
    // Tab switching
    var tabMark = document.getElementById('att-tab-mark');
    var tabSalary = document.getElementById('att-tab-salary');

    if (tabMark) {
      tabMark.addEventListener('click', function () {
        _switchAttTab('mark');
      });
    }
    if (tabSalary) {
      tabSalary.addEventListener('click', function () {
        _switchAttTab('salary');
      });
    }

    // Load attendance
    var loadBtn = document.getElementById('att-load-btn');
    if (loadBtn) {
      loadBtn.addEventListener('click', function () {
        _currentDate = document.getElementById('att-date-picker').value;
        _loadAttendanceView();
      });
    }

    // Save attendance
    var saveBtn = document.getElementById('att-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', _handleSaveAttendance);
    }

    // Generate salary report
    var genBtn = document.getElementById('att-sal-generate');
    if (genBtn) {
      genBtn.addEventListener('click', _handleGenerateSalary);
    }

    // Print salary report
    var printBtn = document.getElementById('att-sal-print');
    if (printBtn) {
      printBtn.addEventListener('click', _handlePrintSalary);
    }
  }

  /**
   * Switches between attendance tabs.
   * @private
   */
  function _switchAttTab(tab) {
    var tabMark = document.getElementById('att-tab-mark');
    var tabSalary = document.getElementById('att-tab-salary');
    var panelMark = document.getElementById('att-panel-mark');
    var panelSalary = document.getElementById('att-panel-salary');

    if (tab === 'mark') {
      tabMark.classList.add('active');
      tabMark.setAttribute('aria-selected', 'true');
      tabSalary.classList.remove('active');
      tabSalary.setAttribute('aria-selected', 'false');
      panelMark.style.display = '';
      panelSalary.style.display = 'none';
    } else {
      tabSalary.classList.add('active');
      tabSalary.setAttribute('aria-selected', 'true');
      tabMark.classList.remove('active');
      tabMark.setAttribute('aria-selected', 'false');
      panelMark.style.display = 'none';
      panelSalary.style.display = '';
    }
  }

  /**
   * Loads active employees and existing attendance for current date.
   * @private
   */
  async function _loadAttendanceView() {
    var listContainer = document.getElementById('att-employee-list');
    if (!listContainer) return;

    // Load active employees
    if (typeof Employee !== 'undefined' && Employee.getActiveEmployees) {
      _activeEmployees = await Employee.getActiveEmployees();
    } else {
      _activeEmployees = [];
    }

    if (_activeEmployees.length === 0) {
      listContainer.innerHTML = '<p class="empty-state">No active employees found.</p>';
      return;
    }

    // Load existing attendance for selected date
    _existingAttendance = {};
    if (_currentDate) {
      var records = await getAttendance({ date: _currentDate });
      for (var i = 0; i < records.length; i++) {
        _existingAttendance[records[i].employee_code] = records[i].status;
      }
    }

    // Render employee list with radio buttons
    var esc = Utils.escapeHtml;
    var html = '<div class="table-wrapper"><table class="data-table">';
    html += '<thead><tr><th>Code</th><th>Name</th><th>Present</th><th>Absent</th><th>Half Day</th></tr></thead>';
    html += '<tbody>';

    for (var j = 0; j < _activeEmployees.length; j++) {
      var emp = _activeEmployees[j];
      var existing = _existingAttendance[emp.employee_code] || '';
      var rowName = 'att-status-' + j;

      html += '<tr>';
      html += '<td>' + esc(emp.employee_code || '') + '</td>';
      html += '<td>' + esc(emp.name || '') + '</td>';
      html += '<td><input type="radio" name="' + rowName + '" value="Present" data-code="' + esc(emp.employee_code) + '" data-name="' + esc(emp.name) + '"' + (existing === 'Present' ? ' checked' : '') + '></td>';
      html += '<td><input type="radio" name="' + rowName + '" value="Absent" data-code="' + esc(emp.employee_code) + '" data-name="' + esc(emp.name) + '"' + (existing === 'Absent' ? ' checked' : '') + '></td>';
      html += '<td><input type="radio" name="' + rowName + '" value="Half Day" data-code="' + esc(emp.employee_code) + '" data-name="' + esc(emp.name) + '"' + (existing === 'Half Day' ? ' checked' : '') + '></td>';
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    listContainer.innerHTML = html;
  }

  /**
   * Handles saving all attendance at once.
   * @private
   */
  async function _handleSaveAttendance() {
    if (!_currentDate) {
      Utils.showToast('Please select a date.', 'error');
      return;
    }

    var saveBtn = document.getElementById('att-save-btn');
    if (saveBtn) saveBtn.disabled = true;

    var saved = 0;
    var errors = 0;

    for (var i = 0; i < _activeEmployees.length; i++) {
      var radios = document.querySelectorAll('input[name="att-status-' + i + '"]:checked');
      if (radios.length > 0) {
        var radio = radios[0];
        var result = await markAttendance({
          employee_code: radio.getAttribute('data-code'),
          employee_name: radio.getAttribute('data-name'),
          date: _currentDate,
          status: radio.value
        });

        if (result.success) {
          saved++;
        } else {
          errors++;
        }
      }
    }

    if (saveBtn) saveBtn.disabled = false;

    if (errors > 0) {
      Utils.showToast('Saved ' + saved + ' records, ' + errors + ' failed.', 'error');
    } else if (saved > 0) {
      Utils.showToast('Attendance saved for ' + saved + ' employees.', 'success');
    } else {
      Utils.showToast('No attendance selections to save.', 'error');
    }
  }

  /**
   * Handles generating the salary report.
   * @private
   */
  async function _handleGenerateSalary() {
    var startInput = document.getElementById('att-sal-start');
    var endInput = document.getElementById('att-sal-end');

    if (!startInput || !startInput.value || !endInput || !endInput.value) {
      Utils.showToast('Please select both start and end dates.', 'error');
      return;
    }

    var container = document.getElementById('att-salary-content');
    if (!container) return;

    container.innerHTML = '<p class="placeholder-text">Generating report...</p>';

    var result = await getSalaryReport(startInput.value, endInput.value);

    if (!result.success) {
      container.innerHTML = '<p class="empty-state">' + Utils.escapeHtml(result.error) + '</p>';
      return;
    }

    if (!result.rows || result.rows.length === 0) {
      container.innerHTML = '<p class="empty-state">No data found for the selected period.</p>';
      return;
    }

    var esc = Utils.escapeHtml;
    var html = '<div class="table-wrapper"><table class="data-table" id="att-salary-table">';
    html += '<thead><tr>';
    html += '<th>Code</th><th>Name</th><th>Present</th><th>Half Day</th><th>Absent</th>';
    html += '<th>Total Days</th><th>Monthly Salary</th><th>Payable</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < result.rows.length; i++) {
      var row = result.rows[i];
      html += '<tr>';
      html += '<td>' + esc(row.employee_code || '') + '</td>';
      html += '<td>' + esc(row.name || '') + '</td>';
      html += '<td>' + row.days_present + '</td>';
      html += '<td>' + row.days_half_day + '</td>';
      html += '<td>' + row.days_absent + '</td>';
      html += '<td>' + row.total_working_days + '</td>';
      html += '<td>' + Utils.formatCurrency(row.monthly_salary) + '</td>';
      html += '<td>' + Utils.formatCurrency(row.payable_amount) + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  /**
   * Handles printing the salary report.
   * @private
   */
  function _handlePrintSalary() {
    var table = document.getElementById('att-salary-table');
    if (!table) {
      Utils.showToast('Please generate the salary report first.', 'error');
      return;
    }

    var startInput = document.getElementById('att-sal-start');
    var endInput = document.getElementById('att-sal-end');
    var dateRange = (startInput ? startInput.value : '') + ' to ' + (endInput ? endInput.value : '');

    var printHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    printHtml += '<title>Salary Report</title>';
    printHtml += '<style>body{font-family:sans-serif;font-size:12px;margin:20px;}';
    printHtml += 'table{width:100%;border-collapse:collapse;}';
    printHtml += 'th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}';
    printHtml += 'th{background:#f0f0f0;font-weight:bold;}';
    printHtml += 'h2{margin-bottom:4px;}p{margin:4px 0;}</style></head><body>';
    printHtml += '<h2>Salary Report</h2>';
    printHtml += '<p>Period: ' + Utils.escapeHtml(dateRange) + '</p>';
    printHtml += table.outerHTML;
    printHtml += '</body></html>';

    var printWindow = window.open('', '_blank', 'width=800,height=600');
    if (printWindow) {
      printWindow.document.write(printHtml);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    markAttendance: markAttendance,
    getAttendance: getAttendance,
    getSalaryReport: getSalaryReport
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Attendance;
}
