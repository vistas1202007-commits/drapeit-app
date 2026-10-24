import { describe, expect, it } from "vitest";
import { splitJobs, STUCK_AFTER_MS, STUCK_MESSAGE } from "./jobs";
import type { GenerationJob } from "./types";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function job(over: Partial<GenerationJob>): GenerationJob {
  return {
    id: "j1", project_id: "p1", generator_id: "pattern", version_number: 1, status: "succeeded", provider: "mock",
    is_mock: true, output: { disclaimer: "x" }, error: null, created_at: new Date(NOW - 5000).toISOString(),
    finished_at: null, stale: false, stale_fields: [], ...over,
  };
}

describe("splitJobs", () => {
  it("leaves finished jobs as they are", () => {
    const done = job({});
    const failed = job({ id: "j2", status: "failed", output: null, error: "Rate limit" });
    const { shown, running } = splitJobs([done, failed], NOW);
    expect(shown).toEqual([done, failed]);
    expect(running.size).toBe(0);
  });

  it("keeps a job that is still running out of the results and reports it as running", () => {
    const { shown, running } = splitJobs([job({ id: "r", status: "running", output: null }), job({ id: "old" })], NOW);
    expect(shown.map((j) => j.id)).toEqual(["old"]);
    expect([...running]).toEqual(["pattern"]);
  });

  it("shows a job that has been running too long as failed, so it can be retried", () => {
    const stuck = job({ status: "running", output: null, created_at: new Date(NOW - STUCK_AFTER_MS - 1000).toISOString() });
    const { shown, running } = splitJobs([stuck], NOW);
    expect(running.size).toBe(0);
    expect(shown[0]).toMatchObject({ status: "failed", error: STUCK_MESSAGE });
  });

  it("never passes on a finished job without output", () => {
    const { shown } = splitJobs([job({ output: null })], NOW);
    expect(shown[0].status).toBe("failed");
  });
});
