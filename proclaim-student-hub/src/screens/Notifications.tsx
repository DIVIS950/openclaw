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
  const onCount = KINDS.filter((k) => prefs[k.id]).length;
  const next = (homework ?? [])
    .filter((h) => !h.done && h.due)
    .toSorted((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))[0];

  const toggle = (id: NotifyKind) => {
    const p = { ...prefs, [id]: !prefs[id] };
    setPrefs(p);
    notifyPrefs.set(p);
  };
  const allow = async () => {
    const got = await askPermission();
    setPerm(got);
    if (got === "granted") {
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
          {onCount} on
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
              className={prefs[k.id] ? "sw on" : "sw"}
              role="switch"
              aria-checked={prefs[k.id]}
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
      ) : (
        <button className="btn primary rise d3" onClick={() => void allow()}>
          <Icon name="bell" size={18} />
          {perm === "denied" ? "Blocked in Settings" : "Allow notifications"}
        </button>
      )}
    </main>
  );
}
