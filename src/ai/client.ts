// Renderer-side access to the AI services in the Electron main process.

export interface ModelInfo { id: string; name: string; size: number; license: string; installed: boolean; downloading: boolean }

const api: any = (window as any).photoStudio?.ai;
export const aiAvailable = !!api;

export const ai = {
  models: (): Promise<ModelInfo[]> => api ? api.models() : Promise.resolve([]),
  download: (id: string): Promise<boolean> => api.download(id),
  cancelDownload: (id: string) => api.cancelDownload(id),
  deleteModel: (id: string) => api.deleteModel(id),
  run: (payload: any): Promise<any> => api.run(payload),
  cancel: (job: number) => api.cancel(job),
  online: (kind: 'generate' | 'edit', args: any): Promise<Uint8Array> => api.online(kind, args),
  hasKey: (): Promise<boolean> => api ? api.hasKey() : Promise.resolve(false),
  onDownloadProgress: (cb: (d: any) => void): (() => void) => api ? api.onDownloadProgress(cb) : () => {},
  onProgress: (cb: (d: any) => void): (() => void) => api ? api.onProgress(cb) : () => {},
  onOnlineStatus: (cb: (d: any) => void): (() => void) => api ? api.onOnlineStatus(cb) : () => {},
};

/** Friendlier error text for errors coming back over IPC. */
export function aiError(e: any): string {
  let m = String(e?.message || e);
  m = m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  if (m.startsWith('NO_KEY')) return 'This feature uses the online Replicate service. Add your Replicate API key in Settings first.';
  if (m.startsWith('MODEL_MISSING')) return 'The AI model is not downloaded yet.';
  return m;
}
