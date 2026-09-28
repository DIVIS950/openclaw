// Talking to the AI: speech-to-text for questions and text-to-speech for
// answers, using the browser's built-in speech features. Some browsers and
// embedded pages don't allow the microphone, so every call can fail and the
// UI treats voice as a bonus.

interface Recognition {
  lang: string;
  interimResults: boolean;
  addEventListener(
    type: "result",
    fn: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void,
  ): void;
  addEventListener(type: "error", fn: (e: { error: string }) => void): void;
  addEventListener(type: "end" | "start" | "audiostart", fn: () => void): void;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = (): boolean => recognitionCtor() !== null;

/** The page isn't allowed to use the microphone (e.g. Safari, inside claude.ai). */
export class MicBlockedError extends Error {}
export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

/** Listens once and resolves with what was said. */
export function listen(
  onPartial?: (text: string) => void,
  lang = "en-GB",
): {
  done: Promise<string>;
  stop: () => void;
} {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    return {
      done: Promise.reject(new Error("Voice isn't supported in this browser.")),
      stop: () => {},
    };
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  let heard = "";
  const done = new Promise<string>((resolve, reject) => {
    rec.addEventListener("result", (e) => {
      heard = Array.from(e.results, (r) => r[0]?.transcript ?? "").join("");
      onPartial?.(heard);
    });
    rec.addEventListener("error", (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        reject(
          new MicBlockedError(
            "The microphone is blocked here. Tap the text box and use the 🎤 on your keyboard instead.",
          ),
        );
        return;
      }
      reject(
        new Error(
          e.error === "no-speech"
            ? "I didn't hear anything. Try again."
            : "Voice didn't work. Try again or type instead.",
        ),
      );
    });
    // Inside some embedded pages the microphone never starts and no error
    // comes either; treat that silence as a blocked microphone.
    let started = false;
    const markStarted = () => {
      started = true;
    };
    rec.addEventListener("start", markStarted);
    rec.addEventListener("audiostart", markStarted);
    const watchdog = window.setTimeout(() => {
      if (!started) {
        reject(new MicBlockedError("The microphone didn't start here."));
        try {
          rec.stop();
        } catch {
          // Already stopped.
        }
      }
    }, 4000);
    rec.addEventListener("end", () => {
      window.clearTimeout(watchdog);
      resolve(heard.trim());
    });
  });
  try {
    rec.start();
  } catch {
    return { done: Promise.reject(new Error("Voice didn't start. Try again.")), stop: () => {} };
  }
  return { done, stop: () => rec.stop() };
}

export function speak(text: string) {
  if (!canSpeak()) {
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
  u.lang = "en-GB";
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
}

/** Speaks and resolves when finished (or straight away where speech isn't available). */
export function say(text: string, lang = "en-GB"): Promise<void> {
  if (!canSpeak()) {
    return Promise.resolve();
  }
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
    u.lang = lang;
    // Some browsers never fire "end" on long speech, so don't wait forever.
    const words = text.split(/\s+/).length;
    const fallback = window.setTimeout(resolve, 4000 + words * 600);
    const finish = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    u.addEventListener("end", finish);
    u.addEventListener("error", finish);
    window.speechSynthesis.speak(u);
  });
}

/**
 * iPhones only let a page speak if speech first starts from a tap. Call this
 * inside the tap handler; later answers (after the AI replies) can then speak.
 */
export function unlockSpeech() {
  if (!canSpeak()) {
    return;
  }
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}
