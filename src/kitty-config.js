import { PAPER_SHADERS } from './paper-catalog.js';

// Keep the user's configuration outside this block byte-for-byte intact.
const BEGIN = '# BEGIN WALLSHADER';
const END = '# END WALLSHADER';

function blockRange(source) {
  const starts = [...source.matchAll(/^# BEGIN WALLSHADER\r?$/gm)];
  const ends = [...source.matchAll(/^# END WALLSHADER\r?$/gm)];
  if (!starts.length && !ends.length) return null;
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    starts[0].index >= ends[0].index
  )
    throw new Error(
      'The Wallshader block in kitty.conf is incomplete or duplicated. Repair it before applying again.',
    );
  const end = ends[0].index + ends[0][0].length;
  return [starts[0].index, end + (source[end] === '\n' ? 1 : 0)];
}

export function hasKittyBackground(source) {
  return blockRange(source) !== null;
}

export function removeKittyBackground(source) {
  const range = blockRange(source);
  return range ? source.slice(0, range[0]) + source.slice(range[1]) : source;
}

export function kittyBackgroundConfig(source, imagePath, pipelinePath = null) {
  for (const path of [imagePath, pipelinePath].filter(Boolean))
    if (!path.startsWith('/') || /[\r\n\0$]/.test(path))
      throw new Error(
        'Kitty background paths must be absolute and cannot contain newlines or dollar signs.',
      );
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  // background_image is a glob, not a shell-quoted argument. Escape glob metacharacters.
  const image = imagePath.replace(/[[?*]/g, (char) => `[${char}]`);
  const lines = [
    BEGIN,
    '# Managed by Wallshader. Use Restore Kitty Background to remove these settings.',
    `background_image ${pipelinePath ? 'none' : image}`,
    'background_image_layout cscaled',
    'background_image_linear yes',
    'background_tint 0.65',
  ];
  if (pipelinePath)
    lines.push(`custom_shaders '${pipelinePath.replaceAll("'", "'\\''")}'`);
  lines.push(END, '');
  const block = lines.join(newline);
  // Put our overrides last, including on reapply; earlier include directives stay intact.
  const rest = removeKittyBackground(source);
  return rest + (rest && !rest.endsWith('\n') ? newline : '') + block;
}

export const KITTY_ANIMATED_SHADERS = new Set(Object.keys(PAPER_SHADERS));
