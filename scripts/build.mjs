import { cp, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [resolve(root, "scripts/check.mjs")], {
  stdio: "inherit",
});
const output = resolve(root, "dist");
await mkdir(output, { recursive: true });
// Allowlist: no tests, credentials, local backups, dependencies or repository metadata.
for (const name of [
  "images",
  "index.html",
  "styles.css",
  ".nojekyll",
  "js",
  "docs",
  "data",
]) {
  await cp(resolve(root, name), resolve(output, name), {
    recursive: true,
    // docs/ also holds the multi-hundred-MB source workbooks and, on some
    // machines, private health exports. Neither may reach a published site.
    filter: (path) =>
      !/(FOOD DATABASE|health_checkups|private-data|backups)/.test(path),
  });
}
console.log(
  `Static site copied to ${output}. Firebase rules must be published separately.`,
);
