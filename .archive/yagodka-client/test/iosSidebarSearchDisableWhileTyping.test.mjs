import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderSidebar() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/sidebar/renderSidebar.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderSidebar !== "function") {
      throw new Error("renderSidebar export missing");
    }
    return { renderSidebar: mod.renderSidebar, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

async function withDomStubs(run) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    navigatorDesc: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
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

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this._attrs = new Map();
      this._children = [];
      this._listeners = new Map();
      this.style = new StyleStub();
      this.scrollTop = 0;
    }
    setAttribute(name, value) {
      this._attrs.set(String(name), String(value));
      if (String(name).toLowerCase() === "class") this.className = String(value);
    }
    getAttribute(name) {
      const v = this._attrs.get(String(name));
      return v === undefined ? null : v;
    }
    hasAttribute(name) {
      return this._attrs.has(String(name));
    }
    removeAttribute(name) {
      this._attrs.delete(String(name));
    }
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
    }
    replaceChildren(...nodes) {
      this._children = [...nodes];
    }
    addEventListener(type, handler) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      list.push(handler);
      this._listeners.set(key, list);
    }
    dispatchEvent(event) {
      const ev = event || {};
      const key = String(ev.type || "");
      const list = this._listeners.get(key) || [];
      for (const h of list) h(ev);
      return true;
    }
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
      this.type = "text";
      this.value = "";
      this.disabled = false;
    }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (String(name).toLowerCase() === "type") this.type = String(value);
    }
  }

  class HTMLTextAreaElementStub extends HTMLElementStub {
    constructor() {
      super("textarea");
      this.value = "";
      this.disabled = false;
    }
  }

  const doc = {
    activeElement: null,
    documentElement: { classList: { contains: () => false } },
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === "input") return new HTMLInputElementStub();
      if (t === "textarea") return new HTMLTextAreaElementStub();
      return new HTMLElementStub(t);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    getElementById() {
      return null;
    },
  };

  globalThis.HTMLElement = HTMLElementStub;
  globalThis.HTMLInputElement = HTMLInputElementStub;
  globalThis.HTMLTextAreaElement = HTMLTextAreaElementStub;
  globalThis.document = doc;
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)", maxTouchPoints: 0, standalone: false },
    configurable: true,
  });
  globalThis.window = {
    matchMedia: (q) => {
      const query = String(q || "");
      if (query.includes("max-width: 600px")) return { matches: true };
      if (query.includes("pointer: coarse")) return { matches: true };
      if (query.includes("hover: none")) return { matches: true };
      return { matches: false };
    },
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };

  try {
    return await run();
  } finally {
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.navigatorDesc) Object.defineProperty(globalThis, "navigator", prev.navigatorDesc);
    else delete globalThis.navigator;
    if (prev.HTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = prev.HTMLElement;
    if (prev.HTMLInputElement === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = prev.HTMLInputElement;
    if (prev.HTMLTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = prev.HTMLTextAreaElement;
  }
}

async function flushLazySidebarRender() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function findFirst(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") {
      const hit = findFirst(k, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

test("iOS: sidebar search input disables while composer is focused (avoid prev/next bar)", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(async () => {
      const target = document.createElement("div");
      const composer = document.createElement("textarea");
      composer.setAttribute("data-ios-assistant", "composer");
      document.activeElement = composer;

      const state = {
        conn: "connected",
        authed: true,
        friends: [],
        profiles: {},
        groups: [],
        boards: [],
        pinned: [],
        pendingIn: [],
        pendingOut: [],
        pendingGroupInvites: [],
        pendingGroupJoinRequests: [],
        pendingBoardInvites: [],
        fileOffersIn: [],
        selected: null,
        page: "main",
        mobileSidebarTab: "contacts",
        conversations: {},
        drafts: {},
        sidebarQuery: "",
      };

      helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
      await flushLazySidebarRender();

      const input = findFirst(
        target,
        (n) => n && typeof n === "object" && n.tagName === "INPUT" && String(n.className || "").split(" ").includes("sidebar-search-input")
      );
      assert.ok(input, "sidebar search input not found");
      assert.equal(Boolean(input.disabled), true);
    });
  } finally {
    await helper.cleanup();
  }
});
