import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function walk(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute, predicate)));
    } else if (entry.isFile() && predicate(absolute)) {
      files.push(absolute);
    }
  }

  return files;
}

const sourceFiles = await walk(path.join(root, "src"), (file) => file.endsWith(".ts") || file.endsWith(".css"));
const distFiles = await walk(path.join(root, "dist"), (file) => file.endsWith(".js"));
const sourceText = (await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))).join("\n");
const indexText = await readFile(path.join(root, "index.html"), "utf8");
const stylesText = await readFile(path.join(root, "src", "styles.css"), "utf8");
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const assetVersion = encodeURIComponent(packageMetadata.version);

const requiredPatterns = [
  ["meters unit contract", /unit:\s*"meters"/],
  ["right-hand coordinate contract", /handedness:\s*"right-hand"/],
  ["camera mirror transform", /scaleX\(-1\)/],
  ["RAF render pull loop", /requestAnimationFrame/],
  ["Quaternion smoothing", /\.slerp\(/],
  ["seed switch disposal", /disposeSceneResources\(/],
  ["frame buffer consumption", /pushPacket\(packet/],
];

const forbiddenPatterns = [
  ["Euler rotation transport", /\bEuler\b/],
  ["React high-frequency useState", /\buseState\b/],
  ["Vue high-frequency ref", /\bref\(/],
];

const failures = [];

for (const [label, pattern] of requiredPatterns) {
  if (!pattern.test(sourceText)) failures.push(`Missing guardrail: ${label}`);
}

for (const [label, pattern] of forbiddenPatterns) {
  if (pattern.test(sourceText)) failures.push(`Forbidden pattern found: ${label}`);
}

if (!indexText.includes(`href="./src/styles.css?v=${assetVersion}"`)) {
  failures.push("Frontend stylesheet entry does not match package asset version");
}
if (!indexText.includes(`src="./dist/main.js?v=${assetVersion}"`)) {
  failures.push("Frontend module entry does not match package asset version");
}
const displayedVersions = [...indexText.matchAll(/motion coaching system · v([0-9.]+)/gi)].map((match) => match[1]);
if (displayedVersions.length === 0 || displayedVersions.some((version) => version !== packageMetadata.version)) {
  failures.push("Displayed frontend version does not match package asset version");
}

for (const match of stylesText.matchAll(/@import\s+["'](\.[^"']+)["']/g)) {
  if (!match[1].endsWith(`?v=${assetVersion}`)) {
    failures.push(`CSS import does not match package asset version: ${match[1]}`);
  }
}

for (const file of distFiles) {
  const code = await readFile(file, "utf8");
  for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+\.js(?:\?[^"']*)?)["']/g)) {
    if (!match[1].endsWith(`?v=${assetVersion}`)) {
      failures.push(`Module import does not match package asset version in ${path.relative(root, file)}: ${match[1]}`);
    }
  }
  const result = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    failures.push(`Syntax check failed for ${path.relative(root, file)}\n${result.stderr || result.stdout}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Guardrails passed for ${sourceFiles.length} source files and ${distFiles.length} built modules`);
