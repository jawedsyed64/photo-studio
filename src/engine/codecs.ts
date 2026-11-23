// Image decoding / encoding helpers.
// JPEG, PNG, BMP, WebP, GIF are decoded by Chromium. TIFF is decoded here
// (baseline: uncompressed, PackBits, LZW; 8/16-bit; grey/RGB/RGBA).

export const IMPORT_EXT = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'tif', 'tiff'];
export const RAW_EXT = ['cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw'];

export function extOf(name: string) { return (name.split('.').pop() || '').toLowerCase(); }

export interface LoadedImage { image: ImageBitmap | HTMLCanvasElement; width: number; height: number; scaledFrom?: [number, number] }

export async function decodeImage(bytes: Uint8Array, name: string, maxSize: number): Promise<LoadedImage> {
  const ext = extOf(name);
  if (RAW_EXT.includes(ext)) throw new Error(`RAW camera files (.${ext}) are planned for a later phase. Please convert to JPEG/TIFF first.`);
  let bmp: ImageBitmap;
  if (ext === 'tif' || ext === 'tiff') {
    const id = decodeTiff(bytes);
    bmp = await createImageBitmap(id, { premultiplyAlpha: 'none' });
  } else {
    const blob = new Blob([bytes as BlobPart]);
    try {
      bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', imageOrientation: 'from-image' } as any);
    } catch {
      throw new Error(`Could not read "${name}". The file may be damaged or in an unsupported format.`);
    }
  }
  const W = bmp.width, H = bmp.height;
  if (Math.max(W, H) <= maxSize) return { image: bmp, width: W, height: H };
  const k = maxSize / Math.max(W, H);
  const w = Math.round(W * k), h = Math.round(H * k);
  const scaled = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none' });
  bmp.close();
  return { image: scaled, width: w, height: h, scaledFrom: [W, H] };
}

// ---------------- TIFF decode ----------------
export function decodeTiff(u8: Uint8Array): ImageData {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const le = dv.getUint16(0) === 0x4949;
  if (!le && dv.getUint16(0) !== 0x4d4d) throw new Error('Not a TIFF file');
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error('BigTIFF is not supported');
  const ifd = u32(4);
  const n = u16(ifd);
  const tags: Record<number, number[]> = {};
  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 16: 8 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const sz = (typeSize[type] || 1) * count;
    const off = sz <= 4 ? e + 8 : u32(e + 8);
    const vals: number[] = [];
    for (let k = 0; k < Math.min(count, 100000); k++) {
      if (type === 3) vals.push(u16(off + k * 2));
      else if (type === 4) vals.push(u32(off + k * 4));
      else vals.push(u8[off + k]);
    }
    tags[tag] = vals;
  }
  const W = tags[256][0], H = tags[257][0];
  const bps = (tags[258] || [1])[0];
  const comp = (tags[259] || [1])[0];
  const photo = (tags[262] || [2])[0];
  const spp = (tags[277] || [1])[0];
  const planar = (tags[284] || [1])[0];
  const predictor = (tags[317] || [1])[0];
  const rps = (tags[278] || [H])[0];
  const offs = tags[273], counts = tags[279];
  if (tags[322]) throw new Error('Tiled TIFF files are not supported yet');
  if (planar !== 1) throw new Error('Planar TIFF files are not supported yet');
  if (bps !== 8 && bps !== 16) throw new Error(`${bps}-bit TIFF is not supported`);
  if (![1, 5, 32773].includes(comp)) throw new Error('This TIFF compression type is not supported yet (try uncompressed or LZW)');
  const bpp = spp * (bps / 8);
  const rowBytes = W * bpp;
  const raw = new Uint8Array(rowBytes * H);
  let pos = 0;
  for (let s = 0; s < offs.length; s++) {
    const data = u8.subarray(offs[s], offs[s] + counts[s]);
    let strip: Uint8Array;
    const rows = Math.min(rps, H - s * rps);
    if (comp === 1) strip = data;
    else if (comp === 32773) strip = unpackBits(data, rows * rowBytes);
    else strip = lzwDecode(data, rows * rowBytes);
    if (predictor === 2 && bps === 8) {
      for (let r = 0; r < rows; r++) for (let x = spp; x < rowBytes; x++) strip[r * rowBytes + x] = (strip[r * rowBytes + x] + strip[r * rowBytes + x - spp]) & 255;
    }
    raw.set(strip.subarray(0, Math.min(strip.length, raw.length - pos)), pos);
    pos += rows * rowBytes;
  }
  const out = new ImageData(W, H);
  const d = out.data;
  const get = (i: number) => (bps === 8 ? raw[i] : (le ? raw[i * 2 + 1] : raw[i * 2]));
  for (let p = 0; p < W * H; p++) {
    const b = p * spp;
    let r: number, g: number, bl: number, a = 255;
    if (spp >= 3) { r = get(b); g = get(b + 1); bl = get(b + 2); if (spp >= 4) a = get(b + 3); }
    else { r = g = bl = get(b); if (photo === 0) r = g = bl = 255 - r; if (spp === 2) a = get(b + 1); }
    d[p * 4] = r; d[p * 4 + 1] = g; d[p * 4 + 2] = bl; d[p * 4 + 3] = a;
  }
  return out;
}

function unpackBits(src: Uint8Array, outLen: number) {
  const out = new Uint8Array(outLen);
  let i = 0, o = 0;
  while (i < src.length && o < outLen) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) { for (let k = 0; k <= n && o < outLen; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < outLen; k++) out[o++] = v; }
  }
  return out;
}

function lzwDecode(src: Uint8Array, outLen: number) {
  const out = new Uint8Array(outLen);
  let o = 0, bitPos = 0;
  let dict: Uint8Array[] = [];
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push(new Uint8Array([i])); dict.push(new Uint8Array(0), new Uint8Array(0)); };
  reset();
  let width = 9, prev: Uint8Array | null = null;
  const read = () => {
    let v = 0;
    for (let k = 0; k < width; k++) {
      const byte = src[(bitPos >> 3)] ?? 0;
      v = (v << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
      bitPos++;
    }
    return v;
  };
  while (o < outLen && (bitPos >> 3) < src.length) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); width = 9; prev = null; continue; }
    let entry: Uint8Array;
    if (code < dict.length) entry = dict[code];
    else if (prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
    else break;
    for (let k = 0; k < entry.length && o < outLen; k++) out[o++] = entry[k];
    if (prev) { const ne = new Uint8Array(prev.length + 1); ne.set(prev); ne[prev.length] = entry[0]; dict.push(ne); }
    prev = entry;
    if (dict.length + 1 >= (1 << width) && width < 12) width++;
  }
  return out;
}

// ---------------- TIFF encode (uncompressed, 8-bit RGB/RGBA) ----------------
export function encodeTiff(img: ImageData, keepAlpha: boolean): Uint8Array {
  const W = img.width, H = img.height, spp = keepAlpha ? 4 : 3;
  const dataLen = W * H * spp;
  const entries: [number, number, number, number[]][] = [];
  // tag, type, count, values
  const headerSize = 8;
  const nTags = keepAlpha ? 12 : 11;
  const ifdSize = 2 + nTags * 12 + 4;
  const bpsOff = headerSize + ifdSize;
  const resOff = bpsOff + spp * 2;
  const dataOff = resOff + 16;
  entries.push([256, 4, 1, [W]], [257, 4, 1, [H]], [258, 3, spp, []], [259, 3, 1, [1]], [262, 3, 1, [2]],
    [273, 4, 1, [dataOff]], [277, 3, 1, [spp]], [278, 4, 1, [H]], [279, 4, 1, [dataLen]], [282, 5, 1, []], [283, 5, 1, []]);
  if (keepAlpha) entries.push([338, 3, 1, [2]]);
  entries.sort((a, b) => a[0] - b[0]);
  const buf = new Uint8Array(dataOff + dataLen);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49; buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, headerSize, true);
  dv.setUint16(headerSize, entries.length, true);
  entries.forEach(([tag, type, count, vals], i) => {
    const e = headerSize + 2 + i * 12;
    dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
    if (tag === 258) dv.setUint32(e + 8, bpsOff, true);
    else if (tag === 282) dv.setUint32(e + 8, resOff, true);
    else if (tag === 283) dv.setUint32(e + 8, resOff + 8, true);
    else if (type === 3) dv.setUint16(e + 8, vals[0], true);
    else dv.setUint32(e + 8, vals[0], true);
  });
  dv.setUint32(headerSize + 2 + entries.length * 12, 0, true);
  for (let k = 0; k < spp; k++) dv.setUint16(bpsOff + k * 2, 8, true);
  dv.setUint32(resOff, 300, true); dv.setUint32(resOff + 4, 1, true);
  dv.setUint32(resOff + 8, 300, true); dv.setUint32(resOff + 12, 1, true);
  const s = img.data;
  let o = dataOff;
  for (let p = 0; p < W * H; p++) {
    buf[o++] = s[p * 4]; buf[o++] = s[p * 4 + 1]; buf[o++] = s[p * 4 + 2];
    if (keepAlpha) buf[o++] = s[p * 4 + 3];
  }
  return buf;
}

export async function encodeImage(img: ImageData, format: 'jpeg' | 'png' | 'webp' | 'tiff', quality: number): Promise<Uint8Array> {
  if (format === 'tiff') {
    let alpha = false;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 255) { alpha = true; break; }
    return encodeTiff(img, alpha);
  }
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d')!;
  if (format === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, img.width, img.height); const t = new OffscreenCanvas(img.width, img.height); t.getContext('2d')!.putImageData(img, 0, 0); ctx.drawImage(t, 0, 0); }
  else ctx.putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/' + format, quality: quality / 100 });
  return new Uint8Array(await blob.arrayBuffer());
}

/** High quality resize via 2D canvas (stepwise halving for big reductions). */
export async function resizeImageData(img: ImageData, w: number, h: number): Promise<ImageData> {
  if (w === img.width && h === img.height) return img;
  const bmp = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}

export async function thumbnailDataUrl(img: ImageData, size = 320): Promise<string> {
  const k = Math.min(1, size / Math.max(img.width, img.height));
  const small = await resizeImageData(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  const c = document.createElement('canvas');
  c.width = small.width; c.height = small.height;
  c.getContext('2d')!.putImageData(small, 0, 0);
  return c.toDataURL('image/jpeg', 0.8);
}
