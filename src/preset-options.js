import {
  SHADERS,
  createPreset,
  fromPaperParams,
  normalizePreset,
  paperParams,
} from './catalog.js';

export function presetFingerprint(preset) {
  const normalized = normalizePreset(preset.id, preset);
  return JSON.stringify([normalized.shader, paperParams(normalized)]);
}

export function randomPresetName(
  preset,
  savedPresets = [],
  random = Math.random,
) {
  const names = new Set(
    savedPresets
      .filter((saved) => saved.preset.shader === preset.shader)
      .map((saved) => saved.name.toUpperCase()),
  );
  let color = Math.floor(random() * 0x1000000);
  for (let attempt = 0; attempt < 0x1000000; attempt++) {
    const name = `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
    if (!names.has(name)) return name;
    color = (color + 1) % 0x1000000;
  }
  throw new Error('No unused hex color names remain for this shader.');
}

export function presetOptions(preset, savedPresets = []) {
  return [
    { key: 'default', name: 'Original', preset: createPreset(preset.id) },
    ...SHADERS[preset.shader].presets.map((variant, index) => ({
      key: `paper:${index}`,
      name: variant.name,
      index,
      preset: fromPaperParams(
        preset.id,
        { ...variant.params, image: preset.image },
        index,
      ),
    })),
    ...savedPresets
      .filter((saved) => saved.preset.shader === preset.shader)
      .map((saved) => ({
        key: `saved:${saved.id}`,
        name: saved.name,
        savedId: saved.id,
        preset: normalizePreset(preset.id, saved.preset),
      })),
  ];
}

export function selectedPresetKey(options, preset, preferredKey) {
  const fingerprint = presetFingerprint(preset);
  const matches = options.filter(
    (option) => presetFingerprint(option.preset) === fingerprint,
  );
  return (
    (
      matches.find((option) => option.key === preferredKey) ??
      matches.find((option) => option.savedId) ??
      matches.find((option) => option.index === preset.paperPreset) ??
      matches[0]
    )?.key ?? null
  );
}
