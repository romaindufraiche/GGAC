"use strict";
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const db = require("./db");
const R = require("./render");

const router = express.Router();
const { esc } = R;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(file.mimetype)),
});

router.use(express.urlencoded({ extended: true, limit: "15mb" }));
router.use(express.json({ limit: "15mb" }));
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Frame-Options", "SAMEORIGIN");
  next();
});

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------
const COOKIE = "ggac_admin";
const SESSION_DAYS = 14;
const attempts = new Map(); // limitation simple des tentatives de connexion

function readCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function loadUser(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const r = await db.q(
      "SELECT u.id, u.email, u.name, u.role, s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at > now()",
      [token]
    );
    if (r.rows[0]) {
      req.user = r.rows[0];
      req.csrf = r.rows[0].csrf;
    }
  }
  next();
}
router.use((req, res, next) => loadUser(req, res, next).catch(next));

function requireUser(req, res, next) {
  if (!req.user) return res.redirect(`/admin/connexion?next=${encodeURIComponent(req.originalUrl)}`);
  if (req.method !== "GET" && !/^multipart\//.test(req.get("content-type") || "")) {
    const sent = req.get("x-csrf-token") || (req.body && req.body._csrf);
    if (!sent || sent !== req.csrf) return res.status(403).send("Jeton de sécurité invalide : rechargez la page.");
  }
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).send(adminPage(req, { title: "Accès refusé", body: `<div class="empty"><p>Cette section est réservée aux administrateurs.</p></div>` }));
  next();
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/connexion", (req, res) => {
  if (req.user) return res.redirect("/admin");
  res.send(loginPage(req.query.e ? "Adresse ou mot de passe incorrect." : "", req.query.next));
});

router.post("/connexion", wrap(async (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 8) return res.status(429).send(loginPage("Trop de tentatives. Réessayez dans quelques minutes."));
  const email = String(req.body.email || "").trim().toLowerCase();
  const r = await db.q("SELECT * FROM users WHERE email=$1", [email]);
  const u = r.rows[0];
  if (!u || u.role === "membre" || !db.checkPassword(String(req.body.password || ""), u.pass_hash)) {
    a.n++; attempts.set(ip, a);
    return res.redirect(`/admin/connexion?e=1${req.body.next ? `&next=${encodeURIComponent(req.body.next)}` : ""}`);
  }
  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  await db.q(`INSERT INTO sessions(token,user_id,csrf,expires_at) VALUES ($1,$2,$3, now() + interval '${SESSION_DAYS} days')`, [token, u.id, csrf]);
  await db.q("UPDATE users SET last_login=now() WHERE id=$1", [u.id]);
  res.append("Set-Cookie", `${COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${req.secure ? "; Secure" : ""}`);
  const next = String(req.body.next || "");
  res.redirect(next.startsWith("/admin") ? next : "/admin");
}));

router.post("/deconnexion", requireUser, wrap(async (req, res) => {
  await db.q("DELETE FROM sessions WHERE token=$1", [readCookie(req, COOKIE)]);
  res.append("Set-Cookie", `${COOKIE}=; Path=/admin; Max-Age=0`);
  res.redirect("/admin/connexion");
}));

router.use(requireUser);
router.use((req, res, next) => {
  if (req.user && req.user.role === "membre") return res.status(403).send(loginPage("Ce compte membre n'a pas accès à l'administration."));
  next();
});
router.use(wrap(async (req, res, next) => {
  if (req.method === "GET") req.newOrders = (await db.q("SELECT count(*)::int n FROM orders WHERE status='nouvelle'")).rows[0].n;
  next();
}));

// ---------------------------------------------------------------------------
// Gabarit de l'administration
// ---------------------------------------------------------------------------
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  page: '<path d="M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  menu: '<path d="M4 6h16M4 12h10M4 18h16"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 20c0-3-2-5-5-5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  tree: '<path d="M12 22v-8M12 17l-5-4M12 15l5-5"/><circle cx="6" cy="10" r="3.2"/><circle cx="17" cy="8" r="3.4"/><circle cx="11.5" cy="6" r="4"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  cart: '<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
};
const icon = (n, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

const MESSAGES = {
  saved: "Modifications enregistrées.",
  created: "Élément créé.",
  deleted: "Élément supprimé.",
  restored: "Version restaurée.",
  generated: "Permanences générées.",
  uploaded: "Fichiers envoyés.",
  password: "Mot de passe modifié.",
};

function adminPage(req, { title, active = "", body, actions = "", scripts = "", wide = false }) {
  const msg = MESSAGES[req.query?.ok] || "";
  const nav = [
    ["", "home", "Tableau de bord"],
    ["agenda", "cal", "Agenda"],
    ["pages", "page", "Pages"],
    ["menus", "menu", "Menus"],
    ["boutique", "book", "Boutique"],
    ["genealogie", "tree", "Généalogie"],
    ["commandes", "cart", `Commandes${req.newOrders ? ` <em class="badge">${req.newOrders}</em>` : ""}`],
    ["medias", "img", "Médiathèque"],
    ...(req.user.role === "admin" ? [["utilisateurs", "users", "Utilisateurs"], ["reglages", "cog", "Réglages"]] : []),
  ];
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Administration G.G.A.C.</title>
<meta name="robots" content="noindex, nofollow">
<meta name="csrf" content="${esc(req.csrf)}">
<link rel="icon" href="/assets/img/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/admin/admin.css">
</head>
<body class="adm">
<aside class="adm-side">
  <a class="adm-brand" href="/admin"><img src="/assets/img/apple-touch-icon.png" alt=""><span>G.G.A.C.<small>Administration</small></span></a>
  <nav class="adm-nav">${nav
    .map(([href, ic, label]) => `<a href="/admin/${href}" class="${active === href ? "is-active" : ""}">${icon(ic)}<span>${label}</span></a>`)
    .join("")}</nav>
  <div class="adm-side__foot">
    <a href="/" target="_blank" rel="noopener">${icon("eye")}<span>Voir le site</span></a>
    <a href="/admin/profil" class="${active === "profil" ? "is-active" : ""}"><span class="avatar">${esc((req.user.name || req.user.email).slice(0, 1).toUpperCase())}</span><span>${esc(req.user.name || req.user.email)}</span></a>
    <form method="post" action="/admin/deconnexion"><input type="hidden" name="_csrf" value="${esc(req.csrf)}"><button>${icon("out")}<span>Déconnexion</span></button></form>
  </div>
</aside>
<button class="adm-burger" aria-label="Menu"><span></span><span></span><span></span></button>
<main class="adm-main${wide ? " adm-main--wide" : ""}">
  <header class="adm-head"><h1>${title}</h1><div class="adm-head__actions">${actions}</div></header>
  ${msg ? `<div class="toast" role="status">${esc(msg)}</div>` : ""}
  ${body}
</main>
<div class="modal" hidden><div class="modal__box"><p class="modal__text"></p><div class="modal__actions"><button type="button" class="btn btn--ghost" data-cancel>Annuler</button><button type="button" class="btn btn--danger" data-ok>Confirmer</button></div></div></div>
<script src="/assets/admin/admin.js" defer></script>
${scripts}
</body></html>`;
}

function loginPage(error = "", next = "") {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion · Administration G.G.A.C.</title><meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/admin/admin.css"></head>
<body class="adm-login">
<form class="login" method="post" action="/admin/connexion">
  <svg class="login__seal" viewBox="0 0 120 140" aria-hidden="true"><path d="M10 10 H110 V70 C110 105 85 122 60 132 C35 122 10 105 10 70 Z"/></svg>
  <img class="login__logo" src="/assets/img/shields.png" alt="">
  <h1>Administration</h1>
  <p class="login__sub">Groupe des Généalogistes Amateurs du Cambrésis</p>
  ${error ? `<p class="login__err">${esc(error)}</p>` : ""}
  <label>Adresse e-mail<input type="email" name="email" autocomplete="username" required autofocus></label>
  <label>Mot de passe<input type="password" name="password" autocomplete="current-password" required></label>
  <input type="hidden" name="next" value="${esc(next || "")}">
  <button class="btn btn--primary btn--block">Se connecter</button>
  <a class="login__back" href="/">← Retour au site</a>
</form>
</body></html>`;
}

const csrfField = (req) => `<input type="hidden" name="_csrf" value="${esc(req.csrf)}">`;
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "—");
const fmtDate = (d) => (d ? new Date(R.parts(d).iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—");
const iso = (d) => R.parts(d).iso;
const ABBR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const abbr = (d) => ABBR[R.parts(d).m - 1];
const ago = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
};

async function changed(req, action, target, link) {
  R.invalidate();
  await db.touchSite();
  await db.log(req.user.id, action, target, link);
}
async function agendaChanged(req, action, target) {
  await db.setSetting("agenda_date_maj", `Page mise à jour le ${R.stampNow().txt.replace(/h(\d\d)$/, ":$1:00")}`);
  await changed(req, action, target, "/admin/agenda");
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------
router.get("/", wrap(async (req, res) => {
  const today = R.todayIso();
  const [pages, evUp, evAll, perm, nextPerm, media, visitors, acts, recent] = await Promise.all([
    db.q("SELECT count(*)::int n, count(*) FILTER (WHERE NOT published)::int hidden FROM pages"),
    db.q("SELECT * FROM events WHERE end_date >= $1 ORDER BY start_date LIMIT 4", [today]),
    db.q("SELECT count(*)::int n FROM events"),
    db.q("SELECT count(*)::int n FROM permanences WHERE date >= $1", [today]),
    db.q("SELECT * FROM permanences WHERE date >= $1 ORDER BY date LIMIT 1", [today]),
    db.q("SELECT count(*)::int n, coalesce(sum(size),0)::bigint s FROM media"),
    db.getSetting("visitors", 0),
    db.q("SELECT a.*, u.name, u.email FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 12"),
    db.q("SELECT slug, h1, updated_at FROM pages ORDER BY updated_at DESC LIMIT 5"),
  ]);
  const np = nextPerm.rows[0];
  const cards = [
    ["cal", evUp.rows.length ? `${evAll.rows[0].n}` : "0", "manifestations", "/admin/agenda"],
    ["clock", perm.rows[0].n, "permanences à venir", "/admin/agenda?tab=permanences"],
    ["cart", req.newOrders || 0, "commandes à traiter", "/admin/commandes?statut=nouvelle"],
    ["page", pages.rows[0].n, "pages du site", "/admin/pages"],
    ["img", media.rows[0].n, "médias", "/admin/medias"],
    ["eye", Number(visitors).toLocaleString("fr-FR"), "visiteurs", "/admin/reglages"],
  ];
  const body = `
  <section class="hello">
    <div><p class="hello__kicker">${esc(new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</p>
    <h2>Bonjour ${esc(req.user.name || "")}</h2>
    <p>${np ? `Prochaine permanence : <strong>${esc(R.longDate(np.date))}</strong> ${esc(np.hours)}.` : "Aucune permanence programmée : pensez à en ajouter."}</p></div>
    <div class="hello__actions">
      <a class="btn btn--primary" href="/admin/agenda/manifestations/nouvelle">${icon("plus")} Nouvelle manifestation</a>
      <a class="btn" href="/admin/agenda?tab=permanences">${icon("clock")} Gérer les permanences</a>
      <a class="btn" href="/admin/pages">${icon("edit")} Modifier une page</a>
    </div>
  </section>
  <section class="stats">${cards
    .map(([ic, n, l, href], i) => `<a class="stat" href="${href}" style="--i:${i}">${icon(ic)}<b data-count>${n}</b><span>${l}</span></a>`)
    .join("")}</section>
  <div class="grid2">
    <section class="card">
      <header class="card__head"><h3>Prochaines manifestations</h3><a href="/admin/agenda">Tout voir</a></header>
      ${evUp.rows.length ? `<ul class="list">${evUp.rows
        .map((e) => `<li><a href="/admin/agenda/manifestations/${e.id}"><span class="datebox"><b>${R.parts(e.start_date).d}</b>${abbr(e.start_date)}</span><span><strong>${e.title}</strong><small>${esc(R.stripTags(e.subtitle))}</small></span></a></li>`)
        .join("")}</ul>` : `<div class="empty"><p>Aucune manifestation à venir.</p></div>`}
    </section>
    <section class="card">
      <header class="card__head"><h3>Activité récente</h3></header>
      ${acts.rows.length ? `<ul class="activity">${acts.rows
        .map((a) => `<li><span class="avatar avatar--sm">${esc((a.name || a.email || "?").slice(0, 1).toUpperCase())}</span><span><b>${esc(a.name || a.email || "Système")}</b> ${esc(a.action)} ${a.link ? `<a href="${esc(a.link)}">${esc(a.target || "")}</a>` : esc(a.target || "")}<small>${ago(a.at)}</small></span></li>`)
        .join("")}</ul>` : `<div class="empty"><p>Les modifications apparaîtront ici.</p></div>`}
    </section>
  </div>
  <section class="card">
    <header class="card__head"><h3>Pages modifiées récemment</h3><a href="/admin/pages">Toutes les pages</a></header>
    <ul class="list list--inline">${recent.rows
      .map((p) => `<li><a href="/admin/pages/${esc(p.slug)}"><span><strong>${R.stripTags(p.h1)}</strong><small>${fmtDateTime(p.updated_at)}</small></span></a></li>`)
      .join("")}</ul>
  </section>`;
  res.send(adminPage(req, { title: "Tableau de bord", active: "", body }));
}));

// ---------------------------------------------------------------------------
// Agenda : manifestations, permanences, texte d'introduction
// ---------------------------------------------------------------------------
router.get("/agenda", wrap(async (req, res) => {
  const tab = ["manifestations", "permanences", "presentation"].includes(req.query.tab) ? req.query.tab : "manifestations";
  const today = R.todayIso();
  let body = `<nav class="tabs">
    <a href="?tab=manifestations" class="${tab === "manifestations" ? "is-active" : ""}">Manifestations</a>
    <a href="?tab=permanences" class="${tab === "permanences" ? "is-active" : ""}">Permanences</a>
    <a href="?tab=presentation" class="${tab === "presentation" ? "is-active" : ""}">Texte de présentation</a>
  </nav>`;
  let actions = "";
  let scripts = "";

  if (tab === "manifestations") {
    const all = (await db.q("SELECT * FROM events ORDER BY start_date DESC, id DESC")).rows;
    const up = all.filter((e) => iso(e.end_date) >= today).reverse();
    const past = all.filter((e) => iso(e.end_date) < today);
    actions = `<a class="btn btn--primary" href="/admin/agenda/manifestations/nouvelle">${icon("plus")} Nouvelle manifestation</a>`;
    const row = (e) => `<article class="evrow${e.published ? "" : " is-draft"}">
      <div class="evrow__img">${e.image ? `<img src="${esc(e.image)}" alt="" loading="lazy">` : `<span class="datebox datebox--lg"><b>${R.parts(e.start_date).d}</b>${abbr(e.start_date)}</span>`}</div>
      <div class="evrow__body">
        <h3><a href="/admin/agenda/manifestations/${e.id}">${e.title}</a></h3>
        <p class="muted">${esc(R.stripTags(e.subtitle))}</p>
        <p class="tags">${e.published ? `<span class="tag tag--ok">Publiée</span>` : `<span class="tag">Brouillon</span>`}${iso(e.end_date) < today ? `<span class="tag">Passée</span>` : `<span class="tag tag--info">À venir</span>`}</p>
      </div>
      <div class="evrow__actions">
        <a class="btn btn--sm" href="/admin/agenda/manifestations/${e.id}">${icon("edit")} Modifier</a>
        <form method="post" action="/admin/agenda/manifestations/${e.id}/publier">${csrfField(req)}<button class="btn btn--sm btn--ghost">${e.published ? "Dépublier" : "Publier"}</button></form>
        <form method="post" action="/admin/agenda/manifestations/${e.id}/supprimer" data-confirm="Supprimer définitivement cette manifestation ?">${csrfField(req)}<button class="btn btn--sm btn--danger-ghost">${icon("trash")} Supprimer</button></form>
      </div>
    </article>`;
    body += `<section class="card"><header class="card__head"><h3>À venir <span class="count">${up.length}</span></h3><a href="/agenda.html" target="_blank">Voir l'agenda public</a></header>
      ${up.length ? up.map(row).join("") : `<div class="empty"><p>Aucune manifestation à venir.</p><a class="btn btn--primary" href="/admin/agenda/manifestations/nouvelle">Ajouter une manifestation</a></div>`}</section>`;
    if (past.length) body += `<details class="card"><summary class="card__head"><h3>Passées <span class="count">${past.length}</span></h3></summary>${past.map(row).join("")}</details>`;
  }

  if (tab === "permanences") {
    const rows = (await db.q("SELECT * FROM permanences ORDER BY date")).rows;
    const up = rows.filter((p) => iso(p.date) >= today);
    const past = rows.filter((p) => iso(p.date) < today);
    const shown = await db.getSetting("permanences_count", 7);
    const list = (arr, isPast) =>
      arr.length
        ? `<form method="post" action="/admin/agenda/permanences/supprimer" class="perm-form" data-confirm="Supprimer les permanences sélectionnées ?">${csrfField(req)}
          <div class="perm-grid">${arr
            .map((p) => {
              const d = R.parts(p.date);
              return `<label class="perm${d.wd === 6 ? " perm--sat" : ""}${isPast ? " is-past" : ""}"><input type="checkbox" name="ids" value="${p.id}">
              <span class="perm__day">${R.JOURS[d.wd]}</span><b>${d.d}</b><span>${R.MOIS[d.m - 1]} ${d.y}</span><small>${esc(p.hours)}</small></label>`;
            })
            .join("")}</div>
          <div class="bar"><button class="btn btn--danger-ghost btn--sm" data-needs-selection>${icon("trash")} Supprimer la sélection</button><button type="button" class="btn btn--ghost btn--sm" data-select-all>Tout sélectionner</button></div>
        </form>`
        : `<div class="empty"><p>Aucune permanence.</p></div>`;
    body += `<div class="grid2 grid2--side">
      <div>
        <section class="card"><header class="card__head"><h3>À venir <span class="count">${up.length}</span></h3><span class="muted">Les ${esc(shown)} prochaines sont affichées sur le site</span></header>${list(up, false)}</section>
        ${past.length ? `<details class="card"><summary class="card__head"><h3>Passées <span class="count">${past.length}</span></h3></summary>${list(past, true)}</details>` : ""}
      </div>
      <div>
        <section class="card">
          <header class="card__head"><h3>Ajouter une permanence</h3></header>
          <form method="post" action="/admin/agenda/permanences" class="form">${csrfField(req)}
            <label>Date<input type="date" name="date" required min="${today}"></label>
            <label>Horaires<input type="text" name="hours" value="de 14h00 à 17h00" required></label>
            <button class="btn btn--primary">${icon("plus")} Ajouter</button>
          </form>
        </section>
        <section class="card">
          <header class="card__head"><h3>Générer un calendrier</h3></header>
          <form method="post" action="/admin/agenda/permanences/generer" class="form" id="gen">${csrfField(req)}
            <div class="row"><label>Du<input type="date" name="from" required value="${today}"></label><label>Au<input type="date" name="to" required></label></div>
            <fieldset><legend>Jours</legend>
              <div class="chips">${["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
                .map((j, i) => `<label class="chip"><input type="checkbox" name="wd" value="${(i + 1) % 7}"${j === "mercredi" ? " checked" : ""}><span>${j}</span></label>`)
                .join("")}</div>
              <label class="check"><input type="checkbox" name="fourthSat" checked><span>et le 4<sup>e</sup> samedi de chaque mois</span></label>
            </fieldset>
            <fieldset><legend>Exclure</legend>
              <div class="chips">${R.MOIS.map((m, i) => `<label class="chip"><input type="checkbox" name="skipMonth" value="${i + 1}"${i === 6 || i === 7 ? " checked" : ""}><span>${m}</span></label>`).join("")}</div>
              <label class="check"><input type="checkbox" name="skipHolidays" checked> les jours fériés</label>
            </fieldset>
            <label>Horaires<input type="text" name="hours" value="de 14h00 à 17h00" required></label>
            <p class="gen-preview muted" aria-live="polite"></p>
            <button class="btn btn--primary">Générer les permanences</button>
          </form>
        </section>
      </div>
    </div>`;
  }

  if (tab === "presentation") {
    const intro = await db.getSetting("agenda_intro", "");
    body += `<form method="post" action="/admin/agenda/presentation" class="card form">${csrfField(req)}
      <p class="muted">Texte affiché sous « Permanences : » sur la page Agenda et la page d'accueil.</p>
      <textarea name="intro" class="rte" data-height="420">${esc(intro)}</textarea>
      <div class="bar"><button class="btn btn--primary">Enregistrer</button></div>
    </form>`;
    scripts = editorScripts();
  }
  res.send(adminPage(req, { title: "Agenda", active: "agenda", body, actions, scripts }));
}));

function editorScripts() {
  return `<script src="https://cdn.jsdelivr.net/npm/tinymce@7.6.0/tinymce.min.js" referrerpolicy="origin"></script>
<script src="/assets/admin/editor.js" defer></script>`;
}

async function eventForm(req, e, isNew) {
  const title = isNew ? "Nouvelle manifestation" : "Modifier la manifestation";
  const body = `<form method="post" action="${isNew ? "/admin/agenda/manifestations" : `/admin/agenda/manifestations/${e.id}`}" enctype="multipart/form-data" class="editor-layout">
    <input type="hidden" name="_csrf" value="${esc(req.csrf)}">
    <div class="card form">
      <label>Titre<input type="text" name="title" value="${esc(e.title || "")}" required placeholder="Ex. : Salon de généalogie et d'histoire"><small>Les exposants s'écrivent avec &lt;sup&gt; : 5&lt;sup&gt;e&lt;/sup&gt;</small></label>
      <div class="row">
        <label>Premier jour<input type="date" name="start_date" value="${e.start_date ? iso(e.start_date) : ""}" required></label>
        <label>Dernier jour<input type="date" name="end_date" value="${e.end_date ? iso(e.end_date) : ""}" required></label>
      </div>
      <label>Dates, horaires et lieu
        <div class="input-btn"><input type="text" name="subtitle" value="${esc(e.subtitle || "")}" required placeholder="Du samedi 7 au dimanche 8 novembre 2026 de 10h00 à 18h00 - Salle des fêtes de …">
        <button type="button" class="btn btn--sm" data-gen-subtitle>Compléter depuis les dates</button></div></label>
      <label>Description</label>
      <textarea name="body" class="rte" data-height="320" data-mini>${esc(e.body || "")}</textarea>
    </div>
    <aside class="editor-side">
      <section class="card">
        <h3>Publication</h3>
        <label class="switch"><input type="checkbox" name="published" ${e.published !== false ? "checked" : ""}><span></span><em>Visible sur le site</em></label>
        <div class="bar bar--stack">
          <button class="btn btn--primary btn--block">${isNew ? "Créer la manifestation" : "Enregistrer"}</button>
          <a class="btn btn--ghost btn--block" href="/admin/agenda">Annuler</a>
        </div>
      </section>
      <section class="card">
        <h3>Affiche</h3>
        <div class="dropzone" data-dropzone>
          <img class="dropzone__preview" src="${esc(e.image || "")}" alt="" ${e.image ? "" : "hidden"}>
          <p class="dropzone__hint" ${e.image ? "hidden" : ""}>Glissez une image ici<br><small>ou cliquez pour choisir (JPG, PNG, WebP — 10 Mo max.)</small></p>
          <input type="file" name="image_file" accept="image/jpeg,image/png,image/webp,image/gif">
        </div>
        <input type="hidden" name="image" value="${esc(e.image || "")}">
        <div class="bar">
          <button type="button" class="btn btn--sm btn--ghost" data-pick-media>Choisir dans la médiathèque</button>
          <button type="button" class="btn btn--sm btn--danger-ghost" data-remove-image ${e.image ? "" : "hidden"}>Retirer</button>
        </div>
      </section>
    </aside>
  </form>`;
  return adminPage(req, { title, active: "agenda", body, scripts: editorScripts(), wide: true });
}

async function storeUpload(req, file) {
  if (!file) return null;
  const r = await db.q("INSERT INTO media(filename,mime,size,data,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [
    file.originalname.replace(/[^\w.\-]+/g, "_").slice(-80), file.mimetype, file.size, file.buffer, req.user.id,
  ]);
  return `/media/${r.rows[0].id}/${encodeURIComponent(file.originalname.replace(/[^\w.\-]+/g, "_").slice(-80))}`;
}

function eventValues(req, image) {
  const b = req.body;
  let start = String(b.start_date || ""), end = String(b.end_date || start);
  if (end < start) [start, end] = [end, start];
  return [String(b.title || "").trim(), String(b.subtitle || "").trim(), String(b.body || ""), image || null, start, end, b.published === "on"];
}

router.get("/agenda/manifestations/nouvelle", wrap(async (req, res) => res.send(await eventForm(req, { published: true }, true))));
router.get("/agenda/manifestations/:id", wrap(async (req, res, next) => {
  const r = await db.q("SELECT * FROM events WHERE id=$1", [Number(req.params.id) || 0]);
  if (!r.rows[0]) return next();
  res.send(await eventForm(req, r.rows[0], false));
}));

const csrfAfterUpload = (req, res, next) => (req.body._csrf === req.csrf ? next() : res.status(403).send("Jeton de sécurité invalide."));

router.post("/agenda/manifestations", upload.single("image_file"), csrfAfterUpload, wrap(async (req, res) => {
  const image = (await storeUpload(req, req.file)) || req.body.image;
  const v = eventValues(req, image);
  const r = await db.q("INSERT INTO events(title,subtitle,body,image,start_date,end_date,published) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", v);
  await agendaChanged(req, "a ajouté la manifestation", R.stripTags(v[0]));
  res.redirect(`/admin/agenda/manifestations/${r.rows[0].id}?ok=created`);
}));
router.post("/agenda/manifestations/:id", upload.single("image_file"), csrfAfterUpload, wrap(async (req, res) => {
  const image = (await storeUpload(req, req.file)) || req.body.image;
  const v = eventValues(req, image);
  await db.q("UPDATE events SET title=$1, subtitle=$2, body=$3, image=$4, start_date=$5, end_date=$6, published=$7, updated_at=now() WHERE id=$8", [...v, Number(req.params.id)]);
  await agendaChanged(req, "a modifié la manifestation", R.stripTags(v[0]));
  res.redirect(`/admin/agenda/manifestations/${req.params.id}?ok=saved`);
}));
router.post("/agenda/manifestations/:id/publier", wrap(async (req, res) => {
  const r = await db.q("UPDATE events SET published = NOT published, updated_at=now() WHERE id=$1 RETURNING title, published", [Number(req.params.id)]);
  if (r.rows[0]) await agendaChanged(req, r.rows[0].published ? "a publié la manifestation" : "a dépublié la manifestation", R.stripTags(r.rows[0].title));
  res.redirect("/admin/agenda?ok=saved");
}));
router.post("/agenda/manifestations/:id/supprimer", wrap(async (req, res) => {
  const r = await db.q("DELETE FROM events WHERE id=$1 RETURNING title", [Number(req.params.id)]);
  if (r.rows[0]) await agendaChanged(req, "a supprimé la manifestation", R.stripTags(r.rows[0].title));
  res.redirect("/admin/agenda?ok=deleted");
}));

router.post("/agenda/permanences", wrap(async (req, res) => {
  await db.q("INSERT INTO permanences(date,hours) VALUES ($1,$2) ON CONFLICT (date) DO UPDATE SET hours=EXCLUDED.hours", [req.body.date, String(req.body.hours || "").trim()]);
  await agendaChanged(req, "a ajouté la permanence du", R.longDate(req.body.date));
  res.redirect("/admin/agenda?tab=permanences&ok=created");
}));
router.post("/agenda/permanences/supprimer", wrap(async (req, res) => {
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  if (ids.length) {
    await db.q("DELETE FROM permanences WHERE id = ANY($1)", [ids]);
    await agendaChanged(req, "a supprimé", `${ids.length} permanence(s)`);
  }
  res.redirect("/admin/agenda?tab=permanences&ok=deleted");
}));

/** Jours fériés français (dont Pâques, Ascension, Pentecôte) */
function holidays(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(year, month - 1, day);
  const plus = (n) => new Date(easter + n * 864e5).toISOString().slice(0, 10);
  return new Set([`${year}-01-01`, plus(1), `${year}-05-01`, `${year}-05-08`, plus(39), plus(50), `${year}-07-14`, `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`]);
}
function generateDates({ from, to, wd, fourthSat, skipMonth, skipHolidays }) {
  const out = [];
  const days = new Set([].concat(wd || []).map(Number));
  const skip = new Set([].concat(skipMonth || []).map(Number));
  let t = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  if (!(t <= end) || end - t > 3 * 366 * 864e5) return out;
  const hol = {};
  for (; t <= end; t += 864e5) {
    const d = new Date(t);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate(), w = d.getUTCDay();
    const isoD = d.toISOString().slice(0, 10);
    if (skip.has(m)) continue;
    hol[y] = hol[y] || holidays(y);
    if (skipHolidays && hol[y].has(isoD)) continue;
    const fourth = w === 6 && day >= 22 && day <= 28;
    if (days.has(w) || (fourthSat && fourth)) out.push(isoD);
  }
  return out;
}
router.post("/agenda/permanences/apercu", wrap(async (req, res) => {
  res.json({ dates: generateDates({ ...req.body, fourthSat: !!req.body.fourthSat, skipHolidays: !!req.body.skipHolidays }) });
}));
router.post("/agenda/permanences/generer", wrap(async (req, res) => {
  const dates = generateDates({ ...req.body, fourthSat: req.body.fourthSat === "on", skipHolidays: req.body.skipHolidays === "on" });
  for (const d of dates) {
    await db.q("INSERT INTO permanences(date,hours) VALUES ($1,$2) ON CONFLICT (date) DO NOTHING", [d, String(req.body.hours || "").trim()]);
  }
  await agendaChanged(req, "a généré", `${dates.length} permanence(s)`);
  res.redirect("/admin/agenda?tab=permanences&ok=generated");
}));
router.post("/agenda/presentation", wrap(async (req, res) => {
  await db.setSetting("agenda_intro", String(req.body.intro || ""));
  await agendaChanged(req, "a modifié", "la présentation des permanences");
  res.redirect("/admin/agenda?tab=presentation&ok=saved");
}));

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
router.get("/pages", wrap(async (req, res) => {
  const r = await db.q("SELECT p.slug, p.h1, p.section, p.published, p.updated_at, length(p.content) AS len, u.name AS by FROM pages p LEFT JOIN users u ON u.id=p.updated_by ORDER BY p.section NULLS LAST, p.slug");
  const sections = [...new Set(r.rows.map((p) => p.section || "Autres"))];
  const num = (s) => Number((s.match(/\d+/) || [0])[0]);
  r.rows.sort((a, b) => sections.indexOf(a.section || "Autres") - sections.indexOf(b.section || "Autres") || num(a.slug) - num(b.slug) || a.slug.localeCompare(b.slug));
  const body = `
  <div class="toolbar">
    <input type="search" class="filter" placeholder="Rechercher une page…" data-filter=".prow" autofocus>
    <div class="chips chips--filter">${["Toutes", ...sections].map((s, i) => `<button type="button" class="chip${i ? "" : " is-on"}" data-section="${esc(i ? s : "")}">${esc(s)}</button>`).join("")}</div>
  </div>
  <section class="card card--flush">
    <table class="table">
      <thead><tr><th>Page</th><th>Rubrique</th><th>Adresse</th><th>Modifiée</th><th></th></tr></thead>
      <tbody>${r.rows
        .map((p) => `<tr class="prow" data-section="${esc(p.section || "Autres")}" data-text="${esc(R.stripTags(p.h1 + " " + p.slug).toLowerCase())}">
          <td><a class="strong" href="/admin/pages/${esc(p.slug)}">${R.stripTags(p.h1)}</a>${p.published ? "" : ` <span class="tag">Masquée</span>`}${p.len > 300000 ? ` <span class="tag tag--info">très longue</span>` : ""}</td>
          <td><span class="muted">${esc(p.section || "—")}</span></td>
          <td><code>/${esc(p.slug)}.html</code></td>
          <td><span class="muted">${fmtDateTime(p.updated_at)}${p.by ? ` · ${esc(p.by)}` : ""}</span></td>
          <td class="actions"><a class="btn btn--sm" href="/admin/pages/${esc(p.slug)}">${icon("edit")} Modifier</a><a class="btn btn--sm btn--ghost" href="/${esc(p.slug)}.html" target="_blank" title="Voir">${icon("eye")}</a></td>
        </tr>`)
        .join("")}</tbody>
    </table>
  </section>`;
  res.send(adminPage(req, { title: `Pages <span class="count">${r.rows.length}</span>`, active: "pages", body, actions: `<a class="btn btn--primary" href="/admin/pages/nouvelle">${icon("plus")} Nouvelle page</a>` }));
}));

async function sections() {
  const nav = await db.getSetting("nav", []);
  return nav.filter((n) => n.children).map((n) => n.label);
}

router.get("/pages/nouvelle", wrap(async (req, res) => {
  const secs = await sections();
  const body = `<form method="post" action="/admin/pages" class="card form narrow">${csrfField(req)}
    <label>Titre de la page<input type="text" name="h1" required data-slug-source></label>
    <label>Adresse<div class="input-prefix"><span>/</span><input type="text" name="slug" required pattern="[a-z0-9\\-]+" data-slug-target><span>.html</span></div><small>Lettres minuscules, chiffres et tirets.</small></label>
    <label>Rubrique<select name="section"><option value="">—</option>${secs.map((s) => `<option>${esc(s)}</option>`).join("")}</select><small>Le menu latéral de la rubrique sera repris.</small></label>
    <div class="bar"><button class="btn btn--primary">Créer et modifier le contenu</button><a class="btn btn--ghost" href="/admin/pages">Annuler</a></div>
  </form>`;
  res.send(adminPage(req, { title: "Nouvelle page", active: "pages", body }));
}));
router.post("/pages", wrap(async (req, res) => {
  const slug = String(req.body.slug || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!slug || ["admin", "index", "agenda", "media", "assets"].includes(slug)) return res.status(400).send("Adresse invalide.");
  const exists = await db.q("SELECT 1 FROM pages WHERE slug=$1", [slug]);
  if (exists.rows.length) return res.status(400).send("Cette adresse existe déjà.");
  const section = req.body.section || null;
  const side = section ? (await db.q("SELECT side FROM pages WHERE section=$1 AND side IS NOT NULL ORDER BY slug LIMIT 1", [section])).rows[0]?.side : null;
  const h1 = String(req.body.h1 || "").trim();
  await db.q("INSERT INTO pages(slug,title,h1,section,side,content,date_maj,updated_by,published) VALUES ($1,$2,$3,$4,$5,'',$6,$7,false)", [
    slug, `${R.stripTags(h1)} - Groupe des Généalogistes Amateurs du Cambrésis`, h1, section, side ? JSON.stringify(side) : null, `Page mise à jour le ${R.stampNow().txt}`, req.user.id,
  ]);
  await changed(req, "a créé la page", R.stripTags(h1), `/admin/pages/${slug}`);
  res.redirect(`/admin/pages/${slug}?ok=created`);
}));

router.get("/pages/:slug", wrap(async (req, res, next) => {
  const r = await db.q("SELECT * FROM pages WHERE slug=$1", [req.params.slug]);
  const p = r.rows[0];
  if (!p) return next();
  const [revs, secs] = await Promise.all([
    db.q("SELECT r.id, r.created_at, length(r.content) len, u.name FROM page_revisions r LEFT JOIN users u ON u.id=r.created_by WHERE slug=$1 ORDER BY r.created_at DESC LIMIT 30", [p.slug]),
    sections(),
  ]);
  const huge = p.content.length > 300000;
  const side = p.side || { title: p.section || "", items: [] };
  const body = `<form method="post" action="/admin/pages/${esc(p.slug)}" class="editor-layout" id="page-form">
    ${csrfField(req)}
    <div class="editor-main">
      <div class="card form">
        <label>Titre affiché<input type="text" name="h1" value="${esc(p.h1)}" required><small>Balises autorisées : &lt;sup&gt;, &lt;em&gt;.</small></label>
        <label>Titre de l'onglet du navigateur<input type="text" name="title" value="${esc(p.title)}" required></label>
      </div>
      <div class="card form">
        <div class="card__head"><h3>Contenu</h3>${huge ? `<button type="button" class="btn btn--sm btn--ghost" data-enable-rte>Ouvrir l'éditeur visuel (page très longue, peut être lent)</button>` : ""}</div>
        <textarea name="content" class="${huge ? "code" : "rte"}" data-height="720" id="content">${esc(p.content)}</textarea>
      </div>
      <details class="card form" ${p.side ? "" : ""}>
        <summary class="card__head"><h3>Menu latéral</h3><span class="muted">${esc(side.items.length)} liens</span></summary>
        <label>Titre du bloc<input type="text" name="side_title" value="${esc(side.title || "")}"></label>
        <div class="side-editor" data-side-editor>
          <input type="hidden" name="side_items" value="${esc(JSON.stringify(side.items))}">
          <ol class="side-list"></ol>
          <button type="button" class="btn btn--sm" data-add-item>${icon("plus")} Ajouter un lien</button>
        </div>
        ${p.section ? `<label class="check"><input type="checkbox" name="side_all"> Appliquer ce menu à toutes les pages de la rubrique « ${esc(p.section)} »</label>` : ""}
      </details>
    </div>
    <aside class="editor-side">
      <section class="card">
        <h3>Publication</h3>
        <label class="switch"><input type="checkbox" name="published" ${p.published ? "checked" : ""}><span></span><em>Visible sur le site</em></label>
        <label>Rubrique<select name="section"><option value="">—</option>${secs.map((s) => `<option${s === p.section ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <label class="check"><input type="checkbox" name="bump_date" checked> Mettre à jour « Page mise à jour le … »</label>
        <p class="muted small">Adresse : <a href="/${esc(p.slug)}.html" target="_blank">/${esc(p.slug)}.html</a><br>Dernière modification : ${fmtDateTime(p.updated_at)}</p>
        <div class="bar bar--stack">
          <button class="btn btn--primary btn--block" data-save>Enregistrer</button>
          <button class="btn btn--block" formaction="/admin/pages/${esc(p.slug)}/apercu" formtarget="_blank" data-preview>${icon("eye")} Aperçu</button>
        </div>
        <p class="muted small kbd">Raccourci : <kbd>Ctrl</kbd> + <kbd>S</kbd></p>
      </section>
      <section class="card">
        <h3>Historique</h3>
        ${revs.rows.length ? `<ul class="revs">${revs.rows
          .map((v) => `<li><span>${fmtDateTime(v.created_at)}<small>${esc(v.name || "Import")} · ${Math.round(v.len / 1024)} Ko</small></span>
            <button class="btn btn--sm btn--ghost" formaction="/admin/pages/${esc(p.slug)}/restaurer/${v.id}" data-confirm="Restaurer cette version ? La version actuelle sera conservée dans l'historique.">Restaurer</button></li>`)
          .join("")}</ul>` : `<p class="muted small">Chaque enregistrement conserve la version précédente ici.</p>`}
      </section>
      <section class="card card--danger">
        <h3>Zone sensible</h3>
        <button class="btn btn--sm btn--danger-ghost" formaction="/admin/pages/${esc(p.slug)}/supprimer" data-confirm="Supprimer définitivement cette page et son historique ? Les liens vers elle ne fonctionneront plus." formnovalidate>${icon("trash")} Supprimer la page</button>
      </section>
    </aside>
  </form>`;
  res.send(adminPage(req, { title: `${R.stripTags(p.h1)}`, active: "pages", body, scripts: editorScripts(), wide: true,
    actions: `<a class="btn btn--ghost" href="/admin/pages">← Toutes les pages</a><a class="btn" href="/${esc(p.slug)}.html" target="_blank">${icon("eye")} Voir</a>` }));
}));

function sideFromBody(b) {
  let items = [];
  try { items = JSON.parse(b.side_items || "[]"); } catch { items = []; }
  items = items.filter((i) => i && i.label).map((i) => ({ label: String(i.label), href: i.href ? String(i.href) : null, level: i.level ? 1 : 0 }));
  return items.length || b.side_title ? { title: String(b.side_title || ""), items } : null;
}

router.post("/pages/:slug", wrap(async (req, res, next) => {
  const cur = (await db.q("SELECT * FROM pages WHERE slug=$1", [req.params.slug])).rows[0];
  if (!cur) return next();
  const b = req.body;
  await db.q("INSERT INTO page_revisions(slug,title,h1,content,created_by) VALUES ($1,$2,$3,$4,$5)", [cur.slug, cur.title, cur.h1, cur.content, cur.updated_by]);
  const side = sideFromBody(b);
  const dateMaj = b.bump_date === "on" ? `Page mise à jour le ${R.stampNow().txt}` : cur.date_maj;
  await db.q(
    "UPDATE pages SET title=$1, h1=$2, content=$3, section=$4, side=$5, published=$6, date_maj=$7, updated_at=now(), updated_by=$8 WHERE slug=$9",
    [String(b.title || cur.title), String(b.h1 || cur.h1), String(b.content ?? cur.content), b.section || null, side ? JSON.stringify(side) : null, b.published === "on", dateMaj, req.user.id, cur.slug]
  );
  if (b.side_all === "on" && cur.section && side) {
    await db.q("UPDATE pages SET side=$1 WHERE section=$2", [JSON.stringify(side), cur.section]);
  }
  await db.q("DELETE FROM page_revisions WHERE slug=$1 AND id NOT IN (SELECT id FROM page_revisions WHERE slug=$1 ORDER BY created_at DESC LIMIT 30)", [cur.slug]);
  await changed(req, "a modifié la page", R.stripTags(b.h1 || cur.h1), `/admin/pages/${cur.slug}`);
  if (req.get("accept")?.includes("application/json")) return res.json({ ok: true, at: new Date() });
  res.redirect(`/admin/pages/${cur.slug}?ok=saved`);
}));

router.post("/pages/:slug/apercu", wrap(async (req, res, next) => {
  const b = req.body;
  const html = await R.renderPage(req.params.slug, { preview: { title: b.title, h1: b.h1, content: b.content, side: sideFromBody(b), section: b.section || null } });
  if (!html) return next();
  res.set("X-Robots-Tag", "noindex").send(html.replace("<body", '<body data-preview="1"').replace("</body>", '<div style="position:fixed;bottom:16px;right:16px;z-index:999;background:#a3121a;color:#fff;padding:8px 14px;border-radius:999px;font:600 13px Inter,sans-serif;box-shadow:0 8px 20px rgba(0,0,0,.25)">Aperçu — non enregistré</div></body>'));
}));

router.post("/pages/:slug/restaurer/:id", wrap(async (req, res, next) => {
  const cur = (await db.q("SELECT * FROM pages WHERE slug=$1", [req.params.slug])).rows[0];
  const rev = (await db.q("SELECT * FROM page_revisions WHERE id=$1 AND slug=$2", [Number(req.params.id), req.params.slug])).rows[0];
  if (!cur || !rev) return next();
  await db.q("INSERT INTO page_revisions(slug,title,h1,content,created_by) VALUES ($1,$2,$3,$4,$5)", [cur.slug, cur.title, cur.h1, cur.content, cur.updated_by]);
  await db.q("UPDATE pages SET title=$1, h1=$2, content=$3, updated_at=now(), updated_by=$4 WHERE slug=$5", [rev.title, rev.h1, rev.content, req.user.id, cur.slug]);
  await changed(req, "a restauré une version de la page", R.stripTags(rev.h1), `/admin/pages/${cur.slug}`);
  res.redirect(`/admin/pages/${cur.slug}?ok=restored`);
}));

router.post("/pages/:slug/supprimer", wrap(async (req, res) => {
  const r = await db.q("DELETE FROM pages WHERE slug=$1 RETURNING h1", [req.params.slug]);
  if (r.rows[0]) await changed(req, "a supprimé la page", R.stripTags(r.rows[0].h1));
  res.redirect("/admin/pages?ok=deleted");
}));

// ---------------------------------------------------------------------------
// Menus (navigation principale)
// ---------------------------------------------------------------------------
router.get("/menus", wrap(async (req, res) => {
  const nav = await db.getSetting("nav", []);
  const pages = (await db.q("SELECT slug, h1 FROM pages ORDER BY slug")).rows.map((p) => ({ v: `${p.slug}.html`, t: R.stripTags(p.h1) }));
  const body = `<form method="post" action="/admin/menus" class="card form" data-menu-editor>
    ${csrfField(req)}
    <p class="muted">Faites glisser les éléments pour les réordonner. Une rubrique sans lien affiche un sous-menu ; un lien qui contient plus de 20 sous-liens s'affiche en colonnes (comme les dictionnaires des familles).</p>
    <input type="hidden" name="nav" value="${esc(JSON.stringify(nav))}">
    <script type="application/json" id="page-list">${JSON.stringify([{ v: "agenda.html", t: "Agenda" }, { v: "index.html", t: "Accueil" }, ...pages]).replace(/</g, "\\u003c")}</script>
    <ol class="tree" data-tree></ol>
    <div class="bar"><button type="button" class="btn btn--sm" data-add-root>${icon("plus")} Ajouter une rubrique</button><span class="spacer"></span><button class="btn btn--primary">Enregistrer le menu</button></div>
  </form>`;
  res.send(adminPage(req, { title: "Menu principal", active: "menus", body, scripts: `<script src="/assets/admin/menus.js" defer></script>` }));
}));
router.post("/menus", wrap(async (req, res) => {
  let nav;
  try { nav = JSON.parse(req.body.nav); } catch { return res.status(400).send("Menu invalide."); }
  const clean = (arr, depth) => (Array.isArray(arr) ? arr : []).filter((i) => i && i.label).map((i) => ({
    label: String(i.label).trim(),
    href: i.href ? String(i.href).trim() : null,
    children: depth < 2 && Array.isArray(i.children) && i.children.length ? clean(i.children, depth + 1) : null,
  }));
  await db.setSetting("nav", clean(nav, 0));
  await changed(req, "a modifié", "le menu principal", "/admin/menus");
  res.redirect("/admin/menus?ok=saved");
}));

// ---------------------------------------------------------------------------
// Médiathèque
// ---------------------------------------------------------------------------
router.get("/medias", wrap(async (req, res) => {
  const r = await db.q("SELECT id, filename, mime, size, created_at FROM media ORDER BY created_at DESC");
  const picker = req.query.picker === "1";
  const body = `
  <form method="post" action="/admin/medias" enctype="multipart/form-data" class="dropzone dropzone--wide" data-dropzone data-autosubmit>
    ${csrfField(req)}
    <p class="dropzone__hint">${icon("img")}<br>Glissez vos images ou PDF ici<br><small>ou cliquez pour choisir — 10 Mo max. par fichier</small></p>
    <input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf">
  </form>
  ${r.rows.length ? `<div class="media-grid">${r.rows
    .map((m, i) => {
      const url = `/media/${m.id}/${encodeURIComponent(m.filename)}`;
      return `<figure class="media" style="--i:${Math.min(i, 20)}" data-url="${esc(url)}">
        ${m.mime.startsWith("image/") ? `<img src="${esc(url)}" alt="" loading="lazy">` : `<div class="media__doc">PDF</div>`}
        <figcaption><span title="${esc(m.filename)}">${esc(m.filename)}</span><small>${Math.round(m.size / 1024)} Ko · ${fmtDate(m.created_at)}</small></figcaption>
        <div class="media__actions">
          ${picker ? `<button type="button" class="btn btn--sm btn--primary" data-pick="${esc(url)}">Choisir</button>` : `<button type="button" class="btn btn--sm" data-copy="${esc(url)}">Copier le lien</button>`}
          ${picker ? "" : `<form method="post" action="/admin/medias/${m.id}/supprimer" data-confirm="Supprimer ce fichier ? Les pages qui l'utilisent n'afficheront plus l'image.">${csrfField(req)}<button class="btn btn--sm btn--danger-ghost" title="Supprimer">${icon("trash")}</button></form>`}
        </div>
      </figure>`;
    })
    .join("")}</div>` : `<div class="empty"><p>Aucun fichier pour l'instant.</p></div>`}`;
  if (picker) {
    return res.send(adminPage(req, { title: "Choisir une image", active: "medias", body }).replace('<body class="adm">', '<body class="adm adm--picker">'));
  }
  res.send(adminPage(req, { title: "Médiathèque", active: "medias", body }));
}));
router.post("/medias", upload.array("files", 20), csrfAfterUpload, wrap(async (req, res) => {
  const urls = [];
  for (const f of req.files || []) urls.push(await storeUpload(req, f));
  if (urls.length) await changed(req, "a ajouté", `${urls.length} fichier(s) à la médiathèque`, "/admin/medias");
  if (req.get("accept")?.includes("application/json")) return res.json({ urls });
  res.redirect("/admin/medias?ok=uploaded");
}));
// Envoi d'image depuis l'éditeur de texte
router.post("/medias/editeur", upload.single("file"), wrap(async (req, res) => {
  if (req.get("x-csrf-token") !== req.csrf) return res.status(403).json({ error: "csrf" });
  const url = await storeUpload(req, req.file);
  if (!url) return res.status(400).json({ error: "Format non accepté" });
  await db.log(req.user.id, "a ajouté une image", req.file.originalname, "/admin/medias");
  res.json({ location: url });
}));
router.post("/medias/:id/supprimer", wrap(async (req, res) => {
  const r = await db.q("DELETE FROM media WHERE id=$1 RETURNING filename", [Number(req.params.id)]);
  if (r.rows[0]) await db.log(req.user.id, "a supprimé le fichier", r.rows[0].filename);
  res.redirect("/admin/medias?ok=deleted");
}));

// ---------------------------------------------------------------------------
// Profil & utilisateurs
// ---------------------------------------------------------------------------
router.get("/profil", (req, res) => {
  const body = `<form method="post" action="/admin/profil" class="card form narrow">${csrfField(req)}
    <label>Nom<input type="text" name="name" value="${esc(req.user.name)}"></label>
    <label>Adresse e-mail<input type="email" value="${esc(req.user.email)}" disabled></label>
    <label>Mot de passe actuel<input type="password" name="current" autocomplete="current-password"></label>
    <label>Nouveau mot de passe<input type="password" name="password" minlength="10" autocomplete="new-password"><small>10 caractères minimum. Laissez vide pour ne pas le changer.</small></label>
    <div class="bar"><button class="btn btn--primary">Enregistrer</button></div>
  </form>`;
  res.send(adminPage(req, { title: "Mon profil", active: "profil", body }));
});
router.post("/profil", wrap(async (req, res) => {
  await db.q("UPDATE users SET name=$1 WHERE id=$2", [String(req.body.name || "").trim(), req.user.id]);
  if (req.body.password) {
    const u = (await db.q("SELECT pass_hash FROM users WHERE id=$1", [req.user.id])).rows[0];
    if (!db.checkPassword(String(req.body.current || ""), u.pass_hash)) return res.status(400).send(adminPage(req, { title: "Mon profil", active: "profil", body: `<div class="card"><p>Mot de passe actuel incorrect. <a href="/admin/profil">Réessayer</a></p></div>` }));
    if (String(req.body.password).length < 10) return res.status(400).send("Mot de passe trop court.");
    await db.q("UPDATE users SET pass_hash=$1 WHERE id=$2", [db.hashPassword(String(req.body.password)), req.user.id]);
    await db.q("DELETE FROM sessions WHERE user_id=$1 AND token<>$2", [req.user.id, readCookie(req, COOKIE)]);
    return res.redirect("/admin/profil?ok=password");
  }
  res.redirect("/admin/profil?ok=saved");
}));

router.get("/utilisateurs", requireAdmin, wrap(async (req, res) => {
  const r = await db.q("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY (role='membre'), id");
  const body = `<div class="grid2 grid2--side">
    <section class="card card--flush"><table class="table">
      <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Dernière connexion</th><th></th></tr></thead>
      <tbody>${r.rows
        .map((u) => `<tr><td><span class="avatar avatar--sm">${esc((u.name || u.email).slice(0, 1).toUpperCase())}</span> <strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td>
          <td>${u.role === "admin" ? `<span class="tag tag--info">Administrateur</span>` : u.role === "membre" ? `<span class="tag tag--ok">Membre</span>` : `<span class="tag">Rédacteur</span>`}</td>
          <td class="muted">${fmtDateTime(u.last_login)}</td>
          <td class="actions">${u.id === req.user.id ? `<span class="muted small">vous</span>` : `
            <form method="post" action="/admin/utilisateurs/${u.id}/mot-de-passe" class="inline">${csrfField(req)}<input type="password" name="password" minlength="10" placeholder="Nouveau mot de passe" required><button class="btn btn--sm">OK</button></form>
            <form method="post" action="/admin/utilisateurs/${u.id}/supprimer" data-confirm="Supprimer le compte de ${esc(u.email)} ?">${csrfField(req)}<button class="btn btn--sm btn--danger-ghost">${icon("trash")}</button></form>`}</td></tr>`)
        .join("")}</tbody></table></section>
    <section class="card form">
      <h3>Ajouter un utilisateur</h3>
      <form method="post" action="/admin/utilisateurs" class="form">${csrfField(req)}
        <label>Nom<input type="text" name="name" required></label>
        <label>Adresse e-mail<input type="email" name="email" required></label>
        <label>Mot de passe provisoire<input type="text" name="password" minlength="10" required value="${crypto.randomBytes(9).toString("base64url")}"><small>À transmettre à la personne ; elle pourra le changer dans son profil.</small></label>
        <label>Rôle<select name="role"><option value="membre">Membre — espace membre, liseuse, versions numériques</option><option value="editor">Rédacteur — agenda, pages, menus, boutique, médias</option><option value="admin">Administrateur — tout, y compris les comptes et réglages</option></select></label>
        <button class="btn btn--primary">${icon("plus")} Créer le compte</button>
      </form>
      <hr class="sep">
      <h3>Importer des membres</h3>
      <form method="post" action="/admin/utilisateurs/import" class="form">${csrfField(req)}
        <label>Une ligne par membre : <code>adresse e-mail ; nom</code><textarea name="lines" rows="6" placeholder="jean.dupont@exemple.fr ; Jean DUPONT"></textarea>
        <small>Un mot de passe est généré pour chacun ; la liste s'affiche une seule fois après l'import.</small></label>
        <button class="btn">Importer</button>
      </form>
    </section></div>`;
  res.send(adminPage(req, { title: "Utilisateurs", active: "utilisateurs", body }));
}));
router.post("/utilisateurs", requireAdmin, wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (String(req.body.password || "").length < 10) return res.status(400).send("Mot de passe trop court (10 caractères minimum).");
  await db.q("INSERT INTO users(email,name,pass_hash,role) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING", [
    email, String(req.body.name || "").trim(), db.hashPassword(String(req.body.password)), req.body.role === "admin" ? "admin" : "editor",
  ]);
  await db.log(req.user.id, "a créé le compte", email, "/admin/utilisateurs");
  res.redirect("/admin/utilisateurs?ok=created");
}));
router.post("/utilisateurs/import", requireAdmin, wrap(async (req, res) => {
  const created = [];
  for (const line of String(req.body.lines || "").split(/\r?\n/).slice(0, 2000)) {
    const [email, name] = line.split(/[;,\t]/).map((x) => (x || "").trim());
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) continue;
    const pw = crypto.randomBytes(7).toString("base64url");
    const r = await db.q("INSERT INTO users(email,name,pass_hash,role) VALUES ($1,$2,$3,'membre') ON CONFLICT (email) DO NOTHING RETURNING id", [email.toLowerCase(), name || "", db.hashPassword(pw)]);
    if (r.rows.length) created.push({ email: email.toLowerCase(), name, pw });
  }
  await db.log(req.user.id, "a importé", `${created.length} membre(s)`, "/admin/utilisateurs");
  const body = `<section class="card"><p><strong>${created.length} compte(s) membre créé(s).</strong> Notez ou copiez ces mots de passe maintenant : ils ne seront plus affichés.</p>
    ${created.length ? `<table class="table"><thead><tr><th>E-mail</th><th>Nom</th><th>Mot de passe</th></tr></thead><tbody>${created.map((c) => `<tr><td>${esc(c.email)}</td><td>${esc(c.name)}</td><td><code>${esc(c.pw)}</code></td></tr>`).join("")}</tbody></table>` : ""}
    <div class="bar"><button type="button" class="btn" data-copy-text="${esc(created.map((c) => `${c.email};${c.name};${c.pw}`).join("\n"))}">Copier la liste</button><a class="btn btn--primary" href="/admin/utilisateurs">Terminé</a></div></section>`;
  res.send(adminPage(req, { title: "Import des membres", active: "utilisateurs", body }));
}));
router.post("/utilisateurs/:id/mot-de-passe", requireAdmin, wrap(async (req, res) => {
  if (String(req.body.password || "").length < 10) return res.status(400).send("Mot de passe trop court (10 caractères minimum).");
  await db.q("UPDATE users SET pass_hash=$1 WHERE id=$2", [db.hashPassword(String(req.body.password)), Number(req.params.id)]);
  await db.q("DELETE FROM sessions WHERE user_id=$1", [Number(req.params.id)]);
  res.redirect("/admin/utilisateurs?ok=password");
}));
router.post("/utilisateurs/:id/supprimer", requireAdmin, wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.redirect("/admin/utilisateurs");
  const r = await db.q("DELETE FROM users WHERE id=$1 RETURNING email", [Number(req.params.id)]);
  if (r.rows[0]) await db.log(req.user.id, "a supprimé le compte", r.rows[0].email);
  res.redirect("/admin/utilisateurs?ok=deleted");
}));

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------
router.get("/reglages", requireAdmin, wrap(async (req, res) => {
  const [visitors, since, nPerm, nNews, ship, luxe, payment] = await Promise.all([
    db.getSetting("visitors", 0), db.getSetting("visitors_since", ""), db.getSetting("permanences_count", 7), db.getSetting("news_events_count", 5),
    db.getSetting("shipping", {}), db.getSetting("luxe_supplement", 12), db.getSetting("payment_text", ""),
  ]);
  const body = `<form method="post" action="/admin/reglages" class="card form narrow">${csrfField(req)}
    <h3>Compteur de visiteurs</h3>
    <div class="row"><label>Nombre de visiteurs<input type="number" name="visitors" value="${esc(visitors)}" min="0"></label><label>Depuis le<input type="text" name="since" value="${esc(since)}"></label></div>
    <h3>Agenda</h3>
    <div class="row"><label>Permanences affichées<input type="number" name="nPerm" value="${esc(nPerm)}" min="1" max="60"></label><label>Manifestations dans « Actualités »<input type="number" name="nNews" value="${esc(nNews)}" min="0" max="20"></label></div>
    <h3 id="port">Boutique</h3>
    <div class="row"><label>Supplément version luxe (€)<input type="number" step="0.01" min="0" name="luxe" value="${esc(luxe)}"></label><span></span></div>
    <div class="ship">${Object.entries(ship).map(([k, r]) => `
      <fieldset><legend>Frais de port — ${esc(r.label)}</legend>
        ${r.type === "unitaire"
          ? `<div class="row"><label>France, par exemplaire (€)<input type="number" step="0.01" min="0" name="ship_${k}_france" value="${esc(r.france ?? "")}"></label><label>Outre-mer et étranger, par exemplaire (€)<input type="number" step="0.01" min="0" name="ship_${k}_monde" value="${esc(r.monde ?? "")}" placeholder="à confirmer"></label></div>`
          : `<label>France — paliers « jusqu'à N exemplaires : prix »<input name="ship_${k}_france" value="${esc((r.france || []).map((t) => `${t.max ?? "+"}:${t.price}`).join(" ; "))}"><small>Ex. : 1:9 ; 2:12 ; 6:18 ; +:25</small></label>
             <label>Outre-mer et étranger<input name="ship_${k}_monde" value="${esc((r.monde || []).map((t) => `${t.max ?? "+"}:${t.price}`).join(" ; "))}" placeholder="vide = à confirmer avec le client"></label>`}
      </fieldset>`).join("")}</div>
    <label>Modes de règlement (affichés au panier et sur le bon de commande)<textarea name="payment_text" rows="6">${esc(payment)}</textarea><small>HTML autorisé.</small></label>
    <div class="bar"><button class="btn btn--primary">Enregistrer</button></div>
  </form>`;
  res.send(adminPage(req, { title: "Réglages", active: "reglages", body }));
}));
router.post("/reglages", requireAdmin, wrap(async (req, res) => {
  await db.setSetting("visitors", Math.max(0, parseInt(req.body.visitors, 10) || 0));
  await db.setSetting("visitors_since", String(req.body.since || ""));
  await db.setSetting("permanences_count", Math.min(60, Math.max(1, parseInt(req.body.nPerm, 10) || 7)));
  await db.setSetting("news_events_count", Math.min(20, Math.max(0, parseInt(req.body.nNews, 10) || 5)));
  const ship = await db.getSetting("shipping", {});
  const tiers = (v) => {
    const out = String(v || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const [m, p] = x.split(":").map((y) => y.trim());
      return { max: m === "+" || m === "" ? null : parseInt(m, 10), price: Number(String(p).replace(",", ".")) };
    }).filter((t) => !Number.isNaN(t.price));
    return out.length ? out.sort((a, b) => (a.max ?? 1e9) - (b.max ?? 1e9)) : null;
  };
  const numv = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
  for (const [k, r] of Object.entries(ship)) {
    if (req.body[`ship_${k}_france`] === undefined) continue;
    if (r.type === "unitaire") { r.france = numv(req.body[`ship_${k}_france`]); r.monde = numv(req.body[`ship_${k}_monde`]); }
    else { r.france = tiers(req.body[`ship_${k}_france`]); r.monde = tiers(req.body[`ship_${k}_monde`]); }
  }
  await db.setSetting("shipping", ship);
  if (req.body.luxe !== undefined) await db.setSetting("luxe_supplement", Math.max(0, Number(req.body.luxe) || 0));
  if (req.body.payment_text !== undefined) await db.setSetting("payment_text", String(req.body.payment_text));
  require("./shop").invalidateCatalog();
  await db.log(req.user.id, "a modifié", "les réglages", "/admin/reglages");
  res.redirect("/admin/reglages?ok=saved");
}));

// ---------------------------------------------------------------------------
// Boutique : publications, PDF de la liseuse
// ---------------------------------------------------------------------------
const shop = require("./shop");
const money = (v) => (v == null || v === "" ? "—" : shop.eur(v));
const ACCESS = { achat: "Après achat", membres: "Tous les membres", public: "Tout le monde" };

router.get("/boutique", wrap(async (req, res) => {
  const r = await db.q("SELECT p.*, m.size AS pdf_size FROM products p LEFT JOIN media m ON m.id=p.pdf_media_id ORDER BY p.kind DESC, p.ref");
  const withPdf = r.rows.filter((p) => p.pdf_media_id).length;
  const body = `
  <div class="toolbar">
    <input type="search" class="filter" placeholder="Rechercher (référence, titre, auteur)…" data-filter=".prow" autofocus>
    <div class="chips chips--filter">${[["", "Tout"], ["farda", "Farda"], ["livre", "Livres"], ["pdf", "Avec PDF"], ["nopdf", "Sans PDF"]]
      .map(([v, l], i) => `<button type="button" class="chip${i ? "" : " is-on"}" data-section="${v}">${l}</button>`).join("")}</div>
    <span class="muted small">${withPdf} / ${r.rows.length} avec liseuse</span>
  </div>
  <section class="card card--flush"><table class="table">
    <thead><tr><th></th><th>Réf.</th><th>Publication</th><th>Papier</th><th>Numérique</th><th>Liseuse</th><th></th></tr></thead>
    <tbody>${r.rows.map((p) => `<tr class="prow${p.active ? "" : " is-off"}" data-section="${p.kind}" data-section2="${p.pdf_media_id ? "pdf" : "nopdf"}" data-text="${esc((p.ref + " " + p.title + " " + p.authors).toLowerCase())}">
      <td class="thumb">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}</td>
      <td><code>${esc(p.ref)}</code></td>
      <td><a class="strong" href="/admin/boutique/${encodeURIComponent(p.ref)}">${esc(p.title)}</a>${p.active ? "" : ` <span class="tag">Masquée</span>`}<br><span class="muted small">${esc(p.authors || p.details || "")}</span></td>
      <td>${money(p.price_paper)}${p.luxe ? ` <span class="tag">luxe</span>` : ""}</td>
      <td>${money(p.price_digital)}${p.digital_free_members ? ` <span class="tag tag--ok">gratuit membres</span>` : p.digital_members_only ? ` <span class="tag">membres</span>` : ""}</td>
      <td>${p.pdf_media_id ? `<span class="tag tag--info">PDF · ${Math.round(p.pdf_size / 1024 / 1024 * 10) / 10} Mo</span><br><span class="muted small">${ACCESS[p.read_access]}</span>` : `<span class="muted small">—</span>`}</td>
      <td class="actions"><a class="btn btn--sm" href="/admin/boutique/${encodeURIComponent(p.ref)}">${icon("edit")} Modifier</a>${p.pdf_media_id ? `<a class="btn btn--sm btn--ghost" href="/lire/${encodeURIComponent(p.ref)}" target="_blank" title="Ouvrir dans la liseuse">${icon("book")}</a>` : ""}</td>
    </tr>`).join("")}</tbody></table></section>`;
  res.send(adminPage(req, { title: `Boutique <span class="count">${r.rows.length}</span>`, active: "boutique", body,
    actions: `<a class="btn" href="/admin/reglages#port">Frais de port</a><a class="btn btn--primary" href="/admin/boutique/nouvelle">${icon("plus")} Nouvelle publication</a>` }));
}));

function productForm(req, p, isNew) {
  const body = `<form method="post" action="${isNew ? "/admin/boutique" : `/admin/boutique/${encodeURIComponent(p.ref)}`}" enctype="multipart/form-data" class="editor-layout">
    <input type="hidden" name="_csrf" value="${esc(req.csrf)}">
    <div>
      <div class="card form">
        <div class="row"><label>Référence<input name="ref" value="${esc(p.ref || "")}" required pattern="[A-Za-z0-9_\\-]+" ${isNew ? "" : "readonly"}></label>
          <label>Type<select name="kind"><option value="livre"${p.kind === "livre" ? " selected" : ""}>Livre</option><option value="farda"${p.kind === "farda" ? " selected" : ""}>Farda (revue)</option></select></label></div>
        <label>Titre<input name="title" value="${esc(p.title || "")}" required></label>
        <label>Auteurs<input name="authors" value="${esc(p.authors || "")}"></label>
        <label>Détails<input name="details" value="${esc(p.details || "")}" placeholder="Ex. : 255 pages"></label>
        <div class="row">
          <label>Prix papier (€)<input type="number" step="0.01" min="0" name="price_paper" value="${p.price_paper ?? ""}"><small>Vide = non vendu en papier</small></label>
          <label>Prix numérique (€)<input type="number" step="0.01" min="0" name="price_digital" value="${p.price_digital ?? ""}"><small>Vide = pas de version numérique</small></label>
        </div>
        <label class="check"><input type="checkbox" name="luxe" ${p.luxe ? "checked" : ""}><span>Version luxe proposée (supplément défini dans les réglages)</span></label>
        <label class="check"><input type="checkbox" name="digital_members_only" ${p.digital_members_only ? "checked" : ""}><span>Version numérique réservée aux membres</span></label>
        <label class="check"><input type="checkbox" name="digital_free_members" ${p.digital_free_members ? "checked" : ""}><span>Version numérique gratuite pour les membres</span></label>
        <label>Couverture (adresse de l'image)<div class="input-btn"><input name="cover" value="${esc(p.cover || "")}"><button type="button" class="btn btn--sm" data-pick-into="cover">Médiathèque</button></div></label>
      </div>
    </div>
    <aside class="editor-side">
      <section class="card">
        <h3>Publication</h3>
        <label class="switch"><input type="checkbox" name="active" ${p.active !== false ? "checked" : ""}><span></span><em>En vente sur le site</em></label>
        <div class="bar bar--stack"><button class="btn btn--primary btn--block">${isNew ? "Créer" : "Enregistrer"}</button><a class="btn btn--ghost btn--block" href="/admin/boutique">Retour</a></div>
        ${p.cover ? `<img class="cover-preview" src="${esc(p.cover)}" alt="">` : ""}
      </section>
      <section class="card">
        <h3>Liseuse (PDF)</h3>
        ${p.pdf_media_id ? `<p class="small">PDF en place. <a href="/lire/${encodeURIComponent(p.ref)}" target="_blank">Ouvrir dans la liseuse</a></p><label class="check"><input type="checkbox" name="remove_pdf"><span>Retirer le PDF</span></label>` : `<p class="muted small">Ajoutez le PDF de la publication : il remplace Calaméo et s'ouvre dans la liseuse du site.</p>`}
        <div class="dropzone" data-dropzone><p class="dropzone__hint">${icon("book")}<br>${p.pdf_media_id ? "Remplacer le PDF" : "Glissez le PDF ici"}<br><small>ou cliquez pour choisir (40 Mo max.)</small></p><input type="file" name="pdf" accept="application/pdf"></div>
        <label>Qui peut lire ?<select name="read_access">${Object.entries(ACCESS).map(([v, l]) => `<option value="${v}"${p.read_access === v ? " selected" : ""}>${l}</option>`).join("")}</select>
          <small>« Après achat » : les acheteurs de la version numérique (et les membres si elle leur est gratuite).</small></label>
      </section>
      ${isNew ? "" : `<section class="card card--danger"><h3>Zone sensible</h3><button class="btn btn--sm btn--danger-ghost" formaction="/admin/boutique/${encodeURIComponent(p.ref)}/supprimer" formnovalidate data-confirm="Supprimer cette publication de la boutique ?">${icon("trash")} Supprimer</button></section>`}
    </aside>
  </form>`;
  return adminPage(req, { title: isNew ? "Nouvelle publication" : esc(p.title), active: "boutique", body, wide: true });
}

const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 }, fileFilter: (q, f, cb) => cb(null, f.mimetype === "application/pdf") });
const numOrNull = (v) => (v === "" || v == null ? null : Math.max(0, Number(String(v).replace(",", "."))) || 0);

router.get("/boutique/nouvelle", (req, res) => res.send(productForm(req, { kind: "livre", digital_members_only: true, read_access: "achat", active: true }, true)));
router.get("/boutique/:ref", wrap(async (req, res, next) => {
  const p = (await db.q("SELECT * FROM products WHERE ref=$1", [req.params.ref])).rows[0];
  if (!p) return next();
  res.send(productForm(req, p, false));
}));
async function saveProduct(req, ref, isNew) {
  const b = req.body;
  let pdfId;
  if (req.file) {
    const r = await db.q("INSERT INTO media(filename,mime,size,data,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [`${ref}.pdf`, "application/pdf", req.file.size, req.file.buffer, req.user.id]);
    pdfId = r.rows[0].id;
  }
  const vals = [String(b.kind === "farda" ? "farda" : "livre"), String(b.title || "").trim(), String(b.authors || "").trim(), String(b.details || "").trim(),
    numOrNull(b.price_paper), numOrNull(b.price_digital), b.digital_members_only === "on", b.digital_free_members === "on", b.luxe === "on",
    String(b.cover || "").trim() || null, ["achat", "membres", "public"].includes(b.read_access) ? b.read_access : "achat", b.active === "on"];
  if (isNew) {
    await db.q(`INSERT INTO products(kind,title,authors,details,price_paper,price_digital,digital_members_only,digital_free_members,luxe,cover,read_access,active,ref,pdf_media_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [...vals, ref, pdfId || null]);
  } else {
    const old = (await db.q("SELECT pdf_media_id FROM products WHERE ref=$1", [ref])).rows[0];
    const newPdf = pdfId || (b.remove_pdf === "on" ? null : old?.pdf_media_id);
    await db.q(`UPDATE products SET kind=$1,title=$2,authors=$3,details=$4,price_paper=$5,price_digital=$6,digital_members_only=$7,digital_free_members=$8,luxe=$9,cover=$10,read_access=$11,active=$12,pdf_media_id=$14,updated_at=now() WHERE ref=$13`, [...vals, ref, newPdf]);
    if (old?.pdf_media_id && old.pdf_media_id !== newPdf) await db.q("DELETE FROM media WHERE id=$1", [old.pdf_media_id]);
  }
  shop.invalidateCatalog();
}
router.post("/boutique", pdfUpload.single("pdf"), csrfAfterUpload, wrap(async (req, res) => {
  const ref = String(req.body.ref || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!ref) return res.status(400).send("Référence invalide.");
  if ((await db.q("SELECT 1 FROM products WHERE ref=$1", [ref])).rows.length) return res.status(400).send("Cette référence existe déjà.");
  await saveProduct(req, ref, true);
  await db.log(req.user.id, "a ajouté la publication", ref, `/admin/boutique/${ref}`);
  res.redirect(`/admin/boutique/${encodeURIComponent(ref)}?ok=created`);
}));
router.post("/boutique/:ref", pdfUpload.single("pdf"), csrfAfterUpload, wrap(async (req, res) => {
  await saveProduct(req, req.params.ref, false);
  await db.log(req.user.id, req.file ? "a ajouté le PDF de" : "a modifié la publication", req.params.ref, `/admin/boutique/${req.params.ref}`);
  res.redirect(`/admin/boutique/${encodeURIComponent(req.params.ref)}?ok=saved`);
}));
router.post("/boutique/:ref/supprimer", upload.none(), csrfAfterUpload, wrap(async (req, res) => {
  const r = await db.q("DELETE FROM products WHERE ref=$1 RETURNING pdf_media_id", [req.params.ref]);
  if (r.rows[0]?.pdf_media_id) await db.q("DELETE FROM media WHERE id=$1", [r.rows[0].pdf_media_id]);
  shop.invalidateCatalog();
  await db.log(req.user.id, "a supprimé la publication", req.params.ref);
  res.redirect("/admin/boutique?ok=deleted");
}));

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------
router.get("/commandes", wrap(async (req, res) => {
  const st = Object.keys(shop.STATUS).includes(req.query.statut) ? req.query.statut : "";
  const r = await db.q(`SELECT * FROM orders ${st ? "WHERE status=$1" : ""} ORDER BY created_at DESC LIMIT 300`, st ? [st] : []);
  const counts = (await db.q("SELECT status, count(*)::int n, coalesce(sum(total),0) t FROM orders GROUP BY status")).rows;
  const cnt = Object.fromEntries(counts.map((c) => [c.status, c]));
  const body = `
  <nav class="tabs"><a href="/admin/commandes" class="${st ? "" : "is-active"}">Toutes</a>${Object.entries(shop.STATUS).map(([k, l]) => `<a href="?statut=${k}" class="${st === k ? "is-active" : ""}">${l} <span class="count">${cnt[k]?.n || 0}</span></a>`).join("")}</nav>
  ${r.rows.length ? `<section class="card card--flush"><table class="table">
    <thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Articles</th><th>Total</th><th>Statut</th><th></th></tr></thead>
    <tbody>${r.rows.map((o) => `<tr>
      <td><a class="strong" href="/admin/commandes/${esc(o.number)}">${esc(o.number)}</a></td>
      <td class="muted">${fmtDateTime(o.created_at)}</td>
      <td>${esc(`${o.customer.prenom} ${o.customer.nom}`)}<br><span class="muted small">${esc(o.customer.ville)} · ${esc(o.customer.email)}</span></td>
      <td>${o.items.reduce((s, i) => s + i.qty, 0)}</td>
      <td><strong>${shop.eur(o.total)}</strong>${o.shipping == null ? `<br><span class="muted small">port à confirmer</span>` : ""}</td>
      <td><span class="ostatus ostatus--${o.status}">${shop.STATUS[o.status]}</span></td>
      <td class="actions"><a class="btn btn--sm" href="/admin/commandes/${esc(o.number)}">Ouvrir</a></td></tr>`).join("")}</tbody></table></section>`
    : `<div class="empty"><p>Aucune commande${st ? " avec ce statut" : " pour l'instant"}.</p><p class="small">Les visiteurs ajoutent des livres ou des Farda au panier depuis les pages du site, puis valident leur commande.</p></div>`}`;
  res.send(adminPage(req, { title: "Commandes", active: "commandes", body }));
}));

router.get("/commandes/:number", wrap(async (req, res, next) => {
  const o = (await db.q("SELECT * FROM orders WHERE number=$1", [req.params.number])).rows[0];
  if (!o) return next();
  const c = o.customer;
  const steps = ["nouvelle", "payee", "expediee"];
  const body = `
  <div class="ostepper">${steps.map((s, i) => `<span class="ostep${steps.indexOf(o.status) >= i ? " is-done" : ""}${o.status === s ? " is-current" : ""}">${shop.STATUS[s]}</span>`).join("")}${o.status === "annulee" ? `<span class="ostep is-cancel">Annulée</span>` : ""}</div>
  <div class="editor-layout">
    <div>
      <section class="card">${shop.orderTable(o)}${o.note ? `<p><strong>Message du client :</strong> ${esc(o.note)}</p>` : ""}</section>
    </div>
    <aside class="editor-side">
      <section class="card">
        <h3>Client</h3>
        <p>${esc(`${c.civilite} ${c.prenom} ${c.nom}`.trim())}<br>${esc(c.adresse)}<br>${esc(c.cp)} ${esc(c.ville)}<br>${esc(c.pays)}</p>
        <p><a href="mailto:${esc(c.email)}?subject=${encodeURIComponent(`Votre commande G.G.A.C. n° ${o.number}`)}">${esc(c.email)}</a>${c.tel ? `<br>${esc(c.tel)}` : ""}</p>
        <p class="small muted">Règlement prévu : ${esc(o.payment || "—")}<br>Livraison : ${o.zone === "monde" ? "outre-mer / étranger" : "France"}</p>
      </section>
      <form class="card form" method="post" action="/admin/commandes/${esc(o.number)}">${csrfField(req)}
        <h3>Suivi</h3>
        <label>Statut<select name="status">${Object.entries(shop.STATUS).map(([k, l]) => `<option value="${k}"${o.status === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        ${o.shipping == null ? `<label>Frais de port (€)<input type="number" step="0.01" min="0" name="shipping" placeholder="à confirmer"></label>` : ""}
        <label>Note interne<textarea name="admin_note" rows="3">${esc(o.admin_note)}</textarea></label>
        <button class="btn btn--primary btn--block">Enregistrer</button>
        <p class="small muted">Lien client (bon de commande, lecture des versions numériques une fois réglée) :<br><a href="/commande/${esc(o.token)}" target="_blank">/commande/${esc(o.token.slice(0, 8))}…</a> <button type="button" class="btn btn--sm btn--ghost" data-copy="/commande/${esc(o.token)}">Copier</button></p>
      </form>
    </aside>
  </div>`;
  res.send(adminPage(req, { title: `Commande ${esc(o.number)}`, active: "commandes", body, wide: true,
    actions: `<a class="btn btn--ghost" href="/admin/commandes">← Commandes</a><a class="btn" href="/commande/${esc(o.token)}" target="_blank">${icon("eye")} Bon de commande</a>` }));
}));
router.post("/commandes/:number", wrap(async (req, res, next) => {
  const o = (await db.q("SELECT * FROM orders WHERE number=$1", [req.params.number])).rows[0];
  if (!o) return next();
  const status = Object.keys(shop.STATUS).includes(req.body.status) ? req.body.status : o.status;
  let shipping = o.shipping, total = o.total;
  if (o.shipping == null && req.body.shipping !== undefined && req.body.shipping !== "") {
    shipping = Math.max(0, Number(String(req.body.shipping).replace(",", ".")) || 0);
    total = +(Number(o.subtotal) + shipping).toFixed(2);
  }
  await db.q("UPDATE orders SET status=$1, shipping=$2, total=$3, admin_note=$4, updated_at=now() WHERE id=$5", [status, shipping, total, String(req.body.admin_note || ""), o.id]);
  if (status !== o.status) await db.log(req.user.id, `a passé la commande au statut « ${shop.STATUS[status]} » :`, o.number, `/admin/commandes/${o.number}`);
  res.redirect(`/admin/commandes/${o.number}?ok=saved`);
}));

// Généalogie (arbres, GEDCOM, personnes, familles)
require("./admin-genealogy")(router, { adminPage, csrfField, icon, wrap, requireAdmin, fmtDateTime });

module.exports = { router };
