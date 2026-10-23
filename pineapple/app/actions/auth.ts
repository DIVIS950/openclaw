"use server";

import { redirect } from "next/navigation";
import { login, logout, logoutEverywhere, requireSession } from "@/lib/auth";

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0 || password.length > 200) {
    return { error: "Enter your password." };
  }
  const result = await login(password);
  if (!result.ok) return { error: result.error };
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

export async function logoutEverywhereAction(): Promise<void> {
  await requireSession();
  await logoutEverywhere();
  redirect("/login");
}
