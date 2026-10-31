/* Liseuse G.G.A.C. — PDF.js, mode livre (pages qui tournent) ou défilement */
import * as pdfjsLib from "/vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const stage = $(".rd-stage");
const bookEl = $(".rd-book");
const scrollEl = $(".rd-scroll");
const pageInput = $(".rd-page input");
const range = $(".rd-range");

const S = {
  pdf: null, n: 0, page: 1, mode: "book", zoom: 1, ratio: 1.414, busy: false,
  narrow: () => innerWidth < 900,
};
const KEY = `ggac-read:${document.body.dataset.src}`;

/* ---------- Rendu des pages (avec cache) ---------- */
const cache = new Map();
async function render(n, cssW) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const key = `${n}@${Math.round(cssW)}`;
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    const page = await S.pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = (cssW / vp1.width) * dpr;
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    c.style.width = `${cssW}px`;
    c.style.height = `${(cssW * vp1.height) / vp1.width}px`;
    await page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: vp }).promise;
    return c;
  })();
  cache.set(key, job);
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  return job;
}
function copy(canvas) {
  const c = document.createElement("canvas");
  c.width = canvas.width; c.height = canvas.height;
  c.style.width = canvas.style.width; c.style.height = canvas.style.height;
  c.getContext("2d").drawImage(canvas, 0, 0);
  return c;
}

/* ---------- Mode livre ---------- */
// Pages affichées : couverture seule à droite, puis paires (2-3), (4-5)…
function spreadOf(p) {
  if (S.narrow()) return [p, null];
  if (p <= 1) return [null, 1];
  const left = p % 2 === 0 ? p : p - 1;
  return [left, left + 1 <= S.n ? left + 1 : null];
}
function pageSize() {
  const pad = S.narrow() ? 24 : 70;
  const availH = stage.clientHeight - pad;
  const availW = (stage.clientWidth - pad) / (S.narrow() ? 1 : 2);
  const w = Math.min(availW, availH / S.ratio) * S.zoom;
  return Math.max(120, Math.floor(w));
}
async function slot(n, w) {
  const d = document.createElement("div");
  d.className = "rd-pg";
  d.style.width = `${w}px`;
  d.style.height = `${w * S.ratio}px`;
  if (n) d.appendChild(copy(await render(n, w)));
  else d.classList.add("is-blank");
  return d;
}
async function drawBook() {
  const w = pageSize();
  const [l, r] = spreadOf(S.page);
  const spread = document.createElement("div");
  spread.className = "rd-spread" + (S.narrow() ? " is-single" : "");
  if (!S.narrow()) spread.appendChild(await slot(l, w));
  spread.appendChild(await slot(S.narrow() ? l : r, w));
  bookEl.replaceChildren(spread);
  bookEl.classList.toggle("is-zoomed", S.zoom > 1);
  // pré-rendu des pages voisines
  [S.page + 1, S.page + 2, S.page + 3, S.page - 1, S.page - 2].filter((x) => x >= 1 && x <= S.n).forEach((x) => render(x, w));
}

async function turn(dir) {
  if (S.busy) return;
  const [l, r] = spreadOf(S.page);
  let target;
  if (S.narrow()) target = S.page + dir;
  else target = dir > 0 ? (r || l) + 1 : (l || 1) - 1;
  if (target < 1 || target > S.n) return bump(dir);
  if (S.mode !== "book" || reduce) { S.page = target; return update(); }
  S.busy = true;
  const w = pageSize();
  const spread = $(".rd-spread", bookEl);
  const [nl, nr] = spreadOf(target);

  if (S.narrow()) {
    const next = await slot(target, w);
    next.classList.add("rd-pg--incoming");
    next.style.setProperty("--from", dir > 0 ? "40px" : "-40px");
    spread.replaceChildren(next);
  } else {
    // la feuille qui tourne : recto = page qui part, verso = page qui arrive
    const leaf = document.createElement("div");
    leaf.className = `rd-leaf rd-leaf--${dir > 0 ? "next" : "prev"}`;
    leaf.style.width = `${w}px`;
    leaf.style.height = `${w * S.ratio}px`;
    const front = await slot(dir > 0 ? r : l, w);
    const back = await slot(dir > 0 ? nl : nr, w);
    front.classList.add("rd-leaf__front");
    back.classList.add("rd-leaf__back");
    leaf.append(front, back);
    // sous la feuille : la page de l'autre côté du nouveau double
    const under = await slot(dir > 0 ? nr : nl, w);
    const slots = $$(".rd-pg", spread);
    slots[dir > 0 ? 1 : 0].replaceWith(under);
    spread.appendChild(leaf);
    await leaf.animate(
      [
        { transform: "rotateY(0deg)" },
        { transform: `rotateY(${dir > 0 ? -90 : 90}deg)`, offset: 0.5 },
        { transform: `rotateY(${dir > 0 ? -180 : 180}deg)` },
      ],
      { duration: 750, easing: "cubic-bezier(.45,.05,.25,1)" }
    ).finished;
  }
  S.page = target;
  S.busy = false;
  await update(true);
}
function bump(dir) {
  bookEl.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dir * 12}px)` }, { transform: "translateX(0)" }], { duration: 300, easing: "ease-out" });
}

/* ---------- Mode défilement ---------- */
let scrollObs;
function drawScroll() {
  const w = Math.min(stage.clientWidth - 40, 900) * S.zoom;
  scrollEl.replaceChildren();
  scrollObs?.disconnect();
  scrollObs = new IntersectionObserver(
    (entries) => entries.forEach(async (e) => {
      const n = +e.target.dataset.n;
      if (e.isIntersecting && !e.target.firstChild) e.target.appendChild(copy(await render(n, w)));
      if (e.isIntersecting && e.intersectionRatio > 0.4) { S.page = n; syncControls(); }
    }),
    { root: stage, rootMargin: "600px 0px", threshold: [0, 0.4] }
  );
  for (let n = 1; n <= S.n; n++) {
    const d = document.createElement("div");
    d.className = "rd-pg rd-pg--scroll";
    d.dataset.n = n;
    d.style.width = `${w}px`;
    d.style.height = `${w * S.ratio}px`;
    scrollEl.appendChild(d);
    scrollObs.observe(d);
  }
  requestAnimationFrame(() => scrollEl.children[S.page - 1]?.scrollIntoView({ block: "start" }));
}

/* ---------- Synchronisation ---------- */
function syncControls() {
  pageInput.value = S.page;
  range.value = S.page;
  $(".rd-zoom").textContent = `${Math.round(S.zoom * 100)} %`;
  $$(".rd-thumbs .rd-th").forEach((t) => t.classList.toggle("is-current", +t.dataset.n === S.page || (!S.narrow() && S.mode === "book" && spreadOf(S.page).includes(+t.dataset.n))));
  try { localStorage.setItem(KEY, String(S.page)); } catch { /* */ }
}
async function update(fromTurn) {
  if (S.mode === "book") {
    bookEl.hidden = false; scrollEl.hidden = true;
    if (!fromTurn || S.narrow()) await drawBook();
    else await drawBook();
  } else {
    bookEl.hidden = true; scrollEl.hidden = false;
    drawScroll();
  }
  syncControls();
}
async function go(n) {
  n = Math.max(1, Math.min(S.n, n | 0));
  if (S.mode === "scroll") { S.page = n; scrollEl.children[n - 1]?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); return syncControls(); }
  S.page = n;
  await update();
}

/* ---------- Miniatures ---------- */
let thumbsBuilt = false;
function buildThumbs() {
  if (thumbsBuilt) return;
  thumbsBuilt = true;
  const box = $(".rd-thumbs");
  const obs = new IntersectionObserver((entries) => entries.forEach(async (e) => {
    if (e.isIntersecting && !e.target.querySelector("canvas")) e.target.prepend(copy(await render(+e.target.dataset.n, 110)));
  }), { root: box, rootMargin: "300px" });
  for (let n = 1; n <= S.n; n++) {
    const b = document.createElement("button");
    b.className = "rd-th";
    b.dataset.n = n;
    b.style.setProperty("--h", `${110 * S.ratio}px`);
    b.innerHTML = `<span>${n}</span>`;
    b.addEventListener("click", () => go(n));
    box.appendChild(b);
    obs.observe(b);
  }
  syncControls();
}

/* ---------- Recherche plein texte ---------- */
const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let texts = null, hits = [], hitIdx = -1;
async function loadTexts(info) {
  if (texts) return texts;
  texts = [];
  for (let n = 1; n <= S.n; n++) {
    const tc = await (await S.pdf.getPage(n)).getTextContent();
    texts.push(norm(tc.items.map((i) => i.str).join(" ")));
    if (n % 10 === 0) info.textContent = `Indexation… ${Math.round((n / S.n) * 100)} %`;
  }
  return texts;
}
async function search(q) {
  const info = $(".rd-search__info");
  q = norm(q.trim());
  if (q.length < 2) { info.textContent = ""; hits = []; return; }
  await loadTexts(info);
  hits = [];
  texts.forEach((t, i) => { let k = t.indexOf(q); let c = 0; while (k >= 0) { c++; k = t.indexOf(q, k + q.length); } if (c) hits.push({ n: i + 1, c }); });
  const total = hits.reduce((s, h) => s + h.c, 0);
  info.textContent = hits.length ? `${total} occurrence(s) sur ${hits.length} page(s)` : "Aucun résultat";
  hitIdx = -1;
  if (hits.length) nextHit(1);
}
function nextHit(d) {
  if (!hits.length) return;
  hitIdx = (hitIdx + d + hits.length) % hits.length;
  go(hits[hitIdx].n);
  $(".rd-search__info").textContent = `Page ${hits[hitIdx].n} — résultat ${hitIdx + 1} / ${hits.length} pages`;
}

/* ---------- Commandes ---------- */
document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "next") turn(1);
  if (act === "prev") turn(-1);
  if (act === "zoomin") { S.zoom = Math.min(3, +(S.zoom + 0.25).toFixed(2)); update(); }
  if (act === "zoomout") { S.zoom = Math.max(0.5, +(S.zoom - 0.25).toFixed(2)); update(); }
  if (act === "mode") { S.mode = S.mode === "book" ? "scroll" : "book"; document.body.classList.toggle("is-scroll", S.mode === "scroll"); update(); }
  if (act === "full") (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
  if (act === "thumbs") { const t = $(".rd-thumbs"); t.hidden = !t.hidden; document.body.classList.toggle("has-thumbs", !t.hidden); buildThumbs(); setTimeout(update, 50); }
  if (act === "search") { const f = $(".rd-search"); f.hidden = !f.hidden; if (!f.hidden) $("input", f).focus(); }
  if (act === "nexthit") nextHit(1);
  if (act === "prevhit") nextHit(-1);
});
$(".rd-search").addEventListener("submit", (e) => { e.preventDefault(); hits.length && norm($(".rd-search input").value) ? nextHit(1) : search($(".rd-search input").value); });
let st;
$(".rd-search input").addEventListener("input", (e) => { clearTimeout(st); st = setTimeout(() => search(e.target.value), 450); });
pageInput.addEventListener("change", () => go(+pageInput.value));
range.addEventListener("input", () => { pageInput.value = range.value; });
range.addEventListener("change", () => go(+range.value));
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input")) return;
  if (["ArrowRight", "PageDown", " "].includes(e.key) && S.mode === "book") { e.preventDefault(); turn(1); }
  if (["ArrowLeft", "PageUp"].includes(e.key) && S.mode === "book") { e.preventDefault(); turn(-1); }
  if (e.key === "Home") go(1);
  if (e.key === "End") go(S.n);
  if (e.key === "+" || e.key === "=") $('[data-act="zoomin"]').click();
  if (e.key === "-") $('[data-act="zoomout"]').click();
  if (e.key === "f") $('[data-act="full"]').click();
  if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); $('[data-act="search"]').click(); }
});
// balayage tactile
let tx = null;
stage.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; }, { passive: true });
stage.addEventListener("touchend", (e) => {
  if (tx == null || S.mode !== "book" || S.zoom > 1) return;
  const dx = e.changedTouches[0].clientX - tx;
  if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1);
  tx = null;
});
// clic sur le bord d'une page = tourner
bookEl.addEventListener("click", (e) => {
  if (S.zoom > 1) return;
  const r = bookEl.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  if (x > 0.6) turn(1); else if (x < 0.4) turn(-1);
});
let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { cache.clear(); update(); }, 200); });

/* ---------- Ouverture ---------- */
(async () => {
  const loading = $(".rd-loading");
  try {
    const task = pdfjsLib.getDocument({ url: document.body.dataset.src, cMapUrl: "/vendor/pdfjs-cmaps/", cMapPacked: true, withCredentials: true });
    task.onProgress = ({ loaded, total }) => { if (total) $("span", loading).textContent = `Ouverture du document… ${Math.round((loaded / total) * 100)} %`; };
    S.pdf = await task.promise;
    S.n = S.pdf.numPages;
    const p1 = (await S.pdf.getPage(1)).getViewport({ scale: 1 });
    S.ratio = p1.height / p1.width;
    $(".rd-total").textContent = S.n;
    pageInput.max = range.max = S.n;
    let saved = 1;
    try { saved = +localStorage.getItem(KEY) || 1; } catch { /* */ }
    S.page = Math.min(S.n, saved);
    if (S.narrow()) S.mode = "book";
    await update();
    loading.classList.add("is-done");
    setTimeout(() => loading.remove(), 600);
    bookEl.animate([{ opacity: 0, transform: "translateY(30px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 900, easing: "cubic-bezier(.16,1,.3,1)" });
  } catch (err) {
    console.error(err);
    $("span", loading).textContent = "Impossible d'ouvrir ce document.";
    loading.classList.add("is-error");
  }
})();
