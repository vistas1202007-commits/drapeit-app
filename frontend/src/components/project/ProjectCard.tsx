"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ProjectThumbnail } from "@/components/ui/Thumbnail";
import { timeAgo } from "@/lib/format";
import type { ProjectSummary } from "@/lib/types";

export function ProjectCard({ project, actions }: { project: ProjectSummary; actions?: ReactNode }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card transition-colors hover:border-line-strong">
      <Link href={`/projects/${project.id}`} className="block aspect-[4/3] overflow-hidden border-b border-line bg-canvas">
        <ProjectThumbnail assetId={project.thumbnail_asset_id} title={project.title} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <Link href={`/projects/${project.id}`} className="font-medium text-ink hover:text-wine">
          <h3 className="truncate">{project.title}</h3>
        </Link>
        <p className="text-xs text-muted">
          {project.garment_category || "No garment type yet"} · v{project.current_version} · {project.output_count} output
          {project.output_count === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-faint">Updated {timeAgo(project.updated_at)}</p>
        {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
      </div>
    </article>
  );
}
