// Shared UI pieces: icons, buttons, sheets, pages, the barcode ticket, toasts.

import { FORMATS, groupCode, renderBarcodeSvg } from "../barcode.js";
import { inkFor } from "../brands.js";
import { t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { back } from "../nav.js";
import { buzz, copyText } from "../util.js";
import { html, useEffect, useRef, useState } from "../../vendor/preact.js";

export { html };

/** Inline icon (trusted markup from icons.js). */
export function Icon({ name, cls = "icon" }) {
  return html`<span style="display:contents" dangerouslySetInnerHTML=${{ __html: iconSvg(name, cls) }}></span>`;
}

/** CSS variables for something coloured like a card: background and readable ink. */
export function tint(color) {
  return { "--c": color, "--on": inkFor(color) };
}

// ---------- Toasts ----------

let toastState = null;
const toastListeners = new Set();
let toastTimer = 0;

/**
 * Short message at the top of the screen, optionally with one action.
 * @param {string} text
 * @param {{ action?: string, onAction?: () => void, ms?: number }} [opts]
 */
export function toast(text, opts = {}) {
  clearTimeout(toastTimer);
  toastState = { text, ...opts, key: Date.now() };
  toastListeners.forEach((fn) => fn());
  toastTimer = window.setTimeout(() => {
    toastState = null;
    toastListeners.forEach((fn) => fn());
  }, opts.ms ?? 2600);
}

export function Toasts() {
  const [, setN] = useState(0);
  useEffect(() => {
    const fn = () => setN((n) => n + 1);
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  }, []);
  if (!toastState) {
    return null;
  }
  const s = toastState;
  return html`<div class=${`toast${s.action ? "" : " plain"}`} role="status" key=${s.key}>
    <span>${s.text}</span>
    ${s.action
      ? html`<button
          type="button"
          onClick=${() => {
            toastState = null;
            toastListeners.forEach((fn) => fn());
            s.onAction?.();
          }}
        >
          ${s.action}
        </button>`
      : null}
  </div>`;
}

// ---------- Layout ----------

/**
 * Bottom sheet with a dimmed backdrop. Tapping the backdrop goes back.
 * @param {{ title?: string, tall?: boolean, black?: boolean, children?: any, onClose?: () => void, actions?: any }} props
 */
export function Sheet({ title, tall, black, children, onClose, actions }) {
  const close = onClose ?? (() => back());
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  if (black) {
    return html`<div class="sheet black" role="dialog" aria-modal="true" aria-label=${title}>${children}</div>`;
  }
  return html`<div>
    <div class="sheet-back" onClick=${close}></div>
    <div class=${`sheet${tall ? " tall" : ""}`} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-grab">
        <div class="sheet-head">
          <h2 class="sheet-title">${title}</h2>
          <div class="row">
            ${actions}
            <button type="button" class="ibtn" aria-label=${t("common.close")} onClick=${close}><${Icon} name="x" /></button>
          </div>
        </div>
      </div>
      ${children}
    </div>
  </div>`;
}

/**
 * Full-screen page pushed over the tabs, with a back button and a title block.
 * @param {{ title?: string, actions?: any, hero?: any, children?: any, cls?: string }} props
 */
export function Page({ title, actions, hero, children, cls = "" }) {
  return html`<div class=${`page ${cls}`} role="dialog" aria-modal="true" aria-label=${title}>
    <header class="hero">
      <div class="hero-inner">
        <div class="topbar">
          <button type="button" class="hbtn" aria-label=${t("common.back")} onClick=${() => back()}>
            <${Icon} name="chevron-left" />
          </button>
          <div class="topbar-actions">${actions}</div>
        </div>
        ${hero}
      </div>
    </header>
    <div class="wrap">${children}</div>
  </div>`;
}

export function Section({ title, count, action, children, cls = "" }) {
  return html`<section class=${`sec ${cls}`}>
    <div class="wrap">
      ${title || action
        ? html`<div class="sec-head">
            <h2 class="sec-title">${title}${count !== undefined ? html`<span class="n">${count}</span>` : null}</h2>
            ${action}
          </div>`
        : null}
      ${children}
    </div>
  </section>`;
}

// ---------- Form controls ----------

export function Toggle({ id, label, meta, checked, onChange, disabled }) {
  return html`<label class="toggle" for=${id}>
    <span class="toggle-text">
      <span class="toggle-label">${label}</span>
      ${meta ? html`<span class="toggle-meta">${meta}</span>` : null}
    </span>
    <input
      id=${id}
      type="checkbox"
      class="switch-input"
      checked=${checked}
      disabled=${disabled}
      onChange=${(e) => onChange(e.currentTarget.checked)}
    />
    <span class="switch" aria-hidden="true"></span>
  </label>`;
}

/** @param {{ value: any, options: Array<[any, string]>, onChange: (v: any) => void, label?: string }} props */
export function Seg({ value, options, onChange, label }) {
  return html`<div class="seg" role="radiogroup" aria-label=${label}>
    ${options.map(
      ([v, text]) =>
        html`<button
          type="button"
          role="radio"
          aria-checked=${String(v === value)}
          class=${v === value ? "is-on" : ""}
          onClick=${() => onChange(v)}
        >
          ${text}
        </button>`,
    )}
  </div>`;
}

// ---------- Barcode ticket ----------

/**
 * White ticket with the scannable code. Tap the code for full screen.
 * @param {{ code: string, format: string, name: string, onBig?: () => void, copy?: boolean }} props
 */
export function Ticket({ code, format, name, onBig, copy = true }) {
  const def = FORMATS[format] ?? FORMATS.code128;
  const [svg, setSvg] = useState(/** @type {string | null} */ (null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSvg(null);
    setFailed(false);
    if (format !== "none" && code) {
      renderBarcodeSvg(code, format).then((r) => {
        if (live) {
          if (r) {
            setSvg(r.svg.replace("<svg ", `<svg preserveAspectRatio="${def.linear ? "none" : "xMidYMid meet"}" `));
          } else {
            setFailed(true);
          }
        }
      });
    }
    return () => {
      live = false;
    };
  }, [code, format]);
  const noCode = format === "none" || !code || failed;
  const doCopy = async (e) => {
    e.stopPropagation();
    if (await copyText(code)) {
      buzz();
      toast(t("card.copied"));
    }
  };
  return html`<div class="ticket">
    ${noCode
      ? html`<p class="ticket-none">${t("card.noCode")}</p>`
      : html`<button
          type="button"
          class=${`ticket-art ${def.linear ? "is-linear" : "is-matrix"}${svg ? "" : " loading"}`}
          aria-label=${`${name}: ${t("w.fullscreen")}`}
          onClick=${onBig}
          dangerouslySetInnerHTML=${svg ? { __html: svg } : undefined}
        ></button>`}
    <div class="ticket-foot">
      <span class=${`ticket-num${noCode ? " big" : ""}`}>${groupCode(code, format)}</span>
      ${copy && code
        ? html`<button type="button" class="ticket-copy" onClick=${doCopy}><${Icon} name="copy" />${t("card.copy")}</button>`
        : null}
    </div>
  </div>`;
}

/** Full-screen white code; tap anywhere to close. */
export function BigCode({ code, format, name, onClose }) {
  const def = FORMATS[format] ?? FORMATS.code128;
  const [svg, setSvg] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    buzz(10);
    renderBarcodeSvg(code, format).then((r) => {
      if (r) {
        setSvg(r.svg.replace("<svg ", `<svg preserveAspectRatio="${def.linear ? "none" : "xMidYMid meet"}" `));
      }
    });
    ref.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return html`<div class="bigcode" role="dialog" aria-modal="true" aria-label=${name} tabindex="-1" ref=${ref} onClick=${onClose}>
    <p class="name">${name}</p>
    <div class=${`big-art ${def.linear ? "is-linear" : "is-matrix"}`} dangerouslySetInnerHTML=${{ __html: svg }}></div>
    <p class="num">${groupCode(code, format)}</p>
    <p class="tip">${t("card.tapToClose")}</p>
  </div>`;
}

/** Ask the screen to stay on while mounted (for showing codes at the till). */
export function useWakeLock() {
  useEffect(() => {
    let lock = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {
        lock = null;
      }
    };
    const onVis = () => {
      if (!document.hidden) {
        request();
      }
    };
    request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.().catch(() => {});
    };
  }, []);
}

/** Inline two-step delete confirmation. */
export function ConfirmButton({ label, confirm, onConfirm }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return html`<button type="button" class="btn ghost danger-text" onClick=${() => setOpen(true)}>
      <${Icon} name="trash-2" />${label}
    </button>`;
  }
  return html`<div class="panel stack" role="alert">
    <strong>${confirm}</strong>
    <div class="btn-row">
      <button type="button" class="btn sm" onClick=${() => setOpen(false)}>${t("common.cancel")}</button>
      <button type="button" class="btn sm danger" onClick=${onConfirm}>${t("common.delete")}</button>
    </div>
  </div>`;
}
