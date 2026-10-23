project('wallshader', version: '0.1.18', meson_version: '>=1.0.0', license: 'GPL-3.0-or-later')

gnome = import('gnome')
i18n = import('i18n')
bun = find_program('bun')
find_program('gjs')
appdir = get_option('prefix') / get_option('datadir') / 'wallshader'
subdir('po')

renderer = custom_target('paper-renderer',
  input: ['src/renderer/renderer.js', 'src/renderer/kitty-shader.js', 'src/renderer/kitty-compat.js', 'src/renderer/kitty-texture.js', 'src/kitty-config.js', 'src/renderer/frame-clock.js', 'src/renderer/frame-stats.js', 'src/renderer/index.html', 'src/catalog.js', 'src/paper-catalog.js', 'src/paper-migration.js', 'src/translation.js', 'src/language.js', 'src/renderer/sample.webp', 'bun.lock'],
  output: ['renderer.js', 'index.html'],
  command: [bun, files('scripts/build.js'), '@OUTDIR@'],
  build_by_default: true,
  install: true,
  install_dir: appdir / 'build' / 'renderer',
)

install_subdir('src', install_dir: appdir, exclude_directories: ['renderer'])
install_data('data/style.css', install_dir: appdir / 'data')
install_subdir('data/icons/hicolor', install_dir: appdir / 'data/icons')
install_subdir('data/third-party', install_dir: appdir / 'data')
if get_option('live_extension')
  install_subdir('build/extension', install_dir: appdir)
endif
if get_option('flatpak')
  find_program('python3')
  find_program('glib-compile-resources')
  custom_target('animation-extension',
    input: renderer,
    output: ['wallshader-extension.zip', 'wallshader-extension.gresource'],
    command: [bun, files('scripts/package-extension.js'), '@OUTPUT0@', '@INPUT0@', '@OUTPUT1@'],
    depend_files: files('scripts/build-extension.js', 'scripts/build-translations.js', 'po/LINGUAS',
      'extension/extension.js', 'extension/desktop-menu.js', 'extension/background.js', 'extension/overview.js',
      'extension/compositing.js', 'extension/metadata.json', 'src/desktop-renderer.js', 'src/live-config.js',
      'src/paths.js', 'src/storage.js', 'src/preview.js', 'src/debug-info.js', 'src/images.js', 'src/i18n.js',
      'po/de.po', 'po/es.po', 'po/fr.po', 'po/ja.po', 'po/ko.po', 'po/pt_BR.po', 'po/zh_CN.po', 'po/zh_TW.po'),
    build_by_default: true,
    install: true,
    install_dir: appdir,
  )
endif
install_data('COPYING', install_dir: appdir)
install_data('data/icons/hicolor/scalable/apps/io.github.wallshader.Wallshader.svg',
  install_dir: get_option('datadir') / 'icons/hicolor/scalable/apps')
i18n.merge_file(
  input: 'data/io.github.wallshader.Wallshader.desktop',
  output: 'io.github.wallshader.Wallshader.desktop',
  type: 'desktop',
  po_dir: 'po',
  install: true,
  install_dir: get_option('datadir') / 'applications',
)

metadata = configuration_data()
metadata.set('APP_ID', get_option('flatpak') ? 'io.github.stonega.wallshader' : 'io.github.wallshader.Wallshader')
configure_file(
  input: 'data/wallshader.metainfo.xml.in',
  output: metadata.get('APP_ID') + '.metainfo.xml',
  configuration: metadata,
  install: true,
  install_dir: get_option('datadir') / 'metainfo',
)

launcher = configuration_data()
launcher.set('APPDIR', appdir)
launcher.set('LOCALEDIR', get_option('prefix') / get_option('localedir'))
configure_file(input: 'data/wallshader.in', output: 'wallshader', configuration: launcher,
  install: true, install_dir: get_option('bindir'), install_mode: 'rwxr-xr-x')
gnome.post_install(gtk_update_icon_cache: true, update_desktop_database: true)
