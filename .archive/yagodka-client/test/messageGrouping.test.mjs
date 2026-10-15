import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadMessageGrouping() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/messageGrouping.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.isMessageContinuation !== "function") {
      throw new Error("isMessageContinuation export missing");
    }
    return {
      isMessageContinuation: mod.isMessageContinuation,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("messageGrouping: isMessageContinuation базовые правила", async () => {
  const { isMessageContinuation, cleanup } = await loadMessageGrouping();
  try {
    const prev = { kind: "in", from: "a", room: "", text: "x", ts: 100, id: 1 };
    const curOk = { kind: "in", from: "a", room: "", text: "y", ts: 120, id: 2 };
    const curGap = { kind: "in", from: "a", room: "", text: "y", ts: 1000, id: 2 };
    const curFrom = { kind: "in", from: "b", room: "", text: "y", ts: 120, id: 2 };
    const curRoom = { kind: "in", from: "a", room: "r1", text: "y", ts: 120, id: 2 };
    const curKind = { kind: "out", from: "a", room: "", text: "y", ts: 120, id: 2 };
    const sys = { kind: "sys", from: "a", room: "", text: "z", ts: 120, id: 3 };

    assert.equal(isMessageContinuation(null, curOk), false);
    assert.equal(isMessageContinuation(prev, curOk), true);
    assert.equal(isMessageContinuation(prev, curGap), false);
    assert.equal(isMessageContinuation(prev, curFrom), false);
    assert.equal(isMessageContinuation(prev, curRoom), false);
    assert.equal(isMessageContinuation(prev, curKind), false);
    assert.equal(isMessageContinuation(prev, sys), false);
    assert.equal(isMessageContinuation(sys, curOk), false);
  } finally {
    await cleanup();
  }
});

test("messageGrouping: isMessageContinuation уважает maxGapSeconds (с clamp)", async () => {
  const { isMessageContinuation, cleanup } = await loadMessageGrouping();
  try {
    const prev = { kind: "in", from: "a", room: "", text: "x", ts: 100, id: 1 };
    const cur9 = { kind: "in", from: "a", room: "", text: "y", ts: 109, id: 2 };
    const cur11 = { kind: "in", from: "a", room: "", text: "y", ts: 111, id: 2 };
    assert.equal(isMessageContinuation(prev, cur9, { maxGapSeconds: 1 }), true); // clamp to >=10
    assert.equal(isMessageContinuation(prev, cur11, { maxGapSeconds: 1 }), false);

    const cur1800 = { kind: "in", from: "a", room: "", text: "y", ts: 1900, id: 2 };
    const cur1801 = { kind: "in", from: "a", room: "", text: "y", ts: 1901, id: 2 };
    assert.equal(isMessageContinuation(prev, cur1800, { maxGapSeconds: 999_999 }), true); // clamp to 30min
    assert.equal(isMessageContinuation(prev, cur1801, { maxGapSeconds: 999_999 }), false);
  } finally {
    await cleanup();
  }
});

