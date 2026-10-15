import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/profile/profileActionsFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createProfileActionsFeature !== "function") {
      throw new Error("createProfileActionsFeature export missing");
    }
    return { createProfileActionsFeature: mod.createProfileActionsFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("profileActionsFeature: refresh профиля запрашивает только profile snapshot", async () => {
  const { createProfileActionsFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    const feature = createProfileActionsFeature({
      store: {
        get() {
          return { conn: "connected", authed: true };
        },
        set() {},
      },
      send: (payload) => sent.push(payload),
      markUserInput() {},
      buildSearchServerShareText() {
        return "";
      },
      tryAppendShareTextToSelected() {
        return false;
      },
      copyText() {},
      getAvatarFeature() {
        return null;
      },
    });

    feature.onProfileRefresh();

    assert.deepEqual(sent, [{ type: "profile_get" }]);
  } finally {
    await cleanup();
  }
});

test("profileActionsFeature: W-1036 draft change autosaves profile without manual save click", async () => {
  const { createProfileActionsFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    const patches = [];
    let state = {
      conn: "connected",
      authed: true,
      selfId: "111-111-111",
      profiles: {
        "111-111-111": {
          id: "111-111-111",
          display_name: "Old",
          handle: "old",
          bio: "",
          status: "",
        },
      },
    };
    let userInputMarks = 0;
    const feature = createProfileActionsFeature({
      store: {
        get() {
          return state;
        },
        set(patch) {
          patches.push(patch);
          if (typeof patch === "object" && patch) state = { ...state, ...patch };
        },
      },
      send: (payload) => sent.push(payload),
      markUserInput() {
        userInputMarks += 1;
      },
      buildSearchServerShareText() {
        return "";
      },
      tryAppendShareTextToSelected() {
        return false;
      },
      copyText() {},
      getAvatarFeature() {
        return null;
      },
      profileAutosaveDelayMs: 0,
    });

    feature.onProfileDraftChange({
      displayName: " New name ",
      handle: " new_handle ",
      bio: " Bio ",
      status: " Online ",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(userInputMarks, 1);
    assert.deepEqual(sent, [
      {
        type: "profile_set",
        display_name: "New name",
        handle: "new_handle",
        bio: "Bio",
        status: "Online",
      },
    ]);
    assert.equal(state.profileDraftDisplayName, " New name ");
    assert.equal(state.profileDraftHandle, " new_handle ");
    assert.equal(state.profileDraftBio, " Bio ");
    assert.equal(state.profileDraftStatus, " Online ");
    assert.match(String(patches.at(-1)?.status || ""), /профил/i);
  } finally {
    await cleanup();
  }
});

test("profileActionsFeature: W-1036 autosave skips duplicate profile drafts", async () => {
  const { createProfileActionsFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    let state = {
      conn: "connected",
      authed: true,
      selfId: "111-111-111",
      profiles: {
        "111-111-111": {
          id: "111-111-111",
          display_name: "Same",
          handle: "same",
          bio: "Bio",
          status: "Online",
        },
      },
    };
    const feature = createProfileActionsFeature({
      store: {
        get() {
          return state;
        },
        set(patch) {
          if (typeof patch === "object" && patch) state = { ...state, ...patch };
        },
      },
      send: (payload) => sent.push(payload),
      markUserInput() {},
      buildSearchServerShareText() {
        return "";
      },
      tryAppendShareTextToSelected() {
        return false;
      },
      copyText() {},
      getAvatarFeature() {
        return null;
      },
      profileAutosaveDelayMs: 0,
    });

    feature.onProfileDraftChange({
      displayName: "Same",
      handle: "same",
      bio: "Bio",
      status: "Online",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(sent, []);
  } finally {
    await cleanup();
  }
});

test("profileActionsFeature: logout other devices отправляет команду и выставляет status", async () => {
  const { createProfileActionsFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    const patches = [];
    const feature = createProfileActionsFeature({
      store: {
        get() {
          return { conn: "connected", authed: true };
        },
        set(patch) {
          patches.push(patch);
        },
      },
      send: (payload) => sent.push(payload),
      markUserInput() {},
      buildSearchServerShareText() {
        return "";
      },
      tryAppendShareTextToSelected() {
        return false;
      },
      copyText() {},
      getAvatarFeature() {
        return null;
      },
    });

    feature.onSessionsLogoutOthers();

    assert.deepEqual(sent, [{ type: "sessions_logout_others" }]);
    assert.equal(patches.length, 1);
    assert.match(String(patches[0].status || ""), /другие устройства/i);
    assert.match(String(patches[0].sessionDevicesStatus || ""), /другие устройства/i);
  } finally {
    await cleanup();
  }
});
