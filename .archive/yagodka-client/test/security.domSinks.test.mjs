import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOT = path.resolve("src");
const EXTRA_SECURITY_FILES = [path.resolve("public/boot.js")];

const BANNED = [
  { name: "innerHTML", re: /\binnerHTML\b/ },
  { name: "outerHTML", re: /\bouterHTML\b/ },
  { name: "insertAdjacentHTML", re: /\binsertAdjacentHTML\b/ },
  { name: "document.write", re: /\bdocument\.write\b/ },
  { name: "eval(", re: /\beval\s*\(/ },
  { name: "new Function", re: /\bnew\s+Function\b/ },
];

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

test("security: в src и boot loader нет опасных DOM-sinks/JS-eval", async () => {
  const files = [...(await listFiles(SOURCE_ROOT)), ...EXTRA_SECURITY_FILES];
  const hits = [];

  for (const file of files) {
    const txt = await readFile(file, "utf8");
    for (const { name, re } of BANNED) {
      if (!re.test(txt)) continue;
      const lines = txt.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push({ file: path.relative(process.cwd(), file), line: i + 1, name });
          break;
        }
      }
    }
  }

  assert.deepEqual(hits, []);
});
