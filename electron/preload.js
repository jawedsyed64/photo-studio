// Exposes a small, safe API to the editor page.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('photoStudio', {
  openImages: multi => ipcRenderer.invoke('open-images', multi),
  readFile: p => ipcRenderer.invoke('read-file', p),
  readText: p => ipcRenderer.invoke('read-text', p),
  exists: p => ipcRenderer.invoke('exists', p),
  saveDialog: (name, filters) => ipcRenderer.invoke('save-dialog', name, filters),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  writeFile: (p, bytes) => ipcRenderer.invoke('write-file', p, bytes),
  writeText: (p, text) => ipcRenderer.invoke('write-text', p, text),
  openProject: () => ipcRenderer.invoke('open-project'),
  storeGet: key => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  setSecret: (name, value) => ipcRenderer.invoke('set-secret', name, value),
  hasSecret: name => ipcRenderer.invoke('has-secret', name),
  showInFolder: p => ipcRenderer.invoke('show-in-folder', p),
  joinPath: (...parts) => ipcRenderer.invoke('join-path', ...parts),
  userDataPath: () => ipcRenderer.invoke('user-data'),
  version: () => ipcRenderer.invoke('version'),
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, p) => cb(p)),
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return null; } },
});
