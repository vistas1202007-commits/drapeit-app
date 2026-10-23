import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileView } from "@/components/social/ProfileView";
import { Spinner } from "@/components/ui/Spinner";

// The username comes from the address (/u/<username>), so it is read inside <Suspense>.
export const instant = false;

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage({ params }: PageProps<"/u/[username]">) {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
          <Spinner /> Opening profile…
        </p>
      }
    >
      <ProfileRoute params={params} />
    </Suspense>
  );
}

async function ProfileRoute({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileView username={decodeURIComponent(username)} />;
}
