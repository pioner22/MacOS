import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderInviteUserModal() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderInviteUserModal.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderInviteUserModal !== "function") {
      throw new Error("renderInviteUserModal export missing");
    }
    return { renderInviteUserModal: mod.renderInviteUserModal, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withDomStubs(fn) {
  const prev = {
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  };

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this._attrs = new Map();
      this._children = [];
      this._className = "";
    }
    get className() {
      return this._className;
    }
    set className(value) {
      this._className = String(value || "");
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
    addEventListener() {}
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
      this.type = "text";
      this.value = "";
    }
  }

  class HTMLTextAreaElementStub extends HTMLElementStub {
    constructor() {
      super("textarea");
      this.value = "";
    }
  }

  class DocumentStub {
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === "input") return new HTMLInputElementStub();
      if (t === "textarea") return new HTMLTextAreaElementStub();
      return new HTMLElementStub(t);
    }
    createTextNode(text) {
      return String(text || "");
    }
  }

  globalThis.HTMLElement = HTMLElementStub;
  globalThis.HTMLInputElement = HTMLInputElementStub;
  globalThis.HTMLTextAreaElement = HTMLTextAreaElementStub;
  globalThis.document = new DocumentStub();

  try {
    return fn();
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

function findAll(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") findAll(k, predicate, out);
  }
  return out;
}

test("renderInviteUserModal: показывает только чаты/доски владельца", async () => {
  const helper = await loadRenderInviteUserModal();
  try {
    withDomStubs(() => {
      const node = helper.renderInviteUserModal(
        "222-222-222",
        "111-111-111",
        [
          { id: "grp-1", name: "Мой чат", owner_id: "111-111-111", handle: "@mine" },
          { id: "grp-2", name: "Чужой чат", owner_id: "999-999-999", handle: "@other" },
        ],
        [
          { id: "b-1", name: "Моя доска", owner_id: "111-111-111", handle: "@bmine" },
          { id: "b-2", name: "Чужая доска", owner_id: "999-999-999", handle: "@bother" },
        ],
        undefined,
        { onInvite() {}, onCancel() {} }
      );

      const inputs = findAll(node, (n) => String(n.tagName || "") === "INPUT" && n.getAttribute && n.getAttribute("type") === "checkbox");
      const values = inputs.map((n) => n.getAttribute("value"));
      assert.deepEqual(values.sort(), ["b-1", "grp-1"].sort());
    });
  } finally {
    await helper.cleanup();
  }
});
