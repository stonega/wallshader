import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { AspectBox } from './aspect.js';
import { pngBytes } from './wallpaper.js';
import { savedPreviewFile } from './saved-presets.js';
import {
  presetFingerprint,
  presetOptions,
  selectedPresetKey,
} from './preset-options.js';

export const PresetGrid = GObject.registerClass(
  class PresetGrid extends Gtk.Box {
    _init({ onSelect, onDelete, renderThumbnail }) {
      super._init({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
      this.onSelect = onSelect;
      this.onDelete = onDelete;
      this.renderThumbnail = renderThumbnail;
      this._cache = new Map();
      this._generation = 0;
      this.flow = new Gtk.FlowBox({
        homogeneous: true,
        min_children_per_line: 3,
        max_children_per_line: 6,
        selection_mode: Gtk.SelectionMode.NONE,
        column_spacing: 10,
        row_spacing: 10,
        valign: Gtk.Align.START,
        css_classes: ['preset-grid'],
      });
      this.flow.update_property([Gtk.AccessibleProperty.LABEL], ['Presets']);
      this.append(this.flow);
    }

    setPreset(preset, savedPresets) {
      // Control edits only change selection; image changes also rebuild previews.
      if (
        this._presetId === preset.id &&
        this._image === preset.image &&
        this._savedPresets === savedPresets
      ) {
        this.syncSelection(preset);
        return;
      }
      this._presetId = preset.id;
      this._image = preset.image;
      this._savedPresets = savedPresets;
      const generation = ++this._generation;
      while (this.flow.get_first_child())
        this.flow.remove(this.flow.get_first_child());
      this.options = presetOptions(preset, savedPresets);
      this.cards = new Map();
      for (const option of this.options) {
        const card = new Gtk.ToggleButton({
          tooltip_text: option.savedId
            ? `${option.name} (saved preset)`
            : option.name,
          css_classes: ['flat', 'preset-card'],
          overflow: Gtk.Overflow.HIDDEN,
        });
        card.update_property(
          [Gtk.AccessibleProperty.LABEL],
          [card.tooltip_text],
        );
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        const picture = new Gtk.Picture({
          can_shrink: true,
          content_fit: Gtk.ContentFit.COVER,
        });
        const overlay = new Gtk.Overlay({ child: picture });
        const placeholder = new Gtk.Image({
          icon_name: 'image-x-generic-symbolic',
          pixel_size: 16,
          opacity: 0.35,
        });
        overlay.add_overlay(placeholder);
        box.append(
          new AspectBox({
            ratio: 2.2,
            minimumWidth: 64,
            naturalWidth: 96,
            child: overlay,
          }),
        );
        const caption = new Gtk.Box({
          spacing: 3,
          margin_end: option.savedId ? 24 : 0,
          css_classes: ['preset-caption'],
        });
        caption.append(
          new Gtk.Label({
            label: option.name,
            ellipsize: 3,
            max_width_chars: 12,
            hexpand: true,
          }),
        );
        box.append(caption);
        card.set_child(box);
        card.connect('clicked', () => {
          this.preferredKey = option.key;
          this.onSelect(option);
        });
        const tile = new Gtk.Overlay({ child: card });
        let deleteButton = null;
        if (option.savedId) {
          deleteButton = new Gtk.Button({
            child: new Gtk.Image({
              icon_name: 'user-trash-symbolic',
              pixel_size: 12,
            }),
            tooltip_text: `Delete “${option.name}”`,
            css_classes: ['flat', 'preset-delete'],
            halign: Gtk.Align.END,
            valign: Gtk.Align.END,
            margin_end: 4,
            margin_bottom: 4,
          });
          deleteButton.update_property(
            [Gtk.AccessibleProperty.LABEL],
            [deleteButton.tooltip_text],
          );
          deleteButton.connect('clicked', () => this.onDelete(option.savedId));
          tile.add_overlay(deleteButton);
        }
        this.flow.append(tile);
        this.cards.set(option.key, {
          card,
          picture,
          placeholder,
          deleteButton,
        });
      }
      this.syncSelection(preset);
      this.ready = this._loadThumbnails(generation);
    }

    syncSelection(preset) {
      this.selectedKey = selectedPresetKey(
        this.options,
        preset,
        this.preferredKey,
      );
      for (const [key, { card }] of this.cards)
        card.set_active(key === this.selectedKey);
    }

    async _loadThumbnails(generation) {
      for (const option of this.options) {
        if (this._closed || generation !== this._generation) return;
        const key = presetFingerprint(option.preset);
        let texture = this._cache.get(key);
        const { picture, placeholder, card } = this.cards.get(option.key);
        try {
          if (!texture && option.savedId) {
            try {
              texture = Gdk.Texture.new_from_file(
                savedPreviewFile(option.savedId),
              );
            } catch {
              /* Rebuild a missing or damaged cached preview from its settings. */
            }
          }
          if (!texture) {
            const uri = await this.renderThumbnail(option.preset);
            texture = Gdk.Texture.new_from_bytes(new GLib.Bytes(pngBytes(uri)));
          }
          if (this._closed || generation !== this._generation) return;
          this._cache.set(key, texture);
          if (this._cache.size > 128)
            this._cache.delete(this._cache.keys().next().value);
          picture.set_paintable(texture);
          placeholder.set_visible(false);
        } catch (error) {
          if (this._closed || generation !== this._generation) return;
          placeholder.set_from_icon_name('image-missing-symbolic');
          card.set_tooltip_text(
            `${option.name}: preview unavailable. ${error.message}`,
          );
        }
      }
    }

    close() {
      this._closed = true;
      this._generation++;
      this._cache.clear();
    }
  },
);
