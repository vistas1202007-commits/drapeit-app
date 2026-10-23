import type { Metadata } from "next";
import { Inbox } from "@/components/chat/Inbox";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return <Inbox />;
}
