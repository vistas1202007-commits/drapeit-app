"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { SendDesignDialog } from "@/components/chat/SendDialogs";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/Icon";
import { inputClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { useProject } from "./ProjectContext";

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: "", label: "Notebook", icon: "notebook" },
  { path: "/studio", label: "Design Studio", icon: "pen" },
  { path: "/fabric", label: "Fabric Studio", icon: "fabric" },
  { path: "/tailor", label: "Tailor Workspace", icon: "ruler" },
  { path: "/cost", label: "Cost Estimate", icon: "coins" },
];

export function ProjectHeader() {
  const { detail, projectId, refresh } = useProject();
  const pathname = usePathname();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;
  const base = `/projects/${projectId}`;

  async function saveTitle() {
    const t = title.trim();
    if (!t || t === detail!.project.title) return setEditing(false);
    try {
      await api.renameProject(projectId, t);
      await refresh();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }

  async function exportJson() {
    setBusy("export");
    setError(null);
    try {
      await api.downloadExport(projectId, detail!.project.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    setBusy("duplicate");
    try {
      const copy = await api.duplicateProject(projectId);
      router.push(`/projects/${copy.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Duplicate failed");
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this project?",
      message: `"${detail!.project.title}" and all its versions, notes, sketches and outputs will be permanently deleted.`,
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await api.deleteProject(projectId);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(null);
    }
  }

  return (
    <div className="no-print border-b border-line bg-surface">
      {dialog}
      {sending && <SendDesignDialog projectId={projectId} onClose={() => setSending(false)} />}
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 pt-5 sm:px-8">
        <div className="min-w-0">
          <Link href="/" className="text-xs text-muted hover:text-wine">
            ← All projects
          </Link>
          {editing ? (
            <form
              className="mt-1 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveTitle();
              }}
            >
              <input aria-label="Project name" autoFocus className={`${inputClass} font-display text-lg`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              <Button type="submit" size="sm" variant="primary">
                Save
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="mt-0.5 flex items-center gap-2">
              <h1 className="truncate font-display text-2xl">{detail.project.title}</h1>
              <button
                type="button"
                className="rounded p-1 text-faint hover:bg-sunken hover:text-ink"
                aria-label="Rename project"
                onClick={() => {
                  setTitle(detail.project.title);
                  setEditing(true);
                }}
              >
                <Icon name="pen" className="h-3.5 w-3.5" />
              </button>
              <Badge title="Current design version">v{detail.project.current_version}</Badge>
            </div>
          )}
          {error && <p className="mt-1 text-xs text-err">{error}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/publish`} className={buttonClass("primary", "sm")}>
            <Icon name="send" className="h-3.5 w-3.5" /> Publish
          </Link>
          <Button size="sm" onClick={() => setSending(true)} title="Send a sketch of this design in a chat">
            <Icon name="chat" className="h-3.5 w-3.5" /> Send in chat
          </Button>
          <Button size="sm" onClick={duplicate} loading={busy === "duplicate"}>
            <Icon name="copy" className="h-3.5 w-3.5" /> Duplicate
          </Button>
          <Button size="sm" onClick={exportJson} loading={busy === "export"}>
            <Icon name="download" className="h-3.5 w-3.5" /> Export JSON
          </Button>
          <Button size="sm" variant="danger" onClick={remove} loading={busy === "delete"}>
            <Icon name="trash" className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
      <nav aria-label="Project sections" className="mx-auto mt-3 flex max-w-[1500px] gap-1 overflow-x-auto px-4 sm:px-8">
        {TABS.map((tab) => {
          const href = base + tab.path;
          const active = pathname === href;
          return (
            <Link
              key={tab.path}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ${
                active ? "border-wine font-medium text-wine" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <Icon name={tab.icon} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
