// Smaller screens: reminders, the "Add" menu, address search, shared-card import.

import { decodeShare } from "../model.js";
import { invalidateBranches } from "../location.js";
import { distanceMeters, formatDistance } from "../geo.js";
import { getLang, locale, t } from "../i18n.js";
import { askNotificationPermission, notificationsSupported, reminderRoute } from "../reminders.js";
import { back, go, replace } from "../nav.js";
import { searchAddress } from "../osm.js";
import { addPlace, getCard, saveCard, state, updateSettings } from "../state.js";
import { buzz } from "../util.js";
import { isIos, isStandalone } from "./settings.js";
import { Icon, Page, Sheet, html, tint, toast } from "./kit.js";
import { useState } from "../../vendor/preact.js";

const KIND = {
  "coupon-here": { icon: "ticket-percent", key: "rm.couponHere" },
  reward: { icon: "gift", key: "rm.reward" },
  "points-goal": { icon: "trophy", key: "rm.pointsGoal" },
  "coupon-expiring": { icon: "ticket", key: "rm.couponExpiring" },
  "card-expiring": { icon: "credit-card", key: "rm.cardExpiring" },
  "coupon-expired": { icon: "ticket", key: "rm.couponExpired" },
  "card-expired": { icon: "credit-card", key: "rm.cardExpired" },
};

/** Words for one reminder (also used for phone notifications). */
export function reminderText(r) {
  const k = KIND[r.kind];
  const when = r.days === undefined ? "" : r.days === 0 ? t("rm.today") : t("rm.inDays", { n: r.days });
  return { title: t(k.key), body: [r.title, when].filter(Boolean).join(" · "), url: reminderRoute(r) };
}

export function RemindersPage({ reminders }) {
  const [perm, setPerm] = useState(notificationsSupported() ? Notification.permission : "unsupported");
  const iosNeedsInstall = isIos() && !isStandalone();
  const turnOn = async () => {
    const res = await askNotificationPermission();
    setPerm(res);
    if (res === "granted") {
      await updateSettings({ notifications: true });
      toast(t("rm.notifyDone"));
    }
  };
  return html`<${Page} title=${t("rm.title")} hero=${html`<h1 class="display sm">${t("rm.title")}</h1>`}>
    <section class="sec">
      ${reminders.length
        ? html`<div class="list">
            ${reminders.map((r) => {
              const k = KIND[r.kind];
              const txt = reminderText(r);
              return html`<button type="button" class="li" key=${r.id} onClick=${() => go(reminderRoute(r))}>
                <span class="li-icon" style=${r.color ? tint(r.color) : undefined}><${Icon} name=${k.icon} /></span>
                <span class="li-text"><span class="li-title">${txt.title}</span><span class="li-sub">${txt.body}</span></span>
                <${Icon} name="chevron-right" />
                <span></span>
              </button>`;
            })}
          </div>`
        : html`<div class="empty"><h2>✓</h2><p>${t("rm.empty")}</p></div>`}
    </section>
    <section class="sec">
      <div class="panel stack">
        <strong style="font-size:18px">${t("rm.notifyTitle")}</strong>
        <p class="hint">${t("rm.notifyBody")}</p>
        ${perm === "granted" && state.settings.notifications
          ? html`<p class="hint" style="color:var(--green);font-weight:800">✓ ${t("rm.notifyDone")}</p>`
          : perm === "denied"
            ? html`<p class="hint" style="font-weight:800">${t("rm.notifyDenied")}</p>`
            : perm === "unsupported" || iosNeedsInstall
              ? html`<p class="hint" style="font-weight:800">${iosNeedsInstall ? t("rm.notifyIos") : t("rm.notifyUnsupported")}</p>`
              : html`<button type="button" class="btn primary" onClick=${turnOn}><${Icon} name="bell" />${t("rm.notifyOn")}</button>`}
        <p class="hint" style="font-size:13px">${t("rm.calendarHint")}</p>
      </div>
    </section>
  <//>`;
}

export function AddSheet() {
  const items = [
    { route: "#scan", icon: "credit-card", title: t("add.card"), sub: t("add.cardHint") },
    { route: "#newc", icon: "ticket-percent", title: t("add.coupon"), sub: t("add.couponHint") },
    { route: "#log", icon: "receipt", title: t("add.spend"), sub: t("add.spendHint") },
  ];
  return html`<${Sheet} title=${t("add.title")}>
    <div class="choices">
      ${items.map(
        (it, i) => html`<button type="button" class="choice" style=${{ "--i": i }} onClick=${() => replace(it.route)}>
          <span class="choice-icon"><${Icon} name=${it.icon} /></span>
          <span><span class="choice-title">${it.title}</span><span class="choice-sub">${it.sub}</span></span>
          <${Icon} name="chevron-right" />
        </button>`,
      )}
    </div>
  <//>`;
}

/** #find-<id>: search an address and save it as a place of the card. */
export function FindPage({ id }) {
  const card = getCard(id);
  const [q, setQ] = useState(card?.name ?? "");
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  const [error, setError] = useState("");
  if (!card) {
    return null;
  }
  const run = async (e) => {
    e?.preventDefault();
    if (!q.trim()) {
      return;
    }
    setError("");
    setRows(null);
    try {
      const list = await searchAddress(q.trim(), state.pos, getLang());
      setRows(list);
    } catch {
      setError(t("search.error"));
    }
  };
  return html`<${Page} title=${t("search.title")} hero=${html`<h1 class="display sm">${t("search.title")}</h1>`}>
    <section class="sec">
      <form class="code-row" onSubmit=${run} style="grid-template-columns:1fr auto">
        <input id="find-query" class="input" type="search" placeholder=${t("search.placeholder")} aria-label=${t("search.title")} value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <button type="submit" class="btn primary"><${Icon} name="search" />${t("search.go")}</button>
      </form>
      ${error ? html`<p class="err" style="margin-top:12px">${error}</p>` : null}
      ${rows && !rows.length ? html`<p class="hint" style="margin-top:12px">${t("search.none")}</p>` : null}
      ${rows && rows.length
        ? html`<div class="list" style="margin-top:14px">
            ${rows.map(
              (r) => html`<button
                type="button"
                class="li result"
                onClick=${async () => {
                  await addPlace(card.id, { lat: r.lat, lon: r.lon, label: [r.label, r.detail].filter(Boolean).join(", "), source: "search" });
                  buzz();
                  toast(t("card.placeSaved"));
                  invalidateBranches();
                  back();
                }}
              >
                <span class="li-icon"><${Icon} name="map-pin" /></span>
                <span class="li-text"><span class="li-title">${r.label}</span><span class="li-sub">${r.detail}</span></span>
                ${state.pos ? html`<span class="place-dist">${formatDistance(distanceMeters(state.pos, r), locale())}</span>` : html`<span></span>`}
                <span></span>
              </button>`,
            )}
          </div>`
        : null}
      <p class="hint" style="font-size:11px;margin-top:12px">© OpenStreetMap</p>
    </section>
  <//>`;
}

export function ImportSheet({ data }) {
  const card = decodeShare(data ?? "");
  if (!card) {
    queueMicrotask(() => {
      toast(t("import.invalid"));
      replace("");
    });
    return null;
  }
  return html`<${Sheet} title=${t("import.title")} onClose=${() => replace("")}>
    <div class="stack">
      <div class="tile preview-tile" style=${tint(card.color)}>
        <span class="tile-icon"><${Icon} name="credit-card" /></span>
        <span class="tile-text"><span class="tile-name">${card.name}</span><span class="tile-sub">${card.code}</span></span>
        <span></span>
      </div>
      <button
        type="button"
        class="btn xl primary block"
        onClick=${async () => {
          const saved = await saveCard({ ...card, uses: 0, lastUsedAt: 0 });
          buzz();
          toast(t("card.saved"));
          invalidateBranches();
          replace(`#card-${saved.id}`);
        }}
      >
        <${Icon} name="plus" />${t("import.add")}
      </button>
    </div>
  <//>`;
}
