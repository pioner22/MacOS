import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHandleServerMessage() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/handleServerMessage.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.handleServerMessage !== "function") {
      throw new Error("handleServerMessage не экспортирован из бандла");
    }
    return { handleServerMessage: mod.handleServerMessage, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function createPatchHarness(initial) {
  let state = initial;
  const patch = (p) => {
    if (typeof p === "function") {
      state = p(state);
    } else {
      state = { ...state, ...p };
    }
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: message_read_ack помечает исходящие как прочитанные до up_to_id", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      conversations: {
        [key]: [
          { kind: "out", from: "111-111-111", to: peer, text: "a", ts: 1, id: 10, status: "delivered" },
          { kind: "out", from: "111-111-111", to: peer, text: "b", ts: 2, id: 11, status: "delivered" },
          { kind: "in", from: peer, to: "111-111-111", text: "c", ts: 3, id: 12 },
        ],
      },
    });

    handleServerMessage({ type: "message_read_ack", peer, up_to_id: 10 }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].status, "read");
    assert.equal(st.conversations[key][1].status, "delivered");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_read_ack без up_to_id помечает все исходящие как прочитанные", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const peer = "333-333-333";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      conversations: {
        [key]: [
          { kind: "out", from: "111-111-111", to: peer, text: "a", ts: 1, id: 10, status: "delivered" },
          { kind: "out", from: "111-111-111", to: peer, text: "b", ts: 2, id: 11, status: "queued" },
        ],
      },
    });

    handleServerMessage({ type: "message_read_ack", peer, up_to_id: null }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].status, "read");
    assert.equal(st.conversations[key][1].status, "read");
  } finally {
    await cleanup();
  }
});

