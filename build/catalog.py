#!/usr/bin/env python3
"""Extrait le catalogue (livres, tomes, numéros de Farda) des pages et prépare la boutique.

- corrige les caractères mal encodés hérités du site d'origine (« Ã  » -> « à »)
- repère chaque publication (référence, titre, prix, couverture)
- ajoute data-product="REF" sur le bloc correspondant de la page (pour le bouton « panier »)

Lit et réécrit server/seed/pages.json.gz ; écrit server/seed/catalog.json.
"""
import gzip
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "server" / "seed"

MOJIBAKE = re.compile(r"[Â-ô][\u0080-¿]{1,3}")


def fix(s):
    if not s:
        return s

    def rep(m):
        chunk = m.group(0)
        try:
            return chunk.encode("latin1").decode("utf8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            return chunk

    return MOJIBAKE.sub(rep, s)


def txt(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()


def split_authors(rest):
    """« Titre (Auteur (†), Autre) » -> (« Titre », « Auteur (†), Autre ») — parenthèses imbriquées gérées."""
    rest = rest.strip()
    if rest.endswith(")"):
        depth = 0
        for i in range(len(rest) - 1, -1, -1):
            depth += rest[i] == ")"
            depth -= rest[i] == "("
            if depth == 0:
                inner = rest[i + 1:-1]
                if re.search(r"[A-ZÉ]{3,}", inner):
                    return sup(rest[:i].strip()), inner.strip()
                break
    return sup(rest), ""


def sup(s):
    return re.sub(r"(\d) (er|re|e|es|ème)\b", r"\1\2", s)


def euros(s):
    if not s:
        return None
    return float(s.replace(",", "."))


def cover(el):
    a = el.find("a", attrs={"data-lightbox": True})
    img = el.find("img")
    return (img["src"] if img else None), (a["href"] if a else None)


def main():
    data = json.load(gzip.open(SEED / "pages.json.gz", "rt", encoding="utf-8"))
    products = {}

    def add(p):
        if p["ref"] in products:
            # on complète les informations manquantes sans écraser
            cur = products[p["ref"]]
            for k, v in p.items():
                if cur.get(k) in (None, "", []) and v not in (None, ""):
                    cur[k] = v
            cur["pages"] = sorted(set(cur["pages"] + p["pages"]))
            return
        products[p["ref"]] = p

    for page in data["pages"]:
        for k in ("title", "h1", "content", "date_maj"):
            page[k] = fix(page[k])
        if page.get("side"):
            for it in page["side"]["items"]:
                it["label"] = fix(it["label"])
            page["side"]["title"] = fix(page["side"]["title"])

        soup = BeautifulSoup(page["content"], "lxml")
        changed = False
        h1 = BeautifulSoup(page["h1"], "lxml").get_text(" ", strip=True)

        # Tomes des dictionnaires : « Tome I (A-B) / 341 pages / Papier : 30 € / Numérique : 10 € (membres) / Référence : DF62 »
        for bk in soup.select(".book"):
            t = txt(bk)
            m = re.search(r"Référence\s*:\s*([A-Z]{2,4}\d{1,3}[a-zA-Z]?)", t)
            if not m:
                continue
            ref = m.group(1)
            tome = re.search(r"(Tome [IVXLC]+[^0-9]*?)(?=\s+\d+\s+pages|\s+Papier|$)", t)
            pages_n = re.search(r"(\d[\d\s]*)\s+pages", t)
            paper = re.search(r"Papier\s*:\s*([\d,.]+)\s*€", t)
            digital = re.search(r"Numérique\s*:\s*([\d,.]+)\s*€", t)
            img, big = cover(bk)
            title = re.sub(r"\s*\(\d+e?\s*édition\)\s*$", "", h1)
            add({
                "ref": ref, "kind": "livre",
                "title": sup(title) + (f" — {tome.group(1).strip()}" if tome else ""),
                "details": f"{pages_n.group(1).strip()} pages" if pages_n else "",
                "price_paper": euros(paper.group(1)) if paper else None,
                "price_digital": euros(digital.group(1)) if digital else None,
                "digital_members_only": True, "digital_free_members": False,
                "luxe": ref.startswith(("DF", "EG")),
                "cover": img, "cover_big": big, "pages": [page["slug"]],
            })
            bk["data-product"] = ref
            changed = True

        # Fiches « REF : Titre (auteurs) … Version papier : 15 € Version numérique : 5 € »
        for card in soup.select(".issue"):
            body = card.select_one(".issue__body") or card
            t = txt(body)
            head = body.find(["h2", "h3"])
            ht = txt(head) if head else t
            m = re.match(r"(?:Agrandir\s+)?([A-Z]{2,4}\d{1,3}[a-zA-Z]?)\s*:\s*(.+)$", ht)
            if not m or page["slug"] in FARDA_PAGES:
                continue
            ref, rest = m.group(1), m.group(2).strip()
            title, authors = split_authors(rest)
            paper = re.search(r"(?:Version )?papier\s*:\s*([\d,.]+)\s*€", t, re.I)
            digital = re.search(r"(?:Version )?numérique\s*:\s*([\d,.]+)\s*€", t, re.I)
            pages_n = re.search(r"(\d[\d\s]*)\s+pages", t)
            img, big = cover(card)
            add({
                "ref": ref, "kind": "livre",
                "title": title[:160], "authors": authors[:200],
                "details": f"{pages_n.group(1).strip()} pages" if pages_n else "",
                "price_paper": euros(paper.group(1)) if paper else None,
                "price_digital": euros(digital.group(1)) if digital else None,
                "digital_members_only": True, "digital_free_members": False,
                "luxe": ref.startswith(("DF", "EG")),
                "cover": img, "cover_big": big, "pages": [page["slug"]],
            })
            card["data-product"] = ref
            changed = True

        # Numéros de Farda
        if page["slug"] in FARDA_PAGES:
            for h2 in soup.find_all("h2"):
                t = txt(h2)
                m = re.match(r"Farda n°\s*(\d+)\s*\(([^)]*)\)", t)
                if not m:
                    continue
                n = int(m.group(1))
                ref = f"FARDA{n:03d}"
                card = h2.find_next_sibling(class_="issue")
                img, big = cover(card) if card else (None, None)
                add({
                    "ref": ref, "kind": "farda",
                    "title": f"Farda n° {n}", "details": m.group(2),
                    "price_paper": 4.0, "price_digital": 3.0,
                    "digital_members_only": False, "digital_free_members": True,
                    "luxe": False, "cover": img, "cover_big": big, "pages": [page["slug"]],
                })
                (card or h2)["data-product"] = ref
                changed = True

        if changed:
            body = soup.body
            page["content"] = body.decode_contents() if body else str(soup)

    data["agenda"]["title"] = fix(data["agenda"]["title"])
    with gzip.open(SEED / "pages.json.gz", "wt", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    cat = sorted(products.values(), key=lambda p: (p["kind"] != "farda", p["ref"]))
    (SEED / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1))
    kinds = {}
    for p in cat:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print(f"{len(cat)} publications : {kinds}")


FARDA_PAGES = {"page-9", "page-10", "page-11", "page-12", "page-13", "page-14", "page-15", "page-74", "page-97", "page-112", "page-136", "page-144"}

if __name__ == "__main__":
    main()
