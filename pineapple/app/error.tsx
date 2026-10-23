"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page">
      <header className="header">
        <h1 className="title">Something went wrong</h1>
        <p className="subtitle">
          {error.digest ? `Error ${error.digest}. ` : ""}Check that DATABASE_URL and the other env vars are set in Vercel.
        </p>
      </header>
      <button type="button" className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
