import type { Metadata } from "next";
import { ActivityView } from "@/components/settings/ActivityView";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Your activity" };

export default function Page() {
  return <ActivityView />;
}
