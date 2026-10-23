"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { NewProjectForm } from "./NewProjectForm";
import { ProjectCard } from "./ProjectCard";
import { ProjectFilters } from "./ProjectFilters";
import { useProjects } from "./useProjects";

const WORKFLOW = ["Idea", "Concept", "Sketch", "Fabric", "Materials", "Tailor sheet"];

export function Dashboard() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const { projects, error } = useProjects(search, category);
  const recent = projects?.slice(0, 6) ?? [];
  const latest = projects?.[0];
  const filtering = Boolean(search || category);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Your design notebook"
        description="Take a clothing idea from words to a tailor-ready sheet, one step at a time."
      />

      <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="Workflow">
        {WORKFLOW.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="rounded-full border border-line bg-surface px-2.5 py-1">{step}</span>
            {i < WORKFLOW.length - 1 && <span aria-hidden className="text-faint">—</span>}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <NewProjectForm />
        <section className="rounded-lg border border-line bg-surface shadow-card p-5" aria-labelledby="quick-title">
          <h2 id="quick-title" className="font-display text-xl">
            Quick access
          </h2>
          {latest ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-muted">
                Continue <span className="font-medium text-ink">{latest.title}</span>
              </p>
              <Link href={`/projects/${latest.id}`} className={buttonClass("secondary", "md", "w-full")}>
                Open notebook
              </Link>
              <Link href={`/projects/${latest.id}/studio`} className={buttonClass("secondary", "md", "w-full")}>
                Open design studio
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Your most recent project will appear here.</p>
          )}
          <Link href="/designs" className="mt-4 block text-sm text-wine hover:underline">
            See all designs →
          </Link>
        </section>
      </div>

      <section className="mt-10" aria-labelledby="recent-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="recent-title" className="font-display text-2xl">
            Recent projects
          </h2>
          <ProjectFilters search={search} onSearch={setSearch} category={category} onCategory={setCategory} />
        </div>
        <div className="mt-4">
          {error ? (
            <Notice tone="err" title="Could not load projects">
              {error}
            </Notice>
          ) : projects === null ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted">
              <Spinner /> Loading projects…
            </div>
          ) : recent.length === 0 ? (
            <EmptyState title={filtering ? "No projects match" : "No projects yet"}>
              {filtering ? "Try a different search or garment type." : "Create your first design above. It will be saved automatically."}
            </EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {recent.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
