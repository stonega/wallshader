#!/usr/bin/env python3
"""Wait until the public Ubuntu PPA metadata offers the uploaded version."""

import argparse
import gzip
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def wait_for_publication(version, timeout):
    url = "https://ppa.launchpadcontent.net/xijieyin/ppa/ubuntu/dists/resolute/main/binary-amd64/Packages.gz"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=30) as response:
                packages = gzip.decompress(response.read()).decode()
            for paragraph in packages.split("\n\n"):
                fields = dict(
                    line.split(": ", 1)
                    for line in paragraph.splitlines()
                    if ": " in line and not line.startswith(" ")
                )
                if (
                    fields.get("Package") == "wallshader"
                    and fields.get("Version") == version
                ):
                    print(
                        f"Published wallshader {version} in ppa:xijieyin/ppa (Ubuntu 26.04)",
                        flush=True,
                    )
                    return
        except (HTTPError, URLError, TimeoutError) as error:
            print(f"Repository metadata is not ready: {error}", flush=True)
        print(f"Waiting for Launchpad to publish {version}...", flush=True)
        time.sleep(min(30, max(0, deadline - time.monotonic())))
    raise TimeoutError(
        "PPA publication was not verified. Inspect the upload email and build logs at "
        "https://launchpad.net/~xijieyin/+archive/ubuntu/ppa/+packages"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    wait_for_publication(args.version, args.timeout)
