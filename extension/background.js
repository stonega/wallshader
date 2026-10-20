import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Keep GNOME's BackgroundContent (including its rounded alpha mask) intact.
// Cogl's standard layer combiner replaces its color with the external WebKit
// surface, multiplied by that alpha. No Paper shaders run inside Shell.
const FrameTexture = GObject.registerClass(
  { GTypeName: 'WallshaderFrameTexture' },
  class FrameTexture extends Clutter.OffscreenEffect {
    // Capture the clone through Mutter so buffer transforms, subsurfaces and
    // Wayland frame callbacks are handled normally. Only the background draws it.
    vfunc_paint_target(_node, _context) {}
  },
);

const BackgroundTexture = GObject.registerClass(
  { GTypeName: 'WallshaderBackgroundTexture' },
  class BackgroundTexture extends Clutter.OffscreenEffect {
    _init(frame) {
      super._init();
      this.frame = frame;
      this._pipeline = null;
      this._texture = null;
    }

    vfunc_paint_target(node, context) {
      const texture = this.frame.get_texture();
      const pipeline = this.get_pipeline();
      if (texture) {
        if (pipeline !== this._pipeline || texture !== this._texture)
          pipeline.set_layer_texture(1, texture);
        if (pipeline !== this._pipeline)
          pipeline.set_layer_combine(
            1,
            'RGBA = MODULATE (TEXTURE, PREVIOUS[A])',
          );
        this._pipeline = pipeline;
        this._texture = texture;
      } else {
        pipeline.remove_layer(1);
        this._pipeline = null;
        this._texture = null;
      }
      super.vfunc_paint_target(node, context);
    }
  },
);

export class LiveBackground {
  constructor(actor, source) {
    this.actor = actor;
    this.source = source;
    const frame = new FrameTexture();
    this.driver = new Clutter.Clone({
      source,
      reactive: false,
      min_width: 0,
      min_height: 0,
      natural_width: 0,
      natural_height: 0,
    });
    this._driverDestroyed = false;
    this.driver.connect('destroy', () => {
      this._driverDestroyed = true;
    });
    // The captured pixels must use the background effect's color space.
    this.driver.set_color_state(actor.get_color_state());
    this._colorState = actor.connect('notify::color-state', () =>
      this.driver.set_color_state(actor.get_color_state()),
    );
    this.driver.add_effect(frame);
    // Capture before the background effect builds its pipeline. A child capture
    // runs later, leaving the first paint without a texture (and one paint behind
    // after a resize). The driver itself never draws into this shared parent.
    actor.get_parent().insert_child_below(this.driver, actor);
    this.driver.add_constraint(
      new Clutter.BindConstraint({
        source: actor,
        coordinate: Clutter.BindCoordinate.ALL,
      }),
    );
    // This sibling is laid out first. Follow the background's final allocation
    // in the same pass, so a new secondary view never captures at zero size.
    const allocate = () => {
      if (!this._driverDestroyed && actor.has_allocation())
        this.driver.allocate(actor.get_allocation_box());
    };
    this._allocation = actor.connect('notify::allocation', allocate);
    allocate();
    this.effect = new BackgroundTexture(frame);
    actor.add_effect_with_name('wallshader-background', this.effect);
    this._damaged = source.connect('damaged', () => this.driver.queue_redraw());
  }

  destroy(actorDestroyed = false) {
    this.source.disconnect(this._damaged);
    this.actor.disconnect(this._colorState);
    this.actor.disconnect(this._allocation);
    if (!actorDestroyed) this.actor.remove_effect(this.effect);
    if (!this._driverDestroyed) this.driver.destroy();
  }
}

export class DesktopWallpapers {
  constructor(sourceForMonitor) {
    this._sourceForMonitor = sourceForMonitor;
    this._backgrounds = new Map();
    this._hidden = new Map();
    this._pending = 0;
    this._group = Main.layoutManager._backgroundGroup;
    this._added = this._group.connect('child-added', () => {
      if (this._pending) return;
      this._pending = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        this._pending = 0;
        this.sync();
        return GLib.SOURCE_REMOVE;
      });
    });
  }

  sync() {
    for (const actor of this._group.get_children()) {
      if (!(actor instanceof Meta.BackgroundActor)) continue;
      const source = this._sourceForMonitor(actor.content.monitor);
      const previous = this._backgrounds.get(actor);
      if (previous?.live.source === source) continue;
      if (previous) this._remove(actor);
      if (!source) continue;
      const live = new LiveBackground(actor, source);
      const destroyed = actor.connect('destroy', () =>
        this._remove(actor, true),
      );
      this._backgrounds.set(actor, { live, destroyed });
      if (!this._hidden.has(source)) {
        const opacity = source.opacity;
        const changed = source.connect('notify::opacity', () => {
          // Shell's map and overview transitions can restore window opacity.
          if (source.opacity !== 0) source.opacity = 0;
        });
        this._hidden.set(source, { opacity, changed });
        source.opacity = 0;
      }
    }
    for (const source of this._hidden.keys()) {
      if (
        [...this._backgrounds.values()].some(
          ({ live }) => live.source === source,
        )
      )
        continue;
      this._restore(source);
    }
  }

  _restore(source) {
    const { opacity, changed } = this._hidden.get(source);
    source.disconnect(changed);
    source.opacity = opacity;
    this._hidden.delete(source);
  }

  _remove(actor, destroyed = false) {
    const entry = this._backgrounds.get(actor);
    if (!entry) return;
    this._backgrounds.delete(actor);
    if (!destroyed) actor.disconnect(entry.destroyed);
    entry.live.destroy(destroyed);
  }

  clear() {
    if (this._pending) GLib.source_remove(this._pending);
    this._pending = 0;
    for (const actor of this._backgrounds.keys()) this._remove(actor);
    for (const source of this._hidden.keys()) this._restore(source);
  }

  destroy() {
    this._group.disconnect(this._added);
    this.clear();
  }
}
