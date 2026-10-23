import type { Metadata } from "next";
import { Suspense } from "react";
import { PostDetail } from "@/components/social/PostDetail";
import { Spinner } from "@/components/ui/Spinner";

// The post id comes from the address (/p/<id>), so it is read inside <Suspense>.
export const instant = false;

export const metadata: Metadata = { title: "Post" };

export default function PostPage({ params }: PageProps<"/p/[id]">) {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
          <Spinner /> Opening post…
        </p>
      }
    >
      <PostRoute params={params} />
    </Suspense>
  );
}

async function PostRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetail id={id} />;
}
