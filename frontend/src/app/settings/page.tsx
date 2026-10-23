import type { Metadata } from "next";
import { SettingsHome } from "@/components/settings/SettingsHome";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsHome />;
}
