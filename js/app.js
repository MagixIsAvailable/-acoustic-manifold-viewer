import { loadMediaSession, attachMediaSource, cleanupMediaSession, ensureAudioContextRunning, startPlayback, pausePlayback, stopPlayback, seekPlayback } from './audio.js';
import { analyzeAudioBuffer, extractLiveFrame } from './analysis.js';
import { projectFrames, getColorDomain } from './projection.js';
import { createScene } from './scene.js';
import { binarySearchNearest, formatDuration, formatFrequency, formatNumber, fileLabel, clamp, createGradientStops } from './utils.js';

const elements = {
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  playButton: document.getElementById('playButton'),
  pauseButton: document.getElementById('pauseButton'),
  stopButton: document.getElementById('stopButton'),
  themeToggle: document.getElementById('themeToggle'),
  resetCameraButton: document.getElementById('resetCameraButton'),
  timeline: document.getElementById('timeline'),
  featureMode: document.getElementById('featureMode'),
  colorMode: document.getElementById('colorMode'),
  displayMode: document.getElementById('displayMode'),
  statusText: document.getElementById('statusText'),
  statusDot: document.getElementById('statusDot'),
  processPhase: document.getElementById('processPhase'),
  processPercent: document.getElementById('processPercent'),
  processEta: document.getElementById('processEta'),
  processFill: document.getElementById('processFill'),
  processTrack: document.querySelector('.process-track'),
  fileName: document.getElementById('fileName'),
  fileDuration: document.getElementById('fileDuration'),
  sampleRate: document.getElementById('sampleRate'),
  frameCount: document.getElementById('frameCount'),
  analysisNote: document.getElementById('analysisNote'),
  timeReadout: document.getElementById('timeReadout'),
  modeTag: document.getElementById('modeTag'),
  frameTag: document.getElementById('frameTag'),
  debugPanel: document.getElementById('debugPanel'),
  previewWrap: document.getElementById('previewWrap'),
  legendLabel: document.getElementById('legendLabel'),
  legendRange: document.getElementById('legendRange'),
  legendBar: document.getElementById('legendBar'),
  sceneContainer: document.getElementById('sceneContainer'),
};

const scene = createScene(elements.sceneContainer);

const state = {
  session: null,
  analysis: null,
  projected: null,
  currentTheme: 'dark',
  colorMode: elements.colorMode.value,
  featureMode: elements.featureMode.value,
  displayMode: elements.displayMode.value,
  liveMode: false,
  liveFrames: [],
  liveAnimationFrame: null,
  isDragging: false,
};

function setStatus(message, kind = 'info') {
  elements.statusText.textContent = message;
  elements.statusDot.style.background = kind === 'error' ? 'var(--danger)' : 'var(--accent)';
  elements.statusDot.style.boxShadow = kind === 'error'
    ? '0 0 0 6px rgba(238, 141, 141, 0.16)'
    : '0 0 0 6px rgba(134, 215, 203, 0.14)';
}

function setProcessProgress(percent, phase = null, eta = null) {
  const safePercent = clamp(percent, 0, 100);
  if (elements.processFill) {
    elements.processFill.style.width = `${safePercent}%`;
  }

  if (elements.processTrack) {
    elements.processTrack.setAttribute('aria-valuenow', String(Math.round(safePercent)));
  }

  if (elements.processPercent) {
    elements.processPercent.textContent = `${Math.round(safePercent)}%`;
  }

  if (phase) {
    elements.processPhase.textContent = phase;
  }

  if (eta) {
    elements.processEta.textContent = eta;
  }
}

function setProcessState(phase, percent, eta = null) {
  setProcessProgress(percent, phase, eta);
}

function estimateEta(startTime, percent) {
  if (percent <= 0.5) {
    return 'Calculating...';
  }

  const elapsed = performance.now() - startTime;
  const remaining = elapsed * ((100 - percent) / Math.max(percent, 1e-9));
  if (!Number.isFinite(remaining)) {
    return 'Calculating...';
  }

  if (remaining < 1000) {
    return 'Less than 1s left';
  }

  return `${Math.ceil(remaining / 1000)}s left`;
}

function setInfo(file, analysis = null) {
  elements.fileName.textContent = fileLabel(file);
  elements.fileDuration.textContent = formatDuration(analysis?.summary?.duration ?? state.session?.duration ?? 0);
  elements.sampleRate.textContent = `${Math.round(analysis?.summary?.sampleRate ?? state.session?.sampleRate ?? 0)} Hz`;
  elements.frameCount.textContent = analysis?.summary?.sampledFrames
    ? `${analysis.summary.sampledFrames} analyzed / ${analysis.summary.estimatedFrames} estimated`
    : '-';
}

function setNote(message, isError = false) {
  elements.analysisNote.textContent = message;
  elements.analysisNote.classList.toggle('error', isError);
}

function setLegend(colorMode, points) {
  const domain = getColorDomain(points, colorMode);
  const labels = {
    time: 'Time',
    rms: 'RMS',
    centroid: 'Spectral centroid',
    flatness: 'Spectral flatness',
    rolloff: 'Spectral rolloff',
  };

  elements.legendLabel.textContent = labels[colorMode] ?? 'Value';

  if (colorMode === 'time') {
    elements.legendRange.textContent = `${formatDuration(domain[0])} - ${formatDuration(domain[1])}`;
  } else if (colorMode === 'centroid' || colorMode === 'rolloff') {
    elements.legendRange.textContent = `${formatFrequency(domain[0])} - ${formatFrequency(domain[1])}`;
  } else {
    elements.legendRange.textContent = `${formatNumber(domain[0], 3)} - ${formatNumber(domain[1], 3)}`;
  }

  const colorStops = {
    time: ['#0d2c48', '#4f8d90', '#85d7cb', '#d6c17d'],
    rms: ['#102035', '#31647e', '#7bd7c3', '#f0d77b'],
    centroid: ['#152738', '#4d6b84', '#82c2ce', '#f2d481'],
    flatness: ['#13222f', '#37606e', '#73b3ad', '#f0c36f'],
    rolloff: ['#102035', '#35798e', '#8dd0ca', '#f3dc7c'],
  };

  const stops = colorStops[colorMode] ?? colorStops.time;
  elements.legendBar.style.background = createGradientStops(stops[0], stops[2] ?? stops[1], stops[stops.length - 1]);
}

function updateDebugPanel(point, index) {
  if (!point) {
    elements.debugPanel.textContent = 'No frame selected.';
    return;
  }

  elements.debugPanel.textContent = [
    `frame: ${index + 1}`,
    `time: ${formatDuration(point.time)}`,
    `projection: (${formatNumber(point.x, 3)}, ${formatNumber(point.y, 3)}, ${formatNumber(point.z, 3)})`,
    `rms: ${formatNumber(point.rms, 5)}`,
    `centroid: ${formatFrequency(point.centroid)}`,
    `dominant frequency: ${formatFrequency(point.dominantFrequency)}`,
    `flatness: ${formatNumber(point.flatness, 5)}`,
    `rolloff: ${formatFrequency(point.rolloff)}`,
    `spread: ${formatNumber(point.spread, 5)}`,
    `zcr: ${formatNumber(point.zcr, 5)}`,
    `mfcc: ${point.mfcc?.slice(0, 13).map((value) => formatNumber(value, 4)).join(', ') ?? '-'}`,
  ].join('\n');
}

function updateTransport(time) {
  const duration = state.analysis?.summary?.duration ?? state.session?.duration ?? 0;

  if (duration > 0 && !state.isDragging) {
    elements.timeline.value = String(clamp((time / duration) * 100, 0, 100));
  }

  elements.timeReadout.textContent = `${formatDuration(time)} / ${formatDuration(duration)}`;

  const frames = state.projected?.points ?? state.analysis?.frames ?? state.liveFrames;
  if (!frames.length) {
    return;
  }

  const index = binarySearchNearest(frames, time, (frame) => frame.time);
  const point = frames[clamp(index, 0, frames.length - 1)];
  if (!point) {
    return;
  }

  const playhead = scene.setPlayhead(time);
  const effectiveIndex = playhead?.index ?? index;
  elements.frameTag.textContent = `Frame ${effectiveIndex + 1}`;
  updateDebugPanel(point, effectiveIndex);
}

function stopLiveAnalysisLoop() {
  if (state.liveAnimationFrame) {
    cancelAnimationFrame(state.liveAnimationFrame);
    state.liveAnimationFrame = null;
  }
}

function renderProjectedFrames(sourceFrames) {
  state.projected = projectFrames(sourceFrames, state.featureMode);
  scene.setDataset(state.projected.points, { colorMode: state.colorMode, displayMode: state.displayMode });
  setLegend(state.colorMode, state.projected.points);
  updateTransport(state.session?.mediaElement?.currentTime ?? 0);
}

function startLiveAnalysisLoop() {
  stopLiveAnalysisLoop();

  const tick = () => {
    if (!state.session?.analyserNode || !state.session?.mediaElement) {
      state.liveAnimationFrame = requestAnimationFrame(tick);
      return;
    }

    if (!state.session.mediaElement.paused && !state.session.mediaElement.ended) {
      const liveFeature = extractLiveFrame(state.session.analyserNode, state.session.audioContext.sampleRate);

      if (liveFeature) {
        const time = state.session.mediaElement.currentTime;
        const liveFrame = {
          index: state.liveFrames.length,
          time,
          duration: state.session.analyserNode.fftSize / state.session.audioContext.sampleRate,
          sampleRate: state.session.audioContext.sampleRate,
          frameSize: state.session.analyserNode.fftSize,
          hopSize: state.session.analyserNode.fftSize / 2,
          rms: liveFeature.rms,
          centroid: liveFeature.spectralCentroid,
          flatness: liveFeature.spectralFlatness,
          rolloff: liveFeature.spectralRolloff,
          spread: liveFeature.spectralSpread,
          zcr: liveFeature.zcr,
          dominantFrequency: liveFeature.dominantFrequency,
          mfcc: liveFeature.mfcc,
          features: liveFeature,
        };

        const existing = state.liveFrames[state.liveFrames.length - 1];
        if (!existing || Math.abs(existing.time - liveFrame.time) >= 0.02) {
          state.liveFrames.push(liveFrame);
          renderProjectedFrames(state.liveFrames);
          elements.frameCount.textContent = `${state.liveFrames.length} live frames`;
          elements.modeTag.textContent = 'Live analysis';
          setStatus('Live analysis running.');
        }
      }
    }

    state.liveAnimationFrame = requestAnimationFrame(tick);
  };

  tick();
}

function resetAnalysisState() {
  stopLiveAnalysisLoop();
  state.liveFrames = [];
  state.liveMode = false;
  state.projected = null;
  state.analysis = null;
  elements.debugPanel.textContent = 'No analysis yet.';
  elements.frameTag.textContent = 'Frame 0';
  elements.modeTag.textContent = 'Ready';
  elements.timeline.value = '0';
  elements.timeReadout.textContent = '0:00 / 0:00';
  elements.analysisNote.textContent = '';
  elements.analysisNote.classList.remove('error');
  scene.clearData();
}

function mountPreview(session) {
  elements.previewWrap.replaceChildren();

  if (session.kind === 'video') {
    session.mediaElement.className = 'media-preview';
    session.mediaElement.controls = true;
    session.mediaElement.playsInline = true;
    session.mediaElement.autoplay = false;
    elements.previewWrap.appendChild(session.mediaElement);
  } else {
    const audioHint = document.createElement('p');
    audioHint.className = 'preview-hint';
    audioHint.textContent = 'Audio playback is available through the transport controls. No video preview for this file.';
    elements.previewWrap.appendChild(audioHint);
  }
}

async function handleFile(file) {
  if (!file) {
    return;
  }

  resetAnalysisState();
  setStatus(`File loaded: ${fileLabel(file)}`);
  setNote('Decoding media in browser...');

  if (state.session) {
    cleanupMediaSession(state.session);
  }

  try {
    const progressStart = performance.now();
    setProcessState('Reading file', 2, 'Starting...');

    const session = await loadMediaSession(file, {
      onReadProgress: (loaded, total) => {
        const readPercent = total > 0 ? (loaded / total) * 35 : 0;
        setProcessState('Reading file', readPercent, estimateEta(progressStart, readPercent));
      },
    });
    state.session = session;
    mountPreview(session);
    attachMediaEvents();
    setInfo(file, null);
    setProcessState('Decoding media', 35, 'File read complete');

    if (file.size > 60 * 1024 * 1024) {
      setNote('Large file detected. Analysis may take a while, and very long media is down-sampled for responsiveness.');
    }

    if (session.decodedBuffer) {
      setStatus('Analyzing audio frames...');
      state.analysis = await analyzeAudioBuffer(session.decodedBuffer, {
        maxFrames: 8000,
        onProgress: (percent) => {
          const mapped = 35 + (percent * 60);
          setProcessState('Analyzing frames', mapped, estimateEta(progressStart, mapped));
        },
      });
      setProcessState('Projecting into 3D', 96, 'Almost done');
      renderProjectedFrames(state.analysis.frames);
      setInfo(file, state.analysis);
      setNote(state.analysis.warnings.join(' '));
      setStatus('Projection complete. Visualization ready.');
      elements.modeTag.textContent = session.kind === 'video' ? 'Video audio decoded' : 'Audio decoded';
      setProcessState('Ready', 100, 'Processing complete');
    } else {
      setStatus('Decode fallback: live analysis will run during playback.', 'info');
      state.liveMode = true;
      elements.modeTag.textContent = 'Live analysis';
      setNote('The browser could not fully decode this file container. Playback will still work, and features will accumulate while the media plays.');
      attachMediaSource(session);
      startLiveAnalysisLoop();
      setProcessState('Ready for playback', 100, 'Live mode');
    }

    setStatus('Rendering ready.');
  } catch (error) {
    setStatus('Could not load media.', 'error');
    setNote(`Error: ${error.message ?? error}`, true);
    elements.debugPanel.textContent = String(error?.stack ?? error?.message ?? error);
    setProcessState('Failed', 0, 'Check the error message');
  }
}

async function changeFeatureMode(nextMode) {
  state.featureMode = nextMode;

  const sourceFrames = state.liveMode ? state.liveFrames : state.analysis?.frames;
  if (sourceFrames?.length) {
    renderProjectedFrames(sourceFrames);
  }
}

function changeColorMode(nextMode) {
  state.colorMode = nextMode;
  scene.setColorMode(nextMode);
  const points = state.projected?.points ?? [];
  if (points.length) {
    setLegend(nextMode, points);
  }
}

function changeDisplayMode(nextMode) {
  state.displayMode = nextMode;
  scene.setDisplayMode(nextMode);
}

function toggleTheme() {
  state.currentTheme = state.currentTheme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = state.currentTheme;
  scene.applyTheme(state.currentTheme);
}

function connectTimeline() {
  elements.timeline.addEventListener('input', () => {
    state.isDragging = true;
    const duration = state.analysis?.summary?.duration ?? state.session?.duration ?? 0;
    const ratio = Number(elements.timeline.value) / 100;
    updateTransport(duration * ratio);
  });

  elements.timeline.addEventListener('change', () => {
    const duration = state.analysis?.summary?.duration ?? state.session?.duration ?? 0;
    const ratio = Number(elements.timeline.value) / 100;
    seekPlayback(state.session, duration * ratio);
    state.isDragging = false;
  });
}

function attachMediaEvents() {
  if (!state.session?.mediaElement) {
    return;
  }

  const mediaElement = state.session.mediaElement;
  mediaElement.addEventListener('timeupdate', () => updateTransport(mediaElement.currentTime));
  mediaElement.addEventListener('seeked', () => updateTransport(mediaElement.currentTime));
  mediaElement.addEventListener('ended', () => {
    setStatus('Playback ended.');
    elements.modeTag.textContent = state.liveMode ? 'Live analysis' : 'Ready';
  });
}

function addDropHandlers() {
  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, prevent, false);
  });

  elements.dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      handleFile(file);
    }
  });

  elements.dropZone.addEventListener('click', () => elements.fileInput.click());
  elements.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      elements.fileInput.click();
    }
  });
}

elements.fileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) {
    handleFile(file);
  }
});

elements.playButton.addEventListener('click', async () => {
  if (!state.session) {
    return;
  }

  try {
    await ensureAudioContextRunning(state.session.audioContext);

    if (state.liveMode) {
      attachMediaSource(state.session);
      startLiveAnalysisLoop();
    }

    await startPlayback(state.session);
    setStatus('Playback started.');
  } catch (error) {
    setStatus('Playback failed.', 'error');
    setNote(`Playback error: ${error.message ?? error}`, true);
  }
});

elements.pauseButton.addEventListener('click', () => {
  if (!state.session) {
    return;
  }

  pausePlayback(state.session);
  setStatus('Playback paused.');
});

elements.stopButton.addEventListener('click', () => {
  if (!state.session) {
    return;
  }

  stopPlayback(state.session);
  stopLiveAnalysisLoop();
  updateTransport(0);
  setStatus('Playback stopped.');
});

elements.themeToggle.addEventListener('click', toggleTheme);
elements.resetCameraButton.addEventListener('click', () => scene.resetCamera());
elements.featureMode.addEventListener('change', (event) => changeFeatureMode(event.target.value));
elements.colorMode.addEventListener('change', (event) => changeColorMode(event.target.value));
elements.displayMode.addEventListener('change', (event) => changeDisplayMode(event.target.value));

window.addEventListener('resize', () => scene.resize());
window.addEventListener('beforeunload', () => {
  cleanupMediaSession(state.session);
});

connectTimeline();
addDropHandlers();
scene.resize();
setLegend(state.colorMode, []);
setStatus('Waiting for a file.');
setNote('Upload a file to start the analysis pipeline.');
setProcessState('Idle', 0, 'Waiting for a file');
