"use client";

import { useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { DesignSpec } from "@/lib/types";

function summary(spec: DesignSpec): string {
  return [spec.garment_category, spec.neckline, spec.sleeve_style, spec.colour_palette.join("/"), spec.garment_length].filter(Boolean).join(" · ") || "Empty spec";
}

/** Names of the spec fields that differ between two versions, in plain words. */
function changedFields(a: DesignSpec, b: DesignSpec): string[] {
  const skip = new Set(["unresolved_questions", "assumptions"]);
  return (Object.keys(b) as (keyof DesignSpec)[])
    .filter((k) => !skip.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => k.replaceAll("_", " "));
}

export function VersionHistory() {
  const { detail, projectId, refresh } = useProject();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  if (!detail) return null;
  const current = detail.project.current_version;

  async function restore(n: number) {
    const ok = await confirm({
      title: `Restore version ${n}?`,
      message: "A copy of it becomes the newest version. Nothing is deleted, so you can always go back.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    setBusy(n);
    try {
      await api.restoreVersion(projectId, n);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {dialog}
      <ol className="relative space-y-3 border-l border-line pl-4">
        {detail.versions.map((v, i) => {
          const previous = detail.versions[i + 1]; // versions are newest first
          const changes = previous ? changedFields(previous.spec, v.spec) : [];
          const pictures = detail.assets.filter((a) => a.kind === "generated" && a.version_number === v.version_number).length;
          return (
            <li key={v.id} className="relative">
              <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${v.version_number === current ? "border-wine bg-wine" : "border-line-strong bg-surface"}`} />
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Version {v.version_number}</span>
                {v.version_number === current && <Badge tone="wine">Current</Badge>}
              </div>
              <p className="text-xs text-muted">
                {v.note || "Saved"} · {formatDateTime(v.created_at)}
              </p>
              <p className="mt-0.5 text-xs text-faint">{summary(v.spec)}</p>
              {previous && (
                <p className="mt-0.5 text-xs text-muted">
                  {changes.length ? `Changed: ${changes.slice(0, 6).join(", ")}${changes.length > 6 ? ` +${changes.length - 6} more` : ""}` : "No changes to the spec"}
                </p>
              )}
              {pictures > 0 && (
                <a href="#section-library" className="text-xs text-wine hover:underline">
                  {pictures} generated picture{pictures === 1 ? "" : "s"}
                </a>
              )}
              {v.version_number !== current && (
                <Button size="sm" variant="ghost" className="-ml-3 mt-0.5" onClick={() => restore(v.version_number)} loading={busy === v.version_number}>
                  Restore
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
