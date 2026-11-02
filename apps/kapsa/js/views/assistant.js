// Chat assistant (#ai): ask about your cards in Czech or English. Claude looks things up
// with tools that run here on the phone, and can put "open card" buttons under its answer.

import { ChatSession, cardsForAssistant, describeError, hasApiKey } from "../ai.js";
import { shopMatches } from "../brands.js";
import { h, mount, toast } from "../dom.js";
import { distanceMeters, rankCards } from "../geo.js";
import { usualDayPart } from "../habits.js";
import { getLang, locale, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { cleanDate, cleanPoints } from "../model.js";
import { back, go, replace } from "../nav.js";
import { fetchHere } from "../osm.js";
import { extraPlaces, getCard, saveCard, state } from "../state.js";

/** Kept for the whole app session, so closing the sheet doesn't lose the chat. */
const transcript = [];
let session = null;

function newSession() {
  return new ChatSession({ runTool, model: () => state.settings.aiModel });
}

/** Tools Claude can call. They run on the phone and only read or change local data. */
async function runTool(name, input) {
  if (name === "list_cards") {
    const rows = rankCards(state.cards, state.pos, extraPlaces(), state.settings.radius);
    const distances = {};
    const usual = {};
    for (const r of rows) {
      distances[r.card.id] = r.distance;
      usual[r.card.id] = state.settings.habits ? usualDayPart(r.card.usage) : null;
    }
    const here = rows.filter((r) => r.here).map((r) => r.card.id);
    const list = cardsForAssistant(
      rows.map((r) => r.card),
      { now: Date.now(), distances, here, usual },
    );
    return { content: JSON.stringify({ location_on: Boolean(state.pos), cards: list }) };
  }
  if (name === "find_nearby_shops") {
    if (!state.pos) {
      return { content: "Location is off, so nearby shops are unknown. Ask the user to turn on location in Kapsa.", isError: true };
    }
    if (!state.settings.osm) {
      return { content: "The user turned off OpenStreetMap lookups in Kapsa settings.", isError: true };
    }
    const radius = [100, 300, 800].includes(input?.radius_m) ? input.radius_m : 300;
    const shops = (await fetchHere(state.pos, undefined, radius)).slice(0, 25);
    const out = shops.map((s) => {
      const card = state.cards.find((c) => shopMatches(c.name, s.name) || (s.brand && shopMatches(c.name, s.brand)));
      return {
        name: s.name,
        kind: s.kind,
        distance_m: Math.round(distanceMeters(state.pos, s)),
        matching_card_id: card?.id ?? null,
        matching_card_name: card?.name ?? null,
      };
    });
    return { content: JSON.stringify({ radius_m: radius, shops: out }) };
  }
  if (name === "show_card") {
    const card = getCard(String(input?.card_id ?? ""));
    if (!card) {
      return { content: "No card with that id. Call list_cards to get valid ids.", isError: true };
    }
    return { content: `A button for ${card.name} is shown under your answer.`, cardId: card.id };
  }
  if (name === "update_card") {
    const card = getCard(String(input?.card_id ?? ""));
    if (!card) {
      return { content: "No card with that id. Call list_cards to get valid ids.", isError: true };
    }
    const patch = {};
    const done = [];
    if (input.points !== null && input.points !== undefined) {
      patch.points = cleanPoints(input.points);
      done.push(t("ai.savedPoints", { n: new Intl.NumberFormat(locale()).format(patch.points ?? 0) }));
    }
    if (input.expiry !== null && input.expiry !== undefined) {
      const date = cleanDate(input.expiry);
      if (!date) {
        return { content: "expiry must be a real date as YYYY-MM-DD.", isError: true };
      }
      patch.expiry = date;
      done.push(t("ai.savedExpiry", { d: new Date(`${date}T12:00:00`).toLocaleDateString(locale()) }));
    }
    if (input.note !== null && input.note !== undefined) {
      patch.note = String(input.note).slice(0, 500);
      done.push(t("ai.savedNote"));
    }
    if (!done.length) {
      return { content: "Nothing to change." };
    }
    await saveCard({ ...card, ...patch });
    return { content: `Saved on ${card.name}.`, cardId: card.id, saved: `${card.name}: ${done.join(", ")}` };
  }
  return { content: `Unknown tool ${name}.`, isError: true };
}

/** Facts that change every turn; sent after the user's text so the cached prefix stays the same. */
function turnContext() {
  const now = new Date();
  const when = now.toLocaleString(locale(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const loc = state.pos ? `on (±${Math.round(state.pos.accuracy)} m)` : "off";
  return `Local time: ${when}. Location: ${loc}. App language: ${getLang() === "cs" ? "Czech" : "English"}.`;
}

/**
 * Tiny formatter: paragraphs, "- " bullets and **bold**, built as DOM nodes (never HTML).
 * @param {string} text
 */
function richText(text) {
  const out = [];
  let list = null;
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const inline = (s) =>
      s.split(/(\*\*[^*]+\*\*)/g).map((part) => (part.startsWith("**") && part.endsWith("**") ? h("strong", null, part.slice(2, -2)) : part));
    if (bullet) {
      list ??= h("ul", null);
      list.append(h("li", null, inline(bullet[1])));
      continue;
    }
    if (list) {
      out.push(list);
      list = null;
    }
    if (line.trim()) {
      out.push(h("p", null, inline(line)));
    }
  }
  if (list) {
    out.push(list);
  }
  return out;
}

export function createAssistantSheet() {
  const log = h("div", { class: "chat-log", "aria-live": "polite" });
  const input = h("textarea", {
    id: "chat-input",
    class: "chat-input",
    rows: 1,
    maxlength: 1000,
    enterkeyhint: "send",
    placeholder: t("ai.placeholder"),
    "aria-label": t("ai.placeholder"),
  });
  const sendBtn = h("button", { type: "submit", class: "chat-send", "aria-label": t("ai.send") }, h("span", { html: iconSvg("navigation") }));
  let busy = false;
  let hasKey = null;

  const scrollDown = () => {
    const body = el.closest(".sheet-body");
    requestAnimationFrame(() => body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" }));
  };

  const bubble = (item) => {
    if (item.role === "user") {
      return h("div", { class: "msg is-user" }, h("p", null, item.text));
    }
    if (item.role === "error") {
      return h("div", { class: "msg is-error", role: "alert" }, h("p", null, item.text));
    }
    return h(
      "div",
      { class: "msg is-ai" },
      richText(item.text),
      item.saved?.length
        ? h(
            "div",
            { class: "msg-saved" },
            item.saved.map((s) => h("span", { class: "saved-chip" }, h("span", { html: iconSvg("check") }), s)),
          )
        : null,
      item.cardIds?.length
        ? h(
            "div",
            { class: "msg-cards" },
            item.cardIds.map((cid) => {
              const card = getCard(cid);
              return card
                ? h(
                    "button",
                    { type: "button", class: "card-link", style: { "--c": card.color }, onclick: () => go(`#card-${cid}`) },
                    h("span", { class: "card-link-swatch" }),
                    h("span", { class: "card-link-name" }, card.name),
                    h("span", { html: iconSvg("scan-barcode") }),
                  )
                : null;
            }),
          )
        : null,
    );
  };

  const suggestions = () =>
    h(
      "div",
      { class: "chat-intro" },
      h("span", { class: "ai-orb is-big", "aria-hidden": "true" }),
      h("h3", { class: "chat-intro-title" }, t("ai.introTitle")),
      h("p", { class: "muted" }, t("ai.introBody")),
      h(
        "div",
        { class: "chips" },
        ["ai.q1", "ai.q2", "ai.q3", "ai.q4"].map((key) =>
          h("button", { type: "button", class: "chip", onclick: () => ask(t(key)) }, t(key)),
        ),
      ),
    );

  const setup = () =>
    h(
      "div",
      { class: "chat-intro" },
      h("span", { class: "ai-orb is-big", "aria-hidden": "true" }),
      h("h3", { class: "chat-intro-title" }, t("ai.setupTitle")),
      h("p", { class: "muted" }, t("ai.setupBody")),
      h(
        "button",
        { type: "button", class: "btn-primary", onclick: () => replace("#settings") },
        h("span", { html: iconSvg("settings") }),
        t("ai.setup"),
      ),
    );

  const render = () => {
    if (hasKey === false) {
      mount(log, setup());
      return;
    }
    mount(
      log,
      transcript.length ? transcript.map(bubble) : suggestions(),
      busy ? h("div", { class: "msg is-ai is-typing", "aria-label": t("ai.thinking") }, h("span"), h("span"), h("span")) : null,
    );
    sendBtn.disabled = busy;
    resetBtn.hidden = !transcript.length;
  };

  async function ask(text) {
    const q = text.trim();
    if (!q || busy) {
      return;
    }
    session ??= newSession();
    transcript.push({ role: "user", text: q });
    input.value = "";
    autoGrow();
    busy = true;
    render();
    scrollDown();
    try {
      const answer = await session.ask(q, turnContext());
      transcript.push({ role: "ai", text: answer.text, cardIds: answer.cardIds, saved: answer.saved });
    } catch (err) {
      transcript.push({ role: "error", text: await describeError(err) });
    } finally {
      busy = false;
      if (el.isConnected) {
        render();
        scrollDown();
      }
    }
  }

  const autoGrow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask(input.value);
    }
  });

  const resetBtn = h(
    "button",
    {
      type: "button",
      class: "icon-btn",
      "aria-label": t("ai.reset"),
      hidden: true,
      onclick: () => {
        transcript.length = 0;
        session?.reset();
        render();
        toast(t("ai.cleared"));
      },
    },
    h("span", { html: iconSvg("trash-2") }),
  );

  const el = h(
    "div",
    { class: "chat-sheet" },
    h(
      "div",
      { class: "sheet-bar" },
      h("button", { type: "button", class: "icon-btn", onclick: () => back(), "aria-label": t("card.close") }, h("span", { html: iconSvg("x") })),
      h("div", { class: "sheet-bar-title" }, h("span", { class: "ai-orb", "aria-hidden": "true" }), h("h2", { class: "sheet-title" }, t("ai.title"))),
      resetBtn,
    ),
    log,
    h(
      "form",
      {
        class: "chat-compose",
        onsubmit: (e) => {
          e.preventDefault();
          ask(input.value);
        },
      },
      input,
      sendBtn,
    ),
    h("p", { class: "fineprint chat-fine" }, t("ai.privacy")),
  );

  render();
  hasApiKey().then((ok) => {
    hasKey = ok;
    render();
    if (ok) {
      input.focus({ preventScroll: true });
    }
  });

  return { el, tall: true, update: () => {} };
}
