# Using Wallshader

1. Choose a wallpaper from the collection. Use search or the category tabs above
   the gallery to narrow it down: **Effects** (selected initially), **Image Filters**,
   and **Logo Animations**, matching [Paper's groups](https://shaders.paper.design/),
   plus your **Favorites**. Effects includes gradients and patterns. Scroll the tabs
   horizontally if they do not all fit. Each template thumbnail shows its first
   **Original** preset.
   Selecting a template scrolls back to the preview at the top.
   Star a wallpaper to keep it in Favorites.
2. Choose a preset thumbnail in the grid below the preview.
   Every shader from Paper 0.0.81 is available through the collection, with its
   original settings and presets. The grid includes the wallpaper's **Original**,
   Paper presets, and your saved configurations for that shader. When **Paper Default**
   has the same settings as **Original**, only **Original** is shown. The selected
   tile uses accent-colored label text; edits that differ from every tile clear
   the selection. When opening another shader or starting the app, settings that
   match a built-in or saved preset are restored; otherwise **Original** is selected.
   Save custom edits as a named preset to keep them when reopening a shader.
3. Choose a color swatch for the native picker with opacity, or type a hex, RGB,
   or HSL value and press Enter. Change the color count and use the arrows to
   reorder colors. **Shader settings** contains the effect's sliders, exact
   numeric inputs, shape options, switches, and independent colors. Changes and
   favorites are saved automatically.
4. Expand **Position & size** for scale, rotation, offsets, origin, fit, and world
   dimensions. A world dimension of 0 follows the canvas.
5. Use the circular play/pause button in the preview's bottom-left corner to hold
   or resume a frame. Expand **Animation** to choose an exact frame time in
   milliseconds and speed.
   Negative speed plays in reverse; 0 holds a frame.
   Speed changes only the live preview. The preview pauses when you leave the app
   and respects GNOME's reduced animation setting at startup.
6. Click the **Wallpaper Settings** gear icon to the right of the wallpaper apply
   button to choose **Destination → Desktop or Kitty**, the wallpaper mode and output resolution. The destination is remembered across app restarts. **Animated shader**
   is selected by default when the app opens. “This display” uses
   the monitor containing the app window, including its scale. Explicit sizes include 1080p,
   1440p, 4K and ultrawide. The preview follows the selected aspect ratio.
7. Click **Set Animated Wallpaper** to animate the shader on your desktop. For a
   still background, select **Still image** in Wallpaper Settings, then click
   **Set as Wallpaper**. Use the **Export PNG…** image icon above the preview to save
   the current frame to a file.

Applying a wallpaper automatically saves a new preset if its configuration does
not match a built-in or saved preset. The new tile uses a random hex color name
such as **#A3F07C** and keeps the applied frame. Applying the same configuration
again reuses the existing preset.

To keep a named configuration, click the **Save Preset…** bookmark icon immediately
to the left of Export PNG. The dialog shows a still preview and a random hex color
name; keep or edit the name, then click **Save**. Its thumbnail appears in the same preset grid with a delete icon
button on the right. Click that button to remove the saved configuration and its
thumbnail; the current preview and desktop wallpaper stay unchanged.
Names must be unique within a shader. Saving retains all shader controls,
colors, source image, speed, and the captured animation frame. Later edits do not
change that saved copy. Select its tile to restore it, including after restarting
the app. Saving and selecting presets do not apply a wallpaper. Wallpaper mode,
desktop frame rate, rendering mode, and output resolution remain separate in Wallpaper Settings.

For a Kitty terminal background, choose **Destination → Kitty**, close Settings,
and click **Set Kitty Background**. **Still image** works with every preset,
including image filters and logos. The captured PNG is scaled to fill the terminal
while preserving its aspect ratio and tinted by 65% with Kitty's background color
to help keep text readable.

**Animated shader** requires [Kitty 0.49 or newer](https://sw.kovidgoyal.net/kitty/custom-shaders/)
and its Slang compiler (included in Kitty's official binary; distro packages may
require `shader-slang`). All 30 shader types support this mode, including procedural
effects, image filters and processed logos. Image inputs and Paper's noise texture
are packaged with the shader, so they remain available after Wallshader closes.
Animated image copies are reduced to a maximum of **128 pixels on the longest
edge and 256 colors** to keep Kitty's shader compilation manageable. Original
images, desktop rendering and still exports retain their existing quality. The
noise texture is preserved exactly. The first load of a textured shader can take
several seconds while Kitty compiles and caches it. If GNOME displays “Kitty Is
Not Responding” just after applying a shader, choose **Wait** to let compilation
finish; **Force Quit** closes the terminal and its running sessions. Vector-packed
texture data reduces this delay, but compilation time still depends on the driver.
Very small terminal windows
can further reduce texture detail. Effects that are static in Paper remain static.
Changing shaders or modes does not apply a background.
The shader runs
inside Kitty after Wallshader closes. Colors, shader parameters, positioning,
frame offset and speed are retained; Kitty's own clock controls the animation
phase, so it does not start at the exact frame shown in Wallshader. Speed 0 holds
the selected frame; negative speed reverses playback. Kitty controls window size
and repaint timing; 30/60 FPS are approximate requests subject to its repaint
limit. Output resolution affects the saved still and PNG export.

Kitty runs custom shaders after rendering terminal content. Wallshader blends the
effect into pixels close to Kitty's background colors, using a 65% tint; text and
images with similar colors may also be affected. Animation temporarily replaces
your configured custom shader chain. Applying a still or restoring the Kitty
background brings that chain back.

Wallshader adds one marked block to `~/.config/kitty/kitty.conf` (or
`$XDG_CONFIG_HOME/kitty/kitty.conf`; `KITTY_CONFIG_DIRECTORY` takes precedence).
The path is shown in Settings. Kitty normally reloads configuration automatically.
If automatic reload is disabled, use **Ctrl+Shift+F5** in Kitty, or open a new
instance. A config first created while Kitty is running also needs a manual reload
or a new instance. Configurations passed through Kitty's `--config` flag must
include this file, or point Wallshader at their directory using
`KITTY_CONFIG_DIRECTORY`. Kitty's automatic light/dark theme files can override
still background options; move those conflicting options out of the theme files
if needed.

Use **Restore Kitty Background** in Wallpaper Settings to remove Wallshader's
block while preserving your other settings and later edits. Symlinked config
files stay symlinked. Applying to Kitty, restoring it, and switching destinations
leave the desktop wallpaper and its playback unchanged. Desktop restoration
remains available through the app menu.

For an animated desktop, open **Wallpaper Settings**, keep **Wallpaper mode**
on **Animated shader**, and choose 30 or 60 FPS. Close the dialog, then click
**Set Animated Wallpaper**. First use installs the bundled
GNOME 50 extension. If GNOME has not seen it before, a **Log Out to Finish Setup**
dialog explains that you need to log out and back in once so GNOME can discover
it. Dismiss it with **Got It**, then log out when ready. After logging back in,
open Wallshader and choose **Set Animated Wallpaper** again.
Applying also sets the animation's first frame as a still background
for both light and dark appearances, at the selected output resolution. It uses
the frame where the animation starts, including your chosen frame time. This still
image remains available even if animation support needs setup or the renderer stops.

**Wallpaper rendering** offers **Compatibility (default)** and **GPU (experimental)**.
Both modes keep the shaders on WebGL, which normally uses your GPU. Compatibility
uses CPU page drawing to avoid a known WebKit flickering issue. GPU mode also
allows GPU page drawing; it may reduce CPU use, but can bring back flickering on
some drivers. Select a mode, close Settings, and click **Set Animated Wallpaper**.
Changing modes restarts the desktop renderer automatically. The selection is saved
across app restarts; the last applied mode resumes at login. The editor preview and
PNG export retain their existing rendering behavior. If GPU mode flickers, choose
Compatibility and apply again. Actual GPU use depends on WebKit and the graphics
driver; **Show Debug Info** displays the WebGL renderer when the driver exposes it.

The shader plays on all displays and continues after you close Wallshader. Use
**Pause / Resume** and **Stop** in **Wallpaper Settings**. Edit a shader and apply
again to update the running wallpaper. Speed 0 remains still; negative speed plays
in reverse. Stop reveals the animation's static first frame. Applying a still image
also stops animation. PNG export always captures a still frame.

Activities shows the same animated shader in workspace previews and thumbnails.
Maximized windows and workspace switches keep playback enabled. Only **Pause**
pauses animation, and manual pause stays in effect across workspace switches and
screen lock. The renderer stays running through locking and unlocking. The lock
screen uses GNOME's static background with the captured first frame. The saved animated choice
resumes next login while the extension is enabled. Disable **Wallshader Live
Wallpaper** in GNOME Extensions to prevent this, or use **Stop** to clear the saved
running state. Rendering is capped at 1080p per display to limit GPU use.

Image shaders show **Choose Image…**, **Use Sample**, and a remove button. Images
are copied into the app's data directory and resized to at most 2048 × 2048 while
preserving their aspect ratio. The input limit is 32 MB. Templates that need an
image, plus Paper Texture and Water, start with Paper's [flower photograph](https://github.com/paper-design/shaders/blob/main/docs/public/images/image-filters/0018.webp),
included with the app for offline use. **Use Sample** selects this photograph for
any image shader. Image changes affect only the configuration you are editing;
other preset thumbnails and their images stay unchanged. Save a preset to keep
that image choice with its settings. Your chosen local images and removed images
remain saved in the current configuration.
For Heatmap, Liquid Metal, and Gem Smoke, use a logo or shape with a transparent
background. Procedural
shaders with optional image inputs also work with the source removed.

Open the menu's **Import Paper Settings…** and paste a complete component from
Paper's **Code** section, or settings copied from Wallshader. Literal numbers,
strings, arrays, and booleans are supported; JavaScript expressions are not.
For a snippet containing an external image URL, remove its `image` property and
choose the image locally after import. **Copy Settings…** preserves all properties;
**Copy Paper Code…** produces a component snippet for a web project. Replace
`image={"sample"}` or local file URIs with an image URL available to that project.
An importable example is included in `examples/paper-ink.json`.

Paper 0.0.81 rebuilds **Paper Texture** with paper, shadow, and background colors,
image blending, distortion and clipping, and separate folds, wrinkles, and crumples.
Its presets are Default, Spread, Creased, and Flat. Older saved settings and imports
are converted using Paper's approximate migration: old folds become crumples and
old crumples become wrinkles. The rebuilt patterns and seeds look different;
review the preview before applying. Hex colors are mixed for the new paper layer,
including opacity; RGB/HSL colors retain the old background as the paper color.

Use the **Reset Changes** icon immediately left of the favorite star to restore
the selected wallpaper's original palette and composition. Open the menu and
choose **Restore Previous Wallpaper** to return
to the background you had before the first apply. Multiple applies preserve that
original background until you restore it.

On a narrow window, use the edit button in the header to show the controls.
Keyboard shortcuts: Ctrl+F for search and Ctrl+Q to quit.

To report a bug, open **About Wallshader** from the app menu and choose
**Report an Issue** to open the project's [GitHub issues](https://github.com/stonega/wallshader/issues).

Enable **Show Debug Info** in the app menu for a compact overlay on each live
wallpaper, in the lower-left corner clear of GNOME's top bar. The app preview
stays unchanged. It shows the shader, viewport and canvas sizes,
display scale, observed FPS and average frame interval, playback time and speed,
GTK backend, WebKit version and graphics renderer. The preference is saved, takes
effect on a running wallpaper without reapplying, and defaults to off. Turn it off
in the menu. PNG exports and still wallpapers contain only
the shader. FPS counts animation frames observed by WebKit; it does not measure
GPU completion, compositor presentation, or dropped frames.

Settings and named configurations are stored at `~/.config/wallshader/state.json`;
saved previews are kept at `~/.local/share/wallshader/presets/`. Wallpapers are kept at
`~/.local/share/wallshader/wallpapers/`, and source images at
`~/.local/share/wallshader/images/` (or your XDG equivalents). Exported PNGs
are independent of the app. Removing the app does not remove these files.
Kitty PNGs, shader pipelines, and their Paper license/notice files are kept under
`~/.local/share/wallshader/kitty/`. Restore Kitty's background before deleting
these files.
Animation settings are in `~/.config/wallshader/live-wallpaper.json`; its extension
is in `~/.local/share/gnome-shell/extensions/wallshader@wallshader.github.io/`.
