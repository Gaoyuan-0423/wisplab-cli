#!/usr/bin/env python3
"""Prepare a frozen legacy Pages site, then a timed redirect from a UTC cutover date."""
import argparse
from datetime import datetime, timezone, timedelta
from html import escape
import json
import re
from pathlib import Path
import shutil
import tempfile

from suite_release import load_release, WEB_APPS
import deploy

TARGETS = {site: f"https://{site}.wisplab.top/" for site in WEB_APPS}
PROJECTS = {"wb": "blot-workbench", "pathology": "pathology-workbench", "pcr": "pcr-workbench"}
REDIRECT_SCRIPT = Path(__file__).with_name("legacy-redirect.js")


def add_notice(entry, notice):
    original = entry.read_text(encoding="utf-8")
    updated, count = re.subn(r"<body\b[^>]*>", lambda match: match[0] + notice, original,
                             count=1, flags=re.IGNORECASE)
    if not count:
        raise ValueError(f"The frozen {entry.name} has no HTML body")
    entry.write_text(updated, encoding="utf-8")


def timestamp(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Use a timestamp including a UTC offset")
    return dt.astimezone(timezone.utc)


def build(site, frozen_release, cutover, output, now):
    if output.exists():
        raise ValueError("Choose an unused output directory")
    document, archive, _ = load_release(frozen_release)
    if document.get("schemaVersion") != 1:
        raise ValueError("Use the saved legacy release that backed the old Pages URL")
    target = TARGETS[site]
    until = cutover + timedelta(days=30)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temp:
        root = Path(temp)
        generated = root / "pages"
        if now < until:
            extracted = root / "frozen"
            extracted.mkdir()
            deploy.read_archive(archive, document["archive"]["sha256"], document["version"], extracted)
            shutil.copytree(extracted / site, generated)
        else:
            generated.mkdir()

        if now < cutover:
            mode = "frozen"
        else:
            project = f"/{PROJECTS[site]}/"
            # Pages serves the same 404 file from any missing URL, including nested paths.
            with (generated / REDIRECT_SCRIPT.name).open("xb") as asset:
                asset.write(REDIRECT_SCRIPT.read_bytes())
            within_window = now < until
            deadline = f' data-deadline="{int(until.timestamp() * 1000)}"' if within_window else ""
            script = (f'<script src="{project}{REDIRECT_SCRIPT.name}" '
                      f'data-target="{escape(target)}"{deadline}></script>')
            new_link = f'<a data-wisplab-keep-location href="{escape(target)}">进入新站 / Open WispLab</a>'
            if within_window:
                notice = (f'<aside role="status">旧站开放至 {until:%Y-%m-%d %H:%M} UTC。'
                          f'请在本页导出浏览器中保存的项目或结果。'
                          f' Export saved work here before {until:%Y-%m-%d %H:%M} UTC. '
                          f'{new_link}</aside>{script}')
                add_notice(generated / "index.html", notice)
                missing = generated / "404.html"
                old_link = (f'<a data-wisplab-keep-location href="{project}">'
                            '返回旧站导出 / Open the old workbench to export</a>')
                if not missing.exists():
                    missing.write_text('<!doctype html><meta charset="utf-8"><title>WispLab</title>'
                                       '<body></body>', encoding="utf-8")
                add_notice(missing, old_link + notice)
                mode = "export-window"
            else:
                html = f'<!doctype html><meta charset="utf-8"><title>WispLab</title>{new_link}{script}'
                for name in ("index.html", "404.html"):
                    (generated / name).write_text(html, encoding="utf-8")
                mode = "redirect"
        generated.rename(output)
    return {"site": site, "mode": mode, "deadlineUTC": until.isoformat(), "source": document["version"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", choices=WEB_APPS, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--cutover", type=timestamp, required=True)
    parser.add_argument("--at", type=timestamp, help="Simulate a date for rehearsal")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.site, args.previous, args.cutover, args.output,
                           args.at or datetime.now(timezone.utc)), indent=2))
