/**
 * Unit tests for ExpenseTracker module
 * Tests validateExpense, addExpense, getExpenses, getSummaryByCategory
 */

// Mock Utils globally before requiring the module
global.Utils = {
  roundTo2: function (v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; },
  formatDate: function (d) { return d ? new Date(d).toLocaleDateString() : ''; },
  formatCurrency: function (a) { return '₹' + Number(a || 0).toFixed(2); },
  escapeHtml: function (s) { return typeof s === 'string' ? s : ''; },
  showToast: function () {},
  debounce: function (fn) { return fn; }
};

// Mock DataLayer
var _storedDocs = [];
global.DataLayer = {
  addDocument: async function (collection, data) {
    var id = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    _storedDocs.push(Object.assign({ id: id }, data));
    return id;
  },
  queryDocuments: async function (collection, constraints) {
    return _storedDocs.slice();
  }
};

var ExpenseTracker = require('../../js/expense.js');
var describe = global.describe || function () {};
var it = global.it || function () {};
var expect = global.expect || function () {};

// Use vitest if available
describe('ExpenseTracker.validateExpense', function () {

  it('should accept a valid expense', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 500,
      description: 'Office supplies',
      category: 'Operational'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject null/undefined input', function () {
    var result = ExpenseTracker.validateExpense(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject amount below minimum (0.01)', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 0,
      description: 'Test',
      category: 'Operational'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('amount') !== -1; })).toBe(true);
  });

  it('should reject amount above maximum (9999999.99)', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 10000000,
      description: 'Test',
      category: 'Operational'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('amount') !== -1; })).toBe(true);
  });

  it('should accept amount at minimum boundary (0.01)', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 0.01,
      description: 'Minimum',
      category: 'Miscellaneous'
    });
    expect(result.valid).toBe(true);
  });

  it('should accept amount at maximum boundary (9999999.99)', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 9999999.99,
      description: 'Maximum',
      category: 'Raw Material'
    });
    expect(result.valid).toBe(true);
  });

  it('should reject empty description', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 100,
      description: '',
      category: 'Operational'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('description') !== -1; })).toBe(true);
  });

  it('should reject description exceeding 200 characters', function () {
    var longDesc = 'a'.repeat(201);
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 100,
      description: longDesc,
      category: 'Operational'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('description') !== -1; })).toBe(true);
  });

  it('should accept description at exactly 200 characters', function () {
    var desc200 = 'a'.repeat(200);
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 100,
      description: desc200,
      category: 'Operational'
    });
    expect(result.valid).toBe(true);
  });

  it('should reject invalid category', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 100,
      description: 'Test',
      category: 'Invalid Category'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('category') !== -1; })).toBe(true);
  });

  it('should accept all three valid categories', function () {
    var categories = ['Operational', 'Raw Material', 'Miscellaneous'];
    for (var i = 0; i < categories.length; i++) {
      var result = ExpenseTracker.validateExpense({
        date: '2025-01-15',
        amount: 100,
        description: 'Test',
        category: categories[i]
      });
      expect(result.valid).toBe(true);
    }
  });

  it('should reject future date', function () {
    var futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    var futureDateStr = futureDate.toISOString().split('T')[0];

    var result = ExpenseTracker.validateExpense({
      date: futureDateStr,
      amount: 100,
      description: 'Test',
      category: 'Operational'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('future') !== -1; })).toBe(true);
  });

  it('should accept today as date', function () {
    var todayStr = new Date().toISOString().split('T')[0];
    var result = ExpenseTracker.validateExpense({
      date: todayStr,
      amount: 100,
      description: 'Test',
      category: 'Operational'
    });
    expect(result.valid).toBe(true);
  });

  it('should reject missing date', function () {
    var result = ExpenseTracker.validateExpense({
      amount: 100,
      description: 'Test',
      category: 'Operational'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('date') !== -1; })).toBe(true);
  });

  it('should reject non-numeric amount', function () {
    var result = ExpenseTracker.validateExpense({
      date: '2025-01-15',
      amount: 'abc',
      description: 'Test',
      category: 'Operational'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(function (e) { return e.toLowerCase().indexOf('amount') !== -1; })).toBe(true);
  });

  it('should collect multiple errors', function () {
    var result = ExpenseTracker.validateExpense({
      date: '',
      amount: -5,
      description: '',
      category: 'Wrong'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('ExpenseTracker.CATEGORIES', function () {
  it('should expose exactly three categories', function () {
    expect(ExpenseTracker.CATEGORIES).toHaveLength(3);
    expect(ExpenseTracker.CATEGORIES).toContain('Operational');
    expect(ExpenseTracker.CATEGORIES).toContain('Raw Material');
    expect(ExpenseTracker.CATEGORIES).toContain('Miscellaneous');
  });
});

describe('ExpenseTracker.addExpense', function () {
  beforeEach(function () {
    _storedDocs = [];
  });

  it('should return success and id for valid expense', async function () {
    var result = await ExpenseTracker.addExpense({
      date: '2025-01-15',
      amount: 250.50,
      description: 'Office rent',
      category: 'Operational'
    });
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('should return errors for invalid expense', async function () {
    var result = await ExpenseTracker.addExpense({
      date: '',
      amount: 0,
      description: '',
      category: ''
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('ExpenseTracker.getSummaryByCategory', function () {
  beforeEach(function () {
    _storedDocs = [
      { id: '1', amount: 100, category: 'Operational' },
      { id: '2', amount: 200, category: 'Operational' },
      { id: '3', amount: 150, category: 'Raw Material' },
      { id: '4', amount: 50, category: 'Miscellaneous' }
    ];
  });

  it('should compute totals and counts per category', async function () {
    var summary = await ExpenseTracker.getSummaryByCategory();
    expect(summary['Operational'].total).toBe(300);
    expect(summary['Operational'].count).toBe(2);
    expect(summary['Raw Material'].total).toBe(150);
    expect(summary['Raw Material'].count).toBe(1);
    expect(summary['Miscellaneous'].total).toBe(50);
    expect(summary['Miscellaneous'].count).toBe(1);
  });

  it('should return zeros when no expenses exist', async function () {
    _storedDocs = [];
    var summary = await ExpenseTracker.getSummaryByCategory();
    expect(summary['Operational'].total).toBe(0);
    expect(summary['Operational'].count).toBe(0);
    expect(summary['Raw Material'].total).toBe(0);
    expect(summary['Raw Material'].count).toBe(0);
    expect(summary['Miscellaneous'].total).toBe(0);
    expect(summary['Miscellaneous'].count).toBe(0);
  });
});
