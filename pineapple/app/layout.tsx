import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pineapple",
  description: "Your private AI assistant that orders food by phone.",
  applicationName: "Pineapple",
  appleWebApp: { capable: true, title: "Pineapple", statusBarStyle: "default" },
  // Older iOS versions only read the apple-prefixed tag for full-screen home-screen apps.
  other: { "apple-mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fff8e7",
  colorScheme: "light",
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
