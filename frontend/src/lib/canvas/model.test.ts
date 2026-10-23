import { describe, expect, it } from "vitest";
import { addLayer, addShape, clearAll, createHistory, emptyDoc, moveLayer, parseDoc, pushHistory, redo, removeLayer, undo, type Shape } from "./model";

const dot: Shape = { type: "stroke", tool: "pen", color: "#000", size: 2, points: [1, 1] };

describe("canvas model", () => {
  it("undo and redo walk through history", () => {
    let h = createHistory(emptyDoc());
    h = pushHistory(h, addShape(h.present, "sketch", dot));
    expect(h.present.layers[1].shapes).toHaveLength(1);
    h = undo(h);
    expect(h.present.layers[1].shapes).toHaveLength(0);
    h = redo(h);
    expect(h.present.layers[1].shapes).toHaveLength(1);
  });

  it("a new edit clears the redo stack", () => {
    let h = createHistory(emptyDoc());
    h = pushHistory(h, addShape(h.present, "sketch", dot));
    h = undo(h);
    h = pushHistory(h, addShape(h.present, "reference", dot));
    expect(h.future).toHaveLength(0);
  });

  it("does not mutate the previous document", () => {
    const a = emptyDoc();
    const b = addShape(a, "sketch", dot);
    expect(a.layers[1].shapes).toHaveLength(0);
    expect(clearAll(b).layers[1].shapes).toHaveLength(0);
    expect(b.layers[1].shapes).toHaveLength(1);
  });

  it("manages layers and never removes the last one", () => {
    const { doc, id } = addLayer(emptyDoc(), "Extra");
    expect(doc.layers.map((l) => l.id)).toEqual(["reference", "sketch", id]);
    expect(moveLayer(doc, id, -1).layers[1].id).toBe(id);
    const one = removeLayer(removeLayer(doc, "reference"), "sketch");
    expect(removeLayer(one, id).layers).toHaveLength(1);
  });

  it("falls back to an empty document for bad saved data", () => {
    expect(parseDoc(null).layers).toHaveLength(2);
    expect(parseDoc({ version: 9 }).layers).toHaveLength(2);
  });
});
