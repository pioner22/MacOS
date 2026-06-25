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

test("handleServerMessage: message парсит file attachment", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {},
    });

    handleServerMessage(
      {
        type: "message",
        from: peer,
        to: selfId,
        text: "[file] a.png (123 bytes)",
        ts: 1,
        id: 10,
        attachment: { kind: "file", file_id: "f-1", name: "a.png", size: 123, thumb_w: 320, thumb_h: 180, media_w: 1280, media_h: 720 },
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.conversations[key].length, 1);
    assert.deepEqual(st.conversations[key][0].attachment, {
      kind: "file",
      fileId: "f-1",
      name: "a.png",
      size: 123,
      mime: null,
      thumbW: 320,
      thumbH: 180,
      mediaW: 1280,
      mediaH: 720,
    });
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: history_result прокидывает room из верхнего уровня и парсит attachment", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const room = "grp-001";
    const key = `room:${room}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {},
      historyLoaded: {},
    });

    handleServerMessage(
      {
        type: "history_result",
        room,
        since_id: 0,
        rows: [{ id: 5, from: "222-222-222", text: "[file] doc.pdf (2 bytes)", ts: 1, attachment: { kind: "file", file_id: "f-2", name: "doc.pdf", size: 2 } }],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.historyLoaded[key], true);
    assert.equal(st.conversations[key].length, 1);
    assert.equal(st.conversations[key][0].room, room);
    assert.deepEqual(st.conversations[key][0].attachment, { kind: "file", fileId: "f-2", name: "doc.pdf", size: 2, mime: null });
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: history_result парсит action attachment из истории", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const longDescription = "описание ".repeat(400);
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
          {
            id: 5,
            from: peer,
            to: selfId,
            text: "Приглашение в чат",
            ts: 1,
            attachment: {
              kind: "action",
              payload: {
                kind: "group_invite",
                groupId: "grp-001",
                from: peer,
                name: "Команда",
                description: longDescription,
              },
            },
          },
        ],
      },
      getState(),
      { send() {} },
      patch
    );

    const att = getState().conversations[key][0].attachment;
    assert.equal(att.kind, "action");
    assert.equal(att.payload.kind, "group_invite");
    assert.equal(att.payload.groupId, "grp-001");
    assert.equal(att.payload.from, peer);
    assert.ok(att.payload.description.length <= 1400);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: message_deleted вычищает orphaned file transfer и thumb state", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevUrl = globalThis.URL;
  globalThis.URL = { ...(prevUrl || {}), revokeObjectURL() {} };
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [
          {
            kind: "in",
            from: peer,
            to: selfId,
            text: "[file] a.png",
            ts: 1,
            id: 10,
            attachment: { kind: "file", fileId: "f-1", name: "a.png", size: 123, mime: "image/png" },
          },
        ],
      },
      fileTransfers: [
        {
          localId: "ft-1",
          id: "f-1",
          name: "a.png",
          size: 123,
          mime: "image/png",
          direction: "in",
          peer,
          room: null,
          status: "complete",
          progress: 100,
          url: "blob:test-1",
        },
      ],
      fileThumbs: {
        "f-1": { url: "blob:thumb-1", mime: "image/jpeg", ts: 1 },
      },
      pinnedMessages: {},
      pinnedMessageActive: {},
      editing: null,
      input: "",
    });

    handleServerMessage(
      {
        type: "message_deleted",
        from: peer,
        to: selfId,
        id: 10,
        ok: true,
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.deepEqual(st.conversations[key], []);
    assert.deepEqual(st.fileTransfers, []);
    assert.deepEqual(st.fileThumbs, {});
    assert.equal(st.historyLoaded[key], true);
    assert.equal(st.historySync[key].emptyNotice.kind, "message_deleted");
    assert.equal(st.historySync[key].emptyNotice.scope, "dm");
    assert.equal(st.historySync[key].emptyNotice.by, peer);
  } finally {
    if (prevUrl === undefined) delete globalThis.URL;
    else globalThis.URL = prevUrl;
    await cleanup();
  }
});

test("handleServerMessage: history_result.deleted_ids вычищает resurrected media rows и orphaned cache state", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevUrl = globalThis.URL;
  globalThis.URL = { ...(prevUrl || {}), revokeObjectURL() {} };
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      selected: { kind: "dm", id: peer },
      conversations: {
        [key]: [
          {
            kind: "in",
            from: peer,
            to: selfId,
            text: "[file] zombie.webm",
            ts: 1,
            id: 10,
            attachment: { kind: "file", fileId: "f-zombie", name: "zombie.webm", size: 110, mime: "video/webm" },
          },
          {
            kind: "in",
            from: peer,
            to: selfId,
            text: "[file] ok.jpg",
            ts: 2,
            id: 11,
            attachment: { kind: "file", fileId: "f-live", name: "ok.jpg", size: 123, mime: "image/jpeg" },
          },
        ],
      },
      fileTransfers: [
        {
          localId: "ft-zombie",
          id: "f-zombie",
          name: "zombie.webm",
          size: 110,
          mime: "video/webm",
          direction: "in",
          peer,
          room: null,
          status: "complete",
          progress: 100,
          url: "https://yagodka.org/files/f-zombie",
        },
        {
          localId: "ft-live",
          id: "f-live",
          name: "ok.jpg",
          size: 123,
          mime: "image/jpeg",
          direction: "in",
          peer,
          room: null,
          status: "complete",
          progress: 100,
          url: "blob:live",
        },
      ],
      fileThumbs: {
        "f-zombie": { url: "https://yagodka.org/files/thumb/f-zombie", mime: "image/jpeg", ts: 1 },
        "f-live": { url: "blob:thumb-live", mime: "image/jpeg", ts: 2 },
      },
      historyLoaded: {},
      historyPreviewOnly: {},
      pinnedMessages: {},
      pinnedMessageActive: {},
      editing: null,
      input: "",
      outbox: {},
    });

    handleServerMessage(
      {
        type: "history_result",
        peer,
        before_id: 0,
        deleted_ids: [10],
        rows: [
          {
            id: 10,
            from: peer,
            text: "[file] zombie.webm",
            ts: 1,
            attachment: { kind: "file", file_id: "f-zombie", name: "zombie.webm", size: 110, mime: "video/webm" },
          },
          {
            id: 11,
            from: peer,
            text: "[file] ok.jpg",
            ts: 2,
            attachment: { kind: "file", file_id: "f-live", name: "ok.jpg", size: 123, mime: "image/jpeg" },
          },
        ],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.historyLoaded[key], true);
    assert.equal(st.conversations[key].length, 1);
    assert.equal(st.conversations[key][0].id, 11);
    assert.deepEqual(
      st.fileTransfers.map((entry) => entry.id),
      ["f-live"]
    );
    assert.deepEqual(Object.keys(st.fileThumbs), ["f-live"]);
  } finally {
    if (prevUrl === undefined) delete globalThis.URL;
    else globalThis.URL = prevUrl;
    await cleanup();
  }
});

test("handleServerMessage: history_result.deleted_ids помечает пустую историю как очищенную", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      selected: { kind: "dm", id: peer },
      conversations: {
        [key]: [{ kind: "in", from: peer, to: selfId, text: "old", ts: 1, id: 10 }],
      },
      historyLoaded: { [key]: true },
      historyPreviewOnly: {},
      historyLoading: {},
      outbox: {},
      fileTransfers: [],
      fileThumbs: {},
      pinnedMessages: {},
      pinnedMessageActive: {},
      editing: null,
      input: "",
    });

    handleServerMessage(
      {
        type: "history_result",
        peer,
        since_id: 0,
        deleted_ids: [10],
        rows: [],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.deepEqual(st.conversations[key], []);
    assert.equal(st.historyLoaded[key], true);
    assert.equal(st.historySync[key].emptyNotice.kind, "cleared");
    assert.equal(st.historySync[key].emptyNotice.scope, "dm");
    assert.equal(st.historySync[key].emptyNotice.deleted, 1);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: любой non-preview history_result снимает provisional historyPreviewOnly", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      selected: { kind: "dm", id: peer },
      conversations: {
        [key]: [
          {
            kind: "in",
            from: peer,
            to: selfId,
            text: "[file] cached.jpg",
            ts: 1,
            id: 10,
            attachment: { kind: "file", fileId: "f-cached", name: "cached.jpg", size: 123, mime: "image/jpeg" },
          },
        ],
      },
      historyLoaded: { [key]: true },
      historyPreviewOnly: { [key]: true },
      historyLoading: { [key]: true },
      outbox: {},
      fileTransfers: [],
      fileThumbs: {},
      pinnedMessages: {},
      pinnedMessageActive: {},
      editing: null,
      input: "",
    });

    handleServerMessage(
      {
        type: "history_result",
        peer,
        since_id: 10,
        rows: [],
        deleted_ids: [],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.historyPreviewOnly[key], undefined);
    assert.equal(st.historyLoaded[key], true);
    assert.equal(Boolean(st.historyLoading?.[key]), false);
  } finally {
    await cleanup();
  }
});
