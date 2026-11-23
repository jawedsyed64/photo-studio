// Thin wrapper around the Electron preload API, with a browser fallback so the
// editor can also be opened in a normal browser for testing.

export interface PickedFile { path: string | null; name: string; bytes: Uint8Array }

interface ElectronApi {
  openImages(multi: boolean): Promise<PickedFile[]>;
  readFile(path: string): Promise<Uint8Array>;
  saveDialog(defaultName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  chooseFolder(): Promise<string | null>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  openProject(): Promise<{ path: string; text: string } | null>;
  readText(path: string): Promise<string>;
  storeGet(key: string): Promise<any>;
  storeSet(key: string, value: any): Promise<void>;
  setSecret(name: string, value: string): Promise<boolean>;
  hasSecret(name: string): Promise<boolean>;
  showInFolder(path: string): Promise<void>;
  joinPath(...parts: string[]): Promise<string>;
  userDataPath(): Promise<string>;
  exists(path: string): Promise<boolean>;
  onOpenFile(cb: (path: string) => void): void;
  version(): Promise<string>;
  pathForFile(f: File): string;
}

const api: ElectronApi | undefined = (window as any).photoStudio;
export const isDesktop = !!api;

function pickInBrowser(accept: string, multi: boolean): Promise<PickedFile[]> {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multi;
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      resolve(await Promise.all(files.map(async f => ({ path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    };
    inp.click();
  });
}

function download(name: string, bytes: Uint8Array | string) {
  const blob = new Blob([bytes as BlobPart]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const platform = {
  async openImages(multi = false): Promise<PickedFile[]> {
    if (api) return api.openImages(multi);
    return pickInBrowser('image/*,.tif,.tiff', multi);
  },
  async readFile(path: string) { if (!api) throw new Error('Not available'); return api.readFile(path); },
  async exists(path: string) { return api ? api.exists(path) : false; },
  /** Save bytes: asks for a location (desktop) or downloads (browser). Returns saved path or name. */
  async saveBytes(defaultName: string, bytes: Uint8Array, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
    if (!api) { download(defaultName, bytes); return defaultName; }
    const p = await api.saveDialog(defaultName, filters);
    if (!p) return null;
    await api.writeFile(p, bytes);
    return p;
  },
  async writeBytes(path: string, bytes: Uint8Array) { if (api) await api.writeFile(path, bytes); else download(path.split(/[\\/]/).pop()!, bytes); },
  async chooseFolder() { return api ? api.chooseFolder() : null; },
  async joinPath(...p: string[]) { return api ? api.joinPath(...p) : p.join('/'); },
  async saveText(defaultName: string, text: string, filters: { name: string; extensions: string[] }[], existingPath?: string | null): Promise<string | null> {
    if (!api) { download(defaultName, text); return defaultName; }
    const p = existingPath || await api.saveDialog(defaultName, filters);
    if (!p) return null;
    await api.writeText(p, text);
    return p;
  },
  async openProject(): Promise<{ path: string | null; text: string } | null> {
    if (api) return api.openProject();
    const f = await pickInBrowser('.pstudio,.json', false);
    if (!f.length) return null;
    return { path: null, text: new TextDecoder().decode(f[0].bytes) };
  },
  async readText(path: string) { if (!api) throw new Error('Not available'); return api.readText(path); },
  async pickJson(): Promise<string | null> {
    const f = await pickInBrowser('.json', false);
    return f.length ? new TextDecoder().decode(f[0].bytes) : null;
  },
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      if (api) { const v = await api.storeGet(key); return v ?? fallback; }
      const raw = localStorage.getItem('ps:' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  async set(key: string, value: any) {
    try {
      if (api) return api.storeSet(key, value);
      localStorage.setItem('ps:' + key, JSON.stringify(value));
    } catch (e) { console.warn('store failed', e); }
  },
  async setSecret(name: string, value: string) { return api ? api.setSecret(name, value) : false; },
  async hasSecret(name: string) { return api ? api.hasSecret(name) : false; },
  async showInFolder(path: string) { if (api) await api.showInFolder(path); },
  async userDataPath() { return api ? api.userDataPath() : ''; },
  onOpenFile(cb: (path: string) => void) { api?.onOpenFile(cb); },
  async version() { return api ? api.version() : 'browser'; },
  pathForFile(f: File): string | null { try { return api ? api.pathForFile(f) || null : null; } catch { return null; } },
};
