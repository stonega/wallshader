import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject';
import { SHADERS, commonFields, isColor } from './catalog.js';
import { importImage } from './images.js';

const column = (spacing = 8) =>
  new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing });
const text = (value, properties = {}) =>
  new Gtk.Label({ label: value, xalign: 0, ...properties });
function button(icon, tooltip, callback) {
  const widget = new Gtk.Button({
    icon_name: icon,
    tooltip_text: tooltip,
    css_classes: ['flat'],
  });
  widget.connect('clicked', callback);
  return widget;
}

export const ShaderEditor = GObject.registerClass(
  class ShaderEditor extends Gtk.Box {
    _init({ onChange, onError, parentWindow }) {
      super._init({ orientation: Gtk.Orientation.VERTICAL, spacing: 16 });
      this.onChange = onChange;
      this.onError = onError;
      this.parentWindow = parentWindow;
      this.numericControls = new Map();
      this._generation = 0;
    }

    setPreset(preset) {
      this._generation++;
      this.preset = preset;
      this._updating = true;
      this.numericControls.clear();
      while (this.get_first_child()) this.remove(this.get_first_child());
      const definition = SHADERS[preset.shader];
      if (definition.hasImage) this.append(this._imageControls());
      this.palette = column(6);
      this.append(this.palette);
      this._buildPalette();

      const effect = column(12);
      for (const field of definition.fields) {
        if (field.type === 'color')
          effect.append(
            this._color(field.label, preset.params[field.key], (value) => {
              preset.params[field.key] = value;
              this._emit();
            }),
          );
        else if (field.type === 'number')
          effect.append(
            this._number(field, preset.params, `params.${field.key}`),
          );
        else if (field.type === 'enum')
          effect.append(
            this._choice(
              field.label,
              field.options,
              field.options.indexOf(preset.params[field.key]),
              (index) => {
                preset.params[field.key] = field.options[index];
                this._emit();
              },
            ).box,
          );
        else if (field.type === 'boolean') {
          const row = new Gtk.Box({
            spacing: 12,
            tooltip_text: field.description,
          });
          row.append(text(field.label, { hexpand: true }));
          const toggle = new Gtk.Switch({
            active: preset.params[field.key],
            valign: Gtk.Align.CENTER,
          });
          toggle.connect('notify::active', () => {
            preset.params[field.key] = toggle.active;
            this._emit();
          });
          row.append(toggle);
          effect.append(row);
        }
      }
      this.append(this._section('Shader settings', effect, true));

      const transform = column(12);
      this.fitChoice = this._choice(
        'Fit',
        ['none', 'contain', 'cover'],
        ['none', 'contain', 'cover'].indexOf(preset.fit),
        (index) => {
          preset.fit = ['none', 'contain', 'cover'][index];
          this._emit();
        },
      );
      transform.append(this.fitChoice.box);
      for (const field of commonFields(preset.shader).filter(
        (field) => !['speed', 'frame'].includes(field.key),
      ))
        transform.append(this._number(field, preset, field.key));
      transform.append(
        text('A world size of 0 follows the canvas.', {
          wrap: true,
          css_classes: ['dim-label', 'caption'],
        }),
      );
      this.append(this._section('Position & size', transform, false));

      const motion = column(12);
      for (const field of commonFields(preset.shader).filter((field) =>
        ['speed', 'frame'].includes(field.key),
      ))
        motion.append(this._number(field, preset, field.key));
      motion.append(
        text(
          'Negative speed plays in reverse. Set speed to 0 to hold an exact frame.',
          { wrap: true, css_classes: ['dim-label', 'caption'] },
        ),
      );
      this.append(this._section('Animation', motion, false));
      this._updating = false;
    }

    _section(title, content, expanded) {
      const expander = new Gtk.Expander({
        label: title,
        expanded,
        css_classes: ['editor-section'],
      });
      content.set_margin_top(12);
      expander.set_child(content);
      return expander;
    }

    syncFrame(frame) {
      this._updating = true;
      this.numericControls.get('frame').adjustment.set_value(frame);
      this._updating = false;
    }

    _choice(title, options, selected, callback) {
      const box = column(5);
      box.append(text(title, { css_classes: ['heading'] }));
      const choice = new Gtk.DropDown({
        model: Gtk.StringList.new(options),
        selected: Math.max(0, selected),
        tooltip_text: title,
        enable_search: options.length > 8,
      });
      choice.connect('notify::selected', () => {
        if (!this._updating) callback(choice.selected);
      });
      box.append(choice);
      return { box, choice };
    }

    _number(field, target, identifier) {
      const box = column(2);
      const row = new Gtk.Box({
        spacing: 8,
        tooltip_text: field.description ?? field.label,
      });
      row.append(text(field.label, { hexpand: true }));
      const adjustment = new Gtk.Adjustment({
        lower: field.min,
        upper: field.max,
        step_increment: field.step,
        page_increment: field.step * 10,
        value: target[field.key],
      });
      const digits = field.step === 1 ? 0 : 2;
      const spin = new Gtk.SpinButton({
        adjustment,
        digits,
        numeric: true,
        width_chars: field.key === 'frame' ? 10 : 5,
        max_width_chars: 10,
        css_classes: ['editor-value'],
      });
      spin.update_property([Gtk.AccessibleProperty.LABEL], [field.label]);
      adjustment.connect('value-changed', () => {
        target[field.key] = adjustment.value;
        this._emit();
      });
      row.append(spin);
      box.append(row);
      if (!['frame', 'worldWidth', 'worldHeight'].includes(field.key)) {
        const scale = new Gtk.Scale({
          orientation: Gtk.Orientation.HORIZONTAL,
          adjustment,
          digits,
          draw_value: false,
          hexpand: true,
        });
        scale.update_property([Gtk.AccessibleProperty.LABEL], [field.label]);
        box.append(scale);
      }
      this.numericControls.set(identifier, { spin, adjustment });
      return box;
    }

    _emit() {
      if (this._updating) return;
      this.preset.paperPreset = null;
      this.onChange();
    }

    _color(title, value, callback) {
      const box = column(4);
      if (title) box.append(text(title));
      const row = new Gtk.Box({ spacing: 6 });
      const rgba = new Gdk.RGBA();
      rgba.parse(value);
      const picker = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({
          title: title || 'Choose color',
          with_alpha: true,
        }),
        rgba,
        tooltip_text: title || 'Choose color',
      });
      const entry = new Gtk.Entry({
        text: value,
        width_chars: 9,
        max_width_chars: 16,
        hexpand: true,
        tooltip_text: 'Hex, RGB, or HSL color, with optional opacity',
      });
      let changing = false;
      const commit = () => {
        if (changing || entry.get_text() === value) return;
        const color = entry.get_text().trim().toLowerCase();
        if (!isColor(color)) {
          entry.add_css_class('error');
          return;
        }
        entry.remove_css_class('error');
        value = color;
        const next = new Gdk.RGBA();
        next.parse(color);
        changing = true;
        picker.rgba = next;
        changing = false;
        callback(color);
      };
      picker.connect('notify::rgba', () => {
        if (changing) return;
        const selected = picker.rgba;
        value = `#${[
          selected.red,
          selected.green,
          selected.blue,
          ...(selected.alpha < 1 ? [selected.alpha] : []),
        ]
          .map((channel) =>
            Math.round(channel * 255)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
        entry.set_text(value);
        entry.remove_css_class('error');
        callback(value);
      });
      entry.connect('activate', commit);
      const focus = new Gtk.EventControllerFocus();
      focus.connect('leave', commit);
      entry.add_controller(focus);
      row.append(picker);
      row.append(entry);
      box.append(row);
      return box;
    }

    _buildPalette() {
      while (this.palette.get_first_child())
        this.palette.remove(this.palette.get_first_child());
      const limit = SHADERS[this.preset.shader].maxColors;
      this.palette.set_visible(limit > 0);
      if (!limit) return;
      const row = new Gtk.Box({ spacing: 8 });
      row.append(text('Colors', { hexpand: true, css_classes: ['heading'] }));
      this.colorCount = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
          lower: 1,
          upper: limit,
          step_increment: 1,
          value: this.preset.colors.length,
        }),
        numeric: true,
        digits: 0,
        tooltip_text: `Number of colors (1–${limit})`,
      });
      this.colorCount.connect('value-changed', () =>
        this.setColorCount(this.colorCount.get_value_as_int()),
      );
      row.append(this.colorCount);
      this.palette.append(row);
      this.preset.colors.forEach((color, index) => {
        const colorBox = this._color('', color, (value) => {
          this.preset.colors[index] = value;
          this._emit();
        });
        const controls = colorBox.get_last_child();
        const up = button('go-up-symbolic', 'Move color up', () =>
          this.moveColor(index, -1),
        );
        up.sensitive = index > 0;
        const down = button('go-down-symbolic', 'Move color down', () =>
          this.moveColor(index, 1),
        );
        down.sensitive = index < this.preset.colors.length - 1;
        controls.append(up);
        controls.append(down);
        this.palette.append(colorBox);
      });
    }

    setColorCount(count) {
      const colors = this.preset.colors;
      count = Math.max(
        1,
        Math.min(SHADERS[this.preset.shader].maxColors, Math.round(count)),
      );
      if (colors.length === count) return;
      while (colors.length < count) colors.push('#ffffff');
      colors.splice(count);
      this._buildPalette();
      this._emit();
    }

    moveColor(index, direction) {
      const target = index + direction;
      if (target < 0 || target >= this.preset.colors.length) return;
      [this.preset.colors[index], this.preset.colors[target]] = [
        this.preset.colors[target],
        this.preset.colors[index],
      ];
      this._buildPalette();
      this._emit();
    }

    _imageControls() {
      const box = column(6);
      box.append(text('Source image', { css_classes: ['heading'] }));
      const name =
        this.preset.image === 'sample'
          ? 'Built-in sample'
          : this.preset.image
            ? 'Local image'
            : 'No image (procedural shape)';
      box.append(text(name, { css_classes: ['dim-label'], ellipsize: 3 }));
      const row = new Gtk.Box({ spacing: 6 });
      const choose = new Gtk.Button({ label: 'Choose Image…', hexpand: true });
      choose.connect('clicked', () => {
        const generation = this._generation;
        const dialog = new Gtk.FileDialog({ title: 'Choose Shader Image' });
        const filter = new Gtk.FileFilter({ name: 'Images' });
        filter.add_pixbuf_formats();
        dialog.default_filter = filter;
        dialog.open(this.parentWindow, null, async (source, result) => {
          try {
            const file = source.open_finish(result);
            choose.sensitive = false;
            const uri = await importImage(file);
            if (generation !== this._generation) return;
            this.preset.image = uri;
            this._emit();
            this.setPreset(this.preset);
          } catch (error) {
            if (!error.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
              this.onError(error);
          } finally {
            choose.sensitive = true;
          }
        });
      });
      row.append(choose);
      row.append(
        button('edit-clear-symbolic', 'Remove image', () => {
          this.preset.image = '';
          this._emit();
          this.setPreset(this.preset);
        }),
      );
      box.append(row);
      const sample = new Gtk.Button({
        label: 'Use Sample',
        css_classes: ['flat'],
      });
      sample.connect('clicked', () => {
        this.preset.image = 'sample';
        this._emit();
        this.setPreset(this.preset);
      });
      box.append(sample);
      return box;
    }
  },
);
