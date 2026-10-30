import { _ } from './translation.js';

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_SETTINGS_LENGTH = 45 * 1024 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';

export function embeddedImagePayload(source) {
  const payload =
    typeof source === 'string' && source.startsWith(PNG_PREFIX)
      ? source.slice(PNG_PREFIX.length)
      : '';
  const size =
    (payload.length / 4) * 3 - (payload.match(/=+$/)?.[0].length ?? 0);
  if (
    !payload ||
    payload.length % 4 !== 0 ||
    size > MAX_IMAGE_BYTES ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  )
    throw new Error(_('Use an embedded PNG image smaller than 32 MB.'));
  return payload;
}
