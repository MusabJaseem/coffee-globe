import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts ship in @fontsource packages rather than next/font/google, so builds don't
// depend on reaching Google Fonts (a failed download there fails the whole build).
// next/font/local needs literal paths, hence the repetition.
const display = localFont({
  src: [
    { path: "../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-display",
});
const body = localFont({
  src: [
    { path: "../node_modules/@fontsource/figtree/files/figtree-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/figtree/files/figtree-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/figtree/files/figtree-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Coffee Globe",
  description: "A globe of specialty roasters that ship to you, lit up by how well their coffee matches your taste.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1B130E",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
