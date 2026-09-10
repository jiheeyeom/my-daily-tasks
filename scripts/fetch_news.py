#!/usr/bin/env python3
"""Collect the news feeds into data/news.json.

The browser cannot read these feeds directly: they send no
Access-Control-Allow-Origin, and every free CORS proxy we tried has since gone
dark. So the fetch happens here, on a schedule, and the site reads a file from
its own origin instead.

Only the standard library, so the workflow needs no install step.
"""

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "news.json"

# The two lists the page renders, keyed by the element they fill.
FEEDS = {
    "kr-news-list": "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
    "bbc-news-list": "https://feeds.bbci.co.uk/news/rss.xml",
}
LIMIT = 10
# Wikipedia taught us this the hard way: a request with no identifying agent
# gets rate limited into a 429.
AGENT = "my-daily-tasks-news/1.0 (+https://github.com/jiheeyeom/my-daily-tasks)"


def fetch(url, attempts=3):
    last = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = error
            if attempt < attempts - 1:
                time.sleep(2 ** attempt)
    raise last


def text_of(item, *names):
    for name in names:
        node = item.find(name)
        if node is not None and node.text and node.text.strip():
            return node.text.strip()
    return ""


def parse(payload):
    """RSS <item> or Atom <entry>, whichever the feed speaks."""
    root = ElementTree.fromstring(payload)
    atom = "{http://www.w3.org/2005/Atom}"
    nodes = root.iter("item")
    rows = []
    for item in nodes:
        rows.append((text_of(item, "title"), text_of(item, "link")))
    if not rows:
        for entry in root.iter(f"{atom}entry"):
            title = text_of(entry, f"{atom}title")
            link = entry.find(f"{atom}link")
            rows.append((title, link.get("href", "") if link is not None else ""))
    items = []
    for title, link in rows:
        # Same rule the page applies: http(s) only, and a headline that is
        # actually there. The page re-checks both — this file is generated
        # from third-party input and is not trusted for being same-origin.
        if not title or not link.startswith(("https://", "http://")):
            continue
        items.append({"title": title, "url": link})
        if len(items) >= LIMIT:
            break
    return items


def main():
    previous = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8")).get("feeds", {})
        except (ValueError, OSError):
            previous = {}

    feeds, failed = {}, []
    for key, url in FEEDS.items():
        try:
            items = parse(fetch(url))
            if not items:
                raise ValueError("no usable items")
            feeds[key] = items
        except Exception as error:  # noqa: BLE001 - one bad feed must not blank the other
            print(f"{key}: {error}")
            failed.append(key)
            # A transient failure keeps yesterday's headlines rather than
            # wiping the section.
            feeds[key] = previous.get(key, [])

    if len(failed) == len(FEEDS):
        raise SystemExit("every feed failed; leaving the file as it is")

    if feeds == previous:
        print("no change")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.now(timezone.utc)
                .replace(microsecond=0)
                .isoformat()
                .replace("+00:00", "Z"),
                "feeds": feeds,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({', '.join(f'{k}: {len(v)}' for k, v in feeds.items())})")


if __name__ == "__main__":
    main()
