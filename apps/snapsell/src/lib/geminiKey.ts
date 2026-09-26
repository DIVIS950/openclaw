/** Finds a Gemini API key in a setup link (`…#gemini=KEY`) or in text pasted by the user. */
export function extractGeminiKey(text: string) {
  return /AIza[0-9A-Za-z_-]{30,}/.exec(decodeURIComponent(text))?.[0] ?? null;
}
