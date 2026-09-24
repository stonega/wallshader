// GLSL operations used by the pinned Paper 0.0.81 sources. In particular, GLSL
// matrices contain columns and * is matrix multiplication, unlike Slang's *.
export const kittyCompat = `
struct mat2 {
  float2 c0, c1;
  __init(float a, float b, float c, float d) { c0 = float2(a,b); c1 = float2(c,d); }
};
mat2 transpose(mat2 m) { return mat2(m.c0.x,m.c1.x,m.c0.y,m.c1.y); }
float2 operator*(mat2 m, float2 v) { return m.c0 * v.x + m.c1 * v.y; }
float2 operator*(float2 v, mat2 m) { return float2(dot(v,m.c0), dot(v,m.c1)); }
float glslAtan(float y, float x) { return atan2(y,x); }
float glslAtan(float x) { return atan(x); }
${['float', 'float2', 'float3', 'float4'].map((type) => `${type} mod(${type} x, ${type} y) { return x - y * floor(x/y); }`).join('\n')}
`;

// Deliberately scoped to the pinned catalog, with compilation/rendering fixtures
// for every shader. Unsupported syntax must fail instead of changing its meaning.
export function convertPaper(source) {
  let depth = 0;
  return (
    source
      .replace(/^#version .*$/m, '')
      .replace(/^precision .*;$/gm, '')
      .replace(/\b(?:lowp|mediump|highp)\s+/g, '')
      .replace(/^#define PI .*$/gm, '#define PI 3.14159265358979323846')
      .replace(
        /\b([biu]?)vec([234])\b/g,
        (_all, prefix, n) =>
          `${{ '': 'float', b: 'bool', i: 'int', u: 'uint' }[prefix]}${n}`,
      )
      .replace(/\bfract\b/g, 'frac')
      .replace(/\bmix\b/g, 'lerp')
      .replace(/\batan\b/g, 'glslAtan')
      .replace(/\bdFdx\b/g, 'ddx')
      .replace(/\bdFdy\b/g, 'ddy')
      .replace(/\binversesqrt\b/g, 'rsqrt')
      .replace(/\bsampler2D\b/g, 'int')
      .replace(/\b(float|int)\[\d+\]\(([^;]+)\)/g, '{$2}')
      .replace(/\b(uv|n) \*= m;/g, '$1 = $1 * m;')
      // GLSL globals are constants, not uninitialized Slang struct fields. Several
      // Paper declarations share a line, so line-start replacement is insufficient.
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|[{}]|\bconst\b/g, (token) => {
        if (token === '{') depth++;
        else if (token === '}') depth--;
        else if (token === 'const' && depth === 0) return 'static const';
        return token;
      })
  );
}
