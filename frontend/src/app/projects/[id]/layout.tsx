import { Suspense } from "react";
import { ProjectFrame } from "@/components/project/ProjectFrame";
import { Spinner } from "@/components/ui/Spinner";

// The project id comes from the URL (/projects/<id>). It is only known when the
// page is requested, so we read it inside <Suspense> as Next.js requires.
export default function ProjectLayout({ children, params }: LayoutProps<"/projects/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
          <Spinner /> Opening project…
        </div>
      }
    >
      <ProjectRoute params={params}>{children}</ProjectRoute>
    </Suspense>
  );
}

async function ProjectRoute({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  return <ProjectFrame projectId={id}>{children}</ProjectFrame>;
}
