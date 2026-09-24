"""Compare real Kitty output to Paper captures, using only private test processes."""
import base64
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

from PIL import Image, ImageChops, ImageDraw, ImageStat, ImageFilter

root = Path(os.environ['WALLSHADER_KITTY_TEST_DIR'])
artifacts = Path('artifacts/kitty-render')
artifacts.mkdir(parents=True, exist_ok=True)
directories = sorted(p for p in root.iterdir() if p.is_dir())
assert len(directories) == 36, f'Expected 36 render fixtures, got {len(directories)}'
results = []
failures = []
for directory in directories:
    name = directory.name
    animated = name.startswith('animation-')
    source = (directory / 'wallshader.slang').read_text()
    # Return the Paper frame directly for a controlled visual comparison. Kitty
    # converts linear output to sRGB; flatten alpha on black as the reference does.
    if not animated:
        source = source.split('public float4 fragment_main')[0] + '''
public float4 fragment_main(float4 color, KittyTextures t, KittyCustomShaderData d) {
  return float4(paperLinear(paperFrame(t.pos,float2(d.viewport_size_pixels),0.0,t).rgb),1.0);
}
'''
    (directory / 'compare.slang').write_text(source)
    (directory / 'compare.pipeline').write_text(
        (directory / 'wallshader.pipeline').read_text().replace('shaders wallshader\n', 'shaders compare\n')
    )
    config = directory / 'kitty.conf'
    socket = root / f'{name}.sock'
    config.write_text(f'''custom_shaders {directory}/compare.pipeline
allow_remote_control socket-only
confirm_os_window_close 0
initial_window_width 320
initial_window_height 200
hide_window_decorations yes
background #101020
foreground #ffffff
''')
    started = time.monotonic()
    with (directory / 'kitty.log').open('w') as log:
        process = subprocess.Popen(
            ['kitty', '--config', str(config), '--listen-on', f'unix:{socket}',
             'sh', '-c', "printf '\033[?25lKitty shader test: readable text\\n'; sleep 240"],
            stdout=log, stderr=log,
            env={**os.environ, 'KITTY_CONFIG_DIRECTORY': str(directory), 'KITTY_LISTEN_ON': ''},
        )
        try:
            deadline = time.monotonic() + 90
            while not socket.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.1)
            if not socket.exists():
                raise AssertionError('Kitty startup timed out')
            time.sleep(1)

            def screenshot(path):
                subprocess.run(
                    ['kitty', '@', '--to', f'unix:{socket}', 'screenshot', str(path)],
                    check=True, timeout=20, stdout=subprocess.DEVNULL,
                )
                return Image.open(path).convert('RGB')

            actual = screenshot(directory / 'kitty.png')
            error_log = (directory / 'kitty.log').read_text()
            if 'Failed to compile' in error_log or 'error[E' in error_log:
                raise AssertionError(error_log)
            if actual.size != (320, 200):
                raise AssertionError(f'Unexpected viewport {actual.size}')
            if animated:
                time.sleep(1)
                second = screenshot(directory / 'second.png')
                region = (0, 80, 320, 200)
                if not ImageChops.difference(actual.crop(region), second.crop(region)).getbbox():
                    raise AssertionError('Background did not animate')
                bright = sum(min(rgb) >= 240 for rgb in actual.crop((0, 0, 320, 60)).getdata())
                if bright < 20:
                    raise AssertionError('Terminal text was not preserved')
                metric = 'animated; text preserved'
            else:
                encoded = (directory / 'paper.txt').read_text().split(',')[1]
                reference = Image.open(io.BytesIO(base64.b64decode(encoded))).convert('RGBA')
                black = Image.new('RGBA', reference.size, (0, 0, 0, 255))
                black.alpha_composite(reference)
                reference = black.convert('RGB')
                reference.save(directory / 'paper.png')
                metric = sum(ImageStat.Stat(ImageChops.difference(reference, actual)).mean) / 3
                # Image optimization and float precision can differ. A wrong
                # transform, failed shader or blank frame exceeds this bound.
                image_shader = json.loads((directory / 'preset.json').read_text()).get('image')
                # Halftone coverage amplifies small changes in the optimized
                # image. Bound raw error and also compare its overall structure.
                limit = 16 if image_shader else 4
                if image_shader:
                    blurred = ImageChops.difference(
                        reference.filter(ImageFilter.GaussianBlur(2)),
                        actual.filter(ImageFilter.GaussianBlur(2)),
                    )
                    if sum(ImageStat.Stat(blurred).mean) / 3 > 6:
                        raise AssertionError('Image structure differs from Paper')
                if metric > limit:
                    raise AssertionError(f'Mean RGB error {metric:.3f} exceeds {limit}')
                shutil.copy(directory / 'paper.png', artifacts / f'{name}-paper.png')
            (artifacts / f'{name}-error.log').unlink(missing_ok=True)
            shutil.copy(directory / 'kitty.png', artifacts / f'{name}-kitty.png')
            results.append({'name': name, 'comparison': metric, 'seconds': round(time.monotonic() - started, 2)})
            print(f'Verified {name}: {metric}', flush=True)
        except Exception as error:
            failures.append(f'{name}: {error}')
            shutil.copy(directory / 'kitty.log', artifacts / f'{name}-error.log')
            print(f'FAILED {name}: {error}', flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

(artifacts / 'results.json').write_text(json.dumps({'results': results, 'failures': failures}, indent=2) + '\n')
pairs = [r for r in results if isinstance(r['comparison'], float)]
sheet = Image.new('RGB', (5 * 320, ((len(pairs) + 4) // 5) * 120), '#222222')
draw = ImageDraw.Draw(sheet)
for index, result in enumerate(pairs):
    x, y = (index % 5) * 320, (index // 5) * 120
    for offset, suffix in [(0, 'paper'), (160, 'kitty')]:
        picture = Image.open(artifacts / f"{result['name']}-{suffix}.png")
        sheet.paste(picture.resize((160, 100)), (x + offset, y + 20))
    draw.text((x + 4, y + 3), result['name'], fill='white')
sheet.save(artifacts / 'comparison.png')
if failures:
    raise SystemExit('\n'.join(failures))
print(f'Verified {len(results)} real Kitty renders. Comparisons: {artifacts}/comparison.png')
