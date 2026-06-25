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

test("handleServerMessage: group_add_result ok закрывает модалку при non-empty invited", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      modal: { kind: "members_add", targetKind: "group", targetId: "grp-1", title: "Чат: Тест" },
      status: "",
    });

    handleServerMessage(
      { type: "group_add_result", ok: true, group_id: "grp-1", invited: ["111-111-111", "222-222-222", "333-333-333", "444-444-444"] },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.modal, null);
    assert.match(st.status, /Приглашены в чат: 4/);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: group_add_result ok оставляет модалку при empty invited", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      modal: { kind: "members_add", targetKind: "group", targetId: "grp-1", title: "Чат: Тест" },
      status: "",
    });

    handleServerMessage(
      { type: "group_add_result", ok: true, group_id: "grp-1", invited: [] },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.modal.kind, "members_add");
    assert.match(st.modal.message, /Не найдено подходящих пользователей/);
    assert.match(st.status, /Не найдено подходящих пользователей/);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: board_add_result no_members показывает ошибку в модалке", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      modal: { kind: "members_add", targetKind: "board", targetId: "b-1", title: "Доска: Тест" },
      status: "",
    });

    handleServerMessage(
      { type: "board_add_result", ok: false, board_id: "b-1", reason: "no_members" },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.modal.kind, "members_add");
    assert.match(st.modal.message, /Не найдено подходящих пользователей/);
    assert.match(st.status, /Добавление не выполнено/);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: board_add_result ok закрывает модалку", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      modal: { kind: "members_add", targetKind: "board", targetId: "b-1", title: "Доска: Тест" },
      status: "",
    });

    handleServerMessage(
      { type: "board_add_result", ok: true, board_id: "b-1", added: ["111-111-111"] },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.modal, null);
    assert.match(st.status, /Добавлены в доску: 1/);
  } finally {
    await cleanup();
  }
});
