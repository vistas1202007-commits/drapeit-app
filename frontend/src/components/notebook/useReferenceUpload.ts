import { useRef, useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { api } from "@/lib/api";

export const REFERENCE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const REFERENCE_MAX_MB = 5;

/** Uploading the user's own reference pictures; shared by the idea box and the References panel. */
export function useReferenceUpload() {
  const { projectId, refresh } = useProject();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        // Quick check in the browser; the server checks again properly.
        if (!REFERENCE_TYPES.includes(file.type)) throw new Error(`${file.name}: only PNG, JPEG or WebP images.`);
        if (file.size > REFERENCE_MAX_MB * 1024 * 1024) throw new Error(`${file.name}: larger than ${REFERENCE_MAX_MB} MB.`);
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

  return { input, uploading, error, upload };
}
