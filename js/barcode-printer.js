var BarcodePrinter = (function() {
  'use strict';
  var _items = [];
  var _selectedIds = new Set();

  function init() {
    _renderScreen();
  }

  async function loadItems() {
    try {
      _items = await DataLayer.queryDocuments('items', {});
    } catch(e) { _items = []; }
    _renderItemList();
  }

  function selectAll() { _items.forEach(function(i) { _selectedIds.add(i.id); }); _renderItemList(); }
  function deselectAll() { _selectedIds.clear(); _renderItemList(); }

  function generateLabels(selectedItems, format) {
    var labels = [];
    selectedItems.forEach(function(item) {
      var barcodeValue = 'ITM-' + (item.item_code || '').replace('ITM-','');
      labels.push({ item: item, barcodeValue: barcodeValue, format: format });
    });
    return labels;
  }

  function openPrintWindow(labels) {
    var html = '<html><head><title>Barcode Labels</title><style>body{font-family:sans-serif;} .label{display:inline-block;border:1px solid #ccc;padding:10px;margin:5px;text-align:center;width:200px;} .label-name{font-weight:bold;margin-bottom:5px;font-size:12px;} .label-price{font-size:11px;margin-top:5px;} canvas,svg,img{max-width:180px;}</style></head><body>';
    html += '<h2>Barcode Labels</h2><div>';
    labels.forEach(function(l) {
      html += '<div class="label">';
      html += '<div class="label-name">' + Utils.escapeHtml(l.item.item_type + ' - ' + (l.item.brand || '')) + '</div>';
      html += '<canvas class="barcode" data-value="' + Utils.escapeHtml(l.barcodeValue) + '" data-format="' + l.format + '"></canvas>';
      html += '<div class="label-price">SP: ' + Utils.formatCurrency(l.item.sales_price) + '</div>';
      if (l.item.mrp) { html += '<div class="label-price">MRP: ' + Utils.formatCurrency(l.item.mrp) + '</div>'; }
      html += '</div>';
    });
    html += '</div><br><button onclick="window.print()">Print Labels</button>';
    html += '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>';
    html += '<script>document.querySelectorAll(".barcode").forEach(function(c){var v=c.dataset.value;try{JsBarcode(c,v,{format:"CODE128",width:1.5,height:50,displayValue:true,fontSize:10});}catch(e){c.parentNode.innerHTML+="<p>"+v+"</p>";}});<\/script>';
    html += '</body></html>';

    var w = window.open('', '_blank');
    if (!w) { Utils.showToast('Please allow popups for label printing.', 'error'); return; }
    w.document.write(html);
    w.document.close();
  }

  function _renderScreen() {
    var container = document.querySelector('#screen-barcode .screen-content');
    if (!container) return;
    container.innerHTML = '<h2>Barcode & Label Printing</h2>' +
      '<div class="barcode-toolbar"><button id="bc-load-btn" class="btn btn-primary">Load Items</button> <button id="bc-select-all" class="btn btn-secondary">Select All</button> <button id="bc-deselect-all" class="btn btn-secondary">Deselect All</button> <select id="bc-format"><option value="CODE128">Code128</option><option value="QR">QR Code</option></select> <button id="bc-print-btn" class="btn btn-primary">Print Selected</button></div>' +
      '<div id="bc-item-list" class="bc-item-list"></div>';

    document.getElementById('bc-load-btn').addEventListener('click', loadItems);
    document.getElementById('bc-select-all').addEventListener('click', selectAll);
    document.getElementById('bc-deselect-all').addEventListener('click', deselectAll);
    document.getElementById('bc-print-btn').addEventListener('click', _handlePrint);
  }

  function _renderItemList() {
    var container = document.getElementById('bc-item-list');
    if (!container) return;
    if (_items.length === 0) { container.innerHTML = '<p class="empty-state">No items available. Click "Load Items" to fetch inventory.</p>'; return; }
    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr><th></th><th>Code</th><th>Type</th><th>Brand</th><th>Sales Price</th><th>MRP</th></tr></thead><tbody>';
    _items.forEach(function(item) {
      var checked = _selectedIds.has(item.id) ? ' checked' : '';
      html += '<tr><td><input type="checkbox" class="bc-check" data-id="' + item.id + '"' + checked + '></td><td>' + Utils.escapeHtml(item.item_code||'') + '</td><td>' + Utils.escapeHtml(item.item_type||'') + '</td><td>' + Utils.escapeHtml(item.brand||'') + '</td><td>' + Utils.formatCurrency(item.sales_price) + '</td><td>' + Utils.formatCurrency(item.mrp) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
    container.querySelectorAll('.bc-check').forEach(function(cb) {
      cb.addEventListener('change', function() { if (cb.checked) _selectedIds.add(cb.dataset.id); else _selectedIds.delete(cb.dataset.id); });
    });
  }

  function _handlePrint() {
    if (_selectedIds.size === 0) { Utils.showToast('Please select at least 1 item.', 'error'); return; }
    var selected = _items.filter(function(i) { return _selectedIds.has(i.id); });
    var format = document.getElementById('bc-format').value;
    var labels = generateLabels(selected, format);
    openPrintWindow(labels);
  }

  return { init: init, loadItems: loadItems, selectAll: selectAll, deselectAll: deselectAll, generateLabels: generateLabels, openPrintWindow: openPrintWindow };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = BarcodePrinter; }
