// Assistant tab: chat with Claude about your cards, coupons and spending.

import { ChatSession, describeError, hasApiKey } from "../ai.js";
import { runTool, turnContext } from "../assistant-tools.js";
import { t } from "../i18n.js";
import { go } from "../nav.js";
import { getCard, getCoupon, state } from "../state.js";
import { Icon, html, tint, toast } from "./kit.js";
import { couponColor } from "./coupons.js";
import { useEffect, useRef, useState } from "../../vendor/preact.js";


/** Kept for the whole app session, so switching tabs doesn't lose the chat. */
const transcript = [];
let session = null;

/** Paragraphs, "- " bullets and **bold**, built as elements (never raw HTML). */
function Rich({ text }) {
  const blocks = [];
  let list = null;
  const inline = (s) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part) => (part.startsWith("**") && part.endsWith("**") ? html`<strong>${part.slice(2, -2)}</strong>` : part));
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      list ??= [];
      list.push(html`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (list) {
      blocks.push(html`<ul>${list}</ul>`);
      list = null;
    }
    if (line.trim()) {
      blocks.push(html`<p>${inline(line)}</p>`);
    }
  }
  if (list) {
    blocks.push(html`<ul>${list}</ul>`);
  }
  return blocks;
}

export function AssistantTab({ active }) {
  const [, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [hasKey, setHasKey] = useState(/** @type {boolean | null} */ (null));
  const end = useRef(null);
  const input = useRef(null);
  const rerender = () => setN((n) => n + 1);

  useEffect(() => {
    if (active) {
      hasApiKey().then(setHasKey);
    }
  }, [active]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript.length, busy]);

  const ask = async (q) => {
    const question = q.trim();
    if (!question || busy) {
      return;
    }
    session ??= new ChatSession({ runTool, model: () => state.settings.aiModel });
    transcript.push({ role: "me", text: question });
    setText("");
    setBusy(true);
    try {
      const a = await session.ask(question, turnContext());
      transcript.push({ role: "ai", ...a });
    } catch (err) {
      transcript.push({ role: "bad", text: await describeError(err) });
    } finally {
      setBusy(false);
      rerender();
    }
  };

  return html`<div>
    <header class="hero">
      <div class="hero-inner">
        <div class="topbar">
          <span class="eyebrow"><span class="orb"></span>Claude</span>
          ${transcript.length
            ? html`<button
                type="button"
                class="hbtn"
                aria-label=${t("ai.reset")}
                onClick=${() => {
                  transcript.length = 0;
                  session?.reset();
                  toast(t("ai.cleared"));
                  rerender();
                }}
              >
                <${Icon} name="trash-2" />
              </button>`
            : null}
        </div>
        <div class="hero-stack">
          <h1 class="display">${t("ai.title")}</h1>
          ${!transcript.length ? html`<p style="margin:0;font-weight:650">${hasKey === false ? t("ai.setupBody") : t("ai.introBody")}</p>` : null}
        </div>
      </div>
    </header>

    <div class="wrap chat" aria-live="polite">
      ${hasKey === false
        ? html`<button type="button" class="btn xl primary block" onClick=${() => go("#settings")}><${Icon} name="settings" />${t("ai.setup")}</button>`
        : !transcript.length
          ? html`<div class="stack">
              <strong style="font-size:18px">${t("ai.introTitle")}</strong>
              ${["ai.q1", "ai.q2", "ai.q3", "ai.q4"].map(
                (k, i) => html`<button type="button" class="mini" style=${{ animation: `pop .35s ${i * 50}ms both` }} onClick=${() => ask(t(k))}>
                  <span class="mini-swatch"><${Icon} name=${["store", "ticket-percent", "chart-column", "receipt"][i]} /></span>
                  <span class="mini-name" style="white-space:normal">${t(k)}</span>
                  <${Icon} name="chevron-right" />
                </button>`,
              )}
            </div>`
          : transcript.map((m, i) => html`<${Message} key=${i} m=${m} />`)}
      ${busy ? html`<div class="msg ai typing" aria-label=${t("ai.thinking")}><i></i><i></i><i></i></div>` : null}
      <div ref=${end}></div>
    </div>

    ${hasKey !== false
      ? html`<form
          class="compose"
          onSubmit=${(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <textarea
            ref=${input}
            id="chat-input"
            rows="1"
            maxlength="1000"
            enterkeyhint="send"
            placeholder=${t("ai.placeholder")}
            aria-label=${t("ai.placeholder")}
            value=${text}
            onInput=${(e) => {
              setText(e.currentTarget.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 140)}px`;
            }}
            onKeyDown=${(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                ask(text);
              }
            }}
          ></textarea>
          <button type="submit" class="send" aria-label=${t("ai.send")} disabled=${busy}><${Icon} name="navigation" /></button>
        </form>`
      : null}
  </div>`;
}

function Message({ m }) {
  if (m.role === "me") {
    return html`<div class="msg me"><p>${m.text}</p></div>`;
  }
  if (m.role === "bad") {
    return html`<div class="msg bad" role="alert"><p>${m.text}</p></div>`;
  }
  const cards = (m.cardIds ?? []).map(getCard).filter(Boolean);
  const coupons = (m.couponIds ?? []).map(getCoupon).filter(Boolean);
  return html`<div class="msg ai">
    <${Rich} text=${m.text} />
    ${(m.saved ?? []).map((s) => html`<span class="saved-chip"><${Icon} name="check" />${s}</span>`)}
    ${cards.length || coupons.length
      ? html`<div class="msg-links">
          ${cards.map(
            (c) => html`<button type="button" class="msg-link" style=${tint(c.color)} onClick=${() => go(`#card-${c.id}`)}>
              <span>${c.name}</span><${Icon} name="scan-barcode" />
            </button>`,
          )}
          ${coupons.map(
            (c) => html`<button type="button" class="msg-link" style=${tint(couponColor(c))} onClick=${() => go(`#coupon-${c.id}`)}>
              <span>${[c.discount, c.title].filter(Boolean).join(" · ")}</span><${Icon} name="ticket-percent" />
            </button>`,
          )}
        </div>`
      : null}
  </div>`;
}
