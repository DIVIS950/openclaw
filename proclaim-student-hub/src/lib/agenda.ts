import { newId } from "./study.ts";

// One-off calendar events the student adds (trips, deadlines, matches, forms
// to bring). Weekly lessons live in the timetable instead. Kept on this device.

export interface AgendaEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, or "" for all day. */
  time: string;
  subject: string;
  details: string;
}

const KEY = "psh.events";

function read(): AgendaEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AgendaEvent[]) : [];
  } catch {
    return [];
  }
}

export const agenda = {
  all: read,
  save(list: AgendaEvent[]): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  },
  add(fields: Omit<AgendaEvent, "id">): AgendaEvent {
    const event = { ...fields, id: newId("e") };
    agenda.save([...read(), event]);
    return event;
  },
  remove(id: string) {
    agenda.save(read().filter((e) => e.id !== id));
  },
};

/** Events from today up to `days` ahead, soonest first. */
export function upcomingEvents(list: AgendaEvent[], today: string, days = 7): AgendaEvent[] {
  const end = new Date(`${today}T12:00:00`);
  end.setDate(end.getDate() + days);
  const last = end.toISOString().slice(0, 10);
  return list
    .filter((e) => e.date >= today && e.date <= last)
    .toSorted((a, b) => `${a.date} ${a.time || "99"}`.localeCompare(`${b.date} ${b.time || "99"}`));
}
