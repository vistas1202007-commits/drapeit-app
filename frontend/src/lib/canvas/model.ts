// The Design Studio drawing is stored as data (a list of shapes in layers),
// not as pixels. That makes undo/redo, layers and saving simple, and means
// the drawing can be re-opened and edited later.

export type DrawTool = "pencil" | "pen" | "brush" | "eraser";
export type ShapeTool = "line" | "rect" | "ellipse";
export type Tool = DrawTool | ShapeTool;

export interface StrokeShape {
  type: "stroke";
  tool: DrawTool;
  color: string;
  size: number;
  points: number[]; // x0, y0, x1, y1, ...
}

export interface GeometryShape {
  type: ShapeTool;
  color: string;
  size: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ImageShape {
  type: "image";
  src: string; // data URL
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export type Shape = StrokeShape | GeometryShape | ImageShape;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  shapes: Shape[];
}

export interface CanvasDoc {
  version: 1;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 1300;

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyDoc(): CanvasDoc {
  return {
    version: 1,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    background: "#ffffff",
    layers: [
      { id: "reference", name: "Reference", visible: true, shapes: [] },
      { id: "sketch", name: "Sketch", visible: true, shapes: [] },
    ],
  };
}

/** Accepts whatever was saved and returns a valid document (or an empty one). */
export function parseDoc(data: unknown): CanvasDoc {
  const d = data as Partial<CanvasDoc> | null;
  if (!d || d.version !== 1 || !Array.isArray(d.layers) || d.layers.length === 0) return emptyDoc();
  return {
    version: 1,
    width: d.width ?? CANVAS_WIDTH,
    height: d.height ?? CANVAS_HEIGHT,
    background: d.background ?? "#ffffff",
    layers: d.layers.map((l) => ({
      id: String(l.id),
      name: String(l.name),
      visible: l.visible !== false,
      shapes: Array.isArray(l.shapes) ? l.shapes : [],
    })),
  };
}

export function isDocEmpty(doc: CanvasDoc): boolean {
  return doc.layers.every((l) => l.shapes.length === 0);
}

// ---------- undo / redo history ----------

export interface History {
  past: CanvasDoc[];
  present: CanvasDoc;
  future: CanvasDoc[];
}

const HISTORY_LIMIT = 100;

export function createHistory(doc: CanvasDoc): History {
  return { past: [], present: doc, future: [] };
}

export function pushHistory(h: History, next: CanvasDoc): History {
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// ---------- document edits (always return a new document) ----------

export function addShape(doc: CanvasDoc, layerId: string, shape: Shape): CanvasDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === layerId ? { ...l, shapes: [...l.shapes, shape] } : l)) };
}

export function updateLayer(doc: CanvasDoc, layerId: string, patch: Partial<Omit<Layer, "id">>): CanvasDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) };
}

export function addLayer(doc: CanvasDoc, name: string): { doc: CanvasDoc; id: string } {
  const id = makeId();
  return { doc: { ...doc, layers: [...doc.layers, { id, name, visible: true, shapes: [] }] }, id };
}

export function removeLayer(doc: CanvasDoc, layerId: string): CanvasDoc {
  if (doc.layers.length <= 1) return doc;
  return { ...doc, layers: doc.layers.filter((l) => l.id !== layerId) };
}

export function moveLayer(doc: CanvasDoc, layerId: string, direction: -1 | 1): CanvasDoc {
  const i = doc.layers.findIndex((l) => l.id === layerId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...doc, layers };
}

export function clearAll(doc: CanvasDoc): CanvasDoc {
  return { ...doc, layers: doc.layers.map((l) => ({ ...l, shapes: [] })) };
}

// ---------- drawing ----------

const TOOL_STYLE: Record<DrawTool, { widthScale: number; alpha: number }> = {
  pencil: { widthScale: 0.6, alpha: 0.75 },
  pen: { widthScale: 1, alpha: 1 },
  brush: { widthScale: 2.2, alpha: 0.55 },
  eraser: { widthScale: 2.5, alpha: 1 },
};

function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeShape) {
  const style = TOOL_STYLE[s.tool];
  const pts = s.points;
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
  ctx.globalAlpha = style.alpha;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = Math.max(0.5, s.size * style.widthScale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 2) {
    // A single click draws a dot.
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  // Smooth the line by drawing curves through the midpoints between samples.
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
  }
  ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
  ctx.stroke();
  ctx.restore();
}

function drawGeometry(ctx: CanvasRenderingContext2D, s: GeometryShape) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (s.type === "line") {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  } else if (s.type === "rect") {
    ctx.rect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
  } else {
    ctx.ellipse(
      (s.x1 + s.x2) / 2,
      (s.y1 + s.y2) / 2,
      Math.abs(s.x2 - s.x1) / 2,
      Math.abs(s.y2 - s.y1) / 2,
      0,
      0,
      Math.PI * 2,
    );
  }
  ctx.stroke();
  ctx.restore();
}

export type ImageCache = Map<string, HTMLImageElement>;

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, images: ImageCache, onImageLoad: () => void) {
  if (shape.type === "stroke") return drawStroke(ctx, shape);
  if (shape.type === "image") {
    let img = images.get(shape.src);
    if (!img) {
      img = new Image();
      img.onload = onImageLoad;
      img.src = shape.src;
      images.set(shape.src, img);
    }
    if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, shape.x, shape.y, shape.w, shape.h);
    return;
  }
  drawGeometry(ctx, shape);
}

/**
 * Draw the whole document. Each layer is drawn on its own scratch canvas first
 * so the eraser only removes marks from its own layer.
 */
export function renderDoc(
  ctx: CanvasRenderingContext2D,
  doc: CanvasDoc,
  images: ImageCache,
  onImageLoad: () => void,
  extra?: { layerId: string; shape: Shape } | null,
  scratch?: HTMLCanvasElement,
) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  ctx.restore();
  const layerCanvas = scratch ?? document.createElement("canvas");
  layerCanvas.width = doc.width;
  layerCanvas.height = doc.height;
  const lctx = layerCanvas.getContext("2d");
  if (!lctx) return;
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    lctx.clearRect(0, 0, doc.width, doc.height);
    for (const shape of layer.shapes) drawShape(lctx, shape, images, onImageLoad);
    if (extra && extra.layerId === layer.id) drawShape(lctx, extra.shape, images, onImageLoad);
    ctx.drawImage(layerCanvas, 0, 0);
  }
}

/** Fit an image of (w, h) inside the canvas, centred, leaving a margin. */
export function fitImage(w: number, h: number, doc: CanvasDoc, margin = 40) {
  const scale = Math.min((doc.width - margin * 2) / w, (doc.height - margin * 2) / h, 1);
  const fw = w * scale;
  const fh = h * scale;
  return { x: (doc.width - fw) / 2, y: (doc.height - fh) / 2, w: fw, h: fh };
}
