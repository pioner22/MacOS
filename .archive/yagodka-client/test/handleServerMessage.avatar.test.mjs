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

function mkStorage() {
  const map = new Map();
  return {
    getItem(k) {
      const v = map.get(String(k));
      return v === undefined ? null : String(v);
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
  };
}

function createPatchHarness(initial) {
  let state = initial;
  const patch = (p) => {
    if (typeof p === "function") state = p(state);
    else state = { ...state, ...p };
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: avatar сохраняет кэш и обновляет profiles", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const { getState, patch } = createPatchHarness({ profiles: {}, avatarsRev: 0 });
    const gateway = { send() {} };

    handleServerMessage({ type: "avatar", id: "222-222-222", rev: 3, mime: "image/png", data: "AA==" }, getState(), gateway, patch);

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(st.profiles["222-222-222"].avatar_rev, 3);
    assert.equal(st.profiles["222-222-222"].avatar_mime, "image/png");
    assert.equal(localStorage.getItem("yagodka_avatar:dm:222-222-222"), "data:image/png;base64,AA==");
    assert.equal(localStorage.getItem("yagodka_avatar_rev:dm:222-222-222"), "3");
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: roster очищает аватар при avatar_mime=null (rev может быть >0)", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
    localStorage.setItem("yagodka_avatar:dm:222-222-222", "data:image/png;base64,AA==");
    localStorage.setItem("yagodka_avatar_rev:dm:222-222-222", "4");

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      friends: [],
      pendingIn: [],
      pendingOut: [],
      profiles: {},
      avatarsRev: 0,
    });

    handleServerMessage(
      {
        type: "roster",
        friends: [{ id: "222-222-222", avatar_rev: 5, avatar_mime: null }],
        online: [],
        pending_in: [],
        pending_out: [],
      },
      getState(),
      gateway,
      patch
    );

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(localStorage.getItem("yagodka_avatar:dm:222-222-222"), null);
    assert.equal(localStorage.getItem("yagodka_avatar_rev:dm:222-222-222"), "5");
    assert.deepEqual(sent, []);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: profile_updated очищает аватар при avatar_mime=null без avatar_get", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
    localStorage.setItem("yagodka_avatar:dm:222-222-222", "data:image/png;base64,AA==");
    localStorage.setItem("yagodka_avatar_rev:dm:222-222-222", "10");

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      friends: [{ id: "222-222-222", online: false, unread: 0, last_seen_at: null }],
      profiles: { "222-222-222": { id: "222-222-222", avatar_rev: 10, avatar_mime: "image/png" } },
      avatarsRev: 0,
    });

    handleServerMessage(
      { type: "profile_updated", id: "222-222-222", avatar_rev: 11, avatar_mime: null },
      getState(),
      gateway,
      patch
    );

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(localStorage.getItem("yagodka_avatar:dm:222-222-222"), null);
    assert.equal(localStorage.getItem("yagodka_avatar_rev:dm:222-222-222"), "11");
    assert.deepEqual(sent, []);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: roster запрашивает avatar_get если avatar_mime есть, а кэша нет", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      friends: [],
      pendingIn: [],
      pendingOut: [],
      profiles: {},
      avatarsRev: 0,
    });

    handleServerMessage(
      {
        type: "roster",
        friends: [{ id: "333-333-333", avatar_rev: 7, avatar_mime: "image/png" }],
        online: [],
        pending_in: [],
        pending_out: [],
      },
      getState(),
      gateway,
      patch
    );

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { type: "avatar_get", id: "333-333-333" });
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: avatar_set_result с ошибкой откатывает локальный preview и перезапрашивает серверный аватар", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
    localStorage.setItem("yagodka_avatar:dm:111-111-111", "data:image/png;base64,AA==");
    localStorage.setItem("yagodka_avatar_rev:dm:111-111-111", "7");

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      profiles: {
        "111-111-111": { id: "111-111-111", avatar_rev: 7, avatar_mime: "image/png" },
      },
      avatarsRev: 3,
    });

    handleServerMessage({ type: "avatar_set_result", ok: false, reason: "too_large" }, getState(), gateway, patch);

    const st = getState();
    assert.equal(st.status, "Не удалось обновить аватар: too_large");
    assert.equal(st.avatarsRev, 4);
    assert.equal(localStorage.getItem("yagodka_avatar:dm:111-111-111"), null);
    assert.equal(localStorage.getItem("yagodka_avatar_rev:dm:111-111-111"), null);
    assert.deepEqual(sent, [{ type: "avatar_get", id: "111-111-111" }]);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: group_updated с avatar_rev запрашивает аватар чата", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      groups: [{ id: "grp-1", name: "Old", avatar_rev: 1, avatar_mime: null }],
      boards: [],
      conversations: {},
      pendingGroupInvites: [],
      pendingBoardInvites: [],
      avatarsRev: 0,
    });

    handleServerMessage(
      { type: "group_updated", group: { id: "grp-1", name: "Team", avatar_rev: 2, avatar_mime: "image/png" } },
      getState(),
      gateway,
      patch
    );

    const st = getState();
    assert.equal(st.groups[0].avatar_rev, 2);
    assert.equal(st.groups[0].avatar_mime, "image/png");
    assert.deepEqual(sent, [{ type: "avatar_get", kind: "group", id: "grp-1" }]);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: avatar kind=group сохраняет кеш чата", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const { getState, patch } = createPatchHarness({
      groups: [{ id: "grp-1", name: "Team" }],
      boards: [],
      avatarsRev: 0,
    });
    const gateway = { send() {} };

    handleServerMessage({ type: "avatar", kind: "group", id: "grp-1", rev: 3, mime: "image/png", data: "AA==" }, getState(), gateway, patch);

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(st.groups[0].avatar_rev, 3);
    assert.equal(st.groups[0].avatar_mime, "image/png");
    assert.equal(localStorage.getItem("yagodka_avatar:group:grp-1"), "data:image/png;base64,AA==");
    assert.equal(localStorage.getItem("yagodka_avatar_rev:group:grp-1"), "3");
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: board_updated с avatar_mime=null очищает кеш доски", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
    localStorage.setItem("yagodka_avatar:board:b-1", "data:image/png;base64,AA==");
    localStorage.setItem("yagodka_avatar_rev:board:b-1", "4");

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      groups: [],
      boards: [{ id: "b-1", name: "Board", avatar_rev: 4, avatar_mime: "image/png" }],
      conversations: {},
      pendingGroupInvites: [],
      pendingBoardInvites: [],
      avatarsRev: 0,
    });

    handleServerMessage({ type: "board_updated", board: { id: "b-1", avatar_rev: 5, avatar_mime: null } }, getState(), gateway, patch);

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(st.boards[0].avatar_rev, 5);
    assert.equal(st.boards[0].avatar_mime, null);
    assert.equal(localStorage.getItem("yagodka_avatar:board:b-1"), null);
    assert.equal(localStorage.getItem("yagodka_avatar_rev:board:b-1"), "5");
    assert.deepEqual(sent, []);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});
