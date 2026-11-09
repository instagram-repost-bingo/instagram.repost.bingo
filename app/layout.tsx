import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { INSTAGRAM_HANDLE, SITE_NAME, SITE_URL } from "@/lib/config";
import "./globals.css";

// Self-hosted at build time by next/font: no requests to Google from visitors.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const description = `Follow @${INSTAGRAM_HANDLE}, paste your Instagram post link, and one random post gets reposted every day, with credit.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${SITE_NAME}: one random repost, every day`,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME}: one random repost, every day`,
    description,
    locale: "en_GB",
  },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#fff4e0",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
