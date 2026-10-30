import { _, format } from './translation.js';
import { SHADERS, paperParams } from './catalog.js';
import { embeddedImagePayload, MAX_SETTINGS_LENGTH } from './image-data.js';

export function exportSettings(preset) {
  const params = paperParams(preset);
  if (params.image && params.image !== 'sample') {
    const image = preset.imageData ?? params.image;
    embeddedImagePayload(image);
    params.image = image;
  }
  return JSON.stringify(
    {
      format: 'wallshader-paper',
      version: 1,
      shader: preset.shader,
      params,
    },
    null,
    2,
  );
}

export function paperCode(preset, { width, height }) {
  const definition = SHADERS[preset.shader];
  const properties = { width, height, ...paperParams(preset) };
  const lines = Object.entries(properties).map(
    ([key, value]) => `  ${key}={${JSON.stringify(value)}}`,
  );
  return `import { ${definition.component} } from '@paper-design/shaders-react';\n\n<${definition.component}\n${lines.join('\n')}\n/>`;
}

export function parseSettings(input) {
  if (typeof input !== 'string' || input.length > MAX_SETTINGS_LENGTH)
    throw new Error(
      _(
        'Paste a Paper code snippet or a Wallshader settings file smaller than 45 MB.',
      ),
    );
  const source = input.trim();
  let shader;
  let params;
  if (source.startsWith('{')) {
    const data = JSON.parse(source);
    shader = data.shader;
    params = data.params;
    if (data.format !== 'wallshader-paper' || data.version !== 1)
      throw new Error(_('This is not a supported Wallshader settings file.'));
  } else {
    const component = /<(\w+)\s+([\s\S]*?)\s*\/>/.exec(source);
    if (!component)
      throw new Error(
        _(
          'Paste the complete self-closing shader component from Paper’s Code section.',
        ),
      );
    shader = Object.keys(SHADERS).find(
      (key) =>
        SHADERS[key].component.toLowerCase() === component[1].toLowerCase(),
    );
    params = {};
    let remaining = component[2];
    const attribute =
      /^\s*(\w+)(?:\s*=\s*(\{[^{}]*\}|"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'))?(?=\s|$)/;
    while (remaining.trim()) {
      const match = attribute.exec(remaining);
      if (!match)
        throw new Error(
          _(
            'Only literal shader values are supported; JavaScript expressions are never executed.',
          ),
        );
      let value = match[2];
      if (value === undefined) {
        if (
          !SHADERS[shader]?.fields.some(
            (field) => field.key === match[1] && field.type === 'boolean',
          )
        )
          throw new Error(
            format(_('Provide a literal value for {property}.'), {
              property: match[1],
            }),
          );
        params[match[1]] = true;
        remaining = remaining.slice(match[0].length);
        continue;
      }
      if (value.startsWith('{')) value = value.slice(1, -1).trim();
      if (value.startsWith("'") && value.endsWith("'"))
        params[match[1]] = value.slice(1, -1);
      else {
        try {
          params[match[1]] = JSON.parse(value);
        } catch {
          throw new Error(
            format(
              _(
                'Use a literal number, color, boolean, or JSON array for {property}.',
              ),
              { property: match[1] },
            ),
          );
        }
      }
      remaining = remaining.slice(match[0].length);
    }
  }
  if (
    !Object.hasOwn(SHADERS, shader) ||
    !params ||
    Array.isArray(params) ||
    typeof params !== 'object'
  )
    throw new Error(
      _('The settings do not identify a supported Paper shader.'),
    );
  if (params.image !== undefined) {
    if (typeof params.image !== 'string')
      throw new Error(_('The image property must be a string.'));
    if (params.image.startsWith('data:')) embeddedImagePayload(params.image);
    else if (
      !['sample', ''].includes(params.image) &&
      !params.image.startsWith('file:///')
    )
      throw new Error(
        _(
          'This snippet uses an external image. Remove its image property, then choose a local image in Wallshader.',
        ),
      );
  }
  return { shader, params };
}
