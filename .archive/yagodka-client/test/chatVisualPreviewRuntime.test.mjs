import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRuntime() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/chat/chatVisualPreviewRuntime.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderDeferredVisualPreview !== "function") {
      throw new Error("renderDeferredVisualPreview export missing");
    }
    return { renderDeferredVisualPreview: mod.renderDeferredVisualPreview, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function withDomStubs(run) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLImageElement: globalThis.HTMLImageElement,
    HTMLVideoElement: globalThis.HTMLVideoElement,
  };

  class StyleStub {
    constructor() {
      this._props = new Map();
    }
    setProperty(name, value) {
      this._props.set(String(name), String(value));
    }
    getPropertyValue(name) {
      return this._props.get(String(name)) || "";
    }
  }

  class ClassListStub {
    constructor(owner) {
      this.owner = owner;
      this.set = new Set();
    }
    add(...names) {
      for (const name of names) {
        for (const part of String(name || "")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter(Boolean)) {
          this.set.add(part);
        }
      }
      this.owner._className = [...this.set].join(" ");
    }
    contains(name) {
      return this.set.has(String(name || "").trim());
    }
  }

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this._attrs = new Map();
      this._children = [];
      this._className = "";
      this.classList = new ClassListStub(this);
      this.style = new StyleStub();
    }
    get className() {
      return this._className;
    }
    set className(value) {
      const clean = String(value || "");
      this._className = clean;
      this.classList = new ClassListStub(this);
      this.classList.add(clean);
    }
    setAttribute(name, value) {
      const key = String(name);
      const val = String(value);
      this._attrs.set(key, val);
      if (key === "class") this.className = val;
    }
    getAttribute(name) {
      const value = this._attrs.get(String(name));
      return value === undefined ? null : value;
    }
    hasAttribute(name) {
      return this._attrs.has(String(name));
    }
    append(...nodes) {
      this._children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this._children = [...nodes];
    }
  }

  globalThis.HTMLElement = HTMLElementStub;
  globalThis.HTMLInputElement = HTMLElementStub;
  globalThis.HTMLTextAreaElement = HTMLElementStub;
  globalThis.HTMLImageElement = HTMLElementStub;
  globalThis.HTMLVideoElement = HTMLElementStub;
  globalThis.document = {
    createElement(tag) {
      return new HTMLElementStub(tag);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
  };
  globalThis.window = globalThis;

  const restore = () => {
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.HTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = prev.HTMLElement;
    if (prev.HTMLInputElement === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = prev.HTMLInputElement;
    if (prev.HTMLTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = prev.HTMLTextAreaElement;
    if (prev.HTMLImageElement === undefined) delete globalThis.HTMLImageElement;
    else globalThis.HTMLImageElement = prev.HTMLImageElement;
    if (prev.HTMLVideoElement === undefined) delete globalThis.HTMLVideoElement;
    else globalThis.HTMLVideoElement = prev.HTMLVideoElement;
  };

  try {
    const result = run();
    if (result && typeof result.then === "function") {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("chatVisualPreviewRuntime: fallback ratios reserve stable media slots", async () => {
  const { renderDeferredVisualPreview, cleanup } = await loadRuntime();
  try {
    await withDomStubs(async () => {
      const imagePreview = renderDeferredVisualPreview({
        info: {
          name: "photo.jpg",
          size: 1024,
          mime: "image/jpeg",
          fileId: "img-1",
          url: null,
          thumbUrl: null,
          thumbW: null,
          thumbH: null,
          mediaW: null,
          mediaH: null,
          transfer: null,
          offer: null,
          statusLine: "",
          isImage: true,
          isVideo: false,
          isAudio: false,
          hasProgress: false,
        },
        opts: {},
      });
      const videoPreview = renderDeferredVisualPreview({
        info: {
          name: "clip.mp4",
          size: 2048,
          mime: "video/mp4",
          fileId: "vid-1",
          url: null,
          thumbUrl: null,
          thumbW: null,
          thumbH: null,
          mediaW: null,
          mediaH: null,
          transfer: null,
          offer: null,
          statusLine: "",
          isImage: false,
          isVideo: true,
          isAudio: false,
          hasProgress: false,
        },
        opts: {},
      });
      const videoNotePreview = renderDeferredVisualPreview({
        info: {
          name: "video_note_123.mp4",
          size: 2048,
          mime: "video/mp4",
          fileId: "note-1",
          url: null,
          thumbUrl: null,
          thumbW: null,
          thumbH: null,
          mediaW: null,
          mediaH: null,
          transfer: null,
          offer: null,
          statusLine: "",
          isImage: false,
          isVideo: true,
          isAudio: false,
          hasProgress: false,
        },
        opts: {},
      });

      assert.equal(imagePreview.style.aspectRatio, String(4 / 3));
      assert.equal(videoPreview.style.aspectRatio, String(16 / 9));
      assert.equal(videoNotePreview.style.aspectRatio, "1 / 1");
      assert.equal(imagePreview.getAttribute("data-history-geometry"), "reserved");
    });
  } finally {
    await cleanup();
  }
});

test("chatVisualPreviewRuntime: reserved fallback ratio does not jump when media dimensions arrive later", async () => {
  const { renderDeferredVisualPreview, cleanup } = await loadRuntime();
  try {
    await withDomStubs(async () => {
      const first = renderDeferredVisualPreview({
        info: {
          name: "late-photo.jpg",
          size: 1024,
          mime: "image/jpeg",
          fileId: "img-late-ratio",
          url: null,
          thumbUrl: null,
          thumbW: null,
          thumbH: null,
          mediaW: null,
          mediaH: null,
          transfer: null,
          offer: null,
          statusLine: "",
          isImage: true,
          isVideo: false,
          isAudio: false,
          hasProgress: false,
        },
        opts: {},
      });
      const second = renderDeferredVisualPreview({
        info: {
          name: "late-photo.jpg",
          size: 1024,
          mime: "image/jpeg",
          fileId: "img-late-ratio",
          url: null,
          thumbUrl: null,
          thumbW: 1200,
          thumbH: 600,
          mediaW: 1200,
          mediaH: 600,
          transfer: null,
          offer: null,
          statusLine: "",
          isImage: true,
          isVideo: false,
          isAudio: false,
          hasProgress: false,
        },
        opts: {},
      });
      const explicit = renderDeferredVisualPreview({
        info: {
          name: "known-photo.jpg",
          size: 1024,
          mime: "image/jpeg",
          fileId: "img-known-ratio",
          url: null,
          thumbUrl: null,
          thumbW: 1200,
          thumbH: 600,
          mediaW: 1200,
          mediaH: 600,
          transfer: null,
          offer: null,
          statusLine: "",
          isImage: true,
          isVideo: false,
          isAudio: false,
          hasProgress: false,
        },
        opts: {},
      });

      assert.equal(first.style.aspectRatio, String(4 / 3));
      assert.equal(second.style.aspectRatio, String(4 / 3));
      assert.equal(explicit.style.aspectRatio, "2");
      assert.equal(second.style.getPropertyValue("--chat-media-slot-ratio"), String(4 / 3));
    });
  } finally {
    await cleanup();
  }
});
