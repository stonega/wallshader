project('wallshader', version: '0.1.8', meson_version: '>=1.0.0', license: 'GPL-3.0-or-later')

gnome = import('gnome')
bun = find_program('bun')
find_program('gjs')
appdir = get_option('prefix') / get_option('datadir') / 'wallshader'

renderer = custom_target('paper-renderer',
  input: ['src/renderer/renderer.js', 'src/renderer/kitty-shader.js', 'src/renderer/kitty-compat.js', 'src/renderer/kitty-texture.js', 'src/kitty-config.js', 'src/renderer/frame-clock.js', 'src/renderer/frame-stats.js', 'src/renderer/index.html', 'src/catalog.js', 'src/paper-catalog.js', 'src/paper-migration.js', 'src/renderer/sample.webp', 'bun.lock'],
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
install_subdir('build/extension', install_dir: appdir)
install_data('COPYING', install_dir: appdir)
install_data('data/icons/hicolor/scalable/apps/io.github.wallshader.Wallshader.svg',
  install_dir: get_option('datadir') / 'icons/hicolor/scalable/apps')
install_data('data/io.github.wallshader.Wallshader.desktop', install_dir: get_option('datadir') / 'applications')

launcher = configuration_data()
launcher.set('APPDIR', appdir)
configure_file(input: 'data/wallshader.in', output: 'wallshader', configuration: launcher,
  install: true, install_dir: get_option('bindir'), install_mode: 'rwxr-xr-x')
gnome.post_install(gtk_update_icon_cache: true, update_desktop_database: true)
