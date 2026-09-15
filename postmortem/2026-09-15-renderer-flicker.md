# Triangle gaps in animated previews and wallpaper

## Symptoms and reproduction

The user reported dark triangular gaps while resizing or moving foreground
windows, then confirmed that the editor preview also flickered with all windows
stationary. Pausing animation stopped the flicker. Fresh standalone previews and
a fresh full editor appeared normal during manual comparison, so brief visual
checks did not reliably exercise the failure.

The native smoke test originally paused the preview before taking screenshots.
An added test starts a bright Dithering preview after gallery generation and
repeatedly snapshots the displayed WebView. It reproduced the same triangular
gaps, including pixels exactly matching the page background (`#171346`) instead
of either bright shader color. The failing image is saved immediately.

The regression test now samples 120 frames. It checks for cleared regions and
also requires shader time and sampled pixels to change, so a frozen bright frame
cannot pass. Tests use isolated settings/data and a separate headless Shell;
they never apply, pause or stop wallpaper in the user's session.

## Findings

Tested stack: WebKitGTK 2.52.5, GTK 4.22.5, GNOME/Mutter 50.4, Mesa 26.1.8,
on an Intel Meteor Lake / NVIDIA hybrid system.

| Change | Observation |
| --- | --- |
| Force GTK OpenGL instead of Vulkan | User still observed flicker |
| Use repaint callbacks for desktop playback | Useful frame pacing, but editor preview still flickered |
| Explicit Skia GPU control (`WEBKIT_SKIA_ENABLE_CPU_RENDERING=0`) | New native test failed at sample 14 |
| CPU Skia (`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`) | 120 animated samples and full native suite passed |
| Only set Skia GPU painting threads to zero | Triangles still detected at sample 11 |
| Finish each WebGL draw before returning | Triangles still detected at sample 2 |
| Linear DMA-BUF format | Triangles still detected at sample 2 |
| Disable GTK's node-to-image fast path | Triangles still detected at sample 6 |
| Force shared-memory frame transport | 48 animated samples passed, but God Rays export failed |
| Disable GBM | Unsupported DMA-BUF format and missing preview |

These results locate a useful workaround in WebKit's Skia GPU rendering path.
They do not identify the exact upstream engine or driver defect. The dedicated
GPU allocation path and sharing modes should not be changed based only on the
appearance of the triangles.

## Resolution

`src/preview.js` sets `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` before WebKit starts,
unless explicitly overridden. This common module covers both the editor and the
desktop renderer. Skia page/2D-canvas rasterization uses the CPU; the original
Paper shaders still render through WebGL, and GPU compositing remains enabled.
The static page background needs little rasterization, although 2D-canvas image
preprocessing can cost more CPU time. No per-frame CPU readback was added to the
application's animation loop.

The distinction between page painting, delegated WebGL content and compositing
is described in [WebKit's graphics architecture](https://docs.webkit.org/Ports/WebKitGTK%20and%20WPE%20WebKit/Graphics.html).
The switch is documented among [WebKitGTK's graphics environment variables](https://webkitgtk.org/reference/webkitgtk/stable/environment-variables.html).

## Verification and follow-up

Run `bun run check`, `bun test`, `bun run test:native` and `bun run test:shell`.
For the affected-stack control, run the native test in the same isolated session
with `WEBKIT_SKIA_ENABLE_CPU_RENDERING=0`; a triangle failure is expected there.
Do not turn a failed control into a skipped assertion or relax the pixel check.

After installing the common module, restart the editor and stop/reapply animated
wallpaper so their existing WebKit processes are replaced. Recheck this workaround
when upgrading WebKit/GTK/graphics drivers. The diagnostic launcher can compare
isolated previews or a full editor with a fresh profile without changing the
user's wallpaper.
