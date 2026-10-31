"use strict";
/* Accès aux données généalogiques (arbres, personnes, familles) */
const db = require("./db");
const G = require("./gedcom");

const PERSON_FIELDS = ["given", "surname", "suffix", "sex", "birth_date", "birth_place", "chr_date", "chr_place", "death_date", "death_place", "buri_date", "buri_place", "occupation", "notes", "branch"];

/** Ligne prête pour la base (champs normalisés, années) */
function personRow(tree, p) {
  const r = {
    tree, id: p.id,
    given: p.given || "", surname: p.surname || "", suffix: p.suffix || "", sex: (p.sex || "").slice(0, 1).toUpperCase(),
    alt_names: (p.alt_names || []).filter(Boolean),
    birth_date: p.birth_date || "", birth_place: p.birth_place || "", chr_date: p.chr_date || "", chr_place: p.chr_place || "",
    death_date: p.death_date || "", death_place: p.death_place || "", buri_date: p.buri_date || "", buri_place: p.buri_place || "",
    crem: !!p.crem, deceased: !!p.deceased, privacy: ["vivant", "decede"].includes(p.privacy) ? p.privacy : "auto",
    occupation: p.occupation || "", notes: p.notes || "", branch: p.branch || "", famc: p.famc || null,
    extra: JSON.stringify(p.extra || []),
  };
  r.birth_year = G.yearOf(r.birth_date); r.birth_sort = G.sortKey(r.birth_date) || G.sortKey(r.chr_date);
  r.chr_year = G.yearOf(r.chr_date); r.death_year = G.yearOf(r.death_date); r.buri_year = G.yearOf(r.buri_date);
  r.n_given = G.norm(r.given); r.n_surname = G.norm(r.surname); r.n_alt = G.norm(r.alt_names.join(" | "));
  r.n_birth_place = G.norm(r.birth_place); r.n_chr_place = G.norm(r.chr_place); r.n_death_place = G.norm(r.death_place); r.n_buri_place = G.norm(r.buri_place);
  return r;
}
function familyRow(tree, f) {
  return {
    tree, id: f.id, husband: f.husband || null, wife: f.wife || null, children: (f.children || []).filter(Boolean),
    marr_date: f.marr_date || "", marr_place: f.marr_place || "", marr_year: G.yearOf(f.marr_date), div: !!f.div,
    notes: f.notes || "", extra: JSON.stringify(f.extra || []),
  };
}

/**
 * « Vivant » : pas de décès / sépulture connus et naissance (ou estimation par la famille) il y a moins de 100 ans.
 * Sans aucune année connue ni estimable, la personne est considérée comme décédée (archives anciennes).
 */
async function recomputeLiving(tree, client = db.pool) {
  const limit = new Date().getFullYear() - (await db.getSetting("gen_living_years", 100));
  await client.query(
    `WITH est AS (
       SELECT p.tree, p.id, COALESCE(p.birth_year, p.chr_year,
         (SELECT min(f.marr_year) - 20 FROM gen_families f WHERE f.tree=p.tree AND (f.husband=p.id OR f.wife=p.id)),
         (SELECT f.marr_year + 1 FROM gen_families f WHERE f.tree=p.tree AND f.id=p.famc),
         (SELECT min(c.birth_year) - 20 FROM gen_families f JOIN gen_people c ON c.tree=f.tree AND c.id = ANY(f.children)
           WHERE f.tree=p.tree AND (f.husband=p.id OR f.wife=p.id))) AS y
       FROM gen_people p WHERE p.tree=$1)
     UPDATE gen_people p SET living = CASE
       WHEN p.privacy='vivant' THEN true WHEN p.privacy='decede' THEN false
       WHEN p.deceased OR p.crem OR p.death_date<>'' OR p.death_place<>'' OR p.buri_date<>'' OR p.buri_place<>'' THEN false
       ELSE COALESCE(est.y > $2, false) END
     FROM est WHERE est.tree=p.tree AND est.id=p.id`,
    [tree, limit]
  );
}

const PCOLS = ["tree", "id", "given", "surname", "suffix", "sex", "alt_names", "birth_date", "birth_place", "birth_year", "birth_sort", "chr_date", "chr_place", "chr_year", "death_date", "death_place", "death_year", "buri_date", "buri_place", "buri_year", "crem", "deceased", "privacy", "occupation", "notes", "branch", "famc", "extra", "n_given", "n_surname", "n_alt", "n_birth_place", "n_chr_place", "n_death_place", "n_buri_place"];
const FCOLS = ["tree", "id", "husband", "wife", "children", "marr_date", "marr_place", "marr_year", "div", "notes", "extra"];

async function bulkInsert(client, table, cols, rows) {
  for (let i = 0; i < rows.length; i += 1500) {
    const chunk = rows.slice(i, i + 1500).map((r) => ({ ...r, extra: JSON.parse(r.extra) }));
    await client.query(
      `INSERT INTO ${table} (${cols.join(",")}) SELECT ${cols.join(",")} FROM json_populate_recordset(null::${table}, $1::json)
       ON CONFLICT (tree, id) DO NOTHING`,
      [JSON.stringify(chunk)]
    );
  }
}

/** Import d'un GEDCOM complet dans un arbre (remplace son contenu) */
async function importGedcom(treeId, buffer) {
  const data = G.parse(buffer);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM gen_families WHERE tree=$1", [treeId]);
    await client.query("DELETE FROM gen_people WHERE tree=$1", [treeId]);
    await bulkInsert(client, "gen_people", PCOLS, data.people.map((p) => personRow(treeId, p)));
    await bulkInsert(client, "gen_families", FCOLS, data.families.map((f) => familyRow(treeId, f)));
    await recomputeLiving(treeId, client);
    await client.query("UPDATE gen_trees SET source=$2, imported_at=now() WHERE id=$1", [treeId, data.header.source || ""]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { people: data.people.length, families: data.families.length, source: data.header.source, charset: data.header.charset };
}

async function exportTree(treeId) {
  const [t, p, f] = await Promise.all([
    db.q("SELECT * FROM gen_trees WHERE id=$1", [treeId]),
    db.q("SELECT * FROM gen_people WHERE tree=$1 ORDER BY length(id), id", [treeId]),
    db.q("SELECT * FROM gen_families WHERE tree=$1 ORDER BY length(id), id", [treeId]),
  ]);
  if (!t.rows[0]) return null;
  return G.exportGedcom({ tree: t.rows[0], people: p.rows, families: f.rows });
}

async function nextId(tree, prefix) {
  const table = prefix === "F" ? "gen_families" : "gen_people";
  const r = await db.q(`SELECT max(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::bigint) AS m FROM ${table} WHERE tree=$1`, [tree]);
  return `${prefix}${Number(r.rows[0].m || 0) + 1}`;
}

async function getPerson(tree, id) {
  return (await db.q("SELECT * FROM gen_people WHERE tree=$1 AND id=$2", [tree, id])).rows[0] || null;
}
async function getPeople(tree, ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return new Map();
  const r = await db.q("SELECT * FROM gen_people WHERE tree=$1 AND id = ANY($2)", [tree, ids]);
  return new Map(r.rows.map((p) => [p.id, p]));
}
async function getFamily(tree, id) {
  return (await db.q("SELECT * FROM gen_families WHERE tree=$1 AND id=$2", [tree, id])).rows[0] || null;
}
async function spouseFamilies(tree, id) {
  return (await db.q("SELECT * FROM gen_families WHERE tree=$1 AND (husband=$2 OR wife=$2) ORDER BY marr_year NULLS LAST, id", [tree, id])).rows;
}

/** Fiche complète : parents, frères et sœurs, conjoints et enfants */
async function personDetail(tree, id) {
  const p = await getPerson(tree, id);
  if (!p) return null;
  const parentsFam = p.famc ? await getFamily(tree, p.famc) : null;
  const fams = await spouseFamilies(tree, id);
  const ids = [parentsFam?.husband, parentsFam?.wife, ...(parentsFam?.children || []), ...fams.flatMap((f) => [f.husband, f.wife, ...f.children])];
  const people = await getPeople(tree, ids);
  return { p, parentsFam, fams, people };
}

async function savePerson(tree, id, data) {
  const cur = (await getPerson(tree, id)) || { id, alt_names: [], extra: [] };
  const merged = { ...cur, ...data, id };
  const r = personRow(tree, merged);
  const cols = PCOLS.filter((c) => c !== "tree" && c !== "id");
  await db.q(
    `INSERT INTO gen_people (${PCOLS.join(",")}) VALUES (${PCOLS.map((_, i) => `$${i + 1}`).join(",")})
     ON CONFLICT (tree, id) DO UPDATE SET ${cols.map((c) => `${c}=EXCLUDED.${c}`).join(",")}, updated_at=now()`,
    PCOLS.map((c) => (c === "extra" ? r.extra : r[c]))
  );
  await recomputeLiving(tree);
}
async function saveFamily(tree, id, data) {
  const cur = (await getFamily(tree, id)) || { id, children: [], extra: [] };
  const r = familyRow(tree, { ...cur, ...data, id, extra: data.extra || cur.extra });
  const cols = FCOLS.filter((c) => c !== "tree" && c !== "id");
  await db.q(
    `INSERT INTO gen_families (${FCOLS.join(",")}) VALUES (${FCOLS.map((_, i) => `$${i + 1}`).join(",")})
     ON CONFLICT (tree, id) DO UPDATE SET ${cols.map((c) => `${c}=EXCLUDED.${c}`).join(",")}, updated_at=now()`,
    FCOLS.map((c) => r[c])
  );
  // cohérence : chaque enfant pointe vers cette famille
  if (r.children.length) await db.q("UPDATE gen_people SET famc=$2 WHERE tree=$1 AND id = ANY($3) AND (famc IS NULL OR famc=$2 OR famc NOT IN (SELECT id FROM gen_families WHERE tree=$1))", [tree, id, r.children]);
  await recomputeLiving(tree);
}

/** Rattache une personne à ses parents (crée la famille si besoin) */
async function setParents(tree, childId, fatherId, motherId) {
  fatherId = fatherId || null; motherId = motherId || null;
  if (!fatherId && !motherId) return null;
  let f = (await db.q("SELECT * FROM gen_families WHERE tree=$1 AND husband IS NOT DISTINCT FROM $2 AND wife IS NOT DISTINCT FROM $3 LIMIT 1", [tree, fatherId, motherId])).rows[0];
  if (!f) {
    const id = await nextId(tree, "F");
    await saveFamily(tree, id, { husband: fatherId, wife: motherId, children: [] });
    f = await getFamily(tree, id);
  }
  const child = await getPerson(tree, childId);
  if (child?.famc && child.famc !== f.id) await removeChild(tree, child.famc, childId);
  if (!f.children.includes(childId)) await saveFamily(tree, f.id, { children: [...f.children, childId] });
  await db.q("UPDATE gen_people SET famc=$3 WHERE tree=$1 AND id=$2", [tree, childId, f.id]);
  return f.id;
}
async function addSpouse(tree, personId, spouseId) {
  const [a, b] = [await getPerson(tree, personId), await getPerson(tree, spouseId)];
  if (!a || !b) return null;
  const husband = a.sex === "F" || b.sex === "M" ? b.id : a.id;
  const wife = husband === a.id ? b.id : a.id;
  const exist = (await db.q("SELECT id FROM gen_families WHERE tree=$1 AND husband=$2 AND wife=$3", [tree, husband, wife])).rows[0];
  if (exist) return exist.id;
  const id = await nextId(tree, "F");
  await saveFamily(tree, id, { husband, wife, children: [] });
  return id;
}
async function addChild(tree, famId, childId) {
  const f = await getFamily(tree, famId);
  if (!f) return;
  const c = await getPerson(tree, childId);
  if (c?.famc && c.famc !== famId) await removeChild(tree, c.famc, childId);
  if (!f.children.includes(childId)) await saveFamily(tree, famId, { children: [...f.children, childId] });
  await db.q("UPDATE gen_people SET famc=$3 WHERE tree=$1 AND id=$2", [tree, childId, famId]);
}
async function removeChild(tree, famId, childId) {
  await db.q("UPDATE gen_families SET children=array_remove(children,$3), updated_at=now() WHERE tree=$1 AND id=$2", [tree, famId, childId]);
  await db.q("UPDATE gen_people SET famc=NULL WHERE tree=$1 AND id=$2 AND famc=$3", [tree, childId, famId]);
}
async function deletePerson(tree, id) {
  await db.q("UPDATE gen_families SET children=array_remove(children,$2) WHERE tree=$1 AND $2 = ANY(children)", [tree, id]);
  await db.q("UPDATE gen_families SET husband=NULL WHERE tree=$1 AND husband=$2", [tree, id]);
  await db.q("UPDATE gen_families SET wife=NULL WHERE tree=$1 AND wife=$2", [tree, id]);
  await db.q("DELETE FROM gen_families WHERE tree=$1 AND husband IS NULL AND wife IS NULL AND cardinality(children)=0", [tree]);
  await db.q("DELETE FROM gen_people WHERE tree=$1 AND id=$2", [tree, id]);
}
async function deleteFamily(tree, id) {
  await db.q("UPDATE gen_people SET famc=NULL WHERE tree=$1 AND famc=$2", [tree, id]);
  await db.q("DELETE FROM gen_families WHERE tree=$1 AND id=$2", [tree, id]);
}

/** Recherche rapide (autocomplétion) : « dupont jean », « I252 » */
async function quickSearch(tree, q, limit = 12) {
  q = String(q || "").trim();
  if (!q) return [];
  if (/^[IP]\d+$/i.test(q)) {
    const r = await db.q("SELECT * FROM gen_people WHERE tree=$1 AND upper(id)=upper($2)", [tree, q]);
    if (r.rows.length) return r.rows;
  }
  const words = G.norm(q).split(/\s+/).filter(Boolean).slice(0, 4);
  const conds = words.map((_, i) => `(n_surname LIKE $${i + 2} OR n_given LIKE $${i + 2})`);
  const r = await db.q(
    `SELECT * FROM gen_people WHERE tree=$1 AND ${conds.join(" AND ")} ORDER BY n_surname, n_given, birth_sort NULLS LAST LIMIT ${Number(limit)}`,
    [tree, ...words.map((w) => `${w}%`)]
  );
  return r.rows;
}

module.exports = {
  PERSON_FIELDS, personRow, recomputeLiving, importGedcom, exportTree, nextId, getPerson, getPeople, getFamily, spouseFamilies,
  personDetail, savePerson, saveFamily, setParents, addSpouse, addChild, removeChild, deletePerson, deleteFamily, quickSearch,
};
