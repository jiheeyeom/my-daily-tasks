"""Collect attributed quotations for the ticker.

    python3 scripts/fetch_quotes.py

Everything here comes from a source that carries the attribution with it:
English Wikiquote, whose pages group quotations under the work they come from.
Nothing is written or paraphrased, so no line is credited to an author who did
not write it. Authors were chosen from data/독서 취향 기록.txt and its
neighbours — speculative fiction with a philosophical bent, and psychological
crime.

Writes data/quotes.json.
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "data" / "quotes.json"
API = "https://en.wikiquote.org/w/api.php"

AUTHORS = [
    "Ursula K. Le Guin", "Ted Chiang", "Liu Cixin", "Daniel Keyes",
    "Isaac Asimov", "Arthur C. Clarke", "Philip K. Dick", "Ray Bradbury",
    "Kurt Vonnegut", "Douglas Adams", "Octavia Butler", "Margaret Atwood",
    "Jorge Luis Borges", "Italo Calvino", "Stanisław Lem", "H. G. Wells",
    "Mary Shelley", "Franz Kafka", "Fyodor Dostoevsky", "Albert Camus",
    "Agatha Christie", "Raymond Chandler", "Dashiell Hammett",
    "Patricia Highsmith", "Arthur Conan Doyle", "Edgar Allan Poe",
    "Shirley Jackson", "Daphne du Maurier", "Stephen King", "Gillian Flynn",
    "Haruki Murakami", "Kazuo Ishiguro", "Virginia Woolf", "Marcel Proust",
    "George Orwell", "Aldous Huxley", "Toni Morrison", "James Baldwin",
]

MARKUP = [
    (re.compile(r"\[\[[^|\]]*\|([^\]]*)\]\]"), r"\1"),   # piped link
    (re.compile(r"\[\[([^\]]*)\]\]"), r"\1"),            # plain link
    (re.compile(r"'''''|'''|''"), ""),                   # bold / italic
    (re.compile(r"<ref[^>]*>.*?</ref>", re.S), ""),
    (re.compile(r"<ref[^>]*/>"), ""),
    (re.compile(r"<[^>]+>"), ""),
    (re.compile(r"\{\{[^}]*\}\}"), ""),                  # templates
    (re.compile(r"&nbsp;"), " "),
    (re.compile(r"\s+"), " "),
]


def clean(text):
    for pattern, replacement in MARKUP:
        text = pattern.sub(replacement, text)
    return text.strip(" —-–*:;")


def wikitext(page):
    url = (
        f"{API}?action=parse&page={urllib.parse.quote(page)}"
        "&prop=wikitext&format=json&redirects=1"
    )
    # Wikimedia asks for a descriptive agent and throttles hard without one.
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "my-daily-tasks quote collector "
            "(https://github.com/jiheeyeom/my-daily-tasks)"
        },
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            time.sleep(4 * (attempt + 1))
    else:
        return None
    if "error" in payload:
        return None
    return payload["parse"]["wikitext"]["*"]


def harvest(author, text):
    """Quote lines start with a single '*'; the nearest heading names the work.

    Sections have to be classified, not just labelled: "Quotes about X" holds
    what other people said about this author, and attributing those to them
    would be plainly false. Disputed and misattributed sections are dropped for
    the same reason.
    """
    found, work, skip = [], "", False
    for line in text.split("\n"):
        heading = re.match(r"^==+\s*(.+?)\s*==+\s*$", line)
        if heading:
            title = clean(heading.group(1))
            skip = bool(
                re.search(
                    r"about |misattribut|disputed|external|see also|"
                    r"further reading|bibliograph",
                    title,
                    re.I,
                )
            )
            work = "" if skip or re.fullmatch(
                r"quotes?|sourced|unsourced|attributed", title, re.I
            ) else title
            continue
        if skip or not line.startswith("*") or line.startswith("**"):
            continue
        body = clean(line[1:])
        if not (60 <= len(body) <= 240):
            continue
        if body.startswith(("http", "ISBN")) or "wikipedia" in body.lower():
            continue
        # Wikiquote carries originals alongside translations; keep the English.
        letters = [c for c in body if c.isalpha()]
        if not letters or sum(c.isascii() for c in letters) / len(letters) < 0.97:
            continue
        found.append({"text": body, "author": author, "work": work})
    return found


def main():
    collected, seen = [], set()
    for author in AUTHORS:
        text = wikitext(author)
        if text is None:
            print(f"  {author}: 문서 없음")
            continue
        rows = [row for row in harvest(author, text) if row["text"] not in seen]
        for row in rows:
            seen.add(row["text"])
        collected += rows
        print(f"  {author}: {len(rows)}개")
        time.sleep(1.2)

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        json.dumps(collected, ensure_ascii=False, indent=0), encoding="utf-8"
    )
    works = sum(1 for row in collected if row["work"])
    print(f"\n  총 {len(collected)}개 · 출처 작품이 붙은 것 {works}개 "
          f"· {TARGET.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
