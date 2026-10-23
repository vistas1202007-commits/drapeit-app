import type { Metadata } from "next";
import { VerificationSettings } from "@/components/settings/VerificationSettings";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Verified badge" };

export default function VerificationPage() {
  return <VerificationSettings />;
}
