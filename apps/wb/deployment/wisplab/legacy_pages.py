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
            if now >= cutover:
                entry = generated / "index.html"
                original = entry.read_text(encoding="utf-8")
                redirect = (f"<script>if(Date.now()>={int(until.timestamp() * 1000)})"
                            f"location.replace({json.dumps(target)}+location.search+location.hash);</script>")
                original = original.replace("</head>", redirect + "</head>", 1)
                text = (f'<aside role="status">旧站开放至 {until:%Y-%m-%d %H:%M} UTC。'
                        f'请在本页导出浏览器中保存的项目或结果。'
                        f' Export saved work here before {until:%Y-%m-%d %H:%M} UTC. '
                        f'<a href="{escape(target)}">进入新站 / Open new site</a></aside>')
                updated, count = re.subn(r"<body\b[^>]*>", lambda m: m[0] + text, original,
                                         count=1, flags=re.IGNORECASE)
                if not count:
                    raise ValueError("The frozen page has no HTML body")
                entry.write_text(updated, encoding="utf-8")
            mode = "export-window" if now >= cutover else "frozen"
        else:
            generated.mkdir()
            # Preserve language, mode query and hash used by existing bookmarks.
            html = (f'<!doctype html><meta charset="utf-8"><title>WispLab</title>'
                    f'<a href="{escape(target)}">打开新站 / Open WispLab</a>'
                    f'<script>location.replace({json.dumps(target)}+location.search+location.hash)</script>')
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
