import type { Metadata } from "next";
import { MyDesigns } from "@/components/project/MyDesigns";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "My Designs" };

export default function DesignsPage() {
  return <MyDesigns />;
}
