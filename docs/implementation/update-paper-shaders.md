# Updating shaders from Paper

Use this procedure when checking for a new Paper Shaders release. If a newer
version has been published, review every intervening changelog entry and apply
the relevant changes to Wallshader, including controls, presets, migrations, and
rendering. A dependency bump alone does not complete the update.

## Check for a published release

Compare `dependencies["@paper-design/shaders"]` in `package.json` with the version
returned by npm's latest-release metadata:

```sh
curl --fail --silent --show-error 'https://registry.npmjs.org/@paper-design%2fshaders/latest'
```

Read the [upstream changelog](https://github.com/paper-design/shaders/blob/main/CHANGELOG.md).
The npm metadata establishes whether a version is published; a changelog entry or
commit on `main` alone does not. If the published version matches our pin, report
that Wallshader is current and leave the dependency unchanged. If upstream is
older than our pin, investigate instead of downgrading. Do not adopt a prerelease
unless that is explicitly intended.

Record the old and target versions, the release's `gitHead`, and the changelog
entries being applied. Clone `https://github.com/paper-design/shaders.git` into a
temporary directory and check out that exact commit. If `gitHead` is unavailable,
identify the matching release commit from upstream history before generating
metadata. Confirm that `packages/shaders/package.json` has the target version and
review `CHANGELOG.md` at that revision as well as the linked `main` version.

Last checked on 2026-09-22: npm's latest release and Wallshader's pin were both
**0.0.81**, at upstream commit
`43cd68db79fa0b1759f72ffc941b3238e2a3954c`. No newer published release was available.
Repeat the check for each update; this is a historical record.

## Review what the release changes

Read the [architecture](../design/architecture.md) and
[development setup](setup.md) before editing. Compare upstream source between our
previous reviewed commit and the target commit, following any migration guides
linked from the changelog. Account for every entry, including fixes that arrive
through the unmodified dependency and entries that only affect upstream React or
documentation.

| Upstream change | Wallshader work to review |
| --- | --- |
| New shaders, presets, defaults, or parameter ranges | Regenerate `src/paper-catalog.js`; review generator categories, aliases, numeric ranges, and integer steps. Confirm gallery entries and native editor controls. |
| Renamed, removed, or reinterpreted parameters | Update normalization and migrations in `src/catalog.js` and `src/paper-migration.js`; preserve saved presets, imported settings/code, and desktop configurations. |
| Uniforms, enums, colors, images, mipmaps, or noise textures | Review `scripts/sync-paper.js` and `src/renderer/renderer.js` against upstream mappings and image processors. Preserve all upstream preset values. |
| ShaderMount, animation, sizing, or capture behavior | Review preview and desktop rendering, frame pacing, pause/resume, reverse playback, resizing, and PNG capture. |
| License, NOTICE, or bundled sample changes | Review `data/third-party/`, preserve required notices, and update attribution for any changed bundled asset. |

Version 0.0.81 illustrates why this review matters: Paper Texture was rewritten
with three colors, renamed patterns, new controls, removed parameters, new value
mappings, and updated presets. Wallshader converts legacy settings before
validation; the conversion is approximate because the new shader cannot reproduce
the old pixels exactly. The same release fixed Water's highlight alpha and
improved shaders with grain layers, which also need rendering review.

Keep the GTK/libadwaita interface native and use Paper's original shader package
in the local WebKit renderer. React wrapper source supplies metadata; it is not
an application runtime dependency. Keep stable Wallshader shader IDs and retain
existing migrations. Add regression coverage when changing persisted or imported
settings, including repeated normalization so migrations do not run twice.

## Apply the update

1. Set an exact target version in `package.json` (no `^`, `~`, or `latest`) and run
   `bun install` to update `bun.lock` and the installed dependency together.
2. Update the expected version and error message in `scripts/sync-paper.js`.
   Confirm the installed package and reviewed upstream checkout both match that
   version. The generator's current guard checks the checkout against a hardcoded
   version; it does not establish that the installed package matches.
3. Adapt the generator and renderer for any changed upstream source patterns,
   uniform expressions, shader categories, or preprocessing helpers. The generator
   evaluates static preset declarations, so use only the reviewed checkout.
4. Regenerate from that checkout, running these commands from Wallshader's root:

   ```sh
   bun scripts/sync-paper.js /path/to/reviewed-paper-shaders-checkout
   bunx biome check --write src/paper-catalog.js
   ```

5. Inspect the generated diff and every `Ranges to verify` message. Check missing
   or unexpected shaders, fields, defaults, enum values, presets, image flags, and
   mipmaps against upstream. Fix generation rules and regenerate instead of
   hand-editing `src/paper-catalog.js`.
6. Apply compatibility migrations and any native control changes. Verify original
   wallpaper defaults, saved presets, image selections, and settings/code round
   trips. Do not silently discard old values just because upstream renamed them.
7. Update the Paper version, reviewed commit, and any changed shader/preset counts
   in `README.md`, this guide, `docs/implementation/setup.md`, and relevant design
   and user documentation. Describe any unavoidable visual changes.

## Verify and finish

Run the checks after installing the target dependency and regenerating metadata:

```sh
bun install --frozen-lockfile
bun run build
bun run check
bun test
bun run test:native
```

The build refreshes bundled renderer assets and preserves Paper's LICENSE and
NOTICE. Review any resulting notice changes. Logic checks must preserve all
upstream preset values and settings/code round trips, including legacy settings
affected by the release. Add focused tests for new behavior rather than merely
updating expected counts.

Inspect native captures for changed shaders and presets, with procedural and
image inputs where supported. Check transparency, palette limits, sizing, PNG
export, and animated frames as relevant to the changelog. A successful build
alone cannot establish that the shaders render correctly in WebKitGTK.

Run `bun run test:shell` for extension changes or changes affecting desktop
playback. Keep the native test's isolated settings/data and the Shell test's
private D-Bus, runtime directory, virtual displays, and isolated settings. Never
apply, pause, stop, or restore wallpaper on the user's running desktop as part of
verification. If required native tools are unavailable, report the verification
gap rather than claiming the update is fully tested.

Report the old and new Paper versions, reviewed upstream commit, changelog changes
applied, migration limitations, and check results. If publishing a Wallshader
release, follow [Packages and releases](setup.md#packages-and-releases) and the
[AUR guide](aur.md), including the required GitHub, COPR, and AUR steps.
