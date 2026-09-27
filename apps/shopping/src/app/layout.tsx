import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { gmailEnabled, googleEnabled } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";
import { aiEnabled } from "@/lib/ai";
import { getSessionUser } from "@/lib/session";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });
const serif = Source_Serif_4({ subsets: ["latin", "latin-ext"], variable: "--font-serif-display", axes: ["opsz"] });

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
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1a17" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body>
        <Providers value={{ user, googleEnabled, gmailEnabled, aiEnabled: aiEnabled() }}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
