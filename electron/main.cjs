const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Packaged (asar): resolve from app root via getAppPath().
// Unpackaged: electron/ sits next to project dist/.
function getDistIndex() {
  const root = app.isPackaged
    ? app.getAppPath()
    : path.join(__dirname, '..');
  return path.join(root, 'dist', 'index.html');
}

// Dev when explicitly requested. Packaged builds always use dist/.
// Prefer `npm run electron:dev` (passes --dev) over bare `electron .`.
const isDev =
  !app.isPackaged &&
  (process.env.ELECTRON_DEV === '1' ||
    process.env.NODE_ENV === 'development' ||
    process.argv.includes('--dev'));

const DEV_URL =
  process.env.VITE_DEV_SERVER_URL ||
  process.env.ELECTRON_START_URL ||
  'http://localhost:5173';

const MAX_DEV_RETRIES = 40;
const DEV_RETRY_MS = 750;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorPage(title, message, detail) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: linear-gradient(160deg, #0B1C3D 0%, #13294b 55%, #0a1628 100%);
      color: #f4f7fb;
    }
    main {
      max-width: 36rem;
      padding: 2rem;
      line-height: 1.5;
    }
    h1 { margin: 0 0 0.75rem; font-size: 1.75rem; letter-spacing: 0.02em; }
    p { margin: 0.5rem 0; opacity: 0.92; }
    code {
      font-family: ui-monospace, Consolas, monospace;
      background: rgba(255,255,255,0.08);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
    }
    .detail { margin-top: 1.25rem; font-size: 0.85rem; opacity: 0.65; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <h1>Nexora POS</h1>
    <p>${message}</p>
    ${detail ? `<p class="detail">${detail}</p>` : ''}
  </main>
</body>
</html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

async function loadDevUrl(win, url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_DEV_RETRIES; attempt++) {
    if (win.isDestroyed()) return;

    try {
      await win.loadURL(url);
      console.log(`[electron] Loaded dev URL: ${url}`);
      return;
    } catch (err) {
      lastError = err;
      const msg = err && err.message ? err.message : String(err);
      console.warn(
        `[electron] Dev load failed (${attempt}/${MAX_DEV_RETRIES}): ${msg}`
      );

      if (attempt < MAX_DEV_RETRIES) {
        await sleep(DEV_RETRY_MS);
      }
    }
  }

  const detail = lastError
    ? `${lastError.message || lastError}`
    : 'ERR_CONNECTION_REFUSED';

  console.error(`[electron] Giving up on ${url}: ${detail}`);
  await win.loadURL(
    errorPage(
      'Nexora POS — Dev server unavailable',
      `Could not reach the Vite dev server at <code>${url}</code>. Start it with <code>npm run dev</code>, then reload (Ctrl+R).`,
      detail
    )
  );
}

async function loadProduction(win) {
  const distIndex = getDistIndex();

  if (!fs.existsSync(distIndex)) {
    console.error(`[electron] Missing production build: ${distIndex}`);
    await win.loadURL(
      errorPage(
        'Nexora POS — Build missing',
        `Production files not found at <code>dist/index.html</code>. Run <code>npm run build</code>, or use <code>npm run electron:dev</code> with Vite.`,
        distIndex
      )
    );
    return;
  }

  try {
    await win.loadFile(distIndex);
    console.log(`[electron] Loaded production file: ${distIndex}`);
  } catch (err) {
    console.error('[electron] loadFile failed:', err);
    await win.loadURL(
      errorPage(
        'Nexora POS — Load failed',
        `Failed to open <code>dist/index.html</code>.`,
        err && err.message ? err.message : String(err)
      )
    );
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0B1C3D',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      // Ignore aborted loads from our own retries / navigation swaps
      if (errorCode === -3) return;
      console.error('[electron] did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
      });
    }
  );

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] render-process-gone', details);
  });

  if (isDev) {
    console.log(`[electron] Development mode → ${DEV_URL}`);
    win.webContents.openDevTools({ mode: 'detach' });
    loadDevUrl(win, DEV_URL);
  } else {
    console.log(`[electron] Production mode → ${getDistIndex()}`);
    loadProduction(win);
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
