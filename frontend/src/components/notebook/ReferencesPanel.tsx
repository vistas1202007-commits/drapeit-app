/* eslint-disable @next/next/no-img-element -- images are served by our own API */
"use client";

import { useRef, useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_MB = 5;

export function ReferencesPanel() {
  const { detail, projectId, refresh } = useProject();
  const { confirm, dialog } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;
  // Generated pictures live in the image library; this panel is for the user's own images.
  const references = detail.assets.filter((a) => a.kind !== "generated");

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        // Quick check in the browser; the server checks again properly.
        if (!ALLOWED.includes(file.type)) throw new Error(`${file.name}: only PNG, JPEG or WebP images.`);
        if (file.size > MAX_MB * 1024 * 1024) throw new Error(`${file.name}: larger than ${MAX_MB} MB.`);
        await api.uploadAsset(projectId, file, file.name, "upload");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
      await refresh();
    }
  }

  async function remove(id: string, name: string) {
    if (!(await confirm({ title: "Delete this image?", message: name, confirmLabel: "Delete", danger: true }))) return;
    await api.deleteAsset(projectId, id);
    await refresh();
  }

  return (
    <div>
      {dialog}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">Hand-drawn sketches and inspiration (PNG, JPEG, WebP · max {MAX_MB} MB)</p>
        <Button size="sm" onClick={() => input.current?.click()} loading={uploading}>
          <Icon name="upload" className="h-3.5 w-3.5" /> Upload
        </Button>
        <input ref={input} type="file" accept={ALLOWED.join(",")} multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-err">
          {error}
        </p>
      )}
      {references.length === 0 ? (
        <p className="mt-3 text-xs text-faint">No images yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {references.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-md border border-line bg-canvas">
              <a href={api.assetUrl(a.id)} target="_blank" rel="noreferrer">
                <img src={api.assetUrl(a.id)} alt={a.filename} className="aspect-square w-full object-cover" />
              </a>
              <span className="absolute left-1 top-1 rounded bg-surface/90 px-1 text-[10px] text-muted">{a.kind === "sketch" ? "Studio" : "Upload"}</span>
              <button type="button" onClick={() => remove(a.id, a.filename)} className="absolute right-1 top-1 rounded bg-surface/90 p-1 text-muted opacity-0 hover:text-err focus:opacity-100 group-hover:opacity-100" aria-label={`Delete ${a.filename}`}>
                <Icon name="trash" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
