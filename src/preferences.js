import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { _, availableLanguages } from './i18n.js';
import { languageName } from './language.js';
import { IS_FLATPAK } from './paths.js';

export function showPreferences(window) {
  if (window.preferencesDialog) {
    window.preferencesDialog.present(window);
    return window.preferencesDialog;
  }
  const dialog = new Adw.PreferencesDialog({
    title: _('Preferences'),
    content_width: 460,
    content_height: 400,
  });
  const page = new Adw.PreferencesPage({
    title: _('General'),
    icon_name: 'preferences-system-symbolic',
  });
  const group = new Adw.PreferencesGroup({
    title: _('Interface'),
  });
  const notice = new Gtk.Label({
    label: _('Language changes take effect the next time you open Wallshader.'),
    wrap: true,
    xalign: 0,
    css_classes: ['dim-label'],
    margin_top: 12,
    margin_start: 12,
    margin_end: 12,
  });
  const selected = Math.max(
    0,
    availableLanguages.indexOf(window.store.state.language),
  );
  const row = new Adw.ComboRow({
    title: _('Language'),
    model: Gtk.StringList.new(
      availableLanguages.map((code) =>
        code ? languageName(code) : _('System Default'),
      ),
    ),
    selected,
  });
  const error = new Gtk.Label({
    wrap: true,
    xalign: 0,
    visible: false,
    css_classes: ['error'],
    margin_top: 12,
  });
  let previous = selected;
  let updating = false;
  row.connect('notify::selected', () => {
    if (updating) return;
    const saved = window.store.state.language;
    window.store.state.language = availableLanguages[row.selected];
    try {
      window._remember();
      window.store.save();
      previous = row.selected;
      error.visible = false;
    } catch (exception) {
      window.store.state.language = saved;
      updating = true;
      row.selected = previous;
      updating = false;
      error.label = exception.message;
      error.visible = true;
    }
  });
  group.add(row);
  const desktopMenu = new Adw.SwitchRow({
    visible: !IS_FLATPAK,
    title: _('Show Desktop Menu Shortcut'),
    subtitle: _('Show “Open Wallshader” in the desktop right-click menu.'),
    active: window.store.state.showDesktopMenu,
  });
  let updatingMenu = false;
  desktopMenu.connect('notify::active', () => {
    if (updatingMenu) return;
    const saved = window.store.state.showDesktopMenu;
    window.store.state.showDesktopMenu = desktopMenu.active;
    try {
      window._remember();
      window.store.save();
      error.visible = false;
    } catch (exception) {
      window.store.state.showDesktopMenu = saved;
      updatingMenu = true;
      desktopMenu.active = saved;
      updatingMenu = false;
      error.label = exception.message;
      error.visible = true;
    }
  });
  group.add(desktopMenu);
  group.add(notice);
  group.add(error);
  page.add(group);
  dialog.add(page);
  dialog.languageRow = row;
  dialog.desktopMenuRow = desktopMenu;
  dialog.languageCodes = availableLanguages;
  dialog.errorLabel = error;
  dialog.connect('closed', () => {
    window.preferencesDialog = null;
  });
  window.preferencesDialog = dialog;
  dialog.present(window);
  return dialog;
}
