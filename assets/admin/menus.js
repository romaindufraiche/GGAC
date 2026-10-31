/* Éditeur du menu principal : arbre à 3 niveaux, glisser-déposer */
(() => {
  "use strict";
  const form = document.querySelector("[data-menu-editor]");
  if (!form) return;
  const hidden = form.querySelector('input[name="nav"]');
  const root = form.querySelector("[data-tree]");
  const pages = JSON.parse(document.getElementById("page-list").textContent);
  let nav = JSON.parse(hidden.value || "[]");
  const collapsed = new Set();
  const save = () => (hidden.value = JSON.stringify(nav));

  const datalist = document.createElement("datalist");
  datalist.id = "pages-dl";
  datalist.innerHTML = pages.map((p) => `<option value="${p.v}">${p.t.replace(/</g, "&lt;")}</option>`).join("");
  form.appendChild(datalist);

  function draw() {
    root.innerHTML = "";
    nav.forEach((item, i) => root.appendChild(node(item, nav, i, 0, `r${i}`)));
    save();
  }

  function node(item, arr, i, depth, key) {
    const li = document.createElement("li");
    li.className = "tree-item" + (depth === 0 ? " is-root" : "") + (collapsed.has(key) ? " is-collapsed" : "");
    const kids = item.children || [];
    const row = document.createElement("div");
    row.className = "tree-row";
    row.draggable = true;
    row.innerHTML = `<span class="handle" title="Déplacer">⋮⋮</span>
      <input type="text" data-k="label" placeholder="Libellé">
      <input type="text" data-k="href" list="pages-dl" placeholder="${depth === 0 ? "Lien (vide = sous-menu)" : "Lien"}">
      <span class="row-actions">
        ${kids.length ? `<button type="button" class="toggle-kids" data-act="fold">${collapsed.has(key) ? "▸" : "▾"} ${kids.length}</button>` : ""}
        ${depth < 2 ? `<button type="button" class="icon-btn" data-act="add" title="Ajouter un sous-élément">＋</button>` : ""}
        <button type="button" class="icon-btn icon-btn--danger" data-act="del" title="Supprimer">✕</button>
      </span>`;
    row.querySelector('[data-k="label"]').value = item.label || "";
    row.querySelector('[data-k="href"]').value = item.href || "";
    row.addEventListener("input", (e) => {
      item[e.target.dataset.k] = e.target.value || (e.target.dataset.k === "href" ? null : "");
      save();
    });
    row.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "del") {
        if (kids.length && !(await window.ggacAsk(`Supprimer « ${item.label} » et ses ${kids.length} sous-éléments ?`))) return;
        arr.splice(i, 1); draw();
      }
      if (act === "add") { item.children = [...kids, { label: "", href: "", children: null }]; collapsed.delete(key); draw(); }
      if (act === "fold") { collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key); draw(); }
    });
    window.ggacDragSort(row, i, (from, to) => { const [m] = arr.splice(from, 1); arr.splice(to, 0, m); draw(); });
    li.appendChild(row);
    if (kids.length && !collapsed.has(key)) {
      const ol = document.createElement("ol");
      kids.forEach((k, j) => ol.appendChild(node(k, kids, j, depth + 1, `${key}-${j}`)));
      li.appendChild(ol);
    }
    return li;
  }

  // les longues listes (dictionnaires) sont repliées par défaut
  nav.forEach((n, i) => (n.children || []).forEach((c, j) => { if ((c.children || []).length > 12) collapsed.add(`r${i}-${j}`); }));
  form.querySelector("[data-add-root]").addEventListener("click", () => { nav.push({ label: "Nouvelle rubrique", href: null, children: [] }); draw(); });
  draw();
})();
