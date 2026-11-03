// Full-screen camera scanner: reads barcodes live, from a photo, or sends one photo
// to Claude to read the whole card or coupon.

import { describeError, hasApiKey, readCardPhoto, readCouponPhoto } from "../ai.js";
import { getLang, t } from "../i18n.js";
import { back, go } from "../nav.js";
import { CameraScanner, scanImageFile } from "../scanner.js";
import { state } from "../state.js";
import { buzz } from "../util.js";
import { Icon, html, toast } from "./kit.js";
import { useEffect, useRef, useState } from "../../vendor/preact.js";

/**
 * @param {{
 *   kind: "card" | "coupon",
 *   onCode: (raw: { rawValue: string, format: string }) => void,
 *   onAi: (reading: any) => void,
 *   onManual: () => void,
 *   onClose?: () => void,
 * }} props
 */
export function Scanner({ kind, onCode, onAi, onManual, onClose }) {
  const video = useRef(null);
  const scanner = useRef(/** @type {CameraScanner | null} */ (null));
  const done = useRef(false);
  const [status, setStatus] = useState("starting");
  const [message, setMessage] = useState("");
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const photo = useRef(null);
  const aiPhoto = useRef(null);

  const finish = (raw) => {
    if (done.current) {
      return;
    }
    done.current = true;
    buzz([20, 40, 20]);
    scanner.current?.stop();
    onCode(raw);
  };

  useEffect(() => {
    const s = new CameraScanner(video.current, finish);
    scanner.current = s;
    s.start().then((result) => {
      if (done.current) {
        s.stop();
        return;
      }
      setStatus(result);
      setHasTorch(result === "ok" && s.hasTorch());
      if (result !== "ok") {
        setMessage(result === "denied" ? t("scan.cameraDenied") : t("scan.noCamera"));
      }
    });
    return () => s.stop();
  }, []);

  const onPhoto = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) {
      return;
    }
    setMessage(t("scan.reading"));
    const found = await scanImageFile(file).catch(() => null);
    if (found) {
      finish(found);
    } else {
      setMessage(t("scan.photoNone"));
    }
  };

  const startAi = async () => {
    if (!(await hasApiKey())) {
      toast(t("ai.needKey"), { action: t("ai.setup"), onAction: () => go("#settings"), ms: 6000 });
      return;
    }
    aiPhoto.current?.click();
  };

  const onAiPhoto = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) {
      return;
    }
    done.current = true;
    scanner.current?.stop();
    setBusy(true);
    try {
      const detected = await scanImageFile(file).catch(() => null);
      const opts = { model: state.settings.aiModel, lang: getLang() };
      const reading = kind === "coupon" ? await readCouponPhoto(file, detected, opts) : await readCardPhoto(file, detected, opts);
      buzz([20, 40, 20]);
      onAi(reading);
    } catch (err) {
      setBusy(false);
      setMessage(await describeError(err));
      done.current = false;
      if (status === "ok") {
        scanner.current?.start();
      }
    }
  };

  return html`<div class=${`scan${status !== "ok" && status !== "starting" ? " no-cam" : ""}`}>
    <video ref=${video} playsinline muted autoplay></video>
    <div class="scan-frame" aria-hidden="true"><span class="scan-laser"></span></div>
    <div class="scan-top">
      <button type="button" class="ibtn" aria-label=${t("common.close")} onClick=${onClose ?? (() => back())}><${Icon} name="x" /></button>
      <h2 class="scan-title">${kind === "coupon" ? t("scan.couponTitle") : t("scan.title")}</h2>
      ${hasTorch
        ? html`<button
            type="button"
            class=${`ibtn${torch ? " is-on" : ""}`}
            aria-label=${t("scan.torch")}
            aria-pressed=${String(torch)}
            onClick=${async () => setTorch(await scanner.current.toggleTorch())}
          >
            <${Icon} name="flashlight" />
          </button>`
        : html`<span style="width:44px"></span>`}
    </div>
    <div class="scan-msg" role="status">
      ${status === "starting" ? html`<span>${t("scan.starting")}</span>` : status === "ok" && !message ? html`<span>${t("scan.hint")}</span>` : null}
      ${message ? html`<span class="box">${message}</span>` : null}
    </div>
    <div class="scan-bottom">
      <button type="button" class="btn" onClick=${() => photo.current?.click()}><${Icon} name="image" />${t("scan.photo")}</button>
      <button type="button" class="btn" onClick=${startAi}><${Icon} name="sparkles" />${t("scan.ai")}</button>
      <button
        type="button"
        class="btn primary"
        onClick=${() => {
          done.current = true;
          scanner.current?.stop();
          onManual();
        }}
      >
        <${Icon} name="keyboard" />${t("scan.manual")}
      </button>
    </div>
    <input ref=${photo} id="scan-photo" type="file" accept="image/*" hidden onChange=${onPhoto} />
    <input ref=${aiPhoto} id="scan-ai-photo" type="file" accept="image/*" capture="environment" hidden onChange=${onAiPhoto} />
    ${busy ? html`<div class="scan-busy" role="status"><span class="orb big"></span><span>${t("ai.reading")}</span></div>` : null}
  </div>`;
}
