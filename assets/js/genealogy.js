/* G.G.A.C. — généalogie : arbre d'ascendance animé, descendance, formulaire de recherche */
(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NS = "http://www.w3.org/2000/svg";
  const url = (tree, id, what = "") => `/genealogie/${encodeURIComponent(tree)}/${encodeURIComponent(id)}${what ? `/${what}` : ""}`;

  /* ---------- Formulaire : champ grisé si l'opérateur n'attend pas de valeur ---------- */
  $$("[data-gen-search] .sf-ctl").forEach((ctl) => {
    const op = $("select", ctl), input = $("input[type=text]", ctl);
    if (!op || !input) return;
    const sync = () => { const off = ["existe", "nexistepas"].includes(op.value); input.disabled = off; input.classList.toggle("is-off", off); };
    op.addEventListener("change", sync); sync();
  });
  // résultats : apparition en cascade
  if ($(".gen-results")) $(".gen-results").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

  /* ---------- Carte d'une personne ---------- */
  function card(n, { root = false, gen = 1 } = {}) {
    const el = document.createElement(n ? "a" : "div");
    el.className = `pc${n ? "" : " pc--empty"}${root ? " pc--root" : ""}`;
    el.dataset.gen = gen;
    if (!n) { el.innerHTML = `<span class="pc__name">—</span>`; return el; }
    el.href = url(PED.tree, n.id, "ascendance");
    el.dataset.id = n.id;
    el.dataset.sex = n.sex || "";
    el.innerHTML = `<span class="pc__name">${esc(n.name)}</span>
      ${n.living ? `<span class="pc__ev">Vivant</span>` : `${n.b || n.bp ? `<span class="pc__ev"><i>°</i> ${esc(n.b)}${n.bp ? ` <em>${esc(n.bp)}</em>` : ""}</span>` : ""}
      ${n.d || n.dp ? `<span class="pc__ev"><i>†</i> ${esc(n.d)}${n.dp ? ` <em>${esc(n.dp)}</em>` : ""}</span>` : ""}`}
      ${n.more ? `<span class="pc__more" title="Ancêtres suivants">›</span>` : ""}`;
    return el;
  }

  /* ---------- Arbre d'ascendance ---------- */
  const pedEl = $("[data-pedigree]");
  let PED = null;
  if (pedEl) {
    PED = JSON.parse($("script", pedEl).textContent);
    drawPedigree(PED, true);
    $("[data-gens]")?.addEventListener("change", (e) => go(PED.root.id, +e.target.value));
    addEventListener("popstate", (e) => e.state?.ped && go(e.state.id, e.state.g, false));
    let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => drawPedigree(PED, false), 150); });
  }

  function layout(data) {
    const gens = data.gens;
    const GAP = innerWidth < 700 ? 26 : 40, H = innerWidth < 700 ? 74 : 86, VGAP = 10;
    const hasKids = data.families.some((f) => f.children.length || f.spouse);
    const avail = (pedEl.clientWidth || 1000) - (hasKids && innerWidth >= 700 ? 256 : 0) - 8;
    const W = innerWidth < 700 ? 170 : Math.round(Math.max(160, Math.min(230, (avail - (gens - 1) * GAP) / gens)));
    const slots = 2 ** (gens - 1);
    const height = Math.max(slots * (H + VGAP), 360);
    const nodes = [];
    const walk = (n, g, idx) => {
      const count = 2 ** (g - 1);
      const slotH = height / count;
      nodes.push({ n, g, x: (g - 1) * (W + GAP), y: idx * slotH + slotH / 2 - H / 2, idx });
      if (g < gens) {
        const [f, m] = n?.parents || [null, null];
        if (n) { walk(f, g + 1, idx * 2); walk(m, g + 1, idx * 2 + 1); }
      }
    };
    walk(data.root, 1, 0);
    return { nodes, W, H, GAP, width: gens * (W + GAP) - GAP, height };
  }

  function drawPedigree(data, animate) {
    const L = layout(data);
    pedEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "ped";
    const stage = document.createElement("div");
    stage.className = "ped__stage";
    stage.style.width = `${L.width}px`;
    stage.style.height = `${L.height}px`;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ped__lines");
    svg.setAttribute("width", L.width); svg.setAttribute("height", L.height);
    stage.appendChild(svg);
    const byKey = new Map(L.nodes.map((o) => [`${o.g}:${o.idx}`, o]));
    for (const o of L.nodes) {
      // lien vers les parents
      if (o.g < data.gens && o.n) {
        const f = byKey.get(`${o.g + 1}:${o.idx * 2}`), m = byKey.get(`${o.g + 1}:${o.idx * 2 + 1}`);
        const x0 = o.x + L.W, y0 = o.y + L.H / 2, xm = x0 + L.GAP / 2;
        for (const par of [f, m]) {
          if (!par) continue;
          const p = document.createElementNS(NS, "path");
          const y1 = par.y + L.H / 2;
          p.setAttribute("d", `M${x0} ${y0} H${xm} V${y1} H${par.x}`);
          p.setAttribute("class", `ped__line${par.n ? "" : " is-empty"}`);
          p.style.setProperty("--g", o.g);
          svg.appendChild(p);
        }
      }
      const c = card(o.n, { root: o.g === 1, gen: o.g });
      c.style.left = `${o.x}px`; c.style.top = `${o.y}px`; c.style.width = `${L.W}px`; c.style.height = `${L.H}px`;
      c.style.setProperty("--g", o.g); c.style.setProperty("--i", o.idx);
      stage.appendChild(c);
    }
    // descendance directe à gauche de la personne centrale
    const kids = data.families.filter((f) => f.children.length || f.spouse);
    const aside = document.createElement("aside");
    aside.className = "ped__family";
    aside.innerHTML = kids.length ? kids.map((f) => `<div class="pf">
        ${f.spouse ? `<p class="pf__sp">∞ <a href="${url(data.tree, f.spouse.id, "ascendance")}" data-id="${esc(f.spouse.id)}">${esc(f.spouse.name)}</a></p>` : ""}
        ${f.children.length ? `<ul>${f.children.map((k) => `<li><a href="${url(data.tree, k.id, "ascendance")}" data-id="${esc(k.id)}" data-sex="${esc(k.sex)}">${esc(k.name)}</a> <small>${esc(k.years)}</small></li>`).join("")}</ul>` : ""}
      </div>`).join("") : "";
    if (kids.length) { const h = document.createElement("h3"); h.textContent = "Conjoints et enfants"; aside.prepend(h); }
    wrap.append(...(kids.length ? [aside] : []), stage);
    pedEl.appendChild(wrap);
    // liens de l'en-tête
    $$("[data-root-name]").forEach((e) => (e.textContent = data.root.name));
    const rl = $("[data-root-link]"); if (rl) rl.href = url(data.tree, data.root.id);
    const dl = $("[data-desc-link]"); if (dl) dl.href = url(data.tree, data.root.id, "descendance");
    // animation d'entrée
    if (animate && !reduce) {
      $$(".pc", stage).forEach((c) => c.animate(
        [{ opacity: 0, transform: "translateX(-24px) scale(.96)" }, { opacity: 1, transform: "none" }],
        { duration: 600, delay: (+c.dataset.gen - 1) * 160 + (+c.style.getPropertyValue("--i") || 0) * 18, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }
      ));
      $$(".ped__line", svg).forEach((p) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = len;
        p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, delay: (+p.style.getPropertyValue("--g")) * 160 - 60, easing: "cubic-bezier(.65,0,.35,1)", fill: "backwards" });
      });
      $$(".pf", aside).forEach((f, i) => f.animate([{ opacity: 0, transform: "translateX(20px)" }, { opacity: 1, transform: "none" }], { duration: 600, delay: 200 + i * 90, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
    }
    // navigation sans rechargement
    wrap.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-id]");
      if (!a || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (a.classList.contains("pc--root")) { location.href = url(data.tree, data.root.id); return; }
      focusAndGo(a, a.dataset.id);
    });
  }

  async function focusAndGo(el, id) {
    const rootEl = $(".pc--root", pedEl);
    if (!reduce && el.classList.contains("pc") && rootEl) {
      const a = el.getBoundingClientRect(), b = rootEl.getBoundingClientRect();
      $$(".pc, .ped__line, .pf", pedEl).forEach((x) => x !== el && x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }));
      await el.animate([{ transform: "none" }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px)` }], { duration: 500, easing: "cubic-bezier(.65,0,.35,1)", fill: "forwards" }).finished;
    } else if (!reduce) {
      await pedEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).finished;
    }
    await go(id, PED.gens);
  }

  async function go(id, g, push = true) {
    try {
      const r = await fetch(`/genealogie/api/${encodeURIComponent(PED.tree)}/${encodeURIComponent(id)}/ascendance?g=${g}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error(r.status);
      PED = await r.json();
      pedEl.getAnimations().forEach((a) => a.cancel());
      drawPedigree(PED, true);
      if (push) history.pushState({ ped: 1, id, g }, "", `${url(PED.tree, id, "ascendance")}${g !== 4 ? `?g=${g}` : ""}`);
      document.title = document.title.replace(/Ascendance de .*? -/, `Ascendance de ${PED.root.name} -`);
    } catch {
      location.href = url(PED.tree, id, "ascendance");
    }
  }

  /* ---------- Descendance ---------- */
  const descEl = $("[data-descendants]");
  if (descEl) {
    const data = JSON.parse($("script", descEl).textContent);
    const person = (n) => `<a class="dn__p" href="${url(data.tree, n.id)}" data-sex="${esc(n.sex)}">${esc(n.name)}</a> <small>${esc(n.years)}</small>
      <a class="dn__go" href="${url(data.tree, n.id, "descendance")}" title="Descendance de cette personne">⤵</a>`;
    const render = (n, depth) => {
      const fams = n.families || [];
      const has = fams.some((f) => f.children.length || f.spouse);
      return `<li class="dn" style="--d:${depth}">
        <div class="dn__row">${has ? `<button class="dn__tog" aria-expanded="${depth < 2}" aria-label="Déplier">›</button>` : '<span class="dn__dot"></span>'}${person(n)}</div>
        ${has ? `<div class="dn__kids"${depth < 2 ? "" : " hidden"}>${fams.map((f) => `
          ${f.spouse ? `<p class="dn__sp">∞ ${person(f.spouse)}${f.marr ? ` <small>(mariage : ${esc(f.marr)})</small>` : ""}</p>` : ""}
          ${f.children.length ? `<ul>${f.children.map((k) => render(k, depth + 1)).join("")}</ul>` : ""}`).join("")}</div>` : ""}
      </li>`;
    };
    descEl.innerHTML = `<ul class="dtree">${render(data.root, 0)}</ul>`;
    descEl.addEventListener("click", (e) => {
      const b = e.target.closest(".dn__tog");
      if (!b) return;
      const kids = b.closest(".dn").querySelector(":scope > .dn__kids");
      const open = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", open);
      kids.hidden = !open;
      if (open && !reduce) $$(":scope > ul > li, :scope > .dn__sp", kids).forEach((li, i) => li.animate([{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }], { duration: 450, delay: i * 50, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
    });
    if (!reduce) $$(".dn", descEl).forEach((li) => { if (li.offsetParent) li.animate([{ opacity: 0, transform: "translateX(-16px)" }, { opacity: 1, transform: "none" }], { duration: 600, delay: Math.min(+li.style.getPropertyValue("--d") * 140, 800), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }); });
    $("[data-gens]")?.addEventListener("change", (e) => { location.search = `?g=${e.target.value}`; });
  }
  $$(".chart-bar [data-gens]").forEach((s) => { if (!pedEl && !descEl) s.closest("label").hidden = true; });
})();
