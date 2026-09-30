import type {
  CalEvent,
  DataSource,
  Draft,
  Email,
  HandInResult,
  Homework,
  Profile,
  Source,
} from "./types.ts";
import { SOURCE_LINKS } from "./types.ts";

// Sample data so the app can be explored before connecting a Google account.
// Nothing here is sent anywhere.

const day = 24 * 3600 * 1000;
const at = (days: number, hour = 16) => {
  const d = new Date(Date.now() + days * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DemoData implements DataSource {
  readonly demo = true;
  readonly hasClassroom = true;
  readonly labels = {
    saved: "Saved (demo)",
    workNote: "Demo: not saved to Google",
    workStep: "Work saved (demo only)",
    tickedStep: "Ticked off (demo only)",
    added: "Added (demo).",
    ticked: "Ticked off (demo).",
    homeworkSub: "Everything in one list (sample data).",
    addNote: "For apps like Dr Frost that can't share homework automatically.",
    sent: "Sent (demo).",
  };

  private work: Homework[] = [
    {
      id: "d1",
      source: "Dr Frost",
      title: "Linear equations, Task 12",
      course: "Maths",
      description: "",
      due: at(1),
      link: SOURCE_LINKS["Dr Frost"],
      done: false,
    },
    {
      id: "d2",
      source: "Classroom",
      title: "Macbeth Act 2: character essay",
      course: "English",
      description: "Write about how Macbeth changes in Act 2. Use at least two quotes.",
      due: at(3),
      link: SOURCE_LINKS.Classroom,
      done: false,
    },
    {
      id: "d3",
      source: "Desmos",
      title: "Graphing straight lines",
      course: "Maths",
      description: "",
      due: at(4),
      link: SOURCE_LINKS.Desmos,
      done: false,
    },
    {
      id: "d4",
      source: "Classroom",
      title: "Photosynthesis worksheet",
      course: "Science",
      description: "Answer questions 1-6 on the worksheet.",
      due: at(5),
      link: SOURCE_LINKS.Classroom,
      done: false,
    },
    {
      id: "d5",
      source: "Canva",
      title: "Poster design brief",
      course: "Art",
      description: "",
      due: at(8),
      link: SOURCE_LINKS.Canva,
      done: false,
    },
    {
      id: "d6",
      source: "ActiveLearn",
      title: "Vocab practice set",
      course: "Languages",
      description: "",
      due: at(9),
      link: SOURCE_LINKS.ActiveLearn,
      done: false,
    },
  ];

  private drafts = new Map<string, string>([
    [
      "d2",
      "In Act 2, Macbeth changes from a nervous man into a killer. Before the murder he sees a dagger and asks, “Is this a dagger which I see before me?”",
    ],
  ]);

  async profile(): Promise<Profile> {
    return { name: "", email: "demo" };
  }

  async homework(): Promise<Homework[]> {
    await wait(300);
    return this.work.map((w) => ({ ...w }));
  }

  async inbox(): Promise<Email[]> {
    await wait(300);
    return [
      {
        id: "e1",
        kind: "Classroom",
        from: "English",
        subject: "New assignment: Macbeth essay",
        snippet: "Essay on Act 2 is due Wednesday. The rubric is attached.",
        date: at(0, 8),
        unread: true,
        link: SOURCE_LINKS.Classroom,
      },
      {
        id: "e2",
        kind: "Gmail",
        from: "Form tutor",
        fromEmail: "tutor@example.com",
        subject: "Trip consent form",
        snippet: "Please ask a parent to sign the consent form and hand it in by Friday.",
        date: at(-1, 15),
        unread: true,
      },
      {
        id: "e3",
        kind: "Gmail",
        from: "Maths teacher",
        fromEmail: "maths@example.com",
        subject: "Dr Frost task reminder",
        snippet: "Just a reminder that Task 12 on linear equations is due tomorrow.",
        date: at(-1, 12),
        unread: false,
      },
    ];
  }

  async events(): Promise<CalEvent[]> {
    return [
      { id: "c1", title: "Maths", start: at(1, 9) },
      { id: "c2", title: "English", start: at(1, 10) },
      { id: "c3", title: "Science", start: at(1, 11) },
    ];
  }

  async setDone(hw: Homework, done: boolean): Promise<void> {
    await wait(200);
    const item = this.work.find((w) => w.id === hw.id);
    if (item) {
      item.done = done;
    }
  }

  async addHomework(input: {
    title: string;
    source: Source;
    due?: string;
    course?: string;
  }): Promise<Homework> {
    const hw: Homework = {
      id: `d${Date.now()}`,
      source: input.source,
      title: input.title,
      course: input.course || input.source,
      description: "",
      due: input.due ? new Date(`${input.due}T16:00:00`).toISOString() : undefined,
      link: SOURCE_LINKS[input.source],
      done: false,
    };
    this.work.push(hw);
    return hw;
  }

  async loadDraft(hw: Homework): Promise<Draft> {
    await wait(250);
    return {
      text: this.drafts.get(hw.id) ?? "",
      fileId: this.drafts.has(hw.id) ? `demo-${hw.id}` : null,
      link: null,
    };
  }

  async saveDraft(hw: Homework, text: string): Promise<Draft> {
    await wait(400);
    this.drafts.set(hw.id, text);
    return { text, fileId: `demo-${hw.id}`, link: null };
  }

  async handIn(hw: Homework): Promise<HandInResult> {
    await this.setDone(hw, true);
    return "openClassroom";
  }

  async sendReply(): Promise<void> {
    await wait(500);
  }

  async saveNotes(): Promise<string> {
    await wait(400);
    return "";
  }
}
