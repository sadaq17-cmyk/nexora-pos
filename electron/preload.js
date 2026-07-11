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
  suppliers: {
    getAll: () => ipcRenderer.invoke("suppliers:getAll"),
    create: (supplier) => ipcRenderer.invoke("suppliers:create", supplier),
    update: (supplier) => ipcRenderer.invoke("suppliers:update", supplier),
    delete: (id) => ipcRenderer.invoke("suppliers:delete", id),
  },
  purchases: {
    getAll: () => ipcRenderer.invoke("purchases:getAll"),
    getItems: (id) => ipcRenderer.invoke("purchases:getItems", id),
    create: (purchase) => ipcRenderer.invoke("purchases:create", purchase),
    receive: (id) => ipcRenderer.invoke("purchases:receive", id),
    updateStatus: (id, status) => ipcRenderer.invoke("purchases:updateStatus", { id, status }),
  },
  expenses: {
    getAll: () => ipcRenderer.invoke("expenses:getAll"),
    create: (expense) => ipcRenderer.invoke("expenses:create", expense),
    update: (expense) => ipcRenderer.invoke("expenses:update", expense),
    delete: (id) => ipcRenderer.invoke("expenses:delete", id),
    getSummary: () => ipcRenderer.invoke("expenses:getSummary"),
  },
  reports: {
    getRevenueVsExpenses: () => ipcRenderer.invoke("reports:getRevenueVsExpenses"),
    getTopProducts: (limit) => ipcRenderer.invoke("reports:getTopProducts", limit),
    getCategorySales: () => ipcRenderer.invoke("reports:getCategorySales"),
    getProfitSummary: () => ipcRenderer.invoke("reports:getProfitSummary"),
  },
  settings: {
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    update: (updates) => ipcRenderer.invoke("settings:update", updates),
  },
  backup: {
    export: () => ipcRenderer.invoke("backup:export"),
    restore: () => ipcRenderer.invoke("backup:restore"),
  },
  sync: {
    getStatus: () => ipcRenderer.invoke("sync:getStatus"),
    triggerNow: () => ipcRenderer.invoke("sync:triggerNow"),
    setAutoSync: (enabled) => ipcRenderer.invoke("sync:setAutoSync", enabled),
  },
  auth_admin: {
    createUser: (user) => ipcRenderer.invoke("auth:createUser", user),
    setUserActive: (id, active) => ipcRenderer.invoke("auth:setUserActive", { id, active }),
    setUserRole: (id, role) => ipcRenderer.invoke("auth:setUserRole", { id, role }),
  },
});
