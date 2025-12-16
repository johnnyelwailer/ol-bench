import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import {
  WebGLVectorLayer,
  createMap,
  getGuiParameterValue,
  getRandomPaletteColor,
  initializeGui,
  regenerateLayer,
  registerGuiParameter,
  registerGuiSelectParameter,
} from '../common.js';

const source = new VectorSource({
  wrapX: false,
});

/**
 * @typedef {'point'|'line'|'polygon'} GeometryType
 * @typedef {'angle'|'size'|'color'|'opacity'} AnimatedProperty
 */

/** @type {GeometryType} */
let geometryType = 'polygon';

let animateAngle = true;
let animateSize = false;
let animateColor = false;
let animateOpacity = false;

/** @type {import('ol/style/flat.js').FlatStyle} */
let style = {};

function buildStyle() {
  if (geometryType === 'line') {
    return {
      'stroke-color': ['get', 'color'],
      // @ts-ignore - upstream typing issue for get() + numeric property
      'stroke-width': ['get', 'size'],
      'stroke-line-dash': [12, 12],
      // @ts-ignore - upstream typing issue for get() + numeric property
      'stroke-line-dash-offset': ['get', 'angle'],
    };
  }

  if (geometryType === 'polygon') {
    return {
      'fill-color': ['get', 'color'],
      'stroke-color': 'gray',
      // @ts-ignore - upstream typing issue for get() + numeric property
      'stroke-width': ['get', 'size'],
      'stroke-line-dash': [12, 12],
      // @ts-ignore - upstream typing issue for get() + numeric property
      'stroke-line-dash-offset': ['get', 'angle'],
    };
  }

  return {
    'shape-points': 4,
    // @ts-ignore - upstream typing issue for get() + numeric property
    'shape-radius': ['get', 'size'],
    'shape-fill-color': ['get', 'color'],
    // @ts-ignore - upstream typing issue for get() + numeric property
    'shape-rotation': ['get', 'angle'],
    'shape-rotate-with-view': false,
    'shape-stroke-color': 'gray',
    'shape-stroke-width': 0.5,
  };
}

/**
 * @type {Array<import('ol/Feature.js').default>}
 */
let features = [];

/**
 * Per-feature phase in radians.
 * @type {Array<number>}
 */
let phases = [];

/**
 * Per-feature base size.
 * @type {Array<number>}
 */
let baseSizes = [];

/**
 * Per-feature base color (hex).
 * @type {Array<string>}
 */
let baseColors = [];

/**
 * Per-feature base rgb.
 * @type {Array<Array<number>>}
 */
let baseRgb = [];

/**
 * Per-feature base hue (0..1).
 * @type {Array<number>}
 */
let baseHues = [];

/**
 * Convert a #rgb/#rrggbb hex color to [r,g,b].
 * @param {string} hex Hex string
 * @return {Array<number>} RGB triplet
 */
function hexToRgb(hex) {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  if (cleaned.length === 3) {
    const r = Number.parseInt(cleaned[0] + cleaned[0], 16);
    const g = Number.parseInt(cleaned[1] + cleaned[1], 16);
    const b = Number.parseInt(cleaned[2] + cleaned[2], 16);
    return [r, g, b];
  }
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Convert h,s,l in [0..1] to [r,g,b] in [0..255]
 * @param {number} h Hue
 * @param {number} s Saturation
 * @param {number} l Lightness
 * @return {Array<number>} RGB
 */
function hslToRgb(h, s, l) {
  /**
   * @param {number} p P
   * @param {number} q Q
   * @param {number} t T
   * @return {number} Channel (0..1)
   */
  const hueToRgb = (p, q, t) => {
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h + 1 / 3);
  const g = hueToRgb(p, q, h);
  const b = hueToRgb(p, q, h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function applyStaticProperties() {
  for (let i = 0; i < features.length; i++) {
    if (!animateAngle) {
      features[i].set('angle', phases[i]);
    }
    if (!animateSize) {
      features[i].set('size', baseSizes[i]);
    }
    if (!animateColor && !animateOpacity) {
      features[i].set('color', baseColors[i]);
    }
  }
}

/**
 * @param {number} count The number of features to create.
 * @param {number} featureSize Symbol radius or stroke width.
 * @param {import('ol/Map.js').default} map Map.
 */
function resetData(count, featureSize, map) {
  const view = map.getView();
  const mapSize = map.getSize();
  const extent = mapSize ? view.calculateExtent(mapSize) : [-10, -5, 10, 5];
  const width = extent[2] - extent[0];
  const height = extent[3] - extent[1];
  const aspect = width / height;

  const columns = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const spacingX = width / (columns + 1);
  const spacingY = height / (rows + 1);
  const cell = Math.min(spacingX, spacingY);
  const tau = Math.PI * 2;

  const newFeatures = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = extent[0] + (col + 1) * spacingX;
    const y = extent[1] + (row + 1) * spacingY;

    let geometry;
    if (geometryType === 'line') {
      const dx = cell * 0.35;
      geometry = new LineString([
        [x - dx, y],
        [x + dx, y],
      ]);
    } else if (geometryType === 'polygon') {
      const vertexCount = 5 + (i % 6); // 5..10 vertices, per-feature variance
      const angleStep = tau / vertexCount;
      const baseRadius = cell * 0.28;
      const minRadius = baseRadius * 0.55;
      const maxRadius = baseRadius * 1.0;
      const ring = [];
      for (let v = 0; v < vertexCount; v++) {
        const angle = v * angleStep + (Math.random() - 0.5) * angleStep * 0.35;
        const radius = minRadius + Math.random() * (maxRadius - minRadius);
        ring.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
      }
      ring.push(ring[0]);
      geometry = new Polygon([ring]);
    } else {
      geometry = new Point([x, y]);
    }

    const baseColor = getRandomPaletteColor();
    newFeatures.push(
      new Feature({
        geometry,
        size: featureSize,
        color: baseColor,
        angle: Math.random() * Math.PI * 2,
      }),
    );
  }

  source.clear();
  source.addFeatures(newFeatures);
  features = newFeatures;
  phases = newFeatures.map((feature) => feature.get('angle') || 0);
  baseSizes = newFeatures.map((feature) => feature.get('size') || 1);
  baseColors = newFeatures.map((feature) => feature.get('color') || '#000000');
  baseRgb = newFeatures.map((feature) =>
    hexToRgb(/** @type {string} */ (feature.get('color') || '#000000')),
  );
  baseHues = newFeatures.map(() => Math.random());
}

function main() {
  geometryType =
    /** @type {GeometryType} */ (getGuiParameterValue('geometry')) || 'point';
  style = buildStyle();

  const map = createMap(
    (map) => {
      map.addLayer(new WebGLVectorLayer({source, properties: {style}}));
    },
    (map) => {
      map.addLayer(new VectorLayer({source, style}));
    },
    async (map) => {
      const modulePath = ['ol', 'layer', 'WebGPUVector.js'].join('/');
      const {default: WebGPUVectorLayer} = await import(
        /* @vite-ignore */ modulePath
      );
      map.addLayer(
        new WebGPUVectorLayer({
          source,
          style,
          disableHitDetection: true,
        }),
      );
    },
  );

  initializeGui();

  registerGuiSelectParameter(
    'geometry',
    'Geometry',
    {Points: 'point', Lines: 'line', Polygons: 'polygon'},
    'point',
    async (value, initial) => {
      geometryType = /** @type {GeometryType} */ (value);
      style = buildStyle();
      if (!initial) {
        resetData(
          /** @type {number} */ (getGuiParameterValue('count')),
          /** @type {number} */ (getGuiParameterValue('size')),
          map,
        );
        await regenerateLayer();
      }
    },
  );

  registerGuiParameter(
    'animateAngle',
    'Animate angle',
    ['yes', 'no'],
    true,
    (value) => {
      animateAngle = /** @type {boolean} */ (value);
      applyStaticProperties();
    },
  );
  registerGuiParameter(
    'animateSize',
    'Animate size',
    ['yes', 'no'],
    false,
    (value) => {
      animateSize = /** @type {boolean} */ (value);
      applyStaticProperties();
    },
  );
  registerGuiParameter(
    'animateColor',
    'Animate color',
    ['yes', 'no'],
    false,
    (value) => {
      animateColor = /** @type {boolean} */ (value);
      applyStaticProperties();
    },
  );
  registerGuiParameter(
    'animateOpacity',
    'Animate opacity',
    ['yes', 'no'],
    false,
    (value) => {
      animateOpacity = /** @type {boolean} */ (value);
      applyStaticProperties();
    },
  );

  registerGuiParameter(
    'count',
    'Feature count',
    [1, 20000, 1],
    10,
    (value, initial) => {
      if (initial) {
        return;
      }
      resetData(
        /** @type {number} */ (value),
        /** @type {number} */ (getGuiParameterValue('size')),
        map,
      );
    },
  );

  registerGuiParameter('size', 'Size', [1, 80, 1], 4, (value, initial) => {
    if (initial) {
      return;
    }
    resetData(
      /** @type {number} */ (getGuiParameterValue('count')),
      /** @type {number} */ (value),
      map,
    );
  });

  resetData(
    /** @type {number} */ (getGuiParameterValue('count')),
    /** @type {number} */ (getGuiParameterValue('size')),
    map,
  );

  const speed = 2; // rad/s
  const tau = Math.PI * 2;

  const animate = (/** @type {number} */ time) => {
    if (features.length) {
      const timeSeconds = time / 1000;
      if (animateAngle) {
        for (let i = 0; i < features.length; i++) {
          if (geometryType === 'point') {
            const angle = (phases[i] + speed * timeSeconds) % tau;
            features[i].set('angle', angle);
          } else {
            const offset = (phases[i] + speed * timeSeconds) * 10;
            features[i].set('angle', offset);
          }
        }
      }

      if (animateSize) {
        for (let i = 0; i < features.length; i++) {
          const pulse = 0.65 + 0.35 * Math.sin(phases[i] + speed * timeSeconds);
          features[i].set('size', Math.max(1, baseSizes[i] * pulse));
        }
      }

      if (animateColor || animateOpacity) {
        for (let i = 0; i < features.length; i++) {
          const alpha = animateOpacity
            ? 0.2 +
              0.8 *
                (0.5 + 0.5 * Math.sin(phases[i] + speed * timeSeconds * 1.5))
            : 1;

          const [r, g, b] = animateColor
            ? hslToRgb((baseHues[i] + timeSeconds * 0.1) % 1, 0.85, 0.55)
            : baseRgb[i];

          features[i].set('color', `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
        }
      }
    }

    // map.render();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

main();
