import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadModalSurface() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/navigation/modalSurface.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (
      typeof mod.resolveModalPresentation !== "function" ||
      typeof mod.resolveOverlayBackdropAction !== "function" ||
      typeof mod.applyOverlaySurface !== "function"
    ) {
      throw new Error("modalSurface exports missing");
    }
    return {
      resolveModalPresentation: mod.resolveModalPresentation,
      resolveOverlayBackdropAction: mod.resolveOverlayBackdropAction,
      applyOverlaySurface: mod.applyOverlaySurface,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("modalSurface: auth-only режим форсирует fullscreen auth surface", async () => {
  const { resolveModalPresentation, cleanup } = await loadModalSurface();
  try {
    const presentation = resolveModalPresentation({ authed: false, modal: null });
    assert.equal(presentation.fullScreenKind, "auth");
    assert.equal(presentation.fullScreenActive, true);
    assert.equal(presentation.authModalVisible, true);
    assert.equal(presentation.inlineModal, false);
    assert.equal(presentation.overlaySurface, "overlay-auth");
  } finally {
    await cleanup();
  }
});

test("modalSurface: send_schedule остаётся inline modal", async () => {
  const { resolveModalPresentation, cleanup } = await loadModalSurface();
  try {
    const presentation = resolveModalPresentation({
      authed: true,
      modal: { kind: "send_schedule", target: { kind: "dm", id: "111-111-111" }, text: "hello" },
    });
    assert.equal(presentation.fullScreenKind, null);
    assert.equal(presentation.fullScreenActive, false);
    assert.equal(presentation.inlineModal, true);
    assert.equal(presentation.overlaySurface, null);
  } finally {
    await cleanup();
  }
});

test("modalSurface: context_menu и file_viewer идут через overlay surfaces", async () => {
  const { resolveModalPresentation, cleanup } = await loadModalSurface();
  try {
    const contextMenu = resolveModalPresentation({
      authed: true,
      modal: { kind: "context_menu", payload: { x: 1, y: 2, title: "Меню", target: { kind: "dm", id: "u1" }, items: [] } },
    });
    assert.equal(contextMenu.inlineModal, false);
    assert.equal(contextMenu.overlaySurface, "overlay-context");

    const fileViewer = resolveModalPresentation({
      authed: true,
      modal: { kind: "file_viewer", chatKey: "dm:u1", msgIdx: 3, fileId: "file-1", openedAtMs: 1000 },
    });
    assert.equal(fileViewer.inlineModal, false);
    assert.equal(fileViewer.overlaySurface, "overlay-viewer");

    const call = resolveModalPresentation({
      authed: true,
      modal: {
        kind: "call",
        callId: "call-1",
        roomName: "Room",
        mode: "audio",
        from: "u1",
        title: "Call",
      },
    });
    assert.equal(call.inlineModal, false);
    assert.equal(call.overlaySurface, "overlay-viewer");
  } finally {
    await cleanup();
  }
});

test("modalSurface: call surface does not reuse viewer html state", async () => {
  const { applyOverlaySurface, cleanup } = await loadModalSurface();
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    const toggles = [];
    const overlayClasses = new Set();
    const htmlClassList = {
      toggle(name, value) {
        toggles.push([name, Boolean(value)]);
      },
    };
    const overlay = {
      firstElementChild: null,
      replaceChildren(...children) {
        this.firstElementChild = children[0] || null;
      },
      classList: {
        toggle(name, value) {
          if (value) overlayClasses.add(name);
          else overlayClasses.delete(name);
        },
      },
    };
    const callNode = {
      classList: {
        contains(name) {
          return name === "modal-call";
        },
      },
    };
    const documentStub = { documentElement: { classList: htmlClassList } };
    Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true, writable: true });

    applyOverlaySurface(overlay, "overlay-viewer", callNode);

    assert.deepEqual(toggles, [
      ["viewer-surface-open", false],
      ["call-surface-open", true],
    ]);
    assert.equal(overlayClasses.has("overlay-viewer"), true);
    assert.equal(overlay.firstElementChild, callNode);
  } finally {
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    await cleanup();
  }
});

test("modalSurface: pwa_update идёт через отдельный update overlay без auth fullscreen", async () => {
  const { resolveModalPresentation, cleanup } = await loadModalSurface();
  try {
    const presentation = resolveModalPresentation({
      authed: true,
      modal: { kind: "pwa_update" },
    });
    assert.equal(presentation.fullScreenKind, null);
    assert.equal(presentation.fullScreenActive, false);
    assert.equal(presentation.inlineModal, false);
    assert.equal(presentation.overlaySurface, "overlay-update");
  } finally {
    await cleanup();
  }
});

test("modalSurface: backdrop policy различает none / consume / close", async () => {
  const { resolveOverlayBackdropAction, cleanup } = await loadModalSurface();
  try {
    assert.equal(resolveOverlayBackdropAction(null, 2000), "none");
    assert.equal(resolveOverlayBackdropAction({ kind: "auth", message: "login" }, 2000), "none");
    assert.equal(
      resolveOverlayBackdropAction(
        { kind: "context_menu", payload: { x: 1, y: 2, title: "Меню", target: { kind: "dm", id: "u1" }, items: [] } },
        2000
      ),
      "close"
    );
    assert.equal(
      resolveOverlayBackdropAction({ kind: "file_viewer", chatKey: "dm:u1", msgIdx: 1, fileId: "f1", openedAtMs: 1700 }, 2000),
      "consume"
    );
    assert.equal(
      resolveOverlayBackdropAction({ kind: "file_viewer", chatKey: "dm:u1", msgIdx: 1, fileId: "f1", openedAtMs: 1200 }, 2000),
      "close"
    );
  } finally {
    await cleanup();
  }
});
