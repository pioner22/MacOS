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
    if (typeof p === "function") state = p(state);
    else state = { ...state, ...p };
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: message_edited обновляет текст и помечает edited (для отправителя)", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [{ kind: "out", from: selfId, to: peer, text: "a", ts: 1, id: 10, status: "delivered" }],
      },
    });

    handleServerMessage({ type: "message_edited", ok: true, from: selfId, to: peer, id: 10, text: "b" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].text, "b");
    assert.equal(st.conversations[key][0].edited, true);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_edited обновляет текст и помечает edited (для получателя)", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "222-222-222";
    const peer = "111-111-111";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [{ kind: "in", from: peer, to: selfId, text: "a", ts: 1, id: 10 }],
      },
    });

    handleServerMessage({ type: "message_edited", ok: true, from: peer, to: selfId, id: 10, text: "b" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].text, "b");
    assert.equal(st.conversations[key][0].edited, true);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_edited ok=false показывает статус", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({ status: "" });
    handleServerMessage({ type: "message_edited", ok: false, id: 1, reason: "not_found" }, getState(), { send() {} }, patch);
    assert.match(String(getState().status || ""), /Не удалось изменить сообщение/);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_edited обновляет сообщение даже без room/to (fallback по msg_id)", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [{ kind: "out", from: selfId, to: peer, text: "a", ts: 1, id: 10, status: "delivered" }],
      },
    });

    handleServerMessage({ type: "message_edited", ok: true, from: selfId, id: 10, text: "b" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].text, "b");
    assert.equal(st.conversations[key][0].edited, true);
  } finally {
    await cleanup();
  }
});
