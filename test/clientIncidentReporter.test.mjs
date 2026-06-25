import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadReporter() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/observability/clientIncidentReporter.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createClientIncidentReporter !== "function") {
      throw new Error("createClientIncidentReporter export missing");
    }
    return {
      createClientIncidentReporter: mod.createClientIncidentReporter,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("clientIncidentReporter: dedupes repeated incidents and enriches context", async () => {
  const { createClientIncidentReporter, cleanup } = await loadReporter();
  try {
    const sent = [];
    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    const dispatched = [];
    const localData = new Map();
    const sessionData = new Map();
    globalThis.document = { visibilityState: "visible" };
    globalThis.window = {
      localStorage: {
        getItem(key) {
          return localData.has(key) ? localData.get(key) : null;
        },
        setItem(key, value) {
          localData.set(String(key), String(value));
        },
        removeItem(key) {
          localData.delete(String(key));
        },
      },
      sessionStorage: {
        getItem(key) {
          return sessionData.has(key) ? sessionData.get(key) : null;
        },
        setItem(key, value) {
          sessionData.set(String(key), String(value));
        },
        removeItem(key) {
          sessionData.delete(String(key));
        },
      },
      dispatchEvent(event) {
        dispatched.push({ type: event.type, detail: event.detail });
        return true;
      },
    };
    try {
      const reporter = createClientIncidentReporter({
        store: {
          get() {
            return {
              authed: true,
              conn: "connected",
              page: "main",
              netLeader: true,
              selected: { kind: "dm", id: "123-456-789" },
            };
          },
        },
        send(payload) {
          sent.push(payload);
        },
      });

      const first = reporter.report("file_download_failed", {
        file_id: "f-1",
        reason: "download_failed",
      });
      const second = reporter.report("file_download_failed", {
        file_id: "f-1",
        reason: "download_failed",
      });

      assert.equal(first, true);
      assert.equal(second, false);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].type, "client_incident");
      assert.equal(sent[0].incident_kind, "file_download_failed");
      assert.equal(sent[0].detail.file_id, "f-1");
      assert.equal(sent[0].detail.conversation_key, "dm:123-456-789");
      assert.equal(sent[0].detail.selected_kind, "dm");
      assert.equal(sent[0].detail.visibility, "visible");
      assert.ok(dispatched.some((entry) => entry.type === "yagodka:pwa-stability-hold"));
      assert.ok(dispatched.some((entry) => entry.type === "yagodka:client-incident"));
      assert.ok(localData.get("yagodka_pwa_stability_hold_v1"));
    } finally {
      if (prevDocument === undefined) delete globalThis.document;
      else globalThis.document = prevDocument;
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  } finally {
    await cleanup();
  }
});
