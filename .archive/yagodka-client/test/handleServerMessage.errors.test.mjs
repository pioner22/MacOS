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

test("handleServerMessage: send-related error даёт дружелюбный статус и sys-сообщение в текущем room", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const room = "b-001";
    const key = `room:${room}`;
    const { getState, patch } = createPatchHarness({
      page: "main",
      modal: null,
      selected: { kind: "board", id: room },
      conversations: {
        [key]: [{ kind: "out", from: "111-111-111", room, text: "x", ts: 1, id: null, status: "sending" }],
      },
    });

    handleServerMessage({ type: "error", message: "board_post_forbidden" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.match(String(st.status || ""), /владелец/i);
    assert.equal(st.conversations[key][0].status, "error");
    const last = st.conversations[key][st.conversations[key].length - 1];
    assert.equal(last.kind, "sys");
    assert.match(String(last.text || ""), /владелец/i);
  } finally {
    await cleanup();
  }
});

