// Real product components, styles and React; fake project API/auth only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
const frontend = fileURLToPath(new URL("../../", import.meta.url));
const fixture = resolve(frontend, "e2e/offline");
const bundled = await build({
  entryPoints: [resolve(fixture, "main.tsx")], bundle: true, write: false, format: "esm",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "fixture-context", setup(builder) {
    builder.onResolve({ filter: /^@\// }, ({ path }) => {
      if (path === "@/components/project/ProjectContext") return { path: resolve(fixture, "project.tsx") };
      if (path === "@/lib/api") return { path: resolve(fixture, "api.ts") };
      const base = resolve(frontend, "src", path.slice(2));
      return { path: [base + ".ts", base + ".tsx"].find(existsSync) || base };
    });
  }}],
});
const cssSource = await readFile(resolve(frontend, "src/app/globals.css"), "utf8");
const compiler = await compile(cssSource, { base: resolve(frontend, "src/app"), onDependency() {} });
const scanner = new Scanner({ sources: [{ base: resolve(frontend, "src"), pattern: "**/*.{ts,tsx}", negated: false },
                                         { base: fixture, pattern: "**/*.tsx", negated: false }] });
const css = compiler.build(scanner.scan());
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stitching browser fixture</title><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundled.outputFiles[0].text); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html"); res.end(html); }
}).listen(3107, "127.0.0.1", () => process.stdout.write("Stitching fixture ready at http://127.0.0.1:3107\n"));
