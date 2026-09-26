const DAY = 24 * 3600 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Overdue", "Today", "Tomorrow", "Wed", or "12 Oct". */
export function dueLabel(iso: string | undefined, now = new Date()): string {
  if (!iso) {
    return "No due date";
  }
  const due = new Date(iso);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days < 0) {
    return "Overdue";
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  if (days < 7) {
    return due.toLocaleDateString("en-GB", { weekday: "short" });
  }
  return due.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function isUrgent(iso: string | undefined, now = new Date()): boolean {
  if (!iso) {
    return false;
  }
  return startOfDay(new Date(iso)) - startOfDay(now) <= DAY;
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (startOfDay(d) === startOfDay(now)) {
    return timeLabel(iso);
  }
  if (startOfDay(now) - startOfDay(d) === DAY) {
    return "Yesterday";
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
