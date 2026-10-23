"use client";

import { useProject } from "@/components/project/ProjectContext";
import { PublishPage } from "./PostDetail";

/** /projects/[id]/publish: the design comes from the project page around it. */
export function ProjectPublish() {
  const { projectId } = useProject();
  return <PublishPage projectId={projectId} />;
}
