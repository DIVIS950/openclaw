import { Component, type ReactNode } from "react";
import { backups } from "../lib/backup.ts";

// One damaged list (a bad link, a broken saved copy) must never leave the
// student with a blank app: they get a way back without clearing anything.

interface State {
  failed: boolean;
  restored: string | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, State> {
  state: State = { failed: false, restored: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error("Student Hub crashed", err);
  }

  private restoreLatest = () => {
    // The newest automatic save is taken each day before any link is brought in.
    const latest = backups.list()[0];
    if (latest && backups.restore(latest.day)) {
      this.setState({ restored: latest.day });
      window.setTimeout(() => window.location.reload(), 600);
    }
  };

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    const latest = backups.list()[0];
    const body = (
      <main className="screen" style={{ gap: 16 }}>
        <h1 className="h1">Something went wrong</h1>
        <div className="card stack" role="alert" style={{ gap: 12, padding: 16 }}>
          <p style={{ margin: 0 }}>
            This screen hit a problem, often from a damaged link. Your homework and notes are still
            on this phone.
          </p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          {latest && (
            <button className="btn" onClick={this.restoreLatest}>
              {this.state.restored
                ? "Restored. Reloading…"
                : `Go back to the automatic save from ${latest.day}`}
            </button>
          )}
        </div>
      </main>
    );
    // Inside the app (one screen) the tab bar stays usable; at the top it needs its own frame.
    return this.props.inline ? body : <div className="app">{body}</div>;
  }
}
