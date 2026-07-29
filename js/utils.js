/**
 * Prj-Garments Firebase - Utility Module
 * Shared helpers: ID generation, date formatting, currency, rounding, UI notifications, debounce, HTML escaping.
 */
var Utils = (function () {
  'use strict';

  // ─── ID Generation ────────────────────────────────────────────────────────────

  /**
   * Generates a unique ID string using timestamp + random characters.
   * @returns {string} Unique ID e.g. "1718472345678_a3f9b2"
   */
  function generateId() {
    var timestamp = Date.now().toString(36);
    var randomPart = Math.random().toString(36).substring(2, 8);
    return timestamp + '_' + randomPart;
  }

  // ─── Date Formatting ──────────────────────────────────────────────────────────

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Formats a Date object into the specified format string.
   * Supported formats: 'DD-MMM-YYYY' (e.g. "15-Jun-2025"), 'DD-MM-YYYY' (e.g. "15-06-2025")
   * @param {Date|string} date - Date object or ISO string to format
   * @param {string} [format='DD-MMM-YYYY'] - Target format
   * @returns {string} Formatted date string
   */
  function formatDate(date, format) {
    if (!date) return '';
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';

    var day = String(d.getDate()).padStart(2, '0');
    var month = d.getMonth(); // 0-indexed
    var year = d.getFullYear();

    format = format || 'DD-MMM-YYYY';

    if (format === 'DD-MM-YYYY') {
      return day + '-' + String(month + 1).padStart(2, '0') + '-' + year;
    }

    // Default: DD-MMM-YYYY
    return day + '-' + MONTHS_SHORT[month] + '-' + year;
  }

  // ─── Currency Formatting ──────────────────────────────────────────────────────

  /**
   * Formats a number as INR currency with 2 decimal places and thousands separators.
   * Uses Indian numbering system (e.g. 1,23,456.78).
   * @param {number} amount - Amount to format
   * @returns {string} Formatted string e.g. "₹1,23,456.78"
   */
  function formatCurrency(amount) {
    var num = Number(amount);
    if (isNaN(num)) return '\u20B90.00';

    var fixed = num.toFixed(2);
    var parts = fixed.split('.');
    var intPart = parts[0];
    var decPart = parts[1];
    var isNegative = false;

    if (intPart.charAt(0) === '-') {
      isNegative = true;
      intPart = intPart.substring(1);
    }

    // Indian numbering: last 3 digits, then groups of 2
    var formatted = '';
    if (intPart.length <= 3) {
      formatted = intPart;
    } else {
      var lastThree = intPart.substring(intPart.length - 3);
      var remaining = intPart.substring(0, intPart.length - 3);
      // Add commas every 2 digits for the remaining part
      formatted = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
    }

    return (isNegative ? '-' : '') + '\u20B9' + formatted + '.' + decPart;
  }

  // ─── Rounding ─────────────────────────────────────────────────────────────────

  /**
   * Rounds a number to exactly 2 decimal places.
   * Uses Math.round to avoid floating-point precision issues.
   * @param {number} value - Number to round
   * @returns {number} Rounded number with at most 2 decimal places
   */
  function roundTo2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  // ─── Toast Notifications ──────────────────────────────────────────────────────

  /**
   * Displays a notification toast message with auto-dismiss after 3 seconds.
   * @param {string} message - Message to display
   * @param {string} [type='info'] - Toast type: 'success', 'error', or 'info'
   */
  function showToast(message, type) {
    type = type || 'info';

    // Only run in browser environment
    if (typeof document === 'undefined') return;

    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(function () {
      toast.classList.add('toast-visible');
    });

    // Auto-dismiss after 3 seconds
    setTimeout(function () {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');
      setTimeout(function () {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  // ─── Confirm Dialog ───────────────────────────────────────────────────────────

  /**
   * Displays a custom confirmation dialog and returns a Promise.
   * Resolves true if user confirms, false if user cancels.
   * Uses a custom modal overlay (not native confirm()).
   * @param {string} message - Confirmation message to display
   * @returns {Promise<boolean>} Resolves true on confirm, false on cancel
   */
  function showConfirmDialog(message) {
    // In non-browser environment, resolve true immediately
    if (typeof document === 'undefined') {
      return Promise.resolve(true);
    }

    return new Promise(function (resolve) {
      // Create overlay
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:24px;';

      // Create dialog
      var dialog = document.createElement('div');
      dialog.className = 'confirm-dialog';
      dialog.style.cssText = 'background:var(--color-surface,#fff);border-radius:8px;padding:24px;max-width:400px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3);';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'confirm-msg');

      // Message
      var msgEl = document.createElement('p');
      msgEl.id = 'confirm-msg';
      msgEl.className = 'confirm-message';
      msgEl.textContent = message;
      dialog.appendChild(msgEl);

      // Buttons container
      var btnContainer = document.createElement('div');
      btnContainer.className = 'confirm-buttons';
      btnContainer.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'confirm-btn confirm-btn-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.type = 'button';
      cancelBtn.style.cssText = 'padding:10px 20px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;cursor:pointer;font-size:14px;';

      var confirmBtn = document.createElement('button');
      confirmBtn.className = 'confirm-btn confirm-btn-confirm';
      confirmBtn.textContent = 'Confirm';
      confirmBtn.type = 'button';
      confirmBtn.style.cssText = 'padding:10px 20px;border:none;border-radius:6px;background:var(--color-primary,#6200ea);color:#fff;cursor:pointer;font-size:14px;';

      btnContainer.appendChild(cancelBtn);
      btnContainer.appendChild(confirmBtn);
      dialog.appendChild(btnContainer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Focus the confirm button for accessibility
      confirmBtn.focus();

      function cleanup(result) {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(result);
      }

      confirmBtn.addEventListener('click', function () {
        cleanup(true);
      });

      cancelBtn.addEventListener('click', function () {
        cleanup(false);
      });

      // Allow closing via Escape key
      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          cleanup(false);
        }
      });
    });
  }

  // ─── Debounce ─────────────────────────────────────────────────────────────────

  /**
   * Creates a debounced version of the given function.
   * The debounced function delays invoking fn until after `delay` milliseconds
   * have elapsed since the last time the debounced function was called.
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this;
      var args = arguments;
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(function () {
        timer = null;
        fn.apply(context, args);
      }, delay);
    };
  }

  // ─── HTML Escaping ────────────────────────────────────────────────────────────

  /**
   * Escapes HTML special characters to prevent XSS.
   * Converts &, <, >, ", and ' to their HTML entity equivalents.
   * @param {string} str - String to escape
   * @returns {string} Escaped string safe for HTML insertion
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  return {
    generateId: generateId,
    formatDate: formatDate,
    formatCurrency: formatCurrency,
    roundTo2: roundTo2,
    showToast: showToast,
    showConfirmDialog: showConfirmDialog,
    debounce: debounce,
    escapeHtml: escapeHtml
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
