// IRONFRONT desktop shell (Windows / Linux / macOS / Steam Deck). Serves the built game over a privileged
// app:// protocol, and bridges Steam achievements + overlay through steamworks.js when launched from Steam.
const { app, BrowserWindow, ipcMain, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { resolveGameAsset } = require('./assets.cjs');

let steam = null, steamClient = null;
try {
  steam = require('steamworks.js');
  steam.electronEnableSteamOverlay();
} catch (e) { steam = null; }

function readAppId() {
  for (const p of [path.join(path.dirname(process.execPath), 'steam_appid.txt'), path.join(__dirname, '..', 'steam_appid.txt')]) {
    try {
      const id = Number(fs.readFileSync(p, 'utf8').trim());
      if (Number.isSafeInteger(id) && id > 0) return id;
    } catch { /* try next */ }
  }
  return 480; // Valve's public test app (Spacewar)
}

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('force_high_performance_gpu');

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600,
    fullscreen: true, backgroundColor: '#000000', autoHideMenuBar: true, show: false,
    title: 'IRONFRONT: Zero Hour',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  win.loadURL('app://game/index.html');
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('fullscreen', (_e, v) => { if (win.isFullScreen() !== !!v) win.setFullScreen(!!v); });
  ipcMain.on('steam-ach', (_e, id) => {
    try { if (steamClient) steamClient.achievement.activate(String(id)); } catch { /* achievement not configured */ }
  });
  ipcMain.handle('steam-info', () => {
    try { return steamClient ? { name: steamClient.localplayer.getName(), appId: readAppId() } : null; } catch { return null; }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const file = resolveGameAsset(DIST, req.url);
    if (!file) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('not found', { status: 404 }));
  });
  const appId = readAppId();
  // Packaged builds stay standalone until a real Steam app ID is configured.
  if (steam && (!app.isPackaged || appId !== 480)) { try { steamClient = steam.init(appId); } catch (e) { steamClient = null; console.log('Steam not running — continuing offline.'); } }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
