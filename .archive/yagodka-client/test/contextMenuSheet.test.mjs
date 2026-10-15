import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderContextMenu() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderContextMenu.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderContextMenu !== "function") {
      throw new Error("renderContextMenu export missing");
    }
    return { renderContextMenu: mod.renderContextMenu, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withStubs(opts, run) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    queueMicrotask: globalThis.queueMicrotask,
  };

  class StyleStub {
    constructor() {
      this.left = "";
      this.top = "";
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
    remove(...names) {
      for (const n of names) {
        for (const part of String(n || "")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter(Boolean)) {
          this._owner._classSet.delete(part);
        }
      }
      this._syncTo();
    }
    toggle(name, force) {
      const n = String(name || "").trim();
      if (!n) return false;
      const shouldAdd = force === undefined ? !this._owner._classSet.has(n) : Boolean(force);
      if (shouldAdd) this._owner._classSet.add(n);
      else this._owner._classSet.delete(n);
      this._syncTo();
      return shouldAdd;
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
      this.style = new StyleStub();
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

  const coarse = Boolean(opts?.coarse);
  globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia(query) {
      const q = String(query || "");
      const matches = coarse && (q.includes("pointer: coarse") || q.includes("hover: none"));
      return { matches };
    },
  };

  // Нам не важно поведение focus/clamp внутри microtask, только режим рендера.
  globalThis.queueMicrotask = () => {};

  try {
    return run();
  } finally {
    if (prev.queueMicrotask === undefined) delete globalThis.queueMicrotask;
    else globalThis.queueMicrotask = prev.queueMicrotask;

    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;

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
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const child of kids) {
    const hit = findFirst(child, predicate);
    if (hit) return hit;
  }
  return null;
}

test("renderContextMenu: на coarse pointer рендерится как modern action sheet, не fullscreen dialog", async () => {
  const helper = await loadRenderContextMenu();
  try {
    withStubs({ coarse: true }, () => {
      const node = helper.renderContextMenu(
        { x: 10, y: 20, title: "Меню", target: { kind: "peer", id: "123-456-789" }, items: [{ id: "x", label: "Действие" }] },
        { onSelect() {}, onClose() {} }
      );
      assert.ok(node.className.includes("ctx-menu-sheet"));
      assert.equal(node.getAttribute("role"), "menu");
      assert.equal(node.getAttribute("aria-modal"), null);
      assert.equal(node.getAttribute("data-menu-layout"), "modern-sheet");
      assert.equal(node.style.left, "");
      assert.equal(node.style.top, "");
      const closeBtn = findFirst(node, (child) => typeof child.className === "string" && child.className.split(/\s+/).includes("ctx-close"));
      assert.ok(closeBtn, "compact sheet should expose an explicit close button");
      const icon = findFirst(node, (child) => typeof child.getAttribute === "function" && child.getAttribute("data-ctx-icon") === "dot");
      assert.ok(icon, "modern sheet should render a stable icon token even when the action has no emoji icon");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderContextMenu: сообщение на coarse pointer рендерится iOS-like action list, а не sheet", async () => {
  const helper = await loadRenderContextMenu();
  try {
    withStubs({ coarse: true }, () => {
      const node = helper.renderContextMenu(
        {
          x: 190,
          y: 420,
          title: "Меню",
          target: { kind: "message", id: "5" },
          reactionBar: { emojis: ["👍", "❤️"] },
          items: [
            { id: "msg_reply", label: "Ответить" },
            { id: "msg_copy", label: "Копировать" },
          ],
        },
        { onSelect() {}, onClose() {} }
      );
      assert.ok(node.className.includes("ctx-menu-message-compact"));
      assert.ok(node.className.includes("ctx-menu-message-action-list"));
      assert.ok(!node.className.includes("ctx-menu-sheet"));
      assert.equal(node.getAttribute("role"), "menu");
      assert.equal(node.getAttribute("aria-modal"), null);
      assert.equal(node.getAttribute("data-menu-layout"), "message-action-list");
      assert.equal(node.getAttribute("data-menu-density"), "ios-action");
      assert.equal(node.style.left, "190px");
      assert.equal(node.style.top, "420px");
      const closeBtn = findFirst(node, (child) => typeof child.className === "string" && child.className.split(/\s+/).includes("ctx-close"));
      assert.equal(closeBtn, null);
      const icon = findFirst(node, (child) => typeof child.getAttribute === "function" && child.getAttribute("data-ctx-icon") === "reply");
      assert.ok(icon, "compact message menu should render stable action icons");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderContextMenu: на fine pointer позиционируется по x/y", async () => {
  const helper = await loadRenderContextMenu();
  try {
    withStubs({ coarse: false }, () => {
      const node = helper.renderContextMenu(
        { x: 123, y: 456, title: "Меню", target: { kind: "peer", id: "123-456-789" }, items: [{ id: "x", label: "Действие" }] },
        { onSelect() {}, onClose() {} }
      );
      assert.ok(!node.className.includes("ctx-menu-sheet"));
      assert.equal(node.getAttribute("role"), "menu");
      assert.equal(node.getAttribute("data-menu-layout"), "popover");
      assert.equal(node.style.left, "123px");
      assert.equal(node.style.top, "456px");
      const closeBtn = findFirst(node, (child) => typeof child.className === "string" && child.className.split(/\s+/).includes("ctx-close"));
      assert.equal(closeBtn, null);
    });
  } finally {
    await helper.cleanup();
  }
});

test("context menu/pin remediation source guards: modern sheet, compact message menu, and direct pin toggle", async () => {
  const [modalCss, responsiveCss, skinCss, actionsSrc, renderSrc, appSrc, overlaySrc, historySrc] = await Promise.all([
    readFile(path.resolve("src/scss/modal.part01.css"), "utf8"),
    readFile(path.resolve("src/scss/responsive.css"), "utf8"),
    readFile(path.resolve("public/skins/yagodka-modern.css"), "utf8"),
    readFile(path.resolve("src/app/features/contextMenu/contextMenuActionsFeature.ts"), "utf8"),
    readFile(path.resolve("src/components/modals/renderContextMenu.ts"), "utf8"),
    readFile(path.resolve("src/app/renderApp.ts"), "utf8"),
    readFile(path.resolve("src/app/features/navigation/modalSurface.ts"), "utf8"),
    readFile(path.resolve("src/components/chat/historyRenderSurface.ts"), "utf8"),
  ]);

  assert.match(modalCss, /\.ctx-menu\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-sheet\s*\{[\s\S]*width:\s*min\(320px,\s*calc\(100vw - 28px\)\)/);
  assert.match(modalCss, /\.ctx-menu\s*\{[\s\S]*outline:\s*0;/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s*\{[\s\S]*width:\s*min\(276px,\s*calc\(100vw - 24px\)\)/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s*\{[\s\S]*background:\s*transparent;/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-list\s*\{[\s\S]*width:\s*min\(var\(--ctx-action-list-w,\s*276px\),\s*calc\(100vw - 32px\)\)/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-reacts\s*\{[\s\S]*border-radius:\s*999px;/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-reacts\s*\{[\s\S]*width:\s*min\(var\(--ctx-react-pill-w,\s*276px\),\s*calc\(100vw - 24px\)\)/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-react\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-item\s*\{[\s\S]*min-height:\s*40px;/);
  assert.match(modalCss, /\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-item\s*\{[\s\S]*font-size:\s*16px;/);
  assert.match(modalCss, /--ctx-menu-message-glass-bg:\s*rgba\(18,\s*18,\s*24,\s*0\.84\)/);
  assert.match(modalCss, /\.overlay\.overlay-context\.overlay-context-message\s*\{[\s\S]*backdrop-filter:\s*none;/);
  assert.match(modalCss, /\.ctx-close\s*\{[\s\S]*display:\s*grid;[\s\S]*place-items:\s*center;/);
  assert.match(modalCss, /\.ctx-close::before\s*\{[\s\S]*display:\s*block;/);
  assert.match(modalCss, /--ctx-sheet-bottom-offset/);
  assert.match(modalCss, /\.ctx-icon::before\s*\{[\s\S]*mask:\s*var\(--ctx-icon-mask,\s*var\(--ctx-icon-dot\)\)/);
  assert.match(modalCss, /--ctx-list-max-h/);
  assert.match(responsiveCss, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(responsiveCss, /\.app-frame\.has-message-context-menu\s+\.chat-lines\s+\[data-msg-idx\]\.msg-context-active\s*\{[\s\S]*filter:\s*none !important;/);
  assert.match(skinCss, /html\[data-skin="yagodka-modern"\]\s+\.ctx-menu\.ctx-menu-sheet\s*\{[\s\S]*max-height:\s*var\(--ctx-sheet-max-h,\s*min\(48dvh,\s*360px\)\)/);
  assert.match(skinCss, /html\[data-skin="yagodka-modern"\]\s+\.ctx-menu\.ctx-menu-message-action-list\s*\{[\s\S]*width:\s*min\(276px,\s*calc\(100vw - 24px\)\)/);
  assert.match(skinCss, /html\[data-skin="yagodka-modern"\]\s+\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-list\s*\{[\s\S]*border-radius:\s*19px;/);
  assert.match(skinCss, /html\[data-skin="yagodka-modern"\]\s+\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-react\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
  assert.match(renderSrc, /composerAvoidRect/);
  assert.match(renderSrc, /applyPopoverGeometry/);
  assert.match(renderSrc, /applySheetGeometry/);
  assert.match(renderSrc, /Math\.min\(360,\s*viewportH/);
  assert.match(renderSrc, /applyCompactMessageGeometry/);
  assert.match(renderSrc, /findMessageAnchorRect/);
  assert.match(renderSrc, /data-ctx-icon/);
  assert.match(renderSrc, /ctx-react-more/);
  assert.match(renderSrc, /data-menu-layout":\s*compactMessage\s*\?\s*"message-action-list"\s*:\s*sheet\s*\?\s*"modern-sheet"/);
  assert.match(renderSrc, /data-menu-density":\s*compactMessage\s*\?\s*"ios-action"/);
  assert.match(renderSrc, /ctx-close/);
  assert.match(appSrc, /has-message-context-menu/);
  assert.match(overlaySrc, /overlay-context-message/);
  assert.match(historySrc, /msg-context-active/);

  const pinBlock = actionsSrc.slice(actionsSrc.indexOf('itemId === "msg_pin_toggle"'), actionsSrc.indexOf('itemId === "msg_reply"'));
  assert.match(pinBlock, /togglePinnedMessage/);
  assert.doesNotMatch(pinBlock, /openConfirmModal/);
});
