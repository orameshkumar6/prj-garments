// Application Shell - Initialization, Service Worker Registration, Hash Router, and Mobile Sidebar
// This is the main initialization script (NOT an IIFE module - runs global functions on load)

/**
 * Register the service worker for offline PWA support.
 * Caches static assets for offline access.
 */
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

/**
 * Navigate to a screen by its screenId.
 * Hides all .screen sections, shows the target screen (id="screen-{screenId}"),
 * updates the active nav item, and updates the .screen-title text.
 * @param {string} screenId - The screen identifier (e.g., "inventory", "billing")
 */
function navigateToScreen(screenId) {
  // Hide all screen sections
  var screens = document.querySelectorAll('.screen');
  screens.forEach(function(screen) {
    screen.setAttribute('hidden', '');
  });

  // Show the target screen
  var targetScreen = document.getElementById('screen-' + screenId);
  if (targetScreen) {
    targetScreen.removeAttribute('hidden');
  }

  // Update active nav item
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

  // Update screen title text
  var screenTitle = document.getElementById('screen-title');
  if (screenTitle && targetScreen) {
    // Use the aria-label of the target screen, or format the screenId as a title
    var label = targetScreen.getAttribute('aria-label');
    if (label) {
      screenTitle.textContent = label;
    } else {
      // Fallback: capitalize and format screenId (e.g., "sales-report" → "Sales Report")
      screenTitle.textContent = screenId
        .split('-')
        .map(function(word) { return word.charAt(0).toUpperCase() + word.slice(1); })
        .join(' ');
    }
  }
}

/**
 * Set up hash-based router.
 * Listens on hashchange event, calls navigateToScreen based on the current hash.
 */
function setupHashRouter() {
  window.addEventListener('hashchange', function() {
    var hash = window.location.hash.replace('#', '');
    if (hash) {
      navigateToScreen(hash);
    }
  });
}

/**
 * Set up sidebar mobile toggle functionality.
 * - #hamburger-btn opens sidebar (adds .open class to #sidebar, shows backdrop)
 * - #sidebar-close-btn and #sidebar-backdrop close sidebar
 * - Clicking a nav item on mobile also closes sidebar
 */
function setupSidebarToggle() {
  var sidebar = document.getElementById('sidebar');
  var hamburgerBtn = document.getElementById('hamburger-btn');
  var sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  var sidebarBackdrop = document.getElementById('sidebar-backdrop');

  function openSidebar() {
    if (sidebar) {
      sidebar.classList.add('open');
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.removeAttribute('hidden');
      sidebarBackdrop.classList.add('visible');
    }
  }

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove('open');
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.remove('visible');
      sidebarBackdrop.setAttribute('hidden', '');
    }
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', openSidebar);
  }

  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', closeSidebar);
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeSidebar);
  }

  // Clicking a nav item on mobile closes the sidebar
  var navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(function(item) {
    item.addEventListener('click', function() {
      closeSidebar();
    });
  });
}

/**
 * Set up offline/online indicator using DataLayer.onConnectionChange.
 */
function setupConnectionIndicator() {
  var offlineBanner = document.getElementById('offline-banner');
  if (!offlineBanner) return;

  function updateIndicator(isOnline) {
    if (isOnline) {
      offlineBanner.setAttribute('hidden', '');
    } else {
      offlineBanner.removeAttribute('hidden');
    }
  }

  // Use DataLayer's onConnectionChange if available
  if (typeof DataLayer !== 'undefined' && DataLayer.onConnectionChange) {
    DataLayer.onConnectionChange(updateIndicator);
  } else {
    // Fallback: use navigator.onLine and online/offline events
    updateIndicator(navigator.onLine);
    window.addEventListener('online', function() { updateIndicator(true); });
    window.addEventListener('offline', function() { updateIndicator(false); });
  }
}

/**
 * Initialize the application.
 * Orchestrates the full startup sequence:
 * 1. Initialize Firebase
 * 2. Initialize Data Layer
 * 3. Register Service Worker
 * 4. Initialize optional core modules (ThemeEngine, Settings)
 * 5. Initialize feature modules
 * 6. Set up hash router and navigate to default screen
 * 7. Set up offline/online indicator
 */
async function initApp() {
  // 1. Initialize Firebase
  if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.init) {
    try {
      await FirebaseConfig.init();
    } catch (error) {
      console.error('Firebase initialization error:', error);
    }
  }

  // 2. If Firebase init failed, show error screen and stop
  if (typeof FirebaseConfig !== 'undefined' && !FirebaseConfig.isInitialized()) {
    var errorScreen = document.getElementById('firebase-error-screen');
    var errorMessage = document.getElementById('firebase-error-message');
    var appContainer = document.getElementById('app-container');

    if (errorScreen) {
      errorScreen.removeAttribute('hidden');
    }
    if (errorMessage && FirebaseConfig.getError()) {
      errorMessage.textContent = FirebaseConfig.getError().message;
    }
    if (appContainer) {
      appContainer.setAttribute('hidden', '');
    }
    return;
  }

  // 3. Initialize Data Layer
  if (typeof DataLayer !== 'undefined' && DataLayer.init) {
    try {
      await DataLayer.init();
    } catch (error) {
      console.error('DataLayer initialization failed:', error);
    }
  }

  // 4. Register Service Worker
  registerServiceWorker();

  // 5. Initialize optional core modules (ThemeEngine, Settings)
  if (typeof ThemeEngine !== 'undefined' && ThemeEngine.init) {
    try {
      ThemeEngine.init();
    } catch (error) {
      console.error('ThemeEngine initialization failed:', error);
    }
  }

  if (typeof Settings !== 'undefined' && Settings.init) {
    try {
      await Settings.init();
    } catch (error) {
      console.error('Settings initialization failed:', error);
    }
  }

  // 6. Initialize all feature modules (wrap each in try/catch)
  var featureModules = [
    { name: 'Inventory', ref: typeof Inventory !== 'undefined' ? Inventory : null },
    { name: 'Billing', ref: typeof Billing !== 'undefined' ? Billing : null },
    { name: 'SalesEngine', ref: typeof SalesEngine !== 'undefined' ? SalesEngine : null },
    { name: 'Reports', ref: typeof Reports !== 'undefined' ? Reports : null },
    { name: 'ExpenseTracker', ref: typeof ExpenseTracker !== 'undefined' ? ExpenseTracker : null },
    { name: 'Employee', ref: typeof Employee !== 'undefined' ? Employee : null },
    { name: 'Attendance', ref: typeof Attendance !== 'undefined' ? Attendance : null },
    { name: 'BarcodePrinter', ref: typeof BarcodePrinter !== 'undefined' ? BarcodePrinter : null },
    { name: 'ImportExport', ref: typeof ImportExport !== 'undefined' ? ImportExport : null },
    { name: 'TransactionHistory', ref: typeof TransactionHistory !== 'undefined' ? TransactionHistory : null },
    { name: 'Printer', ref: typeof Printer !== 'undefined' ? Printer : null }
  ];

  featureModules.forEach(function(mod) {
    if (mod.ref && mod.ref.init) {
      try {
        mod.ref.init();
      } catch (error) {
        console.error(mod.name + ' initialization failed:', error);
      }
    }
  });

  // 7. Set up hash router
  setupHashRouter();

  // 8. Set up sidebar mobile toggle
  setupSidebarToggle();

  // 9. Navigate to default screen (#inventory) or the current hash
  var currentHash = window.location.hash.replace('#', '');
  if (currentHash) {
    navigateToScreen(currentHash);
  } else {
    navigateToScreen('inventory');
  }

  // 10. Set up offline/online indicator
  setupConnectionIndicator();
}

// Call initApp() on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initApp);
