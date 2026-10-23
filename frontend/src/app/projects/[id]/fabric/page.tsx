import type { Metadata } from "next";
import { FabricStudio } from "@/components/project/FabricStudio";

// Opens with a short loading state while the project loads (see app/projects/[id]/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Fabric Studio" };

export default function FabricPage() {
  return <FabricStudio />;
}
