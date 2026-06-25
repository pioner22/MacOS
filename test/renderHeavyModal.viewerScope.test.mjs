import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderHeavyModal() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderHeavyModal.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function withDomStubs(run) {
  const prev = {
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    window: globalThis.window,
    location: globalThis.location,
  };

  class ClassListStub {
    constructor(owner) {
      this._owner = owner;
    }
    _syncFrom(value) {
      const parts = String(value || "")
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean);
      this._owner._classSet = new Set(parts);
    }
    _syncTo() {
      this._owner._className = [...this._owner._classSet].join(" ");
    }
    add(...names) {
      for (const n of names) {
        for (const part of String(n || "")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter(Boolean)) {
          this._owner._classSet.add(part);
        }
      }
      this._syncTo();
    }
    toggle(name, force) {
      const part = String(name || "").trim();
      if (!part) return false;
      const has = this._owner._classSet.has(part);
      const shouldHave = force === undefined ? !has : Boolean(force);
      if (shouldHave) this._owner._classSet.add(part);
      else this._owner._classSet.delete(part);
      this._syncTo();
      return shouldHave;
    }
    contains(name) {
      return this._owner._classSet.has(String(name || "").trim());
    }
  }

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this._attrs = new Map();
      this._children = [];
      this._className = "";
      this._classSet = new Set();
      this.classList = new ClassListStub(this);
      this.style = { setProperty() {}, removeProperty() {} };
      this.isConnected = false;
    }
    get className() {
      return this._className;
    }
    set className(value) {
      const v = String(value || "");
      this._className = v;
      this.classList._syncFrom(v);
      this.classList._syncTo();
    }
    setAttribute(name, value) {
      this._attrs.set(String(name), String(value));
    }
    hasAttribute(name) {
      return this._attrs.has(String(name));
    }
    getAttribute(name) {
      const v = this._attrs.get(String(name));
      return v === undefined ? null : v;
    }
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
    }
    replaceChildren(...nodes) {
      this._children = [...nodes];
    }
    addEventListener() {}
    querySelector() {
      return null;
    }
    getBoundingClientRect() {
      return { height: 0, width: 0, top: 0, left: 0, bottom: 0, right: 0 };
    }
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
      this.type = "text";
    }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (String(name).toLowerCase() === "type") this.type = String(value);
    }
  }

  class HTMLTextAreaElementStub extends HTMLElementStub {
    constructor() {
      super("textarea");
    }
  }

  globalThis.HTMLElement = HTMLElementStub;
  globalThis.HTMLInputElement = HTMLInputElementStub;
  globalThis.HTMLTextAreaElement = HTMLTextAreaElementStub;
  globalThis.document = {
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === "input") return new HTMLInputElementStub();
      if (t === "textarea") return new HTMLTextAreaElementStub();
      return new HTMLElementStub(t);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
  };
  globalThis.location = { href: "https://yagodka.org/web/" };
  globalThis.window = {
    location: { href: "https://yagodka.org/web/" },
    requestAnimationFrame() {
      return 1;
    },
  };

  try {
    return run();
  } finally {
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.HTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = prev.HTMLElement;
    if (prev.HTMLInputElement === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = prev.HTMLInputElement;
    if (prev.HTMLTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = prev.HTMLTextAreaElement;
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.location === undefined) delete globalThis.location;
    else globalThis.location = prev.location;
  }
}

function findAll(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") findAll(k, predicate, out);
  }
  return out;
}

function mediaMsg(id, ts, opts = {}) {
  return {
    id,
    ts,
    kind: opts.kind || "in",
    from: opts.from || "u1",
    room: opts.room || "",
    text: opts.text ?? "[file]",
    attachment: {
      kind: "file",
      fileId: opts.fileId || `f-${id}`,
      name: opts.name || `photo-${id}.jpg`,
      mime: opts.mime || "image/jpeg",
    },
  };
}

function baseState(conversations, fileThumbs = {}) {
  return {
    selfId: "self",
    conn: "connected",
    authed: true,
    editing: false,
    conversations,
    fileThumbs,
    fileTransfers: [],
    profiles: { u1: { display_name: "User 1", handle: "user1" } },
    friends: [],
    groups: [],
    boards: [],
    pinned: [],
    archived: [],
    topPeers: [],
  };
}

test("renderHeavyModal: single-source viewer does not render unrelated rail items", async () => {
  const { mod, cleanup } = await loadRenderHeavyModal();
  try {
    withDomStubs(() => {
      const conversations = {
        "dm:u1": [
          mediaMsg(1, 100, { text: "before caption" }),
          mediaMsg(2, 500),
          mediaMsg(3, 900, { text: "after caption" }),
        ],
      };
      const state = baseState(conversations, {
        "f-1": { url: "blob:one" },
        "f-2": { url: "blob:two" },
        "f-3": { url: "blob:three" },
      });
      const modal = {
        kind: "file_viewer",
        fileId: "f-2",
        url: "blob:two",
        name: "photo-2.jpg",
        size: 10,
        mime: "image/jpeg",
        chatKey: "dm:u1",
        msgIdx: 1,
      };
      const node = mod.renderFileViewerHeavyModal(state, modal, {
        onClose() {},
        onFileViewerNavigate() {},
        onFileViewerJump() {},
        onFileViewerShare() {},
        onFileViewerForward() {},
        onFileViewerDelete() {},
        onFileViewerOpenAt() {},
      });
      const railItems = findAll(node, (n) => n && String(n.className || "").includes("viewer-rail-item"));
      assert.equal(railItems.length, 0);
    });
  } finally {
    await cleanup();
  }
});

test("renderHeavyModal: album viewer rail stays inside the grouped album", async () => {
  const { mod, cleanup } = await loadRenderHeavyModal();
  try {
    withDomStubs(() => {
      const conversations = {
        "dm:u1": [mediaMsg(1, 100), mediaMsg(2, 130), mediaMsg(3, 160), mediaMsg(4, 600, { text: "later caption" })],
      };
      const state = baseState(conversations, {
        "f-1": { url: "blob:one" },
        "f-2": { url: "blob:two" },
        "f-3": { url: "blob:three" },
        "f-4": { url: "blob:four" },
      });
      const modal = {
        kind: "file_viewer",
        fileId: "f-2",
        url: "blob:two",
        name: "photo-2.jpg",
        size: 10,
        mime: "image/jpeg",
        chatKey: "dm:u1",
        msgIdx: 1,
      };
      const node = mod.renderFileViewerHeavyModal(state, modal, {
        onClose() {},
        onFileViewerNavigate() {},
        onFileViewerJump() {},
        onFileViewerShare() {},
        onFileViewerForward() {},
        onFileViewerDelete() {},
        onFileViewerOpenAt() {},
      });
      const railItems = findAll(node, (n) => n && String(n.className || "").includes("viewer-rail-item"));
      assert.equal(railItems.length, 3);
    });
  } finally {
    await cleanup();
  }
});
