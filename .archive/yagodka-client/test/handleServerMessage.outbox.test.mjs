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
    if (typeof mod.handleServerMessage !== "function") throw new Error("handleServerMessage не экспортирован из бандла");
    return { handleServerMessage: mod.handleServerMessage, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function createPatchHarness(initial) {
  let state = initial;
  const patch = (p) => {
    if (typeof p === "function") state = p(state);
    else state = { ...state, ...p };
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: message_delivered снимает запись из outbox по localId", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [{ kind: "out", from: selfId, to: peer, text: "hi", ts: 100, id: null, localId: "L1", status: "sending" }],
      },
      outbox: {
        [key]: [{ localId: "L1", ts: 100, text: "hi", to: peer, status: "sending", attempts: 1, lastAttemptAt: 123 }],
      },
    });

    handleServerMessage({ type: "message_delivered", to: peer, id: 55 }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].status, "sent");
    assert.equal(st.conversations[key][0].id, 55);
    assert.equal(st.outbox[key], undefined);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: history_result дедупит pending outbox и не плодит дубликаты", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [{ kind: "out", from: selfId, to: peer, text: "hi", ts: 100, id: null, localId: "L1", status: "queued" }],
      },
      outbox: {
        [key]: [{ localId: "L1", ts: 100, text: "hi", to: peer, status: "queued", attempts: 1 }],
      },
      historyLoaded: {},
    });

    handleServerMessage(
      { type: "history_result", peer, since_id: 0, rows: [{ id: 55, from: selfId, to: peer, text: "hi", ts: 102, delivered: true, read: false }] },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.outbox[key], undefined);
    assert.equal(st.conversations[key].length, 1);
    assert.equal(st.conversations[key][0].id, 55);
    assert.equal(st.conversations[key][0].status, "sent");
  } finally {
    await cleanup();
  }
});
