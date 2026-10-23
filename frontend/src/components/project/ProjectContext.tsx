"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { DesignSpec, GenerationJob, GeneratorInfo, ProjectDetail } from "@/lib/types";

interface ProjectContextValue {
  projectId: string;
  detail: ProjectDetail | null;
  generators: GeneratorInfo[];
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Which generators are running right now (for loading states). */
  running: Record<string, boolean>;
  /** Errors that stopped a request from even reaching the generator (e.g. backend offline). */
  requestErrors: Record<string, string | undefined>;
  runGenerator: (generatorId: string, options?: Record<string, unknown>) => Promise<GenerationJob | null>;
  retryJob: (job: GenerationJob) => Promise<void>;
  saveSpec: (spec: DesignSpec, note?: string) => Promise<void>;
  latestJob: (generatorId: string) => GenerationJob | undefined;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [generators, setGenerators] = useState<GeneratorInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [requestErrors, setRequestErrors] = useState<Record<string, string | undefined>>({});

  const refresh = useCallback(async () => {
    try {
      const d = await api.getProject(projectId);
      setDetail(d);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the project.");
    }
  }, [projectId]);

  useEffect(() => {
    // Load the project and the generator list once when the page opens.
    let cancelled = false;
    Promise.all([api.getProject(projectId), api.generators()])
      .then(([d, g]) => {
        if (cancelled) return;
        setDetail(d);
        setGenerators(g);
        setLoadError(null);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const runGenerator = useCallback(
    async (generatorId: string, options: Record<string, unknown> = {}) => {
      setRunning((r) => ({ ...r, [generatorId]: true }));
      setRequestErrors((r) => ({ ...r, [generatorId]: undefined }));
      try {
        const job = await api.generate(projectId, generatorId, options);
        await refresh();
        return job;
      } catch (e) {
        setRequestErrors((r) => ({ ...r, [generatorId]: e instanceof Error ? e.message : "Request failed" }));
        return null;
      } finally {
        setRunning((r) => ({ ...r, [generatorId]: false }));
      }
    },
    [projectId, refresh],
  );

  const retryJob = useCallback(
    async (job: GenerationJob) => {
      setRunning((r) => ({ ...r, [job.generator_id]: true }));
      setRequestErrors((r) => ({ ...r, [job.generator_id]: undefined }));
      try {
        await api.retryJob(projectId, job.id);
        await refresh();
      } catch (e) {
        setRequestErrors((r) => ({ ...r, [job.generator_id]: e instanceof Error ? e.message : "Retry failed" }));
      } finally {
        setRunning((r) => ({ ...r, [job.generator_id]: false }));
      }
    },
    [projectId, refresh],
  );

  const saveSpec = useCallback(
    async (spec: DesignSpec, note = "") => {
      await api.saveVersion(projectId, spec, note);
      await refresh();
    },
    [projectId, refresh],
  );

  const latestJob = useCallback(
    (generatorId: string) => detail?.jobs.find((j) => j.generator_id === generatorId),
    [detail],
  );

  const value = useMemo(
    () => ({ projectId, detail, generators, loadError, refresh, running, requestErrors, runGenerator, retryJob, saveSpec, latestJob }),
    [projectId, detail, generators, loadError, refresh, running, requestErrors, runGenerator, retryJob, saveSpec, latestJob],
  );
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside <ProjectProvider>");
  return ctx;
}
