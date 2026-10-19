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
    version: "1.2.1",
    date: "2026-10-19",
    title: "Everything syncs in the Claude app",
    items: [
      "Notes, to-dos, tests, timetable, levels and revision packs now sync between your phone, iPad and computer in the Claude app",
      "No setup: it goes through your Claude account and syncs by itself when you open the app",
      "More › Sync my devices shows when it last synced, with a Sync now button",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-18",
    title: "Fuller iPad side bar, search, sync and late warnings",
    items: [
      "iPad side bar: Search, Timetable, Tests, Revise, Tutoring, Notes, Inbox, Evening, Bag and Reminders, one tap away",
      "Search everything: homework, tests, notes, revision cards, to-dos and lessons (Ctrl/⌘K on a keyboard)",
      "Drag a photo, screenshot or text onto the app and the AI files it",
      "Weekend mode: on Saturday and Sunday, Today shows what's due Monday",
      "Late homework shows in red at the top of Today and Homework, with a number on the Homework button",
      "Sync my devices (website): the same data on phone and iPad, through your own Google Drive",
    ],
  },
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
