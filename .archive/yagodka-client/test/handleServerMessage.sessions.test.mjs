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

test("handleServerMessage: sessions_list нормализует active sessions snapshot", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      sessionDevices: [],
      sessionDevicesStatus: null,
      status: "",
    });

    handleServerMessage(
      {
        type: "sessions_list",
        entries: [
          { current: true, online: true, client_kind: "web", client_version: "0.1.750", ip_masked: "192.168.*.*", last_used_at: 1700000000 },
          { current: false, online: true, client_kind: "web", client_version: "0.1.751", ip_masked: "10.20.*.*", last_used_at: 1700000100 },
        ],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.sessionDevices.length, 2);
    assert.equal(st.sessionDevices.filter((entry) => entry.current).length, 1);
    assert.match(String(st.sessionDevicesStatus || ""), /других устройств/i);
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: sessions_logout_others_result пишет понятный статус", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      sessionDevices: [],
      sessionDevicesStatus: null,
      status: "",
    });

    handleServerMessage({ type: "sessions_logout_others_result", ok: true, count: 2 }, getState(), { send() {} }, patch);
    assert.match(String(getState().status || ""), /2/);

    handleServerMessage(
      { type: "sessions_logout_others_result", ok: false, reason: "no_current_session" },
      getState(),
      { send() {} },
      patch
    );
    assert.match(String(getState().sessionDevicesStatus || ""), /текущую сессию/i);
  } finally {
    await cleanup();
  }
});
