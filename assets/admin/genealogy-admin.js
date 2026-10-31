/* Admin généalogie : sélecteur de personnes (autocomplétion) et aperçu des dates */
(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  $$("[data-person-picker]").forEach((box) => {
    const input = $('input[type="search"]', box), hidden = $('input[type="hidden"]', box), list = $(".picker__list", box);
    let timer, items = [], sel = -1;
    const choose = (it) => {
      hidden.value = it.id;
      input.value = `${it.name} (${it.id})`;
      input.classList.add("is-picked");
      list.hidden = true;
    };
    input.addEventListener("input", () => {
      hidden.value = "";
      input.classList.remove("is-picked");
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { list.hidden = true; return; }
      timer = setTimeout(async () => {
        const r = await fetch(`/admin/genealogie/${encodeURIComponent(box.dataset.tree)}/api/personnes?q=${encodeURIComponent(q)}`);
        items = await r.json();
        sel = -1;
        list.innerHTML = items.length
          ? items.map((it, i) => `<li data-i="${i}" class="${it.sex === "F" ? "is-f" : ""}"><b>${esc(it.name)}</b> <span>${esc(it.id)} · ${esc(it.years || "")}${it.place ? ` · ${esc(it.place)}` : ""}</span></li>`).join("")
          : `<li class="is-empty">Aucune personne trouvée</li>`;
        list.hidden = false;
      }, 220);
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) { e.preventDefault(); choose(items[+li.dataset.i]); }
    });
    input.addEventListener("keydown", (e) => {
      const lis = $$("li[data-i]", list);
      if (list.hidden || !lis.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        lis.forEach((l, i) => l.classList.toggle("is-sel", i === sel));
      } else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); choose(items[sel]); }
      else if (e.key === "Escape") list.hidden = true;
    });
    input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
  });

  // Aperçu des dates en français pendant la saisie
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const ABR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const MOD = { ABT: "vers", BEF: "avant", AFT: "après", BET: "entre", AND: "et", CAL: "calculé", EST: "estimé", FROM: "de", TO: "à" };
  function preview(v) {
    v = v.trim();
    if (!v) return "";
    let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{3,4})$/);
    if (m) return `${+m[1] === 1 ? "1er" : +m[1]} ${MOIS[+m[2] - 1] || "?"} ${m[3]}`;
    return v.split(/\s+/).map((t) => { const u = t.toUpperCase(); const i = ABR.indexOf(u); return i >= 0 ? MOIS[i] : MOD[u] || t; }).join(" ");
  }
  $$("[data-gdate]").forEach((inp) => {
    const out = inp.closest(".date-field")?.querySelector(".date-preview");
    if (!out) return;
    inp.addEventListener("input", () => { out.textContent = preview(inp.value) ? `→ ${preview(inp.value)}` : ""; });
  });
})();
