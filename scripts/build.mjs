import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const outputRoot = path.join(root, "dist");

async function walk(directory) {
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(directory, { withFileTypes: true }));
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(absolute);
    }
  }

  return files;
}

await rm(outputRoot, { recursive: true, force: true });

const files = await walk(sourceRoot);
for (const file of files) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(sourceRoot, file);
  const output = path.join(outputRoot, relative).replace(/\.ts$/, ".js");
  // Node preserves source columns by replacing stripped types with spaces.
  // Normalize line endings so a clean checkout stays clean after every build.
  const code = stripTypeScriptTypes(source, { mode: "strip" }).replace(/[\t ]+$/gm, "");

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, code, "utf8");
}

console.log(`Built ${files.length} TypeScript modules into dist/`);
