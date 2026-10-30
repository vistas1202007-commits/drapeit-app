import { createRoot } from "react-dom/client";
import { FixtureProject } from "./project";
import { VideoView } from "../../src/components/outputs/VideoView";
import { StitchingGuideView } from "../../src/components/outputs/StitchingGuideView";
import type { GenerationJob } from "../../src/lib/types";
import fixtures from "./fixtures.json";
const name = new URLSearchParams(location.search).get("case") || "video";
const output = (fixtures as Record<string, unknown>)[name] || fixtures.video;
const job: GenerationJob = { id: "fixture-job", project_id: "fixture", generator_id: name.includes("guide") ? "stitching_guide" : "video",
  version_number: 1, status: "succeeded", provider: "fixture", is_mock: true, output: output as Record<string, unknown>, stale: false, stale_fields: [], error: null,
  created_at: "2026-10-29T00:00:00Z", finished_at: "2026-10-29T00:00:01Z" };
createRoot(document.getElementById("root")!).render(
  <FixtureProject><main className="mx-auto max-w-4xl p-4 sm:p-8">
    <p className="mb-4 text-xs text-muted">Offline browser fixture · no live AI or tutorial claims</p>
    {name.includes("guide") ? <StitchingGuideView job={job} /> : <VideoView job={job} />}
  </main></FixtureProject>,
);
