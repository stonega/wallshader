import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import WebKit from 'gi://WebKit?version=6.0';

const fields = [
  ['shader', 'Shader / preset'],
  ['viewport', 'Viewport / scale'],
  ['canvas', 'Canvas / limit'],
  ['fps', 'Observed FPS'],
  ['frames', 'Interval / frames'],
  ['playback', 'Playback'],
  ['frame', 'Time / speed'],
  ['backend', 'GTK / WebKit'],
  ['gpu', 'WebGL renderer'],
];

export class DebugInfo {
  constructor(view) {
    this.view = view;
    this.widget = new Gtk.Overlay({
      child: view,
      hexpand: true,
      vexpand: true,
    });
    this.panel = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 4,
      halign: Gtk.Align.START,
      valign: Gtk.Align.START,
      margin_start: 10,
      margin_end: 10,
      margin_top: 10,
      margin_bottom: 10,
      css_classes: ['debug-info'],
      visible: false,
      can_target: false,
    });
    const header = new Gtk.Box({ spacing: 8 });
    header.append(
      new Gtk.Label({ label: 'Debug info', xalign: 0, hexpand: true }),
    );
    this.panel.append(header);
    const grid = new Gtk.Grid({ column_spacing: 10, row_spacing: 2 });
    this.values = new Map();
    for (const [row, [key, title]] of fields.entries()) {
      grid.attach(new Gtk.Label({ label: title, xalign: 1 }), 0, row, 1, 1);
      const value = new Gtk.Label({
        label: '—',
        xalign: 0,
        hexpand: true,
        width_chars: 32,
        max_width_chars: 48,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
      });
      grid.attach(value, 1, row, 1, 1);
      this.values.set(key, value);
    }
    this.panel.append(grid);
    this.widget.add_overlay(this.panel);
    this.widget.set_clip_overlay(this.panel, true);
  }

  update(info) {
    this.info = info;
    const backend = this.view.get_native()?.get_renderer()?.constructor
      .$gtype.name;
    const version = [
      WebKit.get_major_version(),
      WebKit.get_minor_version(),
      WebKit.get_micro_version(),
    ].join('.');
    const values = {
      shader: `${info.shader} / ${info.preset}`,
      viewport: `${info.viewport.join(' × ')} / ${info.scale}×`,
      canvas: `${info.canvas.join(' × ')} / 2.07 MP`,
      fps: `${info.fps.toFixed(1)} / ${info.targetFps || 'display'} target`,
      frames: `${info.frameInterval === null ? '—' : `${info.frameInterval.toFixed(1)} ms`} / ${info.total} observed`,
      playback: info.contextLost
        ? 'WebGL context lost'
        : info.paused
          ? 'Paused'
          : info.speed === 0
            ? 'Static'
            : info.busy
              ? 'Rendering image'
              : 'Playing',
      frame: `${Math.round(info.frame).toLocaleString()} ms / ${info.speed}×`,
      backend: `${backend ?? '—'} / ${version}`,
      gpu: info.gpu,
    };
    for (const [key, text] of Object.entries(values)) {
      const value = this.values.get(key);
      value.set_label(text);
    }
  }
}
