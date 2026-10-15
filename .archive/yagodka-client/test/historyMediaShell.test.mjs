import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";
import { flushDeferredChatMedia } from "./helpers/flushDeferredChatMedia.mjs";

async function loadRenderChat() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const entryFile = path.join(tempDir, "renderChat.js");
  try {
    await build({
      entryPoints: [path.resolve("src/components/chat/renderChat.ts")],
      outdir: tempDir,
      bundle: true,
      splitting: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      entryNames: "[name]",
      chunkNames: "chunks/[name]-[hash]",
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(entryFile).href);
    if (typeof mod.renderChat !== "function") throw new Error("renderChat export missing");
    return { renderChat: mod.renderChat, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
      this._className = "";
      this._classSet = new Set();
      this.classList = new ClassListStub(this);
      this.style = new StyleStub();
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.clientHeight = 0;
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
    replaceChildren(...nodes) {
      this._children = [...nodes];
    }
    prepend(...nodes) {
      this._children = [...nodes, ...this._children];
    }
    addEventListener() {}
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
  } finally {
    // sync cleanup handled above; async cleanup is attached to the returned promise
  }
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

function findAll(node, predicate, acc = []) {
  if (!node) return acc;
  if (predicate(node)) acc.push(node);
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") findAll(k, predicate, acc);
  }
  return acc;
}

function hasClass(node, name) {
  return node && typeof node.className === "string" && node.className.split(/\s+/).includes(name);
}

function createLayout() {
  const chat = document.createElement("div");
  const chatTop = document.createElement("div");
  const chatSearchResults = document.createElement("div");
  const chatSearchFooter = document.createElement("div");
  const chatHost = document.createElement("div");
  const chatJump = document.createElement("button");
  const chatSelectionBar = document.createElement("div");
  chat.className = "chat";
  chatTop.className = "chat-top";
  chatSearchResults.className = "chat-search-results";
  chatSearchFooter.className = "chat-search-footer";
  chatHost.className = "chat-host";
  chatJump.className = "btn chat-jump hidden";
  chatSelectionBar.className = "chat-selection-bar hidden";
  chatHost.clientHeight = 140;
  chatHost.scrollHeight = 2400;
  return { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
}

function createState(messages, extra = {}) {
  return {
    selected: { kind: "dm", id: "123-456-789" },
    conversations: { "dm:123-456-789": messages },
    historyHasMore: {},
    historyLoading: {},
    chatSearchOpen: false,
    chatSearchQuery: "",
    chatSearchHits: [],
    chatSearchPos: 0,
    pinnedMessages: {},
    pinnedMessageActive: {},
    fileTransfers: [],
    fileOffersIn: [],
    groups: [],
    boards: [],
    profiles: {},
    ...extra,
  };
}

test("history media shell: image caption goes into stacked attachment footer", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      const layout = createLayout();
      const state = createState([
        {
          kind: "in",
          from: "123-456-789",
          to: "854-432-319",
          room: null,
          text: "Подпись к фото",
          ts: 1700000000,
          id: 1,
          attachment: { kind: "file", name: "photo.png", size: 123, mime: "image/png", fileId: "42" },
        },
      ]);

      helper.renderChat(layout, state);

      const line = findFirst(layout.chatHost, (n) => hasClass(n, "msg-attach"));
      assert.ok(line);
      assert.equal(line.getAttribute("data-msg-footer"), "stacked");
      const footer = findFirst(line, (n) => hasClass(n, "msg-attach-footer"));
      assert.ok(footer, "должен быть явный footer shell");
      assert.ok(hasClass(footer, "msg-attach-footer-caption"));
      assert.ok(findFirst(footer, (n) => hasClass(n, "msg-caption")), "caption должна жить внутри footer");
      assert.ok(findFirst(footer, (n) => hasClass(n, "msg-meta")), "meta должна жить внутри footer");
    });
  } finally {
    await helper.cleanup();
  }
});

test("history media shell: image without caption keeps overlay meta shell", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      const layout = createLayout();
      const state = createState([
        {
          kind: "in",
          from: "123-456-789",
          to: "854-432-319",
          room: null,
          text: "",
          ts: 1700000000,
          id: 1,
          attachment: { kind: "file", name: "photo.png", size: 123, mime: "image/png", fileId: "42" },
        },
      ]);

      helper.renderChat(layout, state);

      const line = findFirst(layout.chatHost, (n) => hasClass(n, "msg-attach"));
      assert.ok(line);
      assert.equal(line.getAttribute("data-msg-footer"), "overlay");
      assert.equal(findFirst(line, (n) => hasClass(n, "msg-attach-footer")), null, "footer shell не нужен для overlay media");
      assert.ok(findFirst(line, (n) => hasClass(n, "msg-meta")), "overlay meta должен остаться");
    });
  } finally {
    await helper.cleanup();
  }
});

test("history media shell: audio attachment gets meta-only footer shell", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
      const layout = createLayout();
      const state = createState(
        [
          {
            kind: "in",
            from: "123-456-789",
            to: "854-432-319",
            room: null,
            text: "",
            ts: 1700000000,
            id: 1,
            attachment: { kind: "file", name: "note.ogg", size: 321, mime: "audio/ogg", fileId: "77" },
          },
        ],
        {
          fileTransfers: [
            {
              localId: "ft-77",
              id: "77",
              name: "note.ogg",
              size: 321,
              mime: "audio/ogg",
              direction: "in",
              peer: "123-456-789",
              room: null,
              status: "complete",
              progress: 100,
              url: "blob:audio",
            },
          ],
        }
      );

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const line = findFirst(layout.chatHost, (n) => hasClass(n, "msg-attach"));
      assert.ok(line);
      assert.equal(line.getAttribute("data-msg-footer"), "stacked");
      const footer = findFirst(line, (n) => hasClass(n, "msg-attach-footer"));
      assert.ok(footer);
      assert.ok(hasClass(footer, "msg-attach-footer-meta-only"));
      assert.ok(findFirst(line, (n) => hasClass(n, "file-row-audio")), "audio row должен сохраниться");
      assert.ok(findFirst(footer, (n) => hasClass(n, "msg-meta")), "meta должна жить внутри footer shell");
    });
  } finally {
    await helper.cleanup();
  }
});

test("history media shell: album line uses stacked footer shell even without caption", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
      const layout = createLayout();
      const state = createState([
        {
          kind: "in",
          from: "123-456-789",
          to: "854-432-319",
          room: null,
          text: "",
          ts: 1700000000,
          id: 1,
          attachment: { kind: "file", name: "01.jpg", size: 111, mime: "image/jpeg", fileId: "501" },
        },
        {
          kind: "in",
          from: "123-456-789",
          to: "854-432-319",
          room: null,
          text: "",
          ts: 1700000001,
          id: 2,
          attachment: { kind: "file", name: "02.jpg", size: 112, mime: "image/jpeg", fileId: "502" },
        },
      ]);

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const albumLine = findFirst(layout.chatHost, (n) => hasClass(n, "msg-album"));
      assert.ok(albumLine, "должен собраться album line");
      assert.equal(albumLine.getAttribute("data-msg-footer"), "stacked");
      assert.equal(albumLine.getAttribute("data-msg-album-layout"), "mosaic");
      assert.equal(albumLine.style._props.get("--chat-album-shell-width"), "420px");
      assert.match(albumLine.style._props.get("--chat-album-shell-ratio") || "", /^420 \/ \d+$/);
      const surface = findFirst(albumLine, (n) => hasClass(n, "chat-album-surface"));
      assert.ok(surface, "album должен собираться через единый surface");
      const footer = findFirst(albumLine, (n) => hasClass(n, "msg-attach-footer"));
      assert.ok(footer, "album должен иметь явный footer shell");
      assert.ok(findFirst(albumLine, (n) => hasClass(n, "chat-album-grid")), "album grid должен сохраниться");
      assert.ok(findFirst(footer, (n) => hasClass(n, "msg-meta")), "album meta должна быть внутри footer");
      const albumItems = findAll(albumLine, (n) => hasClass(n, "chat-album-item"));
      assert.equal(albumItems.length, 2);
      assert.equal(albumItems[0].getAttribute("data-album-edge-top"), "1");
      assert.equal(albumItems[0].getAttribute("data-album-edge-left"), "1");
      assert.equal(albumItems[0].getAttribute("data-album-edge-bottom"), "1");
      assert.equal(albumItems[1].getAttribute("data-album-edge-top"), "1");
      assert.equal(albumItems[1].getAttribute("data-album-edge-right"), "1");
      assert.equal(albumItems[1].getAttribute("data-album-edge-bottom"), "1");
    });
  } finally {
    await helper.cleanup();
  }
});

test("history media shell: deferred album reserves final mosaic geometry before lazy surface loads", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
      const layout = createLayout();
      const state = createState([
        {
          kind: "in",
          from: "123-456-789",
          to: "854-432-319",
          room: null,
          text: "",
          ts: 1700000000,
          id: 1,
          attachment: { kind: "file", name: "01.jpg", size: 111, mime: "image/jpeg", fileId: "501" },
        },
        {
          kind: "in",
          from: "123-456-789",
          to: "854-432-319",
          room: null,
          text: "",
          ts: 1700000001,
          id: 2,
          attachment: { kind: "file", name: "02.mp4", size: 112, mime: "video/mp4", fileId: "502" },
        },
      ]);

      helper.renderChat(layout, state);

      const albumLine = findFirst(layout.chatHost, (n) => hasClass(n, "msg-album-loading"));
      assert.ok(albumLine, "до lazy import должен быть стабильный loading album line");
      assert.equal(albumLine.getAttribute("data-msg-album"), "1");
      assert.equal(albumLine.getAttribute("data-msg-footer"), "stacked");
      assert.equal(albumLine.getAttribute("data-msg-album-layout"), "mosaic");
      assert.equal(albumLine.style._props.get("--chat-album-shell-width"), "420px");
      assert.match(albumLine.style._props.get("--chat-album-shell-ratio") || "", /^420 \/ \d+$/);
      const grid = findFirst(albumLine, (n) => hasClass(n, "chat-album-grid-loading"));
      assert.ok(grid, "loading surface должен сразу резервировать album grid");
      assert.equal(grid.style.width, "420px");
      assert.ok(grid.style.height, "album grid должен иметь inline height до загрузки финального surface");
      assert.equal(findAll(albumLine, (n) => hasClass(n, "chat-album-placeholder-item")).length, 2);
      assert.ok(findFirst(albumLine, (n) => hasClass(n, "msg-from-placeholder")), "loading album должен резервировать строку автора");
      assert.ok(findFirst(albumLine, (n) => hasClass(n, "chat-album-footer-loading")), "loading album должен резервировать footer/meta");
      await flushDeferredChatMedia();
    });
  } finally {
    await helper.cleanup();
  }
});

test("history media shell: image selection + action controls use unified overlay shell", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      const layout = createLayout();
      const state = createState(
        [
          {
            kind: "in",
            from: "123-456-789",
            to: "854-432-319",
            room: null,
            text: "",
            ts: 1700000000,
            id: 1,
            attachment: { kind: "file", name: "photo.png", size: 123, mime: "image/png", fileId: "42" },
          },
        ],
        {
          chatSelection: {
            key: "dm:123-456-789",
            ids: ["id:1"],
          },
        }
      );

      helper.renderChat(layout, state);

      const fileRow = findFirst(layout.chatHost, (n) => hasClass(n, "file-row-image"));
      assert.ok(fileRow);
      const overlay = findFirst(fileRow, (n) => hasClass(n, "chat-media-overlay-controls"));
      assert.ok(overlay, "visual media must render a unified overlay controls shell");
      assert.ok(findFirst(overlay, (n) => hasClass(n, "chat-media-overlay-start")));
      assert.ok(findFirst(overlay, (n) => hasClass(n, "chat-media-overlay-end")));
      const select = findFirst(overlay, (n) => hasClass(n, "msg-select"));
      assert.ok(select);
      assert.equal(select.getAttribute("aria-pressed"), "true");
      assert.ok(findFirst(overlay, (n) => hasClass(n, "file-actions")), "overlay shell should also host file actions");
    });
  } finally {
    await helper.cleanup();
  }
});

test("history media shell: album partial selection uses unified overlay shell", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
      const layout = createLayout();
      const state = createState(
        [
          {
            kind: "in",
            from: "123-456-789",
            to: "854-432-319",
            room: null,
            text: "",
            ts: 1700000000,
            id: 1,
            attachment: { kind: "file", name: "01.jpg", size: 111, mime: "image/jpeg", fileId: "501" },
          },
          {
            kind: "in",
            from: "123-456-789",
            to: "854-432-319",
            room: null,
            text: "",
            ts: 1700000001,
            id: 2,
            attachment: { kind: "file", name: "02.jpg", size: 112, mime: "image/jpeg", fileId: "502" },
          },
        ],
        {
          chatSelection: {
            key: "dm:123-456-789",
            ids: ["id:1"],
          },
        }
      );

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const albumLine = findFirst(layout.chatHost, (n) => hasClass(n, "msg-album"));
      assert.ok(albumLine);
      const grid = findFirst(albumLine, (n) => hasClass(n, "chat-album-grid"));
      assert.ok(grid);
      const overlay = findFirst(grid, (n) => hasClass(n, "chat-media-overlay-controls"));
      assert.ok(overlay, "album grid must host overlay controls shell");
      const select = findFirst(overlay, (n) => hasClass(n, "msg-select"));
      assert.ok(select);
      assert.ok(hasClass(select, "msg-select-partial"));
      assert.equal(select.getAttribute("data-msg-group-start"), "0");
      assert.equal(select.getAttribute("data-msg-group-end"), "1");
    });
  } finally {
    await helper.cleanup();
  }
});

test("history media shell polish: source and CSS guards present", async () => {
  const css = await readCssWithImports("src/scss/components.css");
  const mediaOverridesCss = await readFile(path.resolve("src/scss/messenger_media_overrides.css"), "utf8");
  assert.match(css, /\.msg-attach-footer\b/);
  assert.match(css, /data-msg-footer="overlay"/);
  assert.match(css, /data-msg-footer="stacked"/);
  assert.match(css, /\.chat-media-overlay-controls\b/);
  assert.match(css, /\.chat-media-overlay-start\b/);
  assert.match(css, /\.chat-media-overlay-end\b/);
  assert.match(css, /\.chat-album-surface\b/);
  assert.match(css, /data-msg-album-layout="mosaic"/);
  assert.match(css, /data-album-edge-top="1"/);
  assert.match(mediaOverridesCss, /W-0984: frameless photo\/video history media/);
  assert.match(mediaOverridesCss, /W-0985: stable frameless history media surfaces/);
  assert.match(mediaOverridesCss, /\.msg-attach\[data-msg-file="image"\]\s+\.chat-file-preview:not\(\.chat-file-preview-empty\)[\s\S]*border:\s*0;[\s\S]*box-shadow:\s*none;[\s\S]*background:\s*transparent;/);
  assert.match(mediaOverridesCss, /\.msg-attach\[data-msg-footer="overlay"\]\s+\.msg-meta\s*\{[\s\S]*border:\s*0;[\s\S]*box-shadow:\s*none;[\s\S]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.34\);/);
  assert.match(mediaOverridesCss, /\.msg-attach\[data-msg-album="1"\]\s+\.msg-attach-footer-media\.msg-attach-footer-meta-only\s*\{[\s\S]*position:\s*absolute;[\s\S]*background:\s*transparent;/);
  assert.match(mediaOverridesCss, /\.msg-attach\[data-msg-file="image"\]\s+\.msg-body,[\s\S]*?\.msg-attach\[data-msg-file="video"\]\s+\.msg-body,[\s\S]*?\.msg-attach\.msg-album\[data-msg-album="1"\]\s+\.msg-body[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(mediaOverridesCss, /\.msg-attach\s+\.msg-attach-footer-media\.msg-attach-footer-caption\s+\.msg-meta\s*\{[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);

  const helperSrc = await readFile(path.resolve("src/components/chat/renderChatHelpers.ts"), "utf8");
  assert.match(helperSrc, /renderAttachmentFooterShell/);
  assert.match(helperSrc, /footerKind = "stacked"/);
  assert.match(helperSrc, /footerKind = "overlay"/);
  assert.match(helperSrc, /renderMediaOverlayControls/);
  assert.match(helperSrc, /renderMessageSelectionControl/);
  assert.doesNotMatch(helperSrc, /resolvePreviewBaseWidthPx\(info\)/);
  assert.doesNotMatch(helperSrc, /style\.maxWidth\s*=\s*`\$\{scaled\}px`/);

  const deferredSurfaceSrc = await readFile(path.resolve("src/components/chat/chatDeferredMediaSurface.ts"), "utf8");
  assert.match(deferredSurfaceSrc, /data-msg-album-layout/);
  assert.match(deferredSurfaceSrc, /data-album-edge-top/);
  assert.match(deferredSurfaceSrc, /--chat-album-shell-width/);
  assert.match(deferredSurfaceSrc, /--chat-album-shell-ratio/);

  const deferredRuntimeSrc = await readFile(path.resolve("src/components/chat/chatDeferredMediaRuntime.ts"), "utf8");
  assert.match(deferredRuntimeSrc, /layoutTelegramAlbum/);
  assert.match(deferredRuntimeSrc, /chat-album-grid-loading/);
  assert.match(deferredRuntimeSrc, /chat-album-footer-loading/);
  assert.match(deferredRuntimeSrc, /--chat-album-shell-ratio/);
  assert.match(deferredRuntimeSrc, /msg-from-placeholder/);

  const shellSrc = await readFile(path.resolve("src/components/chat/attachmentFooterShell.ts"), "utf8");
  assert.match(shellSrc, /msg-attach-footer/);
  assert.match(shellSrc, /msg-attach-footer-meta-only/);

  const overlaySrc = await readFile(path.resolve("src/components/chat/mediaOverlayControls.ts"), "utf8");
  assert.match(overlaySrc, /chat-media-overlay-controls/);
  assert.match(overlaySrc, /chat-media-overlay-start/);

  const selectionSrc = await readFile(path.resolve("src/components/chat/messageSelectionControl.ts"), "utf8");
  assert.match(selectionSrc, /msg-select/);
  assert.match(selectionSrc, /data-msg-group-start/);
});
