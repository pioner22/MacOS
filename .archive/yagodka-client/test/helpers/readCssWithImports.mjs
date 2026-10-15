import { readFile } from "node:fs/promises";
import path from "node:path";

const IMPORT_RE = /^\s*@import\s+["']([^"']+)["']\s*;\s*$/gm;

async function readCssWithImportsInner(absPath, seen) {
  const normalized = path.normalize(absPath);
  if (seen.has(normalized)) {
    return "";
  }
  seen.add(normalized);

  const css = await readFile(normalized, "utf8");
  const dir = path.dirname(normalized);

  let out = "";
  let lastIndex = 0;
  for (const match of css.matchAll(IMPORT_RE)) {
    const fullMatch = match[0];
    const importTarget = match[1];

    const matchIndex = match.index ?? 0;
    out += css.slice(lastIndex, matchIndex);

    if (importTarget.startsWith("./") || importTarget.startsWith("../")) {
      const importedPath = path.resolve(dir, importTarget);
      out += await readCssWithImportsInner(importedPath, seen);
    } else {
      out += fullMatch;
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  out += css.slice(lastIndex);
  return out;
}

export async function readCssWithImports(cssPath) {
  const absPath = path.resolve(cssPath);
  return await readCssWithImportsInner(absPath, new Set());
}

