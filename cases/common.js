/* eslint-disable no-console */
import {
  defineFrameContainer,
  showGraph,
  showTable,
  trackPerformance,
  // @ts-ignore
} from '@camptocamp/rendering-analyzer';
import lilGui from 'lil-gui';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Link from 'ol/interaction/Link.js';
import BaseTileLayer from 'ol/layer/BaseTile.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import {Layer} from 'ol/layer.js';
import {useGeographic} from 'ol/proj.js';
import BuilderGroup from 'ol/render/canvas/BuilderGroup.js';
import ExecutorGroup from 'ol/render/canvas/ExecutorGroup.js';
import MixedGeometryBatch from 'ol/render/webgl/MixedGeometryBatch.js';
import VectorStyleRenderer from 'ol/render/webgl/VectorStyleRenderer.js';
import CompositeMapRenderer from 'ol/renderer/Composite.js';
import CanvasVectorLayerRenderer from 'ol/renderer/canvas/VectorLayer.js';
import CanvasVectorTileLayerRenderer from 'ol/renderer/canvas/VectorTileLayer.js';
import WebGLVectorLayerRenderer from 'ol/renderer/webgl/VectorLayer.js';
import WebGLVectorTileLayerRenderer from 'ol/renderer/webgl/VectorTileLayer.js';
import VectorSource from 'ol/source/Vector.js';
import TileGeometry from 'ol/webgl/TileGeometry.js';

useGeographic();

const link = new Link({
  replace: true,
});

/** @type {Map} */
let map;

/** @type {function(Map): void} */
let useWebGLCallback;

/** @type {function(Map): void} */
let useCanvasCallback;

/** @type {(function(Map): (void|Promise<void>))|null} */
let useWebGPUCallback;

const WEBGPU_VECTOR_STYLE_RENDERER_MODULE = [
  'ol',
  'render',
  'webgpu',
  'VectorStyleRenderer.js',
].join('/');
const WEBGPU_VECTOR_LAYER_RENDERER_MODULE = [
  'ol',
  'renderer',
  'webgpu',
  'VectorLayer.js',
].join('/');

const debugRenderer =
  new URL(window.location.href).searchParams.get('debugRenderer') === '1';

function logActiveRenderer(/** @type {string} */ label) {
  if (!debugRenderer) {
    return;
  }
  const layers = map.getLayers().getArray();
  const baseLayer = layers.length ? layers[layers.length - 1] : null;
  const layer = /** @type {import('ol/layer/Layer.js').default|null} */ (
    baseLayer
  );
  const layerName = layer?.constructor?.name ?? 'none';
  console.info(`${label} (layer: ${layerName})`);

  if (!layer) {
    return;
  }

  map.once('rendercomplete', () => {
    try {
      const renderer = layer.getRenderer();
      const rendererName = renderer?.constructor?.name ?? 'unknown';
      console.info(`${label} (layer: ${layerName}, renderer: ${rendererName})`);
    } catch (error) {
      console.warn('Failed to determine active layer renderer', error);
    }
  });
}

/**
 * @param {function(Map): void} useWebGL Called when WebGL is enabled
 * @param {function(Map): void} useCanvas Called when WebGL is disabled
 * @param {function(Map): (void|Promise<void>)} [useWebGPU] Called when WebGPU is enabled
 * @return {Map} Map
 */
export function createMap(useWebGL, useCanvas, useWebGPU) {
  map = new Map({
    layers: [],
    target: 'map',
  });
  map.setView(
    new View({
      center: [0, 0],
      zoom: 4,
      multiWorld: true,
    }),
  );
  useWebGLCallback = useWebGL;
  useCanvasCallback = useCanvas;
  useWebGPUCallback = useWebGPU ?? null;
  map.addInteraction(link);
  return map;
}

/**
 * @extends {Layer<VectorSource, WebGLVectorLayerRenderer>}
 */
export class WebGLVectorLayer extends Layer {
  /**
   * @return {WebGLVectorLayerRenderer} The renderer.
   */
  createRenderer() {
    return new WebGLVectorLayerRenderer(this, {
      style: this.get('style'),
      variables: {},
      disableHitDetection: true,
    });
  }
}

/**
 * @extends {BaseTileLayer<import("ol/source/VectorTile.js").default, WebGLVectorTileLayerRenderer>}
 */
export class WebGLVectorTileLayer extends BaseTileLayer {
  createRenderer() {
    return new WebGLVectorTileLayerRenderer(this, {
      style: this.get('style'),
      disableHitDetection: true,
    });
  }
}

const COLOR_PALETTE = [
  '#66c2a5',
  '#fc8d62',
  '#8da0cb',
  '#e78ac3',
  '#a6d854',
  '#ffd92f',
];
export function getRandomPaletteColor() {
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

export function getRandomColor() {
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h}, 90%, 50%)`;
}

const format = new GeoJSON();

/**
 * @param {import('geojson').FeatureCollection} collection Feature collection
 * @param {VectorSource} source Vector source
 */
export function addGeoJsonToSource(collection, source) {
  source.clear();
  console.time('parse features');
  const olFeatures = format.readFeatures(collection);
  console.timeEnd('parse features');

  console.time('add features');
  source.addFeatures(olFeatures);
  console.timeEnd('add features');
}

/**
 * Will generate polygons on a grid covering the whole latitude/longitude range
 * @param {number} count Count of polygons
 * @param {number} numVertices Number of vertices in polygons
 * @return {import('geojson').FeatureCollection} Feature collection
 */
export function generatePolygons(count, numVertices) {
  const size = 400 / Math.floor(Math.sqrt(count / 2)); // Increase the size for larger polygons
  /**
   * @type {Array<import('geojson').Feature>}
   */
  const features = [];
  for (let lon = -180; lon < 180 - size / 4; lon += size) {
    for (let lat = -90; lat < 90 - size / 4; lat += size) {
      const buffer = (0.3 + Math.random() * 0.2) * size; // Increase the buffer for larger polygons

      // Calculate the angle between vertices
      const angleStep = (2 * Math.PI) / numVertices;

      // Generate the vertices of the polygon
      const polygonCoordinates = [];
      for (let i = 0; i < numVertices; i++) {
        const angle = i * angleStep;
        const x =
          lon +
          size / 2 +
          buffer * Math.cos(angle) -
          (Math.random() * size) / 4;
        const y =
          lat +
          size / 2 +
          buffer * Math.sin(angle) -
          (Math.random() * size) / 4;
        polygonCoordinates.push([x, y]);
      }
      // Close the polygon by adding the first vertex at the end
      polygonCoordinates.push(polygonCoordinates[0]);

      features.push({
        type: 'Feature',
        properties: {
          color: getRandomPaletteColor(),
          ratio: Math.round(Math.random() * 100),
        },
        geometry: {
          type: 'Polygon',
          coordinates: [polygonCoordinates],
        },
      });
    }
  }
  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * @param {number} count Point count
 * @param {number} radius Radius
 * @return {import('geojson').FeatureCollection} Feature collection
 */
export function generatePoints(count, radius) {
  const size = 400 / Math.floor(Math.sqrt(count / 2));
  /**
   * @type {Array<import('geojson').Feature>}
   */
  const features = [];
  for (let lon = -180; lon < 180 - size / 4; lon += size) {
    for (let lat = -90; lat < 90 - size / 4; lat += size) {
      const buffer = (0.3 + Math.random() * 0.2) * size * (radius / 5); // Increase the buffer for larger points
      features.push({
        type: 'Feature',
        properties: {
          color: getRandomPaletteColor(),
          radius,
        },
        geometry: {
          type: 'Point',
          coordinates: [lon + buffer, lat + buffer],
        },
      });
    }
  }
  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * @param {number} lineCount From 1 to 100
 * @param {number} curveComplexity From 2 to 1000
 * @param {number} width line width
 * @return {import('geojson').FeatureCollection} Feature collection
 */
export function generateLines(lineCount, curveComplexity, width) {
  /**
   * @type {Array<import('geojson').Feature>}
   */
  const features = [];
  const periodCount = 10;
  const periodWidth = 360 / periodCount;
  const periodHeight = 20;
  const latitudeSpacing = 180 / (lineCount + 1);

  /**
   * @type {Array<any>}
   */
  let singleCurve = []; // Create a singleCurve array outside the loop

  for (let j = 0; j < lineCount; j++) {
    const coordinates = [];
    for (let i = 0; i < periodCount; i++) {
      const startLon = -180 + i * periodWidth;
      const startLat = -90 + (j + 1) * latitudeSpacing;

      singleCurve = []; // Clear the array

      for (let i = 0; i < curveComplexity; i++) {
        const ratio = i / curveComplexity;
        const longitude = startLon + ratio * periodWidth;
        const latitude =
          startLat + Math.cos(ratio * Math.PI * 2) * periodHeight * 0.5;
        singleCurve = singleCurve.concat([[longitude, latitude]]);
      }
      coordinates.push(...singleCurve);
    }
    features.push({
      type: 'Feature',
      properties: {
        color: getRandomPaletteColor(), // Use deterministic color selection
        width,
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

// GUI Utils

const gui = new lilGui();

/** @type {Record<string, boolean|number|string|function(): void>} */
const guiParams = {};

/**
 * Registers a GUI param; can either be a numeric parameter with a range, or a toggle parameter
 * The `id` and `values` will show up in the url
 * @param {string} id Id
 * @param {string} label Label
 * @param {Array<string>|Array<number>} values Either two string values for true/false, or two numbers defining a range
 * @param {boolean|number|function(): void} defaultValue Default value
 * @param {function(boolean|number|function(): void, boolean|null): void} callback Called when the parameter changes, and also on initialization
 * First argument is the current value, second argument is true if this is the initial call
 */
export function registerGuiParameter(
  id,
  label,
  values,
  defaultValue,
  callback,
) {
  let controller;
  const isNumeric = typeof values[0] === 'number';
  const isFunction = typeof defaultValue === 'function';

  const initialLinkValue = link.track(id, (value) => {
    callback(isNumeric ? parseFloat(value) : value === values[0], false);
  });
  let initialValue = defaultValue;
  if (initialLinkValue !== null) {
    initialValue = isNumeric
      ? parseFloat(initialLinkValue)
      : initialLinkValue === values[0];
  }

  if (isFunction) {
    guiParams[id] = defaultValue;
    controller = gui.add(guiParams, id);
  } else if (isNumeric) {
    guiParams[id] = initialValue;
    const numericValues = /** @type {Array<number>} */ (values);
    controller = gui.add(
      guiParams,
      id,
      numericValues[0],
      numericValues[1],
      numericValues[2] || 1,
    );
  } else {
    guiParams[id] = initialValue;
    controller = gui.add(guiParams, id);
  }
  callback(initialValue, true);

  controller.name(label);
  controller.listen();

  if (isFunction) {
    // No need to track function parameters in the URL or call a callback when they change
  } else if (isNumeric) {
    controller.onFinishChange((/** @type {number} */ rawValue) => {
      link.update(id, rawValue.toString());
      callback(rawValue, false);
    });
  } else {
    controller.onChange((/** @type {boolean} */ rawValue) => {
      const newValue = rawValue ? values[0].toString() : values[1].toString();
      link.update(id, newValue);
      callback(rawValue, false);
    });
  }
}

/**
 * @param {string} id Parameter id
 * @return {number|boolean|string|null|function(): void} Current value (null if unknown/uninitialized)
 */
export function getGuiParameterValue(id) {
  // read from url if not already set
  if (!(id in guiParams)) {
    const raw = new URL(window.location.href).searchParams.get(id) ?? '';
    const asNumber = Number.parseFloat(raw);
    if (!Number.isNaN(asNumber)) {
      return asNumber;
    }
    if (raw === 'true' || raw === 'false') {
      return raw === 'true';
    }
    return raw || null;
  }
  return guiParams[id];
}

/**
 * Registers a GUI string parameter with a fixed set of options.
 * @param {string} id Id
 * @param {string} label Label
 * @param {Object<string, string>} options Label->value map (value is stored in URL)
 * @param {string} defaultValue Default value
 * @param {function(string, boolean|null): void|Promise<void>} callback Callback
 */
export function registerGuiSelectParameter(
  id,
  label,
  options,
  defaultValue,
  callback,
) {
  const allowed = new Set(Object.values(options));
  const fromUrl = new URL(window.location.href).searchParams.get(id);
  const initialValue = fromUrl && allowed.has(fromUrl) ? fromUrl : defaultValue;
  guiParams[id] = initialValue;

  const controller = gui.add(guiParams, id).name(label).options(options);

  void callback(initialValue, true);

  link.track(id, (value) => {
    if (!allowed.has(value)) {
      return;
    }
    guiParams[id] = value;
    controller.updateDisplay();
    void callback(value, false);
  });

  controller.onFinishChange((/** @type {string} */ rawValue) => {
    link.update(id, rawValue);
    void callback(rawValue, false);
  });
}

export async function regenerateLayer() {
  map.getLayers().clear();
  const requested = getGuiParameterValue('renderer') || 'canvas';

  if (requested === 'webgpu' && useWebGPUCallback) {
    try {
      await useWebGPUCallback(map);
      logActiveRenderer('renderer: webgpu');
      return;
    } catch (error) {
      console.warn('WebGPU failed to initialize, falling back to WebGL', error);
      logActiveRenderer('renderer: webgpu (fallback: webgl)');
    }
  }

  if (requested === 'webgl' || requested === 'webgpu') {
    await useWebGLCallback(map);
    logActiveRenderer('renderer: webgl');
    return;
  }

  await useCanvasCallback(map);
  logActiveRenderer('renderer: canvas');
}

/**
 * @param {'canvas'|'webgl'|'webgpu'} mode Track renderer classes
 */
async function enablePerformanceTracking(mode) {
  defineFrameContainer(CompositeMapRenderer, 'renderFrame');
  trackPerformance(VectorSource);
  if (mode === 'webgl') {
    trackPerformance(MixedGeometryBatch);
    trackPerformance(VectorStyleRenderer);
    trackPerformance(WebGLVectorLayerRenderer);
    trackPerformance(TileGeometry);
    trackPerformance(WebGLVectorTileLayerRenderer);
  } else if (mode === 'webgpu') {
    try {
      const [
        {default: WebGPUVectorStyleRenderer},
        {default: WebGPUVectorLayerRenderer},
      ] = await Promise.all([
        import(/* @vite-ignore */ WEBGPU_VECTOR_STYLE_RENDERER_MODULE),
        import(/* @vite-ignore */ WEBGPU_VECTOR_LAYER_RENDERER_MODULE),
      ]);
      trackPerformance(WebGPUVectorStyleRenderer);
      trackPerformance(WebGPUVectorLayerRenderer);
    } catch (error) {
      console.warn('Failed to enable WebGPU performance tracking', error);
    }
  } else {
    trackPerformance(BuilderGroup);
    trackPerformance(ExecutorGroup);
    trackPerformance(CanvasVectorLayerRenderer);
    trackPerformance(VectorLayer);
    trackPerformance(CanvasVectorTileLayerRenderer);
    trackPerformance(VectorTileLayer);
  }
  showTable();
  showGraph();
  /** @type {HTMLDivElement} */ (gui.domElement).style.right = '430px';
}

export const olVersion =
  new URL(window.location.href).searchParams.get('olVersion') ??
  // @ts-ignore
  // eslint-disable-next-line no-undef
  __DEFAULT_OL_VERSION; // defined at build time by Vite

export function initializeGui() {
  gui
    .add({olVersion}, 'olVersion')
    .name('OpenLayers Version')
    // @ts-ignore
    // eslint-disable-next-line no-undef
    .options(__OL_VERSIONS) // defined at build time by Vite
    .onFinishChange((/** @type {string} */ rawValue) => {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('olVersion', rawValue);
      window.location.href = newUrl.href;
    });

  registerGuiSelectParameter(
    'renderer',
    'Renderer',
    {Canvas: 'canvas', WebGL: 'webgl', WebGPU: 'webgpu'},
    'canvas',
    async (value, initial) => {
      // if perf tracking is enabled, reloading the page is necessary to monkey-patch the correct classes
      if (getGuiParameterValue('performance') && !initial) {
        location.reload();
        return;
      }
      await regenerateLayer();
    },
  );

  registerGuiParameter(
    'performance',
    'Enable Performance Tracking',
    ['yes', 'no'],
    false,
    (value, initial) => {
      if (value && initial) {
        const mode = /** @type {'canvas'|'webgl'|'webgpu'} */ (
          getGuiParameterValue('renderer') || 'canvas'
        );
        void enablePerformanceTracking(mode);
      } else if (!initial) {
        location.reload();
      }
    },
  );
}
