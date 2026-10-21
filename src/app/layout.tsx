import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Cormorant_Garamond } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { AuthProvider } from "@/contexts/AuthContext";
import { CLOCK_BOOT } from "@/lib/world-v6/clock";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

// The tab of every page (Lovro, 2026-10-15). A page that names itself puts the
// brand last, after a middle dot: "Field Journal · Sam · Ecom University".
export const metadata: Metadata = {
  title: "Ecom University",
  description: "Your 30-day expedition through ad creative.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${cormorant.variable} h-full antialiased`}
      // The head's script below writes data-world-tod on this element before React hydrates it;
      // without this, React reports that as a hydration mismatch on every page (checked 2026-10-21).
      // It covers this element's own attributes only.
      suppressHydrationWarning
    >
      <head>
        {/* The map's loading posters follow the student's clock: day or night,
            picked before the first paint (src/lib/world-v6/clock.ts CLOCK_BOOT). */}
        <script dangerouslySetInnerHTML={{ __html: CLOCK_BOOT }} />
      </head>
      <body className="min-h-full bg-[var(--color-bg-primary)] text-[var(--color-ink)]">
        <AuthProvider>{children}</AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
