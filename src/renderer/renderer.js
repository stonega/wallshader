import * as Paper from '@paper-design/shaders';
import { createFrameClock } from './frame-clock.js';
import { createFrameStats } from './frame-stats.js';
import { kittyShader } from './kitty-shader.js';
import { kittyTextures } from './kitty-texture.js';
import sampleImage from './sample.webp';
import {
  PRESETS,
  SHADERS,
  normalizePreset,
  paperParams,
  validateDimensions,
} from '../catalog.js';
const { ShaderMount } = Paper;
let mount;
let preset;
let paused = false;
let busy = false;
let liveFps = 0;
let liveFrame = null;
let debugTimer = null;
let debugFrame = null;
let frameStats;

function resetFrameStats() {
  if (debugTimer !== null)
    frameStats = createFrameStats(performance.now(), mount?.getCurrentFrame());
}

function reportDebugInfo() {
  if (!mount) return;
  const canvas = mount.canvasElement;
  const gl = canvas.getContext('webgl2');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  send({
    type: 'diagnostics',
    ...frameStats.snapshot(performance.now()),
    shader: SHADERS[preset.shader].name,
    preset: preset.id,
    viewport: [window.innerWidth, window.innerHeight],
    scale: window.devicePixelRatio,
    canvas: [canvas.width, canvas.height],
    targetFps: liveFps,
    paused,
    busy,
    speed: preset.speed,
    frame: mount.getCurrentFrame(),
    contextLost: gl.isContextLost(),
    gpu:
      gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ??
      'Unavailable',
  });
}

function debug(enabled) {
  if (debugTimer !== null) clearInterval(debugTimer);
  if (debugFrame !== null) cancelAnimationFrame(debugFrame);
  debugTimer = null;
  debugFrame = null;
  frameStats = null;
  if (!enabled) return;
  debugTimer = setInterval(reportDebugInfo, 1000);
  resetFrameStats();
  const observe = () => {
    frameStats.observe(mount?.getCurrentFrame());
    debugFrame = requestAnimationFrame(observe);
  };
  debugFrame = requestAnimationFrame(observe);
  reportDebugInfo();
}

function updatePlayback() {
  resetFrameStats();
  if (liveFrame !== null) cancelAnimationFrame(liveFrame);
  liveFrame = null;
  mount?.setSpeed(liveFps || paused ? 0 : preset.speed);
  if (!mount || !liveFps || paused || !preset.speed) return;
  const advance = createFrameClock(liveFps, performance.now());
  const render = (now) => {
    const elapsed = advance(now);
    if (elapsed > 0)
      mount.setFrame(mount.getCurrentFrame() + elapsed * preset.speed);
    liveFrame = requestAnimationFrame(render);
  };
  liveFrame = requestAnimationFrame(render);
}

function send(message) {
  window.webkit?.messageHandlers.wallshader.postMessage(
    JSON.stringify(message),
  );
}

const imageCache = new Map();
let generation = 0;
let currentUniforms;
let currentImageSource = '';

function dispose(shader) {
  if (!shader) return;
  const context = shader.canvasElement.getContext('webgl2');
  shader.dispose();
  // Paper disposes its objects; release the context too when browsing the catalog.
  context?.getExtension('WEBGL_lose_context')?.loseContext();
}

async function loadImage(source) {
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

async function shaderImage(state, data) {
  const key = `${state.shader}:${state.image}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const source =
    data ?? (state.image === 'sample' ? sampleImage : Paper.emptyPixel);
  if (state.image.startsWith('file:///') && !data)
    throw new Error('Choose the image again to reload this effect.');
  const processor = {
    heatmap: Paper.toProcessedHeatmap,
    'liquid-metal': Paper.toProcessedLiquidMetal,
    'gem-smoke': Paper.toProcessedGemSmoke,
  }[state.shader];
  if (processor && state.image) {
    const result = await processor(source);
    const url = URL.createObjectURL(result.pngBlob ?? result.blob);
    try {
      const image = await loadImage(url);
      imageCache.set(key, image);
    } finally {
      URL.revokeObjectURL(url);
    }
  } else imageCache.set(key, await loadImage(source));
  if (imageCache.size > 8) imageCache.delete(imageCache.keys().next().value);
  return imageCache.get(key);
}

let noise;
async function uniforms(state, imageData) {
  const values = paperParams(state);
  const result = {};
  for (const [uniform, rule] of Object.entries(SHADERS[state.shader].rules)) {
    const value = values[rule.key];
    if (rule.type === 'color')
      result[uniform] = Paper.getShaderColorFromString(value.toLowerCase());
    else if (rule.type === 'colors')
      result[uniform] = state.colors.map((color) =>
        Paper.getShaderColorFromString(color.toLowerCase()),
      );
    else if (rule.type === 'count') result[uniform] = state.colors.length;
    else if (rule.type === 'enum') result[uniform] = rule.options[value];
    else if (rule.type === 'boolean')
      result[uniform] = Boolean(state[rule.key]);
    else if (rule.type === 'image')
      result[uniform] = await shaderImage(state, imageData);
    else if (rule.type === 'noise') {
      if (!noise) {
        noise = Paper.getShaderNoiseTexture();
        await noise.decode();
      }
      result[uniform] = noise;
    } else result[uniform] = value;
  }
  return result;
}

async function select(input) {
  const revision = ++generation;
  const next = normalizePreset(input.id, input);
  const nextUniforms = await uniforms(next, input.imageData);
  if (revision !== generation) return;
  const changed =
    !preset || next.id !== preset.id || next.shader !== preset.shader;
  if (changed) {
    dispose(mount);
    document.getElementById('preview').replaceChildren();
    mount = new ShaderMount(
      document.getElementById('preview'),
      Paper[SHADERS[next.shader].fragment],
      nextUniforms,
      // Every frame replaces the full canvas. Only the separate PNG capture
      // needs a preserved buffer; the fullscreen quad needs no MSAA or depth.
      {
        preserveDrawingBuffer: false,
        antialias: false,
        depth: false,
        alpha: true,
      },
      0,
      next.frame,
      1,
      1920 * 1080,
      SHADERS[next.shader].mipmaps,
    );
  } else {
    mount.setUniforms(nextUniforms);
    if (next.frame !== preset.frame) mount.setFrame(next.frame);
  }
  preset = next;
  currentUniforms = nextUniforms;
  currentImageSource = input.imageData;
  updatePlayback();
}

async function capture(input, width, height, frame, imageData) {
  validateDimensions(width, height);
  const container = document.getElementById('capture');
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  let still;
  try {
    const captureUniforms =
      input === preset ? currentUniforms : await uniforms(input, imageData);
    still = new ShaderMount(
      container,
      Paper[SHADERS[input.shader].fragment],
      captureUniforms,
      { preserveDrawingBuffer: true, alpha: true },
      0,
      frame,
      1,
      width * height,
      SHADERS[input.shader].mipmaps,
    );
    // Capture synchronously before ResizeObserver: WebKit suspends frame callbacks
    // when obscured. A fresh ShaderMount has a pixel ratio of 1; setFrame uploads
    // its canvas resolution and draws immediately, independent of window scaling.
    const canvas = still.canvasElement;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('webgl2').viewport(0, 0, width, height);
    still.setFrame(frame);
    return canvas.toDataURL('image/png');
  } finally {
    dispose(still);
    container.replaceChildren();
  }
}

window.wallshader = {
  select,
  debug,
  pause(value) {
    paused = value;
    updatePlayback();
  },
  async request(id, method, args = {}) {
    if (busy) {
      send({ type: 'response', id, error: 'A render is already in progress.' });
      return;
    }
    busy = true;
    try {
      let result;
      if (method === 'live') {
        liveFps = args.fps === 60 ? 60 : 30;
        updatePlayback();
        result = true;
      } else if (method === 'select') {
        await select(args.preset);
        result = true;
      } else if (method === 'capture')
        result = await capture(
          preset,
          args.width,
          args.height,
          args.frame ?? mount.getCurrentFrame(),
          currentImageSource,
        );
      else if (method === 'thumbnail') {
        const item = normalizePreset(args.preset.id, args.preset);
        result = await capture(
          item,
          384,
          216,
          item.frame,
          args.preset.imageData,
        );
      } else if (method === 'kitty-shader') {
        const item = normalizePreset(args.preset.id, args.preset);
        const values = await uniforms(item, args.preset.imageData);
        result = kittyShader(
          item,
          Paper[SHADERS[item.shader].fragment],
          values,
          args.fps,
          kittyTextures(values, SHADERS[item.shader]),
        );
      } else if (method === 'state')
        result = { ...preset, frame: mount.getCurrentFrame() };
      else throw new Error(`Unknown renderer operation: ${method}`);
      send({ type: 'response', id, result });
    } catch (error) {
      send({ type: 'response', id, error: error.message });
    } finally {
      busy = false;
    }
  },
};

window.addEventListener('error', (event) =>
  send({ type: 'error', message: event.message }),
);
window.addEventListener('unhandledrejection', (event) =>
  send({ type: 'error', message: String(event.reason) }),
);
select(PRESETS[0])
  .then(() => send({ type: 'ready' }))
  .catch((error) => send({ type: 'error', message: error.message }));
