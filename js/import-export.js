var ImportExport = (function() {
  'use strict';
  var CSV_HEADERS = ['item_type','brand','vendor_code','batch_code','cost_price','mrp','sales_price','discount_pct','quantity'];

  function init() { _renderScreen(); }

  function generateCSV(items) {
    var lines = [CSV_HEADERS.join(',')];
    items.forEach(function(item) {
      var row = CSV_HEADERS.map(function(h) {
        var val = item[h] !== undefined ? String(item[h]) : '';
        if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1) val = '"' + val.replace(/"/g,'""') + '"';
        return val;
      });
      lines.push(row.join(','));
    });
    return lines.join('\n');
  }

  async function exportToCSV() {
    try {
      var items = await DataLayer.queryDocuments('items', {});
      var csv = generateCSV(items);
      var blob = new Blob([csv], {type:'text/csv'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'inventory_export.csv'; a.click();
      URL.revokeObjectURL(url);
      Utils.showToast('Exported ' + items.length + ' items.', 'success');
    } catch(e) { Utils.showToast('Export failed: ' + e.message, 'error'); }
  }

  function parseCSV(csvText) {
    var lines = csvText.split(/\r?\n/).filter(function(l){return l.trim().length > 0;});
    if (lines.length < 2) return {headers:[], rows:[]};
    var headers = lines[0].split(',').map(function(h){return h.trim().toLowerCase();});
    var rows = [];
    for (var i=1; i<lines.length; i++) {
      var vals = lines[i].split(',');
      var row = {};
      headers.forEach(function(h, idx) { row[h] = (vals[idx]||'').trim(); });
      row._rowNum = i+1;
      rows.push(row);
    }
    return {headers:headers, rows:rows};
  }

  function validateRow(row, rowIndex) {
    var errors = [];
    if (!row.item_type) errors.push('Row ' + rowIndex + ': item_type is empty');
    if (!row.brand) errors.push('Row ' + rowIndex + ': brand is empty');
    var cp = Number(row.cost_price); if (isNaN(cp)||cp<=0) errors.push('Row ' + rowIndex + ': invalid cost_price');
    var mrp = Number(row.mrp); if (isNaN(mrp)||mrp<=0) errors.push('Row ' + rowIndex + ': invalid mrp');
    var sp = Number(row.sales_price); if (isNaN(sp)||sp<=0) errors.push('Row ' + rowIndex + ': invalid sales_price');
    return errors;
  }

  async function importFromCSV(file) {
    var text = await file.text();
    var parsed = parseCSV(text);
    if (parsed.rows.length === 0) return {added:0,updated:0,errors:[{row:0,reason:'No data rows found'}]};
    var added=0, updated=0, errors=[];
    for (var i=0; i<parsed.rows.length; i++) {
      var row = parsed.rows[i];
      var rowErrors = validateRow(row, row._rowNum);
      if (rowErrors.length > 0) { if(errors.length<5) errors.push({row:row._rowNum,reason:rowErrors.join('; ')}); continue; }
      try {
        var existing = await DataLayer.queryDocuments('items', {where:[{field:'vendor_code',op:'==',value:row.vendor_code},{field:'batch_code',op:'==',value:row.batch_code}]});
        var discPct = Inventory.calculateDiscount(Number(row.mrp), Number(row.sales_price));
        var data = {item_type:row.item_type, brand:row.brand, vendor_code:row.vendor_code, batch_code:row.batch_code, cost_price:Number(row.cost_price), mrp:Number(row.mrp), sales_price:Number(row.sales_price), discount_pct:discPct, quantity:Number(row.quantity)||0, updated_at:new Date().toISOString()};
        if (existing.length > 0) { await DataLayer.updateDocument('items', existing[0].id, data); updated++; }
        else { data.item_code = Inventory.generateItemCode(); data.created_at = new Date().toISOString(); await DataLayer.addDocument('items', data); added++; }
      } catch(e) { if(errors.length<5) errors.push({row:row._rowNum,reason:e.message}); }
    }
    return {added:added, updated:updated, errors:errors};
  }

  function _renderScreen() {
    var container = document.querySelector('#screen-import-export .screen-content');
    if (!container) return;
    container.innerHTML = '<h2>Import / Export</h2>' +
      '<div class="ie-section"><h3>Export Inventory to CSV</h3><p>Download all inventory items as a CSV file.</p><button id="ie-export-btn" class="btn btn-primary">Export CSV</button></div>' +
      '<div class="ie-section"><h3>Import Inventory from CSV</h3><p>Upload a CSV file to add or update items. Required columns: item_type, brand, vendor_code, batch_code, cost_price, mrp, sales_price, quantity.</p><input type="file" id="ie-import-file" accept=".csv"><button id="ie-import-btn" class="btn btn-primary">Import</button><div id="ie-import-result"></div></div>';
    document.getElementById('ie-export-btn').addEventListener('click', exportToCSV);
    document.getElementById('ie-import-btn').addEventListener('click', async function() {
      var fileInput = document.getElementById('ie-import-file');
      if (!fileInput.files[0]) { Utils.showToast('Please select a CSV file.', 'error'); return; }
      Utils.showToast('Importing...', 'info');
      var result = await importFromCSV(fileInput.files[0]);
      var msg = 'Added: ' + result.added + ', Updated: ' + result.updated + ', Errors: ' + result.errors.length;
      document.getElementById('ie-import-result').innerHTML = '<p>' + msg + '</p>' + (result.errors.length > 0 ? '<ul>' + result.errors.map(function(e){return '<li>Row ' + e.row + ': ' + Utils.escapeHtml(e.reason) + '</li>';}).join('') + '</ul>' : '');
      Utils.showToast(msg, result.errors.length > 0 ? 'warning' : 'success');
    });
  }

  return { init:init, exportToCSV:exportToCSV, importFromCSV:importFromCSV, parseCSV:parseCSV, validateRow:validateRow, generateCSV:generateCSV };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = ImportExport; }
