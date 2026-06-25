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

test("handleServerMessage: message_delivered обновляет queued-сообщение по id (а не только последнее)", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      conversations: {
        [key]: [{ kind: "out", from: "111-111-111", to: peer, text: "a", ts: 1, id: 10, status: "queued" }],
      },
    });

    handleServerMessage({ type: "message_delivered", to: peer, id: 10 }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].status, "sent");
    assert.equal(st.conversations[key][0].id, 10);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_delivered присваивает msg_id по FIFO (если несколько исходящих без id)", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [
          { kind: "out", from: selfId, to: peer, text: "first", ts: 1, id: null, status: "sending" },
          { kind: "out", from: selfId, to: peer, text: "second", ts: 2, id: null, status: "sending" },
        ],
      },
    });

    handleServerMessage({ type: "message_delivered", to: peer, id: 101 }, getState(), { send() {} }, patch);
    handleServerMessage({ type: "message_delivered", to: peer, id: 102 }, getState(), { send() {} }, patch);

    const conv = getState().conversations[key];
    assert.equal(conv[0].id, 101);
    assert.equal(conv[1].id, 102);
    assert.equal(conv[0].status, "sent");
    assert.equal(conv[1].status, "sent");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: history_result проставляет delivered/queued/read статусы для исходящих DM", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {},
      historyLoaded: {},
    });

    handleServerMessage(
      {
        type: "history_result",
        peer,
        since_id: 0,
        rows: [
          { id: 10, from: selfId, to: peer, text: "delivered", ts: 1, delivered: true, read: false },
          { id: 11, from: selfId, to: peer, text: "queued", ts: 2, delivered: false, read: false },
          { id: 12, from: selfId, to: peer, text: "read", ts: 3, delivered: true, read: true },
          { id: 13, from: peer, to: selfId, text: "incoming", ts: 4, delivered: true, read: true },
        ],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    const conv = st.conversations[key];
    assert.equal(conv[0].status, "sent");
    assert.equal(conv[1].status, "queued");
    assert.equal(conv[2].status, "read");
    assert.equal(conv[3].kind, "in");
    assert.equal(conv[3].status, undefined);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_delivered не понижает read → sent", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      conversations: {
        [key]: [{ kind: "out", from: "111-111-111", to: peer, text: "a", ts: 1, id: 10, status: "read" }],
      },
    });

    handleServerMessage({ type: "message_delivered", to: peer, id: 10 }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].status, "read");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_delivered_to_device повышает sent → delivered и не понижает read", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      conversations: {
        [key]: [
          { kind: "out", from: "111-111-111", to: peer, text: "a", ts: 1, id: 10, status: "sent" },
          { kind: "out", from: "111-111-111", to: peer, text: "b", ts: 2, id: 11, status: "read" },
        ],
      },
    });

    handleServerMessage({ type: "message_delivered_to_device", to: peer, id: 10 }, getState(), { send() {} }, patch);
    handleServerMessage({ type: "message_delivered_to_device", to: peer, id: 11 }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.conversations[key][0].status, "delivered");
    assert.equal(st.conversations[key][1].status, "read");
  } finally {
    await cleanup();
  }
});
