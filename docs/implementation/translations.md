# Translations

Wallshader follows the system language through GNU gettext. English is the source
language and fallback. Bundled catalogs include Spanish (`es`), German (`de`),
French (`fr`), Japanese (`ja`), Korean (`ko`), Brazilian Portuguese (`pt_BR`),
Simplified Chinese (`zh_CN`), and Traditional Chinese (`zh_TW`). Open the app menu's
**Preferences** dialog (Ctrl+,) to choose **System Default**, **English**, or an
installed translation, shown in its own language. Choices are saved immediately
and take effect the next time Wallshader opens. The restart notice appears below
the language selector.

These are initial translation drafts; fluent-speaker review is welcome. Spanish
covers nearly all messages. The seven additional catalogs cover the main app
interface, dialogs, errors, shader names, editor labels, and options. Untranslated
or fuzzy entries, mostly detailed Paper parameter explanations, fall back to
English. Empty entries remain in the PO files so contributors can complete them
without changing app code. Do not mark English copies as translated to inflate
coverage.

## Development

Install GNU gettext (`gettext` on Fedora, Arch, Debian, and Ubuntu).
`bun run build` compiles the languages in `po/LINGUAS` into
`build/locale/LANGUAGE/LC_MESSAGES/wallshader.mo` and copies them into the
self-contained desktop renderer bundle. `scripts/run.sh` refreshes catalogs even
when the renderer is already built.

`src/i18n.js` initializes GJS gettext before UI construction. Native widgets
import `_`, `pgettext`, `ngettext`, and `format` from this module. Shared logic uses
`src/translation.js`, which falls back to English in Bun and the canvas renderer.
The native preview translates literal renderer errors when receiving them.
Third-party diagnostic messages retain the text supplied by those libraries.
Startup reads the saved `language` preference before translating any UI text.
An empty value follows the environment; an explicit code overrides `LANGUAGE`
for this process. Only the message locale may change when starting from C;
number and date formatting keep their system settings. Unavailable languages
fall back to the system choice. The app does not restart desktop playback when
this preference changes; its renderer reads the preference on its next start.

Meson installs catalogs under its configured `localedir`. The installed launcher
passes that path using `WALLSHADER_LOCALEDIR`, including for custom prefixes. The
desktop renderer uses its bundled `build/locale` directory when launched by Shell.
The environment variable can also select a catalog directory during testing.

## Updating messages

After changing translatable text or regenerating Paper metadata, run:

```sh
bun run translations:update
bun run translations:check
```

The update command regenerates the extraction-only `po/paper-catalog.js` from the
committed metadata, extracts `po/wallshader.pot` using `po/POTFILES`, and merges all
registered PO files. No upstream checkout is needed. Commit the companion, POT,
and PO changes together. The application never loads the companion. Meson also
provides `wallshader-pot`, `wallshader-update-po`, and `wallshader-gmo` targets;
refresh the companion with the Bun command first when metadata changes.

Translate complete messages. Use named placeholders for variable text:

```js
format(_('Deleted “{name}”'), { name: saved.name });
```

Preserve placeholder names exactly; their order may change. Values are inserted
once, so braces, dollar signs, and markup in user text remain literal. Use
`ngettext` for counts and `pgettext` for words with distinct meanings. Add
`// Translators:` comments for placeholders or ambiguous text, and register new
source files in `po/POTFILES`. Gtranslator and Poedit can edit the catalogs. Review
fuzzy messages and replace `translator-credits` with the reviewers' chosen names
and optional contact details.

Metadata uses `N_` extraction markers and is translated for display. Search matches
original and translated names. Shader identifiers, enum values, parameter names,
saved settings, and exported code remain canonical. User-entered preset names
stay literal. Favorites and Recent optionally store `builtinName: true` for
application-generated labels. Older entries retain their literal names because
their origin cannot be determined reliably. This additive field works with the
existing state format and requires no migration.

## Adding a language

1. Run `bun run translations:update`.
2. Create a catalog, for example:
   `msginit --no-translator --locale=fr --input=po/wallshader.pot --output-file=po/fr.po`.
3. Add the locale to `po/LINGUAS` and translate its PO file, including the language
   header and plural rule. Use `fr` or `de` for language-wide catalogs; regional
   examples are `pt_BR`, `zh_CN`, and `zh_TW`.
4. Run the checks below and review the UI with a fluent speaker. Missing or fuzzy
   messages fall back to English. Check the app interface and technical tooltips
   separately when reporting translation coverage.

New languages need no application logic changes. Every package includes all
languages in `LINGUAS`, and Preferences discovers their compiled catalogs.

## Verification

```sh
bun run check
bun test
bun run test:i18n
bun run test:native
LC_ALL=en_US.UTF-8 LANGUAGE=es bun run test:native --i18n-test
LC_ALL=ar_EG.UTF-8 LANGUAGE=ar bun run test:native --i18n-test
bun run test:shell
```

`test:i18n` needs an installed `en_US.UTF-8` locale. It checks every bundled catalog,
unsupported-language fallback, the C locale, search, settings round trips, and
the bundled renderer's independent lookup. GNU gettext uses English under
`LC_ALL=C` or `C.UTF-8`, even with `LANGUAGE=es`.
An explicit saved language can override this when an installed UTF-8 message
locale is available. Startup checks cover every saved language override and
unavailable or invalid preferences using private settings directories.

Native tests use private D-Bus sessions, isolated XDG directories, and in-memory
GSettings. The localization test never applies a wallpaper. It checks translated
controls and unchanged shader values/user names, and writes wide, narrow,
settings, and save-dialog screenshots under `artifacts/i18n/`. The Arabic run
checks RTL layout with English fallback; it is not an Arabic translation. Install
the selected locale before running a locale-specific test. Shell tests retain
their private session, runtime directory, and virtual displays.

The catalog checker validates gettext syntax, message coverage, extraction-file
coverage, and named placeholders. Package creation checks each installed catalog
against the desktop renderer's copy. Release RPM/DEB/archive contents must include
`share/locale/*/LC_MESSAGES/wallshader.mo`; COPR's spec must own these files too.
