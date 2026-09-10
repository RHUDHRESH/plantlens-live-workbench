const { _electron: electron } = require('../../node_modules/@playwright/test');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const executablePath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'PlantLens (Unsigned Development Build).exe');
const dataDir = process.env.PLANTLENS_SMOKE_DATA || 'D:\\PlantLens-build\\shell-smoke';
if (!fs.existsSync(executablePath)) throw new Error(`Build the unpacked app first: ${executablePath}`);
fs.mkdirSync(dataDir, { recursive: true });

function portClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(true); });
  });
}

(async () => {
  let application;
  try {
    application = await electron.launch({ executablePath, env: { ...process.env, PLANTLENS_DESKTOP_DATA: dataDir, PLANTLENS_DISABLE_AUTO_SETUP: '1' } });
    const page = await application.firstWindow();
    await page.waitForURL('**/workbench', { timeout: 30000 });
    await page.getByText('PlantLens CAD').waitFor({ timeout: 30000 });
    const status = await page.evaluate(() => window.plantlensDesktop.modelStatus());
    if (!status?.state) throw new Error('Desktop bridge did not return model status');
    const companion = await page.evaluate(async () => {
      const session = await window.plantlensDesktop.companionSession();
      const response = await fetch(`${session.url}/v1/devices`, { headers: { authorization: `Bearer ${session.token}` } });
      const payload = await response.json();
      return { ok: response.ok, devices: payload.devices };
    });
    if (!companion.ok || !Array.isArray(companion.devices)) throw new Error('Packaged companion serial enumeration failed');
    const first = { schemaVersion: 1, id: 'smoke', name: 'Smoke', revision: 1, assets: [], terminals: [], placements: [], connections: [], proposals: [] };
    await page.evaluate((document) => window.plantlensDesktop.workspaceSave(document, 0), first);
    const loaded = await page.evaluate(() => window.plantlensDesktop.workspaceLoad());
    if (loaded?.id !== 'smoke' || loaded.revision !== 1) throw new Error('Workspace round-trip failed');
    await page.evaluate((document) => window.plantlensDesktop.workspaceSave({ ...document, name: 'Smoke two' }, 1), loaded);
  } finally { await application?.close(); }
  await new Promise((resolve) => setTimeout(resolve, 750));
  if (!(await portClosed(3217))) throw new Error('Application service remained after Electron exited');
  if (!(await portClosed(43117))) throw new Error('Companion service remained after Electron exited');
  process.stdout.write(`Packaged smoke passed; isolated data: ${dataDir}\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
