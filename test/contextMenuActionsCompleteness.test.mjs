import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

function extractMenuIds(src) {
  const out = [];
  const re = /makeItem\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
  for (const m of src.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    if (!raw) continue;
    const dynamicAt = raw.indexOf("${");
    if (dynamicAt >= 0) {
      out.push({ raw, prefix: raw.slice(0, dynamicAt), dynamic: true });
    } else {
      out.push({ raw, prefix: raw, dynamic: false });
    }
  }
  return out;
}

test("context menu: every actionable item has a handler", async () => {
  const menuSrc = await readFile(new URL("../src/app/features/contextMenu/contextMenuFeature.ts", import.meta.url), "utf8");
  const actionsSrc = await readFile(new URL("../src/app/features/contextMenu/contextMenuActionsFeature.ts", import.meta.url), "utf8");

  const exactHandlers = new Set([...actionsSrc.matchAll(/itemId\s*===\s*["']([^"']+)["']/g)].map((m) => m[1]));
  const prefixHandlers = new Set([...actionsSrc.matchAll(/itemId\.startsWith\(["']([^"']+)["']\)/g)].map((m) => m[1]));
  const ignoredDisabled = new Set(["sidebar_status"]);
  const missing = [];

  for (const item of extractMenuIds(menuSrc)) {
    if (ignoredDisabled.has(item.raw)) continue;
    if (item.dynamic) {
      if (!item.prefix || !prefixHandlers.has(item.prefix)) missing.push(item.raw);
    } else if (!exactHandlers.has(item.raw)) {
      missing.push(item.raw);
    }
  }

  assert.deepEqual([...new Set(missing)].sort(), []);
});
