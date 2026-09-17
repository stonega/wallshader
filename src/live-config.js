import { PRESETS, normalizePreset } from './catalog.js';

export const EXTENSION_UUID = 'wallshader@wallshader.github.io';
export const LIVE_PATH = '/io/github/wallshader/Live';
export const LIVE_INTERFACE = 'io.github.wallshader.Live';
export const RENDERER_ID = 'io.github.wallshader.Renderer';
export const RENDERER_PATH = '/io/github/wallshader/Renderer';
export const LIVE_XML = `<node><interface name="${LIVE_INTERFACE}">
  <method name="GetStatus"><arg direction="out" type="s" name="status"/></method>
  <method name="Apply"><arg direction="in" type="s" name="configuration"/></method>
  <method name="Stop"/>
  <method name="SetPaused"><arg direction="in" type="b" name="paused"/></method>
  <signal name="Changed"><arg type="s" name="status"/></signal>
</interface></node>`;

export function normalizeLiveConfig(input = {}) {
  if (!input || typeof input !== 'object')
    throw new Error('Invalid wallpaper settings.');
  if (!PRESETS.some(({ id }) => id === input.preset?.id))
    throw new Error('Choose a wallpaper before starting animation.');
  return {
    version: 1,
    enabled: input.enabled === true,
    paused: input.paused === true,
    fps: input.fps === 60 ? 60 : 30,
    rendering: input.rendering === 'gpu' ? 'gpu' : 'compatibility',
    preset: normalizePreset(input.preset.id, input.preset),
  };
}

export function parseLiveConfig(source) {
  if (typeof source !== 'string' || source.length > 128_000)
    throw new Error('Wallpaper settings must be smaller than 128 KB.');
  return normalizeLiveConfig(JSON.parse(source));
}

export function coversMonitor(window, monitor) {
  return (
    window.x <= monitor.x &&
    window.y <= monitor.y &&
    window.x + window.width >= monitor.x + monitor.width &&
    window.y + window.height >= monitor.y + monitor.height
  );
}
