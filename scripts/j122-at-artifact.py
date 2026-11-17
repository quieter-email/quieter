import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import zipfile


PARENT = "96c4be3b5c1087f3864d6b3f9f24fa185282c250"
REPOSITORY = "quieter-email/quieter"
RUN = 43903994947
PINS = {
    "package": {
        "id": 14245675611,
        "name": "quieter-ubuntu-24.04",
        "digest": "35dae811f518746ca703259c55aab37f63bffbb77b9a72cfee1a9f825f26fc8f",
        "member": "quieter-0.1.1-amd64.deb",
        "memberDigest": "338508d46e7489ac1061c4c34cf0aeb8736eb92e89ba809d4b07125b7a734f71",
    },
    "native": {
        "id": 14244835873,
        "name": "desktop-native-ubuntu-24.04",
        "digest": "c636e647fd24ce84aa92cb875a0ee15b3e93f924927db96737a9af51b2c01594",
        "member": "native-smoke.json",
        "memberDigest": "f73f5cc242cdb2af5f980ca848fbfbd52df46248c119e0ce5c32256149190f50",
    },
}
LEAVES = {
    ".github/workflows/j122-at-compatibility.yml",
    "apps/desktop/scripts/j122-at-companion.ts",
    "apps/desktop/scripts/j122-at-observer.py",
    "scripts/j122-at-artifact.py",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--package-archive", type=Path)
    parser.add_argument("--native-archive", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision):
        raise ValueError("Select an exact companion revision.")
    if bool(args.package_archive) != bool(args.native_archive):
        raise ValueError("Provide both local archives or download both pinned archives.")
    repository = Path(__file__).resolve().parents[1]
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repository, text=True
    ).strip()
    if head != args.revision:
        raise ValueError("Companion checkout does not match the released event head.")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", PARENT, head],
        cwd=repository, check=True,
    )
    changes = subprocess.check_output(
        ["git", "diff", "--name-status", "--no-renames", PARENT, head],
        cwd=repository, text=True,
    ).splitlines()
    if set(changes) != {"A\t" + path for path in LEAVES}:
        raise ValueError("The companion must add exactly its four approved leaves.")
    if subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=repository, text=True
    ).strip():
        raise ValueError("Artifact verification requires a clean checkout.")
    output = args.output.resolve()
    if output == repository or output.is_relative_to(repository):
        raise ValueError("Keep downloaded artifacts outside the source checkout.")
    output.mkdir(parents=True, exist_ok=True)
    run = json.loads(subprocess.check_output(
        ["gh", "api", f"repos/{REPOSITORY}/actions/runs/{RUN}"], text=True
    ))
    if (
        run["id"] != RUN or run["head_sha"] != PARENT
        or run["status"] != "completed" or run["conclusion"] != "success"
        or run["path"] != ".github/workflows/desktop-build.yml"
        or run["head_repository"]["full_name"] != REPOSITORY
    ):
        raise ValueError("The pinned native producer run is not the approved successful source.")
    manifest = {
        "companionRevision": head, "artifactRevision": PARENT,
        "producerRun": RUN, "repository": REPOSITORY, "artifacts": {},
    }
    for kind, pin in PINS.items():
        metadata = json.loads(subprocess.check_output(
            ["gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{pin['id']}"],
            text=True,
        ))
        if (
            metadata["id"] != pin["id"] or metadata["name"] != pin["name"]
            or metadata["expired"] or metadata["digest"] != "sha256:" + pin["digest"]
            or metadata["workflow_run"]["id"] != RUN
            or metadata["workflow_run"]["head_sha"] != PARENT
        ):
            raise ValueError("Pinned artifact metadata changed or expired.")
        supplied = args.package_archive if kind == "package" else args.native_archive
        archive = supplied.resolve() if supplied else output / (kind + ".zip")
        if supplied is None:
            with archive.open("wb") as destination:
                subprocess.run(
                    ["gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{pin['id']}/zip"],
                    stdout=destination, check=True,
                )
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != pin["digest"] or archive.stat().st_size != metadata["size_in_bytes"]:
            raise ValueError("Pinned archive bytes do not match the producer artifact.")
        destination = output / pin["member"]
        with zipfile.ZipFile(archive) as zipped:
            if zipped.namelist().count(pin["member"]) != 1:
                raise ValueError("The pinned archive does not contain one expected member.")
            with zipped.open(pin["member"]) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)
        with destination.open("rb") as stream:
            member_digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if member_digest != pin["memberDigest"]:
            raise ValueError("The pinned package or native receipt bytes changed.")
        manifest["artifacts"][kind] = {
            "id": pin["id"], "archiveSha256": digest,
            "member": destination.name, "memberSha256": member_digest,
        }
        if supplied is None:
            archive.unlink()
    native = json.loads((output / PINS["native"]["member"]).read_text())
    if (
        native["checkoutRevision"] != PARENT or native["result"] != "passed"
        or native["platform"] != "linux" or native["architecture"] != "x64"
        or native["unexpectedFixtureRequests"] != 0
        or native["cleanup"]["applicationExit"] != "graceful"
        or not all(native["cleanup"][key] for key in [
            "applicationStopped", "keyringStopped", "windowManagerStopped"
        ])
    ):
        raise ValueError("The pinned native receipt did not complete its owned cleanup.")
    manifest["nativeProducerReceipt"] = native
    manifest["debPath"] = str(output / PINS["package"]["member"])
    installed_members = {
        "./opt/quieter/quieter": "/opt/quieter/quieter",
        "./opt/quieter/chrome-sandbox": "/opt/quieter/chrome-sandbox",
        "./opt/quieter/resources/apparmor-profile": "/opt/quieter/resources/apparmor-profile",
    }
    installed_hashes = {}
    with subprocess.Popen(
        ["dpkg-deb", "--fsys-tarfile", manifest["debPath"]], stdout=subprocess.PIPE
    ) as unpack:
        with tarfile.open(fileobj=unpack.stdout, mode="r|") as payload:
            for member in payload:
                if member.name in installed_members:
                    if not member.isfile():
                        raise ValueError("A pinned installed executable/profile is not a regular file.")
                    with payload.extractfile(member) as stream:
                        installed_hashes[installed_members[member.name]] = hashlib.file_digest(
                            stream, "sha256"
                        ).hexdigest()
        unpack_status = unpack.wait()
    if unpack_status != 0 or set(installed_hashes) != set(installed_members.values()):
        raise ValueError("The pinned DEB is missing its executable, sandbox helper or profile.")
    manifest["installedHashes"] = installed_hashes
    (output / "installed-expected.sha256").write_text("".join(
        digest + "  " + name + "\n" for name, digest in sorted(installed_hashes.items())
    ))
    manifest["nativeSourceSha256"] = hashlib.sha256(
        (repository / "apps/desktop/scripts/native-smoke.ts").read_bytes()
    ).hexdigest()
    (output / "artifact-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if args.github_output:
        with args.github_output.open("a") as stream:
            stream.write("deb=" + manifest["debPath"] + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
