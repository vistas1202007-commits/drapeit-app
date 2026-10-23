"use client";

import { useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { MockBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { inputClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { DesignConceptOutput } from "@/lib/types";

type Entry =
  | { kind: "note"; id: string; at: string; content: string }
  | { kind: "concept"; id: string; at: string; summary: string; mock: boolean; failed: string | null; version: number };

export function IdeaPanel({ draft, onDraft }: { draft: string; onDraft: (v: string) => void }) {
  const { detail, projectId, refresh, runGenerator, running } = useProject();
  const { confirm, dialog } = useConfirm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;

  // Show the user's notes and the (mock) assistant's design results as one timeline.
  const entries: Entry[] = [
    ...detail.messages.map((m) => ({ kind: "note" as const, id: m.id, at: m.created_at, content: m.content })),
    ...detail.jobs
      .filter((j) => j.generator_id === "design")
      .map((j) => ({
        kind: "concept" as const,
        id: j.id,
        at: j.created_at,
        summary: (j.output as unknown as DesignConceptOutput | null)?.summary ?? "",
        mock: j.is_mock,
        failed: j.status === "failed" ? j.error : null,
        version: j.version_number,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  async function saveNote(generate: boolean) {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      await api.addMessage(projectId, text);
      onDraft(""); // only clear after it is safely saved
      await refresh();
      if (generate) {
        await runGenerator("design", { idea: text });
        document.getElementById("section-design")?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  async function removeNote(id: string) {
    if (!(await confirm({ title: "Delete this note?", confirmLabel: "Delete", danger: true }))) return;
    await api.deleteMessage(projectId, id);
    await refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dialog}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {entries.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            Describe your idea below in your own words: the garment, colours, occasion, details you love.
          </p>
        )}
        {entries.map((e) =>
          e.kind === "note" ? (
            <div key={e.id} className="group ml-6 rounded-lg rounded-tr-sm bg-wine-soft px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap">{e.content}</p>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                <span>{formatDateTime(e.at)}</span>
                <button type="button" onClick={() => removeNote(e.id)} className="opacity-0 transition-opacity hover:text-err focus:opacity-100 group-hover:opacity-100" aria-label="Delete note">
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div key={e.id} className="mr-6 rounded-lg rounded-tl-sm border border-line bg-surface px-3 py-2 text-sm">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
                <span className="font-medium text-ink">Design assistant</span>
                {e.mock && <MockBadge />}
              </div>
              {e.failed ? (
                <p className="text-err">{e.failed}</p>
              ) : (
                <>
                  <p>{e.summary}</p>
                  <button type="button" className="mt-1 text-xs text-wine hover:underline" onClick={() => document.getElementById("section-design")?.scrollIntoView({ behavior: "smooth" })}>
                    View concept →
                  </button>
                </>
              )}
            </div>
          ),
        )}
        {running.design && (
          <div className="mr-6 flex items-center gap-2 rounded-lg border border-line bg-surface shadow-card px-3 py-2 text-sm text-muted">
            <span className="animate-pulse">Reading your idea…</span>
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <label htmlFor="idea-input" className="sr-only">
          Your design idea
        </label>
        <textarea
          id="idea-input"
          className={`${inputClass} min-h-24 resize-y`}
          placeholder="e.g. An embroidered wine-colour anarkali with full sleeves and a V-neck for a winter wedding"
          value={draft}
          maxLength={4000}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(true);
          }}
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-err">
            {error} Your text is still here.
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => saveNote(true)} loading={saving || running.design} disabled={!draft.trim()}>
            <Icon name="sparkle" className="h-3.5 w-3.5" /> Save & generate design
          </Button>
          <Button size="sm" onClick={() => saveNote(false)} disabled={!draft.trim() || saving}>
            Save note
          </Button>
          <Button size="sm" variant="ghost" disabled title="Voice input is planned for a later phase" aria-label="Voice input (not available yet)">
            <Icon name="mic" className="h-3.5 w-3.5" /> Voice · later
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">Notes are saved to the project. Nothing is generated unless you ask.</p>
      </div>
    </div>
  );
}
