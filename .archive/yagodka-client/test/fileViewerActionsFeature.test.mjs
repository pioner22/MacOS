import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  const entry = path.join(tempDir, "entry.ts");
  try {
    await writeFile(
      entry,
      [
        `export { createFileViewerActionsFeature } from ${JSON.stringify(path.resolve("src/app/features/files/fileViewerActionsFeature.ts"))};`,
        `export { rememberFileHttpBearer } from ${JSON.stringify(path.resolve("src/helpers/files/fileHttpAuth.ts"))};`,
      ].join("\n"),
      "utf8",
    );
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileViewerActionsFeature !== "function") {
      throw new Error("createFileViewerActionsFeature export missing");
    }
    if (typeof mod.rememberFileHttpBearer !== "function") {
      throw new Error("rememberFileHttpBearer export missing");
    }
    return {
      createFileViewerActionsFeature: mod.createFileViewerActionsFeature,
      rememberFileHttpBearer: mod.rememberFileHttpBearer,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function makeStore(modal) {
  return {
    get() {
      return {
        modal,
        conversations: {},
        conn: "connected",
        authed: true,
        selfId: "u1",
      };
    },
    set() {},
  };
}

test("fileViewerActionsFeature: не копирует signed file_http URL в буфер", async () => {
  const { createFileViewerActionsFeature, rememberFileHttpBearer, cleanup } = await loadFeature();
  const prevNavigator = globalThis.navigator;
  const prevWindow = globalThis.window;
  try {
    const clipboardWrites = [];
    const toasts = [];
    Object.defineProperty(globalThis, "window", {
      value: { location: { href: "https://yagodka.org/web/" } },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          async writeText(text) {
            clipboardWrites.push(text);
          },
        },
      },
      configurable: true,
      writable: true,
    });
    rememberFileHttpBearer("https://yagodka.org/files/f123", "secret");
    const feature = createFileViewerActionsFeature({
      store: makeStore({ kind: "file_viewer", url: "/files/f123", name: "photo.jpg" }),
      showToast: (message, opts) => toasts.push({ message, kind: opts?.kind || "info" }),
      closeModal() {},
      sendMessageDelete() {},
    });

    await feature.shareFromFileViewer();

    assert.deepEqual(clipboardWrites, []);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].kind, "info");
    assert.match(String(toasts[0].message), /ссылка/i);
  } finally {
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    await cleanup();
  }
});

test("fileViewerActionsFeature: shareFile fetches stripped URL with Authorization", async () => {
  const { createFileViewerActionsFeature, rememberFileHttpBearer, cleanup } = await loadFeature();
  const prevNavigator = globalThis.navigator;
  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  try {
    const fetchCalls = [];
    const shareCalls = [];
    Object.defineProperty(globalThis, "window", {
      value: { location: { href: "https://yagodka.org/web/" } },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "fetch", {
      value: async (input, init) => {
        fetchCalls.push({ url: String(input), headers: init?.headers || {} });
        return new Response(new Blob(["ok"], { type: "image/jpeg" }), { status: 200, headers: { "Content-Type": "image/jpeg" } });
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        share: async (payload) => {
          shareCalls.push(payload);
        },
        canShare: () => true,
        clipboard: {
          async writeText() {},
        },
      },
      configurable: true,
      writable: true,
    });
    rememberFileHttpBearer("https://yagodka.org/files/f123", "secret");
    const feature = createFileViewerActionsFeature({
      store: makeStore({ kind: "file_viewer", url: "/files/f123", name: "photo.jpg", mime: "image/jpeg" }),
      showToast() {},
      closeModal() {},
      sendMessageDelete() {},
    });

    await feature.shareFromFileViewer();

    assert.deepEqual(fetchCalls, [
      {
        url: "https://yagodka.org/files/f123",
        headers: { Authorization: "Bearer secret" },
      },
    ]);
    assert.equal(shareCalls.length, 1);
    assert.equal(Array.isArray(shareCalls[0].files), true);
    assert.equal(shareCalls[0].files[0].name, "photo.jpg");
  } finally {
    if (prevFetch === undefined) delete globalThis.fetch;
    else Object.defineProperty(globalThis, "fetch", { value: prevFetch, configurable: true, writable: true });
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    await cleanup();
  }
});
