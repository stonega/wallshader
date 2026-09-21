// Approximate Paper's 0.0.81 migration; the rewritten texture is not pixel-identical.
// https://shaders.paper.design/paper-texture-migration
export function migratePaperTexture(params) {
  if (
    !params ||
    !['colorFront', 'contrast', 'fade', 'foldCount', 'crumpleSize'].some(
      (key) => Object.hasOwn(params, key),
    )
  )
    return params;
  const number = (key, fallback, min = 0, max = 1) => {
    const value = params[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback;
  };
  const contrast = Math.sqrt(number('contrast', 0.3));
  const fade = number('fade', 0);
  const strength = contrast * (1 - 0.25 * fade);
  const colorBack = params.colorBack ?? '#ffffff';
  const colorShadow = params.colorFront ?? '#9fadbc';
  const result = {
    ...params,
    colorBack,
    colorShadow,
    colorPaper: mixHex(colorBack, colorShadow, 0.2 * (1 - contrast)),
    blending: contrast,
    distortion: 0.7,
    clip: false,
    angle: 300,
    seed: number('seed', 5.8, 0, 1000),
    roughness: 1.5 * number('roughness', 0.4) * strength,
    roughnessSize: 0.65,
    roughnessRows: 0,
    fiber: 1.5 * number('fiber', 0.3),
    fiberSize: 1.2 * number('fiberSize', 0.2, 0.01) ** 0.2,
    folds: 0,
    foldSizeX: 0.6,
    foldSizeY: 0.44,
    foldOffsetX: 0,
    foldOffsetY: 0,
    wrinkles: 2 * number('crumples', 0.3) * contrast - 0.25 * fade,
    wrinkleSize: (10 - 8 / (9 * number('crumpleSize', 0.35, 0.01))) / 9,
    crumples: 2 * number('folds', 0.65) * strength,
    crumpleCount: number('foldCount', 5, 2, 15),
    drops: 1.5 * number('drops', 0.2) * strength,
  };
  for (const key of [
    'colorFront',
    'contrast',
    'fade',
    'foldCount',
    'crumpleSize',
  ])
    delete result[key];
  return result;
}

function mixHex(from, to, amount) {
  const channels = (color) => {
    if (
      typeof color !== 'string' ||
      !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)
    )
      return null;
    let hex = color.slice(1);
    if (hex.length < 5) hex = [...hex].map((value) => value + value).join('');
    if (hex.length === 6) hex += 'ff';
    return [0, 2, 4, 6].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16),
    );
  };
  const back = channels(from);
  const front = channels(to);
  // Preserve CSS colors directly when they cannot use upstream's hex mixing.
  if (!back || !front) return from;
  return `#${back
    .map((value, index) =>
      Math.round(value + (front[index] - value) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
