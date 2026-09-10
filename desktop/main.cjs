const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { DesktopStore } = require('./store.cjs');
const { validateWorkspace } = require('./workspace-policy.cjs');

let window;
let tray;
let store;
let inference;
let quitting = false;
const children = new Set();
const isDev = !app.isPackaged;
const APP_PORT = Number(process.env.PLANTLENS_DESKTOP_PORT || 3217);
const baseUrl = `http://127.0.0.1:${APP_PORT}`;
const companionToken = cryptoRandomToken();
function cryptoRandomToken() { return require('node:crypto').randomBytes(32).toString('base64url'); }
const packagedMetadata = require('./package.json');
const isUnsignedDevelopmentBuild = !app.isPackaged || packagedMetadata.plantlensSignedRelease === false;
function diagnostic(message) {
  if (process.env.PLANTLENS_DISABLE_AUTO_SETUP !== '1') return;
  try { require('node:fs').appendFileSync(path.join(app.getPath('userData'), 'desktop-smoke.log'), `${new Date().toISOString()} ${message}\n`); } catch { /* best effort */ }
}
process.on('uncaughtExceptionMonitor', (error) => diagnostic(`uncaught ${error.stack || error}`));

// Test-only path isolation is accepted only by the explicitly unsigned development app.
if (isUnsignedDevelopmentBuild && process.env.PLANTLENS_DESKTOP_DATA) {
  app.setPath('userData', path.resolve(process.env.PLANTLENS_DESKTOP_DATA));
}

function runtimePath(...parts) {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), ...parts);
}

function spawnNode(script, args = [], env = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    windowsHide: true,
    stdio: (isDev || process.env.PLANTLENS_DISABLE_AUTO_SETUP === '1') ? 'inherit' : 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('exit', (code, signal) => diagnostic(`child ${script} exited code=${code} signal=${signal}`));
  return child;
}

function startServices() {
  if (isDev) return;
  spawnNode(runtimePath('app-server', 'server.js'), [], { PORT: String(APP_PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' });
  const companion = runtimePath('companion', 'src', 'server.mjs');
  spawnNode(companion, [], { PLANTLENS_DESKTOP: '1', PLANTLENS_DATA_DIR: app.getPath('userData'), PLANTLENS_UI_ORIGIN: baseUrl, PLANTLENS_COMPANION_PORT: '43117', PLANTLENS_COMPANION_TOKEN: companionToken });
}

function stopServices() {
  for (const child of children) child.kill();
  children.clear();
}

function waitForServer(timeoutMs = 30000) {
  if (isDev) return Promise.resolve();
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(baseUrl, (res) => { res.resume(); resolve(); });
      req.on('error', () => Date.now() - started > timeoutMs ? reject(new Error('Application service did not start')) : setTimeout(check, 200));
      req.setTimeout(1000, () => req.destroy());
    };
    check();
  });
}

function registerIpc(modelManager, inferenceService) {
  const trusted = (event) => {
    const url = event.senderFrame?.url || '';
    const expected = isDev ? (process.env.PLANTLENS_DEV_URL || 'http://localhost:3000') : baseUrl;
    if (event.senderFrame !== event.sender.mainFrame || !url.startsWith(`${expected}/`)) throw new Error('Untrusted IPC sender');
  };
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => { trusted(event); return fn(...args); });
  handle('plantlens:workspace-load', () => store.workspaceLoad().document);
  handle('plantlens:workspace-save', (document, expectedRevision) => store.workspaceSave(validateWorkspace(document), expectedRevision).document);
  handle('plantlens:agent-draft', async (request, document) => {
    if (typeof request !== 'string' || request.length < 1 || request.length > 12000) throw new TypeError('request must contain 1-12000 characters');
    return inferenceService.draft(request, validateWorkspace(document));
  });
  handle('plantlens:model-status', () => ({ ...modelManager.status(), inference: inferenceService.status() }));
  handle('plantlens:model-install', () => modelManager.install());
  handle('plantlens:model-pause', () => modelManager.pause());
  handle('plantlens:model-cancel', () => modelManager.cancel());
  handle('plantlens:model-unload', () => inferenceService.unload());
  handle('plantlens:companion-session', () => ({ url: 'http://127.0.0.1:43117', token: companionToken }));
  let previous = '';
  const publish = () => {
    const status = { ...modelManager.status(), inference: inferenceService.status() };
    const serialized = JSON.stringify(status);
    if (serialized !== previous) { previous = serialized; store.modelStateSet(status); window?.webContents.send('plantlens:model-event', status); }
  };
  setInterval(publish, 500).unref();
}

function createTray() {
  if (!store.preferenceGet('backgroundMonitoring', false)) return;
  const iconPath = runtimePath('desktop', 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('PlantLens');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open PlantLens', click: () => { window?.show(); window?.focus(); } },
    { type: 'separator' },
    { label: 'Exit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => window?.show());
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 680, show: false,
    backgroundColor: '#0b1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const expected = isDev ? (process.env.PLANTLENS_DEV_URL || 'http://localhost:3000') : baseUrl;
    if (!url.startsWith(`${expected}/`)) event.preventDefault();
  });
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ] },
  }));
  window.on('close', (event) => {
    if (!quitting && store.preferenceGet('backgroundMonitoring', false)) { event.preventDefault(); window.hide(); }
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(`${isDev ? (process.env.PLANTLENS_DEV_URL || 'http://localhost:3000') : baseUrl}/workbench`);
}

app.whenReady().then(async () => {
  diagnostic(`ready packaged=${app.isPackaged} resources=${process.resourcesPath}`);
  store = new DesktopStore(path.join(app.getPath('userData'), 'plantlens.sqlite3'));
  startServices();
  const { ModelManager } = require('./model-manager.cjs');
  const { InferenceService } = require('./inference.cjs');
  const runtimeDir = app.isPackaged ? runtimePath('runtime') : path.join(__dirname, '..', '.cache', 'llama', 'bin');
  let releaseMetadata = {};
  try { releaseMetadata = require(path.join(app.getAppPath(), 'package.json')); } catch { /* Development source package. */ }
  const requireSignature = app.isPackaged && releaseMetadata.plantlensSignedRelease === true;
  const modelManager = new ModelManager({ dataDir: app.getPath('userData'), runtimeDir, requireSignature, publicKey: releaseMetadata.plantlensReleasePublicKey });
  const inferenceService = new InferenceService({ modelManager, runtimeDir, store });
  inference = inferenceService;
  registerIpc(modelManager, inferenceService);
  createTray();
  try { await waitForServer(); await createWindow(); }
  catch (error) { console.error(error); diagnostic(`startup ${error.stack || error}`); app.quit(); }
  app.on('activate', () => window ? window.show() : createWindow());
  void modelManager.ready.then(() => {
    if (isUnsignedDevelopmentBuild && process.env.PLANTLENS_DISABLE_AUTO_SETUP === '1') return;
    if (modelManager.status().state === 'NOT_INSTALLED' && !store.preferenceGet('firstLaunchModelAttempted', false)) {
      store.preferenceSet('firstLaunchModelAttempted', true);
      return modelManager.install();
    }
  }).catch((error) => console.error('Model setup deferred:', error.message));
});

app.on('before-quit', () => { quitting = true; inference?.unload(); stopServices(); store?.close(); });
app.on('window-all-closed', () => { if (!store?.preferenceGet('backgroundMonitoring', false)) app.quit(); });
