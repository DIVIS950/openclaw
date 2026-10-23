import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PineappleMark } from "@/components/PineappleMark";
import { hasValidSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Unlock · Pineapple" };

export default async function LoginPage() {
  if (await hasValidSession()) redirect("/");
  return (
    <main className="page page-login">
      <div className="login-mark" aria-hidden="true">
        <span className="pine-sway">
          <PineappleMark size={110} face />
        </span>
      </div>
      <h1 className="title center">Pineapple</h1>
      <p className="subtitle center">Private. Only you can unlock it.</p>
      <LoginForm />
    </main>
  );
}
