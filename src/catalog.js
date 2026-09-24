import { PAPER_SHADERS } from './paper-catalog.js';
import { migratePaperTexture } from './paper-migration.js';

export const SHADERS = PAPER_SHADERS;

const CURATED = [
  {
    id: 'aurora',
    name: 'Aurora',
    shader: 'mesh',
    description: 'A slow drift of violet, blue, and light.',
    colors: ['#171346', '#6456C8', '#A1CEE8', '#E4AFE5'],
    frame: 6200,
  },
  {
    id: 'daybreak',
    name: 'Daybreak',
    shader: 'mesh',
    description: 'The softer side of the morning.',
    colors: ['#ED7455', '#F5BEAA', '#FFF0CF', '#9FADD9'],
    frame: 12500,
  },
  {
    id: 'tidal',
    name: 'Tidal',
    shader: 'simplex',
    description: 'Cool currents finding their own rhythm.',
    colors: ['#102E44', '#367A93', '#97CDC8', '#E0EEE2'],
    frame: 4400,
    scale: 0.65,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    shader: 'mesh',
    description: 'The last light, held a little longer.',
    colors: ['#231E46', '#944C91', '#E48E96', '#EEBD93'],
    frame: 19200,
  },
  {
    id: 'ribbon',
    name: 'Ribbon',
    shader: 'swirl',
    description: 'Broad folds of color in gentle motion.',
    colors: ['#789EDD', '#C5AFF1', '#EBD7F0', '#5564A8'],
    frame: 3200,
  },
  {
    id: 'moss',
    name: 'Moss',
    shader: 'mesh',
    description: 'A quiet patch of green for your desktop.',
    colors: ['#122C2C', '#547D68', '#A8B994', '#E0DBBC'],
    frame: 9100,
  },
  {
    id: 'contour',
    name: 'Contour',
    shader: 'simplex',
    description: 'A landscape drawn in flowing layers.',
    colors: ['#282D53', '#766DA1', '#C4A5BB', '#EAD7CE'],
    frame: 17600,
    scale: 0.7,
    params: { softness: 0.05, stepsPerColor: 2 },
  },
  {
    id: 'pearl',
    name: 'Pearl',
    shader: 'swirl',
    description: 'A little iridescence, without the noise.',
    colors: ['#C1C7E1', '#F0DEDD', '#F9F4E8', '#879EAE'],
    frame: 1500,
    params: { twist: 0.35, bandCount: 2, softness: 1 },
  },
  {
    id: 'ember',
    name: 'Ember',
    shader: 'mesh',
    description: 'Warm color with a darker heart.',
    colors: ['#321F36', '#913D58', '#DB7962', '#F0BD87'],
    frame: 22300,
  },
];

export const COMMON_FIELDS = [
  { key: 'scale', label: 'Scale', min: 0.01, max: 4, step: 0.01 },
  { key: 'rotation', label: 'Rotation', min: 0, max: 360, step: 0.01 },
  { key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.01 },
  { key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.01 },
  { key: 'originX', label: 'Origin X', min: 0, max: 1, step: 0.01 },
  { key: 'originY', label: 'Origin Y', min: 0, max: 1, step: 0.01 },
  { key: 'worldWidth', label: 'World width', min: 0, max: 8192, step: 1 },
  { key: 'worldHeight', label: 'World height', min: 0, max: 8192, step: 1 },
  { key: 'speed', label: 'Speed', min: -20, max: 20, step: 0.01 },
  { key: 'frame', label: 'Frame (ms)', min: -1e12, max: 1e12, step: 1 },
];

export const PRESETS = [
  ...CURATED,
  ...Object.entries(SHADERS)
    .filter(([id]) => !CURATED.some((preset) => preset.shader === id))
    .map(([id, shader]) => ({
      id: `paper-${shader.slug}`,
      name: shader.name,
      shader: id,
      description: `Explore ${shader.name.toLowerCase()} from Paper.`,
      colors: shader.defaults.colors ?? [],
      frame: shader.defaults.frame ?? 0,
    })),
];

export const clamp = (value, fallback, min, max) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;

export function commonFields(shader) {
  return COMMON_FIELDS.map((field) => {
    const values = SHADERS[shader].presets
      .map((preset) => preset.params[field.key])
      .filter((value) => typeof value === 'number');
    return {
      ...field,
      min: Math.min(field.min, ...values),
      max: Math.max(field.max, ...values),
    };
  });
}
export function isColor(value) {
  return (
    typeof value === 'string' &&
    (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ||
      /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i.test(
        value,
      ) ||
      /^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i.test(
        value,
      ))
  );
}

export function presetIdForShader(shader) {
  return PRESETS.find((preset) => preset.shader === shader)?.id;
}

export function createPreset(id) {
  const source = PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
  const definition = SHADERS[source.shader];
  const defaults = definition.defaults;
  const curated = CURATED.includes(source);
  const params = Object.fromEntries(
    definition.fields.map(({ key }) => [key, defaults[key]]),
  );
  // Preserve the original wallpaper appearances while exposing every Paper control.
  if (curated && source.shader === 'mesh')
    Object.assign(params, {
      distortion: 0.8,
      swirl: 0.35,
      grainMixer: 0,
      grainOverlay: 0.035,
    });
  if (curated && source.shader === 'simplex')
    Object.assign(params, { stepsPerColor: 1, softness: 0.65 });
  if (curated && source.shader === 'swirl')
    Object.assign(params, {
      colorBack: source.colors[0],
      bandCount: 3,
      twist: 0.2,
      center: 0.2,
      proportion: 0.5,
      softness: 0.7,
      noiseFrequency: 0.4,
      noise: 0.1,
    });
  Object.assign(params, source.params);
  return {
    ...source,
    colors: [...source.colors],
    ...Object.fromEntries(
      COMMON_FIELDS.map(({ key }) => [key, defaults[key] ?? 0]),
    ),
    speed: curated ? 0.25 : (defaults.speed ?? 0),
    scale: source.scale ?? defaults.scale ?? 1,
    frame: source.frame,
    rotation: curated ? 0 : (defaults.rotation ?? 0),
    fit: defaults.fit ?? 'contain',
    params,
    image:
      definition.hasImage &&
      !['liquid-metal', 'gem-smoke'].includes(source.shader)
        ? 'sample'
        : '',
    paperPreset: null,
  };
}

export function normalizePreset(id, input = {}) {
  const base = createPreset(id);
  const definition = SHADERS[base.shader];
  if (!input || typeof input !== 'object') return base;
  const params =
    base.shader === 'paper-texture'
      ? migratePaperTexture(input.params)
      : input.params;
  for (const field of commonFields(base.shader)) {
    base[field.key] = clamp(
      input[field.key],
      base[field.key],
      field.min,
      field.max,
    );
    if (field.step === 1) base[field.key] = Math.round(base[field.key]);
  }
  if (['none', 'contain', 'cover'].includes(input.fit)) base.fit = input.fit;
  if (
    Array.isArray(input.colors) &&
    input.colors.length >= 1 &&
    input.colors.length <= definition.maxColors &&
    input.colors.every(isColor)
  )
    base.colors = [...input.colors];
  for (const field of definition.fields) {
    const value = params?.[field.key];
    if (field.type === 'color' && isColor(value))
      base.params[field.key] = value;
    if (field.type === 'enum' && field.options.includes(value))
      base.params[field.key] = value;
    if (field.type === 'boolean' && typeof value === 'boolean')
      base.params[field.key] = value;
    if (field.type === 'number') {
      base.params[field.key] = clamp(
        value,
        base.params[field.key],
        field.min,
        field.max,
      );
      if (field.step === 1)
        base.params[field.key] = Math.round(base.params[field.key]);
    }
  }
  if (
    definition.hasImage &&
    typeof input.image === 'string' &&
    (['', 'sample'].includes(input.image) || input.image.startsWith('file:///'))
  )
    base.image = input.image;
  if (
    Number.isInteger(input.paperPreset) &&
    definition.presets[input.paperPreset]
  )
    base.paperPreset = input.paperPreset;
  return base;
}

export function fromPaperParams(id, values, paperPreset = null) {
  const base = createPreset(id);
  values = { ...values };
  if (
    typeof values.margin === 'number' &&
    ['fluted-glass', 'pulsing-border'].includes(base.shader)
  ) {
    for (const side of ['Left', 'Right', 'Top', 'Bottom'])
      values[`margin${side}`] ??= values.margin;
  }
  return normalizePreset(id, {
    ...base,
    ...values,
    params: values,
    paperPreset,
  });
}

export function paperParams(preset) {
  return {
    ...(preset.colors.length ? { colors: preset.colors } : {}),
    ...preset.params,
    ...Object.fromEntries(COMMON_FIELDS.map(({ key }) => [key, preset[key]])),
    fit: preset.fit,
    ...(SHADERS[preset.shader].hasImage ? { image: preset.image } : {}),
  };
}

export function normalizeState(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const ids = new Set(PRESETS.map((preset) => preset.id));
  return {
    version: 2,
    debugInfo: input.debugInfo === true,
    wallpaperTarget: input.wallpaperTarget === 'kitty' ? 'kitty' : 'desktop',
    liveRendering: input.liveRendering === 'gpu' ? 'gpu' : 'compatibility',
    selected: ids.has(input.selected) ? input.selected : PRESETS[0].id,
    favorites: [
      ...new Set(
        Array.isArray(input.favorites)
          ? input.favorites.filter((id) => ids.has(id))
          : [],
      ),
    ],
    presets: Object.fromEntries(
      PRESETS.filter((preset) => input.presets?.[preset.id]).map((preset) => [
        preset.id,
        normalizePreset(preset.id, input.presets[preset.id]),
      ]),
    ),
    savedPresets: normalizeSavedPresets(input.savedPresets),
  };
}

export function normalizeSavedPresets(input) {
  const ids = new Set();
  return (Array.isArray(input) ? input : []).flatMap((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-z0-9-]{1,80}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      !PRESETS.some(
        (preset) =>
          preset.id === item.preset?.id &&
          preset.shader === item.preset?.shader,
      )
    )
      return [];
    ids.add(item.id);
    return [
      {
        id: item.id,
        name: item.name.trim().slice(0, 80),
        preset: normalizePreset(item.preset.id, item.preset),
      },
    ];
  });
}

export function filterPresets(category, query, favorites) {
  const search = query.trim().toLowerCase();
  return PRESETS.filter(
    (preset) =>
      (category === 'All' ||
        (category === 'Favorites'
          ? favorites.includes(preset.id)
          : SHADERS[preset.shader].category === category)) &&
      `${preset.name} ${SHADERS[preset.shader].name}`
        .toLowerCase()
        .includes(search),
  );
}

export function validateDimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 35_389_440
  )
    throw new Error('Choose a wallpaper size up to 8K.');
  return { width, height };
}
