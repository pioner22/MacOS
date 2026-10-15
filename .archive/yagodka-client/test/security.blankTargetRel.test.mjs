import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("src");

async function listFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listFiles(full)));
      continue;
    }
    if (!ent.isFile()) continue;
    if (ent.name.endsWith(".d.ts")) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(ext)) continue;
    out.push(full);
  }
  return out;
}

function hasRelNoopenerNearby(lines, idx) {
  const window = lines.slice(Math.max(0, idx - 3), Math.min(lines.length, idx + 6)).join("\n");
  return /\brel\s*:\s*['"]noopener\b/i.test(window) || /\brel\s*=\s*['"]noopener\b/i.test(window);
}

test('security: target="_blank" всегда с rel=noopener', async () => {
  const files = await listFiles(ROOT);
  const hits = [];

  for (const file of files) {
    const txt = await readFile(file, "utf8");
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const hasBlank = /\btarget\s*:\s*['"]_blank['"]/.test(line) || /\btarget\s*=\s*['"]_blank['"]/.test(line);
      if (!hasBlank) continue;
      if (hasRelNoopenerNearby(lines, i)) continue;
      hits.push({ file: path.relative(process.cwd(), file), line: i + 1 });
    }
  }

  assert.deepEqual(hits, []);
});

