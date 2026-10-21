import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Gettext from 'gettext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { watchState } from './app/src/storage.js';

const { gettext: _ } = Gettext.domain('wallshader');

export class DesktopMenu {
  constructor(path) {
    Gettext.bindtextdomain(
      'wallshader',
      GLib.build_filenamev([path, 'app', 'build', 'locale']),
    );
    this._items = new Map();
    this._managers = new Map();
    this._pending = 0;
    this._showMenu = true;
    this._group = Main.layoutManager._backgroundGroup;
    this._added = this._group.connect('child-added', () => this._queueSync());
    this._removed = this._group.connect('child-removed', () =>
      this._queueSync(),
    );
    this._session = Main.sessionMode.connect('updated', () => this._sync());
    try {
      this._monitor = watchState((state) => {
        this._showMenu = state.showDesktopMenu !== false;
        this._sync();
      });
    } catch (error) {
      console.warn(`Could not watch desktop menu preference: ${error.message}`);
    }
    this._sync();
  }

  _queueSync() {
    if (this._pending) return;
    // Shell attaches a menu after adding the background actor to its group.
    this._pending = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._pending = 0;
      this._sync();
      return GLib.SOURCE_REMOVE;
    });
  }

  _sync() {
    const managers = Main.layoutManager._bgManagers;
    for (const [manager, signal] of this._managers) {
      if (managers.includes(manager)) continue;
      manager.disconnect(signal);
      this._managers.delete(manager);
    }
    for (const manager of managers) {
      if (!this._managers.has(manager))
        this._managers.set(
          manager,
          manager.connect('changed', () => this._sync()),
        );
    }
    for (const actor of this._group.get_children()) {
      const menu = actor._backgroundMenu;
      if (!menu || this._items.has(menu)) continue;
      const item = new PopupMenu.PopupMenuItem(_('Open Wallshader'));
      item.connect('activate', () => this._open());
      item.connect('destroy', () => this._items.delete(menu));
      const background =
        menu._settingsActions['gnome-background-panel.desktop'];
      menu.addMenuItem(item, menu._getMenuItems().indexOf(background) + 1);
      this._items.set(menu, item);
    }
    for (const item of this._items.values())
      item.visible = Main.sessionMode.allowSettings && this._showMenu;
  }

  _open() {
    if (!Main.sessionMode.allowSettings || !this._showMenu) return;
    const app = Shell.AppSystem.get_default().lookup_app(
      'io.github.wallshader.Wallshader.desktop',
    );
    if (!app) {
      Main.notifyError(
        'Wallshader',
        _('Install Wallshader to open it from the desktop menu.'),
      );
      return;
    }
    Main.overview.hide();
    app.activate();
  }

  destroy() {
    this._monitor?.cancel();
    this._monitor = null;
    if (this._pending) GLib.source_remove(this._pending);
    this._pending = 0;
    this._group.disconnect(this._added);
    this._group.disconnect(this._removed);
    Main.sessionMode.disconnect(this._session);
    for (const [manager, signal] of this._managers) manager.disconnect(signal);
    this._managers.clear();
    for (const item of this._items.values()) item.destroy();
    this._items.clear();
  }
}
