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
    if (typeof p === "function") state = p(state);
    else state = { ...state, ...p };
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: roster_full переводит contact layer в loaded/server и мерджит friend profile", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const { getState, patch } = createPatchHarness({
      selfId,
      friends: [],
      topPeers: [],
      pendingIn: [],
      pendingOut: [],
      profiles: {},
      rosterSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastPresenceAt: null },
      profileSync: {},
      conversations: {},
      avatarsRev: 0,
    });

    handleServerMessage(
      {
        type: "roster_full",
        friends: [{ id: peer, display_name: "Peer Name", handle: "peer_handle", unread: 3, online: true }],
        online: [peer],
        top_peers: [{ id: peer, last_ts: 123, msg_count: 7 }],
        pending_in: [],
        pending_out: [],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.rosterSync.loaded, true);
    assert.equal(st.rosterSync.source, "server");
    assert.equal(Array.isArray(st.friends), true);
    assert.equal(st.friends[0].id, peer);
    assert.equal(st.profiles[peer].display_name, "Peer Name");
    assert.equal(st.profileSync[peer].loaded, true);
    assert.equal(st.profileSync[peer].source, "server");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: profile и presence_update обновляют unified profile/roster sync", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const { getState, patch } = createPatchHarness({
      selfId,
      friends: [{ id: peer, online: false, unread: 0, last_seen_at: null }],
      topPeers: [],
      pendingIn: [],
      pendingOut: [],
      profiles: {},
      rosterSync: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1, lastPresenceAt: null },
      profileSync: {},
      profileDraftDisplayName: "",
      profileDraftHandle: "",
      profileDraftBio: "",
      profileDraftStatus: "",
      page: "main",
      avatarsRev: 0,
    });

    handleServerMessage(
      {
        type: "profile",
        id: peer,
        display_name: "Remote User",
        handle: "remote_user",
        bio: "bio",
        status: "online",
        avatar_rev: 2,
        avatar_mime: null,
      },
      getState(),
      { send() {} },
      patch
    );

    handleServerMessage(
      { type: "presence_update", id: peer, online: true },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.profiles[peer].display_name, "Remote User");
    assert.equal(st.profileSync[peer].loaded, true);
    assert.equal(st.profileSync[peer].source, "server");
    assert.equal(st.friends[0].online, true);
    assert.equal(typeof st.rosterSync.lastPresenceAt, "number");
  } finally {
    await cleanup();
  }
});
