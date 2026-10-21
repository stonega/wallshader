import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Graphene from 'gi://Graphene';
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
      this._masks = [];
    }

    vfunc_paint(node, context, flags) {
      const actor = this.get_actor();
      const texture = this.frame.get_texture();
      if (!texture || flags & Clutter.EffectPaintFlags.BYPASS_EFFECT) {
        super.vfunc_paint(node, context, flags);
        return;
      }
      const opacity = actor.get_paint_opacity() / 255;
      const color = new Cogl.Color();
      color.init_from_4f(opacity, opacity, opacity, opacity);
      const frameNode = Clutter.TextureNode.new(
        texture,
        color,
        Clutter.ScalingFilter.LINEAR,
        Clutter.ScalingFilter.LINEAR,
      );
      const rectangle = (x1, y1, x2, y2) =>
        new Clutter.ActorBox({ x1, y1, x2, y2 });
      const drawFrame = (box) =>
        frameNode.add_texture_rectangle(
          box,
          box.x1 / actor.width,
          box.y1 / actor.height,
          box.x2 / actor.width,
          box.y2 / actor.height,
        );
      const radius = actor.content.rounded_clip_radius;
      if (radius <= 0) {
        drawFrame(rectangle(0, 0, actor.width, actor.height));
        node.add_child(frameNode);
        return;
      }
      const index = actor.content.monitor;
      const monitor = Main.layoutManager.monitors[index];
      const area = Main.layoutManager.getWorkAreaForMonitor(index);
      const sx = actor.width / monitor.width;
      const sy = actor.height / monitor.height;
      // Only the corner rectangles contain non-opaque native mask pixels.
      // Include the work-area insets and two extra pixels for filtering. The
      // curve itself is still painted by BackgroundContent, at resource scale.
      const left = Math.ceil((area.x - monitor.x + radius + 2) * sx);
      const right = Math.floor(
        (area.x - monitor.x + area.width - radius - 2) * sx,
      );
      const top = Math.ceil((area.y - monitor.y + radius + 2) * sy);
      const bottom = Math.floor(
        (area.y - monitor.y + area.height - radius - 2) * sy,
      );
      if (left >= right || top >= bottom) {
        super.vfunc_paint(node, context, flags);
        return;
      }
      drawFrame(rectangle(left, 0, right, actor.height));
      drawFrame(rectangle(0, top, left, bottom));
      drawFrame(rectangle(right, top, actor.width, bottom));
      node.add_child(frameNode);
      const boxes = [
        rectangle(0, 0, left, top),
        rectangle(right, 0, actor.width, top),
        rectangle(0, bottom, left, actor.height),
        rectangle(right, bottom, actor.width, actor.height),
      ];
      const scale = actor.get_resource_scale();
      for (const [i, box] of boxes.entries()) {
        const width = Math.max(1, Math.ceil((box.x2 - box.x1) * scale));
        const height = Math.max(1, Math.ceil((box.y2 - box.y1) * scale));
        let mask = this._masks[i];
        const changed = !mask || mask.width !== width || mask.height !== height;
        if (changed) {
          const maskTexture = Cogl.Texture2D.new_with_size(
            texture.get_context(),
            width,
            height,
          );
          const buffer = Cogl.Offscreen.new_with_texture(maskTexture);
          buffer.allocate();
          const pipeline = Cogl.Pipeline.new(texture.get_context());
          pipeline.set_layer_texture(0, maskTexture);
          pipeline.set_layer_filters(
            0,
            Cogl.PipelineFilter.LINEAR,
            Cogl.PipelineFilter.LINEAR,
          );
          pipeline.set_layer_combine(
            1,
            'RGBA = MODULATE (TEXTURE, PREVIOUS[A])',
          );
          mask = { width, height, buffer, pipeline };
          this._masks[i] = mask;
        }
        const identity = new Graphene.Matrix();
        identity.init_identity();
        mask.buffer.set_modelview_matrix(identity);
        mask.buffer.orthographic(box.x1, box.y1, box.x2, box.y2, -1, 1);
        mask.buffer.set_viewport(0, 0, width, height);
        if (
          changed ||
          flags & Clutter.EffectPaintFlags.ACTOR_DIRTY ||
          mask.radius !== radius
        ) {
          const layer = Clutter.LayerNode.new_to_framebuffer(
            mask.buffer,
            mask.pipeline,
          );
          layer.add_child(Clutter.ActorNode.new(actor, 255));
          node.add_child(layer);
          mask.radius = radius;
        }
        mask.pipeline.set_layer_texture(1, texture);
        // Each corner samples its own portion of the shared live frame; its
        // native alpha texture still uses the complete [0, 1] coordinate range.
        const coordinates = new Graphene.Matrix();
        coordinates.init_from_2d(
          (box.x2 - box.x1) / actor.width,
          0,
          0,
          (box.y2 - box.y1) / actor.height,
          box.x1 / actor.width,
          box.y1 / actor.height,
        );
        mask.pipeline.set_layer_matrix(1, coordinates);
        mask.pipeline.set_color(color);
        const corner = Clutter.PipelineNode.new(mask.pipeline);
        corner.add_rectangle(box);
        node.add_child(corner);
      }
    }

    // Retain the full native mask for unusually small allocations where the
    // corner rectangles overlap, and the original background before readiness.
    vfunc_paint_target(node, context) {
      const pipeline = this.get_pipeline();
      const texture = this.frame.get_texture();
      if (texture) {
        pipeline.set_layer_texture(1, texture);
        pipeline.set_layer_combine(1, 'RGBA = MODULATE (TEXTURE, PREVIOUS[A])');
      } else {
        pipeline.remove_layer(1);
      }
      super.vfunc_paint_target(node, context);
    }
  },
);

const captures = new Map();

// Capture each monitor once, before any of its desktop or overview backgrounds.
// Keep it at the renderer's pixel budget instead of allocating a full-size
// offscreen surface for every workspace and thumbnail.
class FrameCapture {
  constructor(actor, source) {
    this.source = source;
    this.clients = new Set();
    this.frame = new FrameTexture();
    this.driver = new Clutter.Clone({
      name: 'wallshader-frame',
      source,
      reactive: false,
      min_width: 0,
      min_height: 0,
      natural_width: 0,
      natural_height: 0,
    });
    this.driver.set_color_state(actor.get_color_state());
    this.driver.add_effect(this.frame);
    global.stage.insert_child_at_index(this.driver, 0);
    const resize = () => {
      const width = Math.max(1, source.width);
      const height = Math.max(1, source.height);
      this.driver.set_position(source.x, source.y);
      const scale = Math.max(1, Math.ceil(this.driver.get_resource_scale()));
      const factor = Math.min(
        1,
        Math.sqrt((1920 * 1080) / (width * height)) / scale,
      );
      this.driver.set_size(
        Math.max(1, Math.round(width * factor)),
        Math.max(1, Math.round(height * factor)),
      );
      this.invalidate();
    };
    this._allocation = source.connect('notify::allocation', resize);
    this._scale = this.driver.connect('resource-scale-changed', resize);
    this._damaged = source.connect('damaged', () => this.invalidate());
    resize();
  }

  invalidate() {
    this.driver.queue_redraw();
    for (const effect of this.clients) effect.queue_repaint();
  }

  release(effect) {
    this.clients.delete(effect);
    if (this.clients.size) return;
    this.source.disconnect(this._allocation);
    this.source.disconnect(this._damaged);
    this.driver.disconnect(this._scale);
    this.driver.destroy();
    captures.delete(this.source);
  }
}

export class LiveBackground {
  constructor(actor, source) {
    this.actor = actor;
    this.source = source;
    this.capture = captures.get(source) ?? new FrameCapture(actor, source);
    captures.set(source, this.capture);
    this.driver = this.capture.driver;
    this._colorState = actor.connect('notify::color-state', () =>
      this.driver.set_color_state(actor.get_color_state()),
    );
    this.effect = new BackgroundTexture(this.capture.frame);
    this.capture.clients.add(this.effect);
    actor.add_effect_with_name('wallshader-background', this.effect);
  }

  destroy(actorDestroyed = false) {
    this.actor.disconnect(this._colorState);
    if (!actorDestroyed) this.actor.remove_effect(this.effect);
    this.capture.release(this.effect);
  }
}

export class DesktopWallpapers {
  constructor(sourceForMonitor) {
    this._sourceForMonitor = sourceForMonitor;
    this._backgrounds = new Map();
    this._hidden = new Map();
    this._pending = 0;
    this._visible = true;
    this._group = Main.layoutManager._backgroundGroup;
    this._added = this._group.connect('child-added', () => this._queueSync());
  }

  _queueSync() {
    if (this._pending) return;
    this._pending = global.compositor
      .get_laters()
      .add(Meta.LaterType.BEFORE_REDRAW, () => {
        this._pending = 0;
        this.sync();
        return GLib.SOURCE_REMOVE;
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
      live.driver.visible = this._visible;
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

  setVisible(visible) {
    this._visible = visible;
    for (const { live } of this._backgrounds.values()) {
      if (live.driver.visible === visible) continue;
      live.driver.visible = visible;
      if (visible) live.capture.invalidate();
    }
  }

  _remove(actor, destroyed = false) {
    const entry = this._backgrounds.get(actor);
    if (!entry) return;
    this._backgrounds.delete(actor);
    if (!destroyed) actor.disconnect(entry.destroyed);
    entry.live.destroy(destroyed);
  }

  clear() {
    if (this._pending) global.compositor.get_laters().remove(this._pending);
    this._pending = 0;
    for (const actor of this._backgrounds.keys()) this._remove(actor);
    for (const source of this._hidden.keys()) this._restore(source);
  }

  destroy() {
    this._group.disconnect(this._added);
    this.clear();
  }
}
