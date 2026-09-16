import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import {
  PRESETS,
  SHADERS,
  createPreset,
  normalizePreset,
  filterPresets,
  validateDimensions,
} from './catalog.js';
import { Store } from './storage.js';
import { Wallpaper, pngBytes, savePng } from './wallpaper.js';
import { Preview } from './preview.js';
import { LiveWallpaper, LoginRequiredError } from './live.js';
import { AspectBox } from './aspect.js';
import { ShaderEditor } from './editor.js';
import { PresetGrid } from './preset-grid.js';
import { fromPaperParams, presetIdForShader } from './catalog.js';
import { exportSettings, paperCode, parseSettings } from './sharing.js';
import { showSharingDialog } from './sharing-dialog.js';
import { SavePresetDialog } from './save-preset-dialog.js';
import { deleteNamedPreset, saveNamedPreset } from './saved-presets.js';
import {
  presetOptions,
  randomPresetName,
  selectedPresetKey,
} from './preset-options.js';

const vertical = (spacing = 0, props = {}) =>
  new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing, ...props });
const label = (text, classes = [], props = {}) =>
  new Gtk.Label({ label: text, xalign: 0, css_classes: classes, ...props });
const iconButton = (icon, tooltip, callback) => {
  const button = new Gtk.Button({ icon_name: icon, tooltip_text: tooltip });
  button.connect('clicked', callback);
  return button;
};

export const WallshaderWindow = GObject.registerClass(
  class WallshaderWindow extends Adw.ApplicationWindow {
    _init(application) {
      super._init({
        application,
        title: 'Wallshader',
        default_width: 1040,
        default_height: 900,
        width_request: 560,
        height_request: 600,
      });
      this.store = new Store();
      this.wallpaper = new Wallpaper();
      this.live = new LiveWallpaper(() => this._updateLiveStatus());
      this.preset = normalizePreset(
        this.store.state.selected,
        this.store.state.presets[this.store.state.selected],
      );
      this._category = 'All';
      this._paused = !Gtk.Settings.get_default().gtk_enable_animations;
      this._busy = false;
      this._ready = false;
      this._saveTimeout = null;
      this._closed = false;
      this._cards = new Map();
      this._renderGeneration = 0;
      this.toasts = new Adw.ToastOverlay();
      this.set_content(this.toasts);
      this.preview = new Preview((error) => this._previewError(error));
      this.debugAction = new Gio.SimpleAction({
        name: 'debug-info',
        state: new GLib.Variant('b', this.store.state.debugInfo),
      });
      this.debugAction.connect('change-state', (_action, value) =>
        this.setDebugInfo(value.deepUnpack()),
      );
      this.add_action(this.debugAction);

      this.split = new Adw.OverlaySplitView({
        sidebar_position: Gtk.PackType.END,
        min_sidebar_width: 350,
        max_sidebar_width: 380,
        sidebar_width_fraction: 0.27,
      });
      this.toasts.set_child(this.split);
      this.split.set_content(this._buildContent());
      this.split.set_sidebar(this._buildInspector());
      const breakpoint = new Adw.Breakpoint({
        condition: Adw.BreakpointCondition.parse('max-width: 880px'),
      });
      breakpoint.add_setter(this.split, 'collapsed', true);
      this.add_breakpoint(breakpoint);
      this._refreshSelection();
      this.set_focus(this.searchButton);
      this._syncAvailability();
      this.live.refresh();

      this.connect('close-request', () => {
        this._closed = true;
        if (this._saveTimeout) GLib.source_remove(this._saveTimeout);
        this._saveTimeout = null;
        this._save();
        this.presetGrid.close();
        this.preview.close();
        this.live.close();
        return false;
      });
      this.connect('notify::is-active', () => {
        if (this._ready && !this._closed)
          this.preview
            .pause(this._paused || !this.is_active)
            .catch((error) => this.showError(error));
      });
      this.ready = this._startPreview();
      this.ready.catch((error) => this._previewError(error));
    }

    _buildContent() {
      const toolbar = new Adw.ToolbarView();
      const header = new Adw.HeaderBar({
        title_widget: new Adw.WindowTitle({
          title: 'Wallshader',
          subtitle: 'Wallpapers made with Paper',
        }),
      });
      this.searchButton = iconButton(
        'system-search-symbolic',
        'Search wallpapers (Ctrl+F)',
        () => {
          this.search.set_visible(!this.search.get_visible());
          if (this.search.get_visible()) this.search.grab_focus();
          else this.search.set_text('');
        },
      );
      header.pack_start(this.searchButton);
      header.pack_end(
        iconButton('document-edit-symbolic', 'Show wallpaper controls', () =>
          this.split.set_show_sidebar(!this.split.get_show_sidebar()),
        ),
      );
      const menu = new Gio.Menu();
      menu.append('Import Paper Settings…', 'app.import-settings');
      menu.append('Copy Settings…', 'app.copy-settings');
      menu.append('Copy Paper Code…', 'app.copy-code');
      menu.append('Show Debug Info', 'win.debug-info');
      menu.append('Restore Previous Wallpaper', 'app.restore');
      menu.append('About Wallshader', 'app.about');
      menu.append('Quit', 'app.quit');
      header.pack_end(
        new Gtk.MenuButton({
          icon_name: 'open-menu-symbolic',
          menu_model: menu,
        }),
      );
      toolbar.add_top_bar(header);

      const scroll = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
      });
      const content = vertical(0, { css_classes: ['workspace'] });
      this.search = new Gtk.SearchEntry({
        placeholder_text: 'Search wallpapers',
        visible: false,
        margin_bottom: 16,
      });
      this.search.connect('search-changed', () => this._filter());
      this.search.connect('stop-search', () => {
        this.search.set_text('');
        this.search.set_visible(false);
      });
      content.append(this.search);

      const titleRow = new Gtk.Box({ spacing: 12, margin_bottom: 16 });
      this.nameLabel = label(this.preset.name, ['title-1'], {
        hexpand: true,
      });
      titleRow.append(this.nameLabel);
      this.exportButton = iconButton(
        'image-x-generic-symbolic',
        'Export PNG…',
        () => this.exportPng(),
      );
      this.savePresetButton = iconButton(
        'wallshader-save-preset-symbolic',
        'Save Preset…',
        () => this.showSavePreset(),
      );
      this.resetButton = iconButton('edit-undo-symbolic', 'Reset Changes', () =>
        this.resetPreset(),
      );
      this.favoriteButton = iconButton(
        'non-starred-symbolic',
        'Add to favorites',
        () => this._toggleFavorite(),
      );
      for (const button of [
        this.savePresetButton,
        this.exportButton,
        this.resetButton,
        this.favoriteButton,
      ]) {
        button.set_valign(Gtk.Align.CENTER);
        button.add_css_class('flat');
        titleRow.append(button);
      }
      content.append(titleRow);

      this.previewFrame = new AspectBox({
        ratio: 16 / 9,
        css_classes: ['preview-frame'],
        overflow: Gtk.Overflow.HIDDEN,
      });
      this.previewStack = new Gtk.Stack();
      this.previewStack.add_named(this.preview.widget, 'canvas');
      this.errorPage = new Adw.StatusPage({
        icon_name: 'dialog-warning-symbolic',
        title: 'Preview unavailable',
      });
      this.previewStack.add_named(this.errorPage, 'error');
      this.previewOverlay = new Gtk.Overlay({ child: this.previewStack });
      this.previewFrame.set_child(this.previewOverlay);
      content.append(this.previewFrame);
      this.pauseButton = iconButton(
        this._paused
          ? 'media-playback-start-symbolic'
          : 'media-playback-pause-symbolic',
        this._paused ? 'Play preview' : 'Pause preview',
        () => this._togglePause(),
      );
      this.pauseButton.set_css_classes([
        'flat',
        'circular',
        'preview-playback',
      ]);
      this.pauseButton.set_halign(Gtk.Align.START);
      this.pauseButton.set_valign(Gtk.Align.END);
      this.pauseButton.set_margin_start(12);
      this.pauseButton.set_margin_bottom(12);
      this.previewOverlay.add_overlay(this.pauseButton);

      this.presetGrid = new PresetGrid({
        onSelect: (option) => {
          if (option.savedId) this.selectSavedPreset(option.savedId);
          else if (option.key === 'default') this.resetPreset();
          else this.selectPaperPreset(option.index);
        },
        onDelete: (id) => this.deleteSavedPreset(id),
        renderThumbnail: (preset) =>
          this.preview.request('thumbnail', { preset }),
      });
      this.presetGrid.set_margin_top(16);
      content.append(this.presetGrid);

      const filters = new Gtk.Box({
        spacing: 6,
        css_classes: ['gallery-heading'],
      });
      const categories = [
        'All',
        'Gradients',
        'Patterns',
        'Image filters',
        'Logo effects',
        'Favorites',
      ];
      const category = new Gtk.DropDown({
        model: Gtk.StringList.new(categories),
        tooltip_text: 'Filter collection',
      });
      category.connect('notify::selected', () => {
        this._category = categories[category.selected];
        this._filter();
      });
      filters.append(category);
      this.countLabel = label(`${PRESETS.length} wallpapers`, ['dim-label'], {
        hexpand: true,
        xalign: 1,
      });
      filters.append(this.countLabel);
      content.append(filters);
      this.gallery = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        homogeneous: true,
        // Keep surplus vertical space from stretching the thumbnail rows.
        valign: Gtk.Align.START,
        min_children_per_line: 2,
        max_children_per_line: 3,
        row_spacing: 10,
        column_spacing: 10,
      });
      for (const item of PRESETS) {
        const card = new Gtk.Button({
          css_classes: ['flat', 'gallery-card'],
          tooltip_text: `${item.name} — ${SHADERS[item.shader].name}`,
        });
        const box = vertical();
        const picture = new Gtk.Picture({
          can_shrink: true,
          content_fit: Gtk.ContentFit.COVER,
          hexpand: true,
        });
        const aspect = new AspectBox({
          ratio: 16 / 9,
          thumbnail: true,
          child: picture,
          css_classes: ['thumbnail'],
          overflow: Gtk.Overflow.HIDDEN,
        });
        box.append(aspect);
        const caption = new Gtk.Box({
          spacing: 6,
          css_classes: ['card-label'],
        });
        caption.append(label(item.name, [], { hexpand: true }));
        const star = new Gtk.Image({
          icon_name: 'starred-symbolic',
          pixel_size: 12,
          visible: false,
          css_classes: ['favorite-star'],
        });
        caption.append(star);
        box.append(caption);
        card.set_child(box);
        card.connect('clicked', () => this.selectPreset(item.id));
        this.gallery.insert(card, -1);
        this._cards.set(item.id, {
          card,
          picture,
          star,
          child: card.get_parent(),
        });
      }
      content.append(this.gallery);
      this.empty = new Adw.StatusPage({
        title: 'No wallpapers found',
        description: 'Try a different search or collection.',
        icon_name: 'system-search-symbolic',
        visible: false,
      });
      content.append(this.empty);
      const credit = new Gtk.LinkButton({
        uri: 'https://github.com/paper-design/shaders',
        label: 'Made with Paper Shaders',
        halign: Gtk.Align.CENTER,
        css_classes: ['attribution', 'flat'],
      });
      content.append(credit);
      scroll.set_child(content);
      toolbar.set_content(scroll);
      return toolbar;
    }

    _buildInspector() {
      const toolbar = new Adw.ToolbarView();
      toolbar.add_top_bar(
        new Adw.HeaderBar({
          title_widget: label('Customize', ['heading']),
          show_start_title_buttons: false,
        }),
      );
      const scroll = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
      });
      this.inspector = vertical(0, { css_classes: ['inspector'] });
      this.editor = new ShaderEditor({
        parentWindow: this,
        onChange: () => this._changed(),
        onError: (error) => this.showError(error),
      });
      this.inspector.append(this.editor);
      this.wallpaperSettings = this._buildWallpaperSettings();
      const actions = new Gtk.Box({
        spacing: 8,
        css_classes: ['export-actions'],
      });
      this.applyButton = new Gtk.Button({
        label: 'Set as Wallpaper',
        hexpand: true,
        css_classes: ['suggested-action', 'pill'],
        tooltip_text: 'Apply this frame to your GNOME desktop',
      });
      this.applyButton.connect('clicked', () => this.applyWallpaper());
      actions.append(this.applyButton);
      this.wallpaperSettingsButton = iconButton(
        'emblem-system-symbolic',
        'Wallpaper Settings',
        () => this.wallpaperSettings.present(this),
      );
      this.wallpaperSettingsButton.add_css_class('circular');
      this.wallpaperSettingsButton.add_css_class('wallpaper-settings');
      this.wallpaperSettingsButton.set_valign(Gtk.Align.CENTER);
      actions.append(this.wallpaperSettingsButton);
      actions.set_margin_start(18);
      actions.set_margin_end(18);
      actions.set_margin_bottom(14);
      toolbar.add_bottom_bar(actions);
      scroll.set_child(this.inspector);
      toolbar.set_content(scroll);
      return toolbar;
    }

    _buildWallpaperSettings() {
      const dialog = new Adw.Dialog({
        title: 'Wallpaper Settings',
        content_width: 400,
        content_height: 440,
      });
      const toolbar = new Adw.ToolbarView();
      toolbar.add_top_bar(new Adw.HeaderBar());
      const content = vertical(0, {
        margin_start: 24,
        margin_end: 24,
        margin_top: 12,
        margin_bottom: 24,
      });
      content.append(label('Wallpaper mode', ['heading']));
      this.wallpaperMode = new Gtk.DropDown({
        model: Gtk.StringList.new(['Still image', 'Animated shader']),
        selected: 1,
        tooltip_text: 'Wallpaper mode',
        margin_top: 8,
      });
      this.wallpaperMode.connect('notify::selected', () =>
        this._updateLiveStatus(),
      );
      content.append(this.wallpaperMode);
      this.liveOptions = vertical(8, { margin_top: 10, visible: false });
      this.liveOptions.append(
        label('Animation frame rate', ['dim-label', 'caption']),
      );
      this.liveFps = new Gtk.DropDown({
        model: Gtk.StringList.new(['30 FPS · less power', '60 FPS · smoother']),
        tooltip_text: 'Wallpaper frame rate',
      });
      this.liveOptions.append(this.liveFps);
      this.liveStatus = label(
        'Runs on the desktop after closing this app.',
        ['dim-label', 'caption'],
        { wrap: true },
      );
      this.liveOptions.append(this.liveStatus);
      const liveActions = new Gtk.Box({ spacing: 8 });
      this.livePauseButton = new Gtk.Button({ label: 'Pause', hexpand: true });
      this.livePauseButton.connect('clicked', () =>
        this.live
          .pause(!this.live.status.manualPaused)
          .catch((error) => this.showError(error)),
      );
      this.liveStopButton = new Gtk.Button({ label: 'Stop', hexpand: true });
      this.liveStopButton.connect('clicked', () =>
        this.live.stop().catch((error) => this.showError(error)),
      );
      liveActions.append(this.livePauseButton);
      liveActions.append(this.liveStopButton);
      this.liveOptions.append(liveActions);
      content.append(this.liveOptions);
      content.append(label('Output resolution', ['section-label']));
      const resolutions = Gtk.StringList.new([
        'This display',
        '1920 × 1080',
        '2560 × 1440',
        '3840 × 2160',
        '3440 × 1440',
      ]);
      this.resolution = new Gtk.DropDown({
        model: resolutions,
        tooltip_text: 'Wallpaper resolution',
        margin_top: 8,
      });
      this.resolution.connect('notify::selected', () => this._updateRatio());
      content.append(this.resolution);
      this.wallpaperHint = label(
        'Applies a still image to light and dark appearances.',
        ['dim-label', 'caption'],
        { wrap: true, margin_top: 10 },
      );
      content.append(this.wallpaperHint);
      const scroll = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        child: content,
      });
      toolbar.set_content(scroll);
      dialog.set_child(toolbar);
      return dialog;
    }

    _buildControls() {
      this.editor.setPreset(this.preset);
      this.presetGrid.setPreset(this.preset, this.store.state.savedPresets);
    }

    _updateLiveStatus() {
      if (!this.wallpaperMode || this._closed) return;
      const animated = this.wallpaperMode.selected === 1;
      const status = this.live.status;
      this.liveOptions.set_visible(animated || status.active);
      this.wallpaperHint.set_label(
        animated
          ? 'Animates on every display and sets its first frame as the still background. GNOME 50 on Wayland is required.'
          : 'Applies a still image to light and dark appearances.',
      );
      this.liveStatus.set_label(
        status.error ||
          (status.active
            ? !status.ready
              ? 'Starting desktop animation…'
              : `${status.name} · ${status.paused ? status.reason : 'Playing on desktop'}`
            : status.available
              ? 'Ready. Keeps playing after closing this app.'
              : 'First use installs animation support. GNOME may require one logout before it is available.'),
      );
      this.livePauseButton.set_sensitive(status.active && !this._busy);
      this.liveStopButton.set_sensitive(status.active && !this._busy);
      this.livePauseButton.set_label(status.manualPaused ? 'Resume' : 'Pause');
      if (!this._busy && this.applyButton)
        this.applyButton.set_label(
          animated ? 'Set Animated Wallpaper' : 'Set as Wallpaper',
        );
    }

    selectPaperPreset(index) {
      if (this._busy) return;
      this.presetGrid.preferredKey = `paper:${index}`;
      const variant = SHADERS[this.preset.shader].presets[index];
      this.preset = fromPaperParams(
        this.preset.id,
        { ...variant.params, image: this.preset.image },
        index,
      );
      this._refreshSelection();
      this._changed();
    }

    selectSavedPreset(id) {
      if (this._busy) return;
      const saved = this.store.state.savedPresets.find(
        (item) => item.id === id,
      );
      if (!saved || saved.preset.shader !== this.preset.shader) return;
      this.preset = normalizePreset(this.preset.id, saved.preset);
      this.presetGrid.preferredKey = `saved:${id}`;
      this._refreshSelection();
      this._changed();
    }

    deleteSavedPreset(id) {
      if (this._busy) return;
      try {
        const saved = deleteNamedPreset(this.store, id);
        if (!saved) return;
        this.presetGrid.setPreset(this.preset, this.store.state.savedPresets);
        this.toasts.add_toast(
          new Adw.Toast({ title: `Deleted “${saved.name}”` }),
        );
      } catch (error) {
        this.showError(error);
      }
    }

    showSavePreset() {
      if (this._busy || !this._ready || this._selectionError) return null;
      if (this.savePresetDialog) {
        this.savePresetDialog.present(this);
        return this.savePresetDialog;
      }
      const preset = normalizePreset(this.preset.id, this.preset);
      const dialog = new SavePresetDialog({
        name: randomPresetName(preset, this.store.state.savedPresets),
        loadPreview: async () => {
          const state = await this.preview.request('state');
          preset.frame = normalizePreset(preset.id, {
            ...preset,
            frame: state.frame,
          }).frame;
          const preview = await this.preview.request('thumbnail', { preset });
          return { preset, preview };
        },
        onSave: (name, snapshot) => {
          const saved = saveNamedPreset(
            this.store,
            name,
            snapshot.preset,
            snapshot.preview,
          );
          this.selectSavedPreset(saved.id);
          this.toasts.add_toast(
            new Adw.Toast({ title: `Saved “${saved.name}”` }),
          );
          return saved;
        },
      });
      this.savePresetDialog = dialog;
      dialog.connect('closed', () => {
        this.savePresetDialog = null;
      });
      dialog.present(this);
      return dialog;
    }

    importSettings(source) {
      if (this._busy)
        throw new Error('Wait for the current image to finish rendering.');
      const { shader, params } = parseSettings(source);
      const id =
        this.preset.shader === shader
          ? this.preset.id
          : presetIdForShader(shader);
      this._remember();
      this.preset = fromPaperParams(id, params);
      this.store.state.selected = id;
      this._refreshSelection();
      this._changed();
    }

    showSettings(mode) {
      const editable = mode === 'import';
      showSharingDialog(this, {
        title: editable
          ? 'Import Paper Settings'
          : mode === 'code'
            ? 'Paper Code'
            : 'Wallpaper Settings',
        content: editable
          ? ''
          : mode === 'code'
            ? paperCode(this.preset, this._dimensions())
            : exportSettings(this.preset),
        editable,
        onApply: (source) => this.importSettings(source),
      });
    }

    async _startPreview() {
      await this.preview.ready;
      if (this._closed) return;
      await this._renderPreset();
      await this.preview.pause(this._paused || !this.is_active);
      this._ready = true;
      this._updateRatio();
      this._syncAvailability();
      if (this.store.warning) this.showError(new Error(this.store.warning));
      for (const item of PRESETS) {
        if (this._closed) return;
        try {
          const uri = await this.preview.request('thumbnail', {
            preset: createPreset(item.id),
          });
          this._cards
            .get(item.id)
            .picture.set_paintable(
              Gdk.Texture.new_from_bytes(new GLib.Bytes(pngBytes(uri))),
            );
        } catch (error) {
          if (this._closed) return;
          this._cards.get(item.id).picture.set_tooltip_text(error.message);
          console.warn(`${item.name} thumbnail: ${error.message}`);
        }
      }
    }

    async _renderPreset() {
      const generation = ++this._renderGeneration;
      try {
        await this.preview.select(this.preset);
        if (generation === this._renderGeneration && !this._closed) {
          this._selectionError = false;
          this._syncAvailability();
        }
      } catch (error) {
        if (generation !== this._renderGeneration || this._closed) return;
        this._selectionError = true;
        this._syncAvailability();
        this.showError(error);
      }
    }

    selectPreset(id) {
      if (this._busy) return;
      this._remember();
      this.preset = normalizePreset(id, this.store.state.presets[id]);
      this.store.state.selected = this.preset.id;
      this._refreshSelection();
      const rendered = this._ready ? this._renderPreset() : Promise.resolve();
      this._saveSoon();
      return rendered;
    }

    _refreshSelection() {
      this.nameLabel.set_label(this.preset.name);
      this._buildControls();
      this._refreshFavorites();
      for (const [id, { card }] of this._cards) {
        if (id === this.preset.id) card.add_css_class('selected');
        else card.remove_css_class('selected');
      }
    }

    _toggleFavorite() {
      const favorites = this.store.state.favorites;
      const index = favorites.indexOf(this.preset.id);
      if (index >= 0) favorites.splice(index, 1);
      else favorites.push(this.preset.id);
      this._refreshFavorites();
      this._filter();
      this._saveSoon();
    }

    _refreshFavorites() {
      const favorite = this.store.state.favorites.includes(this.preset.id);
      this.favoriteButton.set_icon_name(
        favorite ? 'starred-symbolic' : 'non-starred-symbolic',
      );
      if (favorite) this.favoriteButton.add_css_class('favorite-star');
      else this.favoriteButton.remove_css_class('favorite-star');
      this.favoriteButton.set_tooltip_text(
        favorite ? 'Remove from favorites' : 'Add to favorites',
      );
      for (const [id, { star }] of this._cards)
        star.set_visible(this.store.state.favorites.includes(id));
    }

    _filter() {
      const matches = new Set(
        filterPresets(
          this._category,
          this.search.get_text(),
          this.store.state.favorites,
        ).map((item) => item.id),
      );
      for (const [id, { child }] of this._cards)
        child.set_visible(matches.has(id));
      this.countLabel.set_label(
        `${matches.size} ${matches.size === 1 ? 'wallpaper' : 'wallpapers'}`,
      );
      this.empty.set_visible(matches.size === 0);
      this.gallery.set_visible(matches.size > 0);
      this.empty.set_description(
        this._category === 'Favorites' && !this.search.get_text()
          ? 'Star a wallpaper to keep it here.'
          : 'Try a different search or collection.',
      );
    }

    _changed() {
      this.presetGrid.setPreset(this.preset, this.store.state.savedPresets);
      this._remember();
      if (this._ready) this._renderPreset();
      this._saveSoon();
    }

    _remember() {
      this.store.state.presets[this.preset.id] = normalizePreset(
        this.preset.id,
        this.preset,
      );
    }
    _save() {
      try {
        this._remember();
        this.store.save();
      } catch (error) {
        this.showError(error);
      }
    }
    _saveSoon() {
      if (this._saveTimeout) GLib.source_remove(this._saveTimeout);
      this._saveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        this._saveTimeout = null;
        this._save();
        return GLib.SOURCE_REMOVE;
      });
    }

    setDebugInfo(enabled) {
      this.store.state.debugInfo = enabled;
      this.debugAction.set_state(new GLib.Variant('b', enabled));
      this._save();
    }

    resetPreset() {
      this.presetGrid.preferredKey = 'default';
      this.preset = createPreset(this.preset.id);
      this._refreshSelection();
      this._changed();
      this.toasts.add_toast(
        new Adw.Toast({ title: 'Wallpaper changes reset' }),
      );
    }

    async _togglePause() {
      this._paused = !this._paused;
      this.pauseButton.set_icon_name(
        this._paused
          ? 'media-playback-start-symbolic'
          : 'media-playback-pause-symbolic',
      );
      this.pauseButton.set_tooltip_text(
        this._paused ? 'Play preview' : 'Pause preview',
      );
      try {
        await this.preview.pause(this._paused);
        if (this._paused) {
          this.preset.frame = (await this.preview.request('state')).frame;
          this.editor.syncFrame(this.preset.frame);
          this.presetGrid.syncSelection(this.preset);
          this._saveSoon();
        }
      } catch (error) {
        this.showError(error);
      }
    }

    _previewError(error) {
      this._ready = false;
      if (this.errorPage) {
        this.errorPage.set_description(error.message);
        this.previewStack.set_visible_child_name('error');
      }
      if (this.applyButton) this._syncAvailability();
      console.error(error.message);
    }

    _syncAvailability() {
      const available = this._ready && !this._busy && !this._selectionError;
      for (const widget of [
        this.applyButton,
        this.exportButton,
        this.savePresetButton,
        this.pauseButton,
      ])
        widget.set_sensitive(available);
      for (const widget of [
        this.editor,
        this.presetGrid,
        this.resolution,
        this.resetButton,
        this.gallery,
      ])
        widget.set_sensitive(!this._busy);
      this.application
        .lookup_action('restore')
        ?.set_enabled(this.wallpaper.canRestore && !this._busy);
      this.wallpaperMode.set_sensitive(!this._busy);
      this.liveFps.set_sensitive(!this._busy);
      this._updateLiveStatus();
    }

    _dimensions() {
      const sizes = [
        null,
        [1920, 1080],
        [2560, 1440],
        [3840, 2160],
        [3440, 1440],
      ];
      let size = sizes[this.resolution.get_selected()];
      if (!size) {
        const surface = this.get_surface();
        const monitor = surface
          ? this.get_display().get_monitor_at_surface(surface)
          : this.get_display().get_monitors().get_item(0);
        if (monitor) {
          const geometry = monitor.get_geometry();
          const scale = monitor.get_scale();
          size = [
            Math.round(geometry.width * scale),
            Math.round(geometry.height * scale),
          ];
        } else size = [1920, 1080];
      }
      return validateDimensions(...size);
    }

    _updateRatio() {
      try {
        const { width, height } = this._dimensions();
        this.previewFrame.set_ratio(width / height);
      } catch (error) {
        this.showError(error);
      }
    }

    async _capture(action) {
      if (this._busy || !this._ready) return;
      this._busy = true;
      this._syncAvailability();
      this.applyButton.set_label('Rendering…');
      try {
        // A failed image selection must never export the previously shown shader.
        await this.preview.select(this.preset);
        const state = await this.preview.request('state');
        const preset = normalizePreset(this.preset.id, {
          ...this.preset,
          frame: state.frame,
        });
        const data = await this.preview.request('capture', {
          ...this._dimensions(),
          frame: preset.frame,
        });
        await action(data, preset);
      } catch (error) {
        this.showError(error);
      } finally {
        this._busy = false;
        this.applyButton.set_label('Set as Wallpaper');
        this._syncAvailability();
      }
    }

    async _saveAppliedPreset(preset) {
      try {
        const savedPresets = this.store.state.savedPresets;
        const options = presetOptions(this.preset, savedPresets);
        // Playback advancing alone must not create another preset.
        if (
          selectedPresetKey(options, this.preset) ||
          selectedPresetKey(options, preset)
        )
          return;
        const preview = await this.preview.request('thumbnail', { preset });
        const saved = saveNamedPreset(
          this.store,
          randomPresetName(preset, this.store.state.savedPresets),
          preset,
          preview,
        );
        this.preset = normalizePreset(preset.id, preset);
        this.presetGrid.preferredKey = `saved:${saved.id}`;
        this._refreshSelection();
        this._remember();
        this._saveSoon();
      } catch (error) {
        this.showError(
          new Error(
            `Wallpaper applied, but the preset could not be saved: ${error.message}`,
          ),
        );
      }
    }

    applyWallpaper() {
      if (this.wallpaperMode.selected === 1)
        return this.applyAnimatedWallpaper();
      return this._capture(async (data, preset) => {
        await this.live.stop();
        await this.wallpaper.apply(data, preset.id);
        await this._saveAppliedPreset(preset);
        this.toasts.add_toast(
          new Adw.Toast({
            title: `${this.preset.name} set as wallpaper`,
            button_label: 'Undo',
            action_name: 'app.restore',
          }),
        );
      });
    }

    async applyAnimatedWallpaper() {
      if (this._busy || !this._ready) return;
      this._busy = true;
      this._syncAvailability();
      this.applyButton.set_label('Starting…');
      try {
        await this.preview.select(this.preset);
        const state = await this.preview.request('state');
        const preset = normalizePreset(this.preset.id, {
          ...this.preset,
          frame: state.frame,
        });
        // Capture the exact starting frame even while the preview keeps playing.
        const data = await this.preview.request('capture', {
          ...this._dimensions(),
          frame: preset.frame,
        });
        await this.wallpaper.apply(data, preset.id);
        await this._saveAppliedPreset(preset);
        await this.live.apply(preset, this.liveFps.selected === 1 ? 60 : 30);
        this.toasts.add_toast(
          new Adw.Toast({
            title: 'Animated wallpaper requested',
            button_label: 'Undo',
            action_name: 'app.restore',
          }),
        );
      } catch (error) {
        if (error instanceof LoginRequiredError) {
          if (!this._closed) {
            const dialog = new Adw.AlertDialog({
              heading: 'Log Out to Finish Setup',
              body: error.message,
              default_response: 'ok',
              close_response: 'ok',
            });
            dialog.add_response('ok', 'Got It');
            dialog.present(this);
          }
        } else this.showError(error);
      } finally {
        this._busy = false;
        this._syncAvailability();
      }
    }

    exportPng() {
      const dialog = new Gtk.FileDialog({
        title: 'Export Wallpaper',
        initial_name: `${this.preset.id}.png`,
      });
      const filter = new Gtk.FileFilter({ name: 'PNG images' });
      filter.add_mime_type('image/png');
      const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
      filters.append(filter);
      dialog.set_filters(filters);
      dialog.save(this, null, (source, result) => {
        try {
          const file = source.save_finish(result);
          this._capture(async (data) => {
            await savePng(file, data);
            this.toasts.add_toast(
              new Adw.Toast({ title: 'Wallpaper exported' }),
            );
          });
        } catch (error) {
          if (!error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
            this.showError(error);
        }
      });
    }

    async restoreWallpaper() {
      try {
        await this.live.stop();
        this.wallpaper.restore();
        this._syncAvailability();
        this.toasts.add_toast(
          new Adw.Toast({ title: 'Previous wallpaper restored' }),
        );
      } catch (error) {
        this.showError(error);
      }
    }

    showError(error) {
      console.error(error.message);
      if (!this._closed)
        this.toasts.add_toast(
          new Adw.Toast({ title: error.message, timeout: 8 }),
        );
    }
  },
);
