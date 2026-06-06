import { fileLabel, isVideoFile } from './utils.js';

const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

function decodeBuffer(audioContext, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const result = audioContext.decodeAudioData(arrayBuffer, resolve, reject);

    if (result && typeof result.then === 'function') {
      result.then(resolve).catch(reject);
    }
  });
}

export async function loadMediaSession(file) {
  const objectUrl = URL.createObjectURL(file);
  const mediaElement = document.createElement(isVideoFile(file) ? 'video' : 'audio');

  mediaElement.src = objectUrl;
  mediaElement.preload = 'metadata';
  mediaElement.playsInline = true;
  mediaElement.controls = false;

  const audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
  const arrayBuffer = await file.arrayBuffer();

  let decodedBuffer = null;
  let decodeError = null;

  try {
    decodedBuffer = await decodeBuffer(audioContext, arrayBuffer.slice(0));
  } catch (error) {
    decodeError = error;
  }

  return {
    file,
    fileName: fileLabel(file),
    kind: isVideoFile(file) ? 'video' : 'audio',
    objectUrl,
    mediaElement,
    audioContext,
    decodedBuffer,
    decodeError,
    duration: decodedBuffer?.duration ?? (Number.isFinite(mediaElement.duration) ? mediaElement.duration : 0),
    sampleRate: decodedBuffer?.sampleRate ?? audioContext.sampleRate,
    channelCount: decodedBuffer?.numberOfChannels ?? 1,
  };
}

export function attachMediaSource(session, destination = null) {
  if (!session?.mediaElement || !session?.audioContext) {
    return null;
  }

  if (session.sourceNode) {
    return session.sourceNode;
  }

  const sourceNode = session.audioContext.createMediaElementSource(session.mediaElement);
  const analyserNode = session.audioContext.createAnalyser();
  analyserNode.fftSize = 2048;
  analyserNode.smoothingTimeConstant = 0.7;

  sourceNode.connect(analyserNode);
  analyserNode.connect(destination ?? session.audioContext.destination);

  session.sourceNode = sourceNode;
  session.analyserNode = analyserNode;

  return sourceNode;
}

export function disconnectMediaSource(session) {
  if (!session) {
    return;
  }

  try {
    session.sourceNode?.disconnect();
  } catch {
    /* ignore cleanup errors */
  }

  try {
    session.analyserNode?.disconnect();
  } catch {
    /* ignore cleanup errors */
  }

  session.sourceNode = null;
  session.analyserNode = null;
}

export async function ensureAudioContextRunning(audioContext) {
  if (audioContext.state !== 'running') {
    await audioContext.resume();
  }
}

export async function startPlayback(session) {
  if (!session) {
    return;
  }

  await ensureAudioContextRunning(session.audioContext);
  await session.mediaElement.play();
}

export function pausePlayback(session) {
  session?.mediaElement?.pause();
}

export function stopPlayback(session) {
  if (!session?.mediaElement) {
    return;
  }

  session.mediaElement.pause();
  session.mediaElement.currentTime = 0;
}

export function seekPlayback(session, time) {
  if (!session?.mediaElement || !Number.isFinite(time)) {
    return;
  }

  session.mediaElement.currentTime = Math.max(0, time);
}

export function cleanupMediaSession(session) {
  if (!session) {
    return;
  }

  disconnectMediaSource(session);

  try {
    session.mediaElement?.pause?.();
  } catch {
    /* ignore cleanup errors */
  }

  try {
    session.mediaElement?.removeAttribute('src');
    session.mediaElement?.load?.();
  } catch {
    /* ignore cleanup errors */
  }

  try {
    session.audioContext?.close?.();
  } catch {
    /* ignore cleanup errors */
  }

  if (session.objectUrl) {
    URL.revokeObjectURL(session.objectUrl);
  }
}