import { createContext, useContext, useState, type ReactNode } from "react";
import type { DesignSpec } from "../../src/lib/types";
import fixtures from "./fixtures.json";
const Context = createContext<{ detail: { current_spec: DesignSpec }; projectId: string; saveSpec: (spec: DesignSpec) => Promise<void> } | null>(null);
export function FixtureProject({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState(fixtures.spec as unknown as DesignSpec);
  async function saveSpec(next: DesignSpec) {
    setSpec(next);
    localStorage.setItem("fixture-saved-spec", JSON.stringify(next));
  }
  return <Context.Provider value={{ detail: { current_spec: spec }, projectId: "fixture", saveSpec }}>{children}</Context.Provider>;
}
export function useProject() {
  const value = useContext(Context);
  if (!value) throw new Error("Fixture context missing");
  return value;
}
