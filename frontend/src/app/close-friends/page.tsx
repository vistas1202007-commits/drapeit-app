import type { Metadata } from "next";
import { CloseFriendsManager } from "@/components/social/CloseFriends";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Close Friends" };

export default function CloseFriendsPage() {
  return <CloseFriendsManager />;
}
