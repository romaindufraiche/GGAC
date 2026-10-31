"use strict";
const path = require("path");
const express = require("express");
const compression = require("compression");
const db = require("./db");
const render = require("./render");
const admin = require("./admin");
const shop = require("./shop");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());

const ROOT = path.join(__dirname, "..");

// Ressources statiques du site
app.use("/assets", express.static(path.join(ROOT, "assets"), { maxAge: "7d", index: false }));
// PDF.js (liseuse) servi localement : les « workers » doivent venir du même domaine
app.use("/vendor/pdfjs", express.static(path.join(ROOT, "node_modules/pdfjs-dist/build"), {
  maxAge: "30d", index: false,
  setHeaders: (res, file) => { if (file.endsWith(".mjs")) res.type("application/javascript"); },
}));
app.use("/vendor/pdfjs-cmaps", express.static(path.join(ROOT, "node_modules/pdfjs-dist/cmaps"), { maxAge: "30d", index: false }));
app.get("/favicon.ico", (req, res) => res.sendFile(path.join(ROOT, "assets/img/favicon.ico")));

// Index de recherche généré depuis la base
app.get("/assets/search-index.json", async (req, res, next) => {
  try {
    res.type("json").set("Cache-Control", "no-cache").send(await render.searchIndex());
  } catch (e) { next(e); }
});

// Médias envoyés depuis l'administration
app.get("/media/:id/:name?", async (req, res, next) => {
  try {
    const r = await db.q("SELECT mime, data FROM media WHERE id=$1", [Number(req.params.id) || 0]);
    if (!r.rows.length) return res.sendStatus(404);
    res.type(r.rows[0].mime).set("Cache-Control", "public, max-age=31536000, immutable").send(r.rows[0].data);
  } catch (e) { next(e); }
});

// Compteur de visiteurs : une visite par session de navigation
async function countVisit(req, res) {
  if (/(^|;\s*)ggac_v=1/.test(req.headers.cookie || "")) return;
  if (/bot|crawl|spider|slurp|preview/i.test(req.headers["user-agent"] || "")) return;
  res.append("Set-Cookie", "ggac_v=1; Path=/; SameSite=Lax; HttpOnly");
  await db.q("UPDATE settings SET value = to_jsonb((value::text)::bigint + 1) WHERE key='visitors'");
}

function send(res, html) {
  res.type("html").set("Cache-Control", "no-cache").send(html);
}

app.get(["/", "/index.html"], async (req, res, next) => {
  try { await countVisit(req, res); send(res, await render.renderAgenda({ home: true })); } catch (e) { next(e); }
});
app.get("/agenda.html", async (req, res, next) => {
  try { await countVisit(req, res); send(res, await render.renderAgenda()); } catch (e) { next(e); }
});

// Anciennes adresses du site (index.php?page=N, agenda.php…) -> nouvelles
app.get(["/index.php", "/agenda.php", "/contacts.php", "/plan_site.php", "/identification.php"], (req, res) => {
  const map = { "/agenda.php": "/agenda.html", "/contacts.php": "/contacts.html", "/plan_site.php": "/plan-du-site.html", "/identification.php": "/espace-membre.html" };
  if (req.path === "/index.php") {
    const n = Number(req.query.page);
    return res.redirect(301, n && n !== 1 ? `/page-${n}.html` : "/");
  }
  res.redirect(301, map[req.path]);
});

// Espace d'administration
app.use("/admin", admin.router);

// Boutique, espace membre, liseuse
app.use(shop.router);

// Pages du site
app.get("/:slug.html", async (req, res, next) => {
  try {
    const html = await render.renderPage(req.params.slug);
    if (!html) return next();
    await countVisit(req, res);
    send(res, html);
  } catch (e) { next(e); }
});

app.use(async (req, res) => {
  res.status(404);
  const html = await render.renderPage("page-404").catch(() => null);
  if (html) return send(res, html);
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>404</title><p style="font:16px sans-serif;padding:40px">404 — <a href="/">Accueil</a></p>`);
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).type("text").send("Erreur interne du serveur.");
});

const port = process.env.PORT || 3000;
db.migrate()
  .then(() => app.listen(port, () => console.log(`G.G.A.C. en ligne sur le port ${port}`)))
  .catch((e) => {
    console.error("Échec de l'initialisation de la base :", e);
    process.exit(1);
  });
