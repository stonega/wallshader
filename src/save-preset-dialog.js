import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { AspectBox } from './aspect.js';
import { pngBytes } from './wallpaper.js';

export const SavePresetDialog = GObject.registerClass(
  class SavePresetDialog extends Adw.Dialog {
    _init({ name, loadPreview, onSave }) {
      super._init({ title: 'Save Preset', content_width: 400 });
      this.onSave = onSave;
      this._closed = false;
      this.connect('closed', () => {
        this._closed = true;
      });
      const toolbar = new Adw.ToolbarView();
      const header = new Adw.HeaderBar({
        show_start_title_buttons: false,
        show_end_title_buttons: false,
      });
      const cancel = new Gtk.Button({ label: 'Cancel' });
      cancel.connect('clicked', () => this.close());
      header.pack_start(cancel);
      this.saveButton = new Gtk.Button({
        label: 'Save',
        sensitive: false,
        css_classes: ['suggested-action'],
      });
      this.saveButton.connect('clicked', () => {
        this.saveTask = this.save();
      });
      header.pack_end(this.saveButton);
      toolbar.add_top_bar(header);
      const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 16,
        margin_start: 24,
        margin_end: 24,
        margin_top: 12,
        margin_bottom: 24,
      });
      this.picture = new Gtk.Picture({
        can_shrink: true,
        content_fit: Gtk.ContentFit.COVER,
      });
      const preview = new Gtk.Overlay({ child: this.picture });
      this.spinner = new Gtk.Spinner({
        spinning: true,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
      });
      preview.add_overlay(this.spinner);
      content.append(
        new AspectBox({
          child: preview,
          minimumWidth: 200,
          naturalWidth: 352,
          css_classes: ['saved-preset-preview'],
          overflow: Gtk.Overflow.HIDDEN,
        }),
      );
      const field = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
      });
      this.nameEntry = new Gtk.Entry({
        text: name,
        max_length: 80,
        activates_default: true,
      });
      const nameLabel = new Gtk.Label({
        label: '_Name',
        use_underline: true,
        mnemonic_widget: this.nameEntry,
        xalign: 0,
      });
      field.append(nameLabel);
      field.append(this.nameEntry);
      content.append(field);
      this.message = new Gtk.Label({
        wrap: true,
        xalign: 0,
        visible: false,
        css_classes: ['error'],
      });
      content.append(this.message);
      this.nameEntry.connect('changed', () => this._syncSave());
      toolbar.set_content(content);
      this.set_child(toolbar);
      this.set_default_widget(this.saveButton);
      this.set_focus(this.nameEntry);
      this.nameEntry.select_region(0, -1);
      this.ready = this._loadPreview(loadPreview);
    }

    _syncSave() {
      this.saveButton.set_sensitive(
        Boolean(this.snapshot) &&
          Boolean(this.nameEntry.text.trim()) &&
          !this._saving,
      );
    }

    async _loadPreview(loadPreview) {
      try {
        const snapshot = await loadPreview();
        if (this._closed) return;
        this.picture.set_paintable(
          Gdk.Texture.new_from_bytes(
            new GLib.Bytes(pngBytes(snapshot.preview)),
          ),
        );
        this.snapshot = snapshot;
        this._syncSave();
      } catch (error) {
        if (this._closed) return;
        this.message.set_label(
          `Could not create the preview: ${error.message}`,
        );
        this.message.set_visible(true);
      } finally {
        this.spinner.set_spinning(false);
        this.spinner.set_visible(false);
      }
    }

    async save() {
      if (
        this._closed ||
        this._saving ||
        !this.snapshot ||
        !this.nameEntry.text.trim()
      )
        return;
      this._saving = true;
      this.set_can_close(false);
      this.nameEntry.set_sensitive(false);
      this._syncSave();
      try {
        const saved = await this.onSave(this.nameEntry.text, this.snapshot);
        this.set_can_close(true);
        this.close();
        return saved;
      } catch (error) {
        this.message.set_label(error.message);
        this.message.set_visible(true);
      } finally {
        this._saving = false;
        this.set_can_close(true);
        this.nameEntry.set_sensitive(true);
        this._syncSave();
      }
    }
  },
);
