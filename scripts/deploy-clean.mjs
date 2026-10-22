import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanPlugin = "D:\\Projects\\obsidian-ai-reading-companion-clean-test\\.obsidian\\plugins\\backleaf";
const artifacts = ["main.js", "manifest.json", "styles.css"];

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex").toUpperCase();
}

await mkdir(cleanPlugin, { recursive: true });

for (const name of artifacts) {
  await copyFile(path.join(repoRoot, name), path.join(cleanPlugin, name));
}

const hashes = await Promise.all(artifacts.map(async (name) => {
  const source = await sha256(path.join(repoRoot, name));
  const target = await sha256(path.join(cleanPlugin, name));
  return { name, source, target, match: source === target };
}));

console.log("SOURCE BUILD:");
for (const { name, source } of hashes) console.log(`${name}: ${source}`);
console.log("\nCLEAN TEST:");
for (const { name, target } of hashes) console.log(`${name}: ${target}`);
console.log("\nHASH MATCH:");
for (const { name, match } of hashes) console.log(`${name}: ${match ? "YES" : "NO"}`);

if (hashes.some(({ match }) => !match)) {
  console.error("\nClean Test deployment hash verification failed.");
  process.exitCode = 1;
} else {
  console.log("\nREADY FOR RUNTIME: YES");
}
