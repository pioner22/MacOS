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

test("handleServerMessage: prefs обновляет muted/blocked/blockedBy", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      muted: [],
      blocked: [],
      blockedBy: [],
      chatFolders: [],
      sidebarFolderId: "all",
      sidebarSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
      status: "",
    });

    handleServerMessage(
      {
        type: "prefs",
        muted: ["111-111-111"],
        blocked: ["222-222-222"],
        blocked_by: ["333-333-333"],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.deepEqual(st.muted, ["111-111-111"]);
    assert.deepEqual(st.blocked, ["222-222-222"]);
    assert.deepEqual(st.blockedBy, ["333-333-333"]);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: prefs переводит sidebar folders в loaded/server snapshot", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      muted: [],
      blocked: [],
      blockedBy: [],
      chatFolders: [],
      sidebarFolderId: "all",
      sidebarSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
      status: "",
    });

    handleServerMessage(
      {
        type: "prefs",
        muted: [],
        blocked: [],
        blocked_by: [],
        chat_folders: {
          v: 1,
          active: "f_team",
          folders: [{ id: "f_team", title: "Команда", include: ["dm:222-222-222"], exclude: [] }],
        },
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.sidebarFolderId, "f_team");
    assert.equal(st.chatFolders.length, 1);
    assert.equal(st.sidebarSync.loaded, true);
    assert.equal(st.sidebarSync.source, "server");
    assert.equal(st.sidebarSync.reconcilePending, false);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: chat_cleared вычищает диалог и history sync state", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {
        [key]: [{ kind: "in", from: peer, to: selfId, text: "old", ts: 1, id: 7 }],
      },
      friends: [{ id: peer, unread: 3 }],
      historyLoaded: { [key]: true },
      historyCursor: { [key]: 7 },
      historyHasMore: { [key]: false },
      historySync: { [key]: { loaded: true, source: "server" } },
      status: "",
    });

    handleServerMessage(
      {
        type: "chat_cleared",
        ok: true,
        peer,
        by: selfId,
        deleted: 1,
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.conversations[key], undefined);
    assert.equal(st.friends[0].unread, 0);
    assert.equal(st.historyLoaded[key], true);
    assert.equal(st.historyCursor[key], undefined);
    assert.equal(st.historyHasMore[key], false);
    assert.equal(st.historySync[key].loaded, true);
    assert.equal(st.historySync[key].source, "server");
    assert.equal(st.historySync[key].emptyNotice.kind, "cleared");
    assert.equal(st.historySync[key].emptyNotice.scope, "dm");
    assert.equal(st.historySync[key].emptyNotice.by, selfId);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: active DM message clears local unread immediately", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const sentPayloads = [];
    const { getState, patch } = createPatchHarness({
      selfId,
      page: "main",
      modal: null,
      selected: { kind: "dm", id: peer },
      conn: "connected",
      authed: true,
      conversations: { [key]: [] },
      friends: [{ id: peer, unread: 1 }],
      profiles: {},
      groups: [],
      boards: [],
      lastRead: {},
      status: "",
    });

    handleServerMessage(
      {
        type: "message",
        from: peer,
        to: selfId,
        text: "new",
        ts: 100,
        id: 11,
      },
      getState(),
      { send(payload) { sentPayloads.push(payload); } },
      patch
    );

    const st = getState();
    assert.equal(st.friends[0].unread, 0);
    assert.equal(st.conversations[key].length, 1);
    assert.equal(st.lastRead[key].id, 11);
    assert.deepEqual(sentPayloads.find((x) => x.type === "message_read"), { type: "message_read", peer, up_to_id: 11 });
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: unread_counts does not resurrect active DM unread", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const peer = "222-222-222";
    const other = "333-333-333";
    const { getState, patch } = createPatchHarness({
      page: "main",
      modal: null,
      selected: { kind: "dm", id: peer },
      friends: [
        { id: peer, unread: 0 },
        { id: other, unread: 0 },
      ],
      status: "",
    });

    handleServerMessage(
      {
        type: "unread_counts",
        counts: { [peer]: 4, [other]: 2 },
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.friends.find((friend) => friend.id === peer).unread, 0);
    assert.equal(st.friends.find((friend) => friend.id === other).unread, 2);
  } finally {
    await cleanup();
  }
});
