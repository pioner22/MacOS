import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadEl(entry) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entry)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.el !== "function") {
      throw new Error(`el export missing in ${entry}`);
    }
    return { el: mod.el, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
      this._attrs = new Map();
      this._children = [];
    }
    setAttribute(name, value) {
      const k = String(name);
      const v = String(value);
      this._attrs.set(k, v);
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

function attrsSnapshot(node) {
  return {
    autocomplete: node.getAttribute("autocomplete"),
    autocorrect: node.getAttribute("autocorrect"),
    autocapitalize: node.getAttribute("autocapitalize"),
    spellcheck: node.getAttribute("spellcheck"),
    inputmode: node.getAttribute("inputmode"),
    enterkeyhint: node.getAttribute("enterkeyhint"),
    type: node.getAttribute("type"),
  };
}

test("el(): выставляет iOS‑friendly дефолты для textarea и text‑input", async () => {
  const helper = await loadEl("src/helpers/dom/el.ts");
  try {
    withDomStubs(() => {
      const ta = helper.el("textarea", {});
      assert.deepEqual(attrsSnapshot(ta), {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        inputmode: "text",
        enterkeyhint: "done",
        type: null,
      });

      const inp = helper.el("input", {});
      assert.deepEqual(attrsSnapshot(inp), {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        inputmode: "text",
        enterkeyhint: "done",
        type: null,
      });

      const search = helper.el("input", { type: "search" });
      assert.equal(search.getAttribute("inputmode"), "search");
      assert.equal(search.getAttribute("enterkeyhint"), "search");

      const num = helper.el("input", { type: "number" });
      assert.equal(num.getAttribute("inputmode"), "numeric");

      const file = helper.el("input", { type: "file" });
      assert.equal(file.getAttribute("autocorrect"), null);

      const taOverride = helper.el("textarea", { enterkeyhint: "send" });
      assert.equal(taOverride.getAttribute("enterkeyhint"), "send");
    });
  } finally {
    await helper.cleanup();
  }
});
