#!/usr/bin/env python3
"""Prepare a single-repository release or rehearse recovery without contacting a server."""
import argparse
import json
import tarfile
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import artifact_download
import deploy
import release
import update

REPOSITORY = update.SUITE_REPO
WEB_APPS = ("wb", "pathology", "pcr")
PORTAL_PATH = "apps/wb/deployment/wisplab/portal"
ROOT = Path(__file__).resolve().parents[4]
PACKAGER = release.load_module("suite_packager", "package-release.py")


def ci_run(sha, workflow):
    if not release.SHA_RE.fullmatch(sha):
        raise ValueError("A complete lowercase Git SHA is required")
    runs = release.api(f"repos/{REPOSITORY}/actions/workflows/{workflow}/runs?head_sha={sha}&branch=main&per_page=100")
    matches = [item for item in runs["workflow_runs"] if release.matching_ci(item, REPOSITORY, sha)
               and item["status"] == "completed" and item["conclusion"] == "success"
               and item["path"] == f".github/workflows/{workflow}"]
    if not matches:
        raise ValueError(f"No successful main {workflow} run at {sha}")
    return max(matches, key=lambda item: item["id"])


def app_artifacts(sha):
    run = ci_run(sha, "apps.yml")
    records = release.api(f"repos/{REPOSITORY}/actions/runs/{run['id']}/artifacts?per_page=100")
    required = {f"web-dist-{name}" for name in (*WEB_APPS, "blotlens")} | {"blotlens-linux"}
    found = {}
    for item in records["artifacts"]:
        name = item["name"]
        if name in required and not item["expired"]:
            if name in found or item.get("workflow_run", {}).get("head_sha") != sha:
                raise ValueError(f"Ambiguous artifact identity for {name}")
            found[name] = item
    if set(found) != required:
        raise ValueError("Missing required artifacts from the same successful apps CI run")
    return run, found


def source_portal(sha, output):
    # Read Git blobs at the selected commit, including on a dirty working copy.
    directory = f"{sha}:{PORTAL_PATH}"
    names = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", directory], cwd=ROOT,
                                    text=True).splitlines()
    selected = set(names) & (PACKAGER.PORTAL_FILES | PACKAGER.PORTAL_OPTIONAL_FILES)
    if not PACKAGER.PORTAL_FILES <= selected:
        raise ValueError("Missing portal files at pinned commit")
    for name in sorted(selected):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(subprocess.check_output(["git", "show", directory + "/" + name], cwd=ROOT))


def ci_record(run, artifact):
    return {**release.record_ci(run, artifact), "artifactName": artifact["name"]}


def prepare(sha, version, output):
    release.validate_version(version)
    cli = ci_run(sha, "ci.yml")
    run, artifacts = app_artifacts(sha)
    if output.exists():
        raise ValueError("Choose an unused output directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent, prefix=".suite-release-") as temp:
        scratch = Path(temp).resolve()
        ready = scratch / "release"
        ready.mkdir()
        for name, artifact in artifacts.items():
            required = "blotlens-linux.tar.gz" if name == "blotlens-linux" else "index.html"
            artifact_download.download_artifact(REPOSITORY, artifact, scratch / name, required_file=required)
        dirs = {name: scratch / f"web-dist-{name}" for name in WEB_APPS}
        if release.file_hashes(dirs["wb"] / "blotlens") != release.file_hashes(scratch / "web-dist-blotlens"):
            raise ValueError("The embedded BlotLens distribution differs from its standalone web artifact")
        source_portal(sha, scratch / "portal")
        sources = {site: {"repository": REPOSITORY, "gitSha": sha,
                          "ci": ci_record(run, artifacts[f"web-dist-{site}"])} for site in WEB_APPS}
        provenance = {"schemaVersion": 1, "layout": "monorepo",
                      "portal": {"repository": REPOSITORY, "gitSha": sha, "sourcePath": PORTAL_PATH},
                      "sites": {site: {**source["ci"], "repository": REPOSITORY, "gitSha": sha}
                                for site, source in sources.items()}}
        result = PACKAGER.package_ci_release(version=version, portal=scratch / "portal",
                                              artifact_dirs=dirs, provenance=provenance, output_dir=ready)
        service = ready / "blotlens-linux.tar.gz"
        shutil.copyfile(scratch / "blotlens-linux" / service.name, service)
        document = {"schemaVersion": 2, "version": version, "sources": sources, "cliRunId": cli["id"],
                    "blotlens": {"gitSha": sha, "repository": REPOSITORY, "sha256": release.sha256(service),
                                 "ci": ci_record(run, artifacts["blotlens-linux"])},
                    "archive": {"fileName": Path(result["archive"]).name, "sha256": result["sha256"]}}
        release.write_json(ready / "deployment.json", document)
        load_release(ready)
        ready.rename(output)


def local_candidate(version, output):
    """Build a rehearsal archive from local dist trees. Production updater rejects this format."""
    release.validate_version(version)
    output.mkdir(parents=True, exist_ok=False)
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    sites, payload = {}, {}
    for site in ("portal", *WEB_APPS):
        path = ROOT / PORTAL_PATH if site == "portal" else ROOT / "apps" / site / "dist"
        files = PACKAGER.collect_files(path, portal=site == "portal")
        PACKAGER.check_index(site, files)
        if site != "portal":
            PACKAGER.validate_ci_layout(site, files)
        sites[site] = {"gitSha": sha, "sourceKind": "local-rehearsal",
                       "files": {name: PACKAGER.sha256(data) for name, data in files.items()}}
        payload.update({f"{site}/{key}": data for key, data in files.items()})
    embedded = release.file_hashes(ROOT / "apps/wb/dist/blotlens")
    if not embedded or embedded != release.file_hashes(ROOT / "apps/blotlens/dist"):
        raise ValueError("Build WB and standalone BlotLens at the same revision before rehearsal")
    PACKAGER.validate_platform_suite(payload)
    manifest = {"schemaVersion": 1, "version": version, "sites": sites}
    payload["release.json"] = json.dumps(manifest, sort_keys=True).encode()
    archive, _ = PACKAGER.write_archive(output, version, payload)
    service = output / "blotlens-linux.tar.gz"
    shutil.copyfile(ROOT / "apps/blotlens/.release" / service.name, service)
    record = {"schemaVersion": "local-rehearsal", "version": version,
              "blotlens": {"sha256": release.sha256(service)},
              "archive": {"fileName": archive.name, "sha256": release.sha256(archive)}}
    release.write_json(output / "deployment.json", record)


def load_release(folder, allow_local=False):
    document = update.json_load((folder / "deployment.json").read_bytes())
    repository = REPOSITORY if document.get("schemaVersion") == 2 else update.REPOSITORY
    local = allow_local and document.get("schemaVersion") == "local-rehearsal"
    if local:
        release.validate_version(document.get("version"))
        if document.get("archive", {}).get("fileName") != f"wisplab-{document['version']}.tar.gz":
            raise ValueError("Invalid local archive name")
    else:
        update.validate_manifest(document, repository)
    archive = folder / document["archive"]["fileName"]
    checksum = document["archive"]["sha256"]
    if not local:
        update.crosscheck_bundle(archive, document)
    manifest, _ = deploy.read_archive(archive, checksum, document["version"])
    if repository == REPOSITORY or local:
        service = folder / "blotlens-linux.tar.gz"
        if release.sha256(service) != document["blotlens"]["sha256"]:
            raise ValueError("Standalone BlotLens service archive digest mismatch")
    return document, archive, manifest


def stage_service(archive, digest, destination):
    """Verify and restore public service-package files into a new isolated directory."""
    if release.sha256(archive) != digest:
        raise ValueError("BlotLens archive digest mismatch")
    destination.mkdir(parents=True)
    hashes = {}
    size = 0
    with tarfile.open(archive, "r:gz") as src:
        for index, item in enumerate(src):
            if index >= 4096:
                raise ValueError("Too many BlotLens package files")
            name = item.name.removeprefix("./").rstrip("/")
            if name in ("", ".") and item.isdir():
                continue
            parts = deploy.safe_path(name)
            if parts.parts[0] not in ("server", "dist", "deploy", "LICENSE", "BUILD.json"):
                raise ValueError("Unexpected BlotLens package path")
            path = destination.joinpath(*parts.parts)
            if item.isdir():
                path.mkdir(parents=True, exist_ok=True)
                continue
            size += item.size
            if not item.isfile() or item.issparse() or item.size < 0 or size > 128 * 1024 * 1024:
                raise ValueError("Unexpected BlotLens package entry")
            path.parent.mkdir(parents=True, exist_ok=True)
            with src.extractfile(item) as inp, path.open("xb") as out:
                shutil.copyfileobj(inp, out)
            hashes[name] = release.sha256(path)
    if not {"server/index.mjs", "dist/index.html", "BUILD.json"} <= hashes.keys():
        raise ValueError("BlotLens service or frontend missing")
    return hashes


def rehearsal(previous, candidate, destination, previous_service=None):
    old, old_archive, old_manifest = load_release(previous)
    new, new_archive, new_manifest = load_release(candidate, allow_local=True)
    if old["archive"]["sha256"] == new["archive"]["sha256"]:
        raise ValueError("Recovery rehearsal needs two distinct builds")
    if destination.exists():
        raise ValueError("Choose a new rehearsal directory")
    destination.mkdir(parents=True)
    caddy = destination / "Caddyfile"
    caddy.write_text("localhost {\n    respond \"staging\"\n}\n")
    def simulated_services(command, **kwargs):
        # Only server-facing validate/reload calls are simulated. Filesystem installs are real.
        return subprocess.CompletedProcess(command, 0, "", "")
    base = destination / "installation"
    installer = deploy.Deployment(base=base, caddyfile=caddy, runner=simulated_services)
    if previous_service is None and old.get("schemaVersion") == 2:
        previous_service = previous
    if previous_service is None:
        raise ValueError("Supply the frozen standalone BlotLens release and its SHA256SUMS")
    if old.get("schemaVersion") == 2:
        old_service_hash = old["blotlens"]["sha256"]
    else:
        rows = [line.split() for line in (previous_service / "SHA256SUMS").read_text().splitlines()]
        entries = [row[0] for row in rows if len(row) == 2 and row[1].lstrip("*") == "blotlens-linux.tar.gz"]
        if len(entries) != 1 or not release.DIGEST_RE.fullmatch(entries[0]):
            raise ValueError("Missing archived checksum for standalone BlotLens")
        old_service_hash = entries[0]
    old_files = stage_service(previous_service / "blotlens-linux.tar.gz", old_service_hash, destination / "service-old")
    new_files = stage_service(candidate / "blotlens-linux.tar.gz", new["blotlens"]["sha256"], destination / "service-new")
    service_current = destination / "service-current"
    events = []
    prior_files = {}
    for document, archive, manifest in ((old, old_archive, old_manifest), (new, new_archive, new_manifest),
                                        (old, old_archive, old_manifest)):
        installer.deploy(archive, document["archive"]["sha256"], document["version"])
        embedded_api = "blotlens/index.html" in manifest["sites"]["wb"]["files"]
        if installer.snippet.read_bytes() != deploy.caddy_snippet(base, embedded_blotlens=embedded_api):
            raise ValueError("Installed Caddy router differs from the selected WB release")
        for site, identity in manifest["sites"].items():
            actual = release.file_hashes((base / "current" / site).resolve())
            expected = identity["files"]
            carried = {path: digest for path, digest in actual.items() if path not in expected}
            if (any(actual.get(path) != digest for path, digest in expected.items())
                    or any(not path.startswith("assets/") or prior_files.get(site, {}).get(path) != digest
                           for path, digest in carried.items())):
                raise ValueError(f"Restored {site} tree differs from the selected release")
        prior_files = {site: info["files"] for site, info in manifest["sites"].items()}
        installer.verify_release((base / "current").resolve())
        legacy = document is old
        service_target = destination / ("service-old" if legacy else "service-new")
        deploy.atomic_symlink(service_current, service_target)
        if release.file_hashes(service_current.resolve()) != (old_files if legacy else new_files):
            raise ValueError("BlotLens service restoration hash mismatch")
        if not legacy:
            if release.file_hashes(service_current.resolve() / "dist") != release.file_hashes((base / "current/wb/blotlens").resolve()):
                raise ValueError("Embedded and standalone BlotLens have different bytes")
        events.append({"version": document["version"], "archiveSha256": document["archive"]["sha256"],
                       "embeddedApiRoute": embedded_api, "serviceSha256": old_service_hash if legacy else new["blotlens"]["sha256"]})
    receipt = {"mode": "isolated-filesystem", "events": events, "networkServices": "simulated",
               "restored": True, "candidateSha256": new["archive"]["sha256"]}
    release.write_json(destination / "recovery.json", receipt)
    return receipt


def publish(folder, receipt_file):
    document, archive, manifest = load_release(folder)
    if document["schemaVersion"] != 2:
        raise ValueError("Only verified monorepo CI packages can be published")
    receipt = update.json_load(receipt_file.read_bytes())
    events = receipt.get("events", [])
    if (receipt.get("mode") != "isolated-filesystem" or receipt.get("restored") is not True
            or len(events) != 3 or events[0] != events[2] or events[0] == events[1]
            or events[1].get("archiveSha256") != document["archive"]["sha256"]
            or events[1].get("serviceSha256") != document["blotlens"]["sha256"]):
        raise ValueError("Recovery evidence must be from the exact staged candidate")
    sha = document["sources"]["wb"]["gitSha"]
    # The original exact CI records are independently verified on publication.
    def verify_run(run_id, workflow):
        result = release.api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
        if (result.get("id") != run_id or not release.matching_ci(result, REPOSITORY, sha)
                or result.get("path") != f".github/workflows/{workflow}" or result.get("conclusion") != "success"):
            raise ValueError(f"Unexpected {workflow} CI provenance")
    verify_run(document["cliRunId"], "ci.yml")
    app_run = document["sources"]["wb"]["ci"]["runId"]
    verify_run(app_run, "apps.yml")
    records = release.api(f"repos/{REPOSITORY}/actions/runs/{app_run}/artifacts?per_page=100")
    by_id = {item["id"]: item for item in records["artifacts"]}
    for source in [*document["sources"].values(), document["blotlens"]]:
        evidence = source["ci"]
        artifact = by_id.get(evidence["artifactId"], {})
        if artifact.get("digest") != evidence["artifactDigest"] or artifact.get("name") != evidence["artifactName"]:
            raise ValueError("GitHub artifact and staged candidate provenance differ")
    with tempfile.TemporaryDirectory() as temp:
        scratch = Path(temp).resolve()
        source_portal(sha, scratch / "portal")
        if release.file_hashes(scratch / "portal") != manifest["sites"]["portal"]["files"]:
            raise ValueError("Published portal bytes differ from the source commit")
        for site, source in document["sources"].items():
            item = by_id[source["ci"]["artifactId"]]
            artifact_download.download_artifact(REPOSITORY, item, scratch / site, required_file="index.html")
            if release.file_hashes(scratch / site) != manifest["sites"][site]["files"]:
                raise ValueError(f"Release bytes differ from successful CI for {site}")
        service_record = document["blotlens"]
        artifact_download.download_artifact(REPOSITORY, by_id[service_record["ci"]["artifactId"]],
                                            scratch / "service", required_file="blotlens-linux.tar.gz")
        if release.sha256(scratch / "service/blotlens-linux.tar.gz") != service_record["sha256"]:
            raise ValueError("Standalone service differs from verified CI")
    tag = release.PREFIX + document["version"]
    existing_ref = release.optional_api(f"repos/{REPOSITORY}/git/ref/tags/{tag}")
    if existing_ref and release.api(f"repos/{REPOSITORY}/commits/{tag}")["sha"] != sha:
        raise ValueError("Existing release tag points at a different commit")
    assets = [archive, folder / "deployment.json", folder / "blotlens-linux.tar.gz", receipt_file]
    if receipt_file.name != "recovery.json":
        raise ValueError("Supply the recorded recovery.json from the staging rehearsal")
    expected = {file.name: "sha256:" + release.sha256(file) for file in assets}
    item = release.find_release(tag, None, REPOSITORY)
    if not item:
        release.command("gh", "release", "create", tag, "--repo", REPOSITORY, "--target", sha, "--draft",
                        "--title", tag, "--notes", f"Verified WispLab release {document['version']} at {sha}.",
                        "--latest=false")
        item = release.find_release(tag, None, REPOSITORY)
    if not item or item.get("prerelease") or item.get("target_commitish") != sha:
        raise ValueError("Release target or state is unexpected")
    def uploaded(record):
        found = {asset["name"]: asset.get("digest") for asset in record["assets"]}
        if len(found) != len(record["assets"]) or any(expected.get(name) != digest or not digest for name, digest in found.items()):
            raise ValueError("Unexpected or mismatched asset in release")
        return found
    found = uploaded(item)
    if item["draft"]:
        for file in assets:
            if file.name not in found:
                release.command("gh", "release", "upload", tag, str(file), "--repo", REPOSITORY, timeout=1800)
        item = release.find_release(tag, item["id"], REPOSITORY)
        if uploaded(item) != expected:
            raise ValueError("Staged release assets differ from local bytes")
        release.command("gh", "api", "--method", "PATCH", f"repos/{REPOSITORY}/releases/{item['id']}",
                        "-F", "draft=false", "-f", "make_latest=false")
        item = release.find_release(tag, item["id"], REPOSITORY)
    if (item["draft"] or item["prerelease"] or uploaded(item) != expected
            or release.api(f"repos/{REPOSITORY}/commits/{tag}")["sha"] != sha):
        raise ValueError("Publication could not be verified at the expected commit")
    print(item["html_url"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare", help="Download validated CI artifacts; no publication")
    prep.add_argument("--sha", required=True)
    prep.add_argument("--version", required=True)
    prep.add_argument("--output", type=Path, required=True)
    local = commands.add_parser("prepare-local", help="Build a rehearsal archive from local app builds")
    local.add_argument("--version", required=True)
    local.add_argument("--output", required=True, type=Path)
    send = commands.add_parser("publish", help="Explicitly publish the verified release after a recovery rehearsal")
    send.add_argument("--candidate", required=True, type=Path)
    send.add_argument("--recovery", required=True, type=Path)
    check = commands.add_parser("verify", help="Check a saved release directory, including legacy releases")
    check.add_argument("folder", type=Path)
    replay = commands.add_parser("rehearse", help="Install old, new, then old in an isolated filesystem")
    replay.add_argument("--previous-service", type=Path, help="Historical blotlens-linux.tar.gz and SHA256SUMS")
    for name in ("previous", "candidate", "output"):
        replay.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.sha, args.version, args.output.resolve())
    elif args.command == "prepare-local":
        local_candidate(args.version, args.output.resolve())
    elif args.command == "publish":
        publish(args.candidate, args.recovery)
    elif args.command == "verify":
        document, _, _ = load_release(args.folder)
        print(json.dumps({"verified": document["version"]}))
    else:
        print(json.dumps(rehearsal(args.previous, args.candidate, args.output.resolve(), args.previous_service), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, release.ReleaseError, update.UpdateError,
            artifact_download.ArtifactError, PACKAGER.PackageError, deploy.DeployError) as error:
        sys.exit(f"Release verification failed: {error}")
