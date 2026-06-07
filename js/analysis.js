const FEATURE_SET = [
  'mfcc',
  'rms',
  'spectralCentroid',
  'spectralFlatness',
  'spectralRolloff',
  'spectralSpread',
  'zcr',
  'amplitudeSpectrum',
];

function getMeyda() {
  return window.Meyda ?? null;
}

function safeFeatureArray(source, size = 13) {
  const values = Array.isArray(source) ? source.slice(0, size) : [];
  while (values.length < size) {
    values.push(0);
  }
  return values;
}

function fallbackMetrics(frame) {
  let sumSquares = 0;
  let zeroCrossings = 0;
  let previous = frame[0] ?? 0;

  for (let index = 0; index < frame.length; index += 1) {
    const sample = frame[index];
    sumSquares += sample * sample;
    if ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0)) {
      zeroCrossings += 1;
    }
    previous = sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(frame.length, 1));
  return {
    mfcc: new Array(13).fill(0),
    rms,
    spectralCentroid: 0,
    spectralFlatness: 0,
    spectralRolloff: 0,
    spectralSpread: 0,
    zcr: zeroCrossings / Math.max(frame.length - 1, 1),
    dominantFrequency: 0,
  };
}

function computePeakFrequency(amplitudeSpectrum, sampleRate, bufferSize) {
  if (!amplitudeSpectrum?.length) {
    return 0;
  }

  let peakIndex = 0;
  let peakValue = amplitudeSpectrum[0];

  for (let index = 1; index < amplitudeSpectrum.length; index += 1) {
    if (amplitudeSpectrum[index] > peakValue) {
      peakValue = amplitudeSpectrum[index];
      peakIndex = index;
    }
  }

  return (peakIndex * sampleRate) / bufferSize;
}

function extractFeatures(frame, sampleRate, bufferSize) {
  const Meyda = getMeyda();

  if (!Meyda?.extract) {
    return fallbackMetrics(frame);
  }

  const features = Meyda.extract(FEATURE_SET, frame, {
    sampleRate,
    bufferSize,
    numberOfMFCCCoefficients: 13,
  });

  const mfcc = safeFeatureArray(features?.mfcc, 13);
  const amplitudeSpectrum = features?.amplitudeSpectrum ?? [];

  return {
    mfcc,
    rms: features?.rms ?? 0,
    spectralCentroid: features?.spectralCentroid ?? 0,
    spectralFlatness: features?.spectralFlatness ?? 0,
    spectralRolloff: features?.spectralRolloff ?? 0,
    spectralSpread: features?.spectralSpread ?? 0,
    zcr: features?.zcr ?? 0,
    dominantFrequency: computePeakFrequency(amplitudeSpectrum, sampleRate, bufferSize) || features?.spectralCentroid || 0,
  };
}

function combineChannels(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  if (channelCount === 1) {
    return audioBuffer.getChannelData(0).slice(0);
  }

  const mono = new Float32Array(length);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      mono[index] += channelData[index] / channelCount;
    }
  }

  return mono;
}

export async function analyzeAudioBuffer(audioBuffer, options = {}) {
  const frameSize = options.frameSize ?? 2048;
  const hopSize = options.hopSize ?? 1024;
  const maxFrames = options.maxFrames ?? 8000;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const mono = combineChannels(audioBuffer);
  const estimatedFrames = Math.max(1, Math.floor((mono.length - frameSize) / hopSize) + 1);
  const stride = Math.max(1, Math.ceil(estimatedFrames / maxFrames));
  const effectiveHop = hopSize * stride;
  const sampledFrames = [];
  let frameIndex = 0;

  for (let start = 0; start + frameSize <= mono.length; start += effectiveHop, frameIndex += 1) {
    const frame = mono.subarray(start, start + frameSize);
    const metrics = extractFeatures(frame, audioBuffer.sampleRate, frameSize);

    sampledFrames.push({
      index: frameIndex,
      sourceIndex: start,
      time: start / audioBuffer.sampleRate,
      duration: frameSize / audioBuffer.sampleRate,
      sampleRate: audioBuffer.sampleRate,
      frameSize,
      hopSize: effectiveHop,
      rms: metrics.rms,
      centroid: metrics.spectralCentroid,
      flatness: metrics.spectralFlatness,
      rolloff: metrics.spectralRolloff,
      spread: metrics.spectralSpread,
      zcr: metrics.zcr,
      dominantFrequency: metrics.dominantFrequency,
      mfcc: metrics.mfcc,
      features: metrics,
    });

    if (onProgress) {
      onProgress(0.55 + ((frameIndex + 1) / Math.max(estimatedFrames / stride, 1)) * 0.40);
    }

    if (frameIndex % 32 === 0) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  const warnings = [];

  if (stride > 1) {
    warnings.push(`Large file detected, so analysis was down-sampled to every ${stride} frames for responsiveness.`);
  }

  return {
    frames: sampledFrames,
    summary: {
      frameSize,
      hopSize: effectiveHop,
      estimatedFrames,
      sampledFrames: sampledFrames.length,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      stride,
    },
    warnings,
  };
}

export function extractLiveFrame(analyserNode, sampleRate) {
  if (!analyserNode) {
    return null;
  }

  const bufferSize = analyserNode.fftSize;
  const frame = new Float32Array(bufferSize);
  analyserNode.getFloatTimeDomainData(frame);
  return extractFeatures(frame, sampleRate, bufferSize);
}