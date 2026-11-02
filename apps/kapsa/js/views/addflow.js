// Adding and editing cards: camera scan step, then the details form.

import { FORMAT_ORDER, FORMATS, fromDetectorFormat, guessFormat } from "../barcode.js";
import { CATEGORIES, SWATCHES, findBrand, suggestBrands } from "../brands.js";
import { cardFace, codePanel } from "../cardview.js";
import { buzz, h, mount, toast } from "../dom.js";
import { formatDistance } from "../geo.js";
import { locale, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { invalidateBranches, startLocation } from "../location.js";
import { back, replace } from "../nav.js";
import { fetchHere } from "../osm.js";
import { CameraScanner, scanImageFile } from "../scanner.js";
import { getCard, saveCard, state } from "../state.js";
import { newId } from "../store.js";

/** Sheet for #add: scan first, then details. */
export function createAddSheet() {
  const host = h("div", { class: "add-flow" });
  let cleanupStep = () => {};
  let updateStep = () => {};

  const showScan = () => {
    cleanupStep();
    updateStep = () => {};
    const step = scanStep({
      onCode: (code, format) => showForm({ code, format }),
      onManual: () => showForm({ code: "", format: "auto" }),
    });
    cleanupStep = step.cleanup;
    mount(host, step.el);
  };

  const showForm = (prefill) => {
    cleanupStep();
    const step = formStep({ mode: "add", prefill, onRescan: showScan });
    cleanupStep = step.cleanup;
    updateStep = step.update;
    mount(host, step.el);
    host.closest("dialog")?.classList.remove("sheet-dark");
  };

  showScan();
  return {
    el: host,
    dark: true,
    update: () => updateStep(),
    cleanup: () => cleanupStep(),
  };
}

/** Sheet for #edit-<id>. */
export function createEditSheet(id) {
  const card = getCard(id);
  if (!card) {
    return null;
  }
  const step = formStep({ mode: "edit", prefill: card, onRescan: null });
  return { el: step.el, update: step.update, cleanup: step.cleanup };
}

function scanStep({ onCode, onManual }) {
  const video = h("video", { class: "scan-video", playsinline: true, muted: true, autoplay: true });
  const msg = h("p", { class: "scan-msg", hidden: true, role: "alert" });
  const hint = h("p", { class: "scan-hint" }, t("scan.starting"));
  const torchBtn = h(
    "button",
    { type: "button", class: "icon-btn on-dark", hidden: true, "aria-label": t("scan.torch"), "aria-pressed": "false" },
    h("span", { html: iconSvg("flashlight") }),
  );
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true, id: "scan-file" });
  let done = false;

  const finish = (raw) => {
    if (done) {
      return;
    }
    done = true;
    buzz([20, 40, 20]);
    scanner.stop();
    onCode(raw.rawValue.trim(), fromDetectorFormat(raw.format));
  };

  const scanner = new CameraScanner(video, finish);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) {
      return;
    }
    hint.textContent = t("scan.reading");
    try {
      const found = await scanImageFile(file);
      if (found) {
        finish(found);
        return;
      }
    } catch {
      // Fall through to the message below.
    }
    hint.textContent = t("scan.hint");
    msg.hidden = false;
    msg.textContent = t("scan.photoNone");
  });

  torchBtn.addEventListener("click", async () => {
    const on = await scanner.toggleTorch();
    torchBtn.setAttribute("aria-pressed", String(on));
    torchBtn.classList.toggle("is-on", on);
  });

  scanner.start().then((result) => {
    if (done) {
      scanner.stop();
      return;
    }
    if (result === "ok") {
      hint.textContent = t("scan.hint");
      torchBtn.hidden = !scanner.hasTorch();
    } else {
      hint.textContent = "";
      msg.hidden = false;
      msg.textContent = result === "denied" ? t("scan.cameraDenied") : t("scan.noCamera");
      el.classList.add("no-camera");
    }
  });

  const el = h(
    "div",
    { class: "scan" },
    h(
      "div",
      { class: "scan-view" },
      video,
      h("div", { class: "scan-shade", "aria-hidden": "true" }),
      h("div", { class: "scan-frame", "aria-hidden": "true" }, h("span", { class: "scan-laser" })),
      h(
        "div",
        { class: "sheet-bar on-dark" },
        h("button", { type: "button", class: "icon-btn on-dark", onclick: () => back(), "aria-label": t("card.close") }, h("span", { html: iconSvg("x") })),
        h("h2", { class: "sheet-title" }, t("scan.title")),
        torchBtn,
      ),
      h("div", { class: "scan-copy" }, hint, msg),
    ),
    h(
      "div",
      { class: "scan-actions" },
      h(
        "button",
        { type: "button", class: "btn-dark", onclick: () => fileInput.click() },
        h("span", { html: iconSvg("image") }),
        t("scan.fromPhoto"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn-dark",
          onclick: () => {
            done = true;
            scanner.stop();
            onManual();
          },
        },
        h("span", { html: iconSvg("keyboard") }),
        t("scan.manual"),
      ),
    ),
    fileInput,
  );

  return { el, cleanup: () => scanner.stop() };
}

/**
 * Details form for a new or existing card.
 * @param {{ mode: "add" | "edit", prefill: Partial<import("../state.js").Card>, onRescan: (() => void) | null }} opts
 */
function formStep({ mode, prefill, onRescan }) {
  const brandFromScan = prefill.name ? findBrand(prefill.name) : null;
  const draft = {
    name: prefill.name ?? "",
    code: prefill.code ?? "",
    format: prefill.format ?? "auto",
    color: prefill.color ?? brandFromScan?.color ?? "#2B44D6",
    category: prefill.category ?? brandFromScan?.category ?? "other",
    photo: prefill.photo ?? null,
    note: prefill.note ?? "",
    autoBranches: prefill.autoBranches ?? true,
  };
  let colorTouched = mode === "edit";
  let categoryTouched = mode === "edit";
  /** A shop picked from "where you are now": its map position beats the GPS fix. */
  let pickedShop = null;
  const abort = new AbortController();

  const preview = h("div", { class: "form-preview" });
  const codePreview = h("div", { class: "form-code" });
  const nameError = h("p", { class: "field-error", hidden: true, role: "alert" });
  const codeError = h("p", { class: "field-error", hidden: true, role: "alert" });
  const hereChips = h("div", { class: "chips", hidden: true });
  const brandChips = h("div", { class: "chips" });

  const renderPreview = () => {
    const format = draft.format === "auto" ? guessFormat(draft.code) : draft.format;
    mount(preview, cardFace({ ...draft, format, id: "preview", places: [] }, { size: "full" }));
  };
  let codeTimer = 0;
  const renderCode = () => {
    clearTimeout(codeTimer);
    codeTimer = window.setTimeout(() => {
      const format = draft.format === "auto" ? guessFormat(draft.code) : draft.format;
      codePreview.style.setProperty("--c", draft.color);
      mount(codePreview, draft.code ? codePanel({ ...draft, format }) : null);
    }, 180);
  };

  const nameInput = h("input", {
    id: "card-name",
    class: "input",
    type: "text",
    autocomplete: "off",
    autocapitalize: "words",
    enterkeyhint: "next",
    maxlength: 80,
    placeholder: t("form.namePlaceholder"),
  });
  nameInput.value = draft.name;

  const applyBrandLook = (brand) => {
    if (!colorTouched) {
      draft.color = brand.color;
      syncSwatches();
    }
    if (!categoryTouched) {
      draft.category = brand.category;
      syncCategories();
    }
  };

  const renderBrandChips = () => {
    const brands = suggestBrands(draft.name, 5);
    mount(
      brandChips,
      brands.map((b) =>
        h(
          "button",
          {
            type: "button",
            class: "chip",
            style: { "--c": b.color },
            onclick: () => {
              draft.name = b.name;
              nameInput.value = b.name;
              applyBrandLook(b);
              renderBrandChips();
              renderPreview();
            },
          },
          h("span", { class: "chip-dot" }),
          b.name,
        ),
      ),
    );
  };

  nameInput.addEventListener("input", () => {
    draft.name = nameInput.value;
    nameError.hidden = true;
    pickedShop = null;
    const brand = findBrand(draft.name);
    if (brand) {
      applyBrandLook(brand);
    }
    renderBrandChips();
    renderPreview();
  });

  const codeInput = h("input", {
    id: "card-code",
    class: "input mono",
    type: "text",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    inputmode: "text",
    maxlength: 512,
    placeholder: t("form.codePlaceholder"),
  });
  codeInput.value = draft.code;
  codeInput.addEventListener("input", () => {
    draft.code = codeInput.value.trim();
    codeError.hidden = true;
    renderPreview();
    renderCode();
  });

  const formatSelect = h(
    "select",
    { id: "card-format", class: "input select" },
    FORMAT_ORDER.map((key) =>
      h(
        "option",
        { value: key },
        key === "auto" ? t("form.formatAuto") : key === "none" ? t("form.formatNone") : FORMATS[key].label,
      ),
    ),
  );
  formatSelect.value = draft.format;
  formatSelect.addEventListener("change", () => {
    draft.format = formatSelect.value;
    codeError.hidden = true;
    renderPreview();
    renderCode();
  });

  const categoryGroup = h("div", { class: "cat-grid", role: "radiogroup", "aria-label": t("form.category") });
  const syncCategories = () => {
    for (const btn of categoryGroup.children) {
      btn.setAttribute("aria-checked", String(btn.dataset.value === draft.category));
    }
  };
  for (const c of CATEGORIES) {
    categoryGroup.append(
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "cat",
          dataset: { value: c.id },
          onclick: () => {
            draft.category = c.id;
            categoryTouched = true;
            syncCategories();
            renderPreview();
          },
        },
        h("span", { html: iconSvg(c.icon) }),
        h("span", null, t(`cat.${c.id}`)),
      ),
    );
  }

  const colorInput = h("input", { type: "color", id: "card-color", class: "swatch-custom", "aria-label": t("form.color") });
  const swatchGroup = h("div", { class: "swatches", role: "radiogroup", "aria-label": t("form.color") });
  const syncSwatches = () => {
    colorInput.value = draft.color.length === 7 ? draft.color : "#2B44D6";
    for (const btn of swatchGroup.querySelectorAll(".swatch")) {
      btn.setAttribute("aria-checked", String(btn.dataset.value?.toLowerCase() === draft.color.toLowerCase()));
    }
  };
  for (const color of SWATCHES) {
    swatchGroup.append(
      h("button", {
        type: "button",
        role: "radio",
        class: "swatch",
        style: { "--c": color },
        dataset: { value: color },
        "aria-label": color,
        onclick: () => {
          draft.color = color;
          colorTouched = true;
          syncSwatches();
          renderPreview();
        },
      }),
    );
  }
  colorInput.addEventListener("input", () => {
    draft.color = colorInput.value.toUpperCase();
    colorTouched = true;
    syncSwatches();
    renderPreview();
  });
  swatchGroup.append(h("label", { class: "swatch swatch-picker", title: t("form.color") }, colorInput, h("span", { html: iconSvg("plus") })));

  const photoInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, id: "card-photo" });
  const photoArea = h("div", { class: "photo-area" });
  const renderPhoto = () => {
    mount(
      photoArea,
      draft.photo
        ? h(
            "div",
            { class: "photo-row" },
            h("img", { src: draft.photo, alt: "", class: "photo-thumb" }),
            h(
              "button",
              {
                type: "button",
                class: "btn-quiet",
                onclick: () => {
                  draft.photo = null;
                  renderPhoto();
                  renderPreview();
                },
              },
              t("form.photoRemove"),
            ),
          )
        : h(
            "button",
            { type: "button", class: "btn-outline", onclick: () => photoInput.click() },
            h("span", { html: iconSvg("camera") }),
            t("form.photoAdd"),
          ),
    );
  };
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    photoInput.value = "";
    if (file) {
      draft.photo = await cardPhoto(file);
      renderPhoto();
      renderPreview();
    }
  });

  // "Save the place I'm at now".
  const saveHere = h("input", { type: "checkbox", id: "save-here", class: "switch-input" });
  saveHere.checked = mode === "add" && Boolean(state.pos);
  const saveHereMeta = h("span", { class: "toggle-meta" });
  const saveHereLabel = h("span", { class: "toggle-label" });
  let hereTouched = false;
  let hereLoaded = false;
  const syncHere = () => {
    if (state.pos && mode === "add" && !hereTouched && !saveHere.checked) {
      saveHere.checked = true;
    }
    if (state.pos && !hereLoaded) {
      loadHere();
    }
    if (state.pos) {
      saveHereLabel.textContent = t("form.saveHere");
      saveHereMeta.textContent = pickedShop
        ? pickedShop.address || pickedShop.name
        : t("form.saveHereAcc", { m: formatDistance(state.pos.accuracy, locale()) });
      saveHere.disabled = false;
    } else {
      saveHereLabel.textContent = t("form.saveHereOff");
      saveHereMeta.textContent = "";
      saveHere.checked = false;
      saveHere.disabled = state.locStatus === "denied";
    }
  };
  saveHere.addEventListener("change", () => {
    hereTouched = true;
    if (saveHere.checked && !state.pos) {
      saveHere.checked = false;
      startLocation();
    }
  });

  const autoBranches = h("input", { type: "checkbox", id: "auto-branches", class: "switch-input" });
  autoBranches.checked = draft.autoBranches;
  autoBranches.addEventListener("change", () => {
    draft.autoBranches = autoBranches.checked;
  });

  const noteInput = h("textarea", { id: "card-note", class: "input textarea", rows: 2, maxlength: 500, placeholder: t("form.notePlaceholder") });
  noteInput.value = draft.note;
  noteInput.addEventListener("input", () => {
    draft.note = noteInput.value;
  });

  // Shops right where the user stands, to fill the name with one tap.
  const loadHere = async () => {
    if (mode !== "add" || !state.pos || !state.settings.osm || !state.online || state.pos.accuracy > 250) {
      return;
    }
    hereLoaded = true;
    hereChips.hidden = false;
    mount(hereChips, h("span", { class: "chips-label" }, t("form.hereNow")), h("span", { class: "muted small" }, t("form.hereLoading")));
    try {
      const shops = (await fetchHere(state.pos, abort.signal)).slice(0, 6);
      if (!shops.length) {
        hereChips.hidden = true;
        return;
      }
      mount(
        hereChips,
        h("span", { class: "chips-label" }, t("form.hereNow")),
        shops.map((shop) =>
          h(
            "button",
            {
              type: "button",
              class: "chip chip-place",
              onclick: () => {
                draft.name = shop.brand || shop.name;
                nameInput.value = draft.name;
                nameError.hidden = true;
                pickedShop = shop;
                const brand = findBrand(draft.name);
                if (brand) {
                  applyBrandLook(brand);
                }
                saveHere.checked = true;
                syncHere();
                renderBrandChips();
                renderPreview();
              },
            },
            h("span", { html: iconSvg("store") }),
            h("span", null, shop.name),
            h("span", { class: "chip-meta" }, formatDistance(shop.distance, locale())),
          ),
        ),
      );
    } catch {
      hereChips.hidden = true;
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const name = draft.name.trim();
    const format = draft.format === "auto" ? guessFormat(draft.code) : draft.format;
    let ok = true;
    if (!name) {
      nameError.textContent = t("form.needName");
      nameError.hidden = false;
      ok = false;
    }
    if (!draft.code && draft.format !== "none") {
      codeError.textContent = t("form.needCode");
      codeError.hidden = false;
      ok = false;
    }
    if (!ok) {
      (name ? codeInput : nameInput).focus();
      return;
    }
    const existing = mode === "edit" ? getCard(prefill.id ?? "") : null;
    const places = [...(existing?.places ?? [])];
    if (saveHere.checked && state.pos) {
      const spot = pickedShop ?? state.pos;
      places.push({
        id: newId(),
        lat: spot.lat,
        lon: spot.lon,
        label: pickedShop ? pickedShop.address || pickedShop.name : "",
        source: pickedShop ? "map" : "here",
        at: Date.now(),
      });
    }
    const card = await saveCard({
      ...(existing ? { id: existing.id } : {}),
      name,
      code: draft.code,
      format,
      color: draft.color,
      category: draft.category,
      photo: draft.photo,
      note: draft.note.trim(),
      autoBranches: draft.autoBranches,
      places,
      sample: existing?.sample && existing.name === name ? existing.sample : undefined,
    });
    buzz();
    toast(t("card.saved"));
    invalidateBranches();
    replace(`#card-${card.id}`);
  };

  const field = (label, forId, ...children) =>
    h("div", { class: "field" }, h("label", { class: "field-label", for: forId }, label), ...children);

  const toggle = (input, labelEl, metaEl) =>
    h("label", { class: "toggle" }, h("span", { class: "toggle-text" }, labelEl, metaEl), input, h("span", { class: "switch", "aria-hidden": "true" }));

  const el = h(
    "form",
    { class: "card-form", novalidate: true, onsubmit: submit },
    h(
      "div",
      { class: "sheet-bar" },
      h("button", { type: "button", class: "icon-btn", onclick: () => back(), "aria-label": t("card.close") }, h("span", { html: iconSvg("x") })),
      h("h2", { class: "sheet-title" }, mode === "add" ? t("form.titleAdd") : t("form.titleEdit")),
      onRescan
        ? h("button", { type: "button", class: "btn-ghost", onclick: onRescan }, h("span", { html: iconSvg("scan-barcode") }), t("form.rescan"))
        : h("span", { class: "bar-spacer" }),
    ),
    preview,
    field(t("form.name"), "card-name", nameInput, nameError, hereChips, brandChips),
    h(
      "div",
      { class: "field" },
      h("label", { class: "field-label", for: "card-code" }, t("form.code")),
      h("div", { class: "code-inputs" }, codeInput, h("label", { class: "visually-hidden", for: "card-format" }, t("form.format")), formatSelect),
      codeError,
      codePreview,
    ),
    h("div", { class: "field" }, h("span", { class: "field-label" }, t("form.category")), categoryGroup),
    h("div", { class: "field" }, h("span", { class: "field-label" }, t("form.color")), swatchGroup),
    h("div", { class: "field" }, h("span", { class: "field-label" }, t("form.photo")), photoArea),
    h(
      "div",
      { class: "field" },
      h("span", { class: "field-label" }, t("form.places")),
      h(
        "div",
        { class: "toggles" },
        toggle(saveHere, saveHereLabel, saveHereMeta),
        toggle(autoBranches, h("span", { class: "toggle-label" }, t("form.autoBranches")), h("span", { class: "toggle-meta" }, t("form.autoBranchesHint"))),
      ),
    ),
    field(t("form.note"), "card-note", noteInput),
    h(
      "div",
      { class: "form-foot" },
      h("button", { type: "submit", class: "btn-primary btn-big" }, h("span", { html: iconSvg("check") }), mode === "add" ? t("form.save") : t("form.saveChanges")),
    ),
  );

  syncSwatches();
  syncCategories();
  syncHere();
  renderBrandChips();
  renderPhoto();
  renderPreview();
  renderCode();
  if (mode === "add" && !draft.code) {
    queueMicrotask(() => codeInput.focus());
  }

  return {
    el,
    update: syncHere,
    cleanup: () => {
      abort.abort();
      clearTimeout(codeTimer);
    },
  };
}

/**
 * Crop a photo to card proportions and shrink it so it stays small in storage.
 * @param {Blob} file
 */
async function cardPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = 1.586;
  let sw = bitmap.width;
  let sh = sw / ratio;
  if (sh > bitmap.height) {
    sh = bitmap.height;
    sw = sh * ratio;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 856;
  canvas.height = 540;
  canvas.getContext("2d").drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, 856, 540);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.8);
}

