import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

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
      if (typeof mod[name] !== "function") {
        throw new Error(`${name} export missing`);
      }
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
    hasAttribute(name) {
      return this._attrs.has(String(name));
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

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const child of kids) findAll(child, predicate, out);
  return out;
}

function textContent(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node.textContent === "string") return node.textContent;
  const kids = Array.isArray(node._children) ? node._children : [];
  return kids.map((child) => textContent(child)).join("");
}

test("historySeparatorShell: renders explicit date/unread separator structure", async () => {
  const helper = await bundleEntry("src/components/chat/historySeparatorShell.ts", ["renderDateSeparator", "renderUnreadSeparator"]);
  try {
    withDomStubs(() => {
      const unread = helper.mod.renderUnreadSeparator(5);
      assert.equal(unread.getAttribute("data-sep-kind"), "unread");
      assert.equal(unread.getAttribute("role"), "separator");
      const unreadLines = findAll(unread, (node) => typeof node.className === "string" && node.className.includes("msg-sep-line"));
      assert.equal(unreadLines.length, 2);
      const count = findAll(unread, (node) => typeof node.className === "string" && node.className.includes("msg-sep-count"))[0];
      assert.ok(count);
      assert.equal(textContent(count), "5");

      const date = helper.mod.renderDateSeparator(1_709_203_200);
      assert.equal(date.getAttribute("data-sep-kind"), "date");
      assert.equal(date.getAttribute("aria-hidden"), "true");
      const pill = findAll(date, (node) => typeof node.className === "string" && node.className.includes("msg-sep-pill"))[0];
      assert.ok(pill);
      assert.ok(textContent(pill).trim().length > 0);
    });
  } finally {
    await helper.cleanup();
  }
});

test("buildMessageMeta: compact meta items keep stable time/edited/status order", async () => {
  const helper = await bundleEntry("src/components/chat/renderChatHelpers.ts", ["buildMessageMeta"]);
  try {
    withDomStubs(() => {
      const items = helper.mod.buildMessageMeta({
        kind: "out",
        id: 10,
        from: "111-111-111",
        ts: 1_709_203_200,
        text: "Привет",
        edited: true,
        edited_ts: 1_709_203_500,
        status: "read",
      });
      assert.equal(items.length, 3);
      assert.ok(items.every((node) => typeof node.className === "string" && node.className.includes("msg-meta-item")));
      assert.ok(items[0].className.includes("msg-time"));
      assert.ok(items[1].className.includes("msg-edited"));
      assert.equal(textContent(items[1]), "ред.");
      assert.ok(items[2].className.includes("msg-status-read"));
    });
  } finally {
    await helper.cleanup();
  }
});

test("messageContentShell: wraps text and meta into one explicit bubble content zone", async () => {
  const helper = await bundleEntry("src/components/chat/messageContentShell.ts", ["renderMessageContentShell"]);
  try {
    withDomStubs(() => {
      const text = globalThis.document.createElement("div");
      text.className = "msg-text";
      text.append("Привет");
      const meta = globalThis.document.createElement("div");
      meta.className = "msg-meta";
      meta.append("13:37");
      const shell = helper.mod.renderMessageContentShell(text, meta);
      assert.equal(shell.className, "msg-content-shell");
      const children = Array.isArray(shell._children) ? shell._children : [];
      assert.equal(children.length, 2);
      assert.equal(children[0].className, "msg-text");
      assert.equal(children[1].className, "msg-meta");
    });
  } finally {
    await helper.cleanup();
  }
});

test("history shell polish: source and CSS guards present", async () => {
  const css = await readCssWithImports("src/scss/components.css");
  assert.match(css, /\.msg-sep-line\b/);
  assert.match(css, /\.msg-sep-pill\b/);
  assert.match(css, /\.msg-sep-count\b/);
  assert.match(css, /\.msg-meta-item \+ \.msg-meta-item::before\b/);
  assert.match(css, /\.msg-content-shell\b/);
  assert.match(css, /--msg-telegram-tail-size:\s*11px/);
  assert.match(css, /--msg-modern-time-chip-bg:\s*transparent/);
  assert.match(css, /--msg-modern-time-chip-border:\s*transparent/);
  assert.match(css, /--msg-modern-bubble-gloss:\s*none/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-content-shell\s*\{[\s\S]*display:\s*grid;/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-content-shell\s+\.msg-meta\s*\{[\s\S]*background:\s*transparent;[\s\S]*border:\s*0;/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg:not\(\[data-msg-attach\]\):not\(\[data-msg-has-ref\]\):not\(\[data-msg-has-reacts\]\):not\(\[data-msg-emoji-only\]\)\s+\.msg-text\s*\{[\s\S]*padding-right:\s*var\(--msg-meta-inline-pad\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg:not\(\[data-msg-attach\]\):not\(\[data-msg-has-ref\]\):not\(\[data-msg-has-reacts\]\):not\(\[data-msg-emoji-only\]\)\s+\.msg-content-shell\s+\.msg-meta\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*6px;[\s\S]*bottom:\s*4px;/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-tail:not\(\.msg-attach\)\s+\.msg-body::after\s*\{[\s\S]*width:\s*var\(--msg-telegram-tail-size\);[\s\S]*-webkit-mask:\s*var\(--msg-telegram-tail-mask\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-ref-quote\s*\{[\s\S]*border-inline-start:\s*3px solid var\(--msg-ref-accent\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-ref-forward\s*\{[\s\S]*border-inline-start:\s*3px solid var\(--msg-ref-accent\)/);

  const historyRenderSurfaceSrc = await readFile(path.resolve("src/components/chat/historyRenderSurface.ts"), "utf8");
  assert.match(historyRenderSurfaceSrc, /renderDateSeparator/);
  assert.match(historyRenderSurfaceSrc, /renderUnreadSeparator/);

  const helperSrc = await readFile(path.resolve("src/components/chat/renderChatHelpers.ts"), "utf8");
  assert.match(helperSrc, /msg-meta-item msg-time/);
  assert.match(helperSrc, /\["ред\."\]/);
  assert.match(helperSrc, /renderMessageContentShell/);
});
