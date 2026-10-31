/* G.G.A.C. — Agenda : motion design (vanilla JS, aucune dépendance) */
(() => {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const ease = "cubic-bezier(.16,1,.3,1)";

  /* ---------- Rinceaux : on instancie le motif pour pouvoir l'animer ---------- */
  const vineTpl = $("#vine");
  $$(".vine").forEach((svg) => {
    const use = $("use", svg);
    if (!use || !vineTpl) return;
    const g = vineTpl.cloneNode(true);
    g.removeAttribute("id");
    use.replaceWith(g);
    $$(".vine__stem", g).forEach((p) => p.style.setProperty("--len", Math.ceil(p.getTotalLength())));
    $$(".leaf", g).forEach((l, i) => l.style.setProperty("--i", i));
  });

  /* ---------- Titre : découpe en lettres ---------- */
  $$("[data-split]").forEach((el) => {
    const txt = el.textContent;
    el.setAttribute("aria-label", txt);
    el.innerHTML = [...txt].map((c, i) => `<span class="ch" aria-hidden="true" style="--i:${i}">${c}</span>`).join("");
  });

  /* ---------- Intro puis entrée de l'en-tête ---------- */
  const intro = $(".intro");
  document.body.classList.add("is-loading");

  function heroIn() {
    $$(".vine--hero").forEach((v) => v.classList.add("is-drawn"));
    if (reduce) return;
    $$(".brand__name .line").forEach((line, i) => {
      line.animate(
        [{ transform: "translateY(110%)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 1100, delay: 150 + i * 130, easing: ease, fill: "both" }
      );
    });
    $$(".brand__name b").forEach((b, i) => {
      b.animate(
        [
          { transform: "scale(1)", textShadow: "0 0 0 rgba(233,198,74,0)" },
          { transform: "scale(1.25) rotate(-4deg)", textShadow: "0 0 18px rgba(233,198,74,.9)" },
          { transform: "scale(1)", textShadow: "0 0 0 rgba(233,198,74,0)" },
        ],
        { duration: 900, delay: 900 + i * 160, easing: "ease-in-out" }
      );
    });
    $(".brand__shields")?.animate(
      [{ transform: "translateY(-30px) rotate(-8deg)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 1200, easing: "cubic-bezier(.3,1.4,.5,1)", fill: "both" }
    );
    $$(".frame").forEach((f, i) => {
      f.animate(
        [{ transform: "translateY(60px) scale(.9)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 1300, delay: 350 + i * 180, easing: ease, fill: "backwards" }
      );
    });
  }

  function start() {
    if (intro) intro.classList.add("is-done");
    document.body.classList.remove("is-loading");
    heroIn();
    setTimeout(() => intro && intro.remove(), 1400);
    setTimeout(showCookies, 2200);
  }
  if (reduce) start();
  else window.addEventListener("load", () => setTimeout(start, 650));
  // filet de sécurité si une ressource tarde
  setTimeout(() => document.body.classList.contains("is-loading") && start(), 3500);

  /* ---------- Compteur de visiteurs ---------- */
  function countUp(el) {
    const target = +el.dataset.count;
    if (reduce || !target) return;
    const fmt = new Intl.NumberFormat("fr-FR");
    const t0 = performance.now(), dur = 2200;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt.format(Math.round(target * e)).replace(/ | /g, " ");
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  $$(".counter[data-count]").forEach((el) => setTimeout(() => countUp(el), 900));

  /* ---------- Révélations au défilement ---------- */
  $$(".prose .reveal").forEach((el, i) => el.style.setProperty("--d", `${i * 0.08}s`));
  $$(".stamp").forEach((s, i) => {
    s.style.setProperty("--i", i % 7);
    s.style.setProperty("--rot", `${(Math.random() * 6 - 3).toFixed(1)}deg`);
    s.style.setProperty("--bx", `${20 + Math.random() * 60}%`);
    s.style.setProperty("--by", `${20 + Math.random() * 60}%`);
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        if (e.target.classList.contains("vine")) e.target.classList.add("is-drawn");
        io.unobserve(e.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
  );
  $$(".reveal, .block__title, .stamp, .event, .title, .vine--content").forEach((el) => io.observe(el));

  /* ---------- Barre de progression + nav collante + parallaxe ---------- */
  const bar = $(".progress span");
  const nav = $(".nav");
  const frames = $$(".frame[data-depth]");
  let mx = 0, my = 0;

  function onScroll() {
    const h = document.documentElement;
    const p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
    if (bar) bar.style.transform = `scaleX(${p})`;
    nav?.classList.toggle("is-stuck", nav.getBoundingClientRect().top <= 0 && h.scrollTop > 10);
    updateBranch();
    parallax();
  }
  function parallax() {
    if (reduce) return;
    const y = window.scrollY;
    frames.forEach((f) => {
      const d = +f.dataset.depth;
      f.style.transform = `translate3d(${mx * 18 * d}px, ${y * -0.25 * d + my * 12 * d}px, 0)`;
    });
  }
  window.addEventListener("scroll", () => requestAnimationFrame(onScroll), { passive: true });
  window.addEventListener("resize", () => { buildBranch(); onScroll(); });
  $(".hero")?.addEventListener("pointermove", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx = (e.clientX - r.left) / r.width - 0.5;
    my = (e.clientY - r.top) / r.height - 0.5;
    requestAnimationFrame(parallax);
  });

  /* ---------- Frise des manifestations : une branche qui pousse ---------- */
  const timeline = $(".timeline");
  const branchSvg = $(".timeline__branch");
  const branch = $(".timeline__path");
  let branchLen = 0;

  function buildBranch() {
    if (!timeline || !branch) return;
    const tr = timeline.getBoundingClientRect();
    const nodes = $$(".event__node", timeline).map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left - tr.left + r.width / 2, y: r.top - tr.top + r.height / 2 };
    });
    if (!nodes.length) return;
    const x = nodes[0].x;
    const H = tr.height;
    branchSvg.setAttribute("viewBox", `0 0 ${branchSvg.clientWidth} ${H}`);
    // tige ondulante qui serpente entre les nœuds
    let d = `M ${x} 0`;
    let prevY = 0;
    [...nodes.map((n) => n.y), H].forEach((y, i) => {
      const mid = (prevY + y) / 2;
      const sway = (i % 2 ? 1 : -1) * Math.min(14, (y - prevY) / 8);
      d += ` Q ${x + sway} ${mid} ${x} ${y}`;
      prevY = y;
    });
    branch.setAttribute("d", d);
    branchLen = branch.getTotalLength();
    branch.style.strokeDasharray = branchLen;
    // petites brindilles avec feuille à chaque nœud
    $$(".timeline__twig, .timeline__leaf", branchSvg).forEach((t) => t.remove());
    nodes.forEach((n, i) => {
      const dir = i % 2 ? 1 : -1;
      const tw = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const y0 = n.y + 34;
      tw.setAttribute("d", `M ${x} ${y0} q ${dir * 10} 6 ${dir * 16} 18`);
      tw.setAttribute("class", "timeline__twig");
      const leaf = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const lx = x + dir * 16, ly = y0 + 18;
      leaf.setAttribute("d", `M ${lx} ${ly} c ${dir * 8} -2 ${dir * 12} 4 ${dir * 12} 10 c ${dir * -7} 1 ${dir * -12} -4 ${dir * -12} -10 z`);
      leaf.setAttribute("class", "timeline__leaf");
      leaf.setAttribute("fill", "#9bb26a");
      tw.dataset.at = leaf.dataset.at = ly;
      branchSvg.append(tw, leaf);
    });
  }

  function updateBranch() {
    if (!timeline || !branchLen) return;
    const r = timeline.getBoundingClientRect();
    const vh = window.innerHeight;
    const grown = reduce ? r.height : Math.max(0, Math.min(r.height, vh * 0.75 - r.top));
    const p = grown / r.height;
    branch.style.strokeDashoffset = branchLen * (1 - p);
    $$("[data-at]", branchSvg).forEach((el) => {
      const on = +el.dataset.at <= grown;
      el.style.transition = "opacity .6s, transform .8s cubic-bezier(.3,1.6,.5,1)";
      el.style.transformBox = "fill-box";
      el.style.transformOrigin = "center";
      el.style.opacity = on ? 1 : 0;
      el.style.transform = on ? "none" : "scale(0)";
    });
  }
  // les images peuvent changer la hauteur : on reconstruit après chargement
  window.addEventListener("load", () => { buildBranch(); updateBranch(); });
  buildBranch();
  onScroll();
  if ("ResizeObserver" in window && timeline) new ResizeObserver(() => { buildBranch(); updateBranch(); }).observe(timeline);

  /* ---------- Navigation ---------- */
  const menu = $("#menu");
  const ink = $(".menu__ink");
  const burger = $(".nav__burger");
  const desktop = () => window.matchMedia("(min-width: 901px)").matches;

  $$(".sub__col > li").forEach((li, i) => li.style.setProperty("--i", i));

  function moveInk(el) {
    if (!ink || !el || !desktop()) return;
    const pr = ink.parentElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    ink.style.opacity = 1;
    ink.style.width = `${r.width - 28}px`;
    ink.style.transform = `translateX(${r.left - pr.left + 14}px)`;
  }
  const activeTop = $(".menu .is-active > .menu__top");
  const restInk = () => moveInk(activeTop);
  setTimeout(restInk, 1200);

  $$(".menu > li").forEach((li) => {
    const top = $(".menu__top", li);
    li.addEventListener("pointerenter", () => {
      if (!desktop()) return;
      if (!li.classList.contains("menu__member")) moveInk(top);
      if (li.classList.contains("has-sub")) openSub(li, true);
    });
    li.addEventListener("pointerleave", () => {
      if (!desktop()) return;
      restInk();
      if (li.classList.contains("has-sub")) openSub(li, false);
    });
  });
  function openSub(li, open) {
    $$(".has-sub.is-open", menu).forEach((o) => { if (o !== li) { o.classList.remove("is-open"); $("button", o).setAttribute("aria-expanded", "false"); } });
    li.classList.toggle("is-open", open);
    $("button", li)?.setAttribute("aria-expanded", String(open));
  }
  $$(".has-sub > button", menu).forEach((btn) =>
    btn.addEventListener("click", () => openSub(btn.parentElement, !btn.parentElement.classList.contains("is-open")))
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    $$(".has-sub.is-open").forEach((li) => openSub(li, false));
    closeLightbox();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".has-sub")) $$(".has-sub.is-open").forEach((li) => openSub(li, false));
  });
  burger?.addEventListener("click", () => {
    const open = burger.getAttribute("aria-expanded") !== "true";
    burger.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("is-open", open);
  });

  /* ---------- Actualités : défilement continu (comme l'original) ---------- */
  const news = $(".news");
  const track = $(".news__track");
  if (news && track && !reduce) {
    const clone = track.cloneNode(true);
    $$("a", clone).forEach((a) => a.setAttribute("tabindex", "-1"));
    clone.setAttribute("aria-hidden", "true");
    [...clone.children].forEach((c) => track.appendChild(c));
    let y = 0, paused = false, last = performance.now();
    const half = () => track.scrollHeight / 2;
    news.addEventListener("pointerenter", () => (paused = true));
    news.addEventListener("pointerleave", () => (paused = false));
    news.addEventListener("focusin", () => (paused = true));
    news.addEventListener("focusout", () => (paused = false));
    const loop = (t) => {
      const dt = Math.min(64, t - last);
      last = t;
      if (!paused && !document.hidden) {
        y += dt * 0.022;
        if (y >= half()) y -= half();
        track.style.transform = `translateY(${-y}px)`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---------- Recherche (même règle que le site) ---------- */
  const form = $(".search");
  form?.addEventListener("submit", (e) => {
    const input = $("#requete", form);
    if (input.value.trim().length > 3) return;
    e.preventDefault();
    input.classList.remove("is-shake");
    void input.offsetWidth;
    input.classList.add("is-shake");
    alert("Votre recherche doit comporter au moins quatre caractères.");
  });

  /* ---------- Cookies ---------- */
  const cookies = $(".cookies");
  function showCookies() {
    if (!cookies) return;
    try { if (localStorage.getItem("ggac-cookies")) return; } catch (_) { /* stockage indisponible */ }
    cookies.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => cookies.classList.add("is-in")));
  }
  $(".cookies__ok")?.addEventListener("click", () => {
    try { localStorage.setItem("ggac-cookies", "1"); } catch (_) { /* rien */ }
    cookies.classList.remove("is-in");
    setTimeout(() => (cookies.hidden = true), 900);
  });

  /* ---------- Visionneuse : zoom depuis la vignette (FLIP) ---------- */
  const lb = $(".lightbox");
  const lbImg = $(".lightbox__fig img");
  const lbCap = $(".lightbox__fig figcaption");
  let origin = null;

  function flip(fromEl, toEl, reverse) {
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const frames = [
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` },
      { transform: "none" },
    ];
    return toEl.animate(reverse ? frames.reverse() : frames, { duration: reverse ? 450 : 650, easing: ease, fill: "both" });
  }

  $$(".event__poster").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      origin = $("img", a);
      lbImg.src = a.href;
      lbCap.textContent = a.title;
      lb.classList.add("is-open");
      lb.setAttribute("aria-hidden", "false");
      origin.style.visibility = "hidden";
      const go = () => { if (!reduce) flip(origin, lbImg, false); $(".lightbox__close").focus(); };
      lbImg.complete ? go() : lbImg.addEventListener("load", go, { once: true });
    })
  );
  function closeLightbox() {
    if (!lb.classList.contains("is-open")) return;
    lb.classList.remove("is-open");
    lb.setAttribute("aria-hidden", "true");
    const done = () => { if (origin) origin.style.visibility = ""; lbImg.getAnimations().forEach((an) => an.cancel()); };
    if (reduce || !origin) return done();
    flip(origin, lbImg, true).finished.then(done);
  }
  lb?.addEventListener("click", (e) => { if (e.target !== lbImg) closeLightbox(); });

  /* ---------- Poussière d'archives (particules sépia) ---------- */
  const cv = $(".dust");
  if (cv && !reduce) {
    const ctx = cv.getContext("2d");
    let W, H, dpr;
    const motes = Array.from({ length: 46 }, () => ({}));
    const seed = (m, anywhere) => {
      m.x = Math.random() * W;
      m.y = anywhere ? Math.random() * H : H + 10;
      m.r = 0.6 + Math.random() * 1.8;
      m.vy = 0.08 + Math.random() * 0.22;
      m.ph = Math.random() * Math.PI * 2;
      m.a = 0.15 + Math.random() * 0.35;
    };
    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.width = innerWidth * dpr;
      H = cv.height = innerHeight * dpr;
    };
    size();
    motes.forEach((m) => seed(m, true));
    addEventListener("resize", size);
    const draw = (t) => {
      if (!document.hidden) {
        ctx.clearRect(0, 0, W, H);
        motes.forEach((m) => {
          m.y -= m.vy * dpr;
          m.x += Math.sin(t / 2400 + m.ph) * 0.25 * dpr;
          if (m.y < -10) seed(m, false);
          ctx.beginPath();
          ctx.fillStyle = `rgba(122,92,62,${m.a})`;
          ctx.arc(m.x, m.y, m.r * dpr, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }
})();
