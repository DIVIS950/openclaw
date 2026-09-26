// Request/response shapes shared by the browser app and the server.

export type TutorMode = "explain" | "check" | "quiz" | "summary";

export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** Base64 without the data: prefix. */
  data: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  images?: ImageInput[];
}

export interface TutorRequest {
  mode: TutorMode;
  history: ChatTurn[];
}

export interface BriefRequest {
  name: string;
  homework: { title: string; course: string; due?: string }[];
  emails: { from: string; subject: string }[];
  events: { title: string; start: string }[];
}

export interface BriefResponse {
  brief: string;
}

export interface InboxSummaryRequest {
  emails: { id: string; from: string; subject: string; snippet: string }[];
}

export interface InboxSummaryResponse {
  summaries: { id: string; summary: string }[];
}

export interface ReviseRequest {
  images: ImageInput[];
  text: string;
}

export interface AppConfig {
  googleClientId: string;
  aiEnabled: boolean;
}
