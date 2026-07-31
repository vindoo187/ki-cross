import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "KI-Verkaufsassistent - technisches Fundament",
  description: "Internes Projektgeruest (Phase 2). Kein fertiges Produkt, keine Kundendaten.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
