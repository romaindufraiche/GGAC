/* Administration G.G.A.C. — interactions */
(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const csrf = $('meta[name="csrf"]')?.content || "";

  /* Menu mobile */
  $(".adm-burger")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));

  /* Fenêtre de confirmation (remplace confirm()) */
  const modal = $(".modal");
  function ask(text) {
    return new Promise((resolve) => {
      if (!modal) return resolve(window.confirm(text));
      $(".modal__text", modal).textContent = text;
      modal.hidden = false;
      const ok = $("[data-ok]", modal), cancel = $("[data-cancel]", modal);
      ok.focus();
      const done = (v) => { modal.hidden = true; ok.onclick = cancel.onclick = modal.onclick = null; document.removeEventListener("keydown", esc); resolve(v); };
      const esc = (e) => { if (e.key === "Escape") done(false); };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      modal.onclick = (e) => { if (e.target === modal) done(false); };
      document.addEventListener("keydown", esc);
    });
  }
  window.ggacAsk = ask;

  // formulaires entiers
  $$("form[data-confirm]").forEach((f) =>
    f.addEventListener("submit", async (e) => {
      if (f.dataset.confirmed) return;
      e.preventDefault();
      if (await ask(f.dataset.confirm)) { f.dataset.confirmed = "1"; f.submit(); }
    })
  );
  // boutons avec formaction (dans un formulaire plus large)
  $$("button[data-confirm]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      if (b.dataset.confirmed) return;
      e.preventDefault();
      if (await ask(b.dataset.confirm)) {
        b.dataset.confirmed = "1";
        if (window.tinymce) window.tinymce.triggerSave();
        b.form.noValidate = true;
        b.click();
      }
    })
  );

  /* Compteurs animés du tableau de bord */
  $$(".stat b[data-count]").forEach((el) => {
    const raw = el.textContent.replace(/\s| /g, "");
    const target = parseInt(raw, 10);
    if (!target || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    const fmt = new Intl.NumberFormat("fr-FR");
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 1200);
      el.textContent = fmt.format(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  /* Permanences : sélection */
  $$(".perm-form").forEach((form) => {
    const btn = $("[data-needs-selection]", form);
    const sync = () => { if (btn) btn.disabled = !$$("input[name=ids]:checked", form).length; };
    form.addEventListener("change", sync);
    sync();
    $("[data-select-all]", form)?.addEventListener("click", () => {
      const boxes = $$("input[name=ids]", form);
      const all = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !all));
      sync();
    });
  });

  /* Générateur de permanences : aperçu en direct */
  const gen = $("#gen");
  if (gen) {
    const out = $(".gen-preview", gen);
    let timer;
    const preview = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const fd = new FormData(gen);
        const body = {};
        for (const [k, v] of fd) body[k] = k in body ? [].concat(body[k], v) : v;
        if (!body.to) { out.textContent = "Choisissez une date de fin pour voir l'aperçu."; return; }
        const r = await fetch("/admin/agenda/permanences/apercu", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
        const { dates } = await r.json();
        const f = (d) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
        out.textContent = dates.length ? `${dates.length} permanence(s) : ${dates.slice(0, 6).map(f).join(", ")}${dates.length > 6 ? "…" : ""}` : "Aucune date ne correspond.";
      }, 250);
    };
    gen.addEventListener("input", preview);
    gen.addEventListener("change", preview);
    preview();
  }

  /* Filtre des pages */
  const filter = $("[data-filter]");
  if (filter) {
    const rows = $$(filter.dataset.filter);
    let section = "";
    const apply = () => {
      const q = filter.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      rows.forEach((r) => {
        const t = r.dataset.text.normalize("NFD").replace(/[̀-ͯ]/g, "");
        r.hidden = !(t.includes(q) && (!section || r.dataset.section === section));
      });
    };
    filter.addEventListener("input", apply);
    $$(".chips--filter .chip").forEach((c) =>
      c.addEventListener("click", () => {
        $$(".chips--filter .chip").forEach((x) => x.classList.toggle("is-on", x === c));
        section = c.dataset.section;
        apply();
      })
    );
  }

  /* Copier un lien / choisir un média (fenêtre de sélection) */
  $$("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const url = location.origin + b.dataset.copy;
      try { await navigator.clipboard.writeText(url); } catch { prompt("Lien :", url); return; }
      const old = b.textContent;
      b.textContent = "Copié ✓";
      setTimeout(() => (b.textContent = old), 1500);
    })
  );
  $$("[data-pick]").forEach((b) => b.addEventListener("click", () => window.parent.postMessage({ ggacPick: b.dataset.pick }, location.origin)));

  function pickMedia() {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal modal--frame";
      wrap.innerHTML = '<div class="modal__box"><iframe src="/admin/medias?picker=1" title="Médiathèque"></iframe></div>';
      document.body.appendChild(wrap);
      const close = (v) => { wrap.remove(); window.removeEventListener("message", onMsg); resolve(v); };
      const onMsg = (e) => { if (e.origin === location.origin && e.data?.ggacPick) close(e.data.ggacPick); };
      window.addEventListener("message", onMsg);
      wrap.addEventListener("click", (e) => { if (e.target === wrap) close(null); });
    });
  }
  window.ggacPickMedia = pickMedia;

  /* Zones de dépôt (affiche d'une manifestation, médiathèque) */
  $$("[data-dropzone]").forEach((zone) => {
    const input = $("input[type=file]", zone);
    const preview = $(".dropzone__preview", zone);
    const hint = $(".dropzone__hint", zone);
    ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, () => zone.classList.remove("is-over")));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event("change")); }
    });
    input.addEventListener("change", async () => {
      const f = input.files[0];
      if (!f) return;
      if (preview && f.type.startsWith("image/")) {
        preview.src = URL.createObjectURL(f);
        preview.hidden = false;
        if (hint) hint.hidden = true;
        $("[data-remove-image]")?.removeAttribute("hidden");
      }
      if (zone.hasAttribute("data-autosubmit")) {
        zone.classList.add("is-busy");
        const fd = new FormData(zone);
        const r = await fetch(zone.action, { method: "POST", body: fd, headers: { accept: "application/json" } });
        if (r.ok) location.href = location.pathname + "?ok=uploaded" + (location.search.includes("picker") ? "&picker=1" : "");
        else { zone.classList.remove("is-busy"); alert("Envoi impossible (format ou taille non acceptés)."); }
      }
    });
  });

  /* Formulaire de manifestation */
  const imgField = $('input[name="image"]');
  $("[data-pick-media]")?.addEventListener("click", async () => {
    const url = await pickMedia();
    if (!url) return;
    imgField.value = url;
    const prev = $(".dropzone__preview");
    prev.src = url; prev.hidden = false;
    $(".dropzone__hint").hidden = true;
    $('input[name="image_file"]').value = "";
    $("[data-remove-image]").hidden = false;
  });
  $("[data-remove-image]")?.addEventListener("click", (e) => {
    imgField.value = "";
    $('input[name="image_file"]').value = "";
    const prev = $(".dropzone__preview");
    prev.hidden = true; prev.removeAttribute("src");
    $(".dropzone__hint").hidden = false;
    e.currentTarget.hidden = true;
  });
  const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  $("[data-gen-subtitle]")?.addEventListener("click", () => {
    const s = $('input[name="start_date"]').value, e = $('input[name="end_date"]').value || s;
    if (!s) { $('input[name="start_date"]').focus(); return; }
    const a = new Date(s + "T12:00:00"), b = new Date(e + "T12:00:00");
    const fmt = (d, withMonth, withYear) => `${JOURS[d.getDay()]} ${d.getDate()}${withMonth ? " " + MOIS[d.getMonth()] : ""}${withYear ? " " + d.getFullYear() : ""}`;
    let label;
    if (s === e) label = `Le ${fmt(a, true, true)}`;
    else label = `Du ${fmt(a, a.getMonth() !== b.getMonth() || a.getFullYear() !== b.getFullYear(), a.getFullYear() !== b.getFullYear())} au ${fmt(b, true, true)}`;
    const field = $('input[name="subtitle"]');
    const rest = field.value.replace(/^(Du|Le)\s.*?\d{4}/, "");
    field.value = label + (rest || " - ");
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });

  /* Nouvelle page : adresse automatique */
  const src = $("[data-slug-source]"), dst = $("[data-slug-target]");
  if (src && dst) {
    let touched = false;
    dst.addEventListener("input", () => (touched = true));
    src.addEventListener("input", () => {
      if (touched) return;
      dst.value = src.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    });
  }

  /* Menu latéral d'une page : liste éditable et réordonnable */
  const sideEd = $("[data-side-editor]");
  if (sideEd) {
    const hidden = $('input[name="side_items"]', sideEd);
    const list = $(".side-list", sideEd);
    let items = JSON.parse(hidden.value || "[]");
    const save = () => (hidden.value = JSON.stringify(items));
    const draw = () => {
      list.innerHTML = "";
      items.forEach((it, i) => {
        const li = document.createElement("li");
        li.className = "side-item" + (it.level ? " lvl1" : "");
        li.draggable = true;
        li.innerHTML = `<span class="handle" title="Déplacer">⋮⋮</span>
          <input type="text" data-k="label" placeholder="Libellé">
          <input type="text" data-k="href" placeholder="Lien (ex. page-3.html)">
          <span class="row-actions">
            <button type="button" class="icon-btn" data-act="indent" title="${it.level ? "Remonter d'un niveau" : "Décaler (sous-élément)"}">${it.level ? "⇤" : "⇥"}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-act="del" title="Supprimer">✕</button>
          </span>`;
        $('[data-k="label"]', li).value = it.label || "";
        $('[data-k="href"]', li).value = it.href || "";
        li.addEventListener("input", (e) => { items[i][e.target.dataset.k] = e.target.value; save(); });
        li.addEventListener("click", (e) => {
          const act = e.target.closest("[data-act]")?.dataset.act;
          if (act === "del") { items.splice(i, 1); save(); draw(); }
          if (act === "indent") { items[i].level = items[i].level ? 0 : 1; save(); draw(); }
        });
        dragSort(li, i, (from, to) => { const [m] = items.splice(from, 1); items.splice(to, 0, m); save(); draw(); });
        list.appendChild(li);
      });
    };
    $("[data-add-item]", sideEd).addEventListener("click", () => { items.push({ label: "", href: "", level: 0 }); save(); draw(); $$(".side-item input", list).at(-2)?.focus(); });
    draw();
  }

  let dragFrom = null;
  function dragSort(el, index, move) {
    el.addEventListener("dragstart", (e) => { dragFrom = index; el.classList.add("is-dragging"); e.dataTransfer.effectAllowed = "move"; });
    el.addEventListener("dragend", () => { el.classList.remove("is-dragging"); $$(".drop-before").forEach((x) => x.classList.remove("drop-before")); });
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop-before"); });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before"));
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("drop-before"); if (dragFrom !== null && dragFrom !== index) move(dragFrom, dragFrom < index ? index - 1 : index); dragFrom = null; });
  }
  window.ggacDragSort = dragSort;
})();
