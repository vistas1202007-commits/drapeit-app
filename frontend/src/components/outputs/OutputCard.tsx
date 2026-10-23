"use client";

import { useState, type ReactNode } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge, ProviderBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { GenerationJob } from "@/lib/types";
import { ConceptView } from "./ConceptView";
import { CostView } from "./CostView";
import { EmbroideryView } from "./EmbroideryView";
import { FabricView } from "./FabricView";
import { MaterialsView } from "./MaterialsView";
import { MoodboardView } from "./MoodboardView";
import { PatternView } from "./PatternView";
import { PreviewView, SketchView } from "./SketchView";
import { TailorSheetView } from "./TailorSheetView";
import { TutorialView } from "./TutorialView";
import { VariationsView } from "./VariationsView";
import { VideoView } from "./VideoView";

export function renderOutput(job: GenerationJob): ReactNode {
  switch (job.generator_id) {
    case "design":
      return <ConceptView job={job} />;
    case "sketch":
      return <SketchView job={job} />;
    case "visual_preview":
      return <PreviewView job={job} />;
    case "fabric":
      return <FabricView job={job} />;
    case "materials":
      return <MaterialsView job={job} />;
    case "tailor_sheet":
      return <TailorSheetView job={job} />;
    case "cost":
      return <CostView job={job} />;
    case "variations":
      return <VariationsView job={job} />;
    case "moodboard":
      return <MoodboardView job={job} />;
    case "embroidery":
      return <EmbroideryView job={job} />;
    case "pattern":
      return <PatternView job={job} />;
    case "tutorial":
      return <TutorialView job={job} />;
    case "video":
      return <VideoView job={job} />;
    default:
      return <pre className="overflow-auto text-xs">{JSON.stringify(job.output, null, 2)}</pre>;
  }
}

/** Shows which design version an output came from, and whether it is out of date. */
export function JobMeta({ job }: { job: GenerationJob }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge title="Design version this output was made from">from v{job.version_number}</Badge>
      <ProviderBadge isMock={job.is_mock} provider={job.provider} />
      {job.stale && (
        <Badge tone="wine" title={`Changed since: ${job.stale_fields.join(", ")}`}>
          Out of date
        </Badge>
      )}
      <span className="text-xs text-faint">{timeAgo(job.created_at)}</span>
    </div>
  );
}

export function OutputCard({ job, onRegenerate, regenerating }: { job: GenerationJob; onRegenerate?: () => void; regenerating?: boolean }) {
  const { projectId, refresh, retryJob, running } = useProject();
  const { confirm, dialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!(await confirm({ title: "Delete this output?", message: "The design spec and other outputs are not affected.", confirmLabel: "Delete", danger: true }))) return;
    setDeleting(true);
    try {
      await api.deleteJob(projectId, job.id);
      await refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface shadow-card p-4">
      {dialog}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <JobMeta job={job} />
        <div className="flex gap-1">
          {job.status === "failed" ? (
            <Button size="sm" variant="primary" onClick={() => retryJob(job)} loading={running[job.generator_id]}>
              <Icon name="refresh" className="h-3.5 w-3.5" /> Retry
            </Button>
          ) : (
            onRegenerate && (
              <Button size="sm" onClick={onRegenerate} loading={regenerating}>
                <Icon name="refresh" className="h-3.5 w-3.5" /> {job.stale ? "Update" : "Regenerate"}
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" onClick={remove} loading={deleting} aria-label="Delete output">
            <Icon name="trash" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {job.stale && (
        <p className="mb-3 rounded-md bg-wine-soft px-3 py-1.5 text-xs text-wine">
          The design changed since this was made ({job.stale_fields.join(", ").replaceAll("_", " ")}). Press Update to regenerate just this output.
        </p>
      )}
      {job.status === "failed" ? (
        <p role="alert" className="text-sm text-err">
          {job.error}
        </p>
      ) : (
        renderOutput(job)
      )}
    </div>
  );
}
