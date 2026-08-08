import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import "./globals.css";

const SITE_URL = "https://tiltmeter.vercel.app";
const DESCRIPTION =
  "tiltmeter tells an operator when a new model release moves their agent harness off true — not how capable a model is in the abstract, but whether a specific skill description, tool schema, routing prompt, or output contract still fires the way it did last week.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "tiltmeter", template: "%s · tiltmeter" },
  description: DESCRIPTION,
  icons: {
    icon: "/brand/favicon.svg",
    shortcut: "/brand/favicon.svg",
  },
  openGraph: {
    title: "tiltmeter",
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "tiltmeter",
    images: [{ url: "/brand/og.svg", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "tiltmeter",
    description: DESCRIPTION,
    images: ["/brand/og.svg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
