export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

export function mapRange(value, inputMin, inputMax, outputMin, outputMax) {
  if (inputMax === inputMin) {
    return outputMin;
  }

  const ratio = (value - inputMin) / (inputMax - inputMin);
  return lerp(outputMin, outputMax, clamp(ratio, 0, 1));
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return '0.00';
  }

  return value.toFixed(digits);
}

export function formatFrequency(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(2)} kHz`;
  }

  return `${value.toFixed(0)} Hz`;
}

export function fileLabel(file) {
  return file?.name ?? 'unknown file';
}

export function isVideoFile(file) {
  return Boolean(file && file.type.startsWith('video/'));
}

export function normalizeVector(values) {
  const maxMagnitude = Math.max(...values.map((value) => Math.abs(value)), 1e-9);
  return values.map((value) => value / maxMagnitude);
}

export function quantile(values, fraction) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp((sorted.length - 1) * fraction, 0, sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }

  return lerp(sorted[lower], sorted[upper], position - lower);
}

export function binarySearchNearest(items, value, accessor = (item) => item) {
  if (!items.length) {
    return -1;
  }

  let low = 0;
  let high = items.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = accessor(items[mid]);

    if (current < value) {
      low = mid + 1;
    } else if (current > value) {
      high = mid - 1;
    } else {
      return mid;
    }
  }

  const right = clamp(low, 0, items.length - 1);
  const left = clamp(low - 1, 0, items.length - 1);
  return Math.abs(accessor(items[right]) - value) < Math.abs(accessor(items[left]) - value) ? right : left;
}

export function createGradientStops(minColor, midColor, maxColor) {
  return `linear-gradient(90deg, ${minColor}, ${midColor}, ${maxColor})`;
}