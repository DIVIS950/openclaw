import { ArrowUp, Mic, Square, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AssistantTurn } from "../../shared/assistant.ts";
import type { Listing } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { canListen, listen, speak, stopSpeaking, unlockSpeech } from "../lib/speech.ts";
import { Sheet, cx } from "./ui.tsx";

const LANG = "cs-CZ";
const SUGGESTIONS = ["Jaká je dobrá cena?", "Zkrať popis", "Dej cenu o 10 % níž", "Jak rychle se to prodá?"];
const CHANGE_LABEL: Record<string, string> = { title: "název", description: "popis", addToDescription: "popis", price: "cena", condition: "stav" };

type Msg = AssistantTurn & { changed?: string[]; error?: boolean };

/** Voice assistant for one listing: speak (or type) in Czech, it answers aloud and can edit the listing. */
export function VoiceAssistant({ open, onClose, listing, onChange }: { open: boolean; onClose: () => void; listing: Listing; onChange: (l: Listing) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [heard, setHeard] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const stop = useRef<(() => void) | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, heard, thinking]);
  useEffect(() => {
    if (!open) {
      stop.current?.();
      stopSpeaking();
    }
  }, [open]);

  const ask = async (text: string) => {
    text = text.trim();
    if (!text || thinking) return;
    const history = msgs.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setThinking(true);
    try {
      const r = await api.assistant(listing.id, text, history);
      const changed = Object.keys(r.changes ?? {});
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, changed }]);
      if (changed.length) onChange(r.listing);
      if (voiceOn) speak(r.reply, LANG);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setThinking(false);
    }
  };

  const mic = () => {
    if (listening) return stop.current?.();
    unlockSpeech();
    stopSpeaking();
    setHeard("");
    setListening(true);
    stop.current = listen(LANG, setHeard, (text, error) => {
      setListening(false);
      setHeard("");
      if (text) void ask(text);
      else if (error) setMsgs((m) => [...m, { role: "assistant", text: "Mikrofon teď nejde. Povolte ho v nastavení Safari, nebo napište dotaz.", error: true }]);
    });
  };

  const send = () => {
    unlockSpeech();
    void ask(typed);
    setTyped("");
  };

  return (
    <Sheet open={open} onClose={onClose} title="Asistent" subtitle="Zeptejte se nebo řekněte, co změnit">
      <div className="flex min-h-[46dvh] flex-col">
        <div className="flex-1 space-y-2.5">
          {msgs.length === 0 && (
            <div className="rounded-3xl border border-line bg-card p-4 text-[15px] leading-relaxed text-muted">
              Klepněte na mikrofon a mluvte česky. Například: <span className="text-ink">„Dej cenu na 3 500“</span>,{" "}
              <span className="text-ink">„Přidej do popisu, že je tam i nabíječka“</span> nebo <span className="text-ink">„Za kolik se to prodá?“</span>
            </div>
          )}
          <AnimatePresence initial={false}>
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cx(
                    "max-w-[82%] rounded-[20px] px-3.5 py-2 text-[16px] leading-snug",
                    m.role === "user" ? "rounded-br-[6px] bg-ink text-paper" : m.error ? "rounded-bl-[6px] bg-bad-soft text-bad" : "rounded-bl-[6px] border border-line bg-card",
                  )}
                >
                  {m.text}
                  {!!m.changed?.length && (
                    <div className="mt-1.5 text-[12px] font-semibold text-ok">✓ Změněno: {m.changed.map((c) => CHANGE_LABEL[c] ?? c).join(", ")}</div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {heard && (
            <div className="flex justify-end">
              <div className="max-w-[82%] rounded-[20px] rounded-br-[6px] bg-ink/60 px-3.5 py-2 text-[16px] text-paper">{heard}…</div>
            </div>
          )}
          {thinking && (
            <div className="flex">
              <div className="flex gap-1 rounded-[20px] rounded-bl-[6px] bg-card px-4 py-3" aria-label="Přemýšlím">
                {[0, 1, 2].map((d) => (
                  <motion.span
                    key={d}
                    className="size-2 rounded-full bg-faint"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: d * 0.18 }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={end} />
        </div>

        {msgs.length === 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => (unlockSpeech(), void ask(s))} className="h-9 shrink-0 rounded-full border-[1.5px] border-line-strong bg-card px-3.5 text-[14px] font-semibold">
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col items-center">
          {canListen && (
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={mic}
              disabled={thinking}
              aria-label={listening ? "Zastavit" : "Mluvit"}
              className={cx(
                "relative grid size-[72px] place-items-center rounded-full shadow-[0_14px_30px_-12px_rgba(194,65,12,0.65)] disabled:opacity-50",
                listening ? "bg-ink text-paper" : "bg-accent text-ink",
              )}
            >
              {listening && <motion.span className="absolute inset-0 rounded-full bg-ink" animate={{ scale: [1, 1.35], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}
              {listening ? <Square className="relative size-6 fill-paper" /> : <Mic className="relative size-8" />}
            </motion.button>
          )}
          <div className="mt-2 text-[13px] text-muted">{listening ? "Poslouchám…" : canListen ? "Klepněte a mluvte" : "Napište dotaz (nebo použijte diktování na klávesnici)"}</div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => (voiceOn ? (stopSpeaking(), setVoiceOn(false)) : setVoiceOn(true))}
            aria-label={voiceOn ? "Vypnout hlas" : "Zapnout hlas"}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-card"
          >
            {voiceOn ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          <div className="flex h-11 flex-1 items-center rounded-full border-[1.5px] border-line bg-card pl-4 pr-1">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Napište zprávu"
              aria-label="Zpráva pro asistenta"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            <button onClick={send} disabled={!typed.trim() || thinking} aria-label="Odeslat" className="grid size-9 place-items-center rounded-full bg-accent text-ink disabled:bg-line-strong">
              <ArrowUp className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
