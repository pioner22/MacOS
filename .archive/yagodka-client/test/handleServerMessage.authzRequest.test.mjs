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

test("handleServerMessage: authz_request не открывает модалку сам", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      pendingIn: [],
      conversations: {},
      modal: null,
      status: "",
    });

    handleServerMessage({ type: "authz_request", from: "111-111-111", note: "hi" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.deepEqual(st.pendingIn, ["111-111-111"]);
    assert.equal(st.modal, null);
    assert.ok(String(st.status || "").includes("111-111-111"));
    const conv = st.conversations?.["dm:111-111-111"] || [];
    const msg = Array.isArray(conv) ? conv.find((m) => m && m.localId === "action:auth_in:111-111-111") : null;
    assert.ok(msg, "должно быть системное сообщение с action:auth_in");
    assert.equal(msg.kind, "sys");
    assert.equal(msg.attachment?.kind, "action");
    assert.equal(msg.attachment?.payload?.kind, "auth_in");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: session_replaced не открывает модалку сам", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      authed: true,
      authMode: "auto",
      modal: null,
      status: "",
    });

    handleServerMessage({ type: "session_replaced", reason: "relogin" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.authed, false);
    assert.equal(st.modal, null);
    assert.ok(String(st.status || "").toLowerCase().includes("сессия"));
  } finally {
    await cleanup();
  }
});
