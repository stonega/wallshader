# Kitty becomes unresponsive when applying Smoke Ring

## Symptom and evidence

Applying Smoke Ring to Kitty produced GNOME's **“kitty” Is Not Responding**
dialog. The shader rendered normally after restarting Kitty. This was a
responsiveness incident; the initial report called it a crash, but the screenshot
clarified that Kitty was still running. The journal showed configuration reloads,
with no Kitty core dump or GPU-reset record around the reported event.

Initial isolated tests loaded the saved shader successfully through fourteen
switches, including multiple windows and tabs. Checking only that the process
survived missed the problem: driver caches can hide the compilation delay.
With Mesa's shader cache disabled for a disposable Kitty process, loading the
saved Smoke Ring pipeline blocked the reload round trip for 6.7–7.6 seconds.
The same test using vector-packed texture data took 2.3–2.4 seconds. These are
measurements on Kitty 0.49.1 / Mesa 26.2.3, not a bound for every GPU or driver.

## Cause and correction

Kitty compiles custom shaders synchronously during reload, including Slang
translation and OpenGL program compilation. See its
[0.49.1 shader loader](https://github.com/kovidgoyal/kitty/blob/c9896e8c002b32591a232dc5996def2493132aaf/kitty/shaders/slang.py#L257).
While that work blocks the event loop, it cannot respond promptly to the desktop.
The measured stall is consistent with the reported dialog; no stack trace from
the original incident was available.

Wallshader embedded Smoke Ring's lossless 128 × 128 noise texture as 4,096 scalar
`uint` entries, each holding four palette indices. Large dynamically indexed
scalar arrays caused expensive cold driver compilation. The exporter now uses
1,024 `uint4` entries, each holding sixteen indices, with zero padding for partial
vectors. Resolution, palettes, texels, mip levels, sampling and shader parameters
remain unchanged. This also applies to other noise and image shaders.

## Verification and limitations

- A logic test decodes the generated texture table and checks every original
  texel, including word, vector and mip boundaries and a partial final vector.
- The real Kitty render suite compares all shader types against Paper, and
  includes Smoke Ring animation and text preservation.
- The reload regression uses a private compositor, D-Bus, runtime and config,
  a fresh compiler cache, and process-local driver-cache overrides. It reloads
  Smoke Ring twice between a shader without textures, verifies animation and
  text, and checks a five-second responsiveness budget. Timing and process logs
  are retained under `artifacts/kitty-render/`.

The change reduces compilation work; it does not make Kitty's loader asynchronous.
Slower machines and different drivers can still take longer. If the dialog appears
immediately after an apply, **Wait** allows compilation to finish. Existing exported
shader files are unchanged until the user explicitly reapplies from the updated app.
No test changes the user's Kitty configuration, terminal sessions or wallpaper.
