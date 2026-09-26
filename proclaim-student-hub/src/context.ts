import { createContext, useContext } from "react";
import type { TutorMode } from "../shared/api.ts";
import type { DataSource, Homework, Profile } from "./lib/types.ts";

export type Screen =
  | "today"
  | "homework"
  | "assignment"
  | "tutor"
  | "revise"
  | "games"
  | "inbox"
  | "apps";

export const SCREENS: Screen[] = [
  "today",
  "homework",
  "assignment",
  "tutor",
  "revise",
  "games",
  "inbox",
  "apps",
];

export interface TutorSeed {
  text: string;
  mode: TutorMode;
  /** Changes on every request so the tutor knows it's a new one. */
  key: number;
}

export interface AppContext {
  data: DataSource;
  /** Google token for the AI server; throws when the AI can't be used. */
  aiToken: () => string;
  canUseAi: boolean;
  profile: Profile | null;
  homework: Homework[] | null;
  reloadHomework: () => void;
  replaceHomework: (hw: Homework) => void;
  addHomeworkItem: (hw: Homework) => void;
  screen: Screen;
  go: (screen: Screen) => void;
  assignment: Homework | null;
  openAssignment: (hw: Homework) => void;
  tutorSeed: TutorSeed | null;
  askTutor: (text: string, mode?: TutorMode) => void;
  handleError: (err: unknown) => void;
  toast: (message: string) => void;
  signOut: () => void;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useApp must be used inside the app");
  }
  return ctx;
}
