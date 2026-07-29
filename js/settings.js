/**
 * Prj-Garments Firebase - Settings/Config Module
 * Manages GST rate configuration, store details, bill footer, and renders the Settings screen UI.
 * Persists configuration to Firestore "config" collection (doc ID: "app_config").
 */
var Settings = (function () {
  'use strict';

  // ─── Private State ──────────────────────────────────────────────────────────

  var CONFIG_COLLECTION = 'config';
  var CONFIG_DOC_ID = 'app_config';

  var _config = {
    gst_rate: 0,
    store_name: '',
    store_address: '',
    store_phone: '',
    bill_footer: 'Thank you for your purchase!',
    upi_id: '',
    merchant_name: '',
    merchant_code: ''
  };

  var _initialized = false;

  // ─── Initialization ─────────────────────────────────────────────────────────

  /**
   * Initializes the Settings module.
   * Loads config from Firestore, caches locally, and renders the Settings screen UI.
   * @returns {Promise<void>}
   */
  async function init() {
    try {
      var doc = await DataLayer.getDocument(CONFIG_COLLECTION, CONFIG_DOC_ID);

      if (doc) {
        _config.gst_rate = (typeof doc.gst_rate === 'number') ? doc.gst_rate : 0;
        _config.store_name = doc.store_name || '';
        _config.store_address = doc.store_address || '';
        _config.store_phone = doc.store_phone || '';
        _config.bill_footer = (typeof doc.bill_footer === 'string' && doc.bill_footer.length > 0)
          ? doc.bill_footer
          : 'Thank you for your purchase!';
        _config.upi_id = doc.upi_id || '';
        _config.merchant_name = doc.merchant_name || '';
        _config.merchant_code = doc.merchant_code || '';
      }
    } catch (e) {
      // If Firestore read fails, use defaults
      console.warn('Settings: Could not load config from Firestore, using defaults.', e);
    }

    _initialized = true;
    _renderUI();
  }

  // ─── GST Rate ───────────────────────────────────────────────────────────────

  /**
   * Returns the cached GST rate.
   * @returns {number} GST rate (0-100), defaults to 0
   */
  function getGSTRate() {
    return _config.gst_rate;
  }

  /**
   * Validates and sets the GST rate. Persists to Firestore.
   * @param {number} rate - GST percentage (0.00 to 100.00)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function setGSTRate(rate) {
    var numRate = Number(rate);

    if (isNaN(numRate) || numRate < 0 || numRate > 100) {
      return { success: false, error: 'GST rate must be a number between 0.00 and 100.00.' };
    }

    // Round to 2 decimal places
    numRate = Math.round((numRate + Number.EPSILON) * 100) / 100;

    try {
      await DataLayer.updateDocument(CONFIG_COLLECTION, CONFIG_DOC_ID, {
        gst_rate: numRate,
        updated_at: new Date()
      });
      _config.gst_rate = numRate;
      return { success: true };
    } catch (e) {
      // If document doesn't exist, try to create it
      try {
        await _ensureConfigDoc({ gst_rate: numRate });
        _config.gst_rate = numRate;
        return { success: true };
      } catch (e2) {
        return { success: false, error: 'Failed to save GST rate: ' + e2.message };
      }
    }
  }

  // ─── Store Info ─────────────────────────────────────────────────────────────

  /**
   * Returns the cached store information.
   * @returns {{store_name: string, store_address: string, store_phone: string}}
   */
  function getStoreInfo() {
    return {
      store_name: _config.store_name,
      store_address: _config.store_address,
      store_phone: _config.store_phone
    };
  }

  /**
   * Validates and sets store information. Persists to Firestore.
   * @param {{store_name?: string, store_address?: string, store_phone?: string}} info
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function setStoreInfo(info) {
    if (!info || typeof info !== 'object') {
      return { success: false, error: 'Store info must be an object.' };
    }

    var storeName = (info.store_name !== undefined) ? String(info.store_name).trim() : _config.store_name;
    var storeAddress = (info.store_address !== undefined) ? String(info.store_address).trim() : _config.store_address;
    var storePhone = (info.store_phone !== undefined) ? String(info.store_phone).trim() : _config.store_phone;

    // Validate store_name (≤100 chars)
    if (storeName.length > 100) {
      return { success: false, error: 'Store name must not exceed 100 characters.' };
    }

    // Validate store_address (≤80 chars)
    if (storeAddress.length > 80) {
      return { success: false, error: 'Store address must not exceed 80 characters.' };
    }

    // Validate store_phone (≤15 digits)
    if (storePhone.length > 15) {
      return { success: false, error: 'Store phone must not exceed 15 characters.' };
    }

    // Validate phone contains only digits (if not empty)
    if (storePhone.length > 0 && !/^\d+$/.test(storePhone)) {
      return { success: false, error: 'Store phone must contain only digits.' };
    }

    try {
      await DataLayer.updateDocument(CONFIG_COLLECTION, CONFIG_DOC_ID, {
        store_name: storeName,
        store_address: storeAddress,
        store_phone: storePhone,
        updated_at: new Date()
      });
      _config.store_name = storeName;
      _config.store_address = storeAddress;
      _config.store_phone = storePhone;
      return { success: true };
    } catch (e) {
      try {
        await _ensureConfigDoc({
          store_name: storeName,
          store_address: storeAddress,
          store_phone: storePhone
        });
        _config.store_name = storeName;
        _config.store_address = storeAddress;
        _config.store_phone = storePhone;
        return { success: true };
      } catch (e2) {
        return { success: false, error: 'Failed to save store info: ' + e2.message };
      }
    }
  }

  // ─── Bill Footer ────────────────────────────────────────────────────────────

  /**
   * Returns the cached bill footer message.
   * @returns {string} Footer message, defaults to "Thank you for your purchase!"
   */
  function getBillFooter() {
    return _config.bill_footer;
  }

  /**
   * Validates and sets the bill footer message. Persists to Firestore.
   * @param {string} message - Footer message (≤120 characters)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function setBillFooter(message) {
    var msg = String(message || '').trim();

    if (msg.length > 120) {
      return { success: false, error: 'Bill footer must not exceed 120 characters.' };
    }

    // If empty, reset to default
    if (msg.length === 0) {
      msg = 'Thank you for your purchase!';
    }

    try {
      await DataLayer.updateDocument(CONFIG_COLLECTION, CONFIG_DOC_ID, {
        bill_footer: msg,
        updated_at: new Date()
      });
      _config.bill_footer = msg;
      return { success: true };
    } catch (e) {
      try {
        await _ensureConfigDoc({ bill_footer: msg });
        _config.bill_footer = msg;
        return { success: true };
      } catch (e2) {
        return { success: false, error: 'Failed to save bill footer: ' + e2.message };
      }
    }
  }

  // ─── UPI Configuration ───────────────────────────────────────────────────

  /**
   * Returns the cached UPI payment configuration.
   * @returns {{upi_id: string, merchant_name: string, merchant_code: string}}
   */
  function getUPIConfig() {
    return {
      upi_id: _config.upi_id,
      merchant_name: _config.merchant_name,
      merchant_code: _config.merchant_code
    };
  }

  /**
   * Validates and sets UPI payment configuration. Persists to Firestore.
   * @param {{upi_id?: string, merchant_name?: string, merchant_code?: string}} config
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function setUPIConfig(config) {
    if (!config || typeof config !== 'object') {
      return { success: false, error: 'UPI config must be an object.' };
    }

    var upiId = (config.upi_id !== undefined) ? String(config.upi_id).trim() : _config.upi_id;
    var merchantName = (config.merchant_name !== undefined) ? String(config.merchant_name).trim() : _config.merchant_name;
    var merchantCode = (config.merchant_code !== undefined) ? String(config.merchant_code).trim() : _config.merchant_code;

    // Validate upi_id format (xxx@provider) — only if non-empty
    if (upiId.length > 0 && !/^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+$/.test(upiId)) {
      return { success: false, error: 'UPI ID must be in format: yourname@provider (e.g., shop@upi).' };
    }

    // Validate merchant_name (≤50 chars)
    if (merchantName.length > 50) {
      return { success: false, error: 'Merchant name must not exceed 50 characters.' };
    }

    // Validate merchant_code (≤20 chars)
    if (merchantCode.length > 20) {
      return { success: false, error: 'Merchant code must not exceed 20 characters.' };
    }

    try {
      await DataLayer.updateDocument(CONFIG_COLLECTION, CONFIG_DOC_ID, {
        upi_id: upiId,
        merchant_name: merchantName,
        merchant_code: merchantCode,
        updated_at: new Date()
      });
      _config.upi_id = upiId;
      _config.merchant_name = merchantName;
      _config.merchant_code = merchantCode;
      return { success: true };
    } catch (e) {
      try {
        await _ensureConfigDoc({
          upi_id: upiId,
          merchant_name: merchantName,
          merchant_code: merchantCode
        });
        _config.upi_id = upiId;
        _config.merchant_name = merchantName;
        _config.merchant_code = merchantCode;
        return { success: true };
      } catch (e2) {
        return { success: false, error: 'Failed to save UPI config: ' + e2.message };
      }
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Ensures the config document exists in Firestore by creating it with defaults + overrides.
   * @param {object} overrides - Fields to set beyond defaults
   * @returns {Promise<void>}
   * @private
   */
  async function _ensureConfigDoc(overrides) {
    var data = {
      gst_rate: _config.gst_rate,
      store_name: _config.store_name,
      store_address: _config.store_address,
      store_phone: _config.store_phone,
      bill_footer: _config.bill_footer,
      upi_id: _config.upi_id,
      merchant_name: _config.merchant_name,
      merchant_code: _config.merchant_code,
      updated_at: new Date()
    };

    // Apply overrides
    if (overrides) {
      var keys = Object.keys(overrides);
      for (var i = 0; i < keys.length; i++) {
        data[keys[i]] = overrides[keys[i]];
      }
    }

    // Use DataLayer — we need to set the doc with a specific ID
    // Since DataLayer.addDocument auto-generates an ID, we use updateDocument
    // which requires the doc to exist. We'll use a workaround via the Firestore
    // set method. For now, we use the executeBatch with a 'set' operation.
    await DataLayer.executeBatch([{
      type: 'set',
      collection: CONFIG_COLLECTION,
      docId: CONFIG_DOC_ID,
      data: data
    }]);
  }

  // ─── UI Rendering ───────────────────────────────────────────────────────────

  /**
   * Renders the Settings screen UI into #screen-settings .screen-content.
   * Includes: GST rate input, store info form, bill footer input, theme selector, save button.
   * @private
   */
  function _renderUI() {
    if (typeof document === 'undefined') return;

    var container = document.querySelector('#screen-settings .screen-content');
    if (!container) return;

    var esc = (typeof Utils !== 'undefined' && Utils.escapeHtml) ? Utils.escapeHtml : function (s) { return s; };

    var html = '';

    // ── GST Rate Section ──
    html += '<div class="settings-section">';
    html += '<h2 class="section-heading">GST Configuration</h2>';
    html += '<div class="form-group">';
    html += '<label for="settings-gst-rate">GST Rate (%)</label>';
    html += '<input type="number" id="settings-gst-rate" class="form-input" ';
    html += 'min="0" max="100" step="0.01" placeholder="0.00" ';
    html += 'value="' + esc(String(_config.gst_rate)) + '" />';
    html += '<small class="form-hint">Enter a value between 0.00 and 100.00</small>';
    html += '</div>';
    html += '</div>';

    // ── Store Info Section ──
    html += '<div class="settings-section">';
    html += '<h2 class="section-heading">Store Information</h2>';
    html += '<div class="form-group">';
    html += '<label for="settings-store-name">Store Name</label>';
    html += '<input type="text" id="settings-store-name" class="form-input" ';
    html += 'maxlength="100" placeholder="Enter store name" ';
    html += 'value="' + esc(_config.store_name) + '" />';
    html += '<small class="form-hint">Maximum 100 characters</small>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="settings-store-address">Store Address</label>';
    html += '<input type="text" id="settings-store-address" class="form-input" ';
    html += 'maxlength="80" placeholder="Enter store address" ';
    html += 'value="' + esc(_config.store_address) + '" />';
    html += '<small class="form-hint">Maximum 80 characters</small>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="settings-store-phone">Contact Number</label>';
    html += '<input type="tel" id="settings-store-phone" class="form-input" ';
    html += 'maxlength="15" placeholder="Enter phone number (digits only)" ';
    html += 'value="' + esc(_config.store_phone) + '" />';
    html += '<small class="form-hint">Maximum 15 digits</small>';
    html += '</div>';
    html += '</div>';

    // ── Bill Footer Section ──
    html += '<div class="settings-section">';
    html += '<h2 class="section-heading">Bill Footer</h2>';
    html += '<div class="form-group">';
    html += '<label for="settings-bill-footer">Footer Message</label>';
    html += '<input type="text" id="settings-bill-footer" class="form-input" ';
    html += 'maxlength="120" placeholder="Thank you for your purchase!" ';
    html += 'value="' + esc(_config.bill_footer) + '" />';
    html += '<small class="form-hint">Maximum 120 characters. Displayed at the bottom of printed bills.</small>';
    html += '</div>';
    html += '</div>';

    // ── UPI Payment Configuration Section ──
    html += '<div class="settings-section">';
    html += '<h2 class="section-heading">UPI Payment Configuration</h2>';
    html += '<div class="form-group">';
    html += '<label for="settings-upi-id">UPI ID</label>';
    html += '<input type="text" id="settings-upi-id" class="form-input" ';
    html += 'placeholder="yourname@upi" ';
    html += 'value="' + esc(_config.upi_id) + '" />';
    html += '<small class="form-hint">Format: yourname@provider (e.g., shop@ybl)</small>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="settings-merchant-name">Merchant Name</label>';
    html += '<input type="text" id="settings-merchant-name" class="form-input" ';
    html += 'maxlength="50" placeholder="Store Name" ';
    html += 'value="' + esc(_config.merchant_name) + '" />';
    html += '<small class="form-hint">Maximum 50 characters</small>';
    html += '</div>';
    html += '<div class="form-group">';
    html += '<label for="settings-merchant-code">Merchant Code</label>';
    html += '<input type="text" id="settings-merchant-code" class="form-input" ';
    html += 'maxlength="20" placeholder="Merchant Code" ';
    html += 'value="' + esc(_config.merchant_code) + '" />';
    html += '<small class="form-hint">Maximum 20 characters</small>';
    html += '</div>';
    html += '</div>';

    // ── Theme Selector Section ──
    html += '<div class="settings-section">';
    html += '<h2 class="section-heading">App Theme</h2>';
    html += '<div class="form-group">';
    html += '<label for="settings-theme-select">Select Theme</label>';
    html += '<select id="settings-theme-select" class="form-input">';

    // Populate theme options
    if (typeof ThemeEngine !== 'undefined' && ThemeEngine.getThemes) {
      var themes = ThemeEngine.getThemes();
      var currentTheme = ThemeEngine.getCurrentTheme ? ThemeEngine.getCurrentTheme() : '';
      for (var i = 0; i < themes.length; i++) {
        var t = themes[i];
        var selected = (t.id === currentTheme) ? ' selected' : '';
        html += '<option value="' + esc(t.id) + '"' + selected + '>' + esc(t.name) + '</option>';
      }
    } else {
      html += '<option value="light">Light</option>';
      html += '<option value="dark">Dark</option>';
    }

    html += '</select>';
    html += '</div>';
    html += '</div>';

    // ── Save Button ──
    html += '<div class="settings-actions">';
    html += '<button id="settings-save-btn" class="btn btn-primary" type="button">Save Settings</button>';
    html += '</div>';

    container.innerHTML = html;

    // ── Attach Event Listeners ──
    _attachListeners();
  }

  /**
   * Attaches event listeners to the rendered settings form.
   * @private
   */
  function _attachListeners() {
    var saveBtn = document.getElementById('settings-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', _handleSave);
    }

    var themeSelect = document.getElementById('settings-theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', function () {
        if (typeof ThemeEngine !== 'undefined' && ThemeEngine.applyTheme) {
          ThemeEngine.applyTheme(themeSelect.value);
        }
      });
    }
  }

  /**
   * Handles the Save button click — validates and persists all settings.
   * @private
   */
  async function _handleSave() {
    var toast = (typeof Utils !== 'undefined' && Utils.showToast) ? Utils.showToast : function () {};
    var saveBtn = document.getElementById('settings-save-btn');

    // Disable button while saving
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      // ── Save GST Rate ──
      var gstInput = document.getElementById('settings-gst-rate');
      if (gstInput) {
        var gstResult = await setGSTRate(gstInput.value);
        if (!gstResult.success) {
          toast(gstResult.error, 'error');
          _restoreButton(saveBtn);
          return;
        }
      }

      // ── Save Store Info ──
      var nameInput = document.getElementById('settings-store-name');
      var addressInput = document.getElementById('settings-store-address');
      var phoneInput = document.getElementById('settings-store-phone');

      var storeInfo = {};
      if (nameInput) storeInfo.store_name = nameInput.value;
      if (addressInput) storeInfo.store_address = addressInput.value;
      if (phoneInput) storeInfo.store_phone = phoneInput.value;

      var storeResult = await setStoreInfo(storeInfo);
      if (!storeResult.success) {
        toast(storeResult.error, 'error');
        _restoreButton(saveBtn);
        return;
      }

      // ── Save Bill Footer ──
      var footerInput = document.getElementById('settings-bill-footer');
      if (footerInput) {
        var footerResult = await setBillFooter(footerInput.value);
        if (!footerResult.success) {
          toast(footerResult.error, 'error');
          _restoreButton(saveBtn);
          return;
        }
      }

      // ── Save UPI Config ──
      var upiIdInput = document.getElementById('settings-upi-id');
      var merchantNameInput = document.getElementById('settings-merchant-name');
      var merchantCodeInput = document.getElementById('settings-merchant-code');

      var upiConfig = {};
      if (upiIdInput) upiConfig.upi_id = upiIdInput.value;
      if (merchantNameInput) upiConfig.merchant_name = merchantNameInput.value;
      if (merchantCodeInput) upiConfig.merchant_code = merchantCodeInput.value;

      var upiResult = await setUPIConfig(upiConfig);
      if (!upiResult.success) {
        toast(upiResult.error, 'error');
        _restoreButton(saveBtn);
        return;
      }

      toast('Settings saved successfully!', 'success');
    } catch (e) {
      toast('An error occurred while saving settings.', 'error');
      console.error('Settings: Save error:', e);
    }

    _restoreButton(saveBtn);
  }

  /**
   * Restores the save button to its default state.
   * @param {HTMLElement} btn - The save button element
   * @private
   */
  function _restoreButton(btn) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save Settings';
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    init: init,
    getGSTRate: getGSTRate,
    setGSTRate: setGSTRate,
    getStoreInfo: getStoreInfo,
    setStoreInfo: setStoreInfo,
    getBillFooter: getBillFooter,
    setBillFooter: setBillFooter,
    getUPIConfig: getUPIConfig,
    setUPIConfig: setUPIConfig
  };

})();

// ─── Node.js Module Export (for testing) ────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Settings;
}
