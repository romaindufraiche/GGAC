/* Éditeur visuel (TinyMCE) pour les pages et l'agenda */
(() => {
  "use strict";
  const csrf = document.querySelector('meta[name="csrf"]')?.content || "";

  function init(selector, mini) {
    if (!window.tinymce) return;
    window.tinymce.init({
      selector,
      license_key: "gpl",
      language: "fr_FR",
      language_url: "https://cdn.jsdelivr.net/npm/tinymce-i18n@24.10.21/langs7/fr_FR.js",
      height: Number(document.querySelector(selector)?.dataset.height) || 600,
      menubar: mini ? false : "edit view insert format table tools",
      plugins: mini
        ? "autolink link lists code"
        : "advlist autolink link image lists charmap searchreplace visualblocks code fullscreen media table wordcount anchor",
      toolbar: mini
        ? "bold italic superscript | link | bullist | removeformat code"
        : "undo redo | blocks | bold italic underline superscript | forecolor | alignleft aligncenter alignright alignjustify | bullist numlist | link image media table | visualblocks code fullscreen",
      block_formats: "Paragraphe=p; Intertitre=h2; Sous-titre=h3",
      content_css: ["/assets/css/style.css", "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;600&display=swap"],
      content_style: "body{padding:18px 24px;background:#fbf7ef;max-width:none} .reveal{opacity:1!important;transform:none!important;filter:none!important} .collapsible{display:block!important} .collapsible__inner{overflow:visible!important}",
      body_class: "prose",
      valid_elements: "*[*]",
      extended_valid_elements: "*[*]",
      valid_children: "+a[div|span|img|p|h2|h3],+body[style]",
      verify_html: false,
      convert_urls: false,
      entity_encoding: "raw",
      branding: false,
      promotion: false,
      image_caption: false,
      image_advtab: true,
      link_default_target: "_self",
      link_class_list: [
        { title: "Lien normal", value: "" },
        { title: "Agrandir l'image (visionneuse)", value: "zoom" },
      ],
      table_default_attributes: {},
      automatic_uploads: true,
      file_picker_types: "image",
      file_picker_callback: async (cb) => {
        const url = await window.ggacPickMedia?.();
        if (url) cb(url);
      },
      images_upload_handler: (blob) =>
        new Promise((resolve, reject) => {
          const fd = new FormData();
          fd.append("file", blob.blob(), blob.filename());
          fetch("/admin/medias/editeur", { method: "POST", body: fd, headers: { "x-csrf-token": csrf } })
            .then((r) => r.json())
            .then((j) => (j.location ? resolve(j.location) : reject(j.error || "Envoi impossible")))
            .catch(() => reject("Envoi impossible"));
        }),
      setup: (ed) => {
        ed.on("init", () => ed.getContainer().animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: "cubic-bezier(.16,1,.3,1)" }));
        ed.addShortcut("meta+s", "Enregistrer", () => save());
      },
    });
  }

  document.querySelectorAll("textarea.rte").forEach((t, i) => {
    if (!t.id) t.id = `rte-${i}`;
    init(`#${t.id}`, t.hasAttribute("data-mini"));
  });

  // Page très longue : éditeur visuel à la demande
  document.querySelector("[data-enable-rte]")?.addEventListener("click", (e) => {
    const t = document.querySelector("textarea.code");
    t.classList.replace("code", "rte");
    init(`#${t.id}`, false);
    e.currentTarget.remove();
  });

  // Enregistrement : Ctrl/Cmd + S
  const form = document.getElementById("page-form") || document.querySelector("form.editor-layout");
  function save() {
    if (!form) return;
    window.tinymce?.triggerSave();
    const btn = form.querySelector("[data-save]");
    if (btn) btn.click(); else form.requestSubmit();
  }
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  });

  // Avertir en cas de modifications non enregistrées
  let dirty = false;
  form?.addEventListener("input", () => (dirty = true));
  const watch = setInterval(() => {
    if (!window.tinymce) return;
    window.tinymce.get().forEach((ed) => ed.on("dirty change", () => (dirty = true)));
    clearInterval(watch);
  }, 800);
  form?.addEventListener("submit", () => { dirty = false; window.tinymce?.triggerSave(); });
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
})();
