"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { ProviderBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { GeneratorPanel } from "./GeneratorPanel";
import { IdeaPanel } from "./IdeaPanel";
import { OutputSections } from "./OutputSections";
import { ReferencesPanel } from "./ReferencesPanel";
import { SpecEditor } from "./SpecEditor";
import { VersionHistory } from "./VersionHistory";

type SideTab = "generate" | "spec" | "history";
// left / centre / right: a whole column pushed aside. idea / references / tools: one panel folded up.
type Fold = "left" | "centre" | "right" | "idea" | "references" | "tools";
type Collapsed = Record<Fold, boolean>;

const COLLAPSED_KEY = "drapeit.notebook.collapsed";
const NOTHING_FOLDED: Collapsed = { left: false, centre: false, right: false, idea: false, references: false, tools: false };

const STRIP = "44px";
const FLEX = "minmax(0,1fr)";

function readCollapsed(): Collapsed {
  try {
    const saved = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "null");
    return {
      left: saved?.left === true,
      centre: saved?.centre === true,
      right: saved?.right === true,
      idea: saved?.idea === true,
      references: saved?.references === true,
      tools: saved?.tools === true,
    };
  } catch {
    return NOTHING_FOLDED;
  }
}

const pillClass =
  "flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted shadow-card transition-colors hover:bg-sunken hover:text-ink";

/** The ▸ / ▾ arrow in a panel's heading: folds the panel up to its heading, and opens it again. */
function FoldChevron({ title, folded, onClick }: { title: string; folded: boolean; onClick: () => void }) {
  const label = `${folded ? "Show" : "Fold up"} ${title}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={!folded}
      aria-label={label}
      title={label}
      className="rounded-md p-1 text-muted transition-colors hover:bg-sunken hover:text-ink"
    >
      <Icon name="chevronRight" className={`h-4 w-4 transition-transform ${folded ? "" : "rotate-90"}`} />
    </button>
  );
}

function Panel({ title, children, aside, folded, onFold }: { title: string; children: ReactNode; aside?: ReactNode; folded?: boolean; onFold?: () => void }) {
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card p-4">
      <div className={`flex items-center justify-between gap-2 ${folded ? "" : "mb-3"}`}>
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
        <div className="flex items-center gap-2">
          {aside}
          {onFold && <FoldChevron title={title} folded={!!folded} onClick={onFold} />}
        </div>
      </div>
      {/* Folded, not removed: what you typed or were uploading stays. */}
      <div className={folded ? "hidden" : ""}>{children}</div>
    </section>
  );
}

/** The small arrow that pushes a whole column aside. */
function HideButton({ side, label, onClick }: { side: "left" | "centre" | "right"; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={pillClass}>
      {side === "left" && <Icon name="chevronLeft" className="h-4 w-4" />}
      {side === "centre" && <Icon name="chevronRight" className="h-4 w-4" />}
      <span>Hide</span>
      {side === "right" && <Icon name="chevronRight" className="h-4 w-4" />}
      {side === "centre" && <Icon name="chevronLeft" className="h-4 w-4" />}
    </button>
  );
}

/** What is left of a column that was pushed aside: a slim strip, press it to bring the column back. */
function Strip({ side, label, text, onClick, className }: { side: "left" | "centre" | "right"; label: string; text: string; onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`min-h-48 w-full flex-col items-center gap-3 rounded-lg border border-line bg-surface py-3 text-muted shadow-card transition-colors hover:bg-sunken hover:text-ink ${className}`}
    >
      <span className="flex">
        {(side === "left" || side === "centre") && <Icon name="chevronRight" className="h-4 w-4" />}
        {(side === "right" || side === "centre") && <Icon name="chevronLeft" className="h-4 w-4" />}
      </span>
      <span className="text-xs font-semibold uppercase tracking-[0.12em] [writing-mode:vertical-rl]">{text}</span>
    </button>
  );
}

export function NotebookWorkspace() {
  const { detail, generators } = useProject();
  const [draft, setDraft] = useState("");
  const [sketchStyle, setSketchStyle] = useState("pencil");
  const [tab, setTab] = useState<SideTab>("generate");
  // Nothing is drawn before the design has loaded, so reading the saved choice here cannot disagree with the server's page.
  const [collapsed, setCollapsed] = useState<Collapsed>(() => (typeof window === "undefined" ? NOTHING_FOLDED : readCollapsed()));
  if (!detail) return null;
  const designGen = generators.find((g) => g.id === "design");

  function toggle(key: Fold) {
    const next = { ...collapsed, [key]: !collapsed[key] };
    // Never push all three columns aside at once: there would be nothing left to look at.
    if (next.left && next.centre && next.right) return;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      // Private window or blocked storage: it just is not remembered.
    }
  }

  const tabs: [SideTab, string][] = [
    ["generate", "Generate"],
    ["spec", "Design spec"],
    ["history", `History (${detail.versions.length})`],
  ];

  // Column widths. A column pushed aside is a slim strip. On a wide screen (xl) all three share one row, and when the
  // middle one is pushed aside the other two share the room. On a narrower screen (lg) the tools sit in a second row
  // under both columns, so only the left one can go aside and the middle one always takes the rest.
  const leftWidth = collapsed.left ? STRIP : collapsed.centre ? FLEX : "320px";
  const centreWidth = collapsed.centre ? STRIP : FLEX;
  const rightWidth = collapsed.right ? STRIP : collapsed.centre ? FLEX : "340px";
  const columns = {
    "--cols-lg": `${collapsed.left ? STRIP : "320px"} ${FLEX}`,
    "--cols-xl": `${leftWidth} ${centreWidth} ${rightWidth}`,
  } as CSSProperties;

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6 sm:px-8 lg:grid-cols-[var(--cols-lg)] xl:grid-cols-[var(--cols-xl)]" style={columns}>
      {/* Left: conversation + references. On a computer the arrow pushes it aside; on a phone it always shows.
          It only stays in view while scrolling when all three columns share one row (xl): on a narrower screen the
          tools sit in a second row, and a column that stays put would slide over them. */}
      <div className="order-1 lg:order-none lg:self-start xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
        <div className={`space-y-5 ${collapsed.left ? "lg:hidden" : ""}`}>
          {/* Stays at the top while this column scrolls, so the arrow is always in reach. */}
          <div className="sticky top-0 z-10 mb-2 hidden justify-end lg:flex">
            <HideButton side="left" label="Hide idea and references" onClick={() => toggle("left")} />
          </div>
          <Panel
            title="Idea & notes"
            aside={designGen && <ProviderBadge isMock={designGen.is_mock} provider={designGen.provider} />}
            folded={collapsed.idea}
            onFold={() => toggle("idea")}
          >
            <div className="flex h-[min(62vh,600px)] min-h-80 flex-col">
              <IdeaPanel draft={draft} onDraft={setDraft} />
            </div>
          </Panel>
          <Panel title="References" folded={collapsed.references} onFold={() => toggle("references")}>
            <ReferencesPanel />
          </Panel>
        </div>
        {collapsed.left && <Strip side="left" label="Show idea and references" text="Idea & notes" onClick={() => toggle("left")} className="hidden lg:flex" />}
      </div>

      {/* Centre: the notebook sections with generated outputs. Can only go aside on a wide screen (xl). */}
      <div className="order-3 min-w-0 lg:order-none">
        <div className={collapsed.centre ? "xl:hidden" : ""}>
          <div className="sticky top-2 z-10 mb-2 hidden justify-end xl:flex">
            <HideButton side="centre" label="Hide the design notebook" onClick={() => toggle("centre")} />
          </div>
          <OutputSections sketchStyle={sketchStyle} />
        </div>
        {collapsed.centre && <Strip side="centre" label="Show the design notebook" text="Design notebook" onClick={() => toggle("centre")} className="hidden xl:flex" />}
      </div>

      {/* Right: generators, spec editor, version history. Only a third column on a wide screen, so only there can it go aside. */}
      <div className="order-2 lg:order-none lg:col-span-2 xl:col-span-1 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
        <div className={collapsed.right ? "xl:hidden" : ""}>
          <div className="sticky top-0 z-10 mb-2 hidden justify-end xl:flex">
            <HideButton side="right" label="Hide generate, spec and history" onClick={() => toggle("right")} />
          </div>
          {/* The heading stays when folded, so there is always something to press to open it again. */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Generate & spec</h2>
            <FoldChevron title="generate and spec" folded={collapsed.tools} onClick={() => toggle("tools")} />
          </div>
          <div className={collapsed.tools ? "hidden" : ""}>
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
        {collapsed.right && <Strip side="right" label="Show generate, spec and history" text="Generate & spec" onClick={() => toggle("right")} className="hidden xl:flex" />}
      </div>
    </div>
  );
}
