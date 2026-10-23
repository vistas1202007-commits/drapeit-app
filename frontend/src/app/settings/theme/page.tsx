import type { Metadata } from "next";
import { ThemeSettings } from "@/components/settings/ThemeSettings";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Theme" };

export default function ThemePage() {
  return <ThemeSettings />;
}
