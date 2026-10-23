import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleListView } from "@/components/social/PeopleList";
import { Spinner } from "@/components/ui/Spinner";

// The username comes from the address (/u/<username>/followers), so it is read inside <Suspense>.
export const instant = false;

export const metadata: Metadata = { title: "Followers" };

export default function FollowersPage({ params }: PageProps<"/u/[username]/followers">) {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
          <Spinner /> Loading…
        </p>
      }
    >
      <FollowersRoute params={params} />
    </Suspense>
  );
}

async function FollowersRoute({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <PeopleListView username={decodeURIComponent(username)} kind="followers" />;
}
