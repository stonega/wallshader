# Ubuntu PPA

The Ubuntu repository is [ppa:xijieyin/ppa](https://launchpad.net/~xijieyin/+archive/ubuntu/ppa).
It initially targets Ubuntu 26.04 LTS (`resolute`), whose GNOME 50 desktop supports
the bundled live wallpaper extension. A source upload targets one Ubuntu series;
do not instruct users of other series to substitute `resolute` in their APT sources.

## Packaging

`packaging/ppa/debian` assembles the architecture-independent installed JavaScript,
renderer, translations, desktop file, icons and extension from a checksum-verified
GitHub release. This uses the same release payload as Fedora COPR. Debhelper
generates the desktop/icon cache integration. Installation never starts the app,
enables an extension, contacts GNOME Shell or changes wallpaper settings.

`scripts/package-ppa.py` also includes the corresponding Git tag and the pinned
Paper dependency as editable sources in the original source archive. The generated
renderer accompanies its original source, lockfile and build scripts. The PPA
builder needs no Bun or network downloads during its package build. It assembles
the generated release files rather than rebuilding the renderer with another
bundler. `debian/README.source` describes rebuilding the renderer with Bun.

The version is `VERSION-1~ppaREVISION~ubuntu26.04.1`. Increment the PPA revision
after an accepted upload if the packaging needs correction; Launchpad does not
allow overwriting an existing version. A new application release starts at PPA
revision 1. Original source archives are normalized to the release tag timestamp
so repeated packaging revisions use the same archive.

## One-time signing setup

Register a dedicated OpenPGP signing key, with an encryption subkey for Launchpad's
email verification, at [the account's key page](https://launchpad.net/~xijieyin/+editpgpkeys).
Publish the public key to `keyserver.ubuntu.com` and complete Launchpad's encrypted
confirmation email. Keep the private key and passphrase outside this checkout.

Configure these repository Actions secrets:

- `PPA_GPG_PRIVATE_KEY`: ASCII-armored private key export.
- `PPA_GPG_PASSPHRASE`: its passphrase.

Configure these repository Actions variables:

- `PPA_GPG_FINGERPRINT`: the full registered fingerprint.
- `PPA_ENABLED`: `true`, only after Launchpad confirms the key registration.

The workflow imports the key into a temporary private GPG directory, signs the
source upload using loopback pinentry, uploads with `dput ppa:xijieyin/ppa`, and
removes the temporary key directory afterward. Secrets are available only to the
upload job, after the unsigned package has passed the Ubuntu rebuild/install job.
Renew or replace the key before its expiry and update the secrets and fingerprint.

## GitHub Actions

The [Publish Ubuntu PPA workflow](../../.github/workflows/publish-ppa.yml) can be
run manually with an existing release tag. Leave **publish** unchecked to prepare
and test an unsigned source upload without contacting Launchpad. The
`wallshader-ppa-source` artifact retains `.dsc`, `.orig.tar.xz`, `.debian.tar.xz`,
`.buildinfo` and `_source.changes` together.

The workflow downloads the release and verifies `SHA256SUMS`, prepares the source
upload, then extracts it into a clean Ubuntu 26.04 container. It independently
rebuilds the `.deb`, runs Lintian, installs with APT to check native dependencies,
and validates the installed desktop file and extension assets. It launches no GUI.

When **publish** is selected, the verified upload is signed and sent to Launchpad.
The workflow waits up to two hours for the exact version in the public PPA's APT
metadata. A successful upload alone is not publication. On failure or timeout,
inspect Launchpad's upload email and package build logs before retrying. Queued
builds may take longer; confirm their state before increasing the revision.
For an already accepted version, select **verify_only** to resume checking public
metadata without rebuilding, signing or uploading it again. This mode needs no
signing secrets. A new PPA can also be delayed while Launchpad provisions its
archive signing key; the uploader's registered OpenPGP key is a separate key.

```sh
gh workflow run publish-ppa.yml --repo stonega/wallshader \
  -f tag=v0.1.17 -f revision=1 -F verify_only=true
```

The main Build and Release workflow calls this reusable workflow after publishing
a tagged GitHub release. Before `PPA_ENABLED=true`, releases prepare and test the
source artifact but skip the upload job. Once enabled, every release also uploads
and verifies the PPA. The reusable call is intentional: release events created
with `GITHUB_TOKEN` do not ordinarily trigger a separate release-event workflow.
Fedora COPR and AUR publication remain required by the release instructions.

To bootstrap the existing release after this workflow reaches `main`:

```sh
gh workflow run publish-ppa.yml --repo stonega/wallshader \
  -f tag=v0.1.17 -f revision=1 -F publish=false
```

After registering the key and enabling publication, use the same command with
`-F publish=true`. To prepare locally, install Bun 1.3.14, Git, GNU tar, zstd,
debhelper, desktop-file-utils and dpkg-dev, then download the release:

```sh
gh release download v0.1.17 --repo stonega/wallshader --dir /tmp/wallshader-release
(cd /tmp/wallshader-release && sha256sum --check SHA256SUMS)
python3 scripts/package-ppa.py v0.1.17 /tmp/wallshader-release
```

## User installation

After publication, Ubuntu 26.04 users can install with:

```sh
sudo add-apt-repository ppa:xijieyin/ppa
sudo apt update
sudo apt install wallshader
```

Later versions arrive through normal APT updates. Initial animation setup still
requires the app's explicit setup action and a fresh login for extension discovery.
