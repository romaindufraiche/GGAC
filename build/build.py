#!/usr/bin/env python3
"""Génère le site statique G.G.A.C. à partir des pages d'origine.

Usage :
    python3 build/crawl.py      # télécharge les pages publiques dans build/raw/
    python3 build/build.py      # génère les pages HTML à la racine

Aucun texte n'est ajouté : seul le balisage est modernisé.
"""
import html
import json
import re
import sys
import urllib.parse
from pathlib import Path

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "build" / "raw"
PARTIALS = ROOT / "build" / "partials"
ORIGIN = "https://www.ggac.fr/"
OUT_HTML = "--html" in sys.argv  # génère aussi les pages statiques (ancien mode)

# Pages annexes (hors index.php?page=N) : fichier d'origine -> fichier généré
SPECIAL = {
    "agenda.php": "agenda.html",
    "contacts.php": "contacts.html",
    "plan_site.php": "plan-du-site.html",
    "identification.php": "espace-membre.html",
    "mentions_cookies.php": "mentions-cookies.html",
    "membre_rappel.php": "membre-rappel.html",
}

AVAILABLE = set()  # noms de fichiers générés (pour réécrire les liens)


def load(name):
    return BeautifulSoup((RAW / name).read_bytes().decode("latin1"), "lxml")


# ---------------------------------------------------------------------------
# Liens & ressources
# ---------------------------------------------------------------------------
def local_name(href):
    """Retourne le fichier local correspondant à une URL du site, ou None."""
    if not href:
        return None
    h = href.strip()
    h = re.sub(r"^https?://(www\.)?ggac\.fr/?", "", h)
    if re.match(r"^[a-z]+:", h) or h.startswith("//"):
        return None
    h = h.lstrip("/")
    path, _, frag = h.partition("#")
    m = re.match(r"^index\.php\?page=(\d+)$", path)
    if m:
        n = int(m.group(1))
        name = "index.html" if n == 1 else f"page-{n}.html"
    elif path in ("", "index.php"):
        name = "index.html"
    elif path in SPECIAL:
        name = SPECIAL[path]
    else:
        return None
    if name not in AVAILABLE and name != "index.html":
        return None
    return name + (f"#{frag}" if frag else "")


def map_href(href):
    if not href:
        return href
    h = href.strip()
    if h.startswith("#") or h.startswith("mailto:") or h.startswith("javascript:"):
        return h
    loc = local_name(h)
    if loc:
        return loc
    if re.match(r"^[a-z]+:", h, re.I) or h.startswith("//"):
        return h
    return urllib.parse.urljoin(ORIGIN, h.lstrip("/"))


def map_src(src):
    if not src:
        return src
    if re.match(r"^[a-z]+:", src, re.I) or src.startswith("//"):
        return src
    return urllib.parse.urljoin(ORIGIN, src.lstrip("/"))


# ---------------------------------------------------------------------------
# Extraction d'une page d'origine
# ---------------------------------------------------------------------------
def extract(soup):
    data = {}
    t = soup.find("title")
    data["title"] = t.get_text(" ", strip=True) if t else ""
    act = soup.select_one("#nav > li.actif")
    data["section"] = act.get_text(strip=True) if act else None

    # Colonne latérale (premier tableau de la colonne de 150 px)
    side = None
    col = soup.find("td", attrs={"width": "150", "valign": "top"})
    if col:
        tb = col.find("table")
        img = tb.find("img") if tb else None
        if img and img.get("alt") and "Actualit" not in img["alt"]:
            items = []
            for td in tb.find_all("td", attrs={"width": "150"}):
                el = td.find(["a", "span"], class_=["menu", "actif"])
                if not el:
                    continue
                div = td.find("div", style=re.compile("margin-left"))
                level = 1 if div else 0
                if el.name == "a":
                    items.append({"label": el.get_text(strip=True), "href": map_href(el.get("href")), "level": level})
                else:
                    items.append({"label": el.get_text(strip=True), "href": None, "level": level})
            side = {"title": img["alt"], "items": items}
    data["side"] = side

    texte = soup.find("div", class_="texte")
    h1 = texte.find("h1") if texte else None
    data["h1"] = "".join(str(c) for c in h1.span.contents) if h1 and h1.span else (h1.decode_contents() if h1 else "")
    # Retire le tableau du titre
    if h1:
        tb = h1.find_parent("table")
        (tb or h1).decompose()
    data["content"] = texte

    dm = soup.find("p", class_="date_maj")
    data["date_maj"] = dm.get_text(" ", strip=True) if dm else ""
    return data


def extract_nav(soup):
    """Construit la structure du menu principal à partir d'une page."""
    out = []
    for li in soup.select("#nav > li"):
        a = li.find("a", recursive=False)
        label = (a or li).get_text(strip=True) if a else li.get_text(strip=True)
        if a and "titre" in (a.get("class") or []) and a.get("href"):
            out.append({"label": a.get_text(strip=True), "href": map_href(a["href"]), "children": None})
            continue
        ul = li.find("ul", recursive=False)
        children = []
        if ul:
            for c in ul.find_all("li", recursive=False):
                ca = c.find("a", recursive=False)
                sub = c.find("ul", recursive=False)
                item = {"label": ca.get_text(strip=True), "href": map_href(ca.get("href")), "children": None}
                if sub:
                    item["children"] = [
                        {"label": x.get_text(strip=True), "href": map_href(x.get("href"))} for x in sub.find_all("a")
                    ]
                children.append(item)
        out.append({"label": a.get_text(strip=True) if a else li.get_text(strip=True), "href": None, "children": children or None})
    return out


# ---------------------------------------------------------------------------
# Nettoyage / modernisation du contenu
# ---------------------------------------------------------------------------
DROP_ATTRS = {"width", "height", "align", "valign", "border", "cellpadding", "cellspacing", "bgcolor",
              "onfocus", "onblur", "onchange", "onmouseover", "onmouseout", "language", "size", "hspace", "vspace"}
KEEP_STYLE = re.compile(r"(text-align\s*:\s*(left|right|center|justify))", re.I)


def decode_mail(script_text):
    m = re.search(r"eval\(unescape\((.*?)\)\)", script_text, re.S)
    if not m:
        return None
    js = urllib.parse.unquote("".join(re.findall(r"'([^']*)'", m.group(1))))
    mm = re.search(r"mailto:([^\"'\\]+)'\+'@'\+'([^\"'\\]+)", js)
    if not mm:
        return None
    return mm.group(1), mm.group(2)


def clean(texte, soup, page_name):
    flags = {"cassini": False, "lightbox": False}

    for c in texte.find_all(string=lambda s: isinstance(s, Comment)):
        c.extract()

    # Scripts : adresses masquées -> lien reconstruit en JS ; Flash Cassini -> visualiseur
    for sc in texte.find_all("script"):
        txt = sc.string or sc.get_text()
        mail = decode_mail(txt)
        if mail:
            a = soup.new_tag("a", attrs={"class": "js-mail", "data-u": mail[0], "data-d": mail[1], "href": "#"})
            sc.replace_with(a)
        elif "AC_FL_RunContent" in txt and "cassini" in txt:
            box = sc.find_parent("div") or sc
            viewer = soup.new_tag("div", attrs={
                "class": "cassini", "data-w": "11159", "data-h": "7302",
                "data-tiles": ORIGIN + "fichiers/image/"})
            box.replace_with(viewer)
            flags["cassini"] = True
        else:
            sc.decompose()
    for ns in texte.find_all(["noscript", "object", "embed"]):
        ns.decompose()

    # Éditoriaux dépliables
    for a in texte.find_all("a", onclick=re.compile(r"getElementById\('([^']+)'\)\.style\.display")):
        tid = re.search(r"getElementById\('([^']+)'\)", a["onclick"]).group(1)
        btn = soup.new_tag("button", attrs={"type": "button", "class": "toggle", "aria-expanded": "false", "aria-controls": tid})
        btn.extend(list(a.contents))
        a.replace_with(btn)
        target = texte.find(id=tid)
        if target:
            target["class"] = (target.get("class") or []) + ["collapsible"]
            inner = soup.new_tag("div", attrs={"class": "collapsible__inner"})
            for ch in list(target.contents):
                inner.append(ch.extract())
            target.append(inner)

    # Galeries Highslide / Fancybox -> visionneuse
    for a in texte.find_all("a"):
        oc = a.get("onclick", "")
        if "hs.expand" in oc or "fancy" in (a.get("class") or []):
            a["class"] = [c for c in (a.get("class") or []) if c not in ("highslide",)] + ["zoom"]
            a["data-lightbox"] = ""
            if "fancy" in a["class"]:
                a["class"].remove("fancy")
            flags["lightbox"] = True
        if "onclick" in a.attrs:
            del a["onclick"]
    for el in texte.find_all(attrs={"onclick": True}):
        del el["onclick"]

    # <font> -> déballé
    for f in texte.find_all("font"):
        f.unwrap()

    # Attributs hérités
    for el in texte.find_all(True):
        if el.name == "img":
            el["src"] = map_src(el.get("src"))
            el["loading"] = "lazy"
            el["decoding"] = "async"
            for k in ("border", "align", "hspace", "vspace", "style", "name"):
                el.attrs.pop(k, None)
            continue
        if el.name == "iframe":
            el.attrs.pop("width", None)
            el.attrs.pop("height", None)
            el["loading"] = "lazy"
            continue
        if el.name in ("area",):
            el["href"] = map_href(el.get("href"))
            continue
        if el.name == "map":
            continue
        align = (el.get("align") or "").lower()
        style = el.get("style", "")
        hidden = "display: none" in style.replace("display:none", "display: none")
        keep = KEEP_STYLE.search(style)
        cls = el.get("class") or []
        if align in ("center", "right", "justify"):
            cls.append(f"ta-{align[0]}")
        if keep:
            cls.append("ta-" + keep.group(2).lower()[0])
        if "float:left" in style.replace(" ", "") or "float: left" in style:
            cls.append("fl")
        for k in list(el.attrs):
            if k in DROP_ATTRS or k == "style":
                del el[k]
        if cls:
            el["class"] = sorted(set(cls), key=cls.index)
        if hidden and "collapsible" not in cls:
            el["hidden"] = ""
        if el.name == "a" and el.get("href"):
            el["href"] = map_href(el["href"])
            if el.get("target") == "_blank":
                el["rel"] = "noopener"
        if el.name == "form":
            if el.get("action") in (None, "#", ""):
                el["action"] = ORIGIN + page_name
                el["method"] = "post"
            else:
                el["action"] = map_src(el["action"]) if not el["action"].startswith("http") else el["action"]
                if "identification" in el["action"]:
                    el["action"] = ORIGIN + "identification.php"
        if el.name == "input" and el.get("type") in ("button", "submit"):
            el["class"] = ["btn"]

    # Paragraphes vides
    for p in texte.find_all(["p", "div"]):
        if not p.get_text(strip=True) and not p.find(["img", "iframe", "input", "select", "textarea", "button", "table", "map", "a"]) \
                and "cassini" not in (p.get("class") or []):
            p.decompose()

    # Tableaux : couvertures -> grille de livres ; couverture + sommaire -> fiche ; reste -> tableau défilant
    def nested(tb):
        for par in tb.parents:
            if par is texte:
                return False
            if par.name == "table":
                return True
        return False

    for tb in list(texte.find_all("table")):
        if nested(tb):
            continue
        cells = tb.find_all("td")
        rows = tb.find_all("tr", recursive=True)
        has_form = tb.find(["input", "select", "textarea"])
        if has_form:
            tb.name = "div"
            tb["class"] = ["form-table"]
            for x in tb.find_all(["tbody", "tr", "td", "th"]):
                x.name = "div"
            continue
        nonempty = [c for c in cells if c.get_text(strip=True) or c.find("img")]
        zoom_cells = [c for c in nonempty if c.find("a", attrs={"data-lightbox": True}) and len(c.get_text(" ", strip=True)) < 400]
        if len(nonempty) >= 2 and len(zoom_cells) == len(nonempty) and not tb.find("table"):
            grid = soup.new_tag("div", attrs={"class": "books"})
            for c in nonempty:
                c.name = "div"
                c["class"] = ["book"]
                c.attrs.pop("colspan", None)
                c.attrs.pop("rowspan", None)
                grid.append(c.extract())
            tb.replace_with(grid)
            continue
        if len(rows) == 1 and len(nonempty) == 2 and nonempty[0].find("a", attrs={"data-lightbox": True}) \
                and not nonempty[1].find("img"):
            fiche = soup.new_tag("div", attrs={"class": "issue"})
            a, b = nonempty
            a.name = b.name = "div"
            a["class"] = ["issue__cover"]
            b["class"] = ["issue__body"]
            fiche.append(a.extract())
            fiche.append(b.extract())
            tb.replace_with(fiche)
            continue
        # plusieurs lignes « couverture + texte » -> pile de fiches
        direct_rows = [r for r in rows if not nested(r.find_parent("table")) or r.find_parent("table") is tb]
        cover_rows = []
        ok = len(direct_rows) >= 2
        for r in direct_rows:
            cs = [c for c in r.find_all("td", recursive=False) if c.get_text(strip=True) or c.find("img")]
            if not cs:
                continue
            if len(cs) == 2 and cs[0].find("img") and not cs[1].find("img"):
                cover_rows.append(cs)
            else:
                ok = False
                break
        if ok and len(cover_rows) >= 2:
            stack = soup.new_tag("div", attrs={"class": "issues"})
            for a, b in cover_rows:
                fiche = soup.new_tag("div", attrs={"class": "issue"})
                a.name = b.name = "div"
                a["class"] = ["issue__cover"]
                b["class"] = (b.get("class") or []) + ["issue__body"]
                a.attrs.pop("colspan", None); b.attrs.pop("colspan", None)
                fiche.append(a.extract())
                fiche.append(b.extract())
                stack.append(fiche)
            tb.replace_with(stack)
            continue
        if tb.find("img") and len(nonempty) <= 3 and len(rows) <= 2:
            # mise en page par tableau : on aplatit en grille souple
            flex = soup.new_tag("div", attrs={"class": "cols"})
            for c in nonempty:
                c.name = "div"
                c["class"] = (c.get("class") or []) + ["col"]
                flex.append(c.extract())
            tb.replace_with(flex)
            continue
        wrap = soup.new_tag("div", attrs={"class": "table-wrap"})
        tb.wrap(wrap)

    # Légendes « Agrandir » -> pastille
    for a in texte.find_all("a", attrs={"data-lightbox": True}):
        for br in a.find_all("br"):
            br.decompose()
        for s in a.find_all(string=re.compile(r"^\s*Agrandir\s*$")):
            span = soup.new_tag("span", attrs={"class": "zoom__label"})
            span.string = s.strip()
            s.replace_with(span)

    # iframes responsives
    for f in texte.find_all("iframe"):
        f.wrap(soup.new_tag("div", attrs={"class": "embed"}))

    # cartes cliquables : on les laisse défiler horizontalement
    for img in texte.find_all("img", usemap=True):
        img.wrap(soup.new_tag("div", attrs={"class": "map-wrap"}))

    html_out = texte.decode_contents()
    html_out = re.sub(r"(\s*<br\s*/?>\s*){3,}", "<br/><br/>", html_out)
    return html_out, flags


# ---------------------------------------------------------------------------
# Gabarit
# ---------------------------------------------------------------------------
def esc(s):
    return html.escape(s, quote=True)


def render_nav(nav, active):
    parts = []
    for item in nav:
        label = item["label"]
        is_active = active and label == active
        if not item["children"]:
            cls = "menu__member" if "membre" in label.lower() else ""
            parts.append(f'<li class="{cls}"><a class="menu__top" href="{esc(item["href"])}">{esc(label)}</a></li>')
            continue
        wide = len(item["children"]) > 5 and any(c["children"] and len(c["children"]) > 20 for c in item["children"])
        li_cls = "has-sub" + (" is-active" if is_active else "")
        col, dict_html = [], ""
        for c in item["children"]:
            if c["children"] and len(c["children"]) > 20 and wide:
                links = "".join(f'<li><a href="{esc(x["href"])}">{esc(x["label"])}</a></li>' for x in c["children"])
                dict_html = (f'<div class="sub__dict"><a class="sub__dict-title" href="{esc(c["href"])}">{esc(c["label"])}</a>'
                             f'<ul class="dict">{links}</ul></div>')
            elif c["children"]:
                links = "".join(f'<li><a href="{esc(x["href"])}">{esc(x["label"])}</a></li>' for x in c["children"])
                col.append(f'<li class="has-fly"><a href="{esc(c["href"])}">{esc(c["label"])}</a><ul class="fly">{links}</ul></li>')
            else:
                col.append(f'<li><a href="{esc(c["href"])}">{esc(c["label"])}</a></li>')
        sub_cls = "sub sub--wide" if dict_html else "sub"
        parts.append(
            f'<li class="{li_cls}"><button class="menu__top" aria-expanded="false">{esc(label)}</button>'
            f'<div class="{sub_cls}"><ul class="sub__col">{"".join(col)}</ul>{dict_html}</div></li>')
    return "\n".join(parts)


def render_side(side, news_html):
    out = []
    if side:
        lis = []
        for it in side["items"]:
            lvl = ' class="lvl1"' if it["level"] else ""
            if it["href"]:
                lis.append(f'<li{lvl}><a href="{esc(it["href"])}">{esc(it["label"])}</a></li>')
            else:
                lis.append(f'<li{lvl}><span class="is-current" aria-current="page">{esc(it["label"])}</span></li>')
        long = " side__block--long" if len(lis) > 14 else ""
        out.append(f'<section class="side__block{long}"><h2 class="side__title">{esc(side["title"])}</h2>'
                   f'<ul class="side__menu">{"".join(lis)}</ul></section>')
    out.append(news_html)
    return "\n".join(out)


def page_html(tpl, *, title, nav_html, side_html, main_html, extra_head="", extra_body="", body_class=""):
    return (tpl.replace("{{TITLE}}", esc(title))
            .replace("{{NAV}}", nav_html)
            .replace("{{SIDE}}", side_html)
            .replace("{{MAIN}}", main_html)
            .replace("{{EXTRA_HEAD}}", extra_head)
            .replace("{{EXTRA_BODY}}", extra_body)
            .replace("{{BODY_CLASS}}", body_class))


def main_html(h1, content, date_maj):
    return f"""<svg class="vine vine--content" viewBox="0 0 260 240" aria-hidden="true"><use href="#vine" /></svg>
<h1 class="title"><span class="title__text" data-split>{h1}</span>
<svg class="title__flourish" viewBox="0 0 320 30" aria-hidden="true"><path d="M4 18 C 60 4, 110 28, 160 16 S 260 4, 316 16" /><path d="M150 16 c 6 -10 14 -10 10 0 c -4 8 -14 6 -10 0" /></svg></h1>
<div class="prose">
{content}
</div>
<div class="pagefoot">
  <a class="totop" href="#haut" title="Retour en haut de la page" aria-label="Retour en haut de la page">
    <svg viewBox="0 0 80 84" aria-hidden="true"><path class="totop__trunk" d="M40 82 V48 M40 60 L28 48 M40 56 L53 44 M40 48 L40 36" />
    <g class="totop__leaves"><circle cx="40" cy="26" r="14" /><circle cx="24" cy="36" r="11" /><circle cx="56" cy="34" r="12" /><circle cx="28" cy="20" r="9" /><circle cx="52" cy="18" r="10" /></g></svg>
  </a>
  <p class="date_maj">{esc(date_maj)}</p>
</div>"""


def plain_text(fragment, limit):
    t = BeautifulSoup(fragment, "lxml").get_text(" ", strip=True)
    return re.sub(r"\s+", " ", t)[:limit]


def build():
    tpl = (PARTIALS / "layout.html").read_text()
    news_html = (PARTIALS / "news.html").read_text()

    pages = sorted(RAW.glob("page-*.html"), key=lambda p: int(p.stem.split("-")[1]))
    AVAILABLE.update(p.name for p in pages)
    AVAILABLE.update(v for k, v in SPECIAL.items() if (RAW / k.replace(".php", ".html")).exists())

    # Menu principal : on fusionne les menus de deux pages (la rubrique active n'a pas de sous-menu)
    nav_a = extract_nav(load("agenda.html"))        # contient « Publications »
    nav_b = extract_nav(load("page-10.html"))       # contient « L'association »
    nav = []
    for a, b in zip(nav_a, nav_b):
        nav.append(a if a["children"] or a["href"] else b)

    index = []
    seed_pages = []
    jobs = [(p.name, p.name) for p in pages]
    jobs += [(k.replace(".php", ".html"), v) for k, v in SPECIAL.items() if v != "agenda.html" and (RAW / k.replace(".php", ".html")).exists()]

    for src, out in jobs:
        soup = load(src)
        d = extract(soup)
        orig = "index.php?page=" + src.split("-")[1].split(".")[0] if src.startswith("page-") else src.replace(".html", ".php")
        content, flags = clean(d["content"], soup, orig)
        extra_head = ""
        extra_body = ""
        if flags["cassini"]:
            extra_body = '<script src="https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/openseadragon.min.js" defer></script>'
        big = len(content) > 150_000
        html_doc = page_html(
            tpl,
            title=d["title"],
            nav_html=render_nav(nav, d["section"]),
            side_html=render_side(d["side"], news_html),
            main_html=main_html(d["h1"], content, d["date_maj"]),
            extra_head=extra_head,
            extra_body=extra_body,
            body_class="is-big" if big else "",
        )
        if OUT_HTML:
            (ROOT / out).write_text(html_doc)
        seed_pages.append({"slug": out[:-5], "title": d["title"], "section": d["section"], "side": d["side"],
                           "h1": d["h1"], "content": content, "date_maj": d["date_maj"], "cassini": flags["cassini"]})
        index.append({"u": out, "t": BeautifulSoup(d["h1"], "lxml").get_text(" ", strip=True),
                      "s": d["section"] or "", "x": plain_text(content, 600)})

    # Agenda (contenu fait main) + accueil (le site d'origine redirige l'accueil vers l'agenda)
    soup = load("agenda.html")
    d = extract(soup)
    agenda_main = (PARTIALS / "agenda-main.html").read_text()
    for out in ("agenda.html", "index.html"):
        doc = page_html(tpl, title=d["title"], nav_html=render_nav(nav, d["section"]),
                        side_html=render_side(d["side"], news_html), main_html=agenda_main,
                        body_class="is-agenda" + (" is-home" if out == "index.html" else ""))
        if OUT_HTML:
            (ROOT / out).write_text(doc)
    index.insert(0, {"u": "agenda.html", "t": "Agenda", "s": "L'association", "x": plain_text(agenda_main, 600)})

    import gzip
    seed = {"nav": nav, "agenda": {"title": d["title"], "section": d["section"], "side": d["side"]}, "pages": seed_pages}
    with gzip.open(ROOT / "server" / "seed" / "pages.json.gz", "wt", encoding="utf-8") as fh:
        json.dump(seed, fh, ensure_ascii=False)
    # (l'index de recherche est désormais produit par le serveur à partir de la base)
    print(f"{len(index) + 1} pages générées")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import catalog  # extraction du catalogue + correction d'encodage
    catalog.main()


if __name__ == "__main__":
    build()
