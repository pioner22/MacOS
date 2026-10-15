import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderHeader() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/header/renderHeader.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderHeader !== "function") throw new Error("renderHeader export missing");
    return { renderHeader: mod.renderHeader, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this.textContent = "";
      this._attrs = new Map();
      this._children = [];
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
    append(node) {
      this._children.push(node);
    }
    replaceChildren(...nodes) {
      this._children = nodes.map((n) => (typeof n === "string" ? globalThis.document.createTextNode(n) : n));
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

function findByClass(node, className) {
  if (!node) return null;
  if (node.nodeType === 3) return null;
  const cls = String(node.className || "");
  if (cls.split(/\s+/).includes(className)) return node;
  const children = Array.isArray(node._children) ? node._children : [];
  for (const ch of children) {
    const found = findByClass(ch, className);
    if (found) return found;
  }
  return null;
}

function findByAttr(node, name, value) {
  if (!node) return null;
  if (node.nodeType === 3) return null;
  if (typeof node.getAttribute === "function") {
    const v = node.getAttribute(name);
    if (v === value) return node;
  }
  const children = Array.isArray(node._children) ? node._children : [];
  for (const ch of children) {
    const found = findByAttr(ch, name, value);
    if (found) return found;
  }
  return null;
}

function getText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  const children = Array.isArray(node._children) ? node._children : [];
  return children.map(getText).join("");
}

test("renderHeader: показывает remembered ID, если selfId отсутствует (после выхода)", async () => {
  const helper = await loadRenderHeader();
  try {
    withDomStubs(() => {
      const layout = {
        headerLeft: globalThis.document.createElement("div"),
        headerRight: globalThis.document.createElement("div"),
        hotkeys: globalThis.document.createElement("div"),
      };
      helper.renderHeader(layout, {
        page: "main",
        conn: "connected",
        authed: false,
        selfId: null,
        authMode: "login",
        authRememberedId: "854-432-319",
        clientVersion: "0.1.54-test",
        serverVersion: "0.0.0",
        status: "",
        selected: null,
      });
      const idNode = findByClass(layout.headerLeft, "hdr-id");
      assert.ok(idNode, "hdr-id span not found");
      assert.equal(getText(idNode), "854-432-319");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderHeader: в режиме авто-входа не показывает кнопку входа в шапке", async () => {
  const helper = await loadRenderHeader();
  try {
    withDomStubs(() => {
      const layout = {
        headerLeft: globalThis.document.createElement("div"),
        headerRight: globalThis.document.createElement("div"),
        hotkeys: globalThis.document.createElement("div"),
      };
      helper.renderHeader(layout, {
        page: "main",
        conn: "connected",
        authed: false,
        selfId: null,
        authMode: "auto",
        authRememberedId: "854-432-319",
        clientVersion: "0.1.70-test",
        serverVersion: "0.0.0",
        status: "Автовход…",
        selected: null,
      });
      const btn = findByClass(layout.headerRight, "hdr-auth");
      assert.equal(btn, null, "hdr-auth button should be removed from header");
      const status = findByClass(layout.headerRight, "hdr-status");
      assert.ok(status, "hdr-status should be rendered as the status lane");
      assert.equal(status.getAttribute("role"), "status");
      assert.equal(status.getAttribute("aria-live"), "polite");
      assert.equal(layout.headerRight.getAttribute("data-status-empty"), "0");
      assert.equal(layout.headerRight.getAttribute("data-status-tone"), "info");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderHeader: в неавторизованном login-режиме показывает заметную кнопку входа в правой части шапки", async () => {
  const helper = await loadRenderHeader();
  try {
    withDomStubs(() => {
      const layout = {
        headerLeft: globalThis.document.createElement("div"),
        headerRight: globalThis.document.createElement("div"),
        hotkeys: globalThis.document.createElement("div"),
      };
      helper.renderHeader(layout, {
        page: "main",
        conn: "connected",
        authed: false,
        selfId: null,
        authMode: "login",
        authRememberedId: "854-432-319",
        clientVersion: "0.1.751-test",
        serverVersion: "0.0.0",
        status: "Соединение установлено. Введите код доступа, чтобы продолжить.",
        selected: null,
      });
      const btn = findByClass(layout.headerRight, "hdr-auth");
      assert.ok(btn, "hdr-auth button not found");
      assert.equal(getText(btn), "Войти");
      assert.equal(btn.getAttribute("data-action"), "auth-open");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderHeader: на страницах (не main) nav-toggle работает как back (data-action=nav-back)", async () => {
  const helper = await loadRenderHeader();
  try {
    withDomStubs(() => {
      const layout = {
        headerLeft: globalThis.document.createElement("div"),
        headerRight: globalThis.document.createElement("div"),
        hotkeys: globalThis.document.createElement("div"),
      };
      helper.renderHeader(layout, {
        page: "profile",
        conn: "connected",
        authed: true,
        selfId: "854-432-319",
        authMode: "login",
        authRememberedId: "854-432-319",
        clientVersion: "0.1.109-test",
        serverVersion: "0.0.0",
        status: "",
        selected: null,
      });
      const nav = findByClass(layout.headerLeft, "nav-toggle");
      assert.ok(nav, "nav-toggle button not found");
      assert.equal(nav.getAttribute("data-action"), "nav-back");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderHeader: в main чате показывает topbar меню чата (data-action=chat-topbar-menu)", async () => {
  const helper = await loadRenderHeader();
  try {
    withDomStubs(() => {
      const layout = {
        headerLeft: globalThis.document.createElement("div"),
        headerRight: globalThis.document.createElement("div"),
        hotkeys: globalThis.document.createElement("div"),
      };
      helper.renderHeader(layout, {
        page: "main",
        conn: "connected",
        authed: true,
        selfId: "854-432-319",
        authMode: "login",
        authRememberedId: "854-432-319",
        clientVersion: "0.1.658-test",
        serverVersion: "0.0.0",
        status: "",
        selected: { kind: "dm", id: "123-456-789" },
      });
      const btn = findByAttr(layout.headerRight, "data-action", "chat-topbar-menu");
      assert.ok(btn, "chat-topbar-menu button not found");
    });
  } finally {
    await helper.cleanup();
  }
});
