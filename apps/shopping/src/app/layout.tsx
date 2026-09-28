import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { gmailEnabled, googleEnabled } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";
import { aiEnabled } from "@/lib/ai";
import { dbConfigured } from "@/lib/server/orders-db";
import { stripeConfigured } from "@/lib/server/stripe";
import { getSessionUser } from "@/lib/session";
import "./globals.css";

const body = DM_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-body" });
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Orbit — shop everything, safely",
  description: "Compare prices across every shop, avoid scams, pick your delivery speed and watch your parcels travel.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#111218" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>
        <Providers value={{ user, googleEnabled, gmailEnabled, aiEnabled: aiEnabled(), paymentsEnabled: stripeConfigured && dbConfigured, feePercent: Number(process.env.ORBIT_FEE_PERCENT ?? 3) }}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
