import type { Metadata } from "next";
import { AdminPanel } from "@/components/admin/AdminPanel";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
// The API refuses everyone who is not an admin, whatever this page shows.
export const instant = false;

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return <AdminPanel />;
}
