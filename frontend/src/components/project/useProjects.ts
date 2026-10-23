"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";

/** Loads the project list, re-fetching when the search or filter changes. */
export function useProjects(search: string, category: string) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .listProjects(search.trim(), category)
        .then((p) => {
          if (cancelled) return;
          setProjects(p);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 200); // small delay so we do not query on every key press
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, category, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { projects, error, reload };
}
