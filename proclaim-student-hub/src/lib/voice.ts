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
  addEventListener(type: "end", fn: () => void): void;
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
export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

/** Listens once and resolves with what was said. */
export function listen(onPartial?: (text: string) => void): {
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
  rec.lang = "en-GB";
  rec.interimResults = true;
  let heard = "";
  const done = new Promise<string>((resolve, reject) => {
    rec.addEventListener("result", (e) => {
      heard = Array.from(e.results, (r) => r[0]?.transcript ?? "").join("");
      onPartial?.(heard);
    });
    rec.addEventListener("error", (e) => {
      reject(
        new Error(
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "The microphone isn't allowed here. Type instead, or use the full app."
            : e.error === "no-speech"
              ? "I didn't hear anything. Try again."
              : "Voice didn't work. Try again or type instead.",
        ),
      );
    });
    rec.addEventListener("end", () => resolve(heard.trim()));
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
