Name: wallshader
Version: 0.1.6
Release: 1
Summary: Native GNOME wallpapers made with Paper Shaders
License: GPL-3.0-or-later AND Apache-2.0
URL: https://github.com/stonega/wallshader
Source0: https://github.com/stonega/wallshader/releases/download/v%{version}/wallshader-v%{version}.tar.zst
BuildArch: noarch
BuildRequires: tar
BuildRequires: zstd

Requires: gjs >= 1.80
Requires: gtk4 >= 4.14
Requires: libadwaita >= 1.5
Requires: gdk-pixbuf2
Requires: webkitgtk6.0 >= 2.44
Requires: gsettings-desktop-schemas
Requires: hicolor-icon-theme
Requires: librsvg2

%description
Edit shader wallpapers, export PNG images, and apply still backgrounds.
Animated wallpapers use the bundled extension on GNOME 50 with Wayland.

%prep
%setup -q -n wallshader-v%{version}

%build

%install
mkdir -p %{buildroot}
cp -a usr %{buildroot}/

# Fedora's file triggers refresh desktop metadata and the icon cache.
%files
%{_bindir}/wallshader
%{_datadir}/applications/io.github.wallshader.Wallshader.desktop
%{_datadir}/icons/hicolor/scalable/apps/io.github.wallshader.Wallshader.svg
%{_datadir}/wallshader
