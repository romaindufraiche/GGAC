/* G.G.A.C. — panier, boutons d'achat, ouverture des PDF dans la liseuse */
(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const KEY = "ggac-panier";
  const eur = (n) => (n == null ? "—" : `${(+n).toFixed(2).replace(".", ",").replace(",00", "")} €`);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- Stockage du panier ---------- */
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* */ } refreshBadge(); renderDrawer(); };
  const count = () => load().reduce((s, i) => s + (i.qty || 1), 0);
  function add(item) {
    const c = load();
    const same = c.find((i) => i.ref === item.ref && i.format === item.format && !!i.luxe === !!item.luxe);
    if (same) { if (item.format === "papier") same.qty = Math.min(50, (same.qty || 1) + 1); }
    else c.push({ ...item, qty: 1 });
    save(c);
  }

  /* ---------- Données ---------- */
  let catalog = null, session = null;
  const getCatalog = () => catalog || (catalog = fetch("/api/catalogue").then((r) => r.json()));
  const getSession = () => session || (session = fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({ member: null, readable: [] })));

  /* ---------- Icône panier (barre du haut) ---------- */
  const quick = $(".quick");
  let cartLink = $("[data-cart-link]");
  if (!cartLink && quick) {
    cartLink = document.createElement("a");
    cartLink.href = "/panier.html";
    cartLink.className = "quick__cart";
    cartLink.setAttribute("data-cart-link", "");
    cartLink.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>Panier<span class="cart-count" hidden>0</span>`;
    quick.appendChild(cartLink);
  }
  function refreshBadge(pop) {
    const n = count();
    $$(".cart-count").forEach((b) => {
      b.textContent = n;
      b.hidden = !n;
      if (pop && !reduce) b.animate([{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 450, easing: "cubic-bezier(.3,1.6,.5,1)" });
    });
  }
  refreshBadge();
  cartLink?.addEventListener("click", (e) => {
    if (location.pathname === "/panier.html") return;
    e.preventDefault();
    openDrawer();
  });

  /* ---------- Tiroir ---------- */
  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.setAttribute("aria-label", "Panier");
  drawer.innerHTML = `<div class="drawer__veil" data-close></div><div class="drawer__panel" role="dialog" aria-modal="true">
    <header><h2>Panier</h2><button class="drawer__x" data-close aria-label="Fermer">×</button></header>
    <ul class="drawer__list"></ul>
    <p class="drawer__empty">Votre panier est vide.</p>
    <footer><p class="drawer__sum"><span>Sous-total</span><b>—</b></p><p class="drawer__hint">Frais de port calculés à l'étape suivante.</p><a class="btn-ink btn-ink--big" href="/panier.html">Commander</a></footer>
  </div>`;
  document.body.appendChild(drawer);
  drawer.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeDrawer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("is-open")) closeDrawer(); });
  function openDrawer() { renderDrawer(); drawer.classList.add("is-open"); document.body.classList.add("drawer-open"); $(".drawer__x", drawer).focus(); }
  function closeDrawer() { drawer.classList.remove("is-open"); document.body.classList.remove("drawer-open"); }

  async function renderDrawer() {
    const items = load();
    const list = $(".drawer__list", drawer);
    $(".drawer__empty", drawer).hidden = !!items.length;
    $("footer", drawer).hidden = !items.length;
    if (!items.length) { list.innerHTML = ""; return; }
    const { products, luxe } = await getCatalog();
    const s = await getSession();
    let sum = 0;
    list.innerHTML = items.map((it, i) => {
      const p = products[it.ref];
      if (!p) return "";
      const unit = it.format === "numerique" ? (p.dfm && s.member ? 0 : p.pd) : p.pp + (it.luxe ? luxe : 0);
      sum += unit * (it.qty || 1);
      return `<li class="ditem" style="--i:${i}">
        <span class="ditem__cover">${p.c ? `<img src="${esc(p.c)}" alt="">` : ""}</span>
        <span class="ditem__body"><b>${esc(p.t)}</b><small>${it.format === "numerique" ? "Version numérique" : `Version papier${it.luxe ? " — luxe" : ""}`} · ${eur(unit)}</small>
          ${it.format === "papier" ? `<span class="qty"><button data-q="-1" data-i="${i}" aria-label="Moins">−</button><span>${it.qty || 1}</span><button data-q="1" data-i="${i}" aria-label="Plus">+</button></span>` : ""}</span>
        <button class="ditem__rm" data-rm="${i}" aria-label="Retirer">×</button></li>`;
    }).join("");
    $(".drawer__sum b", drawer).textContent = eur(sum);
  }
  drawer.addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]"), rm = e.target.closest("[data-rm]");
    if (!q && !rm) return;
    const c = load();
    if (q) { const it = c[+q.dataset.i]; it.qty = Math.max(1, Math.min(50, (it.qty || 1) + +q.dataset.q)); }
    if (rm) {
      const li = rm.closest("li");
      const go = () => { c.splice(+rm.dataset.rm, 1); save(c); };
      return reduce ? go() : li.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(40px)" }], { duration: 250 }).finished.then(go);
    }
    save(c);
  });

  /* ---------- Animation « vers le panier » ---------- */
  function fly(fromEl) {
    if (reduce || !fromEl || !cartLink) return;
    const a = fromEl.getBoundingClientRect(), b = cartLink.getBoundingClientRect();
    if (!a.width) return;
    const ghost = fromEl.cloneNode(true);
    Object.assign(ghost.style, { position: "fixed", left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: 0, zIndex: 999, pointerEvents: "none", borderRadius: "4px", boxShadow: "0 20px 40px rgba(0,0,0,.35)", objectFit: "cover" });
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    ghost.animate(
      [
        { transform: "translate(0,0) scale(1) rotate(0)", opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 120}px) scale(.55) rotate(-12deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(.08) rotate(-25deg)`, opacity: 0.2 },
      ],
      { duration: 900, easing: "cubic-bezier(.5,0,.3,1)" }
    ).finished.then(() => { ghost.remove(); refreshBadge(true); });
  }
  function toast(html) {
    let t = $(".shop-toast");
    if (!t) { t = document.createElement("div"); t.className = "shop-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.innerHTML = html;
    t.classList.remove("is-in"); void t.offsetWidth; t.classList.add("is-in");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("is-in"), 3200);
  }

  /* ---------- Boutons d'achat dans les pages ---------- */
  async function decorate() {
    const blocks = $$("[data-product]");
    if (!blocks.length) return;
    const [{ products, luxe }, s] = await Promise.all([getCatalog(), getSession()]);
    blocks.forEach((el) => {
      const p = products[el.dataset.product];
      if (!p || $(".buy", el)) return;
      const box = document.createElement("div");
      box.className = "buy";
      const canDigital = p.pd != null && (!p.dmo || s.member);
      const readable = s.readable.includes(el.dataset.product);
      box.innerHTML = `
        ${p.pp != null ? `<div class="buy__row"><button type="button" class="buy__btn" data-add="papier"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2"/></svg>Papier <b>${eur(p.pp)}</b></button>
          ${p.l ? `<label class="buy__luxe"><input type="checkbox"> luxe (+${eur(luxe)})</label>` : ""}</div>` : ""}
        ${p.pd != null ? `<div class="buy__row">${canDigital
          ? `<button type="button" class="buy__btn buy__btn--alt" data-add="numerique"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 18h6"/></svg>Numérique <b>${p.dfm && s.member ? "gratuit" : eur(p.pd)}</b></button>`
          : `<a class="buy__member" href="/espace-membre.html?retour=${encodeURIComponent(location.pathname)}">Numérique ${eur(p.pd)} — membres</a>`}</div>` : ""}
        ${readable ? `<a class="buy__read" href="/lire/${encodeURIComponent(el.dataset.product)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 5h8a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H2zM22 5h-8a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h8z"/></svg>Lire</a>` : ""}`;
      (el.querySelector(".issue__body") || el).appendChild(box);
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-add]");
        if (!b) return;
        const lux = !!$(".buy__luxe input", box)?.checked;
        add({ ref: el.dataset.product, format: b.dataset.add, luxe: b.dataset.add === "papier" && lux });
        b.classList.add("is-added");
        setTimeout(() => b.classList.remove("is-added"), 1400);
        fly(el.querySelector("img"));
        toast(`<b>${esc(p.t)}</b> ajouté au panier · <a href="/panier.html">Voir le panier</a>`);
        if (reduce) refreshBadge(true);
      });
    });
  }
  decorate();

  /* ---------- Les PDF du site s'ouvrent dans la liseuse ---------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    const href = a.getAttribute("href");
    if (/^\/media\/\d+\/.*\.pdf$/i.test(href) || /^https:\/\/www\.ggac\.fr\/fichiers\/.+\.pdf$/i.test(href)) {
      e.preventDefault();
      location.href = `/lire?src=${encodeURIComponent(href)}`;
    }
  });

  /* Commande enregistrée : on vide le panier */
  if ($("[data-order]") && /nouvelle=1/.test(location.search)) { try { localStorage.removeItem(KEY); } catch { /* */ } refreshBadge(); }

  /* ---------- Page panier ---------- */
  const page = $("[data-cart-page]");
  if (!page) return;
  const list = $(".cart-list", page), summary = $(".cart-summary", page), checkout = $(".checkout", page);
  const zoneSel = $("[data-zone]", page);
  try { zoneSel.value = localStorage.getItem("ggac-zone") || "france"; } catch { /* */ }
  zoneSel.addEventListener("change", () => { try { localStorage.setItem("ggac-zone", zoneSel.value); } catch { /* */ } draw(); });

  async function draw() {
    const items = load();
    const empty = !items.length;
    $(".cart-empty", page).hidden = !empty;
    summary.hidden = checkout.hidden = empty;
    if (empty) { list.innerHTML = ""; return; }
    const q = await fetch("/api/devis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items, zone: zoneSel.value }) }).then((r) => r.json());
    list.innerHTML = q.lines.map((l, i) => {
      const idx = items.findIndex((it) => it.ref === l.ref && it.format === l.format && !!it.luxe === !!l.luxe);
      return `<li class="cline" style="--i:${i}">
        <span class="cline__cover">${l.cover ? `<img src="${esc(l.cover)}" alt="">` : ""}</span>
        <span class="cline__body"><b>${esc(l.title)}</b><small>${esc(l.ref)}${l.details ? ` · ${esc(l.details)}` : ""}</small>
          <span class="cline__fmt">${l.format === "numerique" ? "Version numérique" : `Version papier${l.luxe ? " — luxe" : ""}`}</span></span>
        <span class="cline__qty">${l.format === "papier" ? `<span class="qty"><button data-q="-1" data-i="${idx}" aria-label="Moins">−</button><span>${l.qty}</span><button data-q="1" data-i="${idx}" aria-label="Plus">+</button></span>` : "—"}</span>
        <span class="cline__price">${eur(l.total)}</span>
        <button class="ditem__rm" data-rm="${idx}" aria-label="Retirer">×</button></li>`;
    }).join("");
    const ship = q.shipping == null ? "à confirmer" : eur(q.shipping);
    $(".totals", summary).innerHTML = `<dt>Sous-total</dt><dd>${eur(q.subtotal)}</dd>
      ${q.shippingDetail.map((d) => `<dt class="sub">Port ${esc(d.label.toLowerCase())} (${d.count})</dt><dd class="sub">${d.cost == null ? "à confirmer" : eur(d.cost)}</dd>`).join("")}
      <dt>Frais de port</dt><dd>${ship}</dd><dt class="grand">Total${q.shipping == null ? " (hors port)" : ""}</dt><dd class="grand">${eur(q.total)}</dd>`;
    const err = $(".cart-errors", summary);
    err.hidden = !q.errors.length;
    err.innerHTML = q.errors.map(esc).join("<br>");
    $('input[name="cart"]', checkout).value = JSON.stringify(items);
    $('input[name="zone"]', checkout).value = zoneSel.value;
  }
  page.addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]"), rm = e.target.closest("[data-rm]");
    if (!q && !rm) return;
    const c = load();
    if (q) { const it = c[+q.dataset.i]; if (it) it.qty = Math.max(1, Math.min(50, (it.qty || 1) + +q.dataset.q)); }
    if (rm) c.splice(+rm.dataset.rm, 1);
    save(c); draw();
  });
  draw();
})();
