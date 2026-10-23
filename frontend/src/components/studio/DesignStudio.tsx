"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge, ProviderBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import {
  addLayer,
  addShape,
  clearAll,
  createHistory,
  fitImage,
  isDocEmpty,
  moveLayer,
  parseDoc,
  pushHistory,
  redo,
  removeLayer,
  renderDoc,
  undo,
  updateLayer,
  type CanvasDoc,
  type DrawTool,
  type History,
  type ImageCache,
  type Shape,
  type Tool,
} from "@/lib/canvas/model";
import { generatedImageSrc, timeAgo } from "@/lib/format";
import { SKETCH_STYLES, type SketchOutput } from "@/lib/types";

const TOOLS: { id: Tool; label: string; key: string; icon?: IconName; glyph?: string }[] = [
  { id: "pencil", label: "Pencil", key: "p", glyph: "✎" },
  { id: "pen", label: "Pen", key: "n", icon: "pen" },
  { id: "brush", label: "Brush", key: "b", glyph: "🖌" },
  { id: "eraser", label: "Eraser", key: "e", glyph: "⌫" },
  { id: "line", label: "Line", key: "l", glyph: "╱" },
  { id: "rect", label: "Rectangle", key: "r", glyph: "▭" },
  { id: "ellipse", label: "Ellipse", key: "o", glyph: "◯" },
];

const SWATCHES = ["#24201d", "#6c645c", "#7a1f35", "#b3262e", "#c7a24a", "#2f6b4f", "#1f2d52", "#3567a8", "#e58fa8", "#ffffff"];
const DRAW_TOOLS: Tool[] = ["pencil", "pen", "brush", "eraser"];
const MAX_IMPORT_MB = 8;

/** Load an image file and shrink it so the saved drawing stays small. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Pictures from our backend are on another port; this lets the canvas use them.
    if (/^https?:/.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = src;
  });
}

async function toDownscaledDataUrl(src: string, maxSide = 1400, upscale = false): Promise<{ url: string; w: number; h: number }> {
  const img = await loadImage(src);
  // Generated SVG sketches are small but sharp at any size, so they may be enlarged.
  const fit = maxSide / Math.max(img.naturalWidth, img.naturalHeight);
  const scale = upscale ? fit : Math.min(1, fit);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { url: c.toDataURL("image/jpeg", 0.88), w, h };
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

export function DesignStudio() {
  const { projectId, detail, refresh } = useProject();
  const { confirm, dialog } = useConfirm();

  const [history, setHistory] = useState<History | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState("sketch");
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState("#24201d");
  const [size, setSize] = useState(4);
  const [savedDoc, setSavedDoc] = useState<CanvasDoc | null>(null);
  const [saving, setSaving] = useState<"canvas" | "snapshot" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Bumped when an image finishes loading, so the canvas redraws with it.
  const [imageTick, setImageTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<ImageCache>(new Map());
  const draftRef = useRef<Shape | null>(null);
  const frameRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doc = history?.present ?? null;
  const dirty = doc !== null && doc !== savedDoc;
  const activeLayer = doc?.layers.find((l) => l.id === activeLayerId) ?? doc?.layers[doc.layers.length - 1];

  // ---------- load the saved drawing ----------
  useEffect(() => {
    let cancelled = false;
    api
      .getCanvas(projectId)
      .then((res) => {
        if (cancelled) return;
        const d = parseDoc(res.data);
        setHistory(createHistory(d));
        setSavedDoc(d);
        setActiveLayerId(d.layers[d.layers.length - 1].id);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ---------- drawing ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !doc) return;
    if (!scratchRef.current) scratchRef.current = document.createElement("canvas");
    const extra = draftRef.current && activeLayer ? { layerId: activeLayer.id, shape: draftRef.current } : null;
    renderDoc(ctx, doc, imagesRef.current, () => setImageTick((t) => t + 1), extra, scratchRef.current);
  }, [doc, activeLayer]);

  useEffect(() => {
    draw();
  }, [draw, imageTick]);

  const scheduleDraw = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  };

  const commit = useCallback((next: CanvasDoc) => setHistory((h) => (h ? pushHistory(h, next) : h)), []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * (doc?.width ?? 1),
      y: ((e.clientY - rect.top) / rect.height) * (doc?.height ?? 1),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!doc || !activeLayer || e.button !== 0) return;
    if (!activeLayer.visible) {
      setStatus({ tone: "err", text: `The layer "${activeLayer.name}" is hidden. Show it to draw on it.` });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = point(e);
    if (DRAW_TOOLS.includes(tool)) {
      draftRef.current = { type: "stroke", tool: tool as DrawTool, color: tool === "eraser" ? "#000000" : color, size, points: [x, y] };
    } else {
      draftRef.current = { type: tool as "line" | "rect" | "ellipse", color, size, x1: x, y1: y, x2: x, y2: y };
    }
    scheduleDraw();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = draftRef.current;
    if (!d) return;
    const { x, y } = point(e);
    if (d.type === "stroke") {
      const n = d.points.length;
      if (Math.hypot(x - d.points[n - 2], y - d.points[n - 1]) < 1.5) return;
      d.points.push(x, y);
    } else if (d.type !== "image") {
      d.x2 = x;
      d.y2 = y;
    }
    scheduleDraw();
  }

  function onPointerUp() {
    const d = draftRef.current;
    draftRef.current = null;
    if (!d || !doc || !activeLayer) return;
    commit(addShape(doc, activeLayer.id, d));
  }

  // ---------- actions ----------
  const doUndo = useCallback(() => setHistory((h) => (h ? undo(h) : h)), []);
  const doRedo = useCallback(() => setHistory((h) => (h ? redo(h) : h)), []);

  const saveCanvas = useCallback(async () => {
    if (!doc) return false;
    setSaving("canvas");
    setStatus(null);
    try {
      await api.saveCanvas(projectId, doc);
      setSavedDoc(doc);
      setStatus({ tone: "ok", text: "Drawing saved to the project." });
      return true;
    } catch (e) {
      setStatus({ tone: "err", text: e instanceof Error ? e.message : "Save failed" });
      return false;
    } finally {
      setSaving(null);
    }
  }, [doc, projectId]);

  function canvasBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      draftRef.current = null;
      draw();
      canvasRef.current?.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the canvas."))), "image/png");
    });
  }

  async function downloadPng() {
    try {
      const blob = await canvasBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${detail?.project.title ?? "sketch"}.png`.replace(/[^\w.\- ]/g, "");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setStatus({ tone: "err", text: e instanceof Error ? e.message : "Download failed" });
    }
  }

  async function saveSnapshot() {
    if (!doc) return;
    setSaving("snapshot");
    setStatus(null);
    try {
      await api.saveCanvas(projectId, doc);
      setSavedDoc(doc);
      const blob = await canvasBlob();
      await api.uploadAsset(projectId, blob, "studio-sketch.png", "sketch");
      await refresh();
      setStatus({ tone: "ok", text: "Saved. The picture is now the project thumbnail and appears under References." });
    } catch (e) {
      setStatus({ tone: "err", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(null);
    }
  }

  async function clearCanvas() {
    if (!doc) return;
    const ok = await confirm({ title: "Clear the whole canvas?", message: "Every layer is emptied. You can still press Undo afterwards.", confirmLabel: "Clear canvas", danger: true });
    if (ok) commit(clearAll(doc));
  }

  async function placeImage(src: string, name: string, upscale = false) {
    if (!doc) return;
    const { url, w, h } = await toDownscaledDataUrl(src, 1200, upscale);
    const { doc: withLayer, id } = addLayer(doc, name);
    // Put the new image layer at the bottom so you can trace over it.
    const layers = [withLayer.layers[withLayer.layers.length - 1], ...withLayer.layers.slice(0, -1)];
    const next = addShape({ ...withLayer, layers }, id, { type: "image", src: url, ...fitImage(w, h, doc), label: name });
    commit(next);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setStatus(null);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Only PNG, JPEG or WebP images can be imported.");
      if (file.size > MAX_IMPORT_MB * 1024 * 1024) throw new Error(`Images must be smaller than ${MAX_IMPORT_MB} MB.`);
      await placeImage(await readFile(file), `Image: ${file.name.slice(0, 30)}`);
    } catch (e) {
      setStatus({ tone: "err", text: e instanceof Error ? e.message : "Import failed" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLayerConfirmed(id: string) {
    if (!doc) return;
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    if (layer.shapes.length > 0) {
      const ok = await confirm({ title: `Delete layer "${layer.name}"?`, message: "Its drawing is removed. You can press Undo afterwards.", confirmLabel: "Delete layer", danger: true });
      if (!ok) return;
    }
    const next = removeLayer(doc, id);
    commit(next);
    if (activeLayerId === id) setActiveLayerId(next.layers[next.layers.length - 1].id);
  }

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, dialog")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCanvas();
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo, saveCanvas]);

  // Warn before leaving the page with unsaved drawing changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <Notice tone="err" title="Could not load the drawing">
          {loadError}
        </Notice>
      </div>
    );
  }
  if (!doc || !history) {
    return (
      <div className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
        <Spinner /> Loading canvas…
      </div>
    );
  }

  const sketches = (detail?.jobs ?? [])
    .filter((j) => (j.generator_id === "sketch" || j.generator_id === "visual_preview") && j.status === "succeeded")
    .slice(0, 9);
  const layersTopFirst = [...doc.layers].reverse();

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      {dialog}
      <div className="min-w-0">
        {/* Toolbar */}
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface shadow-card p-2 lg:top-2">
          <div role="radiogroup" aria-label="Drawing tool" className="flex flex-wrap gap-1">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tool === t.id}
                title={`${t.label} (${t.key.toUpperCase()})`}
                onClick={() => setTool(t.id)}
                className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition-colors ${tool === t.id ? "bg-wine text-on-wine" : "text-ink hover:bg-sunken"}`}
              >
                {t.icon ? <Icon name={t.icon} /> : <span aria-hidden className="text-[15px] leading-none">{t.glyph}</span>}
                <span className="hidden xl:inline">{t.label}</span>
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
          <div className="flex items-center gap-1" aria-label="Colour">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border ${color === c ? "ring-2 ring-wine ring-offset-1" : "border-line-strong"}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-line-strong" title="Custom colour">
              <span className="sr-only">Custom colour</span>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute -inset-2 h-12 w-12 cursor-pointer" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            Size
            <input type="range" min={1} max={60} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-wine" />
            <span className="w-6 tabular-nums text-ink">{size}</span>
          </label>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={doUndo} disabled={history.past.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Icon name="undo" />
            </Button>
            <Button size="sm" variant="ghost" onClick={doRedo} disabled={history.future.length === 0} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <Icon name="redo" />
            </Button>
            <Button size="sm" variant="ghost" onClick={clearCanvas} disabled={isDocEmpty(doc)}>
              Clear
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-sunken p-3 sm:p-5">
          <canvas
            ref={canvasRef}
            width={doc.width}
            height={doc.height}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label={`Drawing canvas. Active tool: ${tool}. Active layer: ${activeLayer?.name}.`}
            className="mx-auto block h-auto max-h-[78vh] w-auto max-w-full touch-none rounded bg-canvas shadow-sm"
            style={{ aspectRatio: `${doc.width} / ${doc.height}`, cursor: tool === "eraser" ? "cell" : "crosshair" }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Shortcuts: P pencil · N pen · B brush · E eraser · L line · R rectangle · O ellipse · Ctrl+Z undo · Ctrl+S save
        </p>
      </div>

      {/* Side panel */}
      <div className="space-y-4 lg:sticky lg:top-2 lg:max-h-[calc(100vh-1rem)] lg:self-start lg:overflow-y-auto">
        <section className="rounded-lg border border-line bg-surface shadow-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Save & export</h2>
            {dirty ? <Badge tone="warn">Unsaved</Badge> : <Badge tone="ok">Saved</Badge>}
          </div>
          <div className="mt-3 grid gap-2">
            <Button variant="primary" onClick={saveCanvas} loading={saving === "canvas"} disabled={!dirty}>
              <Icon name="save" /> Save drawing
            </Button>
            <Button onClick={saveSnapshot} loading={saving === "snapshot"}>
              <Icon name="image" /> Save as project sketch
            </Button>
            <Button onClick={downloadPng}>
              <Icon name="download" /> Download PNG
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> Import image
            </Button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
          </div>
          {status && (
            <p role={status.tone === "err" ? "alert" : "status"} className={`mt-2 text-xs ${status.tone === "err" ? "text-err" : "text-ok"}`}>
              {status.text}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface shadow-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Layers</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const { doc: next, id } = addLayer(doc, `Layer ${doc.layers.length + 1}`);
                commit(next);
                setActiveLayerId(id);
              }}
            >
              <Icon name="plus" className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <ul className="mt-2 space-y-1">
            {layersTopFirst.map((layer) => {
              const active = layer.id === activeLayer?.id;
              const index = doc.layers.indexOf(layer);
              return (
                <li key={layer.id} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 ${active ? "border-wine/40 bg-wine-soft" : "border-transparent hover:bg-sunken"}`}>
                  <button type="button" aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`} onClick={() => commit(updateLayer(doc, layer.id, { visible: !layer.visible }))} className="rounded p-1 text-muted hover:text-ink">
                    <Icon name={layer.visible ? "eye" : "eyeOff"} className="h-3.5 w-3.5" />
                  </button>
                  {renaming === layer.id ? (
                    <input
                      autoFocus
                      aria-label="Layer name"
                      defaultValue={layer.name}
                      maxLength={40}
                      className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-1 text-sm"
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== layer.name) commit(updateLayer(doc, layer.id, { name }));
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <button type="button" onClick={() => setActiveLayerId(layer.id)} onDoubleClick={() => setRenaming(layer.id)} className="min-w-0 flex-1 truncate text-left text-sm" title="Click to draw on this layer, double-click to rename">
                      {layer.name}
                      <span className="ml-1 text-[11px] text-faint">{layer.shapes.length}</span>
                    </button>
                  )}
                  <button type="button" aria-label="Move layer up" disabled={index === doc.layers.length - 1} onClick={() => commit(moveLayer(doc, layer.id, 1))} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30">
                    <Icon name="up" className="h-3 w-3" />
                  </button>
                  <button type="button" aria-label="Move layer down" disabled={index === 0} onClick={() => commit(moveLayer(doc, layer.id, -1))} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30">
                    <Icon name="down" className="h-3 w-3" />
                  </button>
                  <button type="button" aria-label={`Delete ${layer.name}`} disabled={doc.layers.length <= 1} onClick={() => removeLayerConfirmed(layer.id)} className="rounded p-1 text-muted hover:text-err disabled:opacity-30">
                    <Icon name="trash" className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-faint">You draw on the highlighted layer. The eraser only erases that layer. Double-click a name to rename it.</p>
        </section>

        <section className="rounded-lg border border-line bg-surface shadow-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Generated pictures</h2>
          <p className="mt-1 text-[11px] text-muted">These are pictures, not editable drawings. Place one on its own layer and trace over it.</p>
          {sketches.length === 0 ? (
            <p className="mt-3 text-xs text-faint">No generated sketches yet. Generate one in the Notebook.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {sketches.map((job) => {
                const out = job.output as unknown as SketchOutput;
                const src = generatedImageSrc(out);
                if (!src) return null;
                const label = job.generator_id === "visual_preview" ? "Visual preview" : (SKETCH_STYLES.find((s) => s.id === out.style)?.label ?? out.style);
                const isSvg = !out.asset_id || src.startsWith("data:image/svg");
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      className="group block w-full overflow-hidden rounded-md border border-line bg-canvas text-left hover:border-wine"
                      title={`Place "${label}" on the canvas`}
                      onClick={() =>
                        placeImage(src, `Generated: ${label} (v${job.version_number})`, isSvg).catch((e: Error) => setStatus({ tone: "err", text: e.message }))
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- generated picture from our API or an SVG data URL */}
                      <img src={src} alt={label} className="aspect-[2/3] w-full object-cover" />
                    </button>
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted">
                      <ProviderBadge isMock={job.is_mock} provider={job.provider} />
                      <span className="truncate">{timeAgo(job.created_at)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

