import { Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Logo, cx } from "../components/ui.tsx";
import { api, copyText, type SetupStatus } from "../lib/api.ts";

/**
 * Setup checklist: what's configured on the server, and exactly what to paste where for the rest.
 * Shown instead of the app while a cloud install is still locked; also reachable at #/setup.
 */
export function SetupChecklist({ onBack }: { onBack?: () => void }) {
  const [s, setS] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setS(await api.setup());
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  if (!s) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const env = s.cloud ? "Render → your snapsell service → Environment" : "the .env file in apps/snapsell";
  const doneCount = [s.storage.ok || !s.storage.required, s.ai.gemini || s.ai.claude, s.google.ok].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-lg px-5 pb-16 pt-[max(40px,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <Logo size={36} />
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
      </div>
      <h1 className="mt-7 font-display text-[34px] font-bold leading-tight">Finish setting up</h1>
      <p className="mt-2 text-muted">
        {doneCount} of 3 done. Each step is a free account. Paste the values into <b className="text-ink">{env}</b>
        {s.cloud ? "; Render restarts SnapSell by itself in about a minute." : ", then restart SnapSell."}
      </p>

      <ol className="mt-6 space-y-3">
        {s.cloud && (
          <Step n={1} done={s.storage.ok} title="Storage for your listings and photos" note="Supabase free plan, no card">
            <Steps>
              <li>
                Open <Ext href="https://supabase.com/dashboard/new/new-project">supabase.com</Ext>, sign in with GitHub or Google and
                create a project (any name, free plan).
              </li>
              <li>
                In the project go to <b>Project Settings → API Keys</b> (or <b>Data API</b>) and copy the Project URL and the
                <b> service_role</b> secret key.
              </li>
            </Steps>
            <Vars names={["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]} />
            {s.storage.configured && s.storage.error && <p className="mt-2 text-[13px] text-bad">Supabase says: {s.storage.error}</p>}
          </Step>
        )}

        <Step n={s.cloud ? 2 : 1} done={s.ai.gemini || s.ai.claude} title="AI that recognizes and prices your items" note="Google Gemini free plan, no card">
          <Steps>
            <li>
              Open <Ext href="https://aistudio.google.com/apikey">Google AI Studio</Ext>, sign in with Google and click{" "}
              <b>Create API key</b>.
            </li>
          </Steps>
          <Vars names={["GEMINI_API_KEY"]} />
          <p className="mt-2 text-[13px] text-muted">
            Optional, paid per item: a Claude key from <Ext href="https://console.anthropic.com/settings/keys">console.anthropic.com</Ext> as{" "}
            <code>ANTHROPIC_API_KEY</code>. You can switch between them in Connections.
          </p>
        </Step>

        <Step n={s.cloud ? 3 : 2} done={s.google.ok} title="Sign in with Google (keeps it private)" note="Google Cloud, free">
          <Steps>
            <li>
              Open <Ext href="https://console.cloud.google.com/projectcreate">Google Cloud</Ext> and create a project named SnapSell.
            </li>
            <li>
              Go to <Ext href="https://console.cloud.google.com/auth/overview">Google Auth Platform</Ext>, click <b>Get started</b>, choose{" "}
              <b>External</b>, and add your Gmail under <b>Audience → Test users</b>.
            </li>
            <li>
              Go to <Ext href="https://console.cloud.google.com/auth/clients/create">Clients → Create client</Ext>, type{" "}
              <b>Web application</b>, and paste these two:
            </li>
          </Steps>
          <CopyRow label="Authorized JavaScript origin" value={s.google.origin} />
          <CopyRow label="Authorized redirect URI" value={s.google.redirectUri} />
          <p className="mt-2 text-[13px] text-muted">Then copy the Client ID and Client secret it shows, and add your own Gmail address:</p>
          <Vars names={["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ALLOWED_EMAILS"]} />
        </Step>

        <Step optional title="eBay: Log in with eBay" done={s.ebay.ok} note="eBay developer account, free">
          <Steps>
            <li>
              At <Ext href="https://developer.ebay.com/my/keys">developer.ebay.com</Ext> create a <b>Production</b> keyset.
            </li>
            <li>
              Under <b>User Tokens → Get a Token from eBay via Your Application</b> add a redirect with this accept URL, turn on OAuth,
              and copy its <b>RuName</b>:
            </li>
          </Steps>
          <CopyRow label="Your auth accepted URL" value={s.ebay.acceptUrl} />
          <Vars names={["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME"]} />
        </Step>

        <Step optional title="Google Lens shop prices" done={s.lens.serpapi} note="SerpApi, 100 free searches a month">
          <Steps>
            <li>
              Sign up at <Ext href="https://serpapi.com/users/sign_up">serpapi.com</Ext> and copy your API key.
            </li>
          </Steps>
          <Vars names={["SERPAPI_KEY"]} />
        </Step>
      </ol>

      <div className="mt-6 flex gap-2">
        <Button variant="outline" onClick={check} loading={checking}>
          <RefreshCw className="size-4" /> Check again
        </Button>
        {s.ready && !onBack && (
          <Button variant="accent" className="flex-1" onClick={() => location.reload()}>
            Open SnapSell
          </Button>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, note, done, optional, children }: { n?: number; title: string; note: string; done: boolean; optional?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!done && !optional);
  return (
    <li className={cx("rounded-3xl border bg-card", done ? "border-line" : "border-line-strong")}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold", done ? "bg-ok-soft text-ok" : optional ? "bg-soft text-muted" : "bg-accent text-white")}>
          {done ? <Check className="size-4" strokeWidth={3} /> : (n ?? "+")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          <span className="block text-[13px] text-muted">
            {done ? "Done" : optional ? `Optional · ${note}` : note}
          </span>
        </span>
      </button>
      {open && <div className="border-t border-soft px-4 pb-4 pt-3">{children}</div>}
    </li>
  );
}

const Steps = ({ children }: { children: ReactNode }) => <ol className="list-inside list-decimal space-y-1.5 text-sm leading-relaxed">{children}</ol>;

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-2">
    {children}
    <ExternalLink className="size-3" />
  </a>
);

function Vars({ names }: { names: string[] }) {
  return (
    <div className="mt-3 rounded-xl bg-soft p-3 text-[13px]">
      <div className="font-semibold text-muted">Add as environment variables:</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {names.map((n) => (
          <code key={n} className="rounded-md bg-card px-1.5 py-0.5 font-semibold">
            {n}
          </code>
        ))}
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2.5">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-2 rounded-xl border-[1.5px] border-line bg-paper px-3 py-2">
        <code className="min-w-0 flex-1 select-all break-all text-[13px]">{value}</code>
        <button
          onClick={async () => {
            if (await copyText(value)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className="flex shrink-0 items-center gap-1 text-xs font-bold"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
