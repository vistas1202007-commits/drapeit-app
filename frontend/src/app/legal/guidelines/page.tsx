import type { Metadata } from "next";
import { LegalPage } from "@/components/settings/LegalPage";

// A plain page that opens without signing in (see PUBLIC_PATHS in components/auth/AuthProvider.tsx).
export const metadata: Metadata = { title: "Community Guidelines" };

export default function Page() {
  return <LegalPage doc="guidelines" />;
}
