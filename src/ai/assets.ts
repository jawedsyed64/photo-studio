// Per-document binary assets (AI masks, retouch patches, generated images).
// Bytes are PNG/JPEG; decoded bitmaps are cached. On desktop they are also
// written to disk so autosave / crash recovery can find them again.
import { platform } from '../platform';

const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export class AssetStore {
  private bytes = new Map<string, Uint8Array>();
  private bitmaps = new Map<string, Promise<ImageBitmap>>();
  constructor(public docId: string, initial?: Record<string, Uint8Array>) {
    if (initial) for (const [k, v] of Object.entries(initial)) this.bytes.set(k, v);
  }
  async put(bytes: Uint8Array): Promise<string> {
    const id = uid();
    this.bytes.set(id, bytes);
    try { await platform.assetSave(this.docId, id, bytes); } catch { /* memory only */ }
    return id;
  }
  async putCanvas(c: HTMLCanvasElement | OffscreenCanvas, type = 'image/png', quality?: number): Promise<string> {
    const blob = c instanceof HTMLCanvasElement
      ? await new Promise<Blob>((r, j) => c.toBlob(b => b ? r(b) : j(new Error('encode failed')), type, quality))
      : await c.convertToBlob({ type, quality });
    return this.put(new Uint8Array(await blob.arrayBuffer()));
  }
  async getBytes(id: string): Promise<Uint8Array | null> {
    if (this.bytes.has(id)) return this.bytes.get(id)!;
    const b = await platform.assetLoad(this.docId, id);
    if (b) this.bytes.set(id, b);
    return b;
  }
  bitmap(id: string): Promise<ImageBitmap> {
    if (!this.bitmaps.has(id)) {
      this.bitmaps.set(id, (async () => {
        const b = await this.getBytes(id);
        if (!b) throw new Error('Missing image data (' + id + ')');
        return createImageBitmap(new Blob([b as BlobPart]), { premultiplyAlpha: 'none' });
      })());
    }
    return this.bitmaps.get(id)!;
  }
  /** Copy of all known asset bytes (for project files). */
  async export(ids: string[]): Promise<Record<string, Uint8Array>> {
    const o: Record<string, Uint8Array> = {};
    for (const id of new Set(ids)) { const b = await this.getBytes(id); if (b) o[id] = b; }
    return o;
  }
}

// ---------- canvas helpers ----------
export function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
export function ctx2d(c: HTMLCanvasElement) { return c.getContext('2d', { willReadFrequently: true })!; }

export function scaleToFit(w: number, h: number, max: number): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Draw any image source into a new canvas of the given size. */
export function drawTo(src: CanvasImageSource, w: number, h: number) {
  const c = canvas(w, h); const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  return c;
}

export async function canvasToBytes(c: HTMLCanvasElement, type = 'image/png', quality?: number) {
  const blob = await new Promise<Blob>((r, j) => c.toBlob(b => b ? r(b) : j(new Error('encode failed')), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Mean RGB (0..1) of `img` weighted by mask alpha (or inverse). */
export function weightedMean(img: CanvasImageSource, mask: CanvasImageSource | null, invert: boolean): [number, number, number] {
  const S = 64;
  const a = ctx2d(drawTo(img, S, S)).getImageData(0, 0, S, S).data;
  const m = mask ? ctx2d(drawTo(mask, S, S)).getImageData(0, 0, S, S).data : null;
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let i = 0; i < S * S; i++) {
    let w = m ? m[i * 4 + 3] / 255 : 1;
    if (invert) w = 1 - w;
    r += a[i * 4] * w; g += a[i * 4 + 1] * w; b += a[i * 4 + 2] * w; wsum += w;
  }
  wsum = Math.max(wsum, 1e-3) * 255;
  return [r / wsum, g / wsum, b / wsum];
}
