import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadCreateUserPage() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/pages/user/createUserPage.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createUserPage !== "function") throw new Error("createUserPage export missing");
    return { createUserPage: mod.createUserPage, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
      this._listeners = new Map();
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
    addEventListener(type, cb) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      list.push(cb);
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

function getText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  const children = Array.isArray(node._children) ? node._children : [];
  return children.map(getText).join("");
}

test("user page: на экране контакта нет лишней кнопки «Назад» (используем back в шапке)", async () => {
  const helper = await loadCreateUserPage();
  try {
    withDomStubs(() => {
      const page = helper.createUserPage({
        onBack: () => {},
        onOpenChat: () => {},
      });
      assert.ok(page && page.root, "page.root missing");
      const text = getText(page.root);
      assert.ok(text.includes("Сообщение"), "должна быть кнопка «Сообщение»");
      assert.ok(!text.includes("Назад"), "кнопка «Назад» внизу не должна рендериться");
    });
  } finally {
    await helper.cleanup();
  }
});
