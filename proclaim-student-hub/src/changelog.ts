// What changed in each version, newest first. Shown in More › Change the app.
// Every version Claude builds from a request adds an entry here.

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    version: "1.1.0",
    date: "2026-10-14",
    title: "Level-up redesign and four new features",
    items: [
      "Change the app: write what you want, it goes straight to Claude, and the new version arrives by itself",
      "Plan my evening: tonight in time blocks around tutoring and dinner, with breaks",
      "Pack my bag: tomorrow's checklist from your timetable, homework, tests and teachers' notes",
      "Levels & badges: XP from homework, revision, focus and planning, with 15 badges to earn",
      "A smoother, glassier look: bigger Today hero, glass tab bar, softer cards, livelier motion",
      "The Revision Lab and the Tutor Hub got the new look too",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-12",
    title: "Version 1.0",
    items: [
      "Today, Homework, Tests, Revision Lab, Tutoring, Notes, Timetable and Inbox",
      "Classroom homework arrives every hour",
      "Bold colourful design",
    ],
  },
];
