import type { Analysis, AnalyzeEvent, Settings } from "../../shared/types.ts";
import { DEFAULT_GEMINI_MODEL, geminiAnalyze } from "../../shared/gemini.ts";
import type { Photo } from "./analyze.ts";

/** Server side of the free Gemini option: key and model from the environment. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

export function analyzeWithGemini(
  photos: Photo[],
  settings: Settings,
  note: string | undefined,
  emit: (e: AnalyzeEvent) => void,
  visual?: string,
): Promise<Analysis> {
  return geminiAnalyze(
    { apiKey: process.env.GEMINI_API_KEY!, model: GEMINI_MODEL },
    photos.map((p) => ({ mediaType: p.mediaType, base64: p.data.toString("base64") })),
    settings,
    note,
    emit,
    visual,
  );
}
