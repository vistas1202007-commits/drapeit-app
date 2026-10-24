// npm run e2e:cleanup — deletes every QA account (qa-drapeit-…@example.com) and everything it made.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const backend = path.resolve(frontend, "..", "backend");
const python = path.join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
process.stdout.write(execFileSync(python, ["scripts/qa_users.py", "cleanup"], { cwd: backend, encoding: "utf-8" }));
rmSync(path.join(frontend, "e2e", ".auth"), { recursive: true, force: true });
