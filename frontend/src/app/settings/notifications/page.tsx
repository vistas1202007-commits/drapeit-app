import type { Metadata } from "next";
import { NotificationSettingsView } from "@/components/chat/Notifications";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Notification settings" };

export default function NotificationSettingsPage() {
  return <NotificationSettingsView />;
}
