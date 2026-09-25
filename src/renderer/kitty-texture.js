// Kitty has no external texture bindings. Package texels as read-only shader data
// and reproduce WebGL's clamp-to-edge, bilinear and trilinear sampling.
// A 256-color palette bounds driver compilation work. Noise is already paletted
// and stays byte-exact; image copies use weighted median-cut in RGBA space.
export function quantizePixels(pixels) {
  const histogram = new Map();
  for (const color of pixels)
    histogram.set(color, (histogram.get(color) ?? 0) + 1);
  if (histogram.size <= 256) return pixels;
  function bucket(colors) {
    const ranges = [0, 8, 16, 24].map((shift) => {
      let low = 255,
        high = 0;
      for (const color of colors) {
        const c = (color >>> shift) & 255;
        low = Math.min(low, c);
        high = Math.max(high, c);
      }
      return high - low;
    });
    const range = Math.max(...ranges);
    return {
      colors,
      shift: ranges.indexOf(range) * 8,
      score:
        range * Math.sqrt(colors.reduce((n, c) => n + histogram.get(c), 0)),
    };
  }
  const buckets = [bucket([...histogram.keys()])];
  while (buckets.length < 256) {
    let at = 0;
    for (let i = 1; i < buckets.length; i++)
      if (buckets[i].score > buckets[at].score) at = i;
    const { colors, shift, score } = buckets[at];
    if (!score) break;
    colors.sort((a, b) => ((a >>> shift) & 255) - ((b >>> shift) & 255));
    const half = colors.reduce((n, c) => n + histogram.get(c), 0) / 2;
    let split = 0,
      weight = 0;
    while (split < colors.length - 1 && weight < half)
      weight += histogram.get(colors[split++]);
    buckets.splice(
      at,
      1,
      bucket(colors.slice(0, split)),
      bucket(colors.slice(split)),
    );
  }
  const mapping = new Map();
  for (const { colors } of buckets) {
    const weight = colors.reduce((n, c) => n + histogram.get(c), 0);
    let average = 0;
    for (const shift of [0, 8, 16, 24]) {
      const sum = colors.reduce(
        (n, c) => n + ((c >>> shift) & 255) * histogram.get(c),
        0,
      );
      average |= Math.round(sum / weight) << shift;
    }
    for (const color of colors) mapping.set(color, average >>> 0);
  }
  return pixels.map((c) => mapping.get(c));
}

function encodedTexture(texture, id) {
  const values = quantizePixels(
    texture.levels.flatMap((level) => Array.from(level.pixels)),
  );
  const palette = [...new Set(values)];
  const indices = new Map(palette.map((color, i) => [color, i]));
  const packed = Array.from(
    { length: Math.ceil(values.length / 4) },
    (_, i) => {
      let word = 0;
      for (let j = 0; j < 4; j++)
        word |= (indices.get(values[i * 4 + j]) ?? 0) << (j * 8);
      return `${word >>> 0}u`;
    },
  );
  // Keep sixteen palette indices per uint4. Large scalar arrays make cold
  // driver compilation stall Kitty's event loop during configuration reload.
  const vectors = Array.from(
    { length: Math.ceil(packed.length / 4) },
    (_, i) =>
      `uint4(${Array.from({ length: 4 }, (_, j) => packed[i * 4 + j] ?? '0u').join(',')})`,
  );
  return {
    data: `static const uint palette${id}[${palette.length}] = {${palette.map((v) => `${v}u`).join(',')}};
static const uint4 pixels${id}[${vectors.length}] = {${vectors.join(',')}};`,
    lookup: (index) =>
      `palette${id}[(pixels${id}[${index} / 16][(${index} / 4) % 4] >> ((${index} % 4)*8)) & 255u]`,
    length: values.length,
  };
}

export function textureAssets(textures) {
  return textures.map((texture, id) => {
    const { data, lookup, length } = encodedTexture(texture, id);
    const width = texture.levels[0].width;
    const height = Math.ceil(length / width);
    return `#language slang 2026
import kitty_custom_shader_types;
${data}
public float4 fragment_main(float4 color, KittyTextures t, KittyCustomShaderData d) {
  int2 p = clamp(int2(t.pos * float2(${width},${height})),int2(0),int2(${width - 1},${height - 1}));
  int index = min(p.y * ${width} + p.x, ${length - 1});
  uint c = ${lookup('index')};
  return float4(c & 255u,(c >> 8) & 255u,(c >> 16) & 255u,c >> 24) / 255.0;
}
`;
  });
}

export function textureSource(textures, inline = false) {
  if (!textures.length) return '';
  if (inline && textures.length !== 1)
    throw new Error('Only one texture can be embedded in a Kitty shader.');
  const inlineData = inline ? encodedTexture(textures[0], 0) : null;
  const sources = textures.map((texture, id) => {
    let offset = 0;
    const levels = texture.levels;
    const cases = levels
      .map((level, index) => {
        const base = offset;
        offset += level.width * level.height;
        return `case ${index}: size = int2(${level.width},${level.height}); base = ${base}; break;`;
      })
      .join('\n');
    const width = levels[0].width;
    const height = Math.ceil(offset / width);
    const texel = inlineData
      ? `uint c = ${inlineData.lookup('i')};
  return float4(c & 255u,(c >> 8) & 255u,(c >> 16) & 255u,c >> 24) / 255.0;`
      : `float2 uv = (float2(i % ${width}, i / ${width}) + 0.5) / float2(${width},${height});
  uv = (floor(uv * t.resolution) + 0.5) / t.resolution;
  return t.kitty.${id === 0 ? 'a' : 'b'}.Sample(uv);`;
    return `
float4 pixel${id}(PaperTextures t, int2 p, int2 size, int base) {
  p = clamp(p,int2(0),size-1);
  int i = base + p.y * size.x + p.x;
  ${texel}
}
float4 level${id}(PaperTextures t, float2 uv, int level) {
  int2 size = int2(1); int base = 0;
  switch(level) { ${cases} }
  float2 p = saturate(uv) * float2(size) - 0.5;
  int2 i = int2(floor(p)); float2 f = frac(p);
  return lerp(lerp(pixel${id}(t,i,size,base),pixel${id}(t,i+int2(1,0),size,base),f.x),
              lerp(pixel${id}(t,i+int2(0,1),size,base),pixel${id}(t,i+int2(1,1),size,base),f.x),f.y);
}
float4 sample${id}(PaperTextures t, float2 uv, float lod) {
  lod = clamp(lod,0.0,${levels.length - 1}.0); int l = int(floor(lod));
  return lerp(level${id}(t,uv,l),level${id}(t,uv,min(l+1,${levels.length - 1})),frac(lod));
}`;
  });
  return `${inlineData ? `${inlineData.data}\n` : ''}struct PaperTextures { KittyTextures kitty; float2 resolution; };
${sources.join('\n')}
int2 textureSize(PaperTextures t, int tex, int lod) {
  ${textures.map((t, i) => `if (tex == ${i}) return max(int2(1), int2(${t.originalWidth ?? t.levels[0].width},${t.originalHeight ?? t.levels[0].height}) >> lod);`).join('\n')}
  return int2(1);
}
float4 textureLod(PaperTextures t, int tex, float2 uv, float lod) {
  ${textures.map((_t, i) => `if (tex == ${i}) return sample${i}(t,uv,lod);`).join('\n')}
  return float4(0);
}
float4 textureGrad(PaperTextures t, int tex, float2 uv, float2 dx, float2 dy) {
  float2 size = float2(1);
  ${textures.map((t, i) => `if (tex == ${i}) size = float2(${t.levels[0].width},${t.levels[0].height});`).join('\n')}
  float lod = log2(max(0.00001,max(length(dx*size),length(dy*size))));
  return textureLod(t,tex,uv,lod);
}
float4 texture(PaperTextures t, int tex, float2 uv) { return textureGrad(t,tex,uv,ddx(uv),ddy(uv)); }
`;
}

export function packPixels(bytes) {
  const pixels = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < pixels.length; i++) {
    const j = i * 4;
    pixels[i] =
      (bytes[j] |
        (bytes[j + 1] << 8) |
        (bytes[j + 2] << 16) |
        (bytes[j + 3] << 24)) >>>
      0;
  }
  return pixels;
}

export function kittyTextures(uniforms, definition) {
  return Object.entries(definition.rules)
    .filter(([, rule]) => ['image', 'noise'].includes(rule.type))
    .map(([name]) => {
      const image = uniforms[name];
      const canvas = document.createElement('canvas');
      const ratio = Math.min(
        1,
        128 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const levels = [];
      for (;;) {
        levels.push({
          width: canvas.width,
          height: canvas.height,
          pixels: packPixels(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
          ),
        });
        if (
          !definition.mipmaps.includes(name) ||
          (canvas.width === 1 && canvas.height === 1)
        )
          break;
        const next = document.createElement('canvas');
        next.width = Math.max(1, Math.floor(canvas.width / 2));
        next.height = Math.max(1, Math.floor(canvas.height / 2));
        next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height);
        canvas.width = next.width;
        canvas.height = next.height;
        context.drawImage(next, 0, 0);
      }
      return {
        name,
        originalWidth: image.naturalWidth,
        originalHeight: image.naturalHeight,
        aspectRatio: image.naturalWidth / image.naturalHeight,
        levels,
      };
    });
}
