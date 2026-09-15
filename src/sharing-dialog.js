import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';

export function showSharingDialog(
  window,
  { title, content = '', editable = false, onApply },
) {
  const dialog = new Adw.Dialog({
    title,
    content_width: 600,
    content_height: 520,
  });
  const toolbar = new Adw.ToolbarView();
  const header = new Adw.HeaderBar();
  toolbar.add_top_bar(header);
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    margin_start: 18,
    margin_end: 18,
    margin_top: 12,
    margin_bottom: 18,
  });
  box.append(
    new Gtk.Label({
      label: editable
        ? 'Paste a shader from Paper’s Code section, or settings copied from Wallshader.'
        : 'These settings use Paper’s original shader properties.',
      wrap: true,
      xalign: 0,
    }),
  );
  const view = new Gtk.TextView({
    monospace: true,
    editable,
    wrap_mode: Gtk.WrapMode.WORD_CHAR,
    top_margin: 12,
    bottom_margin: 12,
    left_margin: 12,
    right_margin: 12,
  });
  view.get_buffer().set_text(content, -1);
  const scroll = new Gtk.ScrolledWindow({
    vexpand: true,
    child: view,
    css_classes: ['card'],
  });
  box.append(scroll);
  const message = new Gtk.Label({
    wrap: true,
    xalign: 0,
    visible: false,
    css_classes: ['error'],
  });
  box.append(message);
  const apply = new Gtk.Button({
    label: editable ? 'Apply Settings' : 'Copy to Clipboard',
    css_classes: ['suggested-action', 'pill'],
  });
  apply.connect('clicked', () => {
    try {
      const buffer = view.get_buffer();
      const value = buffer.get_text(
        buffer.get_start_iter(),
        buffer.get_end_iter(),
        false,
      );
      if (editable) onApply(value);
      else
        window
          .get_clipboard()
          .set_content(Gdk.ContentProvider.new_for_value(value));
      dialog.close();
    } catch (error) {
      message.set_label(error.message);
      message.set_visible(true);
    }
  });
  box.append(apply);
  toolbar.set_content(box);
  dialog.set_child(toolbar);
  dialog.present(window);
  return dialog;
}
