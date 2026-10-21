import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jarvis Food",
  description: "Your private AI assistant that orders food by phone.",
  applicationName: "Jarvis Food",
  appleWebApp: { capable: true, title: "Jarvis Food", statusBarStyle: "black-translucent" },
  // Older iOS versions only read the apple-prefixed tag for full-screen home-screen apps.
  other: { "apple-mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070a0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
