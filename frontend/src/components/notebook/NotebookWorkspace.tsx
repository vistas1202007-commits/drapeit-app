"use client";

import { useState, type ReactNode } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { ProviderBadge } from "@/components/ui/Badge";
import { GeneratorPanel } from "./GeneratorPanel";
import { IdeaPanel } from "./IdeaPanel";
import { OutputSections } from "./OutputSections";
import { ReferencesPanel } from "./ReferencesPanel";
import { SpecEditor } from "./SpecEditor";
import { VersionHistory } from "./VersionHistory";

type SideTab = "generate" | "spec" | "history";

function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function NotebookWorkspace() {
  const { detail, generators } = useProject();
  const [draft, setDraft] = useState("");
  const [sketchStyle, setSketchStyle] = useState("pencil");
  const [tab, setTab] = useState<SideTab>("generate");
  if (!detail) return null;
  const designGen = generators.find((g) => g.id === "design");

  const tabs: [SideTab, string][] = [
    ["generate", "Generate"],
    ["spec", "Design spec"],
    ["history", `History (${detail.versions.length})`],
  ];

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6 sm:px-8 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      {/* Left: conversation + references */}
      <div className="order-1 space-y-5 lg:order-none lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <Panel title="Idea & notes" aside={designGen && <ProviderBadge isMock={designGen.is_mock} provider={designGen.provider} />}>
          <div className="flex h-[min(62vh,600px)] min-h-80 flex-col">
            <IdeaPanel draft={draft} onDraft={setDraft} />
          </div>
        </Panel>
        <Panel title="References">
          <ReferencesPanel />
        </Panel>
      </div>

      {/* Centre: the notebook sections with generated outputs */}
      <div className="order-3 min-w-0 lg:order-none">
        <OutputSections sketchStyle={sketchStyle} />
      </div>

      {/* Right: generators, spec editor, version history */}
      <div className="order-2 lg:order-none lg:col-span-2 xl:col-span-1 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
        <div role="tablist" aria-label="Notebook tools" className="mb-3 flex gap-1 rounded-lg border border-line bg-surface shadow-card p-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-sm transition-colors ${tab === id ? "bg-wine-soft font-medium text-wine" : "text-muted hover:bg-sunken"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === "generate" && <GeneratorPanel sketchStyle={sketchStyle} onSketchStyle={setSketchStyle} ideaDraft={draft} />}
          {tab === "spec" && <SpecEditor key={detail.project.current_version} />}
          {tab === "history" && <VersionHistory />}
        </div>
      </div>
    </div>
  );
}
