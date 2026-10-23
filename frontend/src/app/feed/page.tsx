import type { Metadata } from "next";
import { FeedView } from "@/components/social/PostList";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Home Feed" };

export default function FeedPage() {
  return <FeedView />;
}
