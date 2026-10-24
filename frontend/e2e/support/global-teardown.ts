import { rmSync } from "node:fs";
import { AUTH_DIR, runQaScript } from "./qa";

// With E2E_CLEANUP=1 the QA accounts and everything they made are deleted after the run.
// Without it they are kept, so a failing test can be run again quickly.
export default function globalTeardown(): void {
  if (process.env.E2E_CLEANUP !== "1") return;
  process.stdout.write(runQaScript("cleanup"));
  rmSync(AUTH_DIR, { recursive: true, force: true });
}
