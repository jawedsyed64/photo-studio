# Photo Studio

A modern Windows desktop photo editor. It has GPU-accelerated, non-destructive editing, professional colour tools and presets, with a simple Beginner mode and a full Professional mode.

> **Status:** Phase 1 (Core Photo Editor) and Phase 2 (Professional Color Editing) are working. AI tools, retouching, creative effects, layers and batch editing are shown in the app as **"Soon / Phase N"** and do not run yet.

## Download

Every push to `main` builds the app on GitHub:

1. Open the **Actions** tab → latest **Build Windows app** run.
2. Download the **PhotoStudio-Windows** artifact (zip).
3. Inside: `PhotoStudio-Setup-x.y.z.exe` (installer) and `PhotoStudio-Portable-x.y.z.exe` (no install needed).

Windows may show a SmartScreen warning because the app is not code-signed. Click **More info → Run anyway**.

## What works now

| Area | Features |
|---|---|
| Dashboard | New project, Open photo, Open project, Import photos, recent gallery with thumbnails and dates, drag & drop, search |
| Basic adjustments | Exposure, Brightness, Contrast, Highlights, Shadows, Whites, Blacks, Temperature, Tint, Vibrance, Saturation, Texture, Clarity, Dehaze, Vignette (+ midpoint), Grain (+ size), **Auto enhance** |
| Curves | RGB composite + Red / Green / Blue channels, add / drag / remove points, input-output values, histogram behind the curve, curve presets |
| HSL | Hue / Saturation / Luminance for Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta |
| Colour grading | Shadows / Midtones / Highlights / Global colour wheels, luminance, blending, balance, split-toning presets |
| Detail & optics | Sharpening (amount, radius, detail, masking), luminance & colour noise reduction, lens distortion, chromatic aberration, vertical / horizontal perspective |
| Crop & transform | Free, Original, 1:1, 4:5, 3:2, 16:9, 9:16, 2:3, 5:4, custom pixel size, rotate, straighten, flip H/V, canvas expansion (colour or transparent), print size at any dpi |
| Presets | 21 built-in presets in 13 categories, live hover preview, real thumbnails of your photo, intensity 0–150 %, save / rename / delete / import / export your own |
| Compare | Draggable before/after split, hold **Original** (or `\`) to see the unedited photo |
| History | Unlimited undo / redo (200 steps), clickable history panel, edit stack with "preview without" and per-group reset |
| Projects | `.pstudio` project files (original photo embedded, all edits editable later), autosave, crash recovery |
| Import | JPEG, PNG, BMP, WebP, GIF, TIFF (uncompressed / LZW / PackBits, 8 & 16-bit) |
| Export | JPEG, PNG (transparent), WebP, TIFF; quality, original / long edge / custom / percent size, file size estimate, output folder, file naming |
| Interface | Windows 11 style, dark & light themes, Beginner & Professional modes, tooltips, zoom (wheel, 100 %, fit, full screen), pan |

Everything above works **offline**. RAW camera files and EXIF metadata copying are not supported yet.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Ctrl+O / Ctrl+S / Ctrl+Shift+S | Open photo / Save project / Save project as |
| Ctrl+E | Export |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy / paste edit settings to another photo |
| C | Crop tool |
| Y | Before / after split |
| `\` (hold) | Show original |
| F / 0 / + / − | Fit / 100 % / zoom in / zoom out |
| Double-click a slider | Reset it |

## Architecture

```
electron/main.js       Main process: windows, file dialogs, file I/O, settings store, encrypted API keys, crash handling
electron/preload.js    Safe bridge (contextIsolation, sandbox) exposed as window.photoStudio
src/engine/            Rendering engine (no UI)
  Renderer.ts          WebGL2 pipeline: source texture + blur pyramids → single main shader → screen or export
  shaders.ts           GLSL: geometry (crop/rotate/straighten/perspective/lens), noise reduction, sharpening,
                       clarity, dehaze, white balance, exposure, tone, HSL, curves LUT, grading, vignette, grain
  curves.ts            Monotone cubic spline → 256-entry LUT
  codecs.ts            TIFF decode/encode, export encoding, resizing, thumbnails
src/state/             Edit state model (non-destructive), presets
src/ui/                React UI: dashboard, editor, panels, dialogs
```

**Non-destructive by design:** the original photo is uploaded to the GPU once and never modified. Every edit is a small JSON *edit state*. The screen preview and the full-resolution export are both rendered from that state. Undo/redo, presets, copy/paste settings and project files are all just edit states.

**Performance:** all pixel work runs on the GPU. When zoomed, only the visible part of the photo is rendered. Blur pyramids (for clarity, dehaze, sharpening and noise reduction) are computed once per photo. Photos larger than the graphics card's texture limit (usually 16384 px) are scaled down on import, and the app tells you when that happens.

## Build it yourself

```bash
npm install
npm run dev        # build and run
npm run dist       # create Windows installer + portable exe in release/
```

## Roadmap

- **Phase 3 – AI editing:** background removal and upscaling (offline ONNX models), object removal, background replacement, AI enhancement. Generated backgrounds and portrait/art styles will use an online API (Replicate; key stored encrypted via Settings).
- **Phase 4 – Retouching & restoration:** skin smoothing, blemish removal, healing brush, clone stamp, scratch repair, colourisation.
- **Phase 5 – Creative studio:** film/retro effects, light leaks, double exposure, text, stickers, frames.
- **Phase 6 – Productivity:** layers & masks, blending modes, batch editing, AI editing assistant, RAW import.
