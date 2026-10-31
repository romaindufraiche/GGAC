"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { Pool } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant : définissez la chaîne de connexion Postgres.");
  process.exit(1);
}
// SSL pour les connexions externes (Render « External URL ») ; l'URL interne de Render n'en a pas besoin.
const needSsl = process.env.PGSSL === "require" || /\.render\.com/.test(url);
// Toutes les tables du site vivent dans un schéma dédié : la base peut être partagée
// avec une autre application sans risque de collision.
const SCHEMA_NAME = (process.env.PGSCHEMA || "ggac").replace(/[^a-z0-9_]/gi, "");
const pool = new Pool({
  options: `-c search_path=${SCHEMA_NAME}`,
  connectionString: url,
  ssl: needSsl ? { rejectUnauthorized: false } : false,
  max: 5,
});


const q = (text, params) => pool.query(text, params);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  h1 TEXT NOT NULL,
  section TEXT,
  side JSONB,
  content TEXT NOT NULL DEFAULT '',
  date_maj TEXT NOT NULL DEFAULT '',
  cassini BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS page_revisions (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  title TEXT NOT NULL,
  h1 TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS page_revisions_slug ON page_revisions(slug, created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  image TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permanences (
  id SERIAL PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  hours TEXT NOT NULL DEFAULT 'de 14h00 à 17h00'
);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  link TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split("$");
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, "hex"), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, "hex"));
}

async function getSetting(key, fallback = null) {
  const r = await q("SELECT value FROM settings WHERE key=$1", [key]);
  return r.rows.length ? r.rows[0].value : fallback;
}
async function setSetting(key, value) {
  await q("INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, JSON.stringify(value)]);
}

async function migrate() {
  await q(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`);
  await q(SCHEMA);
  const seedDir = path.join(__dirname, "seed");

  // Contenu initial : pages, menus, agenda (uniquement si la base est vide)
  const { rows } = await q("SELECT count(*)::int AS n FROM pages");
  if (rows[0].n === 0) {
    console.log("Import du contenu initial…");
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(seedDir, "pages.json.gz"))).toString("utf8"));
    await setSetting("nav", data.nav);
    if (data.agenda.side) data.agenda.side.items = data.agenda.side.items.map((i) => ({ ...i, href: i.href || "agenda.html" }));
    await setSetting("agenda_meta", data.agenda);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const p of data.pages) {
        if (p.side && p.side.items) p.side.items = p.side.items.map((i) => ({ ...i, href: i.href || `${p.slug}.html` }));
        await client.query(
          `INSERT INTO pages(slug,title,h1,section,side,content,date_maj,cassini) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (slug) DO NOTHING`,
          [p.slug, p.title, p.h1, p.section, p.side ? JSON.stringify(p.side) : null, p.content, p.date_maj, !!p.cassini]
        );
      }
      const ag = JSON.parse(fs.readFileSync(path.join(seedDir, "agenda.json"), "utf8"));
      for (const e of ag.events) {
        await client.query(
          "INSERT INTO events(title,subtitle,body,image,start_date,end_date) VALUES ($1,$2,$3,$4,$5,$6)",
          [e.title, e.subtitle, e.body, e.image && !/^(\/|https?:)/.test(e.image) ? `/${e.image}` : e.image, e.start, e.end]
        );
      }
      for (const p of ag.permanences) {
        await client.query("INSERT INTO permanences(date,hours) VALUES ($1,$2) ON CONFLICT DO NOTHING", [p.date, p.hours]);
      }
      await client.query("COMMIT");
      await setSetting("agenda_intro", ag.intro);
      await setSetting("agenda_date_maj", "Page mise à jour le 31/10/2026 à 15:59:38");
      await setSetting("visitors", 119617);
      await setSetting("visitors_since", "12/03/10");
      await setSetting("site_updated", "2026-10-31");
      await setSetting("permanences_count", 7);
      await setSetting("news_events_count", 5);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    console.log(`${data.pages.length} pages importées.`);
  }

  // Premier compte administrateur
  const users = await q("SELECT count(*)::int AS n FROM users");
  if (users.rows[0].n === 0) {
    const email = (process.env.ADMIN_EMAIL || "admin@ggac.fr").toLowerCase();
    let pw = process.env.ADMIN_PASSWORD;
    if (!pw) {
      pw = crypto.randomBytes(9).toString("base64url");
      console.log(`Aucun ADMIN_PASSWORD défini : mot de passe généré pour ${email} : ${pw}`);
    }
    await q("INSERT INTO users(email,name,pass_hash,role) VALUES ($1,$2,$3,'admin')", [email, "Administrateur", hashPassword(pw)]);
  }
  await q("DELETE FROM sessions WHERE expires_at < now()");
}

async function log(userId, action, target, link) {
  await q("INSERT INTO activity(user_id, action, target, link) VALUES ($1,$2,$3,$4)", [userId || null, action, target || null, link || null]);
}

async function touchSite() {
  await setSetting("site_updated", new Date().toISOString().slice(0, 10));
}

module.exports = { pool, q, migrate, getSetting, setSetting, hashPassword, checkPassword, log, touchSite };
