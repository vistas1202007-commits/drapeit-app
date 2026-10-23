"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";
import { ProjectFilters } from "./ProjectFilters";
import { useProjects } from "./useProjects";

type Sort = "updated" | "created" | "name";

export function MyDesigns() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const { projects, error, reload } = useProjects(search, category);
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sorted = [...(projects ?? [])].sort((a, b) =>
    sort === "name" ? a.title.localeCompare(b.title) : sort === "created" ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at),
  );

  async function exportJson(p: ProjectSummary) {
    setBusy(`export-${p.id}`);
    setActionError(null);
    try {
      await api.downloadExport(p.id, p.title);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(p: ProjectSummary) {
    setBusy(p.id);
    setActionError(null);
    try {
      await api.duplicateProject(p.id);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Duplicate failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: ProjectSummary) {
    const ok = await confirm({ title: `Delete "${p.title}"?`, message: "All versions, notes, sketches and outputs of this project are permanently deleted.", confirmLabel: "Delete project", danger: true });
    if (!ok) return;
    setBusy(p.id);
    setActionError(null);
    try {
      await api.deleteProject(p.id);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      {dialog}
      <PageHeader
        eyebrow="Library"
        title="My Designs"
        description="Every saved project with its sketches, fabric choices, versions and outputs. Open one to continue where you left off."
        actions={
          <Button variant="primary" onClick={() => router.push("/")}>
            <Icon name="plus" /> New design
          </Button>
        }
      />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <ProjectFilters search={search} onSearch={setSearch} category={category} onCategory={setCategory} />
        <label className="flex items-center gap-2 text-sm text-muted">
          Sort
          <select className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="updated">Last updated</option>
            <option value="created">Newest</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      {actionError && (
        <div className="mt-4">
          <Notice tone="err" title="Action failed">
            {actionError}
          </Notice>
        </div>
      )}
      <div className="mt-5">
        {error ? (
          <Notice tone="err" title="Could not load projects">
            {error}
          </Notice>
        ) : projects === null ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading…
          </p>
        ) : sorted.length === 0 ? (
          <EmptyState title={search || category ? "No projects match" : "No saved designs yet"}>{search || category ? "Try another search." : "Start a design from the dashboard."}</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sorted.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                actions={
                  <>
                    <Button size="sm" onClick={() => duplicate(p)} loading={busy === p.id} aria-label={`Duplicate ${p.title}`}>
                      <Icon name="copy" className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" onClick={() => exportJson(p)} loading={busy === `export-${p.id}`} aria-label={`Export ${p.title}`}>
                      <Icon name="download" className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => remove(p)} aria-label={`Delete ${p.title}`}>
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
