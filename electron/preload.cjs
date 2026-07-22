const { contextBridge } = require('electron');

// Minimal safe bridge — no Node APIs exposed to the renderer.
contextBridge.exposeInMainWorld('nexoraDesktop', {});
