import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix?version=2.0';
import GLib from 'gi://GLib';

// This fake owns only the test desktop's private bus. It never changes settings.
const xml = `<node>
  <interface name="org.freedesktop.portal.Settings">
    <property name="version" type="u" access="read"/>
    <method name="ReadAll"><arg type="as" direction="in"/><arg type="a{sa{sv}}" direction="out"/></method>
    <method name="Read"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <method name="ReadOne"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <signal name="SettingChanged"><arg type="s"/><arg type="s"/><arg type="v"/></signal>
  </interface>
  <interface name="org.freedesktop.portal.Wallpaper">
    <method name="SetWallpaperFile">
      <arg type="s" direction="in"/><arg type="h" direction="in"/>
      <arg type="a{sv}" direction="in"/><arg type="o" direction="out"/>
    </method>
  </interface>
  <interface name="io.github.stonega.wallshader.Test">
    <method name="GetState"><arg type="s" direction="out"/></method>
    <method name="Respond"><arg type="u" direction="in"/></method>
  </interface>
</node>`;
const connection = Gio.DBus.session;
const pending = [];
const calls = [];
const exportedObjects = [];
// GTK in Flatpak obtains font scaling from the settings portal. Without these
// defaults, headless outputs with no physical DPI can produce infinite WebKit
// zoom and a 0x0 viewport on a secondary view.
const settings = {
  'org.gnome.desktop.interface': {
    'font-name': new GLib.Variant('s', 'Cantarell 11'),
    'document-font-name': new GLib.Variant('s', 'Sans 11'),
    'monospace-font-name': new GLib.Variant('s', 'Monospace 11'),
    'text-scaling-factor': new GLib.Variant('d', 1),
    'gtk-theme': new GLib.Variant('s', 'Adwaita'),
    'icon-theme': new GLib.Variant('s', 'Adwaita'),
  },
  'org.gnome.desktop.a11y.interface': {
    'high-contrast': new GLib.Variant('b', false),
  },
  'org.freedesktop.appearance': {
    'color-scheme': new GLib.Variant('u', 0),
    contrast: new GLib.Variant('u', 0),
    'accent-color': new GLib.Variant('(ddd)', [-1, -1, -1]),
  },
};
function readSetting(namespace, key) {
  const value = settings[namespace]?.[key];
  if (!value) throw new Error(`No such test setting: ${namespace}/${key}`);
  return value;
}
const implementation = {
  version: 2,
  ReadAll(patterns) {
    return Object.fromEntries(
      Object.entries(settings).filter(
        ([namespace]) =>
          patterns.length === 0 ||
          patterns.some(
            (pattern) =>
              pattern === namespace ||
              (pattern.endsWith('*') &&
                namespace.startsWith(pattern.slice(0, -1))),
          ),
      ),
    );
  },
  Read(namespace, key) {
    return new GLib.Variant('(v)', [
      new GLib.Variant('v', readSetting(namespace, key)),
    ]);
  },
  ReadOne(namespace, key) {
    return new GLib.Variant('(v)', [readSetting(namespace, key)]);
  },
  SetWallpaperFileAsync([parent, handle, options], invocation) {
    const fd = invocation.get_message().get_unix_fd_list().get(handle);
    const stream = new GioUnix.InputStream({ fd, close_fd: true });
    const signature = Array.from(stream.read_bytes(8, null).get_data());
    stream.close(null);
    const sender = invocation.get_sender();
    const token = options.handle_token.deepUnpack();
    const path = `/org/freedesktop/portal/desktop/request/${sender.slice(1).replaceAll('.', '_')}/${token}`;
    calls.push({
      parent,
      signature,
      setOn: options['set-on'].deepUnpack(),
      preview: options['show-preview'].deepUnpack(),
    });
    pending.push({ sender, path });
    invocation.return_value(new GLib.Variant('(o)', [path]));
  },
  GetState() {
    return JSON.stringify({ calls, pending: pending.length });
  },
  Respond(code) {
    const request = pending.shift();
    if (!request) throw new Error('No pending wallpaper request');
    connection.emit_signal(
      request.sender,
      request.path,
      'org.freedesktop.portal.Request',
      'Response',
      new GLib.Variant('(ua{sv})', [code, {}]),
    );
  },
};
// Export each interface explicitly: wrapJSObject consumes one interface.
for (const iface of [
  'org.freedesktop.portal.Settings',
  'org.freedesktop.portal.Wallpaper',
  'io.github.stonega.wallshader.Test',
]) {
  const info = Gio.DBusNodeInfo.new_for_xml(xml).lookup_interface(iface);
  const object = Gio.DBusExportedObject.wrapJSObject(info, implementation);
  object.export(connection, '/org/freedesktop/portal/desktop');
  exportedObjects.push(object);
}
Gio.bus_own_name_on_connection(
  connection,
  'org.freedesktop.portal.Desktop',
  Gio.BusNameOwnerFlags.NONE,
  () => {
    GLib.file_set_contents(
      `${GLib.get_user_runtime_dir()}/wallshader-portal-ready`,
      'ready',
    );
    console.log('Private wallpaper portal ready');
  },
  () => {
    console.error('Could not own the private wallpaper portal');
    loop.quit();
  },
);
const loop = new GLib.MainLoop(null, false);
loop.run();
