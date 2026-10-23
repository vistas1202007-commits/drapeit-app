import type { Metadata } from "next";
import { Suspense } from "react";
import { PostEditor } from "@/components/social/PostDetail";
import { Spinner } from "@/components/ui/Spinner";

// The post id comes from the address (/p/<id>/edit), so it is read inside <Suspense>.
export const instant = false;

export const metadata: Metadata = { title: "Edit post" };

export default function EditPostPage({ params }: PageProps<"/p/[id]/edit">) {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
          <Spinner /> Opening post…
        </p>
      }
    >
      <EditRoute params={params} />
    </Suspense>
  );
}

async function EditRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostEditor id={id} />;
}
