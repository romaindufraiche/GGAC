"use strict";
/* Administration de la généalogie : arbres, import/export GEDCOM, personnes, familles */
const multer = require("multer");
const db = require("./db");
const G = require("./gedcom");
const S = require("./gen-store");
const { esc } = require("./render");

const gedUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });

module.exports = function mount(router, h) {
  const { adminPage, csrfField, icon, wrap, requireAdmin, fmtDateTime } = h;
  const A = "/admin/genealogie";
  const T = (t) => `${A}/${encodeURIComponent(t)}`;
  const P = (t, id) => `${T(t)}/personne/${encodeURIComponent(id)}`;
  const name = (p) => (p ? `${p.given || "…"} ${(p.surname || "").toUpperCase()}`.trim() : "");
  const years = (p) => { const b = p?.birth_year || p?.chr_year, d = p?.death_year || p?.buri_year; return b || d ? `${b || "?"}–${d || ""}` : ""; };
  const pLink = (t, p) => (p ? `<a href="${P(t, p.id)}" class="strong">${esc(name(p))}</a> <span class="muted small">${esc(p.id)} ${esc(years(p))}</span>` : "");
  const csrfOk = (req, res, next) => (req.body && req.body._csrf === req.csrf ? next() : res.status(403).send("Jeton de sécurité invalide."));
  const done = async (req, action, target, link) => { await db.log(req.user.id, action, target, link); await db.touchSite(); };
  const scripts = `<script src="/assets/admin/genealogy-admin.js" defer></script>`;

  async function tree(id) { return (await db.q("SELECT * FROM gen_trees WHERE id=$1", [id])).rows[0]; }

  // ------------------------------------------------------------------ Arbres
  router.get("/genealogie", wrap(async (req, res) => {
    const r = await db.q(`SELECT t.*, (SELECT count(*) FROM gen_people p WHERE p.tree=t.id)::int np, (SELECT count(*) FROM gen_families f WHERE f.tree=t.id)::int nf,
      (SELECT count(*) FROM gen_people p WHERE p.tree=t.id AND p.living)::int nl FROM gen_trees t ORDER BY t.name`);
    const [hide, yrs] = await Promise.all([db.getSetting("gen_hide_living", true), db.getSetting("gen_living_years", 100)]);
    const body = `
    ${r.rows.length ? `<div class="trees">${r.rows.map((t, i) => `<article class="card tree-card" style="--i:${i}">
      <header class="card__head"><h3>${esc(t.name)}</h3><code>${esc(t.id)}</code></header>
      ${t.description ? `<p class="muted">${esc(t.description)}</p>` : ""}
      <div class="tree-stats"><span><b>${t.np.toLocaleString("fr-FR")}</b> personnes</span><span><b>${t.nf.toLocaleString("fr-FR")}</b> familles</span><span><b>${t.nl.toLocaleString("fr-FR")}</b> vivants masqués</span></div>
      <p class="small muted">${t.imported_at ? `Dernier import GEDCOM : ${fmtDateTime(t.imported_at)}${t.source ? ` (${esc(t.source)})` : ""}` : "Aucun import GEDCOM pour l'instant."}</p>
      <div class="bar">
        <a class="btn btn--primary btn--sm" href="${T(t.id)}">${icon("users")} Personnes</a>
        <a class="btn btn--sm" href="${T(t.id)}/personne/nouvelle">${icon("plus")} Ajouter une personne</a>
        <a class="btn btn--sm btn--ghost" href="${T(t.id)}/export">Exporter le GEDCOM</a>
        <a class="btn btn--sm btn--ghost" href="/genealogie?tree=${encodeURIComponent(t.id)}" target="_blank">${icon("eye")} Côté membres</a>
      </div>
      <details class="import"><summary>Importer un fichier GEDCOM dans cet arbre</summary>
        <form method="post" action="${T(t.id)}/import" enctype="multipart/form-data" class="form" data-confirm="L'import remplace tout le contenu actuel de l'arbre « ${esc(t.name)} ». Continuer ?">
          <input type="hidden" name="_csrf" value="${esc(req.csrf)}">
          <div class="dropzone" data-dropzone><p class="dropzone__hint">Glissez le fichier .ged ici<br><small>ou cliquez pour choisir (80 Mo max.) — encodages UTF-8, ANSI et ANSEL acceptés</small></p><input type="file" name="ged" accept=".ged,.GED,text/plain" required></div>
          <p class="small muted">⚠ Le contenu actuel de l'arbre est <b>remplacé</b> (pensez à exporter d'abord si vous avez saisi des personnes dans l'administration).</p>
          <button class="btn btn--primary">Importer</button>
        </form></details>
      ${req.user.role === "admin" ? `<details class="import"><summary>Modifier / supprimer l'arbre</summary>
        <form method="post" action="${T(t.id)}/modifier" class="form">${csrfField(req)}
          <label>Nom<input name="name" value="${esc(t.name)}" required></label><label>Description<input name="description" value="${esc(t.description)}"></label>
          <div class="bar"><button class="btn btn--sm">Enregistrer</button><button class="btn btn--sm btn--danger-ghost" formaction="${T(t.id)}/supprimer" data-confirm="Supprimer l'arbre « ${esc(t.name)} » et ses ${t.np} personnes ? Cette action est définitive.">${icon("trash")} Supprimer l'arbre</button></div>
        </form></details>` : ""}
    </article>`).join("")}</div>` : `<div class="empty"><p>Aucun arbre pour l'instant. Créez un arbre, puis importez votre fichier GEDCOM ou saisissez les personnes une à une.</p></div>`}
    <div class="grid2">
      <form method="post" action="${A}" class="card form">${csrfField(req)}
        <h3>Nouvel arbre</h3>
        <label>Nom<input name="name" required placeholder="Ex. : Familles du Cambrésis" data-slug-source></label>
        <label>Identifiant<div class="input-prefix"><input name="id" required pattern="[a-z0-9\\-]+" data-slug-target></div><small>Lettres minuscules, chiffres et tirets.</small></label>
        <label>Description<input name="description"></label>
        <button class="btn btn--primary">${icon("plus")} Créer l'arbre</button>
      </form>
      <form method="post" action="${A}/reglages" class="card form">${csrfField(req)}
        <h3>Vie privée</h3>
        <label class="switch"><input type="checkbox" name="hide" ${hide ? "checked" : ""}><span></span><em>Masquer les personnes vivantes aux membres</em></label>
        <label>Une personne est considérée comme vivante si elle est née il y a moins de<input type="number" name="years" min="50" max="150" value="${esc(yrs)}"><small>ans, sans décès ni sépulture connus (estimation par le mariage ou les enfants si la naissance est inconnue). Le statut peut être forcé sur chaque fiche.</small></label>
        <button class="btn">Enregistrer</button>
      </form>
    </div>`;
    res.send(adminPage(req, { title: "Généalogie", active: "genealogie", body, scripts: "" }));
  }));

  router.post("/genealogie", wrap(async (req, res) => {
    const id = String(req.body.id || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!id) return res.status(400).send("Identifiant invalide.");
    await db.q("INSERT INTO gen_trees(id,name,description) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [id, String(req.body.name || id).trim(), String(req.body.description || "").trim()]);
    await done(req, "a créé l'arbre", req.body.name, A);
    res.redirect(`${A}?ok=created`);
  }));
  router.post("/genealogie/reglages", wrap(async (req, res) => {
    await db.setSetting("gen_hide_living", req.body.hide === "on");
    await db.setSetting("gen_living_years", Math.min(150, Math.max(50, parseInt(req.body.years, 10) || 100)));
    for (const t of (await db.q("SELECT id FROM gen_trees")).rows) await S.recomputeLiving(t.id);
    res.redirect(`${A}?ok=saved`);
  }));
  router.post("/genealogie/:tree/modifier", wrap(async (req, res) => {
    await db.q("UPDATE gen_trees SET name=$2, description=$3 WHERE id=$1", [req.params.tree, String(req.body.name || "").trim(), String(req.body.description || "").trim()]);
    res.redirect(`${A}?ok=saved`);
  }));
  router.post("/genealogie/:tree/supprimer", requireAdmin, wrap(async (req, res) => {
    await db.q("DELETE FROM gen_trees WHERE id=$1", [req.params.tree]);
    await done(req, "a supprimé l'arbre", req.params.tree);
    res.redirect(`${A}?ok=deleted`);
  }));

  router.post("/genealogie/:tree/import", gedUpload.single("ged"), csrfOk, wrap(async (req, res, next) => {
    const t = await tree(req.params.tree);
    if (!t || !req.file) return next();
    let r;
    try { r = await S.importGedcom(t.id, req.file.buffer); }
    catch (e) { console.error(e); return res.status(400).send(adminPage(req, { title: "Import impossible", active: "genealogie", body: `<div class="card"><p>Le fichier n'a pas pu être lu : ${esc(e.message)}</p><a class="btn" href="${A}">Retour</a></div>` })); }
    await done(req, "a importé un GEDCOM dans l'arbre", `${t.name} (${r.people} personnes)`, T(t.id));
    const body = `<section class="card import-done"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg>
      <div><h3>Import terminé</h3><p><b>${r.people.toLocaleString("fr-FR")}</b> personnes et <b>${r.families.toLocaleString("fr-FR")}</b> familles importées dans « ${esc(t.name)} ».</p>
      <p class="muted small">Logiciel d'origine : ${esc(r.source || "inconnu")} · encodage déclaré : ${esc(r.charset || "non précisé")}</p>
      <div class="bar"><a class="btn btn--primary" href="${T(t.id)}">Voir les personnes</a><a class="btn" href="/genealogie?tree=${encodeURIComponent(t.id)}" target="_blank">Côté membres</a></div></div></section>`;
    res.send(adminPage(req, { title: "Import GEDCOM", active: "genealogie", body }));
  }));

  router.get("/genealogie/:tree/export", wrap(async (req, res, next) => {
    const ged = await S.exportTree(req.params.tree);
    if (!ged) return next();
    res.set({ "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${req.params.tree}-${new Date().toISOString().slice(0, 10)}.ged"` }).send(ged);
  }));

  // ------------------------------------------------------------------ Personnes
  router.get("/genealogie/:tree/api/personnes", wrap(async (req, res) => {
    const r = await S.quickSearch(req.params.tree, req.query.q, 15);
    res.json(r.map((p) => ({ id: p.id, name: name(p), years: years(p), sex: p.sex, place: p.birth_place || p.chr_place })));
  }));

  router.get("/genealogie/:tree", wrap(async (req, res, next) => {
    const t = await tree(req.params.tree);
    if (!t) return next();
    const q = String(req.query.q || "").trim();
    const pg = Math.max(1, parseInt(req.query.page, 10) || 1);
    let rows, total;
    if (q) { rows = await S.quickSearch(t.id, q, 200); total = rows.length; }
    else {
      total = (await db.q("SELECT count(*)::int n FROM gen_people WHERE tree=$1", [t.id])).rows[0].n;
      rows = (await db.q("SELECT * FROM gen_people WHERE tree=$1 ORDER BY updated_at DESC LIMIT 50 OFFSET $2", [t.id, (pg - 1) * 50])).rows;
    }
    const pages = q ? 1 : Math.ceil(total / 50);
    const body = `<form class="toolbar" method="get"><input type="search" name="q" class="filter" value="${esc(q)}" placeholder="Nom, prénom ou ID (ex. : dupont jean, I252)" autofocus><button class="btn">Rechercher</button>${q ? `<a class="btn btn--ghost" href="${T(t.id)}">Effacer</a>` : `<span class="muted small">Les dernières personnes modifiées s'affichent en premier.</span>`}</form>
    <section class="card card--flush"><table class="table">
      <thead><tr><th>ID</th><th>Nom</th><th>Naissance / baptême</th><th>Décès / sépulture</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `<tr><td><code>${esc(p.id)}</code></td><td><a class="strong" href="${P(t.id, p.id)}">${esc(`${(p.surname || "").toUpperCase()}, ${p.given || "…"}`)}</a>${p.living ? ` <span class="tag">vivant</span>` : ""}</td>
        <td class="small">${esc(G.frDate(p.birth_date || p.chr_date))}<br><span class="muted">${esc(p.birth_place || p.chr_place)}</span></td>
        <td class="small">${esc(G.frDate(p.death_date || p.buri_date))}<br><span class="muted">${esc(p.death_place || p.buri_place)}</span></td>
        <td class="actions"><a class="btn btn--sm" href="${P(t.id, p.id)}">${icon("edit")} Modifier</a><a class="btn btn--sm btn--ghost" href="/genealogie/${encodeURIComponent(t.id)}/${encodeURIComponent(p.id)}" target="_blank" title="Voir">${icon("eye")}</a></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Aucune personne.</td></tr>`}</tbody></table></section>
    ${pages > 1 ? `<nav class="bar">${pg > 1 ? `<a class="btn btn--sm" href="?page=${pg - 1}">‹ Précédente</a>` : ""}<span class="muted small">Page ${pg} / ${pages}</span>${pg < pages ? `<a class="btn btn--sm" href="?page=${pg + 1}">Suivante ›</a>` : ""}</nav>` : ""}`;
    res.send(adminPage(req, { title: `${esc(t.name)} <span class="count">${total.toLocaleString("fr-FR")}</span>`, active: "genealogie", body,
      actions: `<a class="btn btn--ghost" href="${A}">← Arbres</a><a class="btn btn--primary" href="${T(t.id)}/personne/nouvelle">${icon("plus")} Ajouter une personne</a>` }));
  }));

  const dateField = (label, key, p) => `<div class="date-field"><label>${label}<input name="${key}_date" value="${esc(p[`${key}_date`] || "")}" placeholder="12/03/1756, vers 1750, avant 1800…" data-gdate></label><small class="date-preview">${esc(G.frDate(p[`${key}_date`]))}</small></div>
    <label>Lieu<input name="${key}_place" value="${esc(p[`${key}_place`] || "")}" list="places"></label>`;

  function personForm(req, t, p, isNew, ctx = {}) {
    const hidden = Object.entries(ctx).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
    return `<form method="post" action="${isNew ? `${T(t.id)}/personne` : P(t.id, p.id)}" class="card form person-form" id="person-form">${csrfField(req)}${hidden}
      <div class="row"><label>Prénom(s)<input name="given" value="${esc(p.given || "")}" autofocus></label><label>Nom<input name="surname" value="${esc(p.surname || "")}" style="text-transform:uppercase"></label></div>
      <div class="row row--3"><label>Sexe<select name="sex">${[["", "—"], ["M", "Masculin"], ["F", "Féminin"], ["U", "Inconnu"]].map(([v, l]) => `<option value="${v}"${(p.sex || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Suffixe<input name="suffix" value="${esc(p.suffix || "")}" placeholder="fils, l'aîné…"></label><label>Branche<input name="branch" value="${esc(p.branch || "")}"></label></div>
      <label>Autres noms<input name="alt_names" value="${esc((p.alt_names || []).join(" ; "))}" placeholder="Variantes séparées par « ; »"></label>
      <fieldset><legend>Naissance</legend><div class="row">${dateField("Date", "birth", p)}</div></fieldset>
      <fieldset><legend>Baptême</legend><div class="row">${dateField("Date", "chr", p)}</div></fieldset>
      <fieldset><legend>Décès</legend><div class="row">${dateField("Date", "death", p)}</div>
        <label class="check"><input type="checkbox" name="deceased" ${p.deceased ? "checked" : ""}><span>Décédé(e), date et lieu inconnus</span></label></fieldset>
      <fieldset><legend>Sépulture</legend><div class="row">${dateField("Date", "buri", p)}</div>
        <label class="check"><input type="checkbox" name="crem" ${p.crem ? "checked" : ""}><span>Incinéré(e)</span></label></fieldset>
      <label>Profession<input name="occupation" value="${esc(p.occupation || "")}"></label>
      <label>Notes<textarea name="notes" rows="5">${esc(p.notes || "")}</textarea></label>
      <label>Vie privée<select name="privacy">${[["auto", "Automatique (selon les dates)"], ["vivant", "Toujours masquer (vivant)"], ["decede", "Toujours afficher (décédé)"]].map(([v, l]) => `<option value="${v}"${(p.privacy || "auto") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="bar"><button class="btn btn--primary">${isNew ? "Créer la personne" : "Enregistrer"}</button>${isNew ? "" : `<button class="btn btn--danger-ghost" formaction="${P(t.id, p.id)}/supprimer" formnovalidate data-confirm="Supprimer ${esc(name(p))} ? Ses liens familiaux seront retirés.">${icon("trash")} Supprimer</button>`}</div>
    </form>`;
  }
  function personFromBody(b) {
    const d = {};
    for (const k of S.PERSON_FIELDS) if (b[k] !== undefined) d[k] = String(b[k]).trim();
    for (const k of ["birth", "chr", "death", "buri"]) d[`${k}_date`] = G.toGedcomDate(b[`${k}_date`]);
    d.surname = (d.surname || "").toUpperCase() === d.surname ? d.surname : d.surname;
    d.alt_names = String(b.alt_names || "").split(";").map((x) => x.trim()).filter(Boolean);
    d.deceased = b.deceased === "on"; d.crem = b.crem === "on";
    d.privacy = ["vivant", "decede"].includes(b.privacy) ? b.privacy : "auto";
    return d;
  }

  router.get("/genealogie/:tree/personne/nouvelle", wrap(async (req, res, next) => {
    const t = await tree(req.params.tree);
    if (!t) return next();
    const ctx = {};
    let intro = "";
    const pre = {};
    if (req.query.enfant_de) {
      ctx.enfant_de = req.query.enfant_de;
      const f = await S.getFamily(t.id, req.query.enfant_de);
      const ps = await S.getPeople(t.id, [f?.husband, f?.wife]);
      intro = `Nouvel enfant de ${[ps.get(f?.husband), ps.get(f?.wife)].filter(Boolean).map(name).map(esc).join(" et ")}`;
      pre.surname = ps.get(f?.husband)?.surname || "";
    }
    if (req.query.parent_de) {
      ctx.parent_de = req.query.parent_de; ctx.role = req.query.role === "mere" ? "mere" : "pere";
      const c = await S.getPerson(t.id, req.query.parent_de);
      intro = `Nouveau${ctx.role === "mere" ? "lle mère" : " père"} de ${esc(name(c))}`;
      pre.sex = ctx.role === "mere" ? "F" : "M";
      if (ctx.role === "pere") pre.surname = c?.surname || "";
    }
    if (req.query.conjoint_de) {
      ctx.conjoint_de = req.query.conjoint_de;
      const c = await S.getPerson(t.id, req.query.conjoint_de);
      intro = `Nouveau conjoint de ${esc(name(c))}`;
      pre.sex = c?.sex === "M" ? "F" : c?.sex === "F" ? "M" : "";
    }
    const body = `${intro ? `<p class="lead">${intro}</p>` : ""}${personForm(req, t, pre, true, ctx)}`;
    res.send(adminPage(req, { title: "Nouvelle personne", active: "genealogie", body, scripts, actions: `<a class="btn btn--ghost" href="${T(t.id)}">← ${esc(t.name)}</a>` }));
  }));

  router.post("/genealogie/:tree/personne", wrap(async (req, res, next) => {
    const t = await tree(req.params.tree);
    if (!t) return next();
    const id = await S.nextId(t.id, "I");
    await S.savePerson(t.id, id, personFromBody(req.body));
    if (req.body.enfant_de) await S.addChild(t.id, req.body.enfant_de, id);
    if (req.body.conjoint_de) await S.addSpouse(t.id, req.body.conjoint_de, id);
    if (req.body.parent_de) {
      const c = await S.getPerson(t.id, req.body.parent_de);
      const f = c?.famc ? await S.getFamily(t.id, c.famc) : null;
      const father = req.body.role === "mere" ? f?.husband : id, mother = req.body.role === "mere" ? id : f?.wife;
      if (f && !(req.body.role === "mere" ? f.wife : f.husband)) await S.saveFamily(t.id, f.id, req.body.role === "mere" ? { wife: id } : { husband: id });
      else await S.setParents(t.id, req.body.parent_de, father, mother);
    }
    await done(req, "a ajouté", `${req.body.given || ""} ${req.body.surname || ""} (${id})`, P(t.id, id));
    res.redirect(`${req.body.parent_de || req.body.conjoint_de ? P(t.id, req.body.parent_de || req.body.conjoint_de) : req.body.enfant_de ? `${P(t.id, id)}` : P(t.id, id)}?ok=created`);
  }));

  router.get("/genealogie/:tree/personne/:id", wrap(async (req, res, next) => {
    const t = await tree(req.params.tree);
    const d = t && (await S.personDetail(t.id, req.params.id));
    if (!d) return next();
    const { p, parentsFam, fams, people } = d;
    const g = (id) => people.get(id);
    const picker = (nameAttr, placeholder) => `<div class="picker" data-person-picker data-tree="${esc(t.id)}"><input type="search" placeholder="${placeholder}" autocomplete="off"><input type="hidden" name="${nameAttr}"><ul class="picker__list" hidden></ul></div>`;
    const parentsHtml = `<section class="card">
      <h3>Parents</h3>
      ${parentsFam ? `<p>${icon("users")} ${pLink(t.id, g(parentsFam.husband)) || "<span class='muted'>Père inconnu</span>"}<br>${pLink(t.id, g(parentsFam.wife)) || "<span class='muted'>Mère inconnue</span>"}</p>
        <p class="small muted">Famille ${esc(parentsFam.id)} · <a href="${T(t.id)}/famille/${encodeURIComponent(parentsFam.id)}">modifier la famille</a></p>` : `<p class="muted small">Aucun parent renseigné.</p>`}
      <form method="post" action="${P(t.id, p.id)}/parents" class="form compact">${csrfField(req)}
        <label>Père${picker("father", parentsFam?.husband ? `${name(g(parentsFam.husband))} — changer…` : "Rechercher une personne…")}</label>
        <label>Mère${picker("mother", parentsFam?.wife ? `${name(g(parentsFam.wife))} — changer…` : "Rechercher une personne…")}</label>
        <div class="bar"><button class="btn btn--sm">Enregistrer les parents</button>
          ${!parentsFam?.husband ? `<a class="btn btn--sm btn--ghost" href="${T(t.id)}/personne/nouvelle?parent_de=${encodeURIComponent(p.id)}&role=pere">${icon("plus")} Créer le père</a>` : ""}
          ${!parentsFam?.wife ? `<a class="btn btn--sm btn--ghost" href="${T(t.id)}/personne/nouvelle?parent_de=${encodeURIComponent(p.id)}&role=mere">${icon("plus")} Créer la mère</a>` : ""}</div>
      </form></section>`;
    const famHtml = fams.map((f) => {
      const sp = g(f.husband === p.id ? f.wife : f.husband);
      return `<section class="card fam-card">
        <header class="card__head"><h3>${sp ? `∞ ${pLink(t.id, sp)}` : "Conjoint inconnu"}</h3><a class="small" href="${T(t.id)}/famille/${encodeURIComponent(f.id)}">Famille ${esc(f.id)} ›</a></header>
        <form method="post" action="${T(t.id)}/famille/${encodeURIComponent(f.id)}" class="form compact">${csrfField(req)}
          <div class="row"><div class="date-field"><label>Mariage<input name="marr_date" value="${esc(f.marr_date)}" data-gdate placeholder="date"></label><small class="date-preview">${esc(G.frDate(f.marr_date))}</small></div><label>Lieu<input name="marr_place" value="${esc(f.marr_place)}" list="places"></label></div>
          <button class="btn btn--sm">Enregistrer le mariage</button></form>
        <h4>Enfants</h4>
        <ol class="kids">${f.children.map((c) => `<li>${pLink(t.id, g(c)) || esc(c)}
          <form method="post" action="${T(t.id)}/famille/${encodeURIComponent(f.id)}/retirer" class="inline">${csrfField(req)}<input type="hidden" name="child" value="${esc(c)}"><button class="icon-btn icon-btn--danger" title="Retirer de la famille">✕</button></form></li>`).join("")}</ol>
        <form method="post" action="${T(t.id)}/famille/${encodeURIComponent(f.id)}/enfant" class="form compact inline-picker">${csrfField(req)}
          ${picker("child", "Ajouter un enfant existant…")}<button class="btn btn--sm">Ajouter</button>
          <a class="btn btn--sm btn--ghost" href="${T(t.id)}/personne/nouvelle?enfant_de=${encodeURIComponent(f.id)}">${icon("plus")} Nouvel enfant</a></form>
      </section>`;
    }).join("");
    const body = `<div class="editor-layout">
      <div>${personForm(req, t, p, false)}</div>
      <aside class="editor-side">
        ${parentsHtml}
        ${famHtml}
        <section class="card"><h3>Ajouter un conjoint</h3>
          <form method="post" action="${P(t.id, p.id)}/conjoint" class="form compact">${csrfField(req)}${picker("spouse", "Rechercher une personne…")}
            <div class="bar"><button class="btn btn--sm">Ajouter</button><a class="btn btn--sm btn--ghost" href="${T(t.id)}/personne/nouvelle?conjoint_de=${encodeURIComponent(p.id)}">${icon("plus")} Nouvelle personne</a></div></form></section>
        <p class="small muted">Modifiée le ${fmtDateTime(p.updated_at)}</p>
      </aside></div>`;
    res.send(adminPage(req, { title: `${esc(name(p))} <span class="count">${esc(p.id)}</span>`, active: "genealogie", body, scripts, wide: true,
      actions: `<a class="btn btn--ghost" href="${T(t.id)}">← ${esc(t.name)}</a><a class="btn" href="/genealogie/${encodeURIComponent(t.id)}/${encodeURIComponent(p.id)}/ascendance" target="_blank">${icon("eye")} Arbre</a>` }));
  }));

  router.post("/genealogie/:tree/personne/:id", wrap(async (req, res) => {
    await S.savePerson(req.params.tree, req.params.id, personFromBody(req.body));
    await done(req, "a modifié", `${req.body.given || ""} ${req.body.surname || ""} (${req.params.id})`, P(req.params.tree, req.params.id));
    res.redirect(`${P(req.params.tree, req.params.id)}?ok=saved`);
  }));
  router.post("/genealogie/:tree/personne/:id/supprimer", wrap(async (req, res) => {
    await S.deletePerson(req.params.tree, req.params.id);
    await done(req, "a supprimé la personne", req.params.id);
    res.redirect(`${T(req.params.tree)}?ok=deleted`);
  }));
  router.post("/genealogie/:tree/personne/:id/parents", wrap(async (req, res) => {
    const p = await S.getPerson(req.params.tree, req.params.id);
    const cur = p?.famc ? await S.getFamily(req.params.tree, p.famc) : null;
    const father = req.body.father || cur?.husband || null, mother = req.body.mother || cur?.wife || null;
    if (req.body.father || req.body.mother) await S.setParents(req.params.tree, req.params.id, father, mother);
    res.redirect(`${P(req.params.tree, req.params.id)}?ok=saved`);
  }));
  router.post("/genealogie/:tree/personne/:id/conjoint", wrap(async (req, res) => {
    if (req.body.spouse) await S.addSpouse(req.params.tree, req.params.id, req.body.spouse);
    res.redirect(`${P(req.params.tree, req.params.id)}?ok=saved`);
  }));

  // ------------------------------------------------------------------ Familles
  router.get("/genealogie/:tree/famille/:id", wrap(async (req, res, next) => {
    const t = await tree(req.params.tree);
    const f = t && (await S.getFamily(t.id, req.params.id));
    if (!f) return next();
    const ps = await S.getPeople(t.id, [f.husband, f.wife, ...f.children]);
    const body = `<form method="post" action="${T(t.id)}/famille/${encodeURIComponent(f.id)}" class="card form narrow">${csrfField(req)}
      <p>${pLink(t.id, ps.get(f.husband)) || "Mari inconnu"} ∞ ${pLink(t.id, ps.get(f.wife)) || "Épouse inconnue"}</p>
      <div class="row"><div class="date-field"><label>Date du mariage<input name="marr_date" value="${esc(f.marr_date)}" data-gdate></label><small class="date-preview">${esc(G.frDate(f.marr_date))}</small></div><label>Lieu<input name="marr_place" value="${esc(f.marr_place)}"></label></div>
      <label class="check"><input type="checkbox" name="div" ${f.div ? "checked" : ""}><span>Divorce</span></label>
      <label>Notes<textarea name="notes" rows="4">${esc(f.notes)}</textarea></label>
      <h4>Enfants (ordre)</h4><ol class="kids">${f.children.map((c) => `<li>${pLink(t.id, ps.get(c)) || esc(c)}</li>`).join("")}</ol>
      <div class="bar"><button class="btn btn--primary">Enregistrer</button><button class="btn btn--danger-ghost" formaction="${T(t.id)}/famille/${encodeURIComponent(f.id)}/supprimer" data-confirm="Supprimer cette famille ? Les personnes sont conservées, seuls les liens sont retirés.">${icon("trash")} Supprimer la famille</button></div>
    </form>`;
    res.send(adminPage(req, { title: `Famille ${esc(f.id)}`, active: "genealogie", body, scripts, actions: `<a class="btn btn--ghost" href="${T(t.id)}">← ${esc(t.name)}</a>` }));
  }));
  router.post("/genealogie/:tree/famille/:id", wrap(async (req, res) => {
    const data = { marr_date: G.toGedcomDate(req.body.marr_date), marr_place: String(req.body.marr_place || "").trim() };
    if (req.body.notes !== undefined) { data.notes = String(req.body.notes); data.div = req.body.div === "on"; }
    await S.saveFamily(req.params.tree, req.params.id, data);
    res.redirect(`${req.get("referer") || T(req.params.tree)}`.replace(/\?ok=\w+/, "") + "?ok=saved");
  }));
  router.post("/genealogie/:tree/famille/:id/enfant", wrap(async (req, res) => {
    if (req.body.child) await S.addChild(req.params.tree, req.params.id, req.body.child);
    res.redirect(`${req.get("referer") || T(req.params.tree)}`.replace(/\?ok=\w+/, "") + "?ok=saved");
  }));
  router.post("/genealogie/:tree/famille/:id/retirer", wrap(async (req, res) => {
    await S.removeChild(req.params.tree, req.params.id, req.body.child);
    res.redirect(`${req.get("referer") || T(req.params.tree)}`.replace(/\?ok=\w+/, "") + "?ok=saved");
  }));
  router.post("/genealogie/:tree/famille/:id/supprimer", wrap(async (req, res) => {
    await S.deleteFamily(req.params.tree, req.params.id);
    res.redirect(`${T(req.params.tree)}?ok=deleted`);
  }));
};
