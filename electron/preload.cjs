const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('nexoraDesktop', {
  isDesktop: true,
  apiOrigin: 'https://www.nexorapospro.com',
});
