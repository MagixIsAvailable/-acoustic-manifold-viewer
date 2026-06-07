import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, binarySearchNearest } from './utils.js';
import { getColorDomain, normalizeColorValue, selectColorValue } from './projection.js';

function makeColor(value, mode) {
  const palettes = {
    time: [0x0d2c48, 0x4f8d90, 0x85d7cb, 0xd6c17d],
    rms: [0x162b52, 0x2c7c96, 0x7bd7c3, 0xf0d77b],
    centroid: [0x152738, 0x4d6b84, 0x82c2ce, 0xf2d481],
    flatness: [0x13222f, 0x37606e, 0x73b3ad, 0xf0c36f],
    rolloff: [0x102035, 0x35798e, 0x8dd0ca, 0xf3dc7c],
  };

  const palette = palettes[mode] ?? palettes.time;
  const color = new THREE.Color();
  const segment = clamp(value, 0, 1) * (palette.length - 1);
  const lower = Math.floor(segment);
  const upper = Math.min(palette.length - 1, lower + 1);
  const blend = segment - lower;
  color.setHex(palette[lower]);
  color.lerp(new THREE.Color().setHex(palette[upper]), blend);
  return color;
}

function computeSalience(point) {
  const rms = Number.isFinite(point.rms) ? point.rms : 0;
  const centroid = Number.isFinite(point.centroid) ? point.centroid : 0;
  const flatness = Number.isFinite(point.flatness) ? point.flatness : 0;
  const rolloff = Number.isFinite(point.rolloff) ? point.rolloff : 0;
  const time = Number.isFinite(point.time) ? point.time : 0;
  const raw = (rms * 0.55) + (Math.abs(centroid) * 0.12) + (Math.abs(rolloff) * 0.08) + ((1 - flatness) * 0.22) + (Math.sin(time * 0.6) * 0.03);
  return clamp(raw, 0, 1);
}

function buildConnectionPairs(points, maxLinks = 160) {
  if (points.length < 2) {
    return [];
  }

  const pairs = [];
  const limit = Math.min(points.length - 1, maxLinks);

  for (let index = 1; index <= limit; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (!current || !previous) {
      continue;
    }

    pairs.push(previous, current);
  }

  const sampleStep = Math.max(1, Math.floor(points.length / 55));
  for (let index = 0; index < points.length; index += sampleStep) {
    const source = points[index];
    if (!source) {
      continue;
    }

    let closest = null;
    let closestDistance = Infinity;

    for (let candidateIndex = Math.max(0, index - 8); candidateIndex < Math.min(points.length, index + 9); candidateIndex += 1) {
      if (candidateIndex === index) {
        continue;
      }

      const candidate = points[candidateIndex];
      if (!candidate) {
        continue;
      }

      const dx = source.x - candidate.x;
      const dy = source.y - candidate.y;
      const dz = source.z - candidate.z;
      const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));

      if (distance < closestDistance) {
        closestDistance = distance;
        closest = candidate;
      }
    }

    if (closest) {
      pairs.push(source, closest);
    }
  }

  return pairs;
}

export function createScene(container) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 0.65, 2.8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.minDistance = 0.45;
  controls.maxDistance = 10;
  controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0x9fd8ef, 1.1);
  keyLight.position.set(3, 2, 4);
  scene.add(keyLight);

  const grid = new THREE.GridHelper(4, 32, 0x3a5567, 0x263847);
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);

  const pointsMaterial = new THREE.PointsMaterial({
    size: 0.026,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    vertexColors: true,
  });

  const glowMaterial = new THREE.PointsMaterial({
    size: 0.08,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x8ed7cb,
    transparent: true,
    opacity: 0.34,
  });

  const connectionMaterial = new THREE.LineBasicMaterial({
    color: 0xf1d87c,
    transparent: true,
    opacity: 0.10,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const playheadMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f1ca,
    emissive: 0xb28a23,
    emissiveIntensity: 0.75,
    metalness: 0.04,
    roughness: 0.18,
  });

  const playheadMesh = new THREE.Mesh(new THREE.SphereGeometry(0.045, 18, 18), playheadMaterial);
  const playheadHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0xf4d77e, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  playheadHalo.visible = false;
  scene.add(playheadHalo);
  playheadMesh.visible = false;
  scene.add(playheadMesh);

  const state = {
    points: [],
    colorMode: 'time',
    pointsObject: null,
    glowObject: null,
    lineObject: null,
    connectionObject: null,
    domain: [0, 1],
  };

  function clearData() {
    if (state.pointsObject) {
      scene.remove(state.pointsObject);
      state.pointsObject.geometry.dispose();
      state.pointsObject.material.dispose();
      state.pointsObject = null;
    }

    if (state.glowObject) {
      scene.remove(state.glowObject);
      state.glowObject.geometry.dispose();
      state.glowObject.material.dispose();
      state.glowObject = null;
    }

    if (state.lineObject) {
      scene.remove(state.lineObject);
      state.lineObject.geometry.dispose();
      state.lineObject.material.dispose();
      state.lineObject = null;
    }

    if (state.connectionObject) {
      scene.remove(state.connectionObject);
      state.connectionObject.geometry.dispose();
      state.connectionObject.material.dispose();
      state.connectionObject = null;
    }

    state.points = [];
    playheadMesh.visible = false;
    playheadHalo.visible = false;
  }

  function buildPointCloud(points, colorMode) {
    const safePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(safePoints.length * 3);
    const colors = new Float32Array(safePoints.length * 3);
    const glowColors = new Float32Array(safePoints.length * 3);
    const domain = getColorDomain(safePoints, colorMode);

    safePoints.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;

      const normalized = normalizeColorValue(selectColorValue(point, colorMode), domain);
      const color = makeColor(normalized, colorMode);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;

      const salience = computeSalience(point);
      glowColors[index * 3] = color.r * (0.4 + salience * 0.6);
      glowColors[index * 3 + 1] = color.g * (0.4 + salience * 0.6);
      glowColors[index * 3 + 2] = color.b * (0.4 + salience * 0.6);
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const pointsObject = new THREE.Points(geometry, pointsMaterial.clone());
    const glowGeometry = geometry.clone();
    glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));
    const glowObject = new THREE.Points(glowGeometry, glowMaterial.clone());
    glowObject.renderOrder = 0;
    glowObject.frustumCulled = false;
    pointsObject.renderOrder = 1;
    pointsObject.frustumCulled = false;
    const linePositions = new Float32Array(safePoints.length * 3);

    safePoints.forEach((point, index) => {
      linePositions[index * 3] = point.x;
      linePositions[index * 3 + 1] = point.y;
      linePositions[index * 3 + 2] = point.z;
    });

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const lineObject = new THREE.Line(lineGeometry, lineMaterial.clone());
    lineObject.visible = false;

    const connectionPairs = buildConnectionPairs(safePoints);
    const connectionPositions = new Float32Array(connectionPairs.length * 3);
    connectionPairs.forEach((point, index) => {
      connectionPositions[index * 3] = point.x;
      connectionPositions[index * 3 + 1] = point.y;
      connectionPositions[index * 3 + 2] = point.z;
    });
    const connectionGeometry = new THREE.BufferGeometry();
    connectionGeometry.setAttribute('position', new THREE.BufferAttribute(connectionPositions, 3));
    const connectionObject = new THREE.LineSegments(connectionGeometry, connectionMaterial.clone());
    connectionObject.visible = true;
    connectionObject.renderOrder = 0;

    scene.add(pointsObject);
    scene.add(glowObject);
    scene.add(lineObject);
    scene.add(connectionObject);

    return { pointsObject, glowObject, lineObject, connectionObject, domain };
  }

  function applyTheme(theme) {
    const isLight = theme === 'light';
    renderer.setClearColor(isLight ? 0xf3f6f8 : 0x081017, 0);
    scene.background = new THREE.Color(isLight ? 0xf3f6f8 : 0x081017);
    grid.material.color.setHex(isLight ? 0xb6c6d0 : 0x3a5567);
    grid.material.opacity = isLight ? 0.20 : 0.25;
    ambient.intensity = isLight ? 1.18 : 1.0;
    keyLight.color.setHex(isLight ? 0x7fb5d7 : 0x9fd8ef);
  }

  function setDataset(points, options = {}) {
    clearData();
    state.points = points;
    state.colorMode = options.colorMode ?? 'time';

    const built = buildPointCloud(points, state.colorMode);
    state.pointsObject = built.pointsObject;
    state.glowObject = built.glowObject;
    state.lineObject = built.lineObject;
    state.connectionObject = built.connectionObject;
    state.domain = built.domain;

    state.pointsObject.visible = options.displayMode !== 'trajectory';
    if (state.glowObject) {
      state.glowObject.visible = options.displayMode !== 'trajectory';
    }
    state.lineObject.visible = options.displayMode === 'trajectory' || options.displayMode === 'both';
    playheadMesh.visible = true;
    playheadHalo.visible = true;

    return built.domain;
  }

  function setDisplayMode(mode) {
    if (state.pointsObject) {
      state.pointsObject.visible = mode !== 'trajectory';
    }

    if (state.glowObject) {
      state.glowObject.visible = mode !== 'trajectory';
    }

    if (state.lineObject) {
      state.lineObject.visible = mode === 'trajectory' || mode === 'both';
    }

    if (state.connectionObject) {
      state.connectionObject.visible = mode !== 'trajectory';
    }
  }

  function setColorMode(colorMode) {
    if (!state.points.length) {
      state.colorMode = colorMode;
      return state.domain;
    }

    state.colorMode = colorMode;
    state.domain = getColorDomain(state.points, colorMode);

    const colorAttribute = state.pointsObject?.geometry?.getAttribute('color');
    if (colorAttribute) {
      state.points.forEach((point, index) => {
        const normalized = normalizeColorValue(selectColorValue(point, colorMode), state.domain);
        const color = makeColor(normalized, colorMode);
        colorAttribute.setXYZ(index, color.r, color.g, color.b);
      });

      colorAttribute.needsUpdate = true;
    }

    return state.domain;
  }

  function setPlayhead(time) {
    if (!state.points.length) {
      return null;
    }

    const index = binarySearchNearest(state.points, time, (point) => point.time);
    const point = state.points[clamp(index, 0, state.points.length - 1)];
    if (!point) {
      return null;
    }

    playheadMesh.position.set(point.x, point.y, point.z);
    playheadHalo.position.copy(playheadMesh.position);
    return { index, point };
  }

  function resetCamera() {
    camera.position.set(0, 0.65, 2.8);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  applyTheme('dark');
  animate();

  return {
    scene,
    renderer,
    camera,
    controls,
    setDataset,
    setColorMode,
    setDisplayMode,
    setPlayhead,
    resetCamera,
    resize,
    applyTheme,
    clearData,
    dispose() {
      clearData();
      renderer.dispose();
    },
    getPoints() {
      return state.points;
    },
  };
}