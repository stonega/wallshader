"""Bound real cold shader reloads without contacting the user's Kitty or Shell."""
import json
import os
from pathlib import Path
import subprocess
import time

from PIL import Image, ImageChops, ImageStat

root = Path(os.environ['WALLSHADER_KITTY_TEST_DIR'])
assert Path(os.environ['XDG_RUNTIME_DIR']).parent == root.parent
assert os.environ['WAYLAND_DISPLAY'] == os.environ['WALLSHADER_NATIVE_DISPLAY']
directory = root / 'reload-test'
directory.mkdir()
artifacts = Path('artifacts/kitty-render')
config = directory / 'kitty.conf'
socket = directory / 'kitty.sock'
log_path = artifacts / 'reload.log'
results = []


def configure(name, opacity=1):
    # Explicit reloads give a round-trip timing of the main-loop stall. Disable
    # the watcher so it cannot perform a second reload ahead of our request.
    config.write_text(f'''custom_shaders {root / name / 'wallshader.pipeline'}
auto_reload_config -1
allow_remote_control socket-only
confirm_os_window_close 0
initial_window_width 640
initial_window_height 400
hide_window_decorations yes
background #101020
background_opacity {opacity}
dynamic_background_opacity yes
foreground #ffffff
''')


def remote(*args):
    return subprocess.run(
        ['kitty', '@', '--to', f'unix:{socket}', *args],
        check=True, capture_output=True, text=True, timeout=15,
    )


def capture(name):
    path = artifacts / f'reload-{name}.png'
    remote('screenshot', str(path.resolve()))
    return Image.open(path).convert('RGB')


configure('dithering')
with log_path.open('w') as log:
    process = subprocess.Popen(
        ['kitty', '--config', str(config), '--listen-on', f'unix:{socket}',
         'sh', '-c', "printf '\033[?25lKitty reload test: readable text\\n'; sleep 180"],
        stdout=log, stderr=log,
        env={
            **os.environ,
            'KITTY_CONFIG_DIRECTORY': str(directory),
            'KITTY_LISTEN_ON': '',
            'XDG_CACHE_HOME': str(directory / 'cache'),
            # Warm driver caches hid the original Smoke Ring stall. These
            # overrides apply only to this disposable test process.
            'MESA_SHADER_CACHE_DISABLE': 'true',
            '__GL_SHADER_DISK_CACHE': '0',
        },
    )
    try:
        deadline = time.monotonic() + 45
        while not socket.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        assert socket.exists(), 'Kitty startup failed or timed out'
        remote('ls')
        for index, name in enumerate(['animation-smoke-ring', 'dithering', 'animation-smoke-ring']):
            configure(name)
            started = time.monotonic()
            remote('load-config', str(config))
            remote('ls')
            seconds = time.monotonic() - started
            results.append({'shader': name, 'seconds': round(seconds, 3)})
            print(f'Cold Kitty reload {name}: {seconds:.3f}s', flush=True)
            # This is a responsiveness budget, not a microbenchmark: prolonged
            # event-loop stalls trigger GNOME's unresponsive-application dialog.
            assert seconds < 5, f'{name} blocked Kitty for {seconds:.3f}s (budget: 5s)'
            if name == 'animation-smoke-ring':
                first = capture(f'{index}-first')
                time.sleep(0.5)
                second = capture(f'{index}-second')
                region = (0, 80, 640, 400)
                assert ImageChops.difference(first.crop(region), second.crop(region)).getbbox(), 'Smoke Ring stopped animating after reload'
                bright = sum(min(rgb) >= 240 for rgb in first.crop((0, 0, 640, 60)).getdata())
                assert bright >= 20, 'Reload damaged terminal text'
        for name in ['grain-gradient', 'gem-smoke-image', 'heatmap', 'liquid-metal-image']:
            configure(name, opacity=0)
            remote('load-config', str(config))
            path = artifacts / f'reload-transparent-{name}.png'
            remote('screenshot', str(path.resolve()))
            picture = Image.open(path).convert('RGBA').crop((80, 100, 560, 380))
            opacity = ImageStat.Stat(picture.getchannel('A')).mean[0]
            brightness = max(ImageStat.Stat(picture.convert('RGB')).mean)
            assert opacity > 250, f'{name} left the Kitty background transparent: {opacity:.1f}'
            assert brightness > 5, f'{name} did not render over the transparent background: {brightness:.1f}'
        assert process.poll() is None, 'Kitty exited during shader reload'
        errors = log_path.read_text()
        # Private D-Bus has no user systemd service; its scope warning is expected.
        assert not any(marker in errors for marker in (
            'Failed to build custom shader', 'Failed to load custom shader',
            'Failed to read custom shader', 'Failed to compile', 'error[E', 'Traceback',
        )), errors
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        (artifacts / 'reload-timings.json').write_text(json.dumps(results, indent=2) + '\n')
