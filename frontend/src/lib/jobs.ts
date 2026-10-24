// Which generation jobs can be shown as results, kept free of React so it can be tested.
import type { GenerationJob } from "./types";

/** A job still "running" after this long will not finish (the server stopped or restarted). */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

export const STUCK_MESSAGE = "This run did not finish. Press Retry to run it again.";

/**
 * The backend saves a new job as "running" (with no output) before the generator answers. A project loaded at
 * that moment contains it, and drawing it as a finished result crashes the output views. So:
 * - recent running jobs are left out of the results and reported as "running" (shown as "Generating…");
 * - running jobs older than STUCK_AFTER_MS are shown as failed, so they can be retried;
 * - a job that says it succeeded but has no output is shown as failed too.
 */
export function splitJobs(jobs: GenerationJob[], now: number = Date.now()): { shown: GenerationJob[]; running: Set<string> } {
  const running = new Set<string>();
  const shown: GenerationJob[] = [];
  for (const job of jobs) {
    if (job.status === "running") {
      const age = now - Date.parse(job.created_at);
      if (Number.isNaN(age) || age < STUCK_AFTER_MS) {
        running.add(job.generator_id);
        continue;
      }
      shown.push({ ...job, status: "failed", error: STUCK_MESSAGE });
    } else if (job.status === "succeeded" && job.output == null) {
      shown.push({ ...job, status: "failed", error: job.error || STUCK_MESSAGE });
    } else {
      shown.push(job);
    }
  }
  return { shown, running };
}
