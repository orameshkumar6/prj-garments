// Firebase project: prj-garments
var FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "AIzaSyDPqiekA7uGRKPbyus2b0ojEwAVxIYn-Vs",
  authDomain: "prj-garments.firebaseapp.com",
  projectId: "prj-garments",
  storageBucket: "prj-garments.firebasestorage.app",
  messagingSenderId: "519478571642",
  appId: "1:519478571642:web:79ab6e5e294bfdf9b981c3"
};

/**
 * FirebaseConfig Module
 * Responsibility: Initialize Firebase SDK, enable Firestore offline persistence,
 * and expose Firestore db instance to other modules.
 */
var FirebaseConfig = (function() {
  'use strict';

  var _db = null;
  var _initialized = false;
  var _error = null;

  /**
   * Initialize Firebase app and Firestore with offline persistence.
   * Reads config from the global FIREBASE_CONFIG object.
   * @returns {Promise<void>}
   */
  async function init() {
    try {
      // Reset state on re-init attempt
      _error = null;
      _initialized = false;

      var config = FIREBASE_CONFIG;

      // Validate that required config fields are present and not placeholder values
      if (!config || !config.apiKey || !config.projectId) {
        throw new Error('Firebase configuration is missing required fields (apiKey, projectId).');
      }

      if (config.apiKey === 'YOUR_API_KEY_HERE' || config.projectId === 'YOUR_PROJECT_ID') {
        throw new Error('Firebase configuration contains placeholder values. Please update FIREBASE_CONFIG with your real Firebase project settings.');
      }

      // Initialize Firebase app using the compat SDK (global `firebase` object from CDN)
      firebase.initializeApp(config);

      // Get Firestore instance
      _db = firebase.firestore();

      // Enable offline persistence with multi-tab support
      try {
        await _db.enablePersistence({ synchronizeTabs: true });
      } catch (persistenceErr) {
        // Handle known persistence errors gracefully
        if (persistenceErr.code === 'failed-precondition') {
          // Multiple tabs open — persistence can only be enabled in one tab at a time
          console.warn('Firestore persistence failed: Multiple tabs open. Offline persistence is only available in one tab.');
        } else if (persistenceErr.code === 'unimplemented') {
          // The current browser does not support offline persistence
          console.warn('Firestore persistence failed: Browser does not support offline persistence.');
        } else {
          console.warn('Firestore persistence failed:', persistenceErr.message);
        }
        // Persistence failure is non-fatal — the app still works with online-only mode
      }

      _initialized = true;
    } catch (err) {
      _error = err;
      _initialized = false;
      console.error('Firebase initialization failed:', err.message);
    }
  }

  /**
   * Get the Firestore database instance.
   * @returns {object|null} Firestore db instance or null if not initialized.
   */
  function getDb() {
    return _db;
  }

  /**
   * Check whether Firebase has been successfully initialized.
   * @returns {boolean}
   */
  function isInitialized() {
    return _initialized;
  }

  /**
   * Get the last initialization error, if any.
   * @returns {Error|null}
   */
  function getError() {
    return _error;
  }

  return {
    init: init,
    getDb: getDb,
    isInitialized: isInitialized,
    getError: getError
  };
})();

// Conditional export for Node.js testing environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FirebaseConfig;
}
