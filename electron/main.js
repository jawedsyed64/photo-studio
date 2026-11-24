// Photo Studio – Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const aiServices = require('./ai/services');

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'tif', 'tiff'];
let win = null;
let pendingOpen = null;

function storeDir() {
  const d = path.join(app.getPath('userData'), 'store');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const keyFile = key => path.join(storeDir(), key.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSONAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function fileArg(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).find(a => !a.startsWith('-') && fs.existsSync(a) && /\.(pstudio|jpe?g|png|bmp|webp|gif|tiff?)$/i.test(a));
}

function createWindow() {
  const state = readJSON(path.join(app.getPath('userData'), 'window.json'), { width: 1440, height: 900 });
  win = new BrowserWindow({
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: 1024, minHeight: 640,
    backgroundColor: '#1c1c1c',
    title: 'Photo Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (state.maximized) win.maximize();
  win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) { win.webContents.send('open-file', pendingOpen); pendingOpen = null; }
  });
  win.on('close', () => {
    try {
      const b = win.getNormalBounds();
      writeJSONAtomic(path.join(app.getPath('userData'), 'window.json'), { ...b, maximized: win.isMaximized() });
    } catch { /* ignore */ }
  });
  // External links open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const r = dialog.showMessageBoxSync(win, { type: 'error', title: 'Photo Studio', message: 'The editor stopped unexpectedly.', detail: 'Your edits were saved automatically. Reload to recover them.', buttons: ['Reload', 'Quit'] });
    if (r === 0) win.reload(); else app.quit();
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

// ---------- IPC ----------
const imageFilters = [
  { name: 'Images', extensions: IMAGE_EXT },
  { name: 'All files', extensions: ['*'] },
];

ipcMain.handle('open-images', async (_e, multi) => {
  const r = await dialog.showOpenDialog(win, { title: multi ? 'Import photos' : 'Open photo', filters: imageFilters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] });
  if (r.canceled) return [];
  return r.filePaths.map(p => ({ path: p, name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }));
});
ipcMain.handle('read-file', async (_e, p) => new Uint8Array(await fs.promises.readFile(p)));
ipcMain.handle('read-text', async (_e, p) => fs.promises.readFile(p, 'utf8'));
ipcMain.handle('exists', async (_e, p) => { try { return !!p && fs.existsSync(p); } catch { return false; } });
ipcMain.handle('save-dialog', async (_e, defaultName, filters) => {
  const s = readJSON(keyFile('lastdir'), null);
  const r = await dialog.showSaveDialog(win, { defaultPath: s ? path.join(s, defaultName) : defaultName, filters });
  if (r.canceled || !r.filePath) return null;
  writeJSONAtomic(keyFile('lastdir'), path.dirname(r.filePath));
  return r.filePath;
});
ipcMain.handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('write-file', async (_e, p, bytes) => { await fs.promises.writeFile(p, Buffer.from(bytes)); });
ipcMain.handle('write-text', async (_e, p, text) => {
  const tmp = p + '.tmp';
  await fs.promises.writeFile(tmp, text, 'utf8');
  await fs.promises.rename(tmp, p);
});
ipcMain.handle('open-project', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open project', filters: [{ name: 'Photo Studio project', extensions: ['pstudio'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  return { path: r.filePaths[0], text: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('store-get', async (_e, key) => readJSON(keyFile(key), null));
ipcMain.handle('store-set', async (_e, key, value) => {
  const f = keyFile(key);
  if (value === null || value === undefined) { try { fs.unlinkSync(f); } catch { /* ignore */ } return; }
  writeJSONAtomic(f, value);
});
ipcMain.handle('set-secret', async (_e, name, value) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const f = path.join(app.getPath('userData'), 'secrets.json');
  const all = readJSON(f, {});
  all[name] = safeStorage.encryptString(value).toString('base64');
  writeJSONAtomic(f, all);
  return true;
});
ipcMain.handle('has-secret', async (_e, name) => !!readJSON(path.join(app.getPath('userData'), 'secrets.json'), {})[name]);
// Secrets are decrypted only in the main process (used by AI services from Phase 3); never sent to the page.
function getSecret(name) {
  const v = readJSON(path.join(app.getPath('userData'), 'secrets.json'), {})[name];
  if (!v || !safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(Buffer.from(v, 'base64')); } catch { return null; }
}
module.exports = { getSecret };
ipcMain.handle('show-in-folder', async (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
ipcMain.handle('join-path', async (_e, ...parts) => path.join(...parts));
ipcMain.handle('user-data', async () => app.getPath('userData'));
ipcMain.handle('version', async () => app.getVersion());

// ---------- assets (AI masks, retouch patches, generated images) ----------
const assetDir = docId => { const d = path.join(app.getPath('userData'), 'assets', String(docId).replace(/[^a-zA-Z0-9_-]/g, '_')); fs.mkdirSync(d, { recursive: true }); return d; };
const assetFile = (docId, id) => path.join(assetDir(docId), String(id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.bin');
ipcMain.handle('asset-save', async (_e, docId, id, bytes) => { await fs.promises.writeFile(assetFile(docId, id), Buffer.from(bytes)); });
ipcMain.handle('asset-load', async (_e, docId, id) => { try { return new Uint8Array(await fs.promises.readFile(assetFile(docId, id))); } catch { return null; } });
aiServices.register(() => win);

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileArg(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-file', f);
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    pendingOpen = fileArg(process.argv) || null;
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
