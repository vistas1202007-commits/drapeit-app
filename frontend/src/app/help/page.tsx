import type { Metadata } from "next";
import { HelpView } from "@/components/settings/HelpView";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Help" };

export default function Page() {
  return <HelpView />;
}
