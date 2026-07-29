// Application Shell - Initialization, Service Worker Registration, Hash Router, and Mobile Sidebar

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(function(registration) {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch(function(error) {
        console.error('Service Worker registration failed:', error);
      });
  }
}

function navigateToScreen(screenId) {
  var screens = document.querySelectorAll('.screen');
  screens.forEach(function(screen) {
    screen.setAttribute('hidden', '');
  });

  var targetScreen = document.getElementById('screen-' + screenId);
  if (targetScreen) {
    targetScreen.removeAttribute('hidden');
  }

  var navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(function(item) {
    if (item.getAttribute('data-screen') === screenId) {
      item.classList.add('active');
      item.setAttribute('aria-current', 'page');
    } else {
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    }
  });

  var screenTitle = document.getElementById('screen-title');
  if (screenTitle && targetScreen) {
    var label = targetScreen.getAttribute('aria-label');
    if (label) {
      screenTitle.textContent = label;
    } else {
      screenTitle.textContent = screenId
        .split('-')
        .map(function(word) { return word.charAt(0).toUpperCase() + word.slice(1); })
        .join(' ');
    }
  }
}

function setupHashRouter() {
  window.addEventListener('hashchange', function() {
    var hash = window.location.hash.replace('#', '');
    if (hash) {
      navigateToScreen(hash);
    }
  });
}

function setupSidebarToggle() {
  var sidebar = document.getElementById('sidebar');
  var hamburgerBtn = document.getElementById('hamburger-btn');
  var sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  var sidebarBackdrop = document.getElementById('sidebar-backdrop');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (sidebarBackdrop) {
      sidebarBackdrop.removeAttribute('hidden');
      sidebarBackdrop.classList.add('visible');
    }
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.remove('visible');
      sidebarBackdrop.setAttribute('hidden', '');
    }
  }

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', openSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() { closeSidebar(); });
  });
}

function setupConnectionIndicator() {
  var banner     = document.getElementById('sync-banner');
  var iconEl     = document.getElementById('sync-status-icon');
  var textEl     = document.getElementById('sync-status-text');
  var lastTimeEl = document.getElementById('sync-last-time');
  var syncBtn    = document.getElementById('sync-now-btn');
  if (!banner) return;

  var _lastSyncTime = null;
  var _syncing = false;

  function _formatLastSync() {
    if (!_lastSyncTime || !lastTimeEl) return;
    var diff = Math.round((Date.now() - _lastSyncTime) / 1000);
    if (diff < 10)        lastTimeEl.textContent = '· just now';
    else if (diff < 60)   lastTimeEl.textContent = '· ' + diff + 's ago';
    else if (diff < 3600) lastTimeEl.textContent = '· ' + Math.round(diff / 60) + 'm ago';
    else                  lastTimeEl.textContent = '· ' + Math.round(diff / 3600) + 'h ago';
  }

  function _updateBanner(isOnline) {
    if (_syncing) return;
    if (isOnline) {
      banner.className = 'sync-banner sync-banner--online';
      iconEl.textContent = '●';
      iconEl.classList.remove('spinning');
      textEl.textContent = 'Online';
      if (syncBtn) { syncBtn.removeAttribute('hidden'); syncBtn.disabled = false; }
    } else {
      banner.className = 'sync-banner sync-banner--offline';
      iconEl.textContent = '⚡';
      iconEl.classList.remove('spinning');
      textEl.textContent = 'Offline — changes will sync when connected';
      if (lastTimeEl) lastTimeEl.textContent = '';
      if (syncBtn) syncBtn.setAttribute('hidden', '');
    }
    _formatLastSync();
  }

  async function _handleSync() {
    if (typeof DataLayer === 'undefined' || !DataLayer.isOnline()) {
      if (typeof Utils !== 'undefined') Utils.showToast('Cannot sync while offline.', 'error');
      return;
    }
    _syncing = true;
    banner.className = 'sync-banner sync-banner--syncing';
    iconEl.textContent = '↻';
    iconEl.classList.add('spinning');
    textEl.textContent = 'Syncing…';
    if (lastTimeEl) lastTimeEl.textContent = '';
    if (syncBtn) syncBtn.disabled = true;

    try {
      await DataLayer.sync();
      _lastSyncTime = Date.now();
      _syncing = false;
      _updateBanner(true);
      if (typeof Utils !== 'undefined') Utils.showToast('Data synced successfully!', 'success');
    } catch (e) {
      _syncing = false;
      banner.className = 'sync-banner sync-banner--error';
      iconEl.textContent = '⚠';
      iconEl.classList.remove('spinning');
      textEl.textContent = 'Sync failed — tap to retry';
      if (syncBtn) { syncBtn.removeAttribute('hidden'); syncBtn.disabled = false; }
      if (typeof Utils !== 'undefined') Utils.showToast('Sync failed. Please try again.', 'error');
    }
  }

  if (syncBtn) syncBtn.addEventListener('click', _handleSync);
  setInterval(_formatLastSync, 60000);

  if (typeof DataLayer !== 'undefined' && DataLayer.onConnectionChange) {
    DataLayer.onConnectionChange(_updateBanner);
  }

  _updateBanner(navigator.onLine);
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

function _showLoginScreen() {
  var loginScreen  = document.getElementById('login-screen');
  var appContainer = document.getElementById('app-container');
  var syncBanner   = document.getElementById('sync-banner');
  if (loginScreen)  loginScreen.hidden  = false;
  if (appContainer) appContainer.hidden = true;
  if (syncBanner)   syncBanner.hidden   = true;
}

function _hideLoginScreen() {
  var loginScreen  = document.getElementById('login-screen');
  var appContainer = document.getElementById('app-container');
  var syncBanner   = document.getElementById('sync-banner');
  if (loginScreen)  loginScreen.hidden  = true;
  if (appContainer) appContainer.hidden = false;
  if (syncBanner)   syncBanner.hidden   = false;
}

function _updateBannerUser(user) {
  var nameEl    = document.getElementById('banner-user-name');
  var userEl    = document.getElementById('banner-user');
  var logoutBtn = document.getElementById('banner-logout-btn');
  if (!user) {
    if (userEl) userEl.hidden = true;
    return;
  }
  var displayName = (user.displayName) ||
    (user.email ? user.email.split('@')[0] : '');
  if (nameEl) nameEl.textContent = displayName;
  if (userEl) userEl.hidden = false;
  if (logoutBtn && !logoutBtn._bound) {
    logoutBtn._bound = true;
    logoutBtn.addEventListener('click', async function () {
      if (typeof Auth !== 'undefined') await Auth.logout();
      window.location.reload();
    });
  }
}

function _attachLoginFormHandler() {
  var form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var emailEl    = document.getElementById('login-email');
    var passEl     = document.getElementById('login-password');
    var errEl      = document.getElementById('login-error');
    var submitBtn  = document.getElementById('login-submit-btn');
    var email      = (emailEl    ? emailEl.value.trim() : '');
    var password   = (passEl     ? passEl.value        : '');

    if (errEl) errEl.hidden = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in…'; }

    var result = await Auth.login(email, password);

    if (result.success) {
      _hideLoginScreen();
      _updateBannerUser(result.user);
      if (!_appBooted) await _bootApp();
    } else {
      if (errEl) { errEl.textContent = result.error; errEl.hidden = false; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign In'; }
    }
  });
}

// ─── Module boot (runs after auth confirmed) ─────────────────────────────────

var _appBooted = false;

async function _bootApp() {
  if (_appBooted) return;
  _appBooted = true;

  if (typeof DataLayer !== 'undefined' && DataLayer.init) {
    try { await DataLayer.init(); } catch (e) { console.error('DataLayer init failed:', e); }
  }

  registerServiceWorker();

  if (typeof ThemeEngine !== 'undefined' && ThemeEngine.init) {
    try { ThemeEngine.init(); } catch (e) { console.error('ThemeEngine init failed:', e); }
  }

  if (typeof Settings !== 'undefined' && Settings.init) {
    try { await Settings.init(); } catch (e) { console.error('Settings init failed:', e); }
  }

  var featureModules = [
    { name: 'Inventory',          ref: typeof Inventory          !== 'undefined' ? Inventory          : null },
    { name: 'Vendor',             ref: typeof Vendor             !== 'undefined' ? Vendor             : null },
    { name: 'Billing',            ref: typeof Billing            !== 'undefined' ? Billing            : null },
    { name: 'SalesEngine',        ref: typeof SalesEngine        !== 'undefined' ? SalesEngine        : null },
    { name: 'Reports',            ref: typeof Reports            !== 'undefined' ? Reports            : null },
    { name: 'ExpenseTracker',     ref: typeof ExpenseTracker     !== 'undefined' ? ExpenseTracker     : null },
    { name: 'Employee',           ref: typeof Employee           !== 'undefined' ? Employee           : null },
    { name: 'Attendance',         ref: typeof Attendance         !== 'undefined' ? Attendance         : null },
    { name: 'BarcodePrinter',     ref: typeof BarcodePrinter     !== 'undefined' ? BarcodePrinter     : null },
    { name: 'ImportExport',       ref: typeof ImportExport       !== 'undefined' ? ImportExport       : null },
    { name: 'TransactionHistory', ref: typeof TransactionHistory !== 'undefined' ? TransactionHistory : null },
    { name: 'PurchaseDocs',       ref: typeof PurchaseDocs       !== 'undefined' ? PurchaseDocs       : null },
    { name: 'PurchaseOrders',     ref: typeof PurchaseOrders     !== 'undefined' ? PurchaseOrders     : null },
    { name: 'Printer',            ref: typeof Printer            !== 'undefined' ? Printer            : null }
  ];

  featureModules.forEach(function (mod) {
    if (mod.ref && mod.ref.init) {
      try { mod.ref.init(); } catch (e) { console.error(mod.name + ' init failed:', e); }
    }
  });

  setupHashRouter();
  setupSidebarToggle();

  var currentHash = window.location.hash.replace('#', '');
  navigateToScreen(currentHash || 'inventory');

  setupConnectionIndicator();
}

// ─── App entry point ─────────────────────────────────────────────────────────

async function initApp() {
  // 1. Initialize Firebase
  if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.init) {
    try { await FirebaseConfig.init(); } catch (e) { console.error('Firebase init error:', e); }
  }

  // 2. If Firebase failed, show error screen
  if (typeof FirebaseConfig !== 'undefined' && !FirebaseConfig.isInitialized()) {
    var errorScreen  = document.getElementById('firebase-error-screen');
    var errorMessage = document.getElementById('firebase-error-message');
    var appContainer = document.getElementById('app-container');
    var loginScreen  = document.getElementById('login-screen');
    if (loginScreen)  loginScreen.hidden  = true;
    if (errorScreen)  errorScreen.removeAttribute('hidden');
    if (errorMessage && FirebaseConfig.getError()) errorMessage.textContent = FirebaseConfig.getError().message;
    if (appContainer) appContainer.setAttribute('hidden', '');
    return;
  }

  // 3. Wait for current auth state (fast — from IndexedDB)
  var user = null;
  if (typeof Auth !== 'undefined' && Auth.waitForUser) {
    try { user = await Auth.waitForUser(); } catch (e) { /* continue */ }
  }

  // 4. Listen for future logout (after boot, reload to show login)
  if (typeof Auth !== 'undefined' && Auth.onAuthStateChange) {
    Auth.onAuthStateChange(function (u) {
      if (!u && _appBooted) window.location.reload();
    });
  }

  if (!user) {
    _showLoginScreen();
    _attachLoginFormHandler();
    return;
  }

  // 5. Already authenticated — show the app
  _hideLoginScreen();
  _updateBannerUser(user);
  await _bootApp();
}

document.addEventListener('DOMContentLoaded', initApp);
