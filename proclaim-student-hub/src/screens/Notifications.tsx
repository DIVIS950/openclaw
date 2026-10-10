import { useState } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import {
  askPermission,
  notifyPrefs,
  permission,
  show,
  type NotifyKind,
  type NotifyPrefs,
  type Permission,
} from "../lib/notify.ts";

// More › Notifications, as on the Bento canvas: a sample alert, one switch per
// kind of reminder, and the Home Screen steps iPhone needs first.

const KINDS: { id: NotifyKind; title: string; when: string; tone: string; icon: IconName }[] = [
  {
    id: "hw",
    title: "New homework",
    when: "As soon as Classroom posts it",
    tone: "green",
    icon: "bookClosed",
  },
  {
    id: "due",
    title: "Due tomorrow",
    when: "Evening reminder at 19:00",
    tone: "orange",
    icon: "clock",
  },
  {
    id: "lesson",
    title: "Lesson starting",
    when: "5 minutes before, with the room",
    tone: "blue",
    icon: "calendar",
  },
  {
    id: "tutor",
    title: "Tutoring",
    when: "15 minutes before, with the Meet link",
    tone: "pink",
    icon: "video",
  },
  {
    id: "brief",
    title: "Morning brief",
    when: "School days at 07:00",
    tone: "violet",
    icon: "sparkle",
  },
  {
    id: "quiet",
    title: "Quiet after 21:30",
    when: "Nothing until 07:00",
    tone: "yellow",
    icon: "moon",
  },
];

/**
 * What the More row says: the number of reminders on only once the browser
 * allows them; otherwise why nothing will arrive.
 */
export function alertsLabel(prefs: NotifyPrefs, perm: Permission): string {
  if (perm === "denied") {
    return "Blocked";
  }
  if (perm !== "granted") {
    return "Off";
  }
  return `${KINDS.filter((k) => prefs[k.id]).length} on`;
}

/** iPhone/iPad Safari outside the Home Screen: no notifications until it's added there. */
function needsHomeScreen(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  return ios && !standalone;
}

export function Notifications() {
  const { go, homework, toast } = useApp();
  const [prefs, setPrefs] = useState<NotifyPrefs>(notifyPrefs.get);
  const [perm, setPerm] = useState<Permission>(permission);
  // Switches only look on once the browser lets reminders through.
  const granted = perm === "granted";
  const next = (homework ?? [])
    .filter((h) => !h.done && h.due)
    .toSorted((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))[0];

  const toggle = (id: NotifyKind) => {
    if (!granted) {
      // Not allowed yet: the switch asks first, and turns on if allowed.
      void allow(id);
      return;
    }
    const p = { ...prefs, [id]: !prefs[id] };
    setPrefs(p);
    notifyPrefs.set(p);
  };
  const allow = async (turnOn?: NotifyKind) => {
    if (perm === "denied") {
      toast("Notifications are blocked. Turn them on in Settings › Notifications.");
      return;
    }
    if (perm === "unsupported" || needsHomeScreen()) {
      toast(
        perm === "unsupported"
          ? "This browser can't show notifications."
          : "Add the hub to your Home Screen first.",
      );
      return;
    }
    const got = await askPermission();
    setPerm(got);
    if (got === "granted") {
      if (turnOn && !prefs[turnOn]) {
        const p = { ...prefs, [turnOn]: true };
        setPrefs(p);
        notifyPrefs.set(p);
      }
      void show({
        id: `hello:${Date.now()}`,
        title: "Alerts are on",
        body: "You'll get reminders like this one.",
      });
    } else if (got === "denied") {
      toast("Notifications are blocked. Turn them on in Settings › Notifications.");
    }
  };

  return (
    <main className="screen notif">
      <header className="between rise">
        <button className="round" aria-label="Back to More" onClick={() => go("apps")}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <span className="muted s13" style={{ fontWeight: 700 }}>
          {alertsLabel(prefs, perm)}
        </span>
      </header>
      <h1 className="h1 rise d1" style={{ fontSize: 34 }}>
        Notifications
      </h1>

      <div className="notif-sample rise d1" aria-label="Example notification">
        <span className="appic">P</span>
        <div className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <div className="between">
            <span style={{ fontWeight: 800, fontSize: 14 }}>Due tomorrow</span>
            <span className="muted s12">19:00</span>
          </div>
          <span style={{ fontSize: 14, color: "var(--ink2)" }}>
            {next ? `${next.title}${next.course ? ` · ${next.course}` : ""}` : "Your homework"}. Tap
            to start.
          </span>
        </div>
      </div>

      <section className="card rows rise d2">
        {KINDS.map((k) => (
          <div key={k.id} className="nrow">
            <span className={`ic tone-${k.tone}`} aria-hidden="true">
              <Icon name={k.icon} size={18} />
            </span>
            <span className="stack" style={{ flex: 1, minWidth: 0, gap: 0 }}>
              <span style={{ fontWeight: 700 }}>{k.title}</span>
              <span className="muted s13">{k.when}</span>
            </span>
            <button
              className={granted && prefs[k.id] ? "sw on" : "sw"}
              role="switch"
              aria-checked={granted && prefs[k.id]}
              aria-label={k.title}
              onClick={() => toggle(k.id)}
            />
          </div>
        ))}
      </section>

      {needsHomeScreen() ? (
        <section className="card home-steps rise d3">
          <span className="h2" style={{ color: "var(--blue-t)" }}>
            On iPhone, add it to your Home Screen
          </span>
          <div className="steps">
            <span>
              <b>1</b>Open the hub in Safari, tap Share.
            </span>
            <span>
              <b>2</b>Tap Add to Home Screen, then open it from there.
            </span>
            <span>
              <b>3</b>Come back here and tap Allow.
            </span>
          </div>
        </section>
      ) : perm === "granted" ? (
        <p className="muted s13 rise d3" style={{ margin: 0, textAlign: "center" }}>
          Alerts are allowed on this device. They come while the hub is open or in the background.
        </p>
      ) : perm === "unsupported" ? (
        <p className="muted s13 rise d3" style={{ margin: 0, textAlign: "center" }}>
          This browser can't show notifications.
        </p>
      ) : perm === "denied" ? (
        <p className="card s13 rise d3" style={{ margin: 0, color: "var(--ink2)" }}>
          <b>Notifications are blocked for this site.</b> To get reminders, open your browser's site
          settings (the icon next to the address, or Settings › Notifications on iPhone), allow
          notifications for the hub, then come back here.
        </p>
      ) : (
        <button className="btn primary rise d3" onClick={() => void allow()}>
          <Icon name="bell" size={18} />
          Allow notifications
        </button>
      )}
    </main>
  );
}
