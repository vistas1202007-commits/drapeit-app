import type { Metadata } from "next";
import { TailorWorkspace } from "@/components/project/TailorWorkspace";

// Opens with a short loading state while the project loads (see app/projects/[id]/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Tailor Workspace" };

export default function TailorPage() {
  return <TailorWorkspace />;
}
