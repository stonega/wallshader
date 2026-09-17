# Architecture

Wallshader is a standalone GNOME app. GJS ES modules own the GTK 4/libadwaita
interface, persistence, file dialogs, and wallpaper settings. There is no web app
framework, Electron process, or network service.

## Interface

The artwork carries the visual identity. Adwaita supplies the system font,
window colors, controls, and accent. The collection and preview occupy the main
pane; a trailing inspector holds composition and wallpaper apply controls. Below 880 px,
the inspector becomes an overlay. Labels are left aligned, the preview follows
the output aspect ratio, and the gallery uses two or three columns. Gallery rows
stay at their natural height so surplus vertical space does not stretch the cards.
Gallery thumbnails show each template's first **Original** preset, independent of
saved edits or the selected preset.
The gallery shows native, mutually exclusive category tabs with an icon and label,
using a rounded neutral background for the active tab. The shader groups match
[Paper's catalog](https://shaders.paper.design/): Effects, Image Filters, and Logo
Animations. Effects combines gradients and patterns and is selected on startup;
Favorites remains a separate personal filter. There is no All tab, wallpaper count,
or Collection heading. The tab row scrolls horizontally
when needed, and switching tabs retains the current search. Selected gallery and
preset tiles use accent-colored label text as their selection indicator.
The preview header shows the wallpaper name followed by Save Preset, Export PNG (an image icon), Reset Changes,
and favorite icon buttons, without a subtitle. Play/pause sits inside the preview's
bottom-left corner on a circular black background at 60% opacity. The presets and
saved configurations sit directly below the preview in the main pane, above the
collection, with no intervening status toolbar or visible grid heading.
Save Preset uses the supplied disk artwork with the existing 2.5-unit stroke weight
as a named symbolic icon. Its outline is expanded to filled paths for GTK 4.14 compatibility, so it
inherits widget foreground colors in light, dark, and high-contrast appearances.
The Wallpaper Settings icon sits in a circular 44 × 44 px button, vertically
centered to the right of the apply button. It opens an adaptive native dialog for
wallpaper mode, animation frame rate, rendering mode, desktop playback controls, and output resolution. The dialog retains
its selections when closed and reopened during the same app session. Wallpaper mode
defaults to Animated shader when the app opens.

The palette uses Adwaita's window background, foreground and accent with neutral
text; the initial artwork uses midnight `#171346`, violet `#6456C8`, sky
`#A1CEE8`, and lilac `#E4AFE5`. System colors remain authoritative in light and
dark appearances. This keeps visual emphasis on actual shader output.
Favorited stars in the preview header and gallery use yellow `#F5C211`.

## Rendering

`src/renderer/renderer.js` imports all 30 original Paper shader strings, their
helpers, and ShaderMount. Bun bundles these into a local IIFE.
WebKitGTK 6.0 renders only the canvas; all buttons, thumbnails, dialogs and
controls are native GTK widgets. GJS cannot directly call the OpenGL entry points
needed by Gtk.GLArea without an additional native library. Using Paper's existing
WebGL 2 renderer preserves shader behavior and avoids a separate GLSL port.

Before WebKit launches, `Preview` defaults `WEBKIT_SKIA_ENABLE_CPU_RENDERING` to
`1`. WebKit's Skia GPU painting path reproduced triangle-shaped gaps in animated
previews on the tested WebKitGTK 2.52 / GTK 4.22 stack. Skia rasterizes page content
and 2D canvases on the CPU with this setting; WebGL shaders, WebKit compositing and
GTK's renderer remain accelerated. The wallpaper page has a static background
around the WebGL canvas. Image preprocessing that uses 2D canvas may cost more CPU
time. The same initialization covers editor and desktop windows. An explicit
environment override is honored for editor comparisons. For desktop windows, the
extension sets this variable explicitly to `1` for Compatibility (the default) or
`0` for GPU (experimental), before launching GJS/WebKit. Both modes leave WebGL
enabled; selecting GPU permits Skia GPU painting and cannot guarantee hardware
acceleration on an unsupported driver. See the
[rendering incident notes](../../postmortem/2026-09-15-renderer-flicker.md).

`Preview` sends validated state through WebKit's JavaScript API and receives
JSON results through a named UserContentManager handler. A request queue serializes
selection, thumbnail, and full-resolution capture work. Captures use a temporary ShaderMount
at the requested physical size, with the live frame's animation time or an explicit
frame for the animated wallpaper's static background. Resources
and WebGL contexts are disposed after each capture. The preview is capped at 1080p; export is capped
at 35,389,440 pixels. PNG decoding is checked before files or settings are written.

The renderer uses a restrictive content security policy and rejects navigation
away from its bundled page. Startup errors and terminated WebKit processes are
visible in the preview. The application works offline after building.

The optional debug panel is a native GTK overlay on each live desktop wallpaper.
The app preview stays unchanged. While enabled on the desktop, a separate rAF
observer samples Paper's public frame time and posts diagnostics to GJS once per
second. It does not alter the playback loop
or capture canvas. Disabling it cancels both the observer and reporting timer.
Observed FPS describes changes seen by WebKit, not GPU or compositor timing.
The saved `debugInfo` preference defaults to false; the desktop watches the config
directory for atomic state-file replacements so toggling it requires no wallpaper
apply, Shell protocol change, or renderer restart. The watch is cancelled on exit.

Captures size the temporary canvas in physical pixels and draw with `setFrame`
synchronously, before its resize observer runs. They do not depend on animation
callbacks, which WebKit can suspend when a window is obscured. This also keeps PNG
dimensions independent of the desktop's display scale.

The displayed canvas uses an unpreserved WebGL drawing buffer, without multisample
antialiasing or a depth buffer. Paper draws a fullscreen quad and computes its
shapes in the fragment shader, so those buffers add GPU work without improving
edge quality. PNG captures use their own preserved buffer. Desktop frames are
drawn from `requestAnimationFrame`, paced to 30 or 60 fps by `frame-clock.js`.
Elapsed time controls animation speed, including reverse playback; missed repaints
never queue catch-up draws, and a single long stall advances at most one second.
Pause cancels the pending callback and resume starts a fresh clock. This aligns
WebGL drawing with WebKit's repaint cycle instead of submitting frames from an
independent interval. The Shell test verifies that animation also continues in
the overview, where Shell clones the wallpaper surface.

## Paper editor

`paper-catalog.js` contains generated metadata for 30 shaders, 124 upstream presets,
and 272 shader-specific fields. `scripts/sync-paper.js` reads a matching upstream
checkout's static preset declarations, uniform mappings, enum exports, and range
annotations. The generated file is committed with the app; React is not needed to
build or run it. `catalog.js` adds common positioning and animation controls,
validates values, and preserves the original nine wallpaper defaults.

`editor.js` builds native controls from these definitions. Numeric controls share
a GTK adjustment between their slider and spin button. Variable palettes support
opacity and ordering, while independent colors retain their own shader properties.
The renderer converts state into the same uniform values as Paper's wrappers,
including image presence flags, mipmaps, and the library's shared noise texture.

`preset-grid.js` presents the wallpaper default, upstream Paper presets, and named
configurations for the current shader in a native thumbnail grid below the preview,
with three to six columns depending on available width.
Thumbnails use independent captures through the existing renderer queue; a bounded
texture cache avoids repeated renders. Generation checks discard obsolete work
when the selected wallpaper changes. Selection compares complete shader parameters,
so edits cannot leave a stale selection highlight. Saved configurations remain usable
across collection entries sharing a shader, without modifying the saved copy.
Saved tiles have a delete icon button on the right of their caption, separate
from the selection button. Deletion persists before removing the cached PNG;
a failed settings write leaves the saved entry and preview intact. Deleting a
preset keeps the current editor configuration and desktop wallpaper unchanged.

The Save Preset dialog captures the current configuration and animation frame,
shows its preview, and suggests an editable random hex color name such as
`#A3F07C`. Generated names avoid existing names for the same shader.
Applying a still or animated wallpaper also saves a named configuration when
neither the editor settings nor the captured settings match an Original, Paper,
or saved preset. Matching the editor settings before playback advances prevents
duplicate saves on repeated applies. A new preset retains the applied frame and
becomes the selected tile. Auto-save starts after the still wallpaper is applied,
so failed captures or wallpaper writes do not add presets. A preset save failure
is reported without cancelling the wallpaper or animation request.
`saved-presets.js` writes a private PNG
under the XDG data directory's `wallshader/presets/`, then atomically saves a new
`savedPresets` entry in state.json. A failed settings write removes the new PNG
and leaves in-memory state intact. The additive state field retains version 2
compatibility. Invalid entries are discarded individually during normalization;
missing or damaged thumbnails are rendered again from their settings. Desktop
playback and output preferences are independent of these shader configurations.

`images.js` imports images through GdkPixbuf, limits input to 32 MB, normalizes it to
a PNG at most 2048 pixels per side, and stores it in the app's data directory.
Local imports cross into WebKit only as decoded PNG data. Heatmap, Liquid Metal, and Gem Smoke
use Paper's original image preprocessing. The shared sample is Paper's
`docs/public/images/image-filters/0018.webp`, bundled unchanged as
`src/renderer/sample.webp`. The build embeds it as a data URL so canvas export
stays readable without network or file-origin exceptions. Templates that need an
image default to this sample; optional procedural inputs stay empty. The same
sample is available through **Use Sample** for every image input, including logo
effects. Saved local images and explicitly removed images retain their selection.

`sharing.js` copies settings JSON or Paper component code. Import parses literal
values without evaluating JavaScript. Remote image URLs require the user to choose
a local source. The app's UI is native even when exporting a React code snippet for
use elsewhere.

## State and desktop integration

`catalog.js` is runtime-independent and validates all persisted numeric and color
values. State version 2 retains compatibility with the original saved presets.
`storage.js` atomically replaces the settings JSON under the XDG config
directory. Edits are debounced. `wallpaper.js` writes a unique PNG under the XDG
data directory, then sets both GNOME background URI keys and the zoom layout.
The original light/dark URIs and layout are saved before the first apply and
restored by the app menu or Undo. Applying again preserves the original backup.

Only an explicit apply action changes the selected wallpaper. Editor startup,
previews, and tests do not change the real desktop. An enabled Shell extension
resumes the user's last applied animated wallpaper at login.
Animated apply captures its starting frame at the selected output resolution and
applies it through `wallpaper.js` before requesting animation. The capture and live
configuration use the same frame time, even while the editor preview advances.
Both background URI keys receive this still image, and the original wallpaper
backup is preserved. If animation setup or startup fails, the still image remains.

## Animated desktop

`extension/extension.js` exports a small session D-Bus interface used by `live.js`.
It validates and persists a separate `live-wallpaper.json`, then launches the
bundled GJS `desktop-renderer.js` through Mutter's `Meta.WaylandClient`.
Only windows owned by that Wayland client are managed. GNOME 50's
`Meta.Window.set_type(DESKTOP)` keeps them behind application windows, on all
workspaces, and out of task lists. Input regions are empty so desktop interaction
passes through. No Shell methods are replaced and no GLSL code runs in Shell.

The renderer creates one undecorated GTK/WebKit window per monitor, with its
minimum size set to the full monitor size so GTK cannot clamp it to the work area.
GTK chooses its rendering backend, honoring `GSK_RENDERER` when explicitly set.
Renderer startup logs and diagnostics report the actual GSK backend. Forcing
OpenGL did not resolve reported triangle flicker during foreground window changes,
so the desktop process does not override GTK's default.
The extension keeps each window at the full monitor bounds, including the area
behind the panel. It clears fullscreen state on owned wallpaper windows during
placement and after fullscreen-state changes: Mutter otherwise hides the panel
even for a desktop window. Empty workspaces keep the top bar visible, and regular
fullscreen applications retain GNOME's normal panel behavior.
Visible wallpaper also holds a balanced `Meta.Compositor` unredirect inhibitor.
Mutter can select an opaque, monitor-sized Wayland surface for direct scanout even
when its window is not fullscreen. Keeping the wallpaper composited protects the
Shell chrome on physical displays; clearing fullscreen state alone does not
exclude this path. Manual pause retains the inhibitor because the wallpaper is
still visible. Window mapping, stacking, minimization and workspace changes update
coverage immediately. The hold is released when all monitor work areas are
covered, or on stop, failure and disable, without releasing other Shell components'
references. This API applies to the whole compositor: a visible wallpaper on one
monitor also inhibits direct scanout on another until all displays are covered.
See the [top-bar investigation](../../postmortem/2026-09-15-top-bar.md) for evidence
and the limits of headless verification.
It coalesces size, position and fullscreen-state changes into a deferred placement
check, so a late
Wayland configure cannot leave a work-area-sized gap at the bottom. The check only
resizes when bounds differ; pending checks are cancelled when windows are released.
The renderer reuses the editor's original Paper shaders and image processing,
caps rendering at 1080p per monitor, and advances shader time at 30 or 60 FPS with
a monotonic clock. Negative
speed works; speed 0 freezes. The application process can close independently.
The editor saves the requested `liveRendering` preference in state.json and passes
it as `rendering` when applying. The live configuration persists the applied mode;
missing or invalid values normalize to `compatibility` for older settings. A mode
change stops the owned renderer and waits for its exit before starting a process
with the new environment. Same-mode applies reuse the renderer through reload.
Renderer diagnostics expose the requested mode and the Skia environment value;
these report configuration, not proof of physical GPU use.
GApplication actions carry pause, reload, readiness and diagnostics. The extension
waits for the renderer's D-Bus owner before subscribing to its action group.

`extension/overview.js` adds non-interactive Clutter clones of the owned renderer
windows behind the overview's window previews and workspace thumbnails, on every
monitor. These share the existing Wayland textures; no extra WebKit processes or
shader implementations are needed. It watches workspace container changes to
handle newly created workspaces and releases clones and signals when the overview
closes, the renderer stops, or the extension is disabled. Shell methods and GNOME's
saved background settings remain untouched.
Clones request no minimum size, so the desktop's dimensions cannot enlarge GNOME's
workspace layout. They currently use rectangular clipping; GNOME's rounded
BackgroundContent mask applies only to its built-in background texture.

Only the user's Pause control pauses playback. Maximized applications, covered
workspaces and screen lock do not send pause commands or reset the animation
clock. Active workspace changes update the compositing hold immediately, without
waiting for the two-second coverage poll. Activities shows the animated shader
and honors manual pause. The extension supports both `user` and `unlock-dialog`
session modes so its renderer and windows survive locking and unlocking. GNOME's
lock-screen background still uses the captured still image; the desktop renderer
stays beneath the lock screen. WebKit/compositor repaint callbacks can be
throttled while surfaces are fully obscured or displays are off.

Monitor changes restart the renderer after the old process exits.
All signals, timers, D-Bus objects and owned
windows are released on disable. A renderer failure is reported to the app and
requires an explicit apply to retry. Stop reveals the static first frame installed
by the editor. Restore Previous Wallpaper stops animation and restores the
original GNOME background. The extension itself does not write background settings.

`scripts/build-extension.js` produces a self-contained bundle with the renderer,
shared modules, and third-party notices. The native installer copies it into the
user's extension directory and enables only its own UUID. GNOME discovers new
extensions at login, so first installation may require logout/login. `live.js`
signals this with `LoginRequiredError`; animated apply presents a native
`Adw.AlertDialog` explaining the one-time logout/login and subsequent apply.
The notice stays open until dismissed. There is no automatic logout or Shell restart.
