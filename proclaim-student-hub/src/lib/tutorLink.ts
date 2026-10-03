import {
  newId,
  todos,
  tutoring,
  type Tutor,
  type TutorMaterial,
  type TutorSession,
} from "./study.ts";
import { packJson, PAGES_URL, unpackJson } from "./transfer.ts";

// The student and their tutor swap links. Nothing goes through a server: the
// student sends the tutor a link that carries this tutor's lessons, materials
// and homework; the tutor opens it in the Tutor Hub, adds things, and sends a
// link back that the student's app reads and merges.

export const TUTOR_APP_URL = `${PAGES_URL}tutor.html`;
const TO_TUTOR = "#s=";
const FROM_TUTOR = "#tutor=";

export interface TutorHomework {
  id: string;
  text: string;
  /** YYYY-MM-DD or "". */
  due: string;
  done: boolean;
}

/** What the student sends the tutor. */
export interface TutorPacket {
  v: 1;
  kind: "to-tutor";
  student: string;
  tutor: Tutor;
  sessions: TutorSession[];
  materials: Omit<TutorMaterial, "photo">[];
  homework: TutorHomework[];
  /** The student's mastery in this subject (0-100), when the Lab knows it. */
  mastery: number | null;
  nextTest: { topic: string; date: string } | null;
  sentAt: string;
}

/** What the tutor sends back. */
export interface TutorReply {
  v: 1;
  kind: "from-tutor";
  tutorId: string;
  tutorName: string;
  sessions: TutorSession[];
  materials: Omit<TutorMaterial, "photo">[];
  homework: TutorHomework[];
  when: string;
  meet: string;
  message: string;
  sentAt: string;
}

export const fromLabel = (tutorName: string) => `Tutoring with ${tutorName}`;

/** The student's to-dos that came from this tutor. */
export function tutorHomework(tutor: Pick<Tutor, "name">): TutorHomework[] {
  return todos
    .all()
    .filter((t) => t.from === fromLabel(tutor.name))
    .map((t) => ({ id: t.id, text: t.text, due: t.due, done: t.done }));
}

export function buildPacket(
  tutor: Tutor,
  extras: { student: string; mastery: number | null; nextTest: TutorPacket["nextTest"] },
): TutorPacket {
  return {
    v: 1,
    kind: "to-tutor",
    student: extras.student,
    tutor,
    sessions: tutoring.sessions().filter((s) => s.tutorId === tutor.id),
    materials: tutoring
      .materials()
      .filter((m) => m.tutorId === tutor.id)
      .map(({ photo: _photo, ...m }) => m),
    homework: tutorHomework(tutor),
    mastery: extras.mastery,
    nextTest: extras.nextTest,
    sentAt: new Date().toISOString(),
  };
}

export async function packetLink(packet: TutorPacket): Promise<string> {
  return `${TUTOR_APP_URL}${TO_TUTOR}${await packJson(packet)}`;
}

export async function replyLink(reply: TutorReply): Promise<string> {
  return `${PAGES_URL}${FROM_TUTOR}${await packJson(reply)}`;
}

export async function readPacketFromLocation(): Promise<TutorPacket | null> {
  const hash = window.location.hash;
  if (!hash.startsWith(TO_TUTOR)) {
    return null;
  }
  const p = await unpackJson<TutorPacket>(hash.slice(TO_TUTOR.length));
  return p?.v === 1 && p.kind === "to-tutor" && p.tutor?.id ? p : null;
}

export interface Applied {
  tutorName: string;
  sessions: number;
  materials: number;
  homework: number;
  message: string;
}

/** Merges a tutor's reply into the student's data; new things only, by id. */
export function applyReply(reply: TutorReply, today: string): Applied {
  const tutors = tutoring.tutors();
  const tutor = tutors.find((t) => t.id === reply.tutorId);
  if (tutor && (reply.when !== tutor.when || reply.meet !== tutor.meet)) {
    tutoring.saveTutors(
      tutors.map((t) =>
        t.id === tutor.id ? { ...t, when: reply.when || t.when, meet: reply.meet || t.meet } : t,
      ),
    );
  }
  const name = tutor?.name ?? reply.tutorName;
  const sessions = tutoring.sessions();
  const newSessions = reply.sessions.filter(
    (s) => s.tutorId === reply.tutorId && !sessions.some((x) => x.id === s.id),
  );
  if (newSessions.length > 0) {
    tutoring.saveSessions([...sessions, ...newSessions]);
  }
  const materials = tutoring.materials();
  const newMaterials = reply.materials
    .filter((m) => m.tutorId === reply.tutorId && !materials.some((x) => x.id === m.id))
    .map((m) => ({ ...m, photo: "" }));
  if (newMaterials.length > 0) {
    tutoring.saveMaterials([...materials, ...newMaterials]);
  }
  const list = todos.all();
  let homework = 0;
  for (const h of reply.homework) {
    const dupe = list.some(
      (t) => t.id === h.id || (t.from === fromLabel(name) && t.text === h.text && t.due === h.due),
    );
    if (!dupe && h.text.trim()) {
      list.push({
        id: h.id || newId("t"),
        text: h.text.trim(),
        due: h.due && h.due >= today ? h.due : h.due || "",
        done: false,
        subject: tutor?.subject ?? "",
        from: fromLabel(name),
      });
      homework++;
    }
  }
  if (homework > 0) {
    todos.save(list);
  }
  return {
    tutorName: name,
    sessions: newSessions.length,
    materials: newMaterials.length,
    homework,
    message: reply.message ?? "",
  };
}

/** On the student's app: a reply in the address gets merged and the address cleaned. */
export async function importReplyFromLocation(today: string): Promise<Applied | null> {
  const hash = window.location.hash;
  if (!hash.startsWith(FROM_TUTOR)) {
    return null;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  const r = await unpackJson<TutorReply>(hash.slice(FROM_TUTOR.length));
  return r?.v === 1 && r.kind === "from-tutor" && r.tutorId ? applyReply(r, today) : null;
}

/** Message for the toast after a reply came in. */
export function appliedSummary(a: Applied): string {
  const parts = [
    a.homework ? `${a.homework} homework` : "",
    a.sessions ? `${a.sessions} lesson ${a.sessions === 1 ? "note" : "notes"}` : "",
    a.materials ? `${a.materials} ${a.materials === 1 ? "material" : "materials"}` : "",
  ].filter(Boolean);
  const what = parts.length ? parts.join(", ") : "nothing new";
  return `From ${a.tutorName}: ${what}.${a.message ? ` "${a.message}"` : ""}`;
}

/** The tutor's own copy, so the Tutor Hub remembers between visits. */
export const tutorStore = {
  key: (tutorId: string, student: string) => `tutorhub.${tutorId}.${student.toLowerCase()}`,
  get(tutorId: string, student: string): TutorPacket | null {
    try {
      return JSON.parse(localStorage.getItem(tutorStore.key(tutorId, student)) ?? "null");
    } catch {
      return null;
    }
  },
  set(p: TutorPacket) {
    try {
      localStorage.setItem(tutorStore.key(p.tutor.id, p.student), JSON.stringify(p));
    } catch {
      // Not remembered.
    }
  },
  all(): TutorPacket[] {
    const out: TutorPacket[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("tutorhub.")) {
          out.push(JSON.parse(localStorage.getItem(k) ?? "null"));
        }
      }
    } catch {
      // Nothing saved.
    }
    return out.filter(Boolean);
  },
};

/** Merges a fresh packet from the student into the tutor's saved copy (student data wins for done flags). */
export function mergePacket(saved: TutorPacket | null, fresh: TutorPacket): TutorPacket {
  if (!saved) {
    return fresh;
  }
  const byId = <T extends { id: string }>(a: T[], b: T[]) => {
    const ids = new Set(b.map((x) => x.id));
    return [...b, ...a.filter((x) => !ids.has(x.id))];
  };
  return {
    ...fresh,
    sessions: byId(saved.sessions, fresh.sessions),
    materials: byId(saved.materials, fresh.materials),
    homework: byId(saved.homework, fresh.homework),
  };
}
