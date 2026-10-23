import type { Metadata } from "next";
import { NotebookWorkspace } from "@/components/notebook/NotebookWorkspace";

// Opens with a short loading state while the project loads (see app/projects/[id]/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Notebook" };

export default function NotebookPage() {
  return <NotebookWorkspace />;
}
