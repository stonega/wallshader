// Regenerate editor metadata from the pinned upstream checkout. This evaluates
// only its static preset declarations, never React components or site code.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as Paper from '@paper-design/shaders';

const upstream = Bun.argv[2];
if (!upstream)
  throw new Error(
    'Usage: bun scripts/sync-paper.js /path/to/paper-shaders-checkout',
  );
const version = JSON.parse(
  await readFile(resolve(upstream, 'packages/shaders/package.json'), 'utf8'),
).version;
if (version !== '0.0.80')
  throw new Error(`Expected Paper 0.0.80, found ${version}`);
const directory = resolve(upstream, 'packages/shaders-react/src/shaders');
const aliases = { 'mesh-gradient': 'mesh', 'simplex-noise': 'simplex' };
const common = new Set([
  'speed',
  'frame',
  'fit',
  'scale',
  'rotation',
  'offsetX',
  'offsetY',
  'originX',
  'originY',
  'worldWidth',
  'worldHeight',
]);
const records = {};
const missing = [];
const label = (value) =>
  value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());

for (const file of (await readdir(directory))
  .filter((name) => name.endsWith('.tsx'))
  .sort()) {
  const slug = file.replace('.tsx', '');
  const source = await readFile(resolve(directory, file), 'utf8');
  const shaderSource = await readFile(
    resolve(upstream, `packages/shaders/src/shaders/${slug}.ts`),
    'utf8',
  );
  const componentMatch = /export const (\w+): React\.FC/.exec(source);
  if (!componentMatch) throw new Error(`No component declaration: ${slug}`);
  const component = componentMatch[1];
  const prefix = source
    .slice(0, componentMatch.index)
    .replace(/import[\s\S]*?from ['"][^'"]+['"];\s*/g, '');
  const exports = [...prefix.matchAll(/export const (\w+)/g)].map(
    (match) => match[1],
  );
  const code = new Bun.Transpiler({ loader: 'tsx' })
    .transformSync(prefix)
    .replace(/\bexport\s+/g, '');
  const data = new Function(
    ...Object.keys(Paper),
    `${code}; return {${exports.join(',')}};`,
  )(...Object.values(Paper));
  const presets = Object.values(data).find(
    (value) => Array.isArray(value) && value.every((item) => item.params),
  );
  if (!presets?.length || !data.defaultPreset)
    throw new Error(`Missing presets for ${slug}`);
  // Paper still stores the shorthand alongside its four expanded margin values.
  // Canonical editor state uses the four real shader uniforms.
  for (const preset of presets) {
    if (typeof preset.params.margin === 'number') {
      for (const side of ['Left', 'Right', 'Top', 'Bottom'])
        preset.params[`margin${side}`] ??= preset.params.margin;
      delete preset.params.margin;
    }
  }
  const fragment = `${component[0].toLowerCase()}${component.slice(1)}FragmentShader`;
  if (!Paper[fragment]) throw new Error(`Missing shader export ${fragment}`);
  const annotations = Object.fromEntries(
    [...shaderSource.matchAll(/\* - (u_\w+) \([^\n]+?\): ([^\n]+)/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const rules = {};
  for (const match of source.matchAll(/^\s+(u_\w+): (.+)/gm)) {
    const uniform = match[1];
    const expression = match[2].replace(/,\s*$/, '').split(' ?? ')[0];
    let key = expression;
    let type = 'value';
    let options;
    if (/getShaderColorFromString\(/.test(expression)) {
      type = 'color';
      key = /\((\w+)\)/.exec(expression)[1];
    } else if (/\.map\(getShaderColorFromString\)/.test(expression)) {
      type = 'colors';
      key = expression.split('.')[0];
    } else if (/\.length$/.test(expression)) {
      type = 'count';
      key = expression.split('.')[0];
    } else if (expression === 'getShaderNoiseTexture()') {
      type = 'noise';
      key = 'noiseTexture';
    } else if (/Boolean\(/.test(expression)) {
      type = 'boolean';
      key = /\((\w+)\)/.exec(expression)[1];
    } else if (/\w+\[\w+\]/.test(expression)) {
      const [, enumeration, property] = /(\w+)\[(\w+)\]/.exec(expression);
      type = 'enum';
      key = property;
      options = Paper[enumeration];
      if (!options) throw new Error(`Unknown enum ${enumeration}`);
    } else if (uniform === 'u_image') {
      type = 'image';
      key = 'image';
    }
    rules[uniform] = { key, type, ...(options ? { options } : {}) };
  }
  const defaults = { ...data.defaultPreset.params };
  const fields = [];
  for (const [uniform, rule] of Object.entries(rules)) {
    const key = rule.key;
    if (
      common.has(key) ||
      ['colors', 'image', 'noiseTexture'].includes(key) ||
      rule.type === 'count'
    )
      continue;
    if (fields.some((field) => field.key === key)) continue;
    const description = annotations[uniform] ?? label(key);
    const value = defaults[key];
    const type =
      rule.type === 'color'
        ? 'color'
        : rule.type === 'enum'
          ? 'enum'
          : typeof value === 'boolean'
            ? 'boolean'
            : 'number';
    const field = { key, label: label(key), type, description };
    if (type === 'enum') field.options = Object.keys(rule.options);
    if (type === 'number') {
      const range = /(-?\d*\.?\d+)\s+to\s+(-?\d*\.?\d+)/.exec(description);
      const values = presets
        .map((preset) => preset.params[key])
        .filter((item) => typeof item === 'number');
      if (!range)
        missing.push(`${slug}.${key}: ${description} [presets: ${values}]`);
      field.min = Math.min(range ? Number(range[1]) : 0, ...values);
      field.max = Math.max(range ? Number(range[2]) : 1, ...values);
      field.step =
        /integer/i.test(description) ||
        /^(count|bandCount|foldCount|octaveCount|stepsPerColor|colorSteps|swirlIterations|noiseIterations|spots)$/.test(
          key,
        )
          ? 1
          : 0.01;
      if (value === undefined)
        throw new Error(`Missing default: ${slug}.${key}`);
    }
    fields.push(field);
  }
  const category = [
    'fluted-glass',
    'halftone-cmyk',
    'halftone-dots',
    'image-dithering',
    'lens-distortion',
    'paper-texture',
    'water',
  ].includes(slug)
    ? 'Image filters'
    : ['gem-smoke', 'heatmap', 'liquid-metal'].includes(slug)
      ? 'Logo effects'
      : /gradient/.test(slug)
        ? 'Gradients'
        : 'Patterns';
  records[aliases[slug] ?? slug] = {
    slug,
    name: label(component).replace('Cmyk', 'CMYK'),
    component,
    fragment,
    category,
    mipmaps: [
      ...(source.match(/mipmaps=\{\[([^\]]*)\]\}/)?.[1] ?? '').matchAll(
        /['"]([^'"]+)['"]/g,
      ),
    ].map((match) => match[1]),
    maxColors: Number(
      /uniform vec4 u_colors\[(\d+)\]/.exec(Paper[fragment])?.[1] ?? 0,
    ),
    hasImage: Object.values(rules).some((rule) => rule.type === 'image'),
    defaults,
    fields,
    rules,
    presets,
  };
}
const output = resolve(import.meta.dir, '../src/paper-catalog.js');
await Bun.write(
  output,
  `// Generated from Paper Shaders ${version}. See scripts/sync-paper.js.\n// Paper's Apache-2.0 LICENSE and NOTICE are in data/third-party/.\nexport const PAPER_SHADERS = ${JSON.stringify(records, null, 2)};\n`,
);
console.log(`Generated ${Object.keys(records).length} shader definitions.`);
if (missing.length) console.log(`Ranges to verify:\n${missing.join('\n')}`);
