import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { flushDeferredChatMedia } from "./helpers/flushDeferredChatMedia.mjs";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

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
    if (typeof mod.renderChat !== "function") {
      throw new Error("renderChat export missing");
    }
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
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
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

function findAll(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") findAll(k, predicate, out);
  }
  return out;
}

function hasClass(node, name) {
  return node && typeof node.className === "string" && node.className.split(/\s+/).includes(name);
}

function textOf(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.textContent === "string") return node.textContent;
  const kids = Array.isArray(node._children) ? node._children : [];
  return kids.map((child) => textOf(child)).join("");
}

test("renderChat: active conversation suppresses unread divider", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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

      const peer = "222-222-222";
      const key = `dm:${peer}`;
      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        page: "main",
        modal: null,
        selected: { kind: "dm", id: peer },
        selfId: "111-111-111",
        conversations: {
          [key]: [
            { kind: "out", from: "111-111-111", to: peer, text: "old", ts: 100, id: 1 },
            { kind: "in", from: peer, to: "111-111-111", text: "new", ts: 110, id: 2 },
          ],
        },
        historySync: { [key]: { loaded: true, loading: false, hasMore: false, cursor: 0 } },
        historyLoaded: { [key]: true },
        historyCursor: {},
        historyHasMore: {},
        friends: [{ id: peer, unread: 1 }],
        lastRead: { [key]: { id: 1 } },
        fileTransfers: [],
        fileOffersIn: [],
        fileThumbs: {},
        groups: [],
        boards: [],
        profiles: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
      };

      helper.renderChat(layout, state);

      const unread = findFirst(chatHost, (node) => hasClass(node, "msg-unread"));
      assert.equal(unread, null);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: file-attachment рендерит preview первым, иконку и action-кнопку", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
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
        },
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
      };

      helper.renderChat(layout, state);

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.ok(Array.isArray(fileRow._children) && fileRow._children.length >= 1);
      assert.ok(hasClass(fileRow._children[0], "chat-file-preview"), "превью должно быть первым элементом в file-row");

      const icon = findFirst(fileRow, (n) => hasClass(n, "file-icon"));
      assert.ok(icon, "должна быть file-icon");
      assert.ok(icon.style?._props?.has("--file-h"), "file-icon должна выставлять --file-h");

      const download = findFirst(fileRow, (n) => hasClass(n, "file-action-download"));
      assert.ok(download, "должна быть кнопка file-action-download");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: PDF file-attachment рендерит open/download actions и PDF chips", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            {
              kind: "in",
              from: "123-456-789",
              to: "854-432-319",
              room: null,
              text: "",
              ts: 1700000000,
              id: 1,
              attachment: { kind: "file", name: "report.pdf", size: 2048, mime: "application/pdf", fileId: "pdf-42" },
            },
          ],
        },
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
      };

      helper.renderChat(layout, state);

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.ok(hasClass(fileRow, "file-row-pdf"), "PDF row должен получить file-row-pdf");
      assert.ok(hasClass(fileRow, "file-row-openable"), "PDF row должен быть openable");

      const pdfChip = findFirst(fileRow, (n) => hasClass(n, "file-chip-pdf"));
      assert.ok(pdfChip, "должен быть PDF chip");

      const open = findFirst(fileRow, (n) => n?.getAttribute?.("data-action") === "open-file-viewer");
      assert.ok(open, "должна быть кнопка открытия PDF");
      assert.equal(open.getAttribute("data-file-kind"), "pdf");
      assert.equal(open.getAttribute("data-file-id"), "pdf-42");

      const download = findFirst(fileRow, (n) => n?.getAttribute?.("data-action") === "file-download");
      assert.ok(download, "должна быть кнопка скачивания PDF");
      assert.equal(download.getAttribute("data-file-id"), "pdf-42");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: desktop media preview keeps geometry in CSS instead of inline max-width", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
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
        },
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
        fileThumbs: {
          "42": { url: "blob:thumb", mime: "image/jpeg", ts: 1, w: 300, h: 200 },
        },
        groups: [],
        boards: [],
      };

      helper.renderChat(layout, state);

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.equal(fileRow.style.maxWidth, undefined);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: avatarsRev инвалидирует рендер (аватар в шапке обновляется без перезагрузки)", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      const prevLocalStorage = globalThis.localStorage;
      const store = new Map();
      globalThis.localStorage = {
        getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => void store.set(String(k), String(v)),
        removeItem: (k) => void store.delete(String(k)),
      };

      try {
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
        chatHost.clientHeight = 120;
        chatHost.scrollHeight = 2000;

        const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
        const state = {
          page: "main",
          selected: { kind: "dm", id: "123-456-789" },
          conversations: {
            "dm:123-456-789": [{ kind: "in", from: "123-456-789", to: "854-432-319", room: null, text: "привет", ts: 1700000000, id: 1 }],
          },
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
          avatarsRev: 0,
        };

        helper.renderChat(layout, state);

        const avatar1 = findFirst(chatTop, (n) => hasClass(n, "avatar"));
        assert.ok(avatar1, "avatar node not found");
        assert.ok(!hasClass(avatar1, "avatar-img"), "avatar should start without avatar-img");

        store.set("yagodka_avatar:dm:123-456-789", "data:image/png;base64,AAAA");
        state.avatarsRev += 1;

        helper.renderChat(layout, state);

        const avatar2 = findFirst(chatTop, (n) => hasClass(n, "avatar"));
        assert.ok(avatar2, "avatar node not found after rerender");
        assert.ok(hasClass(avatar2, "avatar-img"), "avatar should become avatar-img after avatarsRev");
      } finally {
        if (prevLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = prevLocalStorage;
      }
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: sys action message рендерит кнопки действий", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "111-111-111" },
        conversations: {
          "dm:111-111-111": [
            {
              kind: "sys",
              from: "111-111-111",
              text: "Приглашение в чат: Чат",
              ts: 1700000000,
              id: null,
              localId: "action:group_invite:grp-0001:111-111-111",
              attachment: { kind: "action", payload: { kind: "group_invite", groupId: "grp-0001", from: "111-111-111", name: "Чат" } },
            },
          ],
        },
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
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const accept = findFirst(chatHost, (n) => n?.getAttribute?.("data-action") === "group-invite-accept");
      const decline = findFirst(chatHost, (n) => n?.getAttribute?.("data-action") === "group-invite-decline");
      const inviteCard = findFirst(chatHost, (n) => hasClass(n, "invite-card"));
      assert.ok(inviteCard, "должна быть deferred invite-card surface");
      assert.ok(accept, "должна быть кнопка group-invite-accept");
      assert.ok(decline, "должна быть кнопка group-invite-decline");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: video file-attachment рендерит video preview button", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            {
              kind: "in",
              from: "123-456-789",
              to: "854-432-319",
              room: null,
              text: "",
              ts: 1700000000,
              id: 1,
              attachment: { kind: "file", name: "clip.mp4", size: 456, mime: "video/mp4", fileId: "99" },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileTransfers: [
          {
            localId: "ft-99",
            id: "99",
            name: "clip.mp4",
            size: 456,
            mime: "video/mp4",
            direction: "in",
            peer: "123-456-789",
            room: null,
            status: "complete",
            progress: 100,
            url: "blob:video",
          },
        ],
        fileOffersIn: [],
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.ok(hasClass(fileRow, "file-row-video"), "file-row должен быть помечен как video");

      const preview = findFirst(fileRow, (n) => hasClass(n, "chat-file-preview-video"));
      assert.ok(preview, "должен быть video preview");
      assert.equal(preview.getAttribute("data-action"), "open-file-viewer");

      const video = findFirst(preview, (n) => n && n.tagName === "VIDEO");
      assert.ok(video, "в preview должен быть <video>");
      assert.ok(hasClass(video, "chat-file-video"));
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: исходящий video-note upload сохраняет один stable preview и один progress", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const localId = "ft-video-note-1";
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            {
              kind: "out",
              from: "854-432-319",
              to: "123-456-789",
              room: null,
              text: "",
              ts: 1700000000,
              id: null,
              localId: "msg-video-note-1",
              attachment: { kind: "file", localId, name: "video_note_1700000000.webm", size: 571884, mime: "video/webm", fileId: null },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileTransfers: [
          {
            localId,
            id: null,
            name: "video_note_1700000000.webm",
            size: 571884,
            mime: "video/webm",
            direction: "out",
            peer: "123-456-789",
            room: null,
            status: "uploading",
            progress: 42,
            url: "blob:video-note",
          },
        ],
        fileOffersIn: [],
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      let fileRows = findAll(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.equal(fileRows.length, 1, "во время upload должен быть один file-row");
      let fileRow = fileRows[0];
      assert.ok(hasClass(fileRow, "file-row-video-note"), "video-note row должен сохранять round style marker");
      let previews = findAll(fileRow, (n) => hasClass(n, "chat-file-preview-video"));
      assert.equal(previews.length, 1, "во время upload должен быть один video preview");
      assert.ok(hasClass(previews[0], "chat-file-preview-video-note"), "preview должен сохранять video-note marker");
      assert.equal(previews[0].getAttribute("data-local-id"), localId);
      assert.equal(previews[0].getAttribute("data-media-state"), "progress");
      assert.ok(textOf(previews[0]).includes("Загрузка 42%"));
      assert.equal(findAll(fileRow, (n) => hasClass(n, "chat-media-progress")).length, 1, "visual upload должен иметь один overlay progress");
      assert.equal(findAll(fileRow, (n) => hasClass(n, "file-progress")).length, 0, "visual upload не должен дублировать progress в file-main");
      assert.ok(findFirst(previews[0], (n) => n && n.tagName === "VIDEO"), "локальный blob должен сразу давать video preview");

      state.conversations = {
        ...state.conversations,
        "dm:123-456-789": [
          {
            ...state.conversations["dm:123-456-789"][0],
            attachment: { ...state.conversations["dm:123-456-789"][0].attachment, fileId: "vid-42" },
          },
        ],
      };
      state.fileTransfers = [{ ...state.fileTransfers[0], id: "vid-42", progress: 67 }];

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      fileRows = findAll(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.equal(fileRows.length, 1, "после fileId row не должен задваиваться");
      fileRow = fileRows[0];
      previews = findAll(fileRow, (n) => hasClass(n, "chat-file-preview-video"));
      assert.equal(previews.length, 1, "после fileId preview не должен задваиваться");
      assert.equal(previews[0].getAttribute("data-file-id"), "vid-42");
      assert.equal(previews[0].getAttribute("data-local-id"), localId);
      assert.equal(previews[0].getAttribute("data-media-state"), "progress");
      assert.ok(textOf(previews[0]).includes("Загрузка 67%"));
      assert.equal(findAll(fileRow, (n) => hasClass(n, "chat-media-progress")).length, 1);
      assert.equal(findAll(fileRow, (n) => hasClass(n, "file-progress")).length, 0);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: iOS video IMG_*.MP4 не должен рендериться как «Фото»", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            {
              kind: "in",
              from: "123-456-789",
              to: "854-432-319",
              room: null,
              text: "",
              ts: 1700000000,
              id: 1,
              attachment: { kind: "file", name: "IMG_3383.MP4", size: 456, mime: "video/mp4", fileId: "99" },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileTransfers: [
          {
            localId: "ft-99",
            id: "99",
            name: "IMG_3383.MP4",
            size: 456,
            mime: "video/mp4",
            direction: "in",
            peer: "123-456-789",
            room: null,
            status: "complete",
            progress: 100,
            url: "blob:video",
          },
        ],
        fileOffersIn: [],
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.ok(hasClass(fileRow, "file-row-video"), "file-row должен быть помечен как video");

      const preview = findFirst(fileRow, (n) => hasClass(n, "chat-file-preview-video"));
      assert.ok(preview, "должен быть video preview");
      assert.equal(preview.getAttribute("data-file-kind"), "video");

      const video = findFirst(preview, (n) => n && n.tagName === "VIDEO");
      assert.ok(video, "в preview должен быть <video>");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: small IMG_*.MP4 сохраняет aspect ratio после deferred swap", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            {
              kind: "in",
              from: "123-456-789",
              to: "854-432-319",
              room: null,
              text: "",
              ts: 1700000000,
              id: 1,
              attachment: { kind: "file", name: "IMG_3383.MP4", size: 571884, mime: "video/mp4", fileId: "99" },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileThumbs: {
          "99": {
            url: "blob:thumb",
            mime: "image/jpeg",
            w: 108,
            h: 192,
            mediaW: 1080,
            mediaH: 1920,
          },
        },
        fileTransfers: [
          {
            localId: "ft-99",
            id: "99",
            name: "IMG_3383.MP4",
            size: 571884,
            mime: "video/mp4",
            direction: "in",
            peer: "123-456-789",
            room: null,
            status: "complete",
            progress: 100,
            url: "blob:video",
          },
        ],
        fileOffersIn: [],
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);

      const previewBefore = findFirst(chatHost, (n) => hasClass(n, "chat-file-preview-video"));
      assert.ok(previewBefore, "должен быть video preview");
      assert.equal(previewBefore.style.aspectRatio, String(108 / 192), "placeholder должен зафиксировать ratio по thumb");

      await flushDeferredChatMedia();

      const previewAfter = findFirst(chatHost, (n) => hasClass(n, "chat-file-preview-video"));
      assert.equal(previewAfter, previewBefore, "deferred swap должен обновить тот же preview mount");
      assert.equal(previewAfter.style.aspectRatio, String(108 / 192), "final surface не должна терять исходный ratio");

      const video = findFirst(previewAfter, (n) => n && n.tagName === "VIDEO");
      assert.ok(video, "для малого mp4 после deferred swap должен остаться inline <video>");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: small IMG_*.MP4 предпочитает thumb ratio даже при stale media-aspect cache", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
      const prevLocalStorage = globalThis.localStorage;
      const store = new Map();
      globalThis.localStorage = {
        getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => void store.set(String(k), String(v)),
        removeItem: (k) => void store.delete(String(k)),
      };

      try {
        store.set(
          "yagodka_media_aspect_cache_v1",
          JSON.stringify({
            v: 1,
            entries: [["99", 16 / 9]],
          })
        );

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
        chatHost.clientHeight = 120;
        chatHost.scrollHeight = 2000;

        const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
        const state = {
          selected: { kind: "dm", id: "123-456-789" },
          conversations: {
            "dm:123-456-789": [
              {
                kind: "in",
                from: "123-456-789",
                to: "854-432-319",
                room: null,
                text: "",
                ts: 1700000000,
                id: 1,
                attachment: { kind: "file", name: "IMG_3383.MP4", size: 571884, mime: "video/mp4", fileId: "99" },
              },
            ],
          },
          historyHasMore: {},
          historyLoading: {},
          chatSearchOpen: false,
          chatSearchQuery: "",
          chatSearchHits: [],
          chatSearchPos: 0,
          pinnedMessages: {},
          pinnedMessageActive: {},
          fileThumbs: {
            "99": {
              url: "blob:thumb",
              mime: "image/jpeg",
              w: 108,
              h: 192,
              mediaW: 1080,
              mediaH: 1920,
            },
          },
          fileTransfers: [
            {
              localId: "ft-99",
              id: "99",
              name: "IMG_3383.MP4",
              size: 571884,
              mime: "video/mp4",
              direction: "in",
              peer: "123-456-789",
              room: null,
              status: "complete",
              progress: 100,
              url: "blob:video",
            },
          ],
          fileOffersIn: [],
          groups: [],
          boards: [],
          profiles: {},
        };

        helper.renderChat(layout, state);

        const previewBefore = findFirst(chatHost, (n) => hasClass(n, "chat-file-preview-video"));
        assert.ok(previewBefore, "должен быть video preview");
        assert.equal(previewBefore.style.aspectRatio, String(108 / 192), "thumb ratio должен победить stale cache ещё до deferred swap");

        await flushDeferredChatMedia();

        const previewAfter = findFirst(chatHost, (n) => hasClass(n, "chat-file-preview-video"));
        assert.equal(previewAfter.style.aspectRatio, String(108 / 192), "deferred surface не должна возвращаться к stale cached ratio");
      } finally {
        if (prevLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = prevLocalStorage;
      }
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: video file-attachment (large) не рендерит inline <video>", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            {
              kind: "in",
              from: "123-456-789",
              to: "854-432-319",
              room: null,
              text: "",
              ts: 1700000000,
              id: 1,
              attachment: { kind: "file", name: "clip.mp4", size: 9 * 1024 * 1024, mime: "video/mp4", fileId: "99" },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileTransfers: [
          {
            localId: "ft-99",
            id: "99",
            name: "clip.mp4",
            size: 9 * 1024 * 1024,
            mime: "video/mp4",
            direction: "in",
            peer: "123-456-789",
            room: null,
            status: "complete",
            progress: 100,
            url: "blob:video",
          },
        ],
        fileOffersIn: [],
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.ok(hasClass(fileRow, "file-row-video"), "file-row должен быть помечен как video");

      const preview = findFirst(fileRow, (n) => hasClass(n, "chat-file-preview-video"));
      assert.ok(preview, "должен быть video preview");

      const video = findFirst(preview, (n) => n && n.tagName === "VIDEO");
      assert.equal(video, null, "inline <video> не должен рендериться для большого видео");

      const placeholder = findFirst(preview, (n) => hasClass(n, "chat-file-placeholder"));
      assert.ok(placeholder, "должен быть placeholder для видео без thumb");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: video file-attachment (mobile UI) не рендерит inline <video>", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
      const prevWindow = globalThis.window;
      globalThis.window = {
        matchMedia() {
          return { matches: true };
        },
      };
      try {
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
        chatHost.clientHeight = 120;
        chatHost.scrollHeight = 2000;

        const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
        const state = {
          selected: { kind: "dm", id: "123-456-789" },
          conversations: {
            "dm:123-456-789": [
              {
                kind: "in",
                from: "123-456-789",
                to: "854-432-319",
                room: null,
                text: "",
                ts: 1700000000,
                id: 1,
                attachment: { kind: "file", name: "clip.mp4", size: 456, mime: "video/mp4", fileId: "99" },
              },
            ],
          },
          historyHasMore: {},
          historyLoading: {},
          chatSearchOpen: false,
          chatSearchQuery: "",
          chatSearchHits: [],
          chatSearchPos: 0,
          pinnedMessages: {},
          pinnedMessageActive: {},
          fileTransfers: [
            {
              localId: "ft-99",
              id: "99",
              name: "clip.mp4",
              size: 456,
              mime: "video/mp4",
              direction: "in",
              peer: "123-456-789",
              room: null,
              status: "complete",
              progress: 100,
              url: "blob:video",
            },
          ],
          fileOffersIn: [],
          groups: [],
          boards: [],
          profiles: {},
        };

        helper.renderChat(layout, state);
        await flushDeferredChatMedia();

        const preview = findFirst(chatHost, (n) => hasClass(n, "chat-file-preview-video"));
        assert.ok(preview, "должен быть video preview");

        const video = findFirst(preview, (n) => n && n.tagName === "VIDEO");
        assert.equal(video, null, "inline <video> не должен рендериться на mobile UI");
      } finally {
        if (prevWindow === undefined) delete globalThis.window;
        else globalThis.window = prevWindow;
      }
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: audio file-attachment рендерит custom audio player (chat-voice)", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
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
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
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
        fileOffersIn: [],
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.ok(hasClass(fileRow, "file-row-audio"), "file-row должен быть помечен как audio");

      const player = findFirst(fileRow, (n) => hasClass(n, "chat-voice"));
      assert.ok(player, "должен быть chat-voice player");
      assert.equal(player.getAttribute("data-file-kind"), "audio");
      assert.equal(player.getAttribute("data-file-id"), "77");
      assert.equal(player.getAttribute("data-name"), "note.ogg");
      assert.equal(player.getAttribute("data-size"), "321");
      assert.equal(player.getAttribute("data-mime"), "audio/ogg");
      assert.equal(player.getAttribute("data-msg-idx"), "0");

      const audio = findFirst(player, (n) => n && n.tagName === "AUDIO");
      assert.ok(audio, "должен быть <audio> внутри плеера");
      assert.ok(hasClass(audio, "chat-voice-audio"));
      assert.equal(audio.getAttribute("preload"), "metadata");
      assert.equal(audio.getAttribute("src"), "blob:audio");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: audio bubble uses frameless centered controls", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /\.chat-voice\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*40px minmax\(140px,\s*1fr\)/s);
  assert.match(css, /\.chat-voice-play\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.chat-voice-speed\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.file-row-chat\.file-row-audio:has\(\.chat-voice:not\(\.chat-voice-placeholder\)\)\s*{[^}]*display:\s*block;[^}]*padding:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.file-row-chat\.file-row-audio:has\(\.chat-voice:not\(\.chat-voice-placeholder\)\)\s+\.file-chip-row[\s\S]*?display:\s*none;/);
  assert.match(css, /\.file-row-chat\.file-row-audio:has\(\.chat-voice:not\(\.chat-voice-placeholder\)\)\s+\.chat-voice-play[\s\S]*?padding:\s*0;/);
  assert.match(css, /\.file-row-chat\.file-row-audio:has\(\.chat-voice:not\(\.chat-voice-placeholder\)\)\s+\.chat-voice-speed[\s\S]*?padding:\s*0 2px;/);
  assert.match(css, /\.file-row-chat\.file-row-audio:has\(\.chat-voice:not\(\.chat-voice-placeholder\)\)\s+\.chat-voice-track[\s\S]*?background:\s*transparent;/);
  assert.match(css, /@keyframes\s+chat-voice-wave/);
  assert.match(css, /\.chat-voice\[data-voice-state="playing"\]\s+\.chat-voice-track::before\s*\{[\s\S]*?animation:\s*chat-voice-wave/);
  assert.match(css, /\.chat-voice\[data-voice-state="playing"\]\s+\.chat-voice-progress\s*\{[\s\S]*?animation:\s*chat-voice-progress-pulse/);
  assert.match(css, /@keyframes\s+chat-voice-loading-spin/);
  assert.match(css, /\.chat-voice\[data-voice-state="loading"\]\s+\.chat-voice-play::before\s*\{[\s\S]*?animation:\s*chat-voice-loading-spin/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?chat-voice\[data-voice-state="playing"\][\s\S]*?animation:\s*none/);
});

test("renderChat: empty media previews keep placeholder shells", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        selfId: "987-654-321",
        conn: "connected",
        authed: true,
        page: "main",
        mobileNavOpen: false,
        friends: [{ id: "123-456-789", online: true }],
        rooms: [],
        roomOrder: [],
        archivedChats: [],
        pinnedChats: [],
        chatFolders: [],
        conversationLimits: {},
        conversations: {
          "dm:123-456-789": [
            {
              id: 10,
              localId: "msg-image",
              ts: Date.now(),
              from: "123-456-789",
              kind: "in",
              text: "",
              attachment: { kind: "file", fileId: "img-1", name: "photo.jpg", size: 1234, mime: "image/jpeg" },
            },
            {
              id: 11,
              localId: "msg-video",
              ts: Date.now() + 1,
              from: "123-456-789",
              kind: "in",
              text: "",
              attachment: { kind: "file", fileId: "vid-1", name: "clip.mp4", size: 4321, mime: "video/mp4" },
            },
          ],
        },
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
        fileThumbs: {},
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const previews = findAll(chatHost, (n) => hasClass(n, "chat-file-preview"));
      const imagePreview = previews.find((n) => n.getAttribute?.("data-file-id") === "img-1");
      const videoPreview = previews.find((n) => n.getAttribute?.("data-file-id") === "vid-1");
      assert.ok(imagePreview, "image preview should exist");
      assert.ok(videoPreview, "video preview should exist");
      assert.ok(hasClass(imagePreview, "chat-file-preview-empty"));
      assert.ok(hasClass(videoPreview, "chat-file-preview-empty"));
      assert.equal(imagePreview.getAttribute("data-media-state"), "empty");
      assert.equal(videoPreview.getAttribute("data-media-state"), "empty");
      assert.ok(textOf(imagePreview).includes("Загрузить фото"));
      assert.ok(textOf(videoPreview).includes("Загрузить видео"));
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: video-note keeps square fallback aspect ratio without thumb", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        selfId: "987-654-321",
        conn: "connected",
        authed: true,
        page: "main",
        mobileNavOpen: false,
        friends: [{ id: "123-456-789", online: true }],
        rooms: [],
        roomOrder: [],
        archivedChats: [],
        pinnedChats: [],
        chatFolders: [],
        conversationLimits: {},
        conversations: {
          "dm:123-456-789": [
            {
              id: 12,
              localId: "msg-note",
              ts: Date.now(),
              from: "123-456-789",
              kind: "in",
              text: "",
              attachment: { kind: "file", fileId: "note-1", name: "video_note_123.mp4", size: 2048, mime: "video/mp4" },
            },
          ],
        },
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
        fileThumbs: {},
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const preview = findFirst(chatHost, (n) => hasClass(n, "chat-file-preview-video"));
      assert.ok(preview, "video-note preview should exist");
      assert.equal(preview.style.aspectRatio, "1 / 1");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: terminal missing visual media renders unavailable state without raw not_found", async () => {
  const helper = await loadRenderChat();
  try {
    await withDomStubs(async () => {
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
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        selfId: "987-654-321",
        conn: "connected",
        authed: true,
        page: "main",
        mobileNavOpen: false,
        friends: [{ id: "123-456-789", online: true }],
        rooms: [],
        roomOrder: [],
        archivedChats: [],
        pinnedChats: [],
        chatFolders: [],
        conversationLimits: {},
        conversations: {
          "dm:123-456-789": [
            {
              id: 13,
              localId: "msg-missing",
              ts: Date.now(),
              from: "123-456-789",
              kind: "in",
              text: "",
              attachment: { kind: "file", fileId: "missing-img", name: "photo.jpg", size: 1234, mime: "image/jpeg" },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileTransfers: [
          {
            localId: "ft-missing",
            id: "missing-img",
            name: "photo.jpg",
            size: 1234,
            mime: "image/jpeg",
            direction: "in",
            peer: "123-456-789",
            status: "error",
            progress: 0,
            error: "not_found",
          },
        ],
        fileOffersIn: [],
        fileThumbs: {},
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);
      await flushDeferredChatMedia();

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "file row should exist");
      const rowText = textOf(fileRow);
      assert.ok(rowText.includes("Файл недоступен"));
      assert.ok(rowText.includes("Недоступен"));
      assert.equal(rowText.includes("Ошибка: not_found"), false);

      const preview = findFirst(fileRow, (n) => hasClass(n, "chat-file-preview"));
      assert.ok(preview, "preview should exist");
      assert.ok(hasClass(preview, "chat-file-preview-missing"));
      assert.equal(preview.getAttribute("disabled"), "true");
      assert.equal(preview.getAttribute("data-media-missing"), "1");
      assert.equal(preview.getAttribute("data-media-state"), "missing");
      assert.ok(textOf(preview).includes("Файл недоступен"));
    });
  } finally {
    await helper.cleanup();
  }
});
