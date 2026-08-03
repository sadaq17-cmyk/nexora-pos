const { contextBridge, ipcRenderer } = require('electron');

/**
 * Desktop bridge only — must NOT expose as window.api (that would hijack the
 * web data plane in src/lib/api.js which treats window.api as a full POS API).
 *
 * Production EXE always uses HashRouter against the local nexora:// shell.
 */
contextBridge.exposeInMainWorld('nexoraDesktop', {
  isDesktop: true,
  forceHashRouter: true,
  loadsLocalDist: true,
  apiOrigin: 'https://www.nexorapospro.com',
  // Attests Electron file:// calls to production /api (see api/_authHelpers.js).
  desktopAttestation: 'nexora-desktop-v1',
  getPrinters: () => ipcRenderer.invoke('nexora:get-printers'),
  printReceipt: (opts = {}) => ipcRenderer.invoke('nexora:print-receipt', opts),
});
