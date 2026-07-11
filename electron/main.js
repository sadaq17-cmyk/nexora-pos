const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const isDev = process.env.NODE_ENV === "development";

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#F3F6FB",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Open external links (e.g. help docs) in the OS browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  // DB + IPC handlers are required here, after app is ready, because
  // better-sqlite3 needs app.getPath() to resolve the userData directory.
  require("./db/database");
  require("./db/seed").seed();

  require("./ipc/authHandlers").registerAuthHandlers();
  require("./ipc/productHandlers").registerProductHandlers();
  require("./ipc/salesHandlers").registerSalesHandlers();
  require("./ipc/customerHandlers").registerCustomerHandlers();
  require("./ipc/supplierHandlers").registerSupplierHandlers();
  require("./ipc/purchaseHandlers").registerPurchaseHandlers();
  require("./ipc/expenseHandlers").registerExpenseHandlers();
  require("./ipc/reportHandlers").registerReportHandlers();
  require("./ipc/settingsHandlers").registerSettingsHandlers();
  const { registerBackupHandlers, runAutoBackupIfDue } = require("./ipc/backupHandlers");
  registerBackupHandlers();
  require("./ipc/syncHandlers").registerSyncHandlers();
  require("./ipc/permissionHandlers").registerPermissionHandlers();
  require("./ipc/auditHandlers").registerAuditHandlers();

  // Scheduled automatic backups: check on startup, then once an hour.
  // runAutoBackupIfDue() itself decides whether enough time has actually
  // passed based on the auto_backup_interval_hours setting.
  runAutoBackupIfDue();
  setInterval(runAutoBackupIfDue, 60 * 60 * 1000);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
