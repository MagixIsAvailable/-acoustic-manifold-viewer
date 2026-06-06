import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
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
    size: 0.028,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    vertexColors: true,
  });

  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x8ed7cb,
    transparent: true,
    opacity: 0.34,
  });

  const playheadMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f1ca,
    emissive: 0xb28a23,
    emissiveIntensity: 0.75,
    metalness: 0.04,
    roughness: 0.18,
  });

  const playheadMesh = new THREE.Mesh(new THREE.SphereGeometry(0.045, 18, 18), playheadMaterial);
  playheadMesh.visible = false;
  scene.add(playheadMesh);

  const state = {
    points: [],
    colorMode: 'time',
    pointsObject: null,
    lineObject: null,
    domain: [0, 1],
  };

  function clearData() {
    if (state.pointsObject) {
      scene.remove(state.pointsObject);
      state.pointsObject.geometry.dispose();
      state.pointsObject.material.dispose();
      state.pointsObject = null;
    }

    if (state.lineObject) {
      scene.remove(state.lineObject);
      state.lineObject.geometry.dispose();
      state.lineObject.material.dispose();
      state.lineObject = null;
    }

    state.points = [];
    playheadMesh.visible = false;
  }

  function buildPointCloud(points, colorMode) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    const domain = getColorDomain(points, colorMode);

    points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;

      const normalized = normalizeColorValue(selectColorValue(point, colorMode), domain);
      const color = makeColor(normalized, colorMode);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const pointsObject = new THREE.Points(geometry, pointsMaterial.clone());
    const linePositions = new Float32Array(points.length * 3);

    points.forEach((point, index) => {
      linePositions[index * 3] = point.x;
      linePositions[index * 3 + 1] = point.y;
      linePositions[index * 3 + 2] = point.z;
    });

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const lineObject = new THREE.Line(lineGeometry, lineMaterial.clone());
    lineObject.visible = false;

    scene.add(pointsObject);
    scene.add(lineObject);

    return { pointsObject, lineObject, domain };
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
    state.lineObject = built.lineObject;
    state.domain = built.domain;

    state.pointsObject.visible = options.displayMode !== 'trajectory';
    state.lineObject.visible = options.displayMode === 'trajectory' || options.displayMode === 'both';
    playheadMesh.visible = true;

    return built.domain;
  }

  function setDisplayMode(mode) {
    if (state.pointsObject) {
      state.pointsObject.visible = mode !== 'trajectory';
    }

    if (state.lineObject) {
      state.lineObject.visible = mode === 'trajectory' || mode === 'both';
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