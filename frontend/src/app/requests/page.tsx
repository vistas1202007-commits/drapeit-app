import type { Metadata } from "next";
import { FollowRequestsView } from "@/components/social/PeopleList";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Follow requests" };

export default function RequestsPage() {
  return <FollowRequestsView />;
}
