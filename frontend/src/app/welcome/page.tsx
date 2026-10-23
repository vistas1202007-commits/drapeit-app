import type { Metadata } from "next";
import { Welcome } from "@/components/onboarding/Welcome";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Welcome" };

export default function WelcomePage() {
  return <Welcome />;
}
