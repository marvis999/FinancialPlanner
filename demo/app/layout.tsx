import type { Metadata } from "next";

import de from "@/messages/de.json";
import { bricolage, geist } from "@/lib/fonts";
import { themeScript } from "@/lib/theme-script";

import "../../app/globals.css";

export const metadata: Metadata = {
  title: `${de.meta.title} (Demo)`,
  description: de.meta.description,
};

/**
 * Prerendered once at build time, so nothing here may depend on the viewer:
 * the language and the household are resolved in the browser (demo-app.tsx).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="de"
      className={`${geist.variable} ${bricolage.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
