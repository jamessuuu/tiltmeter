import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import "./globals.css";

const SITE_URL = "https://tiltmeter.vercel.app";
const DESCRIPTION =
  "tiltmeter tells an operator when a new model release moves their agent harness off true — not how capable a model is in the abstract, but whether a specific skill description, tool schema, routing prompt, or output contract still fires the way it did last week.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "tiltmeter", template: "%s · tiltmeter" },
  description: DESCRIPTION,
  icons: {
    icon: [
      { url: "/brand/favicon.svg" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/brand/favicon.svg",
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
    other: [{ rel: "mask-icon", url: "/brand/icon-maskable.svg", color: "#B45309" }],
  },
  openGraph: {
    title: "tiltmeter",
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "tiltmeter",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, type: "image/png" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "tiltmeter",
    description: DESCRIPTION,
    images: ["/brand/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
