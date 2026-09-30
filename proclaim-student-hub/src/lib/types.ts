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

/** Where a data source keeps things, in the words the screens show. */
export interface StorageLabels {
  /** Short status once work is saved, e.g. "Saved to Google Docs". */
  saved: string;
  /** Under "Your work": where it's kept. */
  workNote: string;
  /** Hand-in step for the saved work. */
  workStep: string;
  /** Hand-in step for ticking it off. */
  tickedStep: string;
  /** Toast after adding homework. */
  added: string;
  /** Toast after ticking homework off. */
  ticked: string;
  /** Subtitle of the Homework screen. */
  homeworkSub: string;
  /** Explains where added homework goes. */
  addNote: string;
  /** After sending an email reply. */
  sent: string;
}

/** Everything the screens need: Google (hosted), Claude page (web link) or Demo. */
export interface DataSource {
  readonly demo: boolean;
  readonly labels: StorageLabels;
  /** Whether the Classroom "Do it here" flow and calendar are available. */
  readonly hasClassroom: boolean;
  profile(): Promise<Profile>;
  homework(): Promise<Homework[]>;
  inbox(): Promise<Email[]>;
  /** Emails matching a Gmail search, where Gmail is connected. */
  searchEmails?(query: string): Promise<Email[]>;
  events(): Promise<CalEvent[]>;
  setDone(hw: Homework, done: boolean): Promise<void>;
  addHomework(input: {
    title: string;
    source: Source;
    due?: string;
    /** The class, when known (e.g. "9A Maths"); defaults to the source. */
    course?: string;
  }): Promise<Homework>;
  loadDraft(hw: Homework): Promise<Draft>;
  saveDraft(hw: Homework, text: string, fileId: string | null): Promise<Draft>;
  handIn(hw: Homework, fileId: string | null): Promise<HandInResult>;
  sendReply(email: Email, body: string): Promise<void>;
  saveNotes(title: string, text: string): Promise<string>;
}
