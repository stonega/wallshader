# Using Wallshader

1. Choose a wallpaper from the collection. Use search or the category filters to
   narrow it down. Each template thumbnail shows its first **Original** preset.
   Star a wallpaper to keep it in Favorites.
2. Choose a **Shader** and **Paper preset** in the inspector. Every shader from
   Paper 0.0.80 is available, with its original settings and presets. Editing a
   value changes the preset label to **Custom / saved**.
3. Choose a color swatch for the native picker with opacity, or type a hex, RGB,
   or HSL value and press Enter. Change the color count and use the arrows to
   reorder colors. **Shader settings** contains the effect's sliders, exact
   numeric inputs, shape options, switches, and independent colors. Changes and
   favorites are saved automatically.
4. Expand **Position & size** for scale, rotation, offsets, origin, fit, and world
   dimensions. A world dimension of 0 follows the canvas.
5. Pause the preview to hold a frame, or use the next-frame button to jump ahead.
   Expand **Animation** for an exact frame time in milliseconds and speed.
   Negative speed plays in reverse; 0 holds a frame.
   Speed changes only the live preview. The preview pauses when you leave the app
   and respects GNOME's reduced animation setting at startup.
6. Choose an output resolution. “This display” uses the monitor containing the
   app window, including its scale. Explicit sizes include 1080p, 1440p, 4K and
   ultrawide. The preview follows the selected aspect ratio.
7. Click **Set as Wallpaper** to apply the current frame as a still background for
   both light and dark appearances, or **Export PNG…** to choose a file location.

For an animated desktop, change **Wallpaper** to **Animated shader**, choose 30 or
60 FPS, then click **Set Animated Wallpaper**. First use installs the bundled
GNOME 50 extension. If GNOME has not seen it before, log out and back in once and
apply again. Applying also sets the animation's first frame as a still background
for both light and dark appearances, at the selected output resolution. It uses
the frame where the animation starts, including your chosen frame time. This still
image remains available even if animation support needs setup or the renderer stops.

The shader plays on all displays and continues after you close Wallshader. Use
**Pause / Resume** and **Stop** in the Wallpaper section. Edit a shader and apply
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
image start with Paper's [flower photograph](https://github.com/paper-design/shaders/blob/main/docs/public/images/image-filters/0018.webp),
included with the app for offline use. **Use Sample** selects this photograph for
any image shader. Your chosen local images and removed images remain saved.
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

Use **Reset Changes** to restore the selected wallpaper's original palette and
composition. Open the menu and choose **Restore Previous Wallpaper** to return
to the background you had before the first apply. Multiple applies preserve that
original background until you restore it.

On a narrow window, use the edit button in the header to show the controls.
Keyboard shortcuts: Ctrl+F for search and Ctrl+Q to quit.

Enable **Show Debug Info** in the app menu for a compact overlay on each live
wallpaper, in the lower-left corner clear of GNOME's top bar. The app preview
stays unchanged. It shows the shader, viewport and canvas sizes,
display scale, observed FPS and average frame interval, playback time and speed,
GTK backend, WebKit version and graphics renderer. The preference is saved, takes
effect on a running wallpaper without reapplying, and defaults to off. Turn it off
in the menu. PNG exports and still wallpapers contain only
the shader. FPS counts animation frames observed by WebKit; it does not measure
GPU completion, compositor presentation, or dropped frames.

Settings are stored at `~/.config/wallshader/state.json`; wallpapers are kept at
`~/.local/share/wallshader/wallpapers/`, and source images at
`~/.local/share/wallshader/images/` (or your XDG equivalents). Exported PNGs
are independent of the app. Removing the app does not remove these files.
Animation settings are in `~/.config/wallshader/live-wallpaper.json`; its extension
is in `~/.local/share/gnome-shell/extensions/wallshader@wallshader.github.io/`.
