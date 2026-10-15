import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("history cache policy: cached chats revalidate through freshness budget, not immediate reload", () => {
  const src = read("src/app/features/history/historyFeature.ts");

  assert.match(src, /HISTORY_SELECTED_DELTA_REVALIDATE_MS/);
  assert.match(src, /HISTORY_TAIL_REVALIDATE_MS/);
  assert.match(src, /HISTORY_BACKGROUND_NETWORK_MIN_MS/);
  assert.match(src, /historyNetworkLastAt/);
  assert.match(src, /shouldUseHistoryNetwork/);
  assert.match(src, /history\.request\.blocked_budget/);
  assert.match(src, /history\.warmup\.skip_network/);
  assert.doesNotMatch(src, /requestHistory\(t,\s*\{\s*\.{3}opts,\s*force:\s*true\s*\}\)/);
});
