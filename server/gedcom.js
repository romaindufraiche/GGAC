"use strict";
/**
 * Lecture / écriture de fichiers GEDCOM (5.5 / 5.5.1) et utilitaires de dates.
 * - encodages : UTF-8 (avec ou sans BOM), UTF-16, ANSI (Windows-1252), ANSEL (accents courants)
 * - les lignes non gérées sont conservées (« extra ») et réécrites à l'export
 */

// ---------------------------------------------------------------------------
// Encodages
// ---------------------------------------------------------------------------
const ANSEL_SPECIAL = {
  0xa1: "Ł", 0xa2: "Ø", 0xa3: "Đ", 0xa4: "Þ", 0xa5: "Æ", 0xa6: "Œ", 0xa7: "ʹ", 0xa8: "·", 0xa9: "♭", 0xaa: "®", 0xab: "±",
  0xb1: "ł", 0xb2: "ø", 0xb3: "đ", 0xb4: "þ", 0xb5: "æ", 0xb6: "œ", 0xb7: "ʺ", 0xb8: "ı", 0xb9: "£", 0xba: "ð",
  0xc0: "°", 0xc1: "ℓ", 0xc2: "℗", 0xc3: "©", 0xc4: "♯", 0xc5: "¿", 0xc6: "¡", 0xcf: "ß",
};
const ANSEL_COMBINING = {
  0xe1: "̀", 0xe2: "́", 0xe3: "̂", 0xe4: "̃", 0xe5: "̄", 0xe6: "̆", 0xe7: "̇",
  0xe8: "̈", 0xe9: "̌", 0xea: "̊", 0xed: "̕", 0xee: "̋", 0xf0: "̧", 0xf1: "̨", 0xf2: "̣",
};
function decodeAnsel(buf) {
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) out += String.fromCharCode(b);
    else if (ANSEL_COMBINING[b] && i + 1 < buf.length) {
      // en ANSEL le diacritique précède la lettre
      out += String.fromCharCode(buf[i + 1]) + ANSEL_COMBINING[b];
      i++;
    } else out += ANSEL_SPECIAL[b] || "";
  }
  return out.normalize("NFC");
}

function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString("utf8");
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.slice(2)); b.swap16(); return b.toString("utf16le"); }
  const head = buf.slice(0, 4000).toString("latin1");
  const charset = ((head.match(/\n\s*1\s+CHAR\s+(\S+)/i) || [])[1] || "").toUpperCase();
  if (charset === "ANSEL") return decodeAnsel(buf);
  if (charset === "UTF-8" || charset === "UTF8" || charset === "UNICODE") return buf.toString("utf8");
  // ANSI / IBMPC / ASCII : on tente l'UTF-8 strict, sinon Windows-1252
  const utf = buf.toString("utf8");
  if (!utf.includes("�")) return utf;
  return new TextDecoder("windows-1252").decode(buf);
}

// ---------------------------------------------------------------------------
// Normalisation (recherche insensible aux accents et à la casse)
// ---------------------------------------------------------------------------
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/gi, "oe").replace(/æ/gi, "ae").toLowerCase().trim();

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const FRENCH_REP = { VEND: "vendémiaire", BRUM: "brumaire", FRIM: "frimaire", NIVO: "nivôse", PLUV: "pluviôse", VENT: "ventôse", GERM: "germinal", FLOR: "floréal", PRAI: "prairial", MESS: "messidor", THER: "thermidor", FRUC: "fructidor", COMP: "jour complémentaire" };
const MOD = { ABT: "vers", CAL: "calculé", EST: "estimé", BEF: "avant", AFT: "après", FROM: "de", TO: "à", INT: "", BET: "entre", AND: "et" };

/** Année (grégorienne) la plus significative d'une date GEDCOM */
function yearOf(d) {
  if (!d) return null;
  const s = String(d).toUpperCase();
  if (s.includes("@#DFRENCH")) {
    const an = s.match(/AN\s+([IVXL]+|\d+)/);
    if (an) { const n = /^\d+$/.test(an[1]) ? +an[1] : roman(an[1]); return n ? 1791 + n : null; }
  }
  const m = s.match(/\b(\d{3,4})\b/);
  return m ? +m[1] : null;
}
function roman(r) {
  const v = { I: 1, V: 5, X: 10, L: 50 };
  let n = 0;
  for (let i = 0; i < r.length; i++) n += v[r[i]] < (v[r[i + 1]] || 0) ? -v[r[i]] : v[r[i]];
  return n;
}
/** Clé de tri AAAAMMJJ (approximative) */
function sortKey(d) {
  const y = yearOf(d);
  if (!y) return null;
  const s = String(d).toUpperCase().replace(/@#D\w+@/g, "");
  const m = s.match(/(?:(\d{1,2})\s+)?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{3,4}/);
  return y * 10000 + (m ? MONTHS[m[2]] * 100 + (m[1] ? +m[1] : 0) : 0);
}
/** Affichage en français : « 12 mars 1756 », « vers 1750 », « 3 brumaire an III » */
function frDate(d) {
  if (!d) return "";
  let s = String(d).trim();
  const rep = /@#DFRENCH R@/i.test(s);
  s = s.replace(/@#D[^@]+@\s*/gi, "");
  if (/^\(.*\)$/.test(s)) return s.slice(1, -1);
  return s
    .split(/\s+/)
    .map((t) => {
      const u = t.toUpperCase();
      if (rep && FRENCH_REP[u]) return FRENCH_REP[u];
      if (MONTHS[u]) return MOIS[MONTHS[u] - 1];
      if (u in MOD) return MOD[u];
      if (u === "AN") return "an";
      if (/^\d{1,2}$/.test(t) && t !== "1" && t.startsWith("0")) return String(+t);
      return t === "1" ? "1er" : t;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}
/** Saisie libre (formulaire admin) -> date GEDCOM : « 12/03/1756 », « 12 mars 1756 », « vers 1750 » */
function toGedcomDate(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  if (/^(ABT|BEF|AFT|BET|CAL|EST|FROM|TO|@#)/i.test(s) || /^\d{1,2} [A-Z]{3} \d{3,4}$/.test(s) || /^[A-Z]{3} \d{3,4}$/.test(s)) return s.toUpperCase();
  const pre = [["vers", "ABT"], ["environ", "ABT"], ["avant", "BEF"], ["après", "AFT"], ["apres", "AFT"], ["estimé", "EST"], ["calculé", "CAL"]];
  let prefix = "";
  for (const [fr, g] of pre) if (norm(s).startsWith(norm(fr) + " ")) { prefix = g + " "; s = s.slice(fr.length).trim(); }
  const ABR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{3,4})$/);
  if (m) return `${prefix}${+m[1]} ${ABR[+m[2] - 1]} ${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{3,4})$/);
  if (m) return `${prefix}${ABR[+m[1] - 1]} ${m[2]}`;
  const words = s.replace(/1er/i, "1").split(/\s+/).map((w) => {
    const i = MOIS.findIndex((x) => norm(x) === norm(w) || norm(x).startsWith(norm(w).replace(/\.$/, "")) && norm(w).length >= 3);
    return i >= 0 ? ABR[i] : w;
  });
  m = s.match(/entre\s+(.+)\s+et\s+(.+)/i);
  if (m) return `BET ${toGedcomDate(m[1])} AND ${toGedcomDate(m[2])}`;
  return prefix + words.join(" ").toUpperCase();
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------
const LINE = /^\s*(\d+)\s+(@[^@]+@\s+)?(\S+)(?:\s(.*))?$/;
const EVENTS = { BIRT: "birth", CHR: "chr", BAPM: "chr", DEAT: "death", BURI: "buri", CREM: "crem" };

function parse(buffer) {
  const text = decode(buffer);
  const lines = text.split(/\r\n|\r|\n/);
  // arbre de nœuds { level, xref, tag, value, children }
  const roots = [];
  const stack = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = raw.match(LINE);
    if (!m) continue;
    const node = { level: +m[1], xref: m[2] ? m[2].trim().replace(/@/g, "") : null, tag: m[3].toUpperCase(), value: m[4] ?? "", children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (node.tag === "CONC" || node.tag === "CONT") {
      const parent = stack[stack.length - 1];
      if (parent) parent.value += (node.tag === "CONT" ? "\n" : "") + node.value;
      continue;
    }
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  const people = [];
  const families = [];
  const notes = {};
  let header = null;
  for (const r of roots) if (r.tag === "NOTE" && r.xref) notes[r.xref] = r.value;
  const noteText = (n) => (/^@[^@]+@$/.test(n.value.trim()) ? notes[n.value.trim().replace(/@/g, "")] || "" : n.value);

  for (const r of roots) {
    if (r.tag === "HEAD") header = r;
    if (r.tag === "INDI") {
      const p = { id: r.xref, given: "", surname: "", suffix: "", sex: "", alt_names: [], occupation: "", notes: "", famc: null, fams: [], crem: false, extra: [] };
      let firstName = true;
      for (const c of r.children) {
        if (c.tag === "NAME") {
          const mm = c.value.match(/^(.*?)\/(.*?)\/(.*)$/);
          const given = (c.children.find((x) => x.tag === "GIVN")?.value || (mm ? mm[1] : c.value)).trim();
          const surname = (c.children.find((x) => x.tag === "SURN")?.value || (mm ? mm[2] : "")).trim();
          if (firstName) {
            p.given = given; p.surname = surname; p.suffix = (mm ? mm[3] : "").trim() || c.children.find((x) => x.tag === "NSFX")?.value || "";
            firstName = false;
          } else p.alt_names.push(`${given} ${surname}`.trim());
        } else if (c.tag === "SEX") p.sex = (c.value || "").trim().toUpperCase().slice(0, 1);
        else if (EVENTS[c.tag]) {
          const k = EVENTS[c.tag];
          if (k === "crem") p.crem = true;
          if (k === "crem" && !p.buri_date && !p.buri_place) { // une crémation sert aussi de « sépulture »
            p.buri_date = c.children.find((x) => x.tag === "DATE")?.value || "";
            p.buri_place = c.children.find((x) => x.tag === "PLAC")?.value || "";
          }
          if (k !== "crem" && !p[`${k}_date`] && !p[`${k}_place`]) {
            p[`${k}_date`] = c.children.find((x) => x.tag === "DATE")?.value || "";
            p[`${k}_place`] = c.children.find((x) => x.tag === "PLAC")?.value || "";
            if (k === "death" && !p.death_date && !p.death_place && /^Y/i.test(c.value)) p.deceased = true;
          } else if (k !== "crem") p.extra.push(c);
        } else if (c.tag === "OCCU") p.occupation = p.occupation ? `${p.occupation} ; ${c.value}` : c.value;
        else if (c.tag === "NOTE") p.notes += (p.notes ? "\n\n" : "") + noteText(c);
        else if (c.tag === "FAMC") { if (!p.famc) p.famc = c.value.replace(/@/g, "").trim(); }
        else if (c.tag === "FAMS") p.fams.push(c.value.replace(/@/g, "").trim());
        else if (c.tag !== "CHAN") p.extra.push(c);
      }
      people.push(p);
    }
    if (r.tag === "FAM") {
      const f = { id: r.xref, husband: null, wife: null, children: [], marr_date: "", marr_place: "", div: false, notes: "", extra: [] };
      for (const c of r.children) {
        if (c.tag === "HUSB") f.husband = c.value.replace(/@/g, "").trim();
        else if (c.tag === "WIFE") f.wife = c.value.replace(/@/g, "").trim();
        else if (c.tag === "CHIL") f.children.push(c.value.replace(/@/g, "").trim());
        else if (c.tag === "MARR" && !f.marr_date && !f.marr_place) {
          f.marr_date = c.children.find((x) => x.tag === "DATE")?.value || "";
          f.marr_place = c.children.find((x) => x.tag === "PLAC")?.value || "";
        } else if (c.tag === "DIV") f.div = true;
        else if (c.tag === "NOTE") f.notes += (f.notes ? "\n\n" : "") + noteText(c);
        else if (c.tag !== "CHAN") f.extra.push(c);
      }
      families.push(f);
    }
  }
  // famc manquant : déduit des familles
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const f of families) for (const c of f.children) { const p = byId.get(c); if (p && !p.famc) p.famc = f.id; }

  const source = header?.children.find((c) => c.tag === "SOUR");
  return {
    header: { source: source ? (source.children.find((c) => c.tag === "NAME")?.value || source.value) : "", charset: header?.children.find((c) => c.tag === "CHAR")?.value || "" },
    people,
    families,
  };
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------
function nodeLines(n, level = n.level) {
  const out = [];
  const val = String(n.value ?? "");
  const parts = val.split("\n");
  out.push(`${level} ${n.xref ? `@${n.xref}@ ` : ""}${n.tag}${parts[0] !== "" ? ` ${parts[0]}` : ""}`);
  for (const p of parts.slice(1)) out.push(`${level + 1} CONT ${p}`.trimEnd());
  for (const c of n.children || []) out.push(...nodeLines(c, level + 1));
  return out;
}
function textLines(level, tag, value) {
  return nodeLines({ tag, value, children: [] }, level);
}
function event(tag, date, place) {
  if (!date && !place) return [];
  const out = [`1 ${tag}`];
  if (date) out.push(`2 DATE ${date}`);
  if (place) out.push(`2 PLAC ${place}`);
  return out;
}

function exportGedcom({ tree, people, families }) {
  const d = new Date();
  const ABR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const L = [
    "0 HEAD", "1 SOUR GGAC", "2 NAME Site du G.G.A.C.", "1 DEST ANY", `1 DATE ${d.getDate()} ${ABR[d.getMonth()]} ${d.getFullYear()}`,
    "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8", "1 LANG French", `1 FILE ${tree.id}.ged`,
  ];
  const famsOf = new Map();
  for (const f of families) for (const s of [f.husband, f.wife]) if (s) (famsOf.get(s) || famsOf.set(s, []).get(s)).push(f.id);
  for (const p of people) {
    L.push(`0 @${p.id}@ INDI`);
    L.push(`1 NAME ${p.given || ""} /${p.surname || ""}/${p.suffix ? ` ${p.suffix}` : ""}`.replace(/\s+\//, " /").trim());
    if (p.given) L.push(`2 GIVN ${p.given}`);
    if (p.surname) L.push(`2 SURN ${p.surname}`);
    for (const a of p.alt_names || []) {
      const i = a.lastIndexOf(" ");
      L.push(`1 NAME ${i > 0 ? `${a.slice(0, i)} /${a.slice(i + 1)}/` : `/${a}/`}`);
    }
    if (p.sex) L.push(`1 SEX ${p.sex}`);
    L.push(...event("BIRT", p.birth_date, p.birth_place), ...event("CHR", p.chr_date, p.chr_place), ...event("DEAT", p.death_date, p.death_place));
    if (p.deceased && !p.death_date && !p.death_place) L.push("1 DEAT Y");
    if (p.crem) L.push(...(event("CREM", p.buri_date, p.buri_place).length ? event("CREM", p.buri_date, p.buri_place) : ["1 CREM Y"]));
    else L.push(...event("BURI", p.buri_date, p.buri_place));
    if (p.occupation) L.push(...textLines(1, "OCCU", p.occupation));
    if (p.notes) L.push(...textLines(1, "NOTE", p.notes));
    for (const e of p.extra || []) L.push(...nodeLines(e, 1));
    if (p.famc) L.push(`1 FAMC @${p.famc}@`);
    for (const f of famsOf.get(p.id) || []) L.push(`1 FAMS @${f}@`);
  }
  for (const f of families) {
    L.push(`0 @${f.id}@ FAM`);
    if (f.husband) L.push(`1 HUSB @${f.husband}@`);
    if (f.wife) L.push(`1 WIFE @${f.wife}@`);
    L.push(...event("MARR", f.marr_date, f.marr_place));
    if (f.div) L.push("1 DIV Y");
    for (const c of f.children || []) L.push(`1 CHIL @${c}@`);
    if (f.notes) L.push(...textLines(1, "NOTE", f.notes));
    for (const e of f.extra || []) L.push(...nodeLines(e, 1));
  }
  L.push("0 TRLR");
  return L.join("\n") + "\n";
}

module.exports = { parse, exportGedcom, decode, norm, yearOf, sortKey, frDate, toGedcomDate, MOIS };
