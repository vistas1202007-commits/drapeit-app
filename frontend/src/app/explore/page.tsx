import type { Metadata } from "next";
import { ExploreView } from "@/components/social/Explore";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return <ExploreView />;
}
