import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <header className="header">
        <h1 className="title">Not found</h1>
        <p className="subtitle">That order or page does not exist.</p>
      </header>
      <Link href="/" className="btn btn-primary">
        Back to ordering
      </Link>
    </main>
  );
}
