var Printer = (function() {
  'use strict';
  var _connected = false;
  var _port = null;

  function init() { /* no-op until printer configured */ }

  function isESCPOSAvailable() {
    return 'serial' in navigator;
  }

  async function connectPrinter() {
    if (!isESCPOSAvailable()) return false;
    try {
      _port = await navigator.serial.requestPort();
      await _port.open({ baudRate: 9600 });
      _connected = true;
      return true;
    } catch(e) { _connected = false; return false; }
  }

  function isConnected() { return _connected; }

  async function printESCPOS(commands) {
    if (!_connected || !_port) throw new Error('Printer not connected');
    var writer = _port.writable.getWriter();
    var encoder = new TextEncoder();
    await writer.write(encoder.encode(commands));
    writer.releaseLock();
  }

  function printBrowser(htmlContent) {
    var printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) { alert('Please allow popups for bill printing.'); return; }
    printWindow.document.write('<html><head><title>Print</title><style>body{font-family:monospace;font-size:12px;margin:10px;}</style></head><body>' + htmlContent + '</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(function() { printWindow.print(); }, 300);
  }

  function print(content, options) {
    options = options || {};
    if (options.escpos && _connected) {
      printESCPOS(content).catch(function(e) {
        Utils.showToast('ESC/POS print failed, using browser print.', 'info');
        printBrowser(content);
      });
    } else {
      printBrowser(content);
    }
  }

  return { init: init, print: print, isESCPOSAvailable: isESCPOSAvailable, connectPrinter: connectPrinter, isConnected: isConnected, printESCPOS: printESCPOS, printBrowser: printBrowser };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = Printer; }
