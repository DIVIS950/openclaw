import { auth, googleEnabled } from "@/auth";

export type SessionUser = { name: string; email: string; image?: string } | null;

export async function getSessionUser(): Promise<SessionUser> {
  if (!googleEnabled) return null;
  const s = await auth();
  if (!s?.user?.email) return null;
  return { name: s.user.name ?? s.user.email, email: s.user.email, image: s.user.image ?? undefined };
}
