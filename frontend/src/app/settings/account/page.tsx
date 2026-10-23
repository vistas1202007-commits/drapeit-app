import type { Metadata } from "next";
import { AccountSettings } from "@/components/settings/AccountSettings";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return <AccountSettings />;
}
