import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHistoryRenderSurface() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "historyRenderSurface.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/chat/historyRenderSurface.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.buildHistoryRenderSurface !== "function") {
      throw new Error("historyRenderSurface export missing");
    }
    return {
      buildHistoryRenderSurface: mod.buildHistoryRenderSurface,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
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
  };

  class StyleStub {
    constructor() {
      this._props = new Map();
    }
    setProperty(name, value) {
      this._props.set(String(name), String(value));
    }
  }

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
      for (const name of names) {
        for (const part of String(name || "")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter(Boolean)) {
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
      this.style = new StyleStub();
    }
    get className() {
      return this._className;
    }
    set className(value) {
      const next = String(value || "");
      this._className = next;
      this.classList._syncFrom(next);
      this.classList._syncTo();
    }
    setAttribute(name, value) {
      this._attrs.set(String(name), String(value));
    }
    getAttribute(name) {
      const value = this._attrs.get(String(name));
      return value === undefined ? null : value;
    }
    append(...nodes) {
      for (const node of nodes) this._children.push(node);
    }
    replaceChildren(...nodes) {
      this._children = [...nodes];
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
      const lower = String(tag).toLowerCase();
      if (lower === "input") return new HTMLInputElementStub();
      if (lower === "textarea") return new HTMLTextAreaElementStub();
      return new HTMLElementStub(tag);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
  };

  const restore = () => {
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;

    if (prev.HTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = prev.HTMLElement;

    if (prev.HTMLInputElement === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = prev.HTMLInputElement;

    if (prev.HTMLTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = prev.HTMLTextAreaElement;
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

function textOf(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.textContent === "string") return node.textContent;
  const kids = Array.isArray(node._children) ? node._children : [];
  return kids.map((child) => textOf(child)).join("");
}

test("historyRenderSurface: loadingMore резервирует верхние skeleton-слоты", async () => {
  const helper = await loadHistoryRenderSurface();
  try {
    withDomStubs(() => {
      const surface = helper.buildHistoryRenderSurface({
        state: {
          fileTransfers: [],
          fileOffersIn: [],
          fileThumbs: {},
          friends: [],
          lastRead: {},
          selected: { kind: "dm", id: "222-222-222" },
        },
        msgs: [],
        key: "dm:222-222-222",
        mobileUi: false,
        boardUi: false,
        selectionCount: 0,
        selectionSet: null,
        hitSet: null,
        activeMsgIdx: null,
        historyLoaded: true,
        hasMore: true,
        loadingMore: true,
        loadingMoreSlotCount: 4,
        loadingInitial: false,
        virtualEnabled: false,
        virtualStart: 0,
        virtualEnd: 0,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        unreadInsertIdx: -1,
        unreadCount: 0,
        albumLayout: { maxWidth: 420, minWidth: 100, spacing: 1 },
      });

      assert.equal(surface.isEmptyState, false);
      assert.equal(surface.lines.length, 5);
      assert.equal(surface.lines[0].className, "chat-history-more-wrap");
      assert.equal(surface.lines.slice(1).filter((node) => node.className.includes("chat-history-slot")).length, 4);
    });
  } finally {
    await helper.cleanup();
  }
});

test("historyRenderSurface: очищенная история показывает quiet empty-state без retry ошибки", async () => {
  const helper = await loadHistoryRenderSurface();
  try {
    withDomStubs(() => {
      const surface = helper.buildHistoryRenderSurface({
        state: {
          selfId: "111-111-111",
          fileTransfers: [],
          fileOffersIn: [],
          fileThumbs: {},
          friends: [],
          lastRead: {},
          selected: { kind: "dm", id: "222-222-222" },
        },
        msgs: [],
        key: "dm:222-222-222",
        mobileUi: false,
        boardUi: false,
        selectionCount: 0,
        selectionSet: null,
        hitSet: null,
        activeMsgIdx: null,
        historyLoaded: true,
        historyEmptyNotice: {
          kind: "cleared",
          scope: "dm",
          by: "222-222-222",
          at: 1,
          deleted: 3,
        },
        hasMore: false,
        loadingMore: false,
        loadingMoreSlotCount: 0,
        loadingInitial: false,
        virtualEnabled: false,
        virtualStart: 0,
        virtualEnd: 0,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        unreadInsertIdx: -1,
        unreadCount: 0,
        albumLayout: { maxWidth: 420, minWidth: 100, spacing: 1 },
      });

      assert.equal(surface.isEmptyState, true);
      assert.equal(surface.lines.length, 1);
      assert.equal(surface.lines[0].getAttribute("data-empty-notice"), "cleared");
      assert.match(textOf(surface.lines[0]), /История очищена собеседником/);
      assert.doesNotMatch(textOf(surface.lines[0]), /История не загружена/);
    });
  } finally {
    await helper.cleanup();
  }
});
