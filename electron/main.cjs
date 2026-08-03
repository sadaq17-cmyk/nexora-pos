const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

/** API origin only — shell HTML is always local dist/index.html */
const API_ORIGIN = (
  process.env.NEXORA_WEB_ORIGIN ||
  'https://www.nexorapospro.com'
).replace(/\/$/, '');

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
const LOAD_TIMEOUT_MS = 60000;

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

/** Resolve packaged/unpacked dist/index.html on disk (never an HTTP URL). */
function resolveDistIndexPath() {
  const candidates = [];
  if (app.isPackaged) {
    const appPath = app.getAppPath(); // .../app.asar
    // Prefer asarUnpack real files for reliable file:// ES module loads.
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'index.html'));
    candidates.push(path.join(`${appPath}.unpacked`, 'dist', 'index.html'));
    candidates.push(path.join(appPath, 'dist', 'index.html'));
    candidates.push(path.join(process.resourcesPath, 'dist', 'index.html'));
  } else {
    candidates.push(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      log('dist/index.html found at', p);
      return p;
    }
  }
  log('dist/index.html NOT FOUND. tried=', candidates.join(' | '));
  return null;
}

function getLoginFileUrl() {
  const indexPath = resolveDistIndexPath();
  if (!indexPath) return null;
  const html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes('/src/main.jsx')) {
    log('FATAL: dist is Vite DEV entry');
    return null;
  }
  // Always HashRouter login — never load bare index without hash.
  return `${pathToFileURL(indexPath).href}#/login`;
}

function classifyRenderer(info) {
  const text = String(info?.bodyText || '');
  const href = String(info?.href || '');
  const has404 =
    (/That page does(?: not|n't) exist/i.test(text) ||
      (/\b404\b/.test(text) && /does(?: not|n't) exist/i.test(text))) &&
    !/Sign in/i.test(text);
  const hasLogin = /Sign in/i.test(text) && /Password/i.test(text);
  return {
    has404,
    hasLogin,
    href,
    protocol: info?.protocol,
    hash: info?.hash,
    forceHash: info?.forceHash,
    desktopBuild: info?.desktopBuild,
    text: text.slice(0, 220),
  };
}

async function readRenderer(win) {
  try {
    return await win.webContents.executeJavaScript(
      `({
        href: location.href,
        protocol: location.protocol,
        pathname: location.pathname,
        hash: location.hash,
        bodyText: (document.body && document.body.innerText || '').slice(0, 1000),
        forceHash: Boolean(window.__NEXORA_FORCE_HASH__ || (window.nexoraDesktop && window.nexoraDesktop.forceHashRouter)),
        desktopBuild: Boolean(window.__NEXORA_DESKTOP_BUILD__),
        hasDesktop: Boolean(window.nexoraDesktop)
      })`
    );
  } catch (err) {
    log('readRenderer failed', err.message || err);
    return null;
  }
}

function loadUrlReliable(win, url, { timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const wc = win.webContents;
    let settled = false;

    const done = async (networkOk, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wc.removeListener('did-fail-load', onFail);
      wc.removeListener('did-finish-load', onFinish);

      let info = await readRenderer(win);
      let cls = classifyRenderer(info || {});
      for (let i = 0; i < 40 && networkOk && !cls.has404 && !cls.hasLogin; i++) {
        await sleep(350);
        info = await readRenderer(win);
        cls = classifyRenderer(info || {});
        if (cls.hasLogin || cls.has404) break;
      }
      const ok = Boolean(networkOk) && cls.hasLogin && !cls.has404 && String(cls.hash || '').includes('/login');
      log('loadUrlReliable', JSON.stringify({ url, networkOk, reason, ok, ...cls }));
      resolve({ ok, reason, info, cls, url: wc.getURL() });
    };

    const onFail = (_e, code, desc, _u, isMain) => {
      if (!isMain || code === -3) return;
      done(false, `did-fail-load ${code} ${desc}`);
    };
    const onFinish = () => done(true, 'did-finish-load');
    const timer = setTimeout(() => done(false, 'timeout'), timeoutMs);

    wc.on('did-fail-load', onFail);
    wc.on('did-finish-load', onFinish);
    // Prefer loadURL(file…#/login). Never loadFile() (drops hash → 404).
    win.loadURL(url).catch((err) => done(false, err.message || String(err)));
  });
}

async function loadDevUrl(win) {
  const url = DEV_URL.includes('://') ? DEV_URL : `http://${DEV_URL}`;
  for (let attempt = 1; attempt <= MAX_DEV_RETRIES; attempt++) {
    if (win.isDestroyed()) return;
    log('dev load', url, attempt);
    const result = await loadUrlReliable(win, `${url}/#/login`, { timeoutMs: 8000 });
    if (result.ok) return;
    await sleep(DEV_RETRY_MS);
  }
  await win.loadURL(errorPage(`Could not reach Vite at <code>${url}</code>.`, 'Run npm run dev'));
}

async function loadProductionDistLogin(win) {
  const fileUrl = getLoginFileUrl();
  if (!fileUrl) return false;
  log('production entry (local dist/index.html#/login) →', fileUrl);
  if (/^https?:/i.test(fileUrl)) {
    log('REFUSING http(s) shell URL');
    return false;
  }
  const first = await loadUrlReliable(win, fileUrl);
  if (first.ok) return true;
  log('retry local login once');
  await sleep(800);
  const second = await loadUrlReliable(win, fileUrl);
  return second.ok;
}

function wireGuards(win) {
  const wc = win.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) || url.startsWith('mailto:')) {
      shell.openExternal(url).catch(() => null);
    }
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    log('will-navigate', url);
    // Shell must stay on local file dist. External http opens in browser.
    if (url.startsWith('file:')) {
      if (!url.includes('#/')) {
        event.preventDefault();
        const fixed = getLoginFileUrl();
        if (fixed) win.loadURL(fixed).catch(() => null);
      }
      return;
    }
    if (/^https?:/i.test(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => null);
    }
  });

  wc.on('did-finish-load', () => {
    readRenderer(win).then((info) => {
      const cls = classifyRenderer(info || {});
      log('did-finish-load state', JSON.stringify(cls));
      if (cls.has404 || (info && !String(info.hash || '').includes('/login') && cls.has404 !== false && /404/.test(cls.text || ''))) {
        const fixed = getLoginFileUrl();
        if (fixed && cls.has404) {
          log('recover 404 →', fixed);
          win.loadURL(fixed).catch(() => null);
        }
      }
    });
  });

  wc.on('did-fail-load', (_e, code, desc, validated, isMain) => {
    if (!isMain || code === -3) return;
    log('did-fail-load', code, desc, validated);
  });
}

async function startWindow(win) {
  if (isDev) {
    log('mode=dev');
    win.webContents.openDevTools({ mode: 'detach' });
    await loadDevUrl(win);
    return;
  }

  log('mode=' + (app.isPackaged ? 'packaged' : 'unpackaged'), 'resources=', process.resourcesPath);
  const ok = await loadProductionDistLogin(win);
  if (!ok) {
    await win.loadURL(
      errorPage(
        'Could not load local <code>dist/index.html#/login</code>.',
        'Rebuild with npm run electron:build:win so dist is packaged.'
      )
    );
  }
}

function createWindow() {
  try {
    fs.writeFileSync(logPath(), '', 'utf8');
  } catch {
    /* ignore */
  }
  log('=== Nexora Electron start ===');
  log('isPackaged=', app.isPackaged);
  log('API_ORIGIN=', API_ORIGIN, '(API only; shell is local dist)');

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
      // Local file:// ES modules from dist/assets
      webSecurity: true,
    },
  });

  wireGuards(win);
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  startWindow(win);
  return win;
}

app.whenReady().then(() => {
  ipcMain.handle('nexora:get-printers', async (event) => {
    try {
      const listed = await event.sender.getPrintersAsync();
      return (listed || []).map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: Boolean(p.isDefault),
        status: p.status,
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('nexora:print-receipt', async (event, opts = {}) => {
    try {
      const deviceName = String(opts.deviceName || opts.printer_name || '').trim();
      await new Promise((resolve, reject) => {
        event.sender.print(
          { silent: true, printBackground: true, deviceName: deviceName || undefined },
          (success, reason) => (success ? resolve() : reject(new Error(reason || 'Print failed')))
        );
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || 'Print failed' };
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
