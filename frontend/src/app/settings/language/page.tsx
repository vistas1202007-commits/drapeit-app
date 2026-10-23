import type { Metadata } from "next";
import { LanguageSettings } from "@/components/settings/LanguageSettings";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Language" };

export default function Page() {
  return <LanguageSettings />;
}
