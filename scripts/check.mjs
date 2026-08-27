import { readFile, readdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const dom = new JSDOM(html),
  doc = dom.window.document;
const ids = [...doc.querySelectorAll("[id]")].map((node) => node.id);
assert.equal(new Set(ids).size, ids.length, "Duplicate HTML IDs");
assert.ok(
  doc.getElementById("private-app").hidden,
  "Private UI must start hidden",
);
assert.equal(
  doc.querySelectorAll("script:not([src])").length,
  0,
  "Keep executable code in modules",
);
for (const node of doc.querySelectorAll("[src],link[href],a[href]")) {
  const value = node.getAttribute("src") || node.getAttribute("href");
  if (value.startsWith("./")) await access(resolve(root, value));
}
let checked = 0;
for (const name of await readdir(resolve(root, "js"))) {
  if (!name.endsWith(".js")) continue;
  const filename = resolve(root, "js", name),
    code = await readFile(filename, "utf8");
  execFileSync(process.execPath, ["--check", filename]);
  checked++;
  assert.ok(
    !/\.innerHTML\s*=|insertAdjacentHTML\(|\beval\(/.test(code),
    `${name}: unsafe DOM/code sink`,
  );
  for (const match of code.matchAll(
    /(?:from\s*|import\()\s*["'](\.[^"']+)["']/g,
  ))
    await access(resolve(dirname(filename), match[1]));
  for (const match of code.matchAll(
    /(?:\$|getElementById)\(["']([^"']+)["']\)/g,
  ))
    assert.ok(ids.includes(match[1]), `${name}: missing #${match[1]}`);
}
dom.window.close();
console.log(
  `Static check passed: ${checked} JavaScript modules, ${ids.length} unique HTML IDs and all local assets.`,
);
