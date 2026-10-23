import type { Metadata } from "next";
import { Cormorant_Garamond, Fraunces, Inter, Playfair_Display } from "next/font/google";
import { Suspense } from "react";
import { AuthLoading, AuthProvider } from "@/components/auth/AuthProvider";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { THEME_BOOT_SCRIPT } from "@/lib/themes";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
// Only some themes use these two, so the browser does not download them up front.
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], weight: ["400", "500", "600"], preload: false });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: { default: "Drapeit by Vistas Atelier", template: "%s · Drapeit" },
  description: "Drape it. Share it. Turn clothing ideas into concepts, sketches, fabric choices and tailor-ready sheets, and share them with other designers.",
  applicationName: "Drapeit",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script below changes <html> before React starts, hence suppressHydrationWarning.
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${cormorant.variable} ${playfair.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {/* AuthProvider reads the current address, which Next.js needs inside <Suspense>. */}
        <LanguageProvider>
          <ThemeProvider>
            <Suspense fallback={<AuthLoading />}>
              <AuthProvider>{children}</AuthProvider>
            </Suspense>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
