import * as Paper from '@paper-design/shaders';
const { getShaderColorFromString } = Paper;
const shaders = { ...Paper };
import {
  SHADERS,
  PRESETS,
  createPreset,
  fromPaperParams,
  paperParams,
  presetIdForShader,
} from '../src/catalog.js';
import { kittyShader } from '../src/renderer/kitty-shader.js';

const fragments = Object.fromEntries(
  Object.entries(SHADERS).map(([id, s]) => [id, shaders[s.fragment]]),
);

export function exportKittyFixture(preset) {
  const params = paperParams(preset);
  const uniforms = Object.fromEntries(
    Object.entries(SHADERS[preset.shader].rules).map(([name, rule]) => {
      const value = params[rule.key];
      if (rule.type === 'color')
        return [name, getShaderColorFromString(value.toLowerCase())];
      if (rule.type === 'colors')
        return [
          name,
          preset.colors.map((color) =>
            getShaderColorFromString(color.toLowerCase()),
          ),
        ];
      if (rule.type === 'count') return [name, preset.colors.length];
      if (rule.type === 'enum') return [name, rule.options[value]];
      return [name, value];
    }),
  );
  const textures = Object.entries(SHADERS[preset.shader].rules)
    .filter(([, r]) => ['image', 'noise'].includes(r.type))
    .map(([name]) => ({
      name,
      aspectRatio: 2,
      levels: [{ width: 2, height: 1, pixels: [0xff302010, 0xffa0c0e0] }],
    }));
  return kittyShader(preset, fragments[preset.shader], uniforms, 30, textures);
}

export const kittyFixtures = [
  ...PRESETS.filter((preset) => fragments[preset.shader]).map(({ id }) => [
    id,
    createPreset(id),
  ]),
  ...Object.keys(fragments).flatMap((shader) =>
    SHADERS[shader].presets.map(({ params }, index) => [
      `${shader}-${index}`,
      fromPaperParams(presetIdForShader(shader), params, index),
    ]),
  ),
  ...Object.keys(fragments).map((shader) => [
    `${shader}-position-alpha`,
    {
      ...createPreset(presetIdForShader(shader)),
      colors: ['#1234', 'rgba(23, 80, 200, 0.6)', 'hsl(90, 50%, 50%)'],
      rotation: 37,
      worldWidth: 1000,
      worldHeight: 450,
      scale: 0.4,
      originX: 0.7,
      originY: 0.3,
      offsetX: 0.2,
      offsetY: -0.3,
      fit: 'cover',
      speed: -2,
      frame: -6400,
    },
  ]),
];
