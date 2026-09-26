export type Source = "Classroom" | "Dr Frost" | "Desmos" | "ActiveLearn" | "Canva" | "Other";

export const OTHER_SOURCES: Source[] = ["Dr Frost", "Desmos", "ActiveLearn", "Canva", "Other"];

export const SOURCE_LINKS: Record<Source, string> = {
  Classroom: "https://classroom.google.com",
  "Dr Frost": "https://www.drfrost.org",
  Desmos: "https://student.desmos.com",
  ActiveLearn: "https://www.pearsonactivelearn.com",
  Canva: "https://www.canva.com",
  Other: "https://classroom.google.com",
};

export interface Homework {
  /** Classroom courseWork id, or Google Tasks task id for other apps. */
  id: string;
  source: Source;
  title: string;
  course: string;
  description: string;
  /** ISO date-time, if the work has a due date. */
  due?: string;
  link: string;
  done: boolean;
  courseId?: string;
  submissionId?: string;
}

export interface Email {
  id: string;
  kind: "Gmail" | "Classroom";
  threadId?: string;
  from: string;
  fromEmail?: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  messageId?: string;
  link?: string;
}

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  location?: string;
}

export interface Profile {
  name: string;
  email: string;
}

export interface Draft {
  text: string;
  fileId: string | null;
  link: string | null;
}

export type HandInResult = "turnedIn" | "openClassroom";

/** Everything the screens need. Implemented by Google (real) and Demo (sample data). */
export interface DataSource {
  readonly demo: boolean;
  profile(): Promise<Profile>;
  homework(): Promise<Homework[]>;
  inbox(): Promise<Email[]>;
  events(): Promise<CalEvent[]>;
  setDone(hw: Homework, done: boolean): Promise<void>;
  addHomework(input: { title: string; source: Source; due?: string }): Promise<Homework>;
  loadDraft(hw: Homework): Promise<Draft>;
  saveDraft(hw: Homework, text: string, fileId: string | null): Promise<Draft>;
  handIn(hw: Homework, fileId: string | null): Promise<HandInResult>;
  sendReply(email: Email, body: string): Promise<void>;
  saveNotes(title: string, text: string): Promise<string>;
}
