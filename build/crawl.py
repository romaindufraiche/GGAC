#!/usr/bin/env python3
"""Télécharge les pages publiques de www.ggac.fr (listées dans le plan du site) dans build/raw/."""
import re
import time
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent / "raw"
BASE = "https://www.ggac.fr/"
EXTRA = ["agenda.php", "contacts.php", "plan_site.php", "identification.php", "mentions_cookies.php", "membre_rappel.php"]


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(url)


def main():
    RAW.mkdir(exist_ok=True)
    plan = get(BASE + "plan_site.php").decode("latin1")
    pages = sorted({int(n) for n in re.findall(r"index\.php\?page=(\d+)", plan)})
    for u in EXTRA:
        (RAW / u.replace(".php", ".html")).write_bytes(get(BASE + u))
        time.sleep(0.5)
    for n in pages:
        (RAW / f"page-{n}.html").write_bytes(get(f"{BASE}index.php?page={n}"))
        time.sleep(0.5)
    print(len(pages), "pages")


if __name__ == "__main__":
    main()
