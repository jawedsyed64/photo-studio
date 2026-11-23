import { useEffect, useRef, useState } from 'react';
import { Editor, Doc, RecentItem } from './Editor';
import { Icon, Toasts, toast, formatDate, Modal } from './common';
import { AppSettings, defaultSettings, SettingsDialog } from './dialogs';
import { platform, PickedFile } from '../platform';
import { decodeImage, IMPORT_EXT, RAW_EXT, extOf, thumbnailDataUrl } from '../engine/codecs';
import { defaultState, normalizeState } from '../state/types';

const MAX_TEX = (() => {
  try { const gl = document.createElement('canvas').getContext('webgl2'); const v = gl ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 16384) : 8192; gl?.getExtension('WEBGL_lose_context')?.loseContext(); return v; } catch { return 8192; }
})();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function fromBase64(b64: string) {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const TILES: { k: string; label: string; desc: string; icon: string; phase?: number }[] = [
  { k: 'new', label: 'New Project', desc: 'Start editing a photo', icon: 'plus' },
  { k: 'open', label: 'Open Photo', desc: 'JPEG, PNG, TIFF, BMP, WebP', icon: 'image' },
  { k: 'project', label: 'Open Project', desc: 'Continue a saved .pstudio file', icon: 'folder' },
  { k: 'import', label: 'Import Photos', desc: 'Add several photos to Recent', icon: 'import' },
  { k: 'manual', label: 'Manual Photo Editing', desc: 'Light, colour, detail, crop', icon: 'sliders' },
  { k: 'color', label: 'Color Correction', desc: 'Curves, HSL, colour grading', icon: 'color' },
  { k: 'presets', label: 'Presets & Filters', desc: '21 professional looks', icon: 'filters' },
  { k: 'ai', label: 'AI Photo Editing', desc: 'Background, upscale, objects', icon: 'ai', phase: 3 },
  { k: 'portrait', label: 'Portrait Retouching', desc: 'Skin, eyes, healing brush', icon: 'portrait', phase: 4 },
  { k: 'restore', label: 'Photo Restoration', desc: 'Repair & colourise old photos', icon: 'restore', phase: 4 },
  { k: 'effects', label: 'Creative Effects', desc: 'Film, light leaks, text', icon: 'effects', phase: 5 },
  { k: 'batch', label: 'Batch Editing', desc: 'Edit hundreds at once', icon: 'batch', phase: 6 },
  { k: 'export', label: 'Export and Sharing', desc: 'JPEG, PNG, WebP, TIFF', icon: 'share' },
  { k: 'settings', label: 'Settings', desc: 'Theme, mode, AI keys', icon: 'settings' },
];

export function App() {
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings());
  const [doc, setDoc] = useState<Doc | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<'settings' | null>(null);
  const [recover, setRecover] = useState<{ id: string; name: string; imagePath: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [initialTool, setInitialTool] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const docRef = useRef(doc); docRef.current = doc;

  const setSettings = (s: AppSettings) => { setSettingsState(s); platform.set('settings', s); };
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);

  const loadRecent = () => platform.get<RecentItem[]>('recent', []).then(setRecent);

  useEffect(() => {
    platform.get<AppSettings>('settings', defaultSettings()).then(s => setSettingsState({ ...defaultSettings(), ...s }));
    loadRecent();
    // crash recovery
    (async () => {
      const sess = await platform.get<any>('session', null);
      if (sess && sess.clean === false) {
        const a = await platform.get<any>('autosave:' + sess.id, null);
        if (a?.imagePath && await platform.exists(a.imagePath)) setRecover({ id: sess.id, name: a.name, imagePath: a.imagePath });
      }
    })();
    platform.onOpenFile(p => openPath(p));
  }, []);

  // ---------- opening ----------
  const openBytes = async (f: PickedFile, opts: { id?: string; state?: any; projectPath?: string | null; tool?: string; history?: any } = {}) => {
    const ext = extOf(f.name);
    if (RAW_EXT.includes(ext)) { toast(`RAW camera files (.${ext}) are planned for a later phase. Please convert to JPEG or TIFF first.`, 'error'); return; }
    setBusy('Opening ' + f.name + '…');
    try {
      const loaded = await decodeImage(f.bytes, f.name, MAX_TEX);
      const d: Doc = { id: opts.id || uid(), name: f.name, path: f.path, bytes: f.bytes, loaded, state: normalizeState(opts.state || defaultState()), projectPath: opts.projectPath ?? null, createdAt: Date.now() };
      setInitialTool(opts.tool);
      setDoc(null);
      setTimeout(() => setDoc(d), 0);
    } catch (e: any) { toast(e.message || String(e), 'error'); }
    finally { setBusy(null); }
  };

  const openPath = async (path: string, opts: any = {}) => {
    try {
      if (path.toLowerCase().endsWith('.pstudio')) return openProjectText(await platform.readText(path), path);
      const bytes = await platform.readFile(path);
      await openBytes({ path, name: path.split(/[\\/]/).pop()!, bytes }, opts);
    } catch (e: any) { toast('Could not open file: ' + (e.message || e), 'error'); }
  };

  const openProjectText = async (text: string, path: string | null) => {
    try {
      const p = JSON.parse(text);
      if (p.app !== 'PhotoStudio') throw new Error('Not a Photo Studio project');
      let bytes: Uint8Array | null = p.image ? fromBase64(p.image) : null;
      if (!bytes && p.imagePath && await platform.exists(p.imagePath)) bytes = await platform.readFile(p.imagePath);
      if (!bytes) throw new Error('The original photo for this project could not be found' + (p.imagePath ? ': ' + p.imagePath : ''));
      await openBytes({ path: p.imagePath || null, name: p.name || 'photo.jpg', bytes }, { id: typeof p.id === 'string' ? p.id : undefined, state: p.state, projectPath: path });
    } catch (e: any) { toast(e.message || String(e), 'error'); }
  };

  const pick = async (tool?: string) => {
    const files = await platform.openImages(false);
    if (files[0]) openBytes(files[0], { tool });
  };
  const importMany = async (files?: PickedFile[]) => {
    files = files || await platform.openImages(true);
    if (!files.length) return;
    const ok = files.filter(f => IMPORT_EXT.includes(extOf(f.name)));
    if (!ok.length) return toast('No supported photos selected', 'error');
    setBusy(`Importing ${ok.length} photo(s)…`);
    const list = await platform.get<RecentItem[]>('recent', []);
    const added: RecentItem[] = [];
    for (const f of ok) {
      try {
        const li = await decodeImage(f.bytes, f.name, 1024);
        const c = document.createElement('canvas'); c.width = li.width; c.height = li.height;
        const ctx = c.getContext('2d')!; ctx.drawImage(li.image as any, 0, 0);
        const thumb = await thumbnailDataUrl(ctx.getImageData(0, 0, li.width, li.height), 320);
        added.push({ id: uid(), name: f.name, imagePath: f.path, projectPath: null, thumb, editedAt: Date.now() });
      } catch (e: any) { toast(`${f.name}: ${e.message}`, 'error'); }
    }
    await platform.set('recent', [...added, ...list].slice(0, 48));
    setBusy(null); loadRecent();
    toast(`Imported ${added.length} photo(s)`, 'ok');
    if (ok.length === 1 && added.length) openBytes(ok[0], { id: added[0].id });
  };

  const openRecent = async (r: RecentItem) => {
    if (r.projectPath && await platform.exists(r.projectPath)) return openProjectText(await platform.readText(r.projectPath), r.projectPath);
    if (r.imagePath && await platform.exists(r.imagePath)) {
      const a = await platform.get<any>('autosave:' + r.id, null);
      return openPath(r.imagePath, { id: r.id, state: a?.state });
    }
    toast('The original file for "' + r.name + '" was not found. Please open it again.', 'error');
    pick();
  };
  const removeRecent = async (id: string) => {
    const list = recent.filter(r => r.id !== id);
    setRecent(list); platform.set('recent', list);
  };

  const tile = (k: string) => {
    switch (k) {
      case 'new': case 'open': case 'manual': return pick('adjust');
      case 'color': setSettings({ ...settings, mode: 'pro' }); return pick('color');
      case 'presets': return pick('filters');
      case 'project': return platform.openProject().then(p => p && openProjectText(p.text, p.path));
      case 'import': return importMany();
      case 'export': return toast('Open a photo first, then use the Export button in the editor (Ctrl+E).');
      case 'settings': return setModal('settings');
      default: return toast('This workspace is planned for a later phase.', 'info');
    }
  };

  // ---------- drag & drop ----------
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragOver(false); };
    const drop = async (e: DragEvent) => {
      e.preventDefault(); setDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      const picked: PickedFile[] = await Promise.all(files.map(async f => ({ path: platform.pathForFile(f), name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      if (picked.length === 1 && picked[0].name.toLowerCase().endsWith('.pstudio')) return openProjectText(new TextDecoder().decode(picked[0].bytes), picked[0].path);
      if (picked.length === 1 || docRef.current) openBytes(picked[0]);
      else importMany(picked);
    };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);

  const shown = recent.filter(r => r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="app">
      {doc ? (
        <Editor key={doc.id} doc={doc} settings={settings} setSettings={setSettings} initialTool={initialTool}
          onHome={() => { setDoc(null); loadRecent(); }} onOpen={() => pick()} onDocSaved={p => setDoc(d => d ? { ...d, ...p } : d)} />
      ) : (
        <div className="home">
          <div className="home-head">
            <div className="brand"><div className="logo"><Icon name="image" size={22} /></div><div><h1>Photo Studio</h1><p>Professional photo editing, made simple</p></div></div>
            <span className="grow" />
            <div className="mode-toggle">
              <button className={settings.mode === 'beginner' ? 'on' : ''} onClick={() => setSettings({ ...settings, mode: 'beginner' })}>Beginner</button>
              <button className={settings.mode === 'pro' ? 'on' : ''} onClick={() => setSettings({ ...settings, mode: 'pro' })}>Professional</button>
            </div>
            <button className="icon-btn" title="Theme" onClick={() => setSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })}><Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} /></button>
            <button className="icon-btn" title="Settings" onClick={() => setModal('settings')}><Icon name="settings" /></button>
          </div>
          <div className="home-body">
            <div className="drop-hero" onClick={() => pick()}>
              <Icon name="import" size={34} />
              <div><b>Drop photos here</b> or click to open</div>
              <div className="muted small">JPEG · PNG · TIFF · BMP · WebP — your original files are never changed</div>
            </div>
            <div className="tiles">
              {TILES.map(t => (
                <button key={t.k} className={'tile' + (t.phase ? ' soon' : '')} onClick={() => tile(t.k)} title={t.phase ? `Planned for Phase ${t.phase}` : t.desc}>
                  <div className="tile-ic"><Icon name={t.icon} size={22} /></div>
                  <div className="tile-txt"><b>{t.label}</b><span>{t.desc}</span></div>
                  {t.phase && <em>Phase {t.phase}</em>}
                </button>
              ))}
            </div>
            <div className="recent-head"><h2>Recent projects</h2><span className="grow" /><input className="search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {shown.length === 0 && <div className="empty muted">No recent projects yet. Open or drop a photo to get started.</div>}
            <div className="recent">
              {shown.map(r => (
                <div key={r.id} className="rcard" onClick={() => openRecent(r)}>
                  <div className="rthumb">{r.thumb ? <img src={r.thumb} alt="" /> : <Icon name="image" size={30} />}</div>
                  <div className="rinfo"><b title={r.name}>{r.name}</b><span>{formatDate(r.editedAt)}</span></div>
                  <div className="ract" onClick={e => e.stopPropagation()}>
                    {r.imagePath && <button className="mini" title="Show in folder" onClick={() => platform.showInFolder(r.projectPath || r.imagePath!)}><Icon name="folder" size={12} /></button>}
                    <button className="mini" title="Remove from list" onClick={() => removeRecent(r.id)}><Icon name="close" size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {dragOver && <div className="drop-overlay"><Icon name="import" size={48} /><div>Drop to open</div></div>}
      {busy && <div className="busy"><div className="spinner" />{busy}</div>}
      {modal === 'settings' && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setModal(null)} />}
      {recover && (
        <Modal title="Recover unsaved edits?" onClose={() => { setRecover(null); platform.set('session', null); }} footer={<>
          <button className="btn" onClick={() => { setRecover(null); platform.set('session', null); }}>Discard</button>
          <button className="btn accent" onClick={() => { const r = recover; setRecover(null); openRecent({ id: r.id, name: r.name, imagePath: r.imagePath, projectPath: null, thumb: '', editedAt: 0 }); }}>Recover</button>
        </>}>
          <p>Photo Studio closed unexpectedly while you were editing <b>{recover.name}</b>. Your edits were saved automatically.</p>
        </Modal>
      )}
      <Toasts />
    </div>
  );
}
