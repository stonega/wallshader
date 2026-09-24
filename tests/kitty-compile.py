"""Run with Kitty's own Python/compiler; no GUI, sockets or live configuration."""
import pathlib
import sys

from kitty.shaders.slang import build_custom_shader_pipeline_glsl, parse_pipeline

directory = pathlib.Path(sys.argv[2])
pipelines = sorted(directory.glob('*/wallshader.pipeline'))
assert pipelines
for path in pipelines:
    vertex, fragment, _ = build_custom_shader_pipeline_glsl(
        parse_pipeline(str(path)), str(directory / 'compiled' / path.parent.name)
    )
    assert 'void main(' in vertex and 'void main(' in fragment
    print(f'Compiled Kitty pipeline: {path.parent.name}', flush=True)
print(f'Compiled {len(pipelines)} Kitty pipelines successfully.')
