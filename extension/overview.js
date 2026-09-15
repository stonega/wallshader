import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import { WorkspaceThumbnail } from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

// Share the existing Wayland window textures with the overview. Only watch the
// workspace containers; the app grid and window previews need no traversal.
export class OverviewWallpapers {
  constructor(sourceForMonitor) {
    this._sourceForMonitor = sourceForMonitor;
    this._watched = new Map();
    this._clones = new Map();
    this._pending = 0;
  }

  sync() {
    if (!Main.overview.visible) return;
    const controls = Main.overview._overview.controls;
    const display = controls._workspacesDisplay;
    this._visit(display);
    this._visit(controls._thumbnailsBox);
    for (const view of display._workspacesViews) this._visit(view);
  }

  _queueSync() {
    if (this._pending) return;
    this._pending = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._pending = 0;
      this.sync();
      return GLib.SOURCE_REMOVE;
    });
  }

  _visit(actor) {
    if (!actor) return;
    if (!this._watched.has(actor)) {
      this._watched.set(actor, [
        actor.connect('child-added', () => this._queueSync()),
        actor.connect('destroy', () => {
          this._removeClone(actor);
          this._unwatch(actor);
        }),
      ]);
    }
    if (actor instanceof Workspace) {
      this._ensureClone(actor, actor._background._backgroundGroup, false);
    } else if (actor instanceof WorkspaceThumbnail) {
      this._ensureClone(actor, actor._contents, true);
    } else {
      for (const child of actor.get_children()) this._visit(child);
    }
  }

  _ensureClone(actor, parent, thumbnail) {
    const source = this._sourceForMonitor(actor.monitorIndex);
    const existing = this._clones.get(actor);
    if (existing?.source === source) return;
    this._removeClone(actor);
    if (!source) return;
    const clone = new Clutter.Clone({
      name: 'wallshader-overview',
      source,
      reactive: false,
      x_expand: !thumbnail,
      y_expand: !thumbnail,
      // A clone otherwise requests the desktop window's full pixel size and
      // forces GNOME's workspace previews to grow beyond their normal layout.
      min_width: 0,
      min_height: 0,
      natural_width: 0,
      natural_height: 0,
    });
    if (thumbnail) {
      const monitor = Main.layoutManager.monitors[actor.monitorIndex];
      clone.set_position(monitor.x, monitor.y);
      clone.set_size(monitor.width, monitor.height);
      parent.insert_child_at_index(clone, 0);
    } else {
      parent.add_child(clone);
    }
    this._clones.set(actor, { clone, source });
  }

  _removeClone(actor) {
    this._clones.get(actor)?.clone.destroy();
    this._clones.delete(actor);
  }

  _unwatch(actor) {
    for (const id of this._watched.get(actor) ?? []) actor.disconnect(id);
    this._watched.delete(actor);
  }

  clear() {
    if (this._pending) GLib.source_remove(this._pending);
    this._pending = 0;
    for (const actor of this._watched.keys()) this._unwatch(actor);
    for (const actor of this._clones.keys()) this._removeClone(actor);
  }
}
