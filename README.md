# Bleed → cardboard sharmanka

Static browser rhythm editor for turning a clicked percussion loop into a printable cardboard circle. It is intentionally onset-based: each active grid cell becomes a hole or mark on a concentric ring.

## Run locally

No build step is required. From this directory run:

```text
python -m http.server 4173
```

Then open `http://localhost:4173/`. The ES module app needs HTTP; opening `index.html` directly may be blocked by browser module security.

Tests use only Node's built-in test runner:

```text
npm test
```

## Use the editor

1. Set the meter, grid, loop length and BPM. BPM affects preview only; it does not change circle geometry.
2. Rename voices and click cells in the rhythm roll. A second click removes an onset.
3. Choose circle diameter, A4/A3 paper, ring geometry, start angle, direction and holes/marks mode.
4. Click **Generate circle**, then download SVG or PDF.
5. Print the PDF at **Actual size / 100%**, never “Fit to page”. Measure the included 100 mm check line before cutting cardboard.

The default loop uses two voices and a 190 mm circle. Auto length closes the selected musical bar and grid together using an LCM calculation; this matters for triplets, dotted grids and shifted patterns.

## GitHub Pages

This repository is a plain static site. In GitHub, open **Settings → Pages**, choose **Deploy from a branch**, select the default branch and the `/ (root)` folder, then save. GitHub will publish the site at:

`https://digitdrator.github.io/bleed-sharmanka/`

All app paths are relative, so the site also works when served from the repository subpath.

## Project scope

MVP includes rhythm grid editing, Web Audio click preview, JSON save/load, SVG export and a client-side vector PDF with real millimetres, a 100 mm check line and print instruction. MIDI import/export, pitch editing and motor mechanics are intentionally deferred. Use your own or legally obtained rhythm input; do not add a full copyrighted transcription to the repository.
