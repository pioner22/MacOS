import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function bundleEntry(entryPath, exportNames) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entryPath)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    for (const name of exportNames) {
      if (typeof mod[name] !== "function") {
        throw new Error(`${name} export missing`);
      }
    }
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function makeServerMessage(id, ts = id) {
  return {
    kind: "in",
    id,
    ts,
    from: "123-456-789",
    to: "854-432-319",
    room: null,
    text: `m${id}`,
  };
}

function rawHistoryRow(id, ts = id) {
  return {
    id,
    ts,
    from: "123-456-789",
    to: "854-432-319",
    text: `m${id}`,
  };
}

test("mergeMessages: older server page keeps monotonic id order even if timestamps drift", async () => {
  const helper = await bundleEntry("src/helpers/chat/mergeMessages.ts", ["mergeMessages"]);
  try {
    const base = [];
    for (let id = 201; id <= 500; id += 1) base.push(makeServerMessage(id));
    const incoming = [];
    for (let id = 101; id <= 200; id += 1) incoming.push(makeServerMessage(id));
    incoming.find((m) => m.id === 150).ts = 450;

    const merged = helper.mod.mergeMessages(base, incoming);
    const serverIds = merged.map((m) => m.id).filter((id) => typeof id === "number");
    const sortedIds = [...serverIds].sort((a, b) => a - b);

    assert.deepEqual(serverIds, sortedIds);
    assert.equal(
      merged.findIndex((m) => m.id === 201),
      100,
      "older page must prepend strictly before the previously oldest loaded server row"
    );
  } finally {
    await helper.cleanup();
  }
});

test("handleHistoryServerMessage: virtual window shifts by the actual prepend distance", async () => {
  const helper = await bundleEntry("src/app/handleServerMessage/history.ts", ["handleHistoryServerMessage"]);
  try {
    const key = "dm:123-456-789";
    const base = [];
    for (let id = 201; id <= 500; id += 1) base.push(makeServerMessage(id));
    const rows = [];
    for (let id = 101; id <= 200; id += 1) rows.push(rawHistoryRow(id));
    rows.find((m) => m.id === 150).ts = 450;

    let state = {
      selfId: "854-432-319",
      selected: { kind: "dm", id: "123-456-789" },
      conversations: { [key]: base },
      historyLoaded: { [key]: true },
      historyPreviewOnly: {},
      historyCursor: { [key]: 201 },
      historyHasMore: { [key]: true },
      historyLoading: { [key]: true },
      historyVirtualStart: { [key]: 25 },
      lastRead: {},
      outbox: {},
    };

    const handled = helper.mod.handleHistoryServerMessage(
      "history_result",
      {
        peer: "123-456-789",
        before_id: 201,
        has_more: true,
        rows,
      },
      state,
      {},
      (patch) => {
        state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
      }
    );

    assert.equal(handled, true);

    const oldFirstIdx = state.conversations[key].findIndex((m) => m.id === 201);
    assert.equal(oldFirstIdx, 100);
    assert.equal(
      state.historyVirtualStart[key],
      25 + oldFirstIdx,
      "virtual history must shift only by the real prepend count before the previous window start"
    );
  } finally {
    await helper.cleanup();
  }
});
