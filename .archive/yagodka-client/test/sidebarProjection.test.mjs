import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadSidebarProjection() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/sidebar/sidebarProjection.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { ...mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("sidebarProjection: unread/archive/selected key живут в одном derived snapshot", async () => {
  const helper = await loadSidebarProjection();
  try {
    const projection = helper.buildSidebarProjection({
      page: "main",
      selected: { kind: "group", id: "g-1" },
      mobileSidebarTab: "chats",
      sidebarQuery: "  team  ",
      sidebarArchiveOpen: true,
      drafts: {},
      groups: [{ id: "g-1", name: "Team Room", handle: "team" }],
      boards: [],
      pinned: [],
      archived: ["room:g-1"],
      friends: [],
      pendingIn: [],
      pendingOut: [],
      pendingGroupInvites: [],
      pendingGroupJoinRequests: [],
      pendingBoardInvites: [],
      fileOffersIn: [],
      muted: [],
      profiles: {},
      selfId: "111-111-111",
      conversations: {
        "room:g-1": [
          { kind: "in", from: "222-222-222", text: "@111-111-111 hello", ts: 10, id: 1 },
          { kind: "in", from: "222-222-222", text: "new", ts: 20, id: 2 },
        ],
      },
      lastRead: { "room:g-1": { id: 1 } },
    });
    assert.equal(projection.currentSelectedKey, "room:g-1");
    assert.equal(projection.mobileTab, "contacts");
    assert.equal(projection.sidebarQueryRaw, "team");
    assert.equal(projection.matchesRoom({ id: "g-1", name: "Team Room", handle: "team" }), true);
    assert.equal(projection.computeRoomUnread("room:g-1"), 1);
    assert.equal(projection.groupArchiveCount, 0);
  } finally {
    await helper.cleanup();
  }
});
