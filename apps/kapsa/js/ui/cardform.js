// Adding (#scan) and editing (#edit-<id>) a card. New cards start with the camera;
// the form keeps the essentials up front and the rest under "More options".

import { FORMAT_ORDER, FORMATS, fromDetectorFormat, guessFormat } from "../barcode.js";
import { CATEGORIES, SWATCHES, categoryIcon, findBrand, suggestBrands } from "../brands.js";
import { confetti } from "../confetti.js";
import { formatDistance } from "../geo.js";
import { locale, t } from "../i18n.js";
import { invalidateBranches, startLocation } from "../location.js";
import { cleanDate, cleanPoints } from "../model.js";
import { replace } from "../nav.js";
import { fetchHere } from "../osm.js";
import { getCard, saveCard, state } from "../state.js";
import { newId } from "../store.js";
import { buzz } from "../util.js";
import { Icon, Page, Seg, Sheet, Toggle, html, tint, toast } from "./kit.js";
import { Scanner } from "./scanner.js";
import { useEffect, useMemo, useState } from "../../vendor/preact.js";

/** #scan: camera first, then the form. */
export function NewCardSheet() {
  const [prefill, setPrefill] = useState(/** @type {any} */ (null));
  if (!prefill) {
    return html`<${Sheet} black title=${t("scan.title")}>
      <${Scanner}
        kind="card"
        onCode=${(raw) => setPrefill({ code: raw.rawValue.trim(), format: fromDetectorFormat(raw.format) })}
        onAi=${(r) =>
          setPrefill({
            name: r.name,
            code: r.code,
            format: r.format,
            color: r.color ?? undefined,
            category: r.category ?? undefined,
            expiry: r.expiry,
            points: r.points,
            note: r.note,
            fromAi: true,
          })}
        onManual=${() => setPrefill({ code: "", format: "auto" })}
      />
    <//>`;
  }
  return html`<${Sheet} tall title=${t("form.titleAdd")}>
    <${CardForm} mode="add" prefill=${prefill} onRescan=${() => setPrefill(null)} />
  <//>`;
}

/** #edit-<id> */
export function EditCardPage({ id }) {
  const card = getCard(id);
  if (!card) {
    return null;
  }
  return html`<${Page} color=${card.color} title=${t("form.titleEdit")} hero=${html`<h1 class="display sm">${t("form.titleEdit")}</h1>`}>
    <div style="padding:20px var(--gx-r) 0 var(--gx)"><${CardForm} mode="edit" prefill=${card} /></div>
  <//>`;
}

/**
 * @param {{ mode: "add" | "edit", prefill: any, onRescan?: () => void }} props
 */
function CardForm({ mode, prefill, onRescan }) {
  const brand0 = prefill.name ? findBrand(prefill.name) : null;
  const [name, setName] = useState(prefill.name ?? "");
  const [code, setCode] = useState(prefill.code ?? "");
  const [format, setFormat] = useState(prefill.format ?? "auto");
  const [color, setColor] = useState(prefill.color ?? brand0?.color ?? "#2F5BFF");
  const [category, setCategory] = useState(prefill.category ?? brand0?.category ?? "other");
  const [colorTouched, setColorTouched] = useState(mode === "edit" || Boolean(prefill.color));
  const [catTouched, setCatTouched] = useState(mode === "edit" || Boolean(prefill.category));
  const [saveHere, setSaveHere] = useState(mode === "add" && Boolean(state.pos));
  const [hereTouched, setHereTouched] = useState(false);
  const [autoBranches, setAutoBranches] = useState(prefill.autoBranches ?? true);
  const [stampsOn, setStampsOn] = useState(Boolean(prefill.stamps));
  const [goal, setGoal] = useState(prefill.stamps?.goal ?? 10);
  const [reward, setReward] = useState(prefill.stamps?.reward ?? "");
  const [points, setPoints] = useState(prefill.points === null || prefill.points === undefined ? "" : String(prefill.points));
  const [pointsGoal, setPointsGoal] = useState(prefill.pointsGoal ? String(prefill.pointsGoal) : "");
  const [expiry, setExpiry] = useState(prefill.expiry ?? "");
  const [code2, setCode2] = useState(prefill.code2 ?? "");
  const [note, setNote] = useState(prefill.note ?? "");
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [shops, setShops] = useState(/** @type {any[] | null} */ (null));
  const [picked, setPicked] = useState(/** @type {any} */ (null));

  // When location arrives after the form opened, offer to save the place.
  useEffect(() => {
    if (mode === "add" && state.pos && !hereTouched) {
      setSaveHere(true);
    }
  }, [Boolean(state.pos)]);

  // Shops right where you stand, to fill the name with one tap.
  useEffect(() => {
    if (mode !== "add" || !state.pos || !state.settings.osm || !state.online || state.pos.accuracy > 250 || shops) {
      return;
    }
    const ac = new AbortController();
    setShops([]);
    fetchHere(state.pos, ac.signal)
      .then((list) => setShops(list.slice(0, 6)))
      .catch(() => setShops([]));
    return () => ac.abort();
  }, [Boolean(state.pos)]);

  const applyBrand = (b) => {
    if (b && !colorTouched) {
      setColor(b.color);
    }
    if (b && !catTouched) {
      setCategory(b.category);
    }
  };
  const brandChips = useMemo(() => suggestBrands(name, 5), [name]);
  const realFormat = format === "auto" ? guessFormat(code) : format;

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!name.trim()) {
      errs.name = t("form.needName");
    }
    if (!code.trim() && format !== "none") {
      errs.code = t("form.needCode");
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      return;
    }
    const existing = mode === "edit" ? getCard(prefill.id) : null;
    const places = [...(existing?.places ?? [])];
    if (saveHere && state.pos) {
      const spot = picked ?? state.pos;
      places.push({
        id: newId(),
        lat: spot.lat,
        lon: spot.lon,
        label: picked ? picked.address || picked.name : "",
        source: picked ? "map" : "here",
        at: Date.now(),
      });
    }
    const keepCount = existing?.stamps && existing.stamps.goal === goal ? existing.stamps.count : 0;
    const card = await saveCard({
      ...(existing ? { id: existing.id } : {}),
      name: name.trim(),
      code: code.trim(),
      format: realFormat,
      color,
      category,
      autoBranches,
      places,
      note: note.trim(),
      points: cleanPoints(points.trim() === "" ? null : points),
      pointsGoal: cleanPoints(pointsGoal.trim() === "" ? null : pointsGoal),
      expiry: cleanDate(expiry),
      code2: code2.trim(),
      format2: code2.trim() ? guessFormat(code2.trim()) : "none",
      stamps: stampsOn ? { goal, count: Math.min(goal, keepCount), reward: reward.trim(), redeemed: existing?.stamps?.redeemed ?? 0 } : null,
      sample: existing?.sample && existing.name === name.trim() ? true : undefined,
    });
    buzz([20, 40, 20]);
    if (mode === "add") {
      confetti({ count: 70 });
    }
    toast(t("card.saved"));
    invalidateBranches();
    replace(`#card-${card.id}`);
  };

  return html`<form class="form" novalidate onSubmit=${submit}>
    ${prefill.fromAi ? html`<p class="ai-note"><${Icon} name="sparkles" />${t("ai.filled")}</p>` : null}

    <div class="tile preview-tile" style=${tint(color)} aria-hidden="true">
      <span class="tile-icon"><${Icon} name=${categoryIcon(category)} /></span>
      <span class="tile-text"><span class="tile-name">${name || t("form.namePlaceholder")}</span><span class="tile-sub">${code || "—"}</span></span>
      <span></span>
    </div>

    <div class="field">
      <label class="label" for="card-name">${t("form.name")}</label>
      <input
        id="card-name"
        class="input"
        autocomplete="off"
        autocapitalize="words"
        maxlength="80"
        placeholder=${t("form.namePlaceholder")}
        value=${name}
        onInput=${(e) => {
          const v = e.currentTarget.value;
          setName(v);
          setPicked(null);
          applyBrand(findBrand(v));
        }}
      />
      ${errors.name ? html`<p class="err" role="alert">${errors.name}</p>` : null}
      ${shops && shops.length
        ? html`<span class="label" style="font-size:11px">${t("form.hereNow")}</span>
            <div class="chips wrap-chips">
              ${shops.map(
                (s) => html`<button
                  type="button"
                  class="chip here"
                  onClick=${() => {
                    const n = s.brand || s.name;
                    setName(n);
                    setPicked(s);
                    applyBrand(findBrand(n));
                    setSaveHere(true);
                  }}
                >
                  <${Icon} name="store" />${s.name} · ${formatDistance(s.distance, locale())}
                </button>`,
              )}
            </div>`
        : null}
      ${brandChips.length
        ? html`<div class="chips wrap-chips">
            ${brandChips.map(
              (b) => html`<button
                type="button"
                class="chip solid"
                onClick=${() => {
                  setName(b.name);
                  applyBrand(b);
                }}
              >
                <span style=${{ width: "12px", height: "12px", borderRadius: "4px", border: "2px solid var(--line)", background: b.color }}></span>${b.name}
              </button>`,
            )}
          </div>`
        : null}
    </div>

    <div class="field">
      <label class="label" for="card-code">${t("form.code")}</label>
      <div class="code-row">
        <input
          id="card-code"
          class="input mono"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="512"
          placeholder=${t("form.codePlaceholder")}
          value=${code}
          onInput=${(e) => setCode(e.currentTarget.value)}
        />
        <select id="card-format" class="input" aria-label=${t("form.format")} value=${format} onChange=${(e) => setFormat(e.currentTarget.value)}>
          ${FORMAT_ORDER.map(
            (k) => html`<option value=${k}>${k === "auto" ? t("form.formatAuto") : k === "none" ? t("form.formatNone") : FORMATS[k].label}</option>`,
          )}
        </select>
      </div>
      ${errors.code ? html`<p class="err" role="alert">${errors.code}</p>` : null}
      ${onRescan ? html`<button type="button" class="btn sm" style="justify-self:start" onClick=${onRescan}><${Icon} name="scan-barcode" />${t("form.rescan")}</button>` : null}
    </div>

    <div class="field">
      <span class="label">${t("form.color")}</span>
      <div class="swatches" role="radiogroup" aria-label=${t("form.color")}>
        ${SWATCHES.map(
          (c) => html`<button
            type="button"
            role="radio"
            aria-checked=${String(c.toLowerCase() === color.toLowerCase())}
            aria-label=${c}
            class=${`swatch${c.toLowerCase() === color.toLowerCase() ? " is-on" : ""}`}
            style=${{ "--c": c }}
            onClick=${() => {
              setColor(c);
              setColorTouched(true);
            }}
          ></button>`,
        )}
        <label class="swatch swatch-pick" title=${t("form.color")}>
          <${Icon} name="plus" />
          <input
            type="color"
            aria-label=${t("form.color")}
            value=${/^#[0-9a-f]{6}$/i.test(color) ? color : "#2f5bff"}
            onInput=${(e) => {
              setColor(e.currentTarget.value.toUpperCase());
              setColorTouched(true);
            }}
          />
        </label>
      </div>
    </div>

    <div class="field">
      ${mode === "add"
        ? html`<${Toggle}
            id="save-here"
            label=${state.pos ? t("form.saveHere") : t("form.saveHereOff")}
            meta=${state.pos ? (picked ? picked.address || picked.name : t("form.saveHereAcc", { m: formatDistance(state.pos.accuracy, locale()) })) : ""}
            checked=${saveHere && Boolean(state.pos)}
            onChange=${(v) => {
              setHereTouched(true);
              if (v && !state.pos) {
                startLocation();
                return;
              }
              setSaveHere(v);
            }}
          />`
        : null}
      <${Toggle} id="auto-branches" label=${t("form.autoBranches")} meta=${t("form.autoBranchesHint")} checked=${autoBranches} onChange=${setAutoBranches} />
    </div>

    <details class="more" open=${mode === "edit" || Boolean(prefill.points || prefill.expiry || prefill.note)}>
      <summary>${t("form.more")}<${Icon} name="chevron-right" /></summary>
      <div class="more-body">
        <div class="field">
          <span class="label">${t("form.category")}</span>
          <div class="cats" role="radiogroup">
            ${CATEGORIES.map(
              (c) => html`<button
                type="button"
                role="radio"
                aria-checked=${String(c.id === category)}
                class=${`cat${c.id === category ? " is-on" : ""}`}
                onClick=${() => {
                  setCategory(c.id);
                  setCatTouched(true);
                }}
              >
                <${Icon} name=${c.icon} />${t(`cat.${c.id}`)}
              </button>`,
            )}
          </div>
        </div>
        <${Toggle} id="stamps-on" label=${t("form.stamps")} meta=${t("stamps.setupHint")} checked=${stampsOn} onChange=${setStampsOn} />
        ${stampsOn
          ? html`<div class="field">
              <span class="label">${t("stamps.goal")}</span>
              <${Seg} value=${goal} options=${[5, 6, 8, 10, 12].map((n) => [n, String(n)])} onChange=${setGoal} />
              <input id="stamps-reward" class="input" placeholder=${t("stamps.rewardPlaceholder")} aria-label=${t("stamps.reward")} value=${reward} onInput=${(e) => setReward(e.currentTarget.value)} />
            </div>`
          : null}
        <div class="two">
          <label class="field"><span class="label">${t("form.points")}</span>
            <input id="card-points" class="input mono" inputmode="numeric" placeholder="0" value=${points} onInput=${(e) => setPoints(e.currentTarget.value)} />
          </label>
          <label class="field"><span class="label">${t("form.pointsGoal")}</span>
            <input id="card-points-goal" class="input mono" inputmode="numeric" placeholder="—" value=${pointsGoal} onInput=${(e) => setPointsGoal(e.currentTarget.value)} />
          </label>
        </div>
        <label class="field"><span class="label">${t("form.expiry")}</span>
          <input id="card-expiry" class="input" type="date" value=${expiry} onInput=${(e) => setExpiry(e.currentTarget.value)} />
        </label>
        <label class="field"><span class="label">${t("form.code2")}</span>
          <input id="card-code2" class="input mono" placeholder=${t("form.code2Placeholder")} value=${code2} onInput=${(e) => setCode2(e.currentTarget.value)} />
          <span class="hint">${t("form.code2Hint")}</span>
        </label>
        <label class="field"><span class="label">${t("form.note")}</span>
          <textarea id="card-note" class="input" maxlength="500" placeholder=${t("form.notePlaceholder")} value=${note} onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
        </label>
      </div>
    </details>

    <div class="form-foot">
      <button type="submit" class="btn xl lime block"><${Icon} name="check" />${mode === "add" ? t("form.save") : t("form.saveChanges")}</button>
    </div>
  </form>`;
}
