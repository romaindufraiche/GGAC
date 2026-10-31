"use strict";
/* Boutique (panier, commandes), espace membre et liseuse intégrée */
const crypto = require("crypto");
const https = require("https");
const express = require("express");
const db = require("./db");
const R = require("./render");

const router = express.Router();
const { esc } = R;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const json = express.json({ limit: "200kb" });
const form = express.urlencoded({ extended: true, limit: "200kb" });

const MEMBER_COOKIE = "ggac_m";
const eur = (n) => (n == null ? "—" : `${Number(n).toFixed(2).replace(".", ",").replace(",00", "")} €`);
const num = (v) => (v == null ? null : Number(v));

// ---------------------------------------------------------------------------
// Session « membre » (cookie distinct de celui de l'administration)
// ---------------------------------------------------------------------------
function readCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
async function currentMember(req) {
  if (req._member !== undefined) return req._member;
  const token = readCookie(req, MEMBER_COOKIE);
  let m = null;
  if (token) {
    const r = await db.q(
      "SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at > now()",
      [token]
    );
    m = r.rows[0] || null;
  }
  req._member = m;
  return m;
}

// ---------------------------------------------------------------------------
// Catalogue & droits de lecture
// ---------------------------------------------------------------------------
let catalogCache = null;
const invalidateCatalog = () => { catalogCache = null; };

async function catalog() {
  if (catalogCache) return catalogCache;
  const r = await db.q("SELECT * FROM products WHERE active ORDER BY kind DESC, ref");
  catalogCache = new Map(r.rows.map((p) => [p.ref, p]));
  return catalogCache;
}

/** Références achetées en numérique par un membre (commandes réglées) */
async function purchasedRefs(userId) {
  if (!userId) return new Set();
  const r = await db.q("SELECT items FROM orders WHERE user_id=$1 AND status IN ('payee','expediee')", [userId]);
  const s = new Set();
  r.rows.forEach((o) => o.items.forEach((i) => i.format === "numerique" && s.add(i.ref)));
  return s;
}

async function canRead(p, member, orderToken) {
  if (!p || !p.pdf_media_id) return false;
  if (p.read_access === "public") return true;
  if (member && (p.read_access === "membres" || p.digital_free_members)) return true;
  if (member && (await purchasedRefs(member.id)).has(p.ref)) return true;
  if (orderToken) {
    const o = (await db.q("SELECT items, status FROM orders WHERE token=$1", [orderToken])).rows[0];
    if (o && ["payee", "expediee"].includes(o.status) && o.items.some((i) => i.ref === p.ref && i.format === "numerique")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Calcul d'un devis (toujours côté serveur)
// ---------------------------------------------------------------------------
async function quote(rawItems, zone, member) {
  const cat = await catalog();
  const [rules, luxeSup] = await Promise.all([db.getSetting("shipping", {}), db.getSetting("luxe_supplement", 12)]);
  const lines = [];
  const errors = [];
  const seen = new Set();
  for (const it of Array.isArray(rawItems) ? rawItems.slice(0, 200) : []) {
    const p = cat.get(String(it.ref || ""));
    if (!p) { errors.push(`Référence inconnue : ${String(it.ref || "").slice(0, 20)}`); continue; }
    const format = it.format === "numerique" ? "numerique" : "papier";
    const luxe = format === "papier" && !!it.luxe && p.luxe;
    const key = `${p.ref}|${format}|${luxe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let qty = Math.max(1, Math.min(50, parseInt(it.qty, 10) || 1));
    let unit;
    if (format === "numerique") {
      qty = 1;
      if (num(p.price_digital) == null) { errors.push(`${p.title} : pas de version numérique.`); continue; }
      if (p.digital_members_only && !member) { errors.push(`${p.title} : la version numérique est réservée aux membres (connectez-vous à l'espace membre).`); continue; }
      unit = p.digital_free_members && member ? 0 : num(p.price_digital);
    } else {
      if (num(p.price_paper) == null) { errors.push(`${p.title} : prix papier non communiqué.`); continue; }
      unit = num(p.price_paper) + (luxe ? Number(luxeSup) : 0);
    }
    lines.push({ ref: p.ref, kind: p.kind, title: p.title, details: p.details, cover: p.cover, format, luxe, qty, unit, total: +(unit * qty).toFixed(2) });
  }
  const subtotal = +lines.reduce((s, l) => s + l.total, 0).toFixed(2);

  // Frais de port par catégorie
  let shipping = 0;
  let shippingKnown = true;
  const z = zone === "monde" ? "monde" : "france";
  const detail = [];
  const byKind = {};
  lines.filter((l) => l.format === "papier").forEach((l) => (byKind[l.kind] = (byKind[l.kind] || 0) + l.qty));
  for (const [kind, count] of Object.entries(byKind)) {
    const rule = rules[kind] || rules.livre;
    const def = rule && rule[z];
    let cost = null;
    if (rule && def != null) {
      if (rule.type === "unitaire") cost = Number(def) * count;
      else if (Array.isArray(def)) cost = Number((def.find((t) => t.max == null || count <= t.max) || def[def.length - 1]).price);
    }
    if (cost == null) shippingKnown = false;
    else shipping += cost;
    detail.push({ label: rule?.label || kind, count, cost });
  }
  shipping = +shipping.toFixed(2);
  return { lines, errors, subtotal, shipping: shippingKnown ? shipping : null, shippingDetail: detail, total: +(subtotal + (shippingKnown ? shipping : 0)).toFixed(2), zone: z, member: !!member };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------
router.get("/api/catalogue", wrap(async (req, res) => {
  const cat = await catalog();
  const out = {};
  for (const p of cat.values()) {
    out[p.ref] = {
      t: p.title, k: p.kind, pp: num(p.price_paper), pd: num(p.price_digital), l: p.luxe,
      dmo: p.digital_members_only, dfm: p.digital_free_members, c: p.cover, pdf: !!p.pdf_media_id,
    };
  }
  res.set("Cache-Control", "no-cache").json({ products: out, luxe: Number(await db.getSetting("luxe_supplement", 12)) });
}));

router.get("/api/session", wrap(async (req, res) => {
  const m = await currentMember(req);
  const cat = await catalog();
  const readable = [];
  for (const p of cat.values()) if (p.pdf_media_id && (await canRead(p, m))) readable.push(p.ref);
  res.set("Cache-Control", "no-store").json({ member: m ? { name: m.name || m.email } : null, readable });
}));

router.post("/api/devis", json, wrap(async (req, res) => {
  res.json(await quote(req.body.items, req.body.zone, await currentMember(req)));
}));

// ---------------------------------------------------------------------------
// Panier
// ---------------------------------------------------------------------------
router.get("/panier.html", wrap(async (req, res) => {
  const m = await currentMember(req);
  const payment = await db.getSetting("payment_text", "");
  const main = `<div class="shop" data-cart-page>
  <div class="cart-page">
    <section class="cart-lines" aria-live="polite"><div class="cart-empty" hidden>
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 14h8l6 30h28l6-22H20"/><circle cx="26" cy="52" r="4"/><circle cx="46" cy="52" r="4"/></svg>
      <p>Votre panier est vide.</p>
      <p><a class="btn-ink" href="/page-62.html">Nouvelles publications</a> <a class="btn-ink btn-ink--ghost" href="/page-26.html">Dictionnaires des familles</a> <a class="btn-ink btn-ink--ghost" href="/page-9.html">Farda</a></p>
    </div><ul class="cart-list"></ul></section>
    <aside class="cart-summary" hidden>
      <h2>Récapitulatif</h2>
      <label class="field">Livraison
        <select name="zone" data-zone><option value="france">France métropolitaine</option><option value="monde">Outre-mer et étranger</option></select>
      </label>
      <dl class="totals"></dl>
      <p class="cart-errors" hidden></p>
      ${m ? `<p class="cart-member">Connecté en tant que membre : <strong>${esc(m.name || m.email)}</strong></p>` : `<p class="cart-member">Membre ? <a href="/espace-membre.html?retour=/panier.html">Connectez-vous</a> pour les versions numériques.</p>`}
    </aside>
  </div>
  <form class="checkout" method="post" action="/commande" hidden>
    <h2>Vos coordonnées</h2>
    <div class="grid">
      <label class="field">Civilité<select name="civilite"><option value=""></option><option>M.</option><option>Mme</option></select></label>
      <label class="field">Prénom<input name="prenom" required autocomplete="given-name"></label>
      <label class="field">Nom<input name="nom" required autocomplete="family-name"></label>
      <label class="field field--wide">Adresse<input name="adresse" required autocomplete="street-address"></label>
      <label class="field">Code postal<input name="cp" required autocomplete="postal-code"></label>
      <label class="field">Ville<input name="ville" required autocomplete="address-level2"></label>
      <label class="field">Pays<input name="pays" value="France" required autocomplete="country-name"></label>
      <label class="field">Adresse de courriel<input type="email" name="email" required autocomplete="email" value="${m ? esc(m.email) : ""}"></label>
      <label class="field">Numéro de téléphone<input name="tel" autocomplete="tel"></label>
      <label class="field field--wide">Message<textarea name="note" rows="3"></textarea></label>
    </div>
    <h2>Modes de règlement</h2>
    <div class="payment">${payment}</div>
    <label class="field">Je règlerai par<select name="payment" required><option value="">—</option><option>Chèque</option><option>Mandat postal</option><option>Mandat postal international / International Money Order</option><option>Espèces lors d'une permanence</option></select></label>
    <input type="hidden" name="cart"><input type="hidden" name="zone" value="france">
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn-ink btn-ink--big" type="submit">Valider la commande</button>
  </form>
</div>`;
  res.set("Cache-Control", "no-store").type("html").send(await R.renderShell({ title: "Panier - Groupe des Généalogistes Amateurs du Cambrésis", h1: "Panier", main, bodyClass: "is-shop" }));
}));

const recent = new Map(); // limitation : 5 commandes / 10 min / IP
router.post("/commande", form, wrap(async (req, res) => {
  if (req.body.website) return res.redirect("/panier.html"); // pot de miel anti-robots
  const ip = req.ip;
  const hits = (recent.get(ip) || []).filter((t) => Date.now() - t < 10 * 60e3);
  if (hits.length >= 5) return res.status(429).send("Trop de commandes en peu de temps. Réessayez plus tard.");
  hits.push(Date.now()); recent.set(ip, hits);

  let items;
  try { items = JSON.parse(req.body.cart || "[]"); } catch { items = []; }
  const m = await currentMember(req);
  const q = await quote(items, req.body.zone, m);
  if (!q.lines.length) return res.redirect("/panier.html");
  const b = req.body;
  const clip = (v, n = 200) => String(v || "").trim().slice(0, n);
  const customer = { civilite: clip(b.civilite, 10), prenom: clip(b.prenom, 80), nom: clip(b.nom, 80), adresse: clip(b.adresse), cp: clip(b.cp, 20), ville: clip(b.ville, 80), pays: clip(b.pays, 80), email: clip(b.email, 160), tel: clip(b.tel, 40) };
  if (!customer.nom || !customer.email || !customer.adresse) return res.status(400).send("Coordonnées incomplètes.");
  const year = new Date().getFullYear();
  const n = (await db.q("SELECT count(*)::int n FROM orders WHERE number LIKE $1", [`${year}-%`])).rows[0].n + 1;
  const number = `${year}-${String(n).padStart(4, "0")}`;
  const token = crypto.randomBytes(18).toString("base64url");
  await db.q(
    `INSERT INTO orders(number,token,user_id,customer,zone,items,subtotal,shipping,total,payment,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [number, token, m ? m.id : null, customer, q.zone, JSON.stringify(q.lines), q.subtotal, q.shipping, q.total, clip(b.payment, 80), clip(b.note, 2000)]
  );
  await db.log(m ? m.id : null, "a reçu la commande", number, `/admin/commandes/${number}`);
  res.redirect(`/commande/${token}?nouvelle=1`);
}));

const STATUS = { nouvelle: "En attente de règlement", payee: "Réglée", expediee: "Expédiée", annulee: "Annulée" };

function orderTable(o) {
  return `<table class="order-table"><thead><tr><th>Référence</th><th>Publication</th><th>Version</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead><tbody>${o.items
    .map((l) => `<tr><td>${esc(l.ref)}</td><td>${esc(l.title)}</td><td>${l.format === "numerique" ? "Numérique" : `Papier${l.luxe ? " — luxe" : ""}`}</td><td>${l.qty}</td><td>${eur(l.unit)}</td><td>${eur(l.total)}</td></tr>`)
    .join("")}</tbody><tfoot>
    <tr><td colspan="5">Sous-total</td><td>${eur(o.subtotal)}</td></tr>
    <tr><td colspan="5">Frais de port (${o.zone === "monde" ? "outre-mer et étranger" : "France"})</td><td>${o.shipping == null ? "à confirmer" : eur(o.shipping)}</td></tr>
    <tr class="grand"><td colspan="5">Total${o.shipping == null ? " (hors port)" : ""}</td><td>${eur(o.total)}</td></tr></tfoot></table>`;
}

router.get("/commande/:token", wrap(async (req, res, next) => {
  const o = (await db.q("SELECT * FROM orders WHERE token=$1", [req.params.token])).rows[0];
  if (!o) return next();
  const payment = await db.getSetting("payment_text", "");
  const cat = await catalog();
  const paid = ["payee", "expediee"].includes(o.status);
  const reads = o.items.filter((l) => l.format === "numerique").map((l) => cat.get(l.ref)).filter((p) => p && p.pdf_media_id);
  const c = o.customer;
  const main = `<div class="order" data-order>
  ${req.query.nouvelle ? `<div class="order-done"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg><div><strong>Merci, votre commande n° ${esc(o.number)} est enregistrée.</strong><br>Conservez cette page (ou imprimez-la) : elle sert de bon de commande et vous permettra de suivre son avancement.</div></div>` : ""}
  <div class="order-head">
    <div><p class="order-num">Commande n° ${esc(o.number)}</p><p class="muted">du ${esc(new Date(o.created_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }))}</p></div>
    <span class="order-status order-status--${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
  </div>
  <div class="order-grid">
    <section><h2>Coordonnées</h2><p>${esc(`${c.civilite} ${c.prenom} ${c.nom}`.trim())}<br>${esc(c.adresse)}<br>${esc(c.cp)} ${esc(c.ville)}<br>${esc(c.pays)}<br>${esc(c.email)}${c.tel ? `<br>${esc(c.tel)}` : ""}</p></section>
    <section><h2>Règlement</h2><p>${esc(o.payment || "—")}</p>${o.status === "nouvelle" ? `<div class="payment">${payment}</div>` : ""}</section>
  </div>
  ${orderTable(o)}
  ${o.note ? `<p><strong>Message :</strong> ${esc(o.note)}</p>` : ""}
  ${reads.length ? `<section class="order-reads"><h2>Versions numériques</h2>${paid ? `<ul>${reads.map((p) => `<li><a class="btn-ink" href="/lire/${encodeURIComponent(p.ref)}?commande=${encodeURIComponent(o.token)}">Lire « ${esc(p.title)} »</a></li>`).join("")}</ul>` : `<p class="muted">Elles seront accessibles ici dès réception de votre règlement.</p>`}</section>` : ""}
  <p class="no-print"><button type="button" class="btn-ink btn-ink--ghost" onclick="window.print()">Imprimer le bon de commande</button> <a class="btn-ink btn-ink--ghost" href="/panier.html">Retour au panier</a></p>
</div>`;
  res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex").type("html")
    .send(await R.renderShell({ title: `Commande ${o.number} - G.G.A.C.`, h1: "Bon de commande", main, bodyClass: "is-shop" }));
}));

// ---------------------------------------------------------------------------
// Espace membre
// ---------------------------------------------------------------------------
router.get("/espace-membre.html", wrap(async (req, res) => {
  const m = await currentMember(req);
  const back = String(req.query.retour || "");
  let main;
  if (!m) {
    main = `<div class="prose member-login">
      <h2 class="ta-c surligne">L'espace membre n'est accessible que pour les membres à jour de leur cotisation.</h2>
      ${req.query.e ? `<p class="login-err">Adresse email ou mot de passe incorrect.</p>` : ""}
      ${req.query.lire ? `<p class="login-err">Ce document est réservé : connectez-vous pour le lire.</p>` : ""}
      <form method="post" action="/membre/connexion" class="member-form">
        <label for="mail_membre"><strong>Adresse email :</strong></label><input name="email" type="email" id="mail_membre" required autocomplete="username">
        <label for="pass_membre"><strong>Mot de passe :</strong></label><input name="password" type="password" id="pass_membre" required autocomplete="current-password">
        <input type="hidden" name="retour" value="${esc(back)}">
        <button class="btn-ink" type="submit">Connexion</button>
      </form>
      <p class="ta-c">Première connexion ou mot de passe oublié : <a href="/contacts.html">cliquez ici</a>.</p>
    </div>`;
  } else {
    const cat = await catalog();
    const bought = await purchasedRefs(m.id);
    const lib = [...cat.values()].filter((p) => p.pdf_media_id && (p.read_access !== "achat" || p.digital_free_members || bought.has(p.ref)));
    const orders = (await db.q("SELECT number, token, status, total, created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC", [m.id])).rows;
    main = `<div class="member">
      <div class="member-head"><p>Bonjour <strong>${esc(m.name || m.email)}</strong></p>
        <form method="post" action="/membre/deconnexion"><button class="btn-ink btn-ink--ghost" type="submit">Déconnexion</button></form></div>
      <h2 class="block__title">Ma bibliothèque</h2>
      ${lib.length ? `<div class="shelf">${lib
        .map((p, i) => `<a class="shelf__book" href="/lire/${encodeURIComponent(p.ref)}" style="--i:${Math.min(i, 30)}"><span class="shelf__cover">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}</span><span class="shelf__title">${esc(p.title)}</span><span class="shelf__meta">${esc(p.details || "")}</span></a>`)
        .join("")}</div>` : `<p class="muted">Aucun document numérique n'est encore disponible.</p>`}
      ${orders.length ? `<h2 class="block__title">Mes commandes</h2><ul class="member-orders">${orders
        .map((o) => `<li><a href="/commande/${esc(o.token)}">Commande n° ${esc(o.number)}</a> <span class="order-status order-status--${esc(o.status)}">${esc(STATUS[o.status])}</span> <span class="muted">${eur(o.total)}</span></li>`)
        .join("")}</ul>` : ""}
    </div>`;
  }
  res.set("Cache-Control", "no-store").type("html").send(await R.renderShell({
    title: "Connexion à l'espace membre - Groupe des Généalogistes Amateurs du Cambrésis",
    h1: m ? "Espace membre" : "Connexion à l'espace membre", main, bodyClass: "is-shop",
  }));
}));

const loginTries = new Map();
router.post("/membre/connexion", form, wrap(async (req, res) => {
  const ip = req.ip;
  const a = loginTries.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).send("Trop de tentatives. Réessayez dans quelques minutes.");
  const u = (await db.q("SELECT * FROM users WHERE email=$1", [String(req.body.email || "").trim().toLowerCase()])).rows[0];
  const back = String(req.body.retour || "");
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/espace-membre.html";
  if (!u || !db.checkPassword(String(req.body.password || ""), u.pass_hash)) {
    a.n++; loginTries.set(ip, a);
    return res.redirect(`/espace-membre.html?e=1${back ? `&retour=${encodeURIComponent(back)}` : ""}`);
  }
  loginTries.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  await db.q("INSERT INTO sessions(token,user_id,csrf,expires_at) VALUES ($1,$2,$3, now() + interval '60 days')", [token, u.id, crypto.randomBytes(12).toString("hex")]);
  await db.q("UPDATE users SET last_login=now() WHERE id=$1", [u.id]);
  res.append("Set-Cookie", `${MEMBER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 86400}${req.secure ? "; Secure" : ""}`);
  res.redirect(safeBack);
}));
router.post("/membre/deconnexion", wrap(async (req, res) => {
  const t = readCookie(req, MEMBER_COOKIE);
  if (t) await db.q("DELETE FROM sessions WHERE token=$1", [t]);
  res.append("Set-Cookie", `${MEMBER_COOKIE}=; Path=/; Max-Age=0`);
  res.redirect("/espace-membre.html");
}));

// ---------------------------------------------------------------------------
// Liseuse
// ---------------------------------------------------------------------------
const PROXY_OK = /^https:\/\/www\.ggac\.fr\/fichiers\/[\w\-./%]+\.pdf$/i;

function readerPage({ title, src, back }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - G.G.A.C.</title><meta name="robots" content="noindex">
<link rel="icon" href="/assets/img/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/reader.css"></head>
<body class="reader" data-src="${esc(src)}">
<header class="rd-bar">
  <a class="rd-back" href="${esc(back)}" title="Retour"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></a>
  <img class="rd-logo" src="/assets/img/apple-touch-icon.png" alt="">
  <h1 class="rd-title">${esc(title)}</h1>
  <div class="rd-tools">
    <button data-act="thumbs" title="Miniatures"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>
    <button data-act="search" title="Rechercher dans le document"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg></button>
    <button data-act="mode" title="Mode livre / défilement"><svg viewBox="0 0 24 24"><path d="M2 5h8a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H2zM22 5h-8a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h8z"/></svg></button>
    <button data-act="zoomout" title="Réduire"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
    <span class="rd-zoom">100 %</span>
    <button data-act="zoomin" title="Agrandir"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    <button data-act="full" title="Plein écran"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
  </div>
</header>
<form class="rd-search" hidden><input type="search" placeholder="Rechercher un nom, un lieu…" aria-label="Rechercher"><span class="rd-search__info"></span><button type="button" data-act="prevhit">‹</button><button type="button" data-act="nexthit">›</button></form>
<aside class="rd-thumbs" hidden></aside>
<main class="rd-stage">
  <div class="rd-loading"><svg viewBox="0 0 120 140"><path d="M10 10 H110 V70 C110 105 85 122 60 132 C35 122 10 105 10 70 Z"/></svg><span>Ouverture du document…</span></div>
  <div class="rd-book" hidden></div>
  <div class="rd-scroll" hidden></div>
</main>
<nav class="rd-nav">
  <button data-act="prev" title="Page précédente"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
  <label class="rd-page"><input type="number" min="1" value="1" aria-label="Page"> / <span class="rd-total">…</span></label>
  <input class="rd-range" type="range" min="1" value="1" aria-label="Aller à la page">
  <button data-act="next" title="Page suivante"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
</nav>
<script type="module" src="/assets/js/reader.js"></script>
</body></html>`;
}

router.get("/lire/:ref", wrap(async (req, res, next) => {
  const p = (await catalog()).get(req.params.ref) || (await db.q("SELECT * FROM products WHERE ref=$1", [req.params.ref])).rows[0];
  if (!p || !p.pdf_media_id) return next();
  const m = await currentMember(req);
  const token = req.query.commande ? String(req.query.commande) : null;
  if (!(await canRead(p, m, token))) return res.redirect(`/espace-membre.html?lire=1&retour=${encodeURIComponent(req.originalUrl)}`);
  const src = `/document/${encodeURIComponent(p.ref)}${token ? `?commande=${encodeURIComponent(token)}` : ""}`;
  const back = req.get("referer") && new URL(req.get("referer"), "http://x").pathname !== req.path ? req.get("referer") : "/espace-membre.html";
  res.set("Cache-Control", "no-store").type("html").send(readerPage({ title: p.title, src, back }));
}));

router.get("/document/:ref", wrap(async (req, res, next) => {
  const p = (await db.q("SELECT * FROM products WHERE ref=$1", [req.params.ref])).rows[0];
  if (!p || !p.pdf_media_id) return next();
  if (!(await canRead(p, await currentMember(req), req.query.commande ? String(req.query.commande) : null))) return res.sendStatus(403);
  const f = (await db.q("SELECT data FROM media WHERE id=$1", [p.pdf_media_id])).rows[0];
  if (!f) return next();
  res.set({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": "inline", "X-Robots-Tag": "noindex" }).send(f.data);
}));

// Liseuse pour les PDF publics (médiathèque ou anciens fichiers du site)
router.get("/lire", wrap(async (req, res) => {
  const src = String(req.query.src || "");
  let url;
  if (/^\/media\/\d+\//.test(src)) url = src;
  else if (PROXY_OK.test(src)) url = `/pdf?url=${encodeURIComponent(src)}`;
  else return res.status(400).send("Document non pris en charge.");
  const title = decodeURIComponent(src.split("/").pop().replace(/\.pdf$/i, "")).replace(/[_-]+/g, " ");
  res.type("html").send(readerPage({ title, src: url, back: req.get("referer") || "/" }));
}));
router.get("/pdf", (req, res) => {
  const url = String(req.query.url || "");
  if (!PROXY_OK.test(url)) return res.sendStatus(400);
  https.get(url, (up) => {
    if (up.statusCode !== 200) { up.resume(); return res.sendStatus(up.statusCode === 404 ? 404 : 502); }
    res.set({ "Content-Type": "application/pdf", "Cache-Control": "public, max-age=86400" });
    up.pipe(res);
  }).on("error", () => res.sendStatus(502));
});

module.exports = { router, invalidateCatalog, quote, STATUS, orderTable, eur };
