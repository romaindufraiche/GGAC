"use strict";
const fs = require("fs");
const path = require("path");
const db = require("./db");

const LAYOUT = fs.readFileSync(path.join(__dirname, "views", "layout.html"), "utf8");
const NEWS_TAIL = ""; // le bloc Actualités est généré depuis l'agenda

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "");

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Date SQL (Date ou 'YYYY-MM-DD') -> objet {y,m,d,wd} sans décalage de fuseau */
function parts(v) {
  const s = v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd, iso: s };
}
const longDate = (v) => {
  const p = parts(v);
  return `${cap(JOURS[p.wd])} ${p.d} ${MOIS[p.m - 1]} ${p.y}`;
};
/** « Du samedi 7 au dimanche 8 novembre 2026 » (ou « Le samedi 7 novembre 2026 ») */
function rangeLabel(a, b) {
  const s = parts(a), e = parts(b);
  if (s.iso === e.iso) return `Le ${JOURS[s.wd]} ${s.d} ${MOIS[s.m - 1]} ${s.y}`;
  const left = s.y !== e.y ? `${JOURS[s.wd]} ${s.d} ${MOIS[s.m - 1]} ${s.y}` : s.m !== e.m ? `${JOURS[s.wd]} ${s.d} ${MOIS[s.m - 1]}` : `${JOURS[s.wd]} ${s.d}`;
  return `Du ${left} au ${JOURS[e.wd]} ${e.d} ${MOIS[e.m - 1]} ${e.y}`;
}
function nodeLabel(a, b) {
  const s = parts(a), e = parts(b);
  return s.iso === e.iso ? `${s.d}` : `${s.d}–${e.d}`;
}
const todayIso = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function stampNow() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const p = (n) => String(n).padStart(2, "0");
  return { d, txt: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}h${p(d.getMinutes())}` };
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------
function renderNav(nav, active) {
  return nav
    .map((item) => {
      if (!item.children) {
        const cls = /membre/i.test(item.label) ? "menu__member" : "";
        return `<li class="${cls}"><a class="menu__top" href="${esc(item.href)}">${esc(item.label)}</a></li>`;
      }
      const wide = item.children.length > 5 && item.children.some((c) => c.children && c.children.length > 20);
      let dict = "";
      const col = [];
      for (const c of item.children) {
        if (c.children && c.children.length > 20 && wide) {
          dict = `<div class="sub__dict"><a class="sub__dict-title" href="${esc(c.href)}">${esc(c.label)}</a><ul class="dict">${c.children
            .map((x) => `<li><a href="${esc(x.href)}">${esc(x.label)}</a></li>`)
            .join("")}</ul></div>`;
        } else if (c.children) {
          col.push(`<li class="has-fly"><a href="${esc(c.href)}">${esc(c.label)}</a><ul class="fly">${c.children
            .map((x) => `<li><a href="${esc(x.href)}">${esc(x.label)}</a></li>`)
            .join("")}</ul></li>`);
        } else col.push(`<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`);
      }
      return `<li class="has-sub${active && item.label === active ? " is-active" : ""}"><button class="menu__top" aria-expanded="false">${esc(item.label)}</button><div class="${dict ? "sub sub--wide" : "sub"}"><ul class="sub__col">${col.join("")}</ul>${dict}</div></li>`;
    })
    .join("\n");
}

function renderSide(side, currentSlug, newsHtml) {
  const out = [];
  if (side && side.items) {
    const lis = side.items.map((it) => {
      const lvl = it.level ? ' class="lvl1"' : "";
      const isCur = !it.href || (currentSlug && it.href.replace(/^\//, "") === `${currentSlug}.html`);
      return isCur
        ? `<li${lvl}><span class="is-current" aria-current="page">${esc(it.label)}</span></li>`
        : `<li${lvl}><a href="${esc(it.href)}">${esc(it.label)}</a></li>`;
    });
    out.push(`<section class="side__block${lis.length > 14 ? " side__block--long" : ""}"><h2 class="side__title">${esc(side.title)}</h2><ul class="side__menu">${lis.join("")}</ul></section>`);
  }
  out.push(newsHtml);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------
async function agendaData() {
  const today = todayIso();
  const [ev, pe, nPerm, nNews, intro, dm] = await Promise.all([
    db.q("SELECT * FROM events WHERE published AND end_date >= $1 ORDER BY start_date, id", [today]),
    db.q("SELECT * FROM permanences WHERE date >= $1 ORDER BY date", [today]),
    db.getSetting("permanences_count", 7),
    db.getSetting("news_events_count", 5),
    db.getSetting("agenda_intro", ""),
    db.getSetting("agenda_date_maj", ""),
  ]);
  return { events: ev.rows, perms: pe.rows, nPerm, nNews, intro, dateMaj: dm };
}

function renderNews(a) {
  const items = [];
  if (a.perms[0]) {
    items.push(`<article class="news__item"><h3>PROCHAINE PERMANENCE</h3><p>${esc(longDate(a.perms[0].date))} ${esc(a.perms[0].hours)} au siège de l'association.</p></article>`);
  }
  a.events.slice(0, a.nNews).forEach((e) => {
    items.push(`<article class="news__item"><h3><a href="/agenda.html#ev-${e.id}">${e.title}</a></h3><p>${esc(stripTags(e.subtitle).replace(/ de \d{1,2}h\d{2} à \d{1,2}h\d{2}/, ""))}</p></article>`);
  });
  return `<section class="side__block side__news">
        <h2 class="side__title">Actualités</h2>
        <div class="news" tabindex="0">
          <div class="news__track">${items.join("\n")}</div>
        </div>
      </section>`;
}

const VINE = `<svg class="vine vine--content" viewBox="0 0 260 240" aria-hidden="true"><use href="#vine" /></svg>`;
const FLOURISH = `<svg class="title__flourish" viewBox="0 0 320 30" aria-hidden="true"><path d="M4 18 C 60 4, 110 28, 160 16 S 260 4, 316 16" /><path d="M150 16 c 6 -10 14 -10 10 0 c -4 8 -14 6 -10 0" /></svg>`;
const pageFoot = (dateMaj) => `<div class="pagefoot">
  <a class="totop" href="#haut" title="Retour en haut de la page" aria-label="Retour en haut de la page">
    <svg viewBox="0 0 80 84" aria-hidden="true"><path class="totop__trunk" d="M40 82 V48 M40 60 L28 48 M40 56 L53 44 M40 48 L40 36" />
    <g class="totop__leaves"><circle cx="40" cy="26" r="14" /><circle cx="24" cy="36" r="11" /><circle cx="56" cy="34" r="12" /><circle cx="28" cy="20" r="9" /><circle cx="52" cy="18" r="10" /></g></svg>
  </a>
  <p class="date_maj">${esc(dateMaj)}</p>
</div>`;

function renderAgendaMain(a) {
  const intro = String(a.intro).replace(/<p(\s|>)/g, '<p class="reveal"$1');
  const stamps = a.perms.slice(0, a.nPerm).map((p) => {
    const d = parts(p.date);
    return `<li class="stamp${d.wd === 6 ? " stamp--sat" : ""}"><span class="stamp__day">${cap(JOURS[d.wd])}</span><span class="stamp__num">${d.d}</span><span class="stamp__month">${MOIS[d.m - 1]} ${d.y}</span><span class="stamp__hours">${esc(p.hours)}</span></li>`;
  });
  const events = a.events.map((e) => {
    const poster = e.image
      ? `<a class="event__poster" href="${esc(e.image)}" title="${esc(stripTags(e.title))}"><img src="${esc(e.image)}" alt="" loading="lazy" /><span class="event__zoom">Agrandir</span></a>`
      : "";
    return `<article class="event${e.image ? "" : " event--text"}" id="ev-${e.id}">
            <div class="event__node" aria-hidden="true"><span class="event__num">${nodeLabel(e.start_date, e.end_date)}</span></div>
            <div class="event__card">${poster}
              <div class="event__body">
                <h3 class="event__title">${e.title}</h3>
                <p class="event__meta">${esc(stripTags(e.subtitle))}</p>
                ${/^\s*<(p|ul|div|h\d)/i.test(e.body) ? e.body : `<p>${e.body}</p>`}
              </div>
            </div>
          </article>`;
  });
  return `${VINE}
      <h1 class="title"><span class="title__text" data-split>Agenda</span>${FLOURISH}</h1>
      <section class="block permanences">
        <h2 class="block__title reveal">Permanences :</h2>
        <div class="prose">${intro}</div>
        <ol class="stamps" aria-label="Permanences">${stamps.join("")}</ol>
      </section>
      <section class="block manifestations">
        <h2 class="block__title reveal">Manifestations :</h2>
        <div class="timeline">
          <svg class="timeline__branch" aria-hidden="true" preserveAspectRatio="none"><path class="timeline__path" /></svg>
          ${events.join("\n")}
        </div>
      </section>
      ${pageFoot(a.dateMaj)}`;
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------
async function chrome() {
  const [nav, visitors, since, updated] = await Promise.all([
    db.getSetting("nav", []),
    db.getSetting("visitors", 0),
    db.getSetting("visitors_since", ""),
    db.getSetting("site_updated", ""),
  ]);
  const [y, m, d] = String(updated).split("-");
  return { nav, visitors: +visitors, since, maj: updated ? `${d}/${m}/${y.slice(2)}` : "" };
}

function fill(c, { title, active, side, main, bodyClass = "", extraBody = "" }) {
  return LAYOUT.replace("{{TITLE}}", esc(title))
    .replace("{{MAJ}}", esc(c.maj))
    .replace("{{VISITORS_RAW}}", String(c.visitors))
    .replace("{{VISITORS}}", c.visitors.toLocaleString("fr-FR").replace(/ | /g, " "))
    .replace("{{SINCE}}", esc(c.since))
    .replace("{{NAV}}", renderNav(c.nav, active))
    .replace("{{SIDE}}", side)
    .replace("{{MAIN}}", main)
    .replace("{{EXTRA_HEAD}}", "")
    .replace("{{EXTRA_BODY}}", extraBody)
    .replace("{{BODY_CLASS}}", bodyClass);
}

async function renderAgenda({ home = false } = {}) {
  const [c, a, meta] = await Promise.all([chrome(), agendaData(), db.getSetting("agenda_meta", {})]);
  return fill(c, {
    title: meta.title || "Agenda - Groupe des Généalogistes Amateurs du Cambrésis",
    active: meta.section,
    side: renderSide(meta.side, "agenda", renderNews(a)),
    main: renderAgendaMain(a),
    bodyClass: "is-agenda" + (home ? " is-home" : ""),
  });
}

async function renderPage(slug, { preview = null } = {}) {
  const r = await db.q("SELECT * FROM pages WHERE slug=$1", [slug]);
  let p = r.rows[0];
  if (!p) return null;
  if (preview) p = { ...p, ...preview };
  else if (!p.published) return null;
  const [c, a] = await Promise.all([chrome(), agendaData()]);
  const main = `${VINE}
<h1 class="title"><span class="title__text" data-split>${p.h1}</span>${FLOURISH}</h1>
<div class="prose">
${p.content}
</div>
${pageFoot(p.date_maj)}`;
  return fill(c, {
    title: p.title,
    active: p.section,
    side: renderSide(p.side, slug, renderNews(a)),
    main,
    bodyClass: p.content.length > 150000 ? "is-big" : "",
    extraBody: p.cassini ? '<script src="https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/openseadragon.min.js" defer></script>' : "",
  });
}

/** Page libre dans le gabarit du site (panier, commande, espace membre…) */
async function renderShell({ title, h1, main, active = null, side = null, slug = "", bodyClass = "", dateMaj = "" }) {
  const [c, a] = await Promise.all([chrome(), agendaData()]);
  const body = `${VINE}
<h1 class="title"><span class="title__text" data-split>${h1}</span>${FLOURISH}</h1>
${main}
${pageFoot(dateMaj)}`;
  return fill(c, { title, active, side: renderSide(side, slug, renderNews(a)), main: body, bodyClass });
}

// Index de recherche (mis en cache, invalidé à chaque modification)
let searchCache = null;
async function searchIndex() {
  if (searchCache) return searchCache;
  const r = await db.q("SELECT slug, h1, section, left(content, 20000) AS c FROM pages WHERE published ORDER BY slug");
  const idx = r.rows.map((p) => ({
    u: `${p.slug}.html`,
    t: stripTags(p.h1).replace(/\s+/g, " ").trim(),
    s: p.section || "",
    x: stripTags(p.c).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 600),
  }));
  idx.unshift({ u: "agenda.html", t: "Agenda", s: "L'association", x: stripTags(await db.getSetting("agenda_intro", "")).replace(/\s+/g, " ").slice(0, 600) });
  searchCache = JSON.stringify(idx);
  return searchCache;
}
const invalidate = () => { searchCache = null; };

module.exports = { renderAgenda, renderPage, renderShell, searchIndex, invalidate, esc, stripTags, longDate, rangeLabel, nodeLabel, parts, todayIso, stampNow, MOIS, JOURS };
