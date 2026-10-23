import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { LibrarySearch } from "@/components/project/LibrarySearch";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Learning Library" };

export default function ResourcesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow="Learning & resources"
        title="Learning Library"
        description="Find real sewing and fashion-design tutorials. Results come straight from YouTube search; the app never makes up videos or links. For a guide built around one design, use Generate Tutorial in that design's notebook."
      />
      <LibrarySearch />
    </div>
  );
}
