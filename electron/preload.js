const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: {
    login: (email, password) => ipcRenderer.invoke("auth:login", { email, password }),
    listUsers: () => ipcRenderer.invoke("auth:listUsers"),
  },
  products: {
    getAll: () => ipcRenderer.invoke("products:getAll"),
    getByBarcode: (barcode) => ipcRenderer.invoke("products:getByBarcode", barcode),
    getCategories: () => ipcRenderer.invoke("products:getCategories"),
    create: (product) => ipcRenderer.invoke("products:create", product),
    update: (product) => ipcRenderer.invoke("products:update", product),
    delete: (id) => ipcRenderer.invoke("products:delete", id),
    adjustStock: (id, delta) => ipcRenderer.invoke("products:adjustStock", { id, delta }),
  },
  sales: {
    create: (sale) => ipcRenderer.invoke("sales:create", sale),
    getRecent: (limit) => ipcRenderer.invoke("sales:getRecent", limit),
    getSummary: () => ipcRenderer.invoke("sales:getSummary"),
    getWeeklyTrend: () => ipcRenderer.invoke("sales:getWeeklyTrend"),
    getItems: (saleId) => ipcRenderer.invoke("sales:getItems", saleId),
  },
  customers: {
    getAll: () => ipcRenderer.invoke("customers:getAll"),
    create: (customer) => ipcRenderer.invoke("customers:create", customer),
  },
});
