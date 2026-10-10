import { Component, type ReactNode } from "react";
import { backups } from "../lib/backup.ts";

// One damaged list (a bad link, a broken saved copy) must never leave the
// student with a blank app: they get a way back without clearing anything.
// Two ways back: undo just the last link, or go back to today's first save.

const savedAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "earlier"
    : d.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
};

interface State {
  failed: boolean;
  restored: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, State> {
  state: State = { failed: false, restored: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error("Student Hub crashed", err);
  }

  private done = () => {
    this.setState({ restored: true });
    window.setTimeout(() => window.location.reload(), 600);
  };

  private undoLink = () => {
    const link = backups.lastLink();
    if (
      link &&
      window.confirm(
        `Undo the last link you brought in (${savedAt(link.at)})? Anything added after it is removed.`,
      ) &&
      backups.undoLink()
    ) {
      this.done();
    }
  };

  private restoreDay = () => {
    const day = backups.list()[0];
    if (
      day &&
      window.confirm(
        `Go back to how everything was at ${savedAt(day.at)}? Anything added after that is removed.`,
      ) &&
      backups.restore(day.day)
    ) {
      this.done();
    }
  };

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    const link = backups.lastLink();
    const day = backups.list()[0];
    const body = (
      <main className="screen" style={{ gap: 16 }}>
        <h1 className="h1">Something went wrong</h1>
        <div className="card stack" role="alert" style={{ gap: 12, padding: 16 }}>
          <p style={{ margin: 0 }}>
            This screen hit a problem, often from a damaged link. Nothing has been deleted. Reload
            to try again, or go back to an automatic save.
          </p>
          {this.state.restored ? (
            <p style={{ margin: 0, fontWeight: 700 }}>Restored. Reloading…</p>
          ) : (
            <>
              <button className="btn primary" onClick={() => window.location.reload()}>
                Reload
              </button>
              {link && (
                <button className="btn" onClick={this.undoLink}>
                  Undo the last link ({savedAt(link.at)})
                </button>
              )}
              {day && (
                <button className="btn" onClick={this.restoreDay}>
                  Back to the save from {savedAt(day.at)}
                </button>
              )}
            </>
          )}
        </div>
      </main>
    );
    // Inside the app (one screen) the tab bar stays usable; at the top it needs its own frame.
    return this.props.inline ? body : <div className="app">{body}</div>;
  }
}
