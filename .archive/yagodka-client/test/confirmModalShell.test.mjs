import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

async function loadRenderConfirmModal() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderConfirmModal.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderConfirmModal !== "function") {
      throw new Error("renderConfirmModal export missing");
    }
    return { renderConfirmModal: mod.renderConfirmModal, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
  }

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this._attrs = new Map();
      this._children = [];
      this._listeners = new Map();
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
    addEventListener(type, handler) {
      const key = String(type);
      const arr = this._listeners.get(key) || [];
      arr.push(handler);
      this._listeners.set(key, arr);
    }
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

test("renderConfirmModal: dedicated shell + danger tone + Escape cancel", async () => {
  const helper = await loadRenderConfirmModal();
  try {
    withDomStubs(() => {
      let confirmed = 0;
      let cancelled = 0;
      const node = helper.renderConfirmModal("Удалить чат", "Подтвердите удаление", "Удалить", "Отмена", true, {
        onConfirm() {
          confirmed += 1;
        },
        onCancel() {
          cancelled += 1;
        },
      });
      assert.ok(node.className.includes("modal-confirm"));
      assert.ok(node.className.includes("modal-confirm-danger"));
      assert.equal(node.getAttribute("role"), "alertdialog");
      assert.equal(node.getAttribute("data-confirm-tone"), "danger");
      const keydown = node._listeners.get("keydown") || [];
      assert.equal(keydown.length, 1);
      keydown[0]({ key: "Escape", shiftKey: false, preventDefault() {} });
      keydown[0]({ key: "Enter", shiftKey: false, preventDefault() {} });
      assert.equal(cancelled, 1);
      assert.equal(confirmed, 1);
    });
  } finally {
    await helper.cleanup();
  }
});

test("confirm modal + context menu sheet: CSS has dedicated shell selectors", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.modal-confirm\b/);
  assert.match(css, /\.modal-actions\.modal-actions-confirm\b/);
  assert.match(css, /\.ctx-header\b/);
  assert.match(css, /\.ctx-close\b/);
});

test("confirm modal source: uses secondary cancel button", async () => {
  const src = await readFile(path.resolve("src/components/modals/renderConfirmModal.ts"), "utf8");
  assert.match(src, /btn btn-secondary/);
});
