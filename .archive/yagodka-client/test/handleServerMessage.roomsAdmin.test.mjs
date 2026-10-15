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

test("handleServerMessage: group_rename_result ok закрывает rename-модалку", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      modal: { kind: "rename", targetKind: "group", targetId: "grp-1", title: "Чат: Тест", currentName: "Тест" },
      status: "",
      groups: [],
      boards: [],
      conversations: {},
      historyLoaded: {},
      selected: null,
    });

    handleServerMessage({ type: "group_rename_result", ok: true, group_id: "grp-1", name: "Новый" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.modal, null);
    assert.match(st.status, /Чат переименован/);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: board_remove_result bad_args показывает ошибку в members_remove", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      modal: { kind: "members_remove", targetKind: "board", targetId: "b-1", title: "Доска: Тест" },
      status: "",
      groups: [],
      boards: [],
      conversations: {},
      historyLoaded: {},
      selected: null,
    });

    handleServerMessage({ type: "board_remove_result", ok: false, board_id: "b-1", reason: "bad_args" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.modal.kind, "members_remove");
    assert.match(st.modal.message, /Некорректные данные/);
    assert.match(st.status, /Удаление не выполнено/);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: group_removed снимает выбранный чат и очищает историю/кэш", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      modal: null,
      status: "",
      groups: [{ id: "grp-1", name: "Тест", owner_id: "111-111-111" }],
      boards: [],
      selected: { kind: "group", id: "grp-1" },
      conversations: { "room:grp-1": [{ kind: "sys", from: "", text: "hi", ts: 1 }] },
      historyLoaded: { "room:grp-1": true },
    });

    handleServerMessage({ type: "group_removed", group_id: "grp-1", name: "Тест", by: "111-111-111" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.selected, null);
    assert.ok(!("room:grp-1" in st.conversations));
    assert.ok(!("room:grp-1" in st.historyLoaded));
    assert.equal(st.groups.length, 0);
    assert.match(st.status, /Удалены из чата/);
  } finally {
    await cleanup();
  }
});

