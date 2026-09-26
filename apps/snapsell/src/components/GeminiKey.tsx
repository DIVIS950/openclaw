import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useApp } from "../App.tsx";
import { api } from "../lib/api.ts";
import { Button } from "./ui.tsx";

/** No-server version: paste the free Gemini key once; it's saved only on this device. */
export function GeminiKeyField({ onSaved }: { onSaved?: () => void }) {
  const app = useApp();
  const [key, setKey] = useState(app.settings.geminiApiKey ?? "");
  const [saved, setSaved] = useState(false);
  const save = async () => {
    app.setSettings(await api.saveSettings({ geminiApiKey: key.trim() }));
    await app.refreshHealth();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved?.();
  };
  return <KeyInput value={key} onChange={setKey} onSave={save} saved={saved} />;
}

export function KeyInput({ value, onChange, onSave, saved }: { value: string; onChange: (v: string) => void; onSave: () => void; saved?: boolean }) {
  return (
    <div>
      <p className="text-sm text-muted">
        Free, no card: open{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-ink underline">
          Google AI Studio <ExternalLink className="size-3" />
        </a>
        , sign in with your Google account and tap <b className="text-ink">Create API key</b>. It stays on this device.
      </p>
      <div className="mt-2.5 flex gap-2">
        <label htmlFor="gemini-key" className="sr-only">
          Gemini API key
        </label>
        <input
          id="gemini-key"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your Gemini key"
          autoComplete="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-[#faf8f3] px-3 font-mono text-sm focus:border-ink focus:outline-none"
        />
        <Button className="h-12" onClick={onSave} disabled={!value.trim()}>
          {saved ? <Check className="size-4" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
