# Acoustic Manifold Viewer

Acoustic Manifold Viewer is a browser-based local prototype for exploring audio and video as a 3D manifold. Upload a media file, extract short-time descriptors in the browser, project them into 3D, and inspect the result as a point cloud or trajectory.

## What it does

- Accepts `audio/*` and `video/*` files.
- Uses the Web Audio API to decode media in-browser.
- Extracts frame-level descriptors, including MFCCs, RMS, centroid, flatness, rolloff, spread, and zero crossing rate when available.
- Projects the feature vectors into 3D with PCA when possible, with a clean MFCC fallback.
- Renders the result with Three.js and orbit controls.
- Shows a moving playhead, a simple legend, status text, and a live debug panel.

## Folder layout

- `index.html` - app shell and UI markup
- `styles/style.css` - layout, theme, and responsive styling
- `js/app.js` - UI wiring and app state
- `js/audio.js` - media loading, decoding, and playback helpers
- `js/analysis.js` - feature extraction and frame analysis
- `js/projection.js` - PCA and projection helpers
- `js/scene.js` - Three.js scene setup and rendering
- `js/utils.js` - shared helpers

## Run it locally in VS Code

1. Open this folder in VS Code.
2. Start a simple static server from the project root:

```bash
python -m http.server 8000
```

3. Open `http://localhost:8000` in your browser.

If Python is not available, any static server works. No build step is required.

## Use it on desktop

1. Open the page in a browser.
2. Upload an audio or video file with the button or by dragging it into the drop zone.
3. Wait for decoding and analysis to complete.
4. Use play, pause, stop, the timeline, and the orbit controls to inspect the manifold.

## Use it on phone

1. Run the local server on your computer.
2. Find your computer’s local IP address.
3. Open `http://YOUR_LOCAL_IP:8000` from your phone on the same Wi-Fi network.
4. Upload media from the phone and use the touch-friendly controls.

## Current limitations

- This is a client-side MVP, so very large files may take time to analyze.
- Some video containers may decode audio more reliably than others depending on browser support.
- PCA is implemented in plain JavaScript and is practical for moderate feature counts, but not tuned for massive datasets.
- There is no persistent storage and no backend.

## Future upgrade ideas

- UMAP or t-SNE projection options.
- Live microphone input.
- Exporting the analyzed point cloud as JSON or CSV.
- Shader-based trails and glow.
- Playback-synchronized annotations.
- More advanced clustering and motif detection.

## Notes

- The app relies on CDN-hosted libraries for the first version, which keeps setup simple.
- If you are offline, make sure the external libraries are available locally before using the app.