import type { Metadata } from "next";
import { ProfileEditor } from "@/components/social/ProfileForm";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Edit profile" };

export default function EditProfilePage() {
  return <ProfileEditor />;
}
