import { createContext, useContext, useEffect } from "react";
import type { ImageInput, TutorMode } from "../shared/api.ts";
import type { AiProvider } from "./lib/ai.ts";
import type { DataSource, Homework, Profile } from "./lib/types.ts";

export type Screen =
  | "today"
  | "homework"
  | "assignment"
  | "tutor"
  | "revise"
  | "games"
  | "inbox"
  | "apps"
  | "timetable"
  | "classes"
  | "call"
  | "todo"
  | "tests"
  | "notes"
  | "tutoring";

export const SCREENS: Screen[] = [
  "today",
  "homework",
  "assignment",
  "tutor",
  "revise",
  "games",
  "inbox",
  "apps",
  "timetable",
  "classes",
  "call",
  "todo",
  "tests",
  "notes",
  "tutoring",
];

export interface TutorSeed {
  text: string;
  mode: TutorMode;
  /** Photos to send with the request (e.g. answers to check). */
  images?: ImageInput[];
  /** Changes on every request so the tutor knows it's a new one. */
  key: number;
}

export interface AppContext {
  data: DataSource;
  /** The AI features, or null where Claude can't be reached. */
  ai: AiProvider | null;
  profile: Profile | null;
  homework: Homework[] | null;
  /** `force` checks Classroom emails again even if it just did. */
  reloadHomework: (force?: boolean) => void;
  replaceHomework: (hw: Homework) => void;
  addHomeworkItem: (hw: Homework) => void;
  screen: Screen;
  go: (screen: Screen) => void;
  assignment: Homework | null;
  openAssignment: (hw: Homework) => void;
  tutorSeed: TutorSeed | null;
  askTutor: (text: string, mode?: TutorMode, images?: ImageInput[]) => void;
  /** Opens the AI helper over the current screen. */
  openAi: (request?: { question?: string; context?: string }) => void;
  /** Screens describe what's on them so the AI helper knows what "this" means. */
  aiContext: string;
  setAiContext: (context: string) => void;
  handleError: (err: unknown) => void;
  toast: (message: string) => void;
  /** Null on the web link, which has no separate sign-in. */
  signOut: (() => void) | null;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useApp must be used inside the app");
  }
  return ctx;
}

/** Tells the AI helper what this screen shows, while it's open. */
export function useAiContext(context: string) {
  const { setAiContext } = useApp();
  useEffect(() => {
    setAiContext(context);
    return () => setAiContext("");
  }, [context, setAiContext]);
}
