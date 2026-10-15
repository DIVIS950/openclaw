import { useState } from "react";
import { Icon } from "../components/Icon.tsx";

export function SignIn({
  configured,
  onSignIn,
  onDemo,
}: {
  configured: boolean;
  onSignIn: () => Promise<void>;
  onDemo: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="app">
      <main className="screen" style={{ justifyContent: "center", gap: 24 }}>
        <div className="stack rise" style={{ alignItems: "flex-start" }}>
          <span className="nav-ai" style={{ margin: 0, width: 64, height: 64, borderRadius: 20 }}>
            <Icon name="sparkle" size={30} />
          </span>
          <h1 className="h1" style={{ fontSize: 38 }}>
            Proclaim
            <br />
            Student Hub
          </h1>
          <p className="sub" style={{ fontSize: 16 }}>
            Classroom, Gmail, Drive and your other school apps in one place, with an AI study buddy.
          </p>
        </div>

        <div className="stack rise" style={{ animationDelay: "0.1s" }}>
          <button
            className="btn big block dark"
            disabled={!configured || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSignIn();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Sign-in didn't work.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Icon name="loader" size={18} className="spin" /> : null}
            Sign in with Google
          </button>
          {!configured && (
            <div className="banner">
              Google sign-in isn't set up on this server yet. See the README to add a Google Client
              ID.
            </div>
          )}
          {error && (
            <div className="banner" role="alert">
              {error}
            </div>
          )}
          <button className="btn big block" onClick={onDemo}>
            Try the demo first
          </button>
        </div>

        <p className="muted rise" style={{ animationDelay: "0.2s", lineHeight: 1.5 }}>
          You sign in on Google's own page. This app never sees your password, and you can remove
          its access at any time in your Google Account under Security, Third-party connections.
        </p>
      </main>
    </div>
  );
}
