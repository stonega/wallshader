import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import { WorkspaceThumbnail } from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import { LiveBackground } from './background.js';

// Present the existing Wayland textures through GNOME's background actors.
export class OverviewWallpapers {
  constructor(sourceForMonitor) {
    this._sourceForMonitor = sourceForMonitor;
    this._watched = new Map();
    this._backgrounds = new Map();
    this._pending = 0;
  }

  sync() {
    if (!Main.overview.visible) return;
    this._sync();
    // Later showing handlers can still add secondary-monitor thumbnails.
    this._queueSync();
  }

  _sync() {
    const controls = Main.overview._overview.controls;
    const display = controls._workspacesDisplay;
    this._visit(display);
    this._visit(controls._thumbnailsBox);
    for (const view of display._workspacesViews) this._visit(view);
  }

  _queueSync() {
    if (this._pending) return;
    this._pending = global.compositor
      .get_laters()
      .add(Meta.LaterType.BEFORE_REDRAW, () => {
        this._pending = 0;
        if (Main.overview.visible) this._sync();
        return GLib.SOURCE_REMOVE;
      });
  }

  _visit(actor) {
    if (!actor) return;
    if (!this._watched.has(actor)) {
      this._watched.set(actor, [
        actor.connect('child-added', (_parent, child) => {
          // Secondary-monitor thumbnails can arrive after this frame's later.
          // Attach their background before their first visible paint.
          this._visit(child);
          this._queueSync();
        }),
        actor.connect('destroy', () => {
          this._removeBackground(actor, true);
          this._unwatch(actor);
        }),
      ]);
    }
    if (actor instanceof Workspace) {
      const group = actor._background._backgroundGroup;
      this._visit(group);
      for (const background of group.get_children())
        if (background instanceof Meta.BackgroundActor)
          this._ensureBackground(background, actor.monitorIndex);
    } else if (actor instanceof WorkspaceThumbnail) {
      this._ensureBackground(actor, actor.monitorIndex, true);
    } else {
      for (const child of actor.get_children()) this._visit(child);
    }
  }

  _ensureBackground(actor, index, thumbnail = false) {
    const source = this._sourceForMonitor(index);
    const existing = this._backgrounds.get(actor);
    if (existing?.source === source) return;
    this._removeBackground(actor);
    if (!source) return;
    let background = actor;
    if (thumbnail) {
      const monitor = Main.layoutManager.monitors[index];
      background = Meta.BackgroundActor.new(global.display, index);
      const manager = Main.layoutManager._bgManagers[index];
      background.content.background =
        manager.backgroundActor.content.background;
      background.set_position(monitor.x, monitor.y);
      background.set_size(monitor.width, monitor.height);
      actor._contents.insert_child_at_index(background, 0);
    }
    this._backgrounds.set(actor, {
      live: new LiveBackground(background, source),
      source,
      thumbnail,
    });
  }

  _removeBackground(actor, destroyed = false) {
    const entry = this._backgrounds.get(actor);
    if (!entry) return;
    this._backgrounds.delete(actor);
    entry.live.destroy(destroyed);
    if (entry.thumbnail && !destroyed) entry.live.actor.destroy();
  }

  _unwatch(actor) {
    for (const id of this._watched.get(actor) ?? []) actor.disconnect(id);
    this._watched.delete(actor);
  }

  clear() {
    if (this._pending) global.compositor.get_laters().remove(this._pending);
    this._pending = 0;
    for (const actor of this._watched.keys()) this._unwatch(actor);
    for (const actor of this._backgrounds.keys()) this._removeBackground(actor);
  }
}
