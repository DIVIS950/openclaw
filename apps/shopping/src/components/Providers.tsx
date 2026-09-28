"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/session";
import { useAppState } from "@/lib/store";

type Env = {
  user: SessionUser;
  googleEnabled: boolean;
  gmailEnabled: boolean;
  aiEnabled: boolean;
  /** Stripe keys and order storage are configured: real checkout is on. */
  paymentsEnabled: boolean;
  feePercent: number;
};

const EnvContext = createContext<Env>({ user: null, googleEnabled: false, gmailEnabled: false, aiEnabled: false, paymentsEnabled: false, feePercent: 3 });

export function Providers({ value, children }: { value: Env; children: React.ReactNode }) {
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

export const useEnv = () => useContext(EnvContext);

/** Google user when signed in for real, otherwise the local demo profile. */
export function useUser() {
  const { user } = useEnv();
  const { demoUser } = useAppState();
  if (user) return { ...user, kind: "google" as const };
  if (demoUser) return { ...demoUser, image: undefined, kind: "demo" as const };
  return null;
}
