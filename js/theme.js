/**
 * Cloth Shop Firebase - Theme Engine Module
 * Manages color theme switching, persistence via localStorage,
 * OS preference detection, and auto-switching on system changes.
 *
 * Themes apply by setting data-theme attribute on document.documentElement.
 * CSS custom properties handle the actual visual styling.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */
var ThemeEngine = (function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  var STORAGE_KEY = 'cloth-shop-theme';
  var DEFAULT_THEME_ID = 'light';

  /**
   * Available themes. Each has an id, display name, and isDark flag.
   * Dark themes must maintain WCAG 2.1 AA contrast ratio >= 4.5:1
   * (enforced via CSS custom properties in styles.css).
   */
  var THEMES = [
    { id: 'light', name: 'Light', isDark: false },
    { id: 'dark', name: 'Dark', isDark: true },
    { id: 'blue', name: 'Blue', isDark: false }
  ];

  /** Quick lookup map for theme IDs */
  var THEME_MAP = {};
  for (var i = 0; i < THEMES.length; i++) {
    THEME_MAP[THEMES[i].id] = THEMES[i];
  }

  /** Currently active theme ID */
  var _currentTheme = DEFAULT_THEME_ID;

  // ─── Private Methods ────────────────────────────────────────────────────────

  /**
   * Check if a theme ID is valid.
   * @param {string} themeId
   * @returns {boolean}
   */
  function _isValidTheme(themeId) {
    return typeof themeId === 'string' && THEME_MAP.hasOwnProperty(themeId);
  }

  /**
   * Persist theme ID to localStorage. Fails silently if storage is unavailable.
   * @param {string} themeId
   */
  function _persist(themeId) {
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch (e) {
      // Silent failure — localStorage may be unavailable (private browsing, quota)
    }
  }

  /**
   * Load stored theme ID from localStorage.
   * @returns {string|null} Valid theme ID or null
   */
  function _loadStored() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && _isValidTheme(stored)) {
        return stored;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Detect OS color scheme preference via matchMedia.
   * @returns {string|null} 'dark' or 'light' if detectable, null otherwise
   */
  function _detectOSPreference() {
    try {
      if (typeof window !== 'undefined' && window.matchMedia) {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          return 'dark';
        }
        if (window.matchMedia('(prefers-color-scheme: light)').matches) {
          return 'light';
        }
      }
    } catch (e) {
      // matchMedia unavailable
    }
    return null;
  }

  /**
   * Listen for OS prefers-color-scheme changes.
   * Only auto-switches when no user preference is stored in localStorage.
   */
  function _listenOSChanges() {
    try {
      if (typeof window === 'undefined' || !window.matchMedia) {
        return;
      }
      var mql = window.matchMedia('(prefers-color-scheme: dark)');
      var handler = function (event) {
        // Only react if no manual selection stored
        if (_loadStored() === null) {
          var newTheme = event.matches ? 'dark' : 'light';
          applyTheme(newTheme);
        }
      };
      // Modern browsers use addEventListener, older use addListener
      if (mql.addEventListener) {
        mql.addEventListener('change', handler);
      } else if (mql.addListener) {
        mql.addListener(handler);
      }
    } catch (e) {
      // matchMedia unavailable — skip
    }
  }

  // ─── Public Methods ─────────────────────────────────────────────────────────

  /**
   * Apply a theme by ID. Sets data-theme attribute on documentElement,
   * persists to localStorage, and updates internal state.
   * Completes within 500ms, no page reload required.
   *
   * @param {string} themeId - Theme identifier ('light', 'dark', 'blue')
   * @returns {boolean} True if applied successfully, false if invalid themeId
   */
  function applyTheme(themeId) {
    if (!_isValidTheme(themeId)) {
      return false;
    }

    // Set data-theme attribute on <html> element for CSS variable switching
    if (typeof document !== 'undefined' && document.documentElement) {
      if (themeId === DEFAULT_THEME_ID) {
        // Remove data-theme for default light (CSS :root applies naturally)
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', themeId);
      }
    }

    // Update internal state
    _currentTheme = themeId;

    // Persist to localStorage
    _persist(themeId);

    return true;
  }

  /**
   * Get the currently active theme ID.
   * @returns {string} Current theme identifier
   */
  function getCurrentTheme() {
    return _currentTheme;
  }

  /**
   * Get the array of available theme objects.
   * @returns {Array<{id: string, name: string, isDark: boolean}>}
   */
  function getThemes() {
    return THEMES;
  }

  /**
   * Initialize the Theme Engine.
   * Load preference from localStorage. If invalid/unavailable, detect OS via
   * prefers-color-scheme. If detection unavailable, apply default 'light'.
   * Also listens for OS prefers-color-scheme changes and auto-switches
   * when no user preference is stored.
   */
  function init() {
    // 1. Try stored preference
    var themeId = _loadStored();

    // 2. If no valid stored preference, detect OS preference
    if (!themeId) {
      var osPref = _detectOSPreference();
      if (osPref && _isValidTheme(osPref)) {
        themeId = osPref;
      }
    }

    // 3. Fallback to default light theme
    if (!themeId) {
      themeId = DEFAULT_THEME_ID;
    }

    // Apply determined theme
    applyTheme(themeId);

    // Listen for OS color scheme changes (auto-switch when no stored pref)
    _listenOSChanges();
  }

  // ─── Expose Public API ──────────────────────────────────────────────────────

  return {
    init: init,
    applyTheme: applyTheme,
    getCurrentTheme: getCurrentTheme,
    getThemes: getThemes
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeEngine;
}
