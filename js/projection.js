import { clamp } from './utils.js';

function getFeatureVector(frame, mode) {
  switch (mode) {
    case 'spectral':
      return [
        frame.centroid,
        frame.spread,
        frame.rolloff,
        frame.flatness,
        frame.dominantFrequency,
      ];
    case 'dynamics':
      return [
        frame.rms,
        frame.zcr,
        frame.flatness,
        frame.rolloff,
        frame.centroid,
      ];
    case 'mfcc':
    default:
      return [frame.mfcc?.[0] ?? 0, frame.mfcc?.[1] ?? 0, frame.mfcc?.[2] ?? 0];
  }
}

function getPcaFeatureVector(frame) {
  return [
    ...(frame.mfcc ?? new Array(13).fill(0)),
    frame.rms ?? 0,
    frame.centroid ?? 0,
    frame.flatness ?? 0,
    frame.rolloff ?? 0,
    frame.spread ?? 0,
    frame.zcr ?? 0,
    frame.dominantFrequency ?? 0,
  ];
}

function meanCenter(matrix) {
  const columnCount = matrix[0].length;
  const means = new Array(columnCount).fill(0);
  const stdDeviations = new Array(columnCount).fill(0);

  for (const row of matrix) {
    for (let column = 0; column < columnCount; column += 1) {
      means[column] += row[column];
    }
  }

  for (let column = 0; column < columnCount; column += 1) {
    means[column] /= matrix.length;
  }

  for (const row of matrix) {
    for (let column = 0; column < columnCount; column += 1) {
      const deviation = row[column] - means[column];
      stdDeviations[column] += deviation * deviation;
    }
  }

  for (let column = 0; column < columnCount; column += 1) {
    stdDeviations[column] = Math.sqrt(stdDeviations[column] / Math.max(matrix.length - 1, 1)) || 1;
  }

  return {
    means,
    stdDeviations,
    matrix: matrix.map((row) => row.map((value, column) => (value - means[column]) / stdDeviations[column])),
  };
}

function createCovarianceMatrix(matrix) {
  const rowCount = matrix.length;
  const dimension = matrix[0].length;
  const covariance = Array.from({ length: dimension }, () => new Array(dimension).fill(0));

  for (const row of matrix) {
    for (let rowIndex = 0; rowIndex < dimension; rowIndex += 1) {
      for (let columnIndex = rowIndex; columnIndex < dimension; columnIndex += 1) {
        covariance[rowIndex][columnIndex] += row[rowIndex] * row[columnIndex];
      }
    }
  }

  const scale = Math.max(rowCount - 1, 1);
  for (let rowIndex = 0; rowIndex < dimension; rowIndex += 1) {
    for (let columnIndex = rowIndex; columnIndex < dimension; columnIndex += 1) {
      covariance[rowIndex][columnIndex] /= scale;
      covariance[columnIndex][rowIndex] = covariance[rowIndex][columnIndex];
    }
  }

  return covariance;
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function vectorLength(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
}

function normalizeVector(vector) {
  const length = vectorLength(vector);
  return vector.map((value) => value / length);
}

function dotProduct(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function subtractOuterProduct(matrix, eigenvalue, eigenvector) {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      matrix[row][column] -= eigenvalue * eigenvector[row] * eigenvector[column];
    }
  }
}

function powerIteration(matrix, iterations = 60, tolerance = 1e-7) {
  let vector = normalizeVector(new Array(matrix.length).fill(0).map((_, index) => (index === 0 ? 1 : 0.5)));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const nextVector = normalizeVector(multiplyMatrixVector(matrix, vector));
    const delta = vector.reduce((sum, value, index) => sum + Math.abs(value - nextVector[index]), 0);
    vector = nextVector;

    if (delta < tolerance) {
      break;
    }
  }

  const eigenvalue = dotProduct(vector, multiplyMatrixVector(matrix, vector));
  return { eigenvalue, eigenvector: vector };
}

function runPca(matrix, componentCount = 3) {
  const covariance = createCovarianceMatrix(matrix);
  const components = [];
  const workingMatrix = covariance.map((row) => row.slice());

  for (let component = 0; component < componentCount; component += 1) {
    const { eigenvalue, eigenvector } = powerIteration(workingMatrix);

    if (!Number.isFinite(eigenvalue) || !eigenvector.some((value) => Math.abs(value) > 1e-6)) {
      break;
    }

    components.push(eigenvector);
    subtractOuterProduct(workingMatrix, eigenvalue, eigenvector);
  }

  return components;
}

function projectWithVectors(matrix, vectors) {
  return matrix.map((row) => vectors.map((vector) => dotProduct(row, vector)));
}

function normalizePoints(points) {
  if (!points.length) {
    return points;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const zs = points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);

  return points.map((point) => ({
    ...point,
    x: ((point.x - minX) / scale) * 2 - 1,
    y: ((point.y - minY) / scale) * 2 - 1,
    z: ((point.z - minZ) / scale) * 2 - 1,
  }));
}

export function projectFrames(frames, mode = 'pca') {
  if (!frames.length) {
    return { points: [], projectionMode: mode, basis: [] };
  }

  const featureMatrix = mode === 'pca'
    ? frames.map(getPcaFeatureVector)
    : frames.map((frame) => getFeatureVector(frame, mode));

  let points;
  let basis = [];

  if (mode === 'pca' && featureMatrix.length >= 3) {
    const { matrix } = meanCenter(featureMatrix);
    basis = runPca(matrix, 3);

    if (basis.length === 3) {
      const projected = projectWithVectors(matrix, basis);
      points = projected.map((projection, index) => ({
        ...frames[index],
        x: projection[0] ?? 0,
        y: projection[1] ?? 0,
        z: projection[2] ?? 0,
      }));
    }
  }

  if (!points) {
    points = featureMatrix.map((values, index) => ({
      ...frames[index],
      x: values[0] ?? 0,
      y: values[1] ?? 0,
      z: values[2] ?? 0,
    }));
  }

  return {
    points: normalizePoints(points),
    projectionMode: basis.length === 3 && mode === 'pca' ? 'pca' : mode,
    basis,
  };
}

export function getColorDomain(points, colorMode) {
  if (!points.length) {
    return [0, 1];
  }

  switch (colorMode) {
    case 'rms':
      return [Math.min(...points.map((point) => point.rms)), Math.max(...points.map((point) => point.rms))];
    case 'centroid':
      return [Math.min(...points.map((point) => point.centroid)), Math.max(...points.map((point) => point.centroid))];
    case 'flatness':
      return [Math.min(...points.map((point) => point.flatness)), Math.max(...points.map((point) => point.flatness))];
    case 'rolloff':
      return [Math.min(...points.map((point) => point.rolloff)), Math.max(...points.map((point) => point.rolloff))];
    case 'time':
    default:
      return [points[0].time, points[points.length - 1].time];
  }
}

export function normalizeColorValue(value, domain) {
  const [min, max] = domain;
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }

  return clamp((value - min) / (max - min), 0, 1);
}

export function selectColorValue(point, colorMode) {
  switch (colorMode) {
    case 'rms':
      return point.rms ?? 0;
    case 'centroid':
      return point.centroid ?? 0;
    case 'flatness':
      return point.flatness ?? 0;
    case 'rolloff':
      return point.rolloff ?? 0;
    case 'time':
    default:
      return point.time ?? 0;
  }
}