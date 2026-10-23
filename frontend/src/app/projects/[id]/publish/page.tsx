import type { Metadata } from "next";
import { ProjectPublish } from "@/components/social/ProjectPublish";

// Opens with a short loading state while the project loads (see app/projects/[id]/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Publish" };

export default function PublishDesignPage() {
  return <ProjectPublish />;
}
