import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function bundleEntry(entryPath, exportNames) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entryPath)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    for (const name of exportNames) {
      if (typeof mod[name] !== "function") throw new Error(`${name} export missing`);
    }
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withDomStubs(run) {
  const prev = {
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  };

  class ClassListStub {
    constructor(owner) {
      this._owner = owner;
    }
    _syncFrom(value) {
      const parts = String(value || "").split(/\s+/).map((x) => x.trim()).filter(Boolean);
      this._owner._classSet = new Set(parts);
    }
    _syncTo() {
      this._owner._className = [...this._owner._classSet].join(" ");
    }
    add(...names) {
      for (const n of names) {
        for (const part of String(n || "").split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
          this._owner._classSet.add(part);
        }
      }
      this._syncTo();
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
    getAttribute(name) {
      const v = this._attrs.get(String(name));
      return v === undefined ? null : v;
    }
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
    }
    addEventListener() {}
    focus() {}
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
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
  }
}

function findFirst(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const children = Array.isArray(node._children) ? node._children : [];
  for (const child of children) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

test("chat pinned surface: multi-pin state gets prev/next actions and count chip", async () => {
  const helper = await bundleEntry("src/components/chat/chatPinnedSurface.ts", ["renderChatPinnedSurface"]);
  try {
    withDomStubs(() => {
      const surface = helper.mod.renderChatPinnedSurface({
        msgs: [
          { kind: "in", from: "111", to: "222", room: null, text: "первый закреп", ts: 1700000000, id: 10 },
          { kind: "out", from: "222", to: "111", room: null, text: "второй закреп", ts: 1700000030, id: 11 },
        ],
        pinnedIds: [10, 11],
        activeRaw: 11,
      });
      assert.ok(surface);
      assert.ok(surface.className.split(/\s+/).includes("chat-pinned"));
      assert.ok(surface.className.split(/\s+/).includes("chat-pinned-text"));
      assert.equal(surface.getAttribute("data-pinned-count"), "2");

      const count = findFirst(surface, (node) => node && node.className === "chat-pinned-count");
      assert.ok(count);
      assert.equal(count._children[0]?.textContent, "2/2");

      const thumb = findFirst(surface, (node) => node && node.className === "chat-pinned-thumb");
      assert.equal(thumb, null, "pinned bar should stay compact without a large thumbnail block");

      const prev = findFirst(surface, (node) => node && typeof node.getAttribute === "function" && node.getAttribute("data-action") === "chat-pinned-prev");
      const next = findFirst(surface, (node) => node && typeof node.getAttribute === "function" && node.getAttribute("data-action") === "chat-pinned-next");
      const list = findFirst(surface, (node) => node && typeof node.getAttribute === "function" && node.getAttribute("data-action") === "chat-pinned-list");
      assert.ok(prev);
      assert.ok(next);
      assert.equal(list, null, "list button should stay hidden for only two pinned items");
    });
  } finally {
    await helper.cleanup();
  }
});

test("service surfaces css: pinned/jump/header-status/composer badges are covered by dedicated layer", async () => {
  const styleSrc = await readFile(path.resolve("src/scss/style.css"), "utf8");
  assert.match(styleSrc, /@import "\.\/service-surfaces\.css";/);

  const css = await readFile(path.resolve("src/scss/service-surfaces.css"), "utf8");
  const mediaCss = await readFile(path.resolve("src/scss/components.part03.css"), "utf8");
  const headerCss = await readFile(path.resolve("src/scss/components.part01.css"), "utf8");
  assert.match(css, /\.chat-pinned-marker\b/);
  assert.match(css, /\.chat-pinned-prev::before/);
  assert.match(css, /\.chat-jump-badge\b/);
  assert.match(css, /\.chat-jump-label\b/);
  assert.match(mediaCss, /\.chat-media-state-active\b/);
  assert.match(css, /\.btn\.composer-action\[data-media-perm="denied"\]::after/);
  assert.match(css, /\.toast-host\s*\{[\s\S]*display:\s*none\s*!important;/);
  assert.match(headerCss, /\.hdr-status-actions\b/);
  assert.match(css, /composer-video-self-preview/);
  assert.match(css, /\.composer-recorder\[data-recorder-mode="recording"\]\s+\.composer-video-self-preview/);
  assert.match(css, /contain:\s*layout paint/);

  const deferredActions = await readFile(path.resolve("src/app/features/navigation/chatSurfaceDeferredActions.ts"), "utf8");
  const createLayout = await readFile(path.resolve("src/components/layout/createLayout.ts"), "utf8");
  const mountApp = await readFile(path.resolve("src/app/mountApp.ts"), "utf8");
  assert.match(createLayout, /chatJumpLabel/);
  assert.match(mountApp, /data-jump-unread/);
  assert.match(mountApp, /К непрочитанным/);

  const hideBlock = deferredActions.slice(deferredActions.indexOf('action === "chat-pinned-hide"'), deferredActions.indexOf('action === "chat-pinned-list"'));
  assert.match(hideBlock, /unpinActiveForSelected/);
  assert.doesNotMatch(hideBlock, /kind:\s*"confirm"/);
});
