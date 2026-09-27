/**
 * Voice in and out, built into the browser (nothing extra to install):
 * speech recognition where the browser has it (Safari, Chrome), and speech synthesis for replies.
 */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const RecognitionCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;

export const canListen = Boolean(RecognitionCtor);
export const canSpeak = typeof speechSynthesis !== "undefined";

/**
 * Listens once: calls onText with the words so far, and onDone with the final sentence when the
 * speaker stops (or null when nothing was heard). Returns a function that stops listening early.
 */
export function listen(lang: string, onText: (text: string) => void, onDone: (text: string | null, error?: string) => void) {
  const r = new RecognitionCtor!();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  let text = "";
  let error: string | undefined;
  r.onresult = (e) => {
    text = Array.from(e.results)
      .map((res) => res[0].transcript)
      .join(" ")
      .trim();
    onText(text);
  };
  r.onerror = (e) => {
    error = e.error;
  };
  r.onend = () => onDone(text || null, error === "no-speech" || error === "aborted" ? undefined : error);
  r.start();
  return () => r.stop();
}

/** iPhones only allow speech after a tap: call this inside the tap, before the reply arrives. */
export function unlockSpeech() {
  if (!canSpeak) return;
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  speechSynthesis.speak(u);
}

export function speak(text: string, lang: string) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  // Prefer a real voice for the language (iPhones ship Czech voices such as "Zuzana").
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  if (voice) u.voice = voice;
  u.rate = 1.02;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}
