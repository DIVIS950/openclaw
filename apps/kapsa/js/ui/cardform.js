// Adding (#scan, #gift) and editing (#edit-<id>) a card or gift card. New cards start
// with the camera; the form keeps the essentials up front and the rest under "More".

import { FORMAT_ORDER, FORMATS, fromDetectorFormat, guessFormat } from "../barcode.js";
import { CATEGORIES, SWATCHES, cleanDomain, findBrand, suggestBrands } from "../brands.js";
import { confetti } from "../confetti.js";
import { formatDistance } from "../geo.js";
import { locale, t } from "../i18n.js";
import { invalidateBranches, startLocation } from "../location.js";
import { cardLook, lookVars } from "../look.js";
import { cleanDate, cleanMoney, cleanPoints } from "../model.js";
import { replace } from "../nav.js";
import { fetchHere } from "../osm.js";
import { getCard, saveCard, state } from "../state.js";
import { newId } from "../store.js";
import { buzz } from "../util.js";
import { Icon, Logo, Page, Seg, Sheet, Toggle, html, toast } from "./kit.js";
import { Scanner } from "./scanner.js";
import { useEffect, useMemo, useRef, useState } from "../../vendor/preact.js";

/**
 * #scan and #gift: camera first, then the form.
 * @param {{ kind?: "loyalty" | "gift" }} props
 */
export function NewCardSheet({ kind = "loyalty" }) {
  const [prefill, setPrefill] = useState(/** @type {any} */ (null));
  if (!prefill) {
    return html`<${Sheet} black title=${kind === "gift" ? t("scan.giftTitle") : t("scan.title")}>
      <${Scanner}
        kind=${kind === "gift" ? "gift" : "card"}
        onCode=${(raw) => setPrefill({ kind, code: raw.rawValue.trim(), format: fromDetectorFormat(raw.format) })}
        onAi=${(r) =>
          setPrefill({
            kind: kind === "gift" ? "gift" : r.kind,
            balance: r.balance,
            initialBalance: r.balance,
            pin: r.pin,
            website: r.website,
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
        onManual=${() => setPrefill({ kind, code: "", format: "auto" })}
      />
    <//>`;
  }
  return html`<${Sheet} tall title=${prefill.kind === "gift" ? t("gift.addTitle") : t("form.titleAdd")}>
    <${CardForm} mode="add" prefill=${prefill} onRescan=${() => setPrefill(null)} />
  <//>`;
}

/** #edit-<id> */
export function EditCardPage({ id }) {
  const card = getCard(id);
  if (!card) {
    return null;
  }
  return html`<${Page} title=${t("form.titleEdit")} hero=${html`<h1 class="display sm">${t("form.titleEdit")}</h1>`}>
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
  const [kind, setKind] = useState(prefill.kind === "gift" ? "gift" : "loyalty");
  const money0 = (v) => (v === null || v === undefined ? "" : String(v));
  const [initial, setInitial] = useState(money0(prefill.initialBalance ?? prefill.balance));
  const [balance, setBalance] = useState(money0(prefill.balance));
  const [pin, setPin] = useState(prefill.pin ?? "");
  const [website, setWebsite] = useState(prefill.website ?? "");
  const [logo, setLogo] = useState(/** @type {string | null} */ (prefill.logo ?? null));
  const logoFile = useRef(null);
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
    if (!code.trim() && format !== "none" && kind !== "gift") {
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
      format: code.trim() ? realFormat : "none",
      color,
      kind,
      // A new gift card starts with its full value unless the balance was given.
      initialBalance: kind === "gift" ? cleanMoney(initial) : null,
      balance: kind === "gift" ? (cleanMoney(balance) ?? cleanMoney(initial)) : null,
      pin: kind === "gift" ? pin.trim().slice(0, 32) : "",
      website: cleanDomain(website),
      logo,
      category,
      autoBranches,
      places,
      note: note.trim(),
      points: cleanPoints(points.trim() === "" ? null : points),
      pointsGoal: cleanPoints(pointsGoal.trim() === "" ? null : pointsGoal),
      expiry: cleanDate(expiry),
      code2: code2.trim(),
      format2: code2.trim() ? guessFormat(code2.trim()) : "none",
      stamps: stampsOn && kind !== "gift" ? { goal, count: Math.min(goal, keepCount), reward: reward.trim(), redeemed: existing?.stamps?.redeemed ?? 0 } : null,
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

    <${Seg}
      value=${kind}
      label=${t("gift.kindLabel")}
      options=${[
        ["loyalty", t("gift.kindLoyalty")],
        ["gift", t("gift.kind")],
      ]}
      onChange=${setKind}
    />

    <div class="wcard preview" style=${lookVars({ color, category, kind })} aria-hidden="true">
      <span class="wcard-top">
        <span class="wcard-title">
          <span class="wcard-name">${name || t("form.namePlaceholder")}</span>
          <span class="wcard-sub mono">${kind === "gift" && (balance || initial) ? `${balance || initial} ${state.settings.currency}` : code || "—"}</span>
        </span>
        <${Logo} card=${{ name, category, kind, website, logo }} />
      </span>
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
                  class="chip accent"
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
                <span class="dot" style=${{ background: cardLook(b).to }}></span>${b.name}
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

    ${kind === "gift"
      ? html`<div class="two">
            <label class="field"><span class="label">${t("gift.value")}</span>
              <input id="gift-initial" class="input mono" inputmode="decimal" placeholder="1000" value=${initial} onInput=${(e) => setInitial(e.currentTarget.value)} />
            </label>
            <label class="field"><span class="label">${t("gift.balance")}</span>
              <input id="gift-balance" class="input mono" inputmode="decimal" placeholder=${initial || "1000"} value=${balance} onInput=${(e) => setBalance(e.currentTarget.value)} />
            </label>
          </div>
          <div class="two">
            <label class="field"><span class="label">PIN</span>
              <input id="gift-pin" class="input mono" autocomplete="off" spellcheck="false" maxlength="32" placeholder=${t("common.optional")} value=${pin} onInput=${(e) => setPin(e.currentTarget.value)} />
            </label>
            <label class="field"><span class="label">${t("form.expiry")}</span>
              <input id="gift-expiry" class="input" type="date" value=${expiry} onInput=${(e) => setExpiry(e.currentTarget.value)} />
            </label>
          </div>`
      : null}

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
      <span class="label">${t("logo.title")}</span>
      <div class="logo-row">
        <span class="mini-logo" style=${lookVars({ color, category, kind })}><${Logo} card=${{ name, category, kind, website, logo }} /></span>
        <input
          id="card-website"
          class="input"
          inputmode="url"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          placeholder=${findBrand(name)?.domain ?? t("logo.websitePlaceholder")}
          aria-label=${t("logo.website")}
          value=${website}
          onInput=${(e) => setWebsite(e.currentTarget.value)}
        />
      </div>
      <div class="btn-row">
        <button type="button" class="btn sm" onClick=${() => logoFile.current?.click()}><${Icon} name="image" />${t("logo.own")}</button>
        ${logo ? html`<button type="button" class="btn sm ghost danger-text" onClick=${() => setLogo(null)}>${t("logo.remove")}</button>` : null}
      </div>
      <input
        ref=${logoFile}
        type="file"
        accept="image/*"
        hidden
        onChange=${async (e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) {
            try {
              setLogo(await logoFromFile(f));
            } catch {
              toast(t("logo.failed"));
            }
          }
        }}
      />
      <span class="hint">${t("logo.hint")}</span>
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
        ${kind !== "gift" ? html`<${Toggle} id="stamps-on" label=${t("form.stamps")} meta=${t("stamps.setupHint")} checked=${stampsOn} onChange=${setStampsOn} />` : null}
        ${stampsOn && kind !== "gift"
          ? html`<div class="field">
              <span class="label">${t("stamps.goal")}</span>
              <${Seg} value=${goal} options=${[5, 6, 8, 10, 12].map((n) => [n, String(n)])} onChange=${setGoal} />
              <input id="stamps-reward" class="input" placeholder=${t("stamps.rewardPlaceholder")} aria-label=${t("stamps.reward")} value=${reward} onInput=${(e) => setReward(e.currentTarget.value)} />
            </div>`
          : null}
        ${kind !== "gift"
          ? html`<div class="two">
          <label class="field"><span class="label">${t("form.points")}</span>
            <input id="card-points" class="input mono" inputmode="numeric" placeholder="0" value=${points} onInput=${(e) => setPoints(e.currentTarget.value)} />
          </label>
          <label class="field"><span class="label">${t("form.pointsGoal")}</span>
            <input id="card-points-goal" class="input mono" inputmode="numeric" placeholder="—" value=${pointsGoal} onInput=${(e) => setPointsGoal(e.currentTarget.value)} />
          </label>
        </div>
        <label class="field"><span class="label">${t("form.expiry")}</span>
          <input id="card-expiry" class="input" type="date" value=${expiry} onInput=${(e) => setExpiry(e.currentTarget.value)} />
        </label>`
          : null}
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
      <button type="submit" class="btn xl primary block"><${Icon} name="check" />${mode === "add" ? t("form.save") : t("form.saveChanges")}</button>
    </div>
  </form>`;
}

/**
 * A picked picture as a small square logo (128 px PNG data URL), centred and cropped.
 * @param {Blob} file
 */
async function logoFromFile(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  canvas
    .getContext("2d")
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
  bitmap.close?.();
  const png = canvas.toDataURL("image/png");
  // Photos compress far better as JPEG; keep PNG only when it's already small (flat logos).
  return png.length <= 60_000 ? png : canvas.toDataURL("image/jpeg", 0.85);
}
