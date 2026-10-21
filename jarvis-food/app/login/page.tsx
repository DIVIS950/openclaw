import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Unlock · Jarvis Food" };

export default async function LoginPage() {
  if (await hasValidSession()) redirect("/");
  return (
    <main className="page page-login">
      <div className="login-mark" aria-hidden="true">
        <div className="reactor reactor-small reactor-idle" />
      </div>
      <h1 className="title center">Jarvis Food</h1>
      <p className="subtitle center">Private. Only you can unlock it.</p>
      <LoginForm />
    </main>
  );
}
