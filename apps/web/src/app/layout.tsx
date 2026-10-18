import type { MeResponse } from "@releaselens/contracts";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { apiGetOptional } from "@/lib/api";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ReleaseLens", template: "%s · ReleaseLens" },
  description: "Read-only deployment diagnostics: is the right code deployed, and is it healthy?",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const me = await apiGetOptional<MeResponse>("/me");
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <Header me={me} />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
