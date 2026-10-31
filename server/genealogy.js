"use strict";
/* Généalogie — espace membre : recherche, fiches, arbres d'ascendance et de descendance */
const express = require("express");
const db = require("./db");
const R = require("./render");
const G = require("./gedcom");
const S = require("./gen-store");
const { currentMember } = require("./shop");

const router = express.Router();
const { esc } = R;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const BASE = "/genealogie";

// ---------------------------------------------------------------------------
// Accès : membres connectés (ou équipe du site)
// ---------------------------------------------------------------------------
router.use(BASE, wrap(async (req, res, next) => {
  const m = await currentMember(req);
  if (!m) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "connexion requise" });
    return res.redirect(`/espace-membre.html?lire=1&retour=${encodeURIComponent(req.originalUrl)}`);
  }
  req.member = m;
  req.hideLiving = await db.getSetting("gen_hide_living", true);
  res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex");
  next();
}));

// ---------------------------------------------------------------------------
// Affichage d'une personne (avec protection des vivants)
// ---------------------------------------------------------------------------
const masked = (req, p) => req.hideLiving && p && p.living;
function fullName(req, p, { surnameFirst = false } = {}) {
  if (!p) return "";
  const sur = (p.surname || "").toUpperCase();
  const giv = masked(req, p) ? "Vivant" : p.given || "…";
  return (surnameFirst ? `${sur}${sur ? ", " : ""}${giv}` : `${giv} ${sur}`).trim() + (p.suffix && !masked(req, p) ? ` ${p.suffix}` : "");
}
function life(req, p) {
  if (!p || masked(req, p)) return "";
  const b = p.birth_year || p.chr_year, d = p.death_year || p.buri_year;
  return b || d ? `${b || "?"} – ${d || ""}`.trim() : "";
}
/** Données compactes pour les arbres (JSON) */
function compact(req, p) {
  if (!p) return null;
  const hide = masked(req, p);
  return {
    id: p.id, sex: p.sex, name: fullName(req, p), given: hide ? "Vivant" : p.given, surname: p.surname, living: hide,
    b: hide ? "" : G.frDate(p.birth_date || p.chr_date), bp: hide ? "" : p.birth_place || p.chr_place,
    d: hide ? "" : G.frDate(p.death_date || p.buri_date), dp: hide ? "" : p.death_place || p.buri_place,
    years: life(req, p), famc: p.famc,
  };
}
const personUrl = (tree, id) => `${BASE}/${encodeURIComponent(tree)}/${encodeURIComponent(id)}`;
const link = (req, p, opt) => (p ? `<a class="gp" href="${personUrl(p.tree, p.id)}" data-sex="${esc(p.sex)}">${esc(fullName(req, p, opt))}</a>` : "");

async function trees() {
  return (await db.q("SELECT t.*, (SELECT count(*) FROM gen_people p WHERE p.tree=t.id)::int AS n FROM gen_trees t ORDER BY t.name")).rows;
}

const SIDE = {
  title: "Généalogie",
  items: [
    { label: "Recherche", href: `${BASE}`, level: 0 },
    { label: "Recherche familles", href: `${BASE}/familles`, level: 0 },
    { label: "Patronymes", href: `${BASE}/patronymes`, level: 0 },
    { label: "Espace membre", href: "/espace-membre.html", level: 0 },
  ],
};
async function page(res, { title, h1, main, slug = "", extraHead = "", tab = "" }) {
  const tabs = `<nav class="gen-tabs">${SIDE.items.map((it) => `<a href="${it.href}"${it.href === tab ? ' class="is-on"' : ""}>${esc(it.label)}</a>`).join("")}</nav>`;
  const html = await R.renderShell({
    title: `${title} - Généalogie - G.G.A.C.`, h1, main: `${extraHead}${tabs}<div class="gen">${main}</div>`, side: null, slug, bodyClass: "is-gen",
  });
  res.type("html").send(html.replace("</head>", '<link rel="stylesheet" href="/assets/css/genealogy.css" />\n</head>').replace("</body>", '<script src="/assets/js/genealogy.js" defer></script>\n</body>'));
}

// ---------------------------------------------------------------------------
// Recherche avancée (personnes)
// ---------------------------------------------------------------------------
const TXT_OPS = [["contient", "contient"], ["egal", "égal"], ["commence", "commence par"], ["finit", "finit par"], ["existe", "existe"], ["nexistepas", "n'existe pas"]];
const YEAR_OPS = [["egal", "égal"], ["pm2", "+/- 2 ans"], ["pm5", "+/- 5 ans"], ["pm10", "+/- 10 ans"], ["inf", "avant"], ["sup", "après"], ["existe", "existe"], ["nexistepas", "n'existe pas"]];
const FIELDS = [
  { k: "given", label: "Prénom", col: "p.n_given", type: "txt" },
  { k: "surname", label: "Nom", col: "p.n_surname", type: "txt" },
  { k: "pid", label: "ID personne", col: "lower(p.id)", type: "txt", def: "egal", raw: true },
  { k: "sex", label: "Genre", type: "sex" },
  { sep: true },
  { k: "bplace", label: "Lieu de naissance", col: "p.n_birth_place", type: "txt", priv: true },
  { k: "byear", label: "Année de naissance", col: "p.birth_year", type: "year", priv: true },
  { k: "cplace", label: "Lieu de baptême", col: "p.n_chr_place", type: "txt", priv: true },
  { k: "cyear", label: "Année de baptême", col: "p.chr_year", type: "year", priv: true },
  { k: "dplace", label: "Lieu de décès", col: "p.n_death_place", type: "txt", priv: true },
  { k: "dyear", label: "Année de décès", col: "p.death_year", type: "year", priv: true },
  { k: "uplace", label: "Lieu de la sépulture", col: "p.n_buri_place", type: "txt", priv: true },
  { k: "uyear", label: "Année de la sépulture", col: "p.buri_year", type: "year", priv: true },
  { k: "crem", label: "Incinéré", type: "check", priv: true },
  { sep: true },
  { k: "spouse", label: "Nom de famille du conjoint", type: "txt", spouse: true },
  { sep: true },
  { k: "other", label: "Autre nom", col: "p.n_alt", type: "txt" },
];

function textCond(col, op, val, params) {
  const v = G.norm(val);
  if (op === "existe") return `${col} <> ''`;
  if (op === "nexistepas") return `${col} = ''`;
  if (!v) return null;
  params.push(op === "egal" ? v : op === "commence" ? `${v}%` : op === "finit" ? `%${v}` : `%${v}%`);
  return op === "egal" ? `${col} = $${params.length}` : `${col} LIKE $${params.length}`;
}
function yearCond(col, op, val, params) {
  if (op === "existe") return `${col} IS NOT NULL`;
  if (op === "nexistepas") return `${col} IS NULL`;
  const y = parseInt(val, 10);
  if (!y) return null;
  params.push(y);
  const n = `$${params.length}`;
  if (op === "inf") return `${col} < ${n}`;
  if (op === "sup") return `${col} > ${n}`;
  const pm = { pm2: 2, pm5: 5, pm10: 10 }[op];
  return pm ? `${col} BETWEEN ${n} - ${pm} AND ${n} + ${pm}` : `${col} = ${n}`;
}

function searchForm(q, treesList) {
  const sel = (name, opts, val) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const rows = [];
  rows.push(`<div class="sf-row"><label>Arbre | Branche :</label><div class="sf-ctl">
    <select name="tree"><option value="">Tous les arbres</option>${treesList.map((t) => `<option value="${esc(t.id)}"${q.tree === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
    <select name="branch"><option value="">Toutes les branches</option>${(q._branches || []).map((b) => `<option${q.branch === b ? " selected" : ""}>${esc(b)}</option>`).join("")}</select></div></div>`);
  for (const f of FIELDS) {
    if (f.sep) { rows.push('<div class="sf-sep"></div>'); continue; }
    let ctl;
    if (f.type === "txt") ctl = `${sel(`${f.k}_op`, TXT_OPS, q[`${f.k}_op`] || f.def || "contient")}<input type="text" name="${f.k}" value="${esc(q[f.k] || "")}">`;
    else if (f.type === "year") ctl = `${sel(`${f.k}_op`, YEAR_OPS, q[`${f.k}_op`] || "egal")}<input type="text" inputmode="numeric" name="${f.k}" value="${esc(q[f.k] || "")}" maxlength="4">`;
    else if (f.type === "sex") ctl = `${sel("sex_op", [["egal", "égal"], ["different", "différent de"]], q.sex_op)}${sel("sex", [["", ""], ["M", "Masculin"], ["F", "Féminin"], ["U", "Inconnu"]], q.sex || "")}`;
    else ctl = `<input type="checkbox" name="${f.k}" value="1"${q[f.k] ? " checked" : ""}>`;
    rows.push(`<div class="sf-row"><label for="sf-${f.k}">${esc(f.label)} :</label><div class="sf-ctl" id="sf-${f.k}">${ctl}</div></div>`);
  }
  return `<form class="sf" method="get" action="${BASE}" data-gen-search>
  <div class="sf-grid">${rows.join("")}</div>
  <aside class="sf-side">
    <div class="sf-opt"><label>Lien :</label>${sel("link", [["et", "ET"], ["ou", "OU"]], q.link || "et")}</div>
    <div class="sf-opt"><label>Résultats par page :</label>${sel("per", [["25", "25"], ["50", "50"], ["100", "100"], ["200", "200"]], q.per || "50")}</div>
    <label class="sf-check"><input type="checkbox" name="showdeath" value="1"${q.showdeath ? " checked" : ""}> Afficher l'information sur le décès ou l'inhumation</label>
    <label class="sf-check"><input type="checkbox" name="showspouse" value="1"${q.showspouse ? " checked" : ""}> Afficher le conjoint(e) (la personne sera répétée pour chaque conjoint)</label>
    <div class="sf-btns"><button class="btn-ink" name="go" value="1">Chercher</button><a class="btn-ink btn-ink--ghost" href="${BASE}">Vider</a></div>
    <a class="sf-link" href="${BASE}/familles">» Recherche familles</a>
    <a class="sf-link" href="${BASE}/patronymes">» Patronymes</a>
  </aside>
</form>`;
}

router.get(BASE, wrap(async (req, res) => {
  const q = req.query;
  const list = await trees();
  if (!list.length) {
    return page(res, { title: "Recherche", h1: "Recherche généalogique", main: `<div class="gen-empty"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 60V34M32 44l-12-10M32 40l12-12M20 34a10 10 0 1 1 0-1M44 28a9 9 0 1 1 0-1M32 26a12 12 0 1 1 0-1"/></svg><p>Les arbres généalogiques de l'association seront bientôt consultables ici.</p></div>` });
  }
  if (q.tree) q._branches = (await db.q("SELECT DISTINCT branch FROM gen_people WHERE tree=$1 AND branch<>'' ORDER BY 1", [q.tree])).rows.map((r) => r.branch);
  let results = "";
  if (q.go) {
    const params = [];
    const conds = [];
    let usesPrivate = false;
    for (const f of FIELDS) {
      if (f.sep) continue;
      let c = null;
      if (f.type === "txt" && !f.spouse) c = textCond(f.col, q[`${f.k}_op`] || f.def || "contient", q[f.k], params);
      if (f.type === "year") c = yearCond(f.col, q[`${f.k}_op`] || "egal", q[f.k], params);
      if (f.type === "sex" && q.sex) { params.push(q.sex === "U" ? "" : q.sex); c = q.sex_op === "different" ? `p.sex <> $${params.length}` : `p.sex = $${params.length}`; }
      if (f.type === "check" && q[f.k]) c = "p.crem";
      if (f.spouse) {
        const sc = textCond("s.n_surname", q.spouse_op || "contient", q.spouse, params);
        if (sc) c = `EXISTS (SELECT 1 FROM gen_families sf JOIN gen_people s ON s.tree=sf.tree AND s.id = CASE WHEN sf.husband=p.id THEN sf.wife ELSE sf.husband END WHERE sf.tree=p.tree AND (sf.husband=p.id OR sf.wife=p.id) AND ${sc})`;
      }
      if (c) { conds.push(c); if (f.priv) usesPrivate = true; }
    }
    const where = [];
    if (q.tree) { params.push(q.tree); where.push(`p.tree = $${params.length}`); }
    if (q.branch) { params.push(q.branch); where.push(`p.branch = $${params.length}`); }
    if (conds.length) where.push(`(${conds.join(q.link === "ou" ? " OR " : " AND ")})`);
    if (usesPrivate && req.hideLiving) where.push("NOT p.living");
    if (!conds.length) {
      results = `<p class="gen-note">Indiquez au moins un critère de recherche.</p>`;
    } else {
      const per = [25, 50, 100, 200].includes(+q.per) ? +q.per : 50;
      const pg = Math.max(1, parseInt(q.page, 10) || 1);
      const w = where.join(" AND ");
      const total = (await db.q(`SELECT count(*)::int n FROM gen_people p WHERE ${w}`, params)).rows[0].n;
      const r = await db.q(`SELECT p.* FROM gen_people p WHERE ${w} ORDER BY p.n_surname, p.n_given, p.birth_sort NULLS LAST LIMIT ${per} OFFSET ${(pg - 1) * per}`, params);
      let spouses = new Map();
      if (q.showspouse && r.rows.length) {
        const fr = await db.q(`SELECT f.*, s.* , f.id AS fid, s.id AS sid FROM gen_families f JOIN gen_people s ON s.tree=f.tree AND s.id = CASE WHEN f.husband = ANY($2) THEN f.wife ELSE f.husband END
          WHERE f.tree = ANY($1) AND (f.husband = ANY($2) OR f.wife = ANY($2))`, [[...new Set(r.rows.map((x) => x.tree))], r.rows.map((x) => x.id)]);
        for (const row of fr.rows) {
          const owner = row.husband === row.sid ? row.wife : row.husband;
          const key = `${row.tree}|${owner}`;
          (spouses.get(key) || spouses.set(key, []).get(key)).push({ ...row, id: row.sid });
        }
      }
      const treeName = Object.fromEntries(list.map((t) => [t.id, t.name]));
      const qs = (extra) => { const u = new URLSearchParams(Object.entries(q).filter(([k]) => !k.startsWith("_"))); for (const [k, v] of Object.entries(extra)) u.set(k, v); return `?${u}`; };
      const pages = Math.ceil(total / per);
      const rowsHtml = [];
      let n = (pg - 1) * per;
      for (const p of r.rows) {
        const sps = q.showspouse ? spouses.get(`${p.tree}|${p.id}`) || [null] : [null];
        for (const s of sps) {
          n++;
          const hide = masked(req, p);
          rowsHtml.push(`<tr style="--i:${Math.min(n - (pg - 1) * per, 30)}"><td class="num">${n}</td>
            <td>${link(req, p, { surnameFirst: true })}</td><td class="muted">${esc(p.id)}</td>
            <td>${hide ? "" : esc(G.frDate(p.birth_date || p.chr_date))}</td><td>${hide ? "" : esc(p.birth_place || p.chr_place)}</td>
            ${q.showdeath ? `<td>${hide ? "" : esc(G.frDate(p.death_date || p.buri_date))}</td><td>${hide ? "" : esc(p.death_place || p.buri_place)}</td>` : ""}
            ${q.showspouse ? `<td>${s ? link(req, { ...s, tree: p.tree }, { surnameFirst: true }) : ""}</td>` : ""}
            ${list.length > 1 ? `<td class="muted">${esc(treeName[p.tree] || p.tree)}</td>` : ""}</tr>`);
        }
      }
      results = `<section class="gen-results" id="resultats">
        <p class="gen-count"><b>${total.toLocaleString("fr-FR")}</b> personne${total > 1 ? "s" : ""} trouvée${total > 1 ? "s" : ""}${pages > 1 ? ` — page ${pg} sur ${pages}` : ""}</p>
        ${total ? `<div class="table-wrap"><table class="gen-table"><thead><tr><th>#</th><th>Nom, prénom</th><th>ID</th><th>Naissance / baptême</th><th>Lieu</th>
          ${q.showdeath ? "<th>Décès / inhumation</th><th>Lieu</th>" : ""}${q.showspouse ? "<th>Conjoint</th>" : ""}${list.length > 1 ? "<th>Arbre</th>" : ""}</tr></thead>
          <tbody>${rowsHtml.join("")}</tbody></table></div>` : ""}
        ${pages > 1 ? `<nav class="gen-pager">${pg > 1 ? `<a href="${qs({ page: pg - 1 })}#resultats">‹ Précédente</a>` : ""}${Array.from({ length: Math.min(pages, 12) }, (_, i) => {
          const k = pages <= 12 ? i + 1 : Math.min(Math.max(1, pg - 5), pages - 11) + i;
          return k === pg ? `<span>${k}</span>` : `<a href="${qs({ page: k })}#resultats">${k}</a>`;
        }).join("")}${pg < pages ? `<a href="${qs({ page: pg + 1 })}#resultats">Suivante ›</a>` : ""}</nav>` : ""}
      </section>`;
    }
  }
  await page(res, { title: "Recherche", h1: "Recherche généalogique", main: searchForm(q, list) + results, tab: BASE });
}));

// ---------------------------------------------------------------------------
// Recherche familles
// ---------------------------------------------------------------------------
router.get(`${BASE}/familles`, wrap(async (req, res) => {
  const q = req.query;
  const list = await trees();
  const sel = (name, opts, val) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const row = (k, label, ops, def = "contient") => `<div class="sf-row"><label>${label} :</label><div class="sf-ctl">${sel(`${k}_op`, ops, q[`${k}_op`] || def)}<input type="text" name="${k}" value="${esc(q[k] || "")}"></div></div>`;
  const form = `<form class="sf" method="get" action="${BASE}/familles">
    <div class="sf-grid">
      <div class="sf-row"><label>Arbre :</label><div class="sf-ctl"><select name="tree"><option value="">Tous les arbres</option>${list.map((t) => `<option value="${esc(t.id)}"${q.tree === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div></div>
      ${row("hgiven", "Prénom du père / mari", TXT_OPS)}${row("hsurname", "Nom du père / mari", TXT_OPS)}
      <div class="sf-sep"></div>
      ${row("wgiven", "Prénom de la mère / épouse", TXT_OPS)}${row("wsurname", "Nom de la mère / épouse", TXT_OPS)}
      <div class="sf-sep"></div>
      ${row("mplace", "Lieu du mariage", TXT_OPS)}${row("myear", "Année du mariage", YEAR_OPS, "egal")}
      ${row("fid", "ID famille", TXT_OPS, "egal")}
    </div>
    <aside class="sf-side">
      <div class="sf-opt"><label>Lien :</label>${sel("link", [["et", "ET"], ["ou", "OU"]], q.link || "et")}</div>
      <div class="sf-btns"><button class="btn-ink" name="go" value="1">Chercher</button><a class="btn-ink btn-ink--ghost" href="${BASE}/familles">Vider</a></div>
      <a class="sf-link" href="${BASE}">» Recherche</a>
    </aside></form>`;
  let results = "";
  if (q.go) {
    const params = [];
    const c = [
      textCond("h.n_given", q.hgiven_op || "contient", q.hgiven, params), textCond("h.n_surname", q.hsurname_op || "contient", q.hsurname, params),
      textCond("w.n_given", q.wgiven_op || "contient", q.wgiven, params), textCond("w.n_surname", q.wsurname_op || "contient", q.wsurname, params),
      textCond("lower(f.marr_place)", q.mplace_op || "contient", q.mplace, params), yearCond("f.marr_year", q.myear_op || "egal", q.myear, params),
      q.fid ? (params.push(String(q.fid).toUpperCase()), `upper(f.id) = $${params.length}`) : null,
    ].filter(Boolean);
    if (!c.length) results = `<p class="gen-note">Indiquez au moins un critère de recherche.</p>`;
    else {
      const where = [`(${c.join(q.link === "ou" ? " OR " : " AND ")})`];
      if (q.tree) { params.push(q.tree); where.push(`f.tree = $${params.length}`); }
      const r = await db.q(`SELECT f.*, row_to_json(h) AS h, row_to_json(w) AS w FROM gen_families f
        LEFT JOIN gen_people h ON h.tree=f.tree AND h.id=f.husband LEFT JOIN gen_people w ON w.tree=f.tree AND w.id=f.wife
        WHERE ${where.join(" AND ")} ORDER BY h.n_surname NULLS LAST, w.n_surname LIMIT 500`, params);
      results = `<section class="gen-results" id="resultats"><p class="gen-count"><b>${r.rows.length}</b> famille${r.rows.length > 1 ? "s" : ""}${r.rows.length === 500 ? " (500 premières)" : ""}</p>
        ${r.rows.length ? `<div class="table-wrap"><table class="gen-table"><thead><tr><th>#</th><th>Père / mari</th><th>Mère / épouse</th><th>Mariage</th><th>Lieu</th><th>Enfants</th></tr></thead><tbody>${r.rows
          .map((f, i) => {
            const hide = (f.h && masked(req, f.h)) || (f.w && masked(req, f.w));
            return `<tr style="--i:${Math.min(i, 30)}"><td class="num">${i + 1}</td><td>${f.h ? link(req, f.h, { surnameFirst: true }) : "—"}</td><td>${f.w ? link(req, f.w, { surnameFirst: true }) : "—"}</td>
              <td>${hide ? "" : esc(G.frDate(f.marr_date))}</td><td>${hide ? "" : esc(f.marr_place)}</td><td>${f.children.length || ""}</td></tr>`;
          }).join("")}</tbody></table></div>` : ""}</section>`;
    }
  }
  await page(res, { title: "Recherche familles", h1: "Recherche familles", main: form + results, tab: `${BASE}/familles` });
}));

// ---------------------------------------------------------------------------
// Patronymes
// ---------------------------------------------------------------------------
router.get(`${BASE}/patronymes`, wrap(async (req, res) => {
  const letter = String(req.query.l || "").toUpperCase().slice(0, 1);
  const r = await db.q(`SELECT upper(left(n_surname,1)) AS l, count(DISTINCT n_surname)::int n FROM gen_people WHERE n_surname<>'' GROUP BY 1 ORDER BY 1`);
  const letters = r.rows.filter((x) => /[A-Z]/.test(x.l));
  const cur = letter || letters[0]?.l || "A";
  const names = (await db.q(`SELECT min(surname) AS s, n_surname, count(*)::int n FROM gen_people WHERE upper(left(n_surname,1))=$1 GROUP BY n_surname ORDER BY n_surname`, [cur])).rows;
  const main = letters.length ? `<nav class="gen-letters">${letters.map((x) => `<a href="?l=${x.l}" class="${x.l === cur ? "is-on" : ""}" title="${x.n} patronymes">${x.l}</a>`).join("")}</nav>
    <div class="gen-surnames">${names.map((n, i) => `<a href="${BASE}?go=1&surname_op=egal&surname=${encodeURIComponent(n.s)}" style="--i:${Math.min(i, 40)}"><span>${esc((n.s || "").toUpperCase())}</span><b>${n.n}</b></a>`).join("")}</div>`
    : `<p class="gen-note">Aucun patronyme pour l'instant.</p>`;
  await page(res, { title: "Patronymes", h1: "Patronymes", main, tab: `${BASE}/patronymes` });
}));

// ---------------------------------------------------------------------------
// Fiche individuelle
// ---------------------------------------------------------------------------
router.get(`${BASE}/:tree/:id`, wrap(async (req, res, next) => {
  const d = await S.personDetail(req.params.tree, req.params.id);
  if (!d) return next();
  const { p, parentsFam, fams, people } = d;
  const hide = masked(req, p);
  const t = (await db.q("SELECT name FROM gen_trees WHERE id=$1", [p.tree])).rows[0];
  const ev = (label, date, place) => (date || place ? `<tr><th>${label}</th><td>${esc(G.frDate(date))}</td><td>${esc(place)}</td></tr>` : "");
  const P = (id) => (id ? { ...people.get(id), tree: p.tree } : null);
  const famBlock = (f, role) => {
    const spouse = P(f.husband === p.id ? f.wife : f.husband);
    const kids = f.children.map(P).filter((x) => x && x.id);
    return `<section class="gen-fam" style="--i:${role}">
      <h3>${spouse?.id ? `${p.sex === "F" ? "Époux" : p.sex === "M" ? "Épouse" : "Conjoint"} : ${link(req, spouse)} <small>${esc(life(req, spouse))}</small>` : "Conjoint inconnu"}</h3>
      ${!hide && (f.marr_date || f.marr_place) ? `<p class="gen-marr">Mariage : ${esc(G.frDate(f.marr_date))}${f.marr_place ? ` — ${esc(f.marr_place)}` : ""}${f.div ? " (divorce)" : ""}</p>` : ""}
      ${kids.length ? `<ol class="gen-kids">${kids.map((k) => `<li>${link(req, k)} <small>${esc(life(req, k))}</small></li>`).join("")}</ol>` : ""}
      <p class="gen-id muted">Famille ${esc(f.id)}</p>
    </section>`;
  };
  const father = parentsFam && P(parentsFam.husband), mother = parentsFam && P(parentsFam.wife);
  const siblings = parentsFam ? parentsFam.children.filter((c) => c !== p.id).map(P).filter((x) => x && x.id) : [];
  const main = `<div class="gen-person">
    <header class="gen-hero" data-sex="${esc(p.sex)}">
      <div class="gen-badge">${esc((p.surname || "?").slice(0, 1).toUpperCase())}</div>
      <div><p class="gen-life">${esc(life(req, p))}</p><p class="muted">${esc(p.id)} · ${esc(t?.name || p.tree)}${p.branch ? ` · branche ${esc(p.branch)}` : ""}</p></div>
      <nav class="gen-actions">
        <a class="btn-ink" href="${personUrl(p.tree, p.id)}/ascendance">Arbre d'ascendance</a>
        <a class="btn-ink btn-ink--ghost" href="${personUrl(p.tree, p.id)}/descendance">Descendance</a>
      </nav>
    </header>
    ${hide ? `<p class="gen-note">Les informations sur les personnes vivantes ne sont pas affichées.</p>` : `
    <table class="gen-events">
      ${ev("Naissance", p.birth_date, p.birth_place)}${ev("Baptême", p.chr_date, p.chr_place)}${ev("Décès", p.death_date, p.death_place)}${ev(p.crem ? "Crémation" : "Sépulture", p.buri_date, p.buri_place)}
      ${p.sex ? `<tr><th>Sexe</th><td colspan="2">${p.sex === "M" ? "Masculin" : p.sex === "F" ? "Féminin" : "Inconnu"}</td></tr>` : ""}
      ${p.occupation ? `<tr><th>Profession</th><td colspan="2">${esc(p.occupation)}</td></tr>` : ""}
      ${p.alt_names.length ? `<tr><th>Autres noms</th><td colspan="2">${esc(p.alt_names.join(", "))}</td></tr>` : ""}
    </table>
    ${p.notes ? `<div class="gen-notes">${esc(p.notes).replace(/\n/g, "<br>")}</div>` : ""}`}
    <div class="gen-cols">
      <section class="gen-fam gen-fam--parents" style="--i:0"><h3>Parents</h3>
        ${father?.id || mother?.id ? `<p>${father?.id ? `${link(req, father)} <small>${esc(life(req, father))}</small>` : "Père inconnu"}</p><p>${mother?.id ? `${link(req, mother)} <small>${esc(life(req, mother))}</small>` : "Mère inconnue"}</p>` : `<p class="muted">Non renseignés</p>`}
        ${siblings.length ? `<h4>Frères et sœurs</h4><ul class="gen-kids">${siblings.map((k) => `<li>${link(req, k)} <small>${esc(life(req, k))}</small></li>`).join("")}</ul>` : ""}
      </section>
      ${fams.map((f, i) => famBlock(f, i + 1)).join("")}
    </div>
  </div>`;
  await page(res, { title: fullName(req, p), h1: esc(fullName(req, p)), main });
}));

// ---------------------------------------------------------------------------
// Arbres : données JSON + pages
// ---------------------------------------------------------------------------
async function pedigree(req, tree, id, gens) {
  const root = await S.getPerson(tree, id);
  if (!root) return null;
  const all = new Map([[root.id, root]]);
  let level = [root];
  const parentsOf = new Map();
  for (let g = 1; g < gens; g++) {
    const famIds = level.map((p) => p && p.famc).filter(Boolean);
    if (!famIds.length) break;
    const fams = (await db.q("SELECT id, husband, wife FROM gen_families WHERE tree=$1 AND id = ANY($2)", [tree, famIds])).rows;
    const fmap = new Map(fams.map((f) => [f.id, f]));
    const ppl = await S.getPeople(tree, fams.flatMap((f) => [f.husband, f.wife]));
    ppl.forEach((v, k) => all.set(k, v));
    const next = [];
    for (const p of level) {
      const f = p && p.famc ? fmap.get(p.famc) : null;
      const pair = [f?.husband ? ppl.get(f.husband) || null : null, f?.wife ? ppl.get(f.wife) || null : null];
      if (p) parentsOf.set(p.id, pair);
      next.push(...pair);
    }
    level = next;
  }
  const build = (p, g) => {
    if (!p) return null;
    const node = compact(req, p);
    const pr = parentsOf.get(p.id);
    node.more = !!p.famc && !pr;
    if (g < gens && pr) node.parents = [build(pr[0], g + 1), build(pr[1], g + 1)];
    return node;
  };
  // enfants et conjoints de la personne centrale (pour descendre)
  const fams = await S.spouseFamilies(tree, id);
  const kidsMap = await S.getPeople(tree, fams.flatMap((f) => [f.husband, f.wife, ...f.children]));
  return {
    tree, gens, root: build(root, 1),
    families: fams.map((f) => ({ spouse: compact(req, kidsMap.get(f.husband === id ? f.wife : f.husband)), children: f.children.map((c) => compact(req, kidsMap.get(c))).filter(Boolean) })),
  };
}

async function descendants(req, tree, id, gens) {
  const root = await S.getPerson(tree, id);
  if (!root) return null;
  const node = compact(req, root);
  let level = [node];
  for (let g = 1; g < gens && level.length; g++) {
    const ids = level.map((n) => n.id);
    const fams = (await db.q("SELECT * FROM gen_families WHERE tree=$1 AND (husband = ANY($2) OR wife = ANY($2)) ORDER BY marr_year NULLS LAST", [tree, ids])).rows;
    const ppl = await S.getPeople(tree, fams.flatMap((f) => [f.husband, f.wife, ...f.children]));
    const next = [];
    for (const n of level) {
      n.families = fams.filter((f) => f.husband === n.id || f.wife === n.id).map((f) => {
        const kids = f.children.map((c) => compact(req, ppl.get(c))).filter(Boolean);
        next.push(...kids);
        return { spouse: compact(req, ppl.get(f.husband === n.id ? f.wife : f.husband)), marr: masked(req, ppl.get(n.id)) ? "" : G.frDate(f.marr_date), children: kids };
      });
    }
    level = next;
  }
  return { tree, gens, root: node };
}

router.get(`${BASE}/api/:tree/:id/ascendance`, wrap(async (req, res) => {
  const g = Math.min(6, Math.max(2, parseInt(req.query.g, 10) || 4));
  const data = await pedigree(req, req.params.tree, req.params.id, g);
  return data ? res.json(data) : res.sendStatus(404);
}));
router.get(`${BASE}/api/:tree/:id/descendance`, wrap(async (req, res) => {
  const g = Math.min(8, Math.max(2, parseInt(req.query.g, 10) || 4));
  const data = await descendants(req, req.params.tree, req.params.id, g);
  return data ? res.json(data) : res.sendStatus(404);
}));

router.get(`${BASE}/:tree/:id/ascendance`, wrap(async (req, res, next) => {
  const g = Math.min(6, Math.max(2, parseInt(req.query.g, 10) || 4));
  const data = await pedigree(req, req.params.tree, req.params.id, g);
  if (!data) return next();
  const main = `<div class="chart-bar">
      <a class="btn-ink btn-ink--ghost" href="${personUrl(req.params.tree, req.params.id)}" data-root-link>Fiche individuelle</a>
      <label>Générations <select data-gens>${[2, 3, 4, 5, 6].map((n) => `<option${n === g ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <a class="btn-ink btn-ink--ghost" href="${personUrl(req.params.tree, req.params.id)}/descendance" data-desc-link>Descendance</a>
    </div>
    <div class="pedigree" data-pedigree data-tree="${esc(req.params.tree)}"><script type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script></div>`;
  await page(res, { title: `Ascendance de ${data.root.name}`, h1: `Ascendance de <span data-root-name>${esc(data.root.name)}</span>`, main });
}));
router.get(`${BASE}/:tree/:id/descendance`, wrap(async (req, res, next) => {
  const g = Math.min(8, Math.max(2, parseInt(req.query.g, 10) || 4));
  const data = await descendants(req, req.params.tree, req.params.id, g);
  if (!data) return next();
  const main = `<div class="chart-bar">
      <a class="btn-ink btn-ink--ghost" href="${personUrl(req.params.tree, req.params.id)}">Fiche individuelle</a>
      <label>Générations <select data-gens>${[2, 3, 4, 5, 6, 7, 8].map((n) => `<option${n === g ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <a class="btn-ink btn-ink--ghost" href="${personUrl(req.params.tree, req.params.id)}/ascendance">Ascendance</a>
    </div>
    <div class="desc" data-descendants data-tree="${esc(req.params.tree)}"><script type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script></div>`;
  await page(res, { title: `Descendance de ${data.root.name}`, h1: `Descendance de ${esc(data.root.name)}`, main });
}));

module.exports = { router };
