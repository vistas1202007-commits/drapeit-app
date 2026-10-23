import type { Metadata } from "next";
import { CostWorkspace } from "@/components/project/CostWorkspace";

// Opens with a short loading state while the project loads (see app/projects/[id]/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Cost Estimate" };

export default function CostPage() {
  return <CostWorkspace />;
}
