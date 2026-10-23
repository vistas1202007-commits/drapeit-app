import type { Metadata } from "next";
import { DesignStudio } from "@/components/studio/DesignStudio";

// Opens with a short loading state while the project loads (see app/projects/[id]/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Design Studio" };

export default function StudioPage() {
  return <DesignStudio />;
}
