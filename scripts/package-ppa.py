#!/usr/bin/env python3
"""Prepare an unsigned Launchpad source upload from a verified Wallshader release."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def prepare(tag, release_dir, output, revision):
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError("Release tag must use vMAJOR.MINOR.PATCH")
    if not re.fullmatch(r"[1-9]\d*", revision):
        raise ValueError("PPA revision must be a positive integer")
    version = tag[1:]
    archive = release_dir / f"wallshader-{tag}.tar.zst"
    checksums = (release_dir / "SHA256SUMS").read_text().splitlines()
    expected = []
    for line in checksums:
        fields = line.split(maxsplit=1)
        if (
            len(fields) == 2
            and fields[1].removeprefix("*").removeprefix("./") == archive.name
        ):
            expected.append(fields[0])
    with archive.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if expected != [actual]:
        raise ValueError(
            "Release archive is missing from SHA256SUMS or its checksum does not match"
        )

    # Every PPA revision of a release must use byte-identical orig sources.
    epoch = int(
        subprocess.check_output(
            ["git", "show", "-s", "--format=%ct", f"{tag}^{{commit}}"],
            cwd=ROOT,
            text=True,
        ).strip()
    )
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wallshader-ppa-") as temporary:
        work = Path(temporary)
        source = work / f"wallshader-{version}"
        source.mkdir()
        run(
            "tar",
            "--zstd",
            "-xf",
            str(archive),
            "--strip-components=1",
            "-C",
            str(source),
        )
        if not (source / "usr/share/wallshader/src/main.js").is_file():
            raise ValueError("Release archive is missing the installed application")

        upstream = source / "source"
        upstream.mkdir()
        snapshot = work / "source.tar"
        run("git", "archive", "--format=tar", f"--output={snapshot}", tag, cwd=ROOT)
        run("tar", "-xf", str(snapshot), "-C", str(upstream))
        manifest = json.loads((upstream / "package.json").read_text())
        if manifest["version"] != version:
            raise ValueError("Release tag does not match the source package version")
        run(
            "bun",
            "install",
            "--frozen-lockfile",
            "--production",
            "--ignore-scripts",
            cwd=upstream,
        )
        paper = upstream / "node_modules/@paper-design/shaders"
        installed_paper = json.loads((paper / "package.json").read_text())["version"]
        if installed_paper != manifest["dependencies"]["@paper-design/shaders"]:
            raise ValueError(
                "Bundled Paper dependency does not match its pinned version"
            )

        orig = work / f"wallshader_{version}.orig.tar.xz"
        run(
            "tar",
            "--sort=name",
            f"--mtime=@{epoch}",
            "--owner=0",
            "--group=0",
            "--numeric-owner",
            "-cJf",
            str(orig),
            "-C",
            str(work),
            source.name,
        )
        shutil.copytree(ROOT / "packaging/ppa/debian", source / "debian")
        (source / "debian/rules").chmod(0o755)
        package_version = f"{version}-1~ppa{revision}~ubuntu26.04.1"
        date = datetime.fromtimestamp(epoch, timezone.utc).strftime(
            "%a, %d %b %Y %H:%M:%S +0000"
        )
        (source / "debian/changelog").write_text(
            f"wallshader ({package_version}) resolute; urgency=medium\n\n"
            f"  * Package the verified Wallshader {tag} release for Ubuntu 26.04 LTS.\n\n"
            f" -- stone <xijieyin@gmail.com>  {date}\n"
        )
        run("dpkg-buildpackage", "-S", "-sa", "-us", "-uc", "-d", cwd=source)
        for path in work.iterdir():
            if path.is_file() and path.name.startswith("wallshader_"):
                shutil.copy2(path, output / path.name)
        print(f"Prepared {package_version} for ppa:xijieyin/ppa in {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag")
    parser.add_argument("release_dir", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/ppa")
    parser.add_argument("--revision", default="1")
    args = parser.parse_args()
    prepare(args.tag, args.release_dir.resolve(), args.output.resolve(), args.revision)


if __name__ == "__main__":
    main()
