import type { Metadata } from "next";
import { PrivacySettings } from "@/components/social/PrivacySettings";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Privacy & safety" };

export default function PrivacyPage() {
  return <PrivacySettings />;
}
