/* eslint-disable @next/next/no-img-element -- images are served by our own API */
"use client";

import { useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge, ProviderBadge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Asset } from "@/lib/types";

function label(a: Asset): string {
  if (a.generator_id === "visual_preview") return "Visual preview";
  // File names look like "sketch-technical_flat-v3.png"
  const style = a.filename.match(/^sketch-([a-z_]+)-v\d+/)?.[1];
  return style ? `Sketch · ${style.replaceAll("_", " ")}` : "Sketch";
}

/** Every generated picture, grouped by the design version it was made from. */
export function ImageLibrary() {
  const { detail, projectId, refresh } = useProject();
  const { confirm, dialog } = useConfirm();
  const [deleting, setDeleting] = useState<string | null>(null);
  if (!detail) return null;

  const images = detail.assets.filter((a) => a.kind === "generated");
  const current = detail.project.current_version;
  const versions = [...new Set(images.map((a) => a.version_number ?? 0))].sort((a, b) => b - a);

  async function remove(a: Asset) {
    if (!(await confirm({ title: "Delete this picture?", message: `${label(a)} from version ${a.version_number}. This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
    setDeleting(a.id);
    try {
      await api.deleteAsset(projectId, a.id);
      await refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section id="section-library" aria-labelledby="h-library" className="scroll-mt-24">
      {dialog}
      <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
        <span className="font-display text-sm italic text-wine">
          <Icon name="image" className="inline h-3.5 w-3.5" />
        </span>
        <h2 id="h-library" className="font-display text-xl">
          Image library
        </h2>
        <span className="ml-auto text-xs text-muted">{images.length} saved</span>
      </div>
      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-faint">
          Every sketch and preview you generate is saved here, labelled with the design version it was made from.
        </p>
      ) : (
        <div className="space-y-5">
          {versions.map((v) => (
            <div key={v}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium">Version {v}</span>
                {v === current ? <Badge tone="wine">Current design</Badge> : <Badge>Earlier design</Badge>}
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
                {images
                  .filter((a) => (a.version_number ?? 0) === v)
                  .map((a) => (
                    <li key={a.id} className="group relative overflow-hidden rounded-md border border-line bg-surface">
                      <a href={api.assetUrl(a.id)} target="_blank" rel="noreferrer" title="Open full size">
                        <img src={api.assetUrl(a.id)} alt={label(a)} loading="lazy" className="aspect-[2/3] w-full bg-canvas object-cover" />
                      </a>
                      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
                        <ProviderBadge isMock={a.is_mock} provider={a.provider} />
                        <span className="truncate capitalize">{label(a)}</span>
                        <span className="ml-auto shrink-0 text-faint">{timeAgo(a.created_at)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(a)}
                        disabled={deleting === a.id}
                        className="absolute right-1 top-1 rounded bg-surface/90 p-1 text-muted opacity-0 hover:text-err focus:opacity-100 group-hover:opacity-100"
                        aria-label={`Delete ${label(a)}`}
                      >
                        <Icon name="trash" className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
