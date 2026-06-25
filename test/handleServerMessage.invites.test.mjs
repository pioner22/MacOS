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

test("handleServerMessage: group_invite парсится из payload.group", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      pendingGroupInvites: [],
      pendingBoardInvites: [],
      pendingGroupJoinRequests: [],
      conversations: {},
      modal: null,
      status: "",
    });

    handleServerMessage(
      {
        type: "group_invite",
        group: { id: "grp-0001", name: "Чат", owner_id: "111-111-111", handle: "@chat" },
        from: "111-111-111",
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.pendingGroupInvites.length, 1);
    assert.equal(st.pendingGroupInvites[0].groupId, "grp-0001");
    assert.equal(st.pendingGroupInvites[0].from, "111-111-111");
    assert.equal(st.pendingGroupInvites[0].name, "Чат");
    assert.equal(st.pendingGroupInvites[0].handle, "@chat");
    assert.equal(st.modal, null);
    const conv = st.conversations?.["dm:111-111-111"] || [];
    const msg = Array.isArray(conv) ? conv.find((m) => m && m.localId === "action:group_invite:grp-0001:111-111-111") : null;
    assert.ok(msg, "должно быть системное сообщение с action:group_invite");
    assert.equal(msg.kind, "sys");
    assert.equal(msg.attachment?.kind, "action");
    assert.equal(msg.attachment?.payload?.kind, "group_invite");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: board_invite парсится из payload.board", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      pendingGroupInvites: [],
      pendingBoardInvites: [],
      pendingGroupJoinRequests: [],
      conversations: {},
      modal: null,
      status: "",
    });

    handleServerMessage(
      {
        type: "board_invite",
        board: { id: "b-abcdef12", name: "Новости", owner_id: "111-111-111", handle: "@news" },
        from: "111-111-111",
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.pendingBoardInvites.length, 1);
    assert.equal(st.pendingBoardInvites[0].boardId, "b-abcdef12");
    assert.equal(st.pendingBoardInvites[0].from, "111-111-111");
    assert.equal(st.pendingBoardInvites[0].name, "Новости");
    assert.equal(st.pendingBoardInvites[0].handle, "@news");
    assert.equal(st.modal, null);
    const conv = st.conversations?.["dm:111-111-111"] || [];
    const msg = Array.isArray(conv) ? conv.find((m) => m && m.localId === "action:board_invite:b-abcdef12:111-111-111") : null;
    assert.ok(msg, "должно быть системное сообщение с action:board_invite");
    assert.equal(msg.kind, "sys");
    assert.equal(msg.attachment?.kind, "action");
    assert.equal(msg.attachment?.payload?.kind, "board_invite");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: group_join_request создаёт pending request и системное action-сообщение", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      pendingGroupInvites: [],
      pendingBoardInvites: [],
      pendingGroupJoinRequests: [],
      conversations: {},
      modal: null,
      status: "",
    });

    handleServerMessage(
      {
        type: "group_join_request",
        group_id: "grp-0002",
        from: "222-222-222",
        name: "Команда",
        handle: "@team",
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.pendingGroupJoinRequests.length, 1);
    assert.equal(st.pendingGroupJoinRequests[0].groupId, "grp-0002");
    assert.equal(st.pendingGroupJoinRequests[0].from, "222-222-222");
    assert.equal(st.pendingGroupJoinRequests[0].name, "Команда");
    assert.equal(st.pendingGroupJoinRequests[0].handle, "@team");
    const conv = st.conversations?.["dm:222-222-222"] || [];
    const msg = Array.isArray(conv) ? conv.find((m) => m && m.localId === "action:group_join_request:grp-0002:222-222-222") : null;
    assert.ok(msg, "должно быть системное сообщение с action:group_join_request");
    assert.equal(msg.kind, "sys");
    assert.equal(msg.attachment?.kind, "action");
    assert.equal(msg.attachment?.payload?.kind, "group_join_request");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: group_added закрывает stale group_invite action из локального DM", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      groups: [],
      boards: [],
      pendingGroupInvites: [{ kind: "group_invite", groupId: "grp-0001", from: "111-111-111", name: "Чат" }],
      pendingBoardInvites: [],
      pendingGroupJoinRequests: [],
      conversations: {
        "dm:111-111-111": [
          {
            kind: "sys",
            from: "111-111-111",
            text: "Приглашение в чат: Чат",
            ts: 1,
            id: null,
            localId: "action:group_invite:grp-0001:111-111-111",
            attachment: {
              kind: "action",
              payload: { kind: "group_invite", groupId: "grp-0001", from: "111-111-111", name: "Чат" },
            },
          },
        ],
      },
      modal: { kind: "action", payload: { kind: "group_invite", groupId: "grp-0001", from: "111-111-111", name: "Чат" } },
      status: "",
    });

    handleServerMessage(
      {
        type: "group_added",
        group: { id: "grp-0001", name: "Чат", owner_id: "111-111-111", members: ["517-048-184", "111-111-111"] },
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.pendingGroupInvites.length, 0);
    assert.equal(st.modal, null);
    const msg = st.conversations["dm:111-111-111"][0];
    assert.equal(msg.text, "Приглашение принято: grp-0001");
    assert.equal(msg.attachment, null);
    assert.equal(st.groups.length, 1);
    assert.equal(st.groups[0].id, "grp-0001");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: board_added закрывает stale board_invite action из локального DM", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      groups: [],
      boards: [],
      pendingGroupInvites: [],
      pendingBoardInvites: [{ kind: "board_invite", boardId: "b-abcdef12", from: "111-111-111", name: "Новости" }],
      pendingGroupJoinRequests: [],
      conversations: {
        "dm:111-111-111": [
          {
            kind: "sys",
            from: "111-111-111",
            text: "Приглашение в доску: Новости",
            ts: 1,
            id: null,
            localId: "action:board_invite:b-abcdef12:111-111-111",
            attachment: {
              kind: "action",
              payload: { kind: "board_invite", boardId: "b-abcdef12", from: "111-111-111", name: "Новости" },
            },
          },
        ],
      },
      modal: { kind: "action", payload: { kind: "board_invite", boardId: "b-abcdef12", from: "111-111-111", name: "Новости" } },
      status: "",
    });

    handleServerMessage(
      {
        type: "board_added",
        board: { id: "b-abcdef12", name: "Новости", owner_id: "111-111-111", members: ["517-048-184", "111-111-111"] },
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.pendingBoardInvites.length, 0);
    assert.equal(st.modal, null);
    const msg = st.conversations["dm:111-111-111"][0];
    assert.equal(msg.text, "Приглашение принято: b-abcdef12");
    assert.equal(msg.attachment, null);
    assert.equal(st.boards.length, 1);
    assert.equal(st.boards[0].id, "b-abcdef12");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: update_required открывает экран обновления", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      updateLatest: null,
      updateDismissedLatest: null,
      modal: null,
      status: "",
    });

    handleServerMessage({ type: "update_required", latest: "0.9.9" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.updateLatest, "0.9.9");
    assert.deepEqual(st.modal, { kind: "update" });
    assert.ok(String(st.status || "").includes("Ctrl+U"));
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: update_required на Android показывает явный prompt на обновление приложения", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevCapacitor = globalThis.Capacitor;
  Object.defineProperty(globalThis, "Capacitor", {
    value: {
      getPlatform: () => "android",
      isNativePlatform: () => true,
    },
    configurable: true,
  });
  try {
    const { getState, patch } = createPatchHarness({
      updateLatest: null,
      updateDismissedLatest: null,
      modal: null,
      status: "",
    });

    handleServerMessage(
      {
        type: "update_required",
        latest: "0.1.785-aaaaaaaaaaaa",
        android_app_update: true,
        latest_android_version_name: "1.0.12",
        latest_android_version_code: 13,
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.updateLatest, "1.0.12");
    assert.deepEqual(st.modal, { kind: "update" });
    assert.ok(String(st.status || "").includes("Android-приложения"));
    assert.ok(String(st.status || "").includes("1.0.12"));
    assert.ok(String(st.status || "").includes("Нужно обновиться"));
  } finally {
    if (prevCapacitor === undefined) {
      delete globalThis.Capacitor;
    } else {
      Object.defineProperty(globalThis, "Capacitor", { value: prevCapacitor, configurable: true });
    }
    await cleanup();
  }
});

test("handleServerMessage: update_required с build id открывает явное PWA обновление и инициирует SW update", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const nav = globalThis.navigator ?? {};
  const hadNavigator = Boolean(globalThis.navigator);
  const prevSw = nav.serviceWorker;
  if (!hadNavigator) {
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  }
  Object.defineProperty(nav, "serviceWorker", {
    value: { getRegistration: async () => ({ update: () => {} }) },
    configurable: true,
  });
  try {
    const { getState, patch } = createPatchHarness({
      updateLatest: null,
      updateDismissedLatest: null,
      modal: null,
      status: "",
    });

    handleServerMessage({ type: "update_required", latest: "0.1.515-c539a3244834" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.updateLatest, "0.1.515-c539a3244834");
    assert.equal(st.pwaUpdateAvailable, true);
    assert.equal(st.pwaUpdate?.stage, "available");
    assert.equal(st.pwaUpdate?.buildId, "0.1.515-c539a3244834");
    assert.deepEqual(st.modal, { kind: "pwa_update" });
    assert.ok(String(st.status || "").includes("Нажмите"));
  } finally {
    if (prevSw === undefined) {
      delete nav.serviceWorker;
    } else {
      Object.defineProperty(nav, "serviceWorker", { value: prevSw, configurable: true });
    }
    if (!hadNavigator) {
      delete globalThis.navigator;
    }
    await cleanup();
  }
});

test("handleServerMessage: update_required preempts auth modal for explicit PWA update prompt", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const nav = globalThis.navigator ?? {};
  const hadNavigator = Boolean(globalThis.navigator);
  const prevSw = nav.serviceWorker;
  if (!hadNavigator) {
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  }
  Object.defineProperty(nav, "serviceWorker", {
    value: { getRegistration: async () => ({ update: () => {} }) },
    configurable: true,
  });
  try {
    const { getState, patch } = createPatchHarness({
      updateLatest: "0.1.514-old",
      updateDismissedLatest: null,
      pwaUpdateAvailable: false,
      pwaUpdate: { stage: "idle", buildId: null },
      modal: { kind: "auth", message: "Нет связи. Проверьте интернет." },
      status: "Нет связи. Проверьте интернет.",
    });

    handleServerMessage({ type: "update_required", latest: "0.1.908-deadbeef0000" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.updateLatest, "0.1.908-deadbeef0000");
    assert.equal(st.pwaUpdateAvailable, true);
    assert.equal(st.pwaUpdate?.buildId, "0.1.908-deadbeef0000");
    assert.deepEqual(st.modal, { kind: "pwa_update" });
    assert.ok(String(st.status || "").includes("Доступно обновление веб-клиента"));
  } finally {
    if (prevSw === undefined) {
      delete nav.serviceWorker;
    } else {
      Object.defineProperty(nav, "serviceWorker", { value: prevSw, configurable: true });
    }
    if (!hadNavigator) {
      delete globalThis.navigator;
    }
    await cleanup();
  }
});
