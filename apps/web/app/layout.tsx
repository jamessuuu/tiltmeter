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

/**
 * JSON-LD for every route: the site as a WebSite whose author is the same Person entity
 * agentjames publishes (@id), so engines can join the sites to one maker. Rendered as a
 * native script tag per the Next.js JSON-LD guide; "<" is escaped so the payload can never
 * close the tag.
 */
const siteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "tiltmeter",
  url: "https://tiltmeter.vercel.app",
  author: {
    "@type": "Person",
    "@id": "https://agentjames.vercel.app/#person",
    name: "James Lorenz Santos",
    url: "https://agentjames.vercel.app",
    sameAs: [
      "https://www.linkedin.com/in/james-lorenz-santos-720776251/",
      "https://github.com/jamessuuu",
      "https://www.onlinejobs.ph/jobseekers/info/2766463",
      "https://ph.jobstreet.com/profiles/jameslorenz-santos-SXdpKyGqdK",
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd).replace(/</g, "\u003c") }}
        />
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
