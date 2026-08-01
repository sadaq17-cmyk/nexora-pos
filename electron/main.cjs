const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

/** Live SaaS origin (Vercel). Do not reuse ELECTRON_START_URL here — that is for dev only. */
const PRODUCTION_ORIGIN = (
  process.env.NEXORA_WEB_ORIGIN ||
  'https://www.nexorapospro.com'
).replace(/\/$/, '');

/** Packaged desktop always opens Login on the live site (BrowserRouter + /api work). */
const PRODUCTION_LOGIN_URL = `${PRODUCTION_ORIGIN}/login`;

const DEV_URL = (
  process.env.VITE_DEV_SERVER_URL ||
  process.env.ELECTRON_START_URL ||
  'http://localhost:5173'
).replace(/\/$/, '');

const isDev =
  !app.isPackaged &&
  (process.env.ELECTRON_DEV === '1' ||
    process.env.NODE_ENV === 'development' ||
    process.argv.includes('--dev'));

const MAX_DEV_RETRIES = 40;
const DEV_RETRY_MS = 750;

function logPath() {
  try {
    return path.join(app.getPath('userData'), 'nexora-electron.log');
  } catch {
    return path.join(__dirname, 'nexora-electron.log');
  }
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(logPath(), `${line}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorPage(message, detail) {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>Nexora POS Pro</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Segoe UI,system-ui,sans-serif;
background:linear-gradient(160deg,#0B1C3D,#0a1628);color:#f4f7fb}
main{max-width:36rem;padding:2rem;line-height:1.5}
code{background:rgba(255,255,255,.08);padding:.1rem .35rem;border-radius:4px}
.detail{margin-top:1rem;font-size:.85rem;opacity:.65;word-break:break-word}
</style></head><body><main>
<h1>Nexora POS Pro</h1>
<p>${message}</p>
${detail ? `<p class="detail">${detail}</p>` : ''}
<p class="detail">Log: ${logPath().replace(/\\/g, '/')}</p>
</main></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/**
 * Local dist via file:// MUST use a hash URL so React HashRouter can match /login.
 * BrowserRouter + file:// pathname (filesystem path) → NotFound 404.
 */
function getLocalLoginFileUrl() {
  const root = app.isPackaged
    ? app.getAppPath()
    : path.join(__dirname, '..');
  const distIndex = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) return null;
  const fileUrl = 'file:///' + distIndex.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:');
  // Ensure three slashes after file: for Windows paths
  const normalized = distIndex.startsWith('/')
    ? `file://${distIndex}`
    : `file:///${distIndex.replace(/\\/g, '/')}`;
  return `${normalized}#/login`;
}

async function loadDevUrl(win) {
  const url = DEV_URL.includes('://') ? DEV_URL : `http://${DEV_URL}`;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_DEV_RETRIES; attempt++) {
    if (win.isDestroyed()) return;
    try {
      log('loadURL(dev)', url, `attempt=${attempt}`);
      await win.loadURL(url);
      log('loaded', win.webContents.getURL());
      return;
    } catch (err) {
      lastError = err;
      log('dev load failed', err.message || err);
      if (attempt < MAX_DEV_RETRIES) await sleep(DEV_RETRY_MS);
    }
  }
  await win.loadURL(
    errorPage(
      `Could not reach Vite at <code>${url}</code>. Run <code>npm run dev</code> then retry.`,
      lastError && lastError.message
    )
  );
}

async function loadPackagedProduction(win) {
  const url = PRODUCTION_LOGIN_URL;
  log('packaged startup → production login', url);
  try {
    await win.loadURL(url);
    log('loaded', win.webContents.getURL());
    return true;
  } catch (err) {
    log('production loadURL threw', err.message || err);
    return false;
  }
}

async function loadLocalHashLogin(win) {
  const url = getLocalLoginFileUrl();
  if (!url) {
    log('local dist missing');
    return false;
  }
  log('fallback local hash login', url);
  try {
    await win.loadURL(url);
    log('loaded', win.webContents.getURL());
    return true;
  } catch (err) {
    log('local loadURL failed', err.message || err);
    return false;
  }
}

function wireNavigationLogs(win) {
  const wc = win.webContents;

  wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (isMainFrame) log('did-start-navigation', url, `inPlace=${isInPlace}`);
  });

  wc.on('will-redirect', (_e, url) => {
    log('will-redirect', url);
  });

  wc.on('did-redirect-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (isMainFrame) log('did-redirect-navigation', url);
  });

  wc.on('did-navigate', (_e, url) => {
    log('did-navigate', url);
  });

  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) log('did-navigate-in-page', url);
  });

  wc.on('did-finish-load', () => {
    log('did-finish-load', wc.getURL());
    // Capture whether NotFound text is present
    wc.executeJavaScript(
      `({
        href: location.href,
        protocol: location.protocol,
        pathname: location.pathname,
        hash: location.hash,
        title: document.title,
        bodyText: (document.body && document.body.innerText || '').slice(0, 500)
      })`
    )
      .then((info) => log('renderer-location', JSON.stringify(info)))
      .catch((err) => log('renderer-location failed', err.message || err));
  });

  wc.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      log('did-fail-load', errorCode, errorDescription, validatedURL);
    }
  );
}

async function startWindow(win) {
  if (isDev) {
    log('mode=dev');
    win.webContents.openDevTools({ mode: 'detach' });
    await loadDevUrl(win);
    return;
  }

  if (app.isPackaged) {
    log('mode=packaged', 'userData=' + app.getPath('userData'));
    const ok = await loadPackagedProduction(win);
    if (ok) return;

    // Only if production URL failed to start loading — try hash file URL (not loadFile).
    const localOk = await loadLocalHashLogin(win);
    if (!localOk) {
      await win.loadURL(
        errorPage(
          `Could not open <code>${PRODUCTION_LOGIN_URL}</code>. Check your internet connection and try again.`,
          `Also missing local dist fallback.`
        )
      );
    }
    return;
  }

  // Unpackaged production smoke: prefer live site, then local hash
  log('mode=unpackaged-prod');
  const ok = await loadPackagedProduction(win);
  if (!ok) await loadLocalHashLogin(win);
}

function createWindow() {
  try {
    fs.writeFileSync(logPath(), '', 'utf8');
  } catch {
    /* ignore */
  }
  log('=== Nexora Electron start ===');
  log('isPackaged=', app.isPackaged, 'execPath=', process.execPath);

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

  wireNavigationLogs(win);

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  startWindow(win);
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
