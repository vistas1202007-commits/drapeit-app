import { mkdirSync } from "node:fs";
import { AUTH_DIR, hasUsers, runQaScript, USERS_FILE } from "./qa";

// Makes the three QA accounts once (a = admin, b and c = ordinary people). They are reused by later
// runs until `npm run e2e:cleanup` deletes them.
export default function globalSetup(): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  if (!hasUsers()) process.stdout.write(runQaScript("create", USERS_FILE));
}
