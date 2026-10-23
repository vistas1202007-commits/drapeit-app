"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectProvider, useProject } from "./ProjectContext";

export function ProjectFrame({ projectId, children }: { projectId: string; children: ReactNode }) {
  return (
    <ProjectProvider projectId={projectId}>
      <Gate>{children}</Gate>
    </ProjectProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { detail, loadError } = useProject();
  if (loadError && !detail) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <Notice tone="err" title="This project could not be opened" action={<Link href="/" className={buttonClass("secondary", "sm")}>Back to dashboard</Link>}>
          {loadError}
        </Notice>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
        <Spinner /> Loading project…
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <ProjectHeader />
      {children}
    </div>
  );
}
