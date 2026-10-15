import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadOutboxHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/outbox.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return {
      sanitizeOutboxMap: mod.sanitizeOutboxMap,
      addOutboxEntry: mod.addOutboxEntry,
      updateOutboxEntry: mod.updateOutboxEntry,
      removeOutboxEntry: mod.removeOutboxEntry,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("outbox: sanitizeOutboxMap фильтрует мусор, дедупит и сортирует", async () => {
  const { sanitizeOutboxMap, cleanup } = await loadOutboxHelpers();
  try {
    const raw = {
      "dm:222-222-222": [
        { localId: "a", ts: 2, text: "hi", to: "222-222-222", status: "queued", attempts: 1, lastAttemptAt: 10, whenOnline: true, silent: true, scheduleAt: 1234 },
        { localId: "a", ts: 3, text: "dup", to: "222-222-222" },
        { localId: "", ts: 1, text: "bad", to: "222-222-222" },
        { localId: "b", ts: 1, text: "first", to: "222-222-222" },
      ],
      "room:room1": [{ localId: "r1", ts: 5, text: "room", room: "room1" }],
      "bad:key": [{ localId: "x", ts: 1, text: "nope", to: "222-222-222" }],
    };

    const out = sanitizeOutboxMap(raw);
    assert.deepEqual(Object.keys(out).sort(), ["dm:222-222-222", "room:room1"]);
    assert.equal(out["dm:222-222-222"].length, 2);
    assert.equal(out["dm:222-222-222"][0].localId, "b");
    assert.equal(out["dm:222-222-222"][1].localId, "a");
    assert.equal(out["dm:222-222-222"][1].whenOnline, true);
    assert.equal(out["dm:222-222-222"][1].silent, true);
    assert.equal(out["dm:222-222-222"][1].scheduleAt, 1234);
  } finally {
    await cleanup();
  }
});

test("outbox: add/update/remove работают и чистят ключ, когда список пуст", async () => {
  const { addOutboxEntry, updateOutboxEntry, removeOutboxEntry, cleanup } = await loadOutboxHelpers();
  try {
    const key = "dm:222-222-222";
    const base = {};
    const e1 = { localId: "a", ts: 1, text: "one", to: "222-222-222", status: "queued" };
    const e2 = { localId: "b", ts: 2, text: "two", to: "222-222-222", status: "queued" };

    const o1 = addOutboxEntry(base, key, e1);
    const o2 = addOutboxEntry(o1, key, e2);
    assert.equal(o2[key].length, 2);

    const o3 = updateOutboxEntry(o2, key, "a", (e) => ({ ...e, status: "sending", attempts: 1 }));
    assert.equal(o3[key][0].status, "sending");
    assert.equal(o3[key][0].attempts, 1);

    const o4 = removeOutboxEntry(o3, key, "a");
    assert.equal(o4[key].length, 1);
    const o5 = removeOutboxEntry(o4, key, "b");
    assert.equal(o5[key], undefined);
  } finally {
    await cleanup();
  }
});
