// Génère un GEDCOM fictif (tests uniquement) : ascendance sur 6 générations + descendance
const fs = require("fs");
const SUR = ["DUPONT", "LEFEBVRE", "MARTIN", "DURIEUX", "CARPENTIER", "LEROY", "DELATTRE", "BOUTTEMY", "HENNEQUIN", "WIART", "DOFFE", "PLOUQUET", "MAIRESSE", "FRÉMICOURT", "CAUDRON", "LESNE"];
const GM = ["Jean", "Pierre", "Jacques", "Louis", "Antoine", "François", "Nicolas", "Joseph"], GF = ["Marie", "Anne", "Catherine", "Marguerite", "Jeanne", "Françoise", "Rosalie", "Augustine"];
const PL = ["Cambrai", "Escaudœuvres", "Iwuy", "Caudry", "Masnières", "Villers-Plouich", "Fontaine-Notre-Dame", "Esnes"];
const M = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
let pi = 0, fi = 0, seed = 7;
const rnd = (n) => (seed = (seed * 9301 + 49297) % 233280) % n;
const people = [], fams = [];
function person(sex, year, surname) {
  const id = `I${++pi}`;
  const p = { id, sex, given: sex === "M" ? GM[rnd(8)] : GF[rnd(8)], surname, year, place: PL[rnd(8)], famc: null, fams: [] };
  people.push(p);
  return p;
}
// ascendance
const root = person("M", 1890, "DUPONT");
let gen = [root];
for (let g = 1; g < 7; g++) {
  const next = [];
  for (const c of gen) {
    if (!c) { next.push(null, null); continue; }
    if (g >= 5 && rnd(3) === 0) { next.push(null, null); continue; } // ancêtres inconnus
    const f = person("M", c.year - 28 - rnd(6), c.surname);
    const m = person("F", c.year - 24 - rnd(6), SUR[rnd(SUR.length)]);
    const fam = { id: `F${++fi}`, h: f.id, w: m.id, kids: [c.id], year: c.year - 2 };
    fams.push(fam); c.famc = fam.id; f.fams.push(fam.id); m.fams.push(fam.id);
    next.push(f, m);
  }
  gen = next;
}
// descendance de la racine (jusqu'à des personnes vivantes)
function descend(p, depth) {
  if (depth > 4) return;
  const sp = person(p.sex === "M" ? "F" : "M", p.year + rnd(4), SUR[rnd(SUR.length)]);
  const fam = { id: `F${++fi}`, h: p.sex === "M" ? p.id : sp.id, w: p.sex === "M" ? sp.id : p.id, kids: [], year: p.year + 24 };
  fams.push(fam); p.fams.push(fam.id); sp.fams.push(fam.id);
  const n = 1 + rnd(3);
  for (let i = 0; i < n; i++) {
    const k = person(rnd(2) ? "M" : "F", p.year + 26 + i * 3, fam.h === p.id ? p.surname : sp.surname);
    k.famc = fam.id; fam.kids.push(k.id);
    if (i === 0) descend(k, depth + 1);
  }
}
descend(root, 1);
const date = (y) => `${1 + rnd(28)} ${M[rnd(12)]} ${y}`;
const L = ["0 HEAD", "1 SOUR TEST", "2 NAME Fichier fictif de test", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8"];
for (const p of people) {
  L.push(`0 @${p.id}@ INDI`, `1 NAME ${p.given} /${p.surname}/`, `1 SEX ${p.sex}`, "1 BIRT", `2 DATE ${p.year < 1800 && rnd(4) === 0 ? `ABT ${p.year}` : date(p.year)}`, `2 PLAC ${p.place}, Nord, France`);
  if (p.year < 1700) L.push("1 CHR", `2 DATE ${date(p.year)}`, `2 PLAC ${p.place}`);
  if (p.year < 1935) L.push("1 DEAT", `2 DATE ${date(p.year + 40 + rnd(40))}`, `2 PLAC ${PL[rnd(8)]}, Nord, France`);
  if (p.year < 1935 && rnd(2)) L.push("1 BURI", `2 PLAC ${p.place}`);
  if (rnd(3) === 0) L.push(`1 OCCU ${["laboureur", "mulquinier", "brasseur", "tisserand", "cultivateur", "maréchal-ferrant"][rnd(6)]}`);
  if (p.famc) L.push(`1 FAMC @${p.famc}@`);
  for (const f of p.fams) L.push(`1 FAMS @${f}@`);
}
for (const f of fams) {
  L.push(`0 @${f.id}@ FAM`, `1 HUSB @${f.h}@`, `1 WIFE @${f.w}@`, "1 MARR", `2 DATE ${date(f.year)}`, `2 PLAC ${PL[rnd(8)]}`);
  for (const k of f.kids) L.push(`1 CHIL @${k}@`);
}
L.push("0 TRLR");
fs.writeFileSync(__dirname + "/fixtures/familles-fictives.ged", L.join("\n") + "\n");
console.log(people.length, "personnes,", fams.length, "familles");
