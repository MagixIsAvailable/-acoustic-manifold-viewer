# Acoustic Manifold Viewer

Acoustic Manifold Viewer is a browser-based local prototype for exploring audio and video as a 3D manifold. Upload a media file, extract short-time descriptors in the browser, project them into 3D, and inspect the result as a point cloud or trajectory.

The app now also includes a Python notebook workflow for heavier PC-side analysis. You can extract richer features, compare projection methods like PCA, UMAP, and t-SNE, cluster frames, and export a compact JSON manifest for the viewer.

## What it does

- Accepts `audio/*` and `video/*` files.
- Uses the Web Audio API to decode media in-browser.
- Extracts frame-level descriptors, including MFCCs, RMS, centroid, flatness, rolloff, spread, and zero crossing rate when available.
- Projects the feature vectors into 3D with PCA when possible, with a clean MFCC fallback.
- Renders the result with Three.js and orbit controls.
- Shows a moving playhead, a simple legend, status text, and a live debug panel.
- Shows a moving playhead, a simple legend, status text, a live debug panel, and a visible processing bar with read / decode / analysis phases.
- Includes notebook files for local analysis on your PC.

## Folder layout

- `index.html` - app shell and UI markup
- `styles/style.css` - layout, theme, and responsive styling
- `js/app.js` - UI wiring and app state
- `js/audio.js` - media loading, decoding, and playback helpers
- `js/analysis.js` - feature extraction and frame analysis
- `js/projection.js` - PCA and projection helpers
- `js/scene.js` - Three.js scene setup and rendering
- `js/utils.js` - shared helpers
- `notebooks/01_feature_extraction.ipynb` - extract MFCCs and spectral descriptors locally
- `notebooks/02_projection_and_clustering.ipynb` - compare PCA, UMAP, and t-SNE, then cluster frames
- `notebooks/03_export_manifest.ipynb` - export browser-ready JSON for the viewer

## Python notebook workflow

Use the notebooks when you want the heavier processing done on your PC instead of in the browser.

Suggested order:

1. `notebooks/01_feature_extraction.ipynb` - load audio, extract MFCCs, RMS, centroid, flatness, rolloff, bandwidth, and zero crossing rate, then save CSV and JSON.
2. `notebooks/02_projection_and_clustering.ipynb` - standardize the features, compare PCA / UMAP / t-SNE, and cluster the result.
3. `notebooks/03_export_manifest.ipynb` - export a browser-friendly JSON manifest with projected points and frame metadata.

Recommended Python packages:

- `librosa`
- `numpy`
- `pandas`
- `matplotlib`
- `scikit-learn`
- `umap-learn` for UMAP support
- Optional later upgrades: `torch`, `tensorflow`, `openl3`, `transformers`, `scipy`

Example install command:

```bash
pip install librosa numpy pandas matplotlib scikit-learn umap-learn scipy
```

Notebook outputs are written to `analysis_output/`:

- `features.csv` and `features.json` from notebook 1
- `projection_clusters.csv` and `projection_clusters.json` from notebook 2
- `viewer_manifest.json` from notebook 3

## Run it locally in VS Code

1. Open this folder in VS Code.
1. Start a simple static server from the project root:

```bash
python -m http.server 8000
```

1. Open `http://localhost:8000` in your browser.

If Python is not available, any static server works. No build step is required.

## Run the notebooks in VS Code

1. Open the `notebooks/` folder in VS Code.
1. Select a Python kernel for the notebook.
1. Run the notebooks in order from 01 to 03.
1. Update the input file paths in the first cells to match your local audio or extracted video audio.

If your source is a video file, extract the audio track first with a local tool like `ffmpeg`, then point notebook 1 at the resulting `.wav` or `.mp3` file.

## Use it on desktop

1. Open the page in a browser.
1. Upload an audio or video file with the button or by dragging it into the drop zone.
1. Wait for decoding and analysis to complete.
1. Use play, pause, stop, the timeline, and the orbit controls to inspect the manifold.

## Use it on phone

1. Run the local server on your computer.
1. Find your computer’s local IP address.
1. Open `http://YOUR_LOCAL_IP:8000` from your phone on the same Wi-Fi network.
1. Upload media from the phone and use the touch-friendly controls.

## Current limitations

- This is a client-side MVP, so very large files may take time to analyze.
- Some video containers may decode audio more reliably than others depending on browser support.
- PCA is implemented in plain JavaScript and is practical for moderate feature counts, but not tuned for massive datasets.
- There is no persistent storage and no backend.
- The notebook workflow is intentionally file-based, so you need to point it at a local audio file and run the export steps manually.
- Pretrained embedding models and GPU-accelerated ML are not wired in yet, but the notebook structure leaves room for them.

## Future upgrade ideas

- UMAP or t-SNE projection options.
- Live microphone input.
- Exporting the analyzed point cloud as JSON or CSV.
- Shader-based trails and glow.
- Playback-synchronized annotations.
- More advanced clustering and motif detection.
- Add notebook 4 for pretrained audio embeddings such as YAMNet, OpenL3, or wav2vec2.
- Load the exported manifest JSON directly inside the browser viewer.
- Add annotation cells in the notebooks for manual labeling of interesting sound regions.

## Notes

- The app relies on CDN-hosted libraries for the first version, which keeps setup simple.
- If you are offline, make sure the external libraries are available locally before using the app.
- The notebooks are the place to do heavier PC-side analysis before sending a compact manifest back to the browser viewer.
- The browser now includes a visible progress bar that shows file read, decode, analysis, and projection phases.
