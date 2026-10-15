import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

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

function withMobileWindow(run) {
  const prevWindow = globalThis.window;
  globalThis.window = {
    matchMedia() {
      return {
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      };
    },
  };
  try {
    return run();
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
}

function makeChatLayout() {
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
  return { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
}

function virtualizedMessageIndices(chatHost) {
  return findAll(chatHost, (n) => n && typeof n.getAttribute === "function" && n.getAttribute("data-msg-idx") !== null)
    .map((n) => Number(n.getAttribute("data-msg-idx")))
    .filter((n) => Number.isFinite(n));
}

function makeLongChatState(historyVirtualStart = undefined) {
  const key = "dm:123-456-789";
  const messages = Array.from({ length: 260 }, (_, i) => ({
    kind: i % 2 === 0 ? "in" : "out",
    from: i % 2 === 0 ? "123-456-789" : "854-432-319",
    to: i % 2 === 0 ? "854-432-319" : "123-456-789",
    room: null,
    text: `m${i}`,
    ts: 1700000000 + i,
    id: i + 1,
  }));
  return {
    page: "main",
    selected: { kind: "dm", id: "123-456-789" },
    conversations: { [key]: messages },
    historyLoaded: { [key]: true },
    historyHasMore: { [key]: false },
    historyLoading: {},
    historyVirtualStart: historyVirtualStart === undefined ? {} : { [key]: historyVirtualStart },
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
}

test("renderChat: закреп/поиск рендерятся в chatTop (не в истории), chatJump живёт вне скролла", async () => {
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

      // Pretend we are already inside this chat and scrolled up (not at bottom).
      chatHost.setAttribute("data-chat-key", "dm:123-456-789");
      chatHost.scrollTop = 0;
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            { kind: "in", from: "123-456-789", to: "854-432-319", room: null, text: "привет", ts: 1700000000, id: 1 },
          ],
        },
        historyHasMore: { "dm:123-456-789": false },
        historyLoading: {},
        chatSearchOpen: true,
        chatSearchQuery: "пр",
        chatSearchHits: [0],
        chatSearchPos: 0,
        pinnedMessages: { "dm:123-456-789": [1] },
        pinnedMessageActive: { "dm:123-456-789": 1 },
        fileTransfers: [],
        fileOffersIn: [],
        groups: [],
        boards: [],
      };

      helper.renderChat(layout, state);

      const pinned = findFirst(chatTop, (n) => n && typeof n.className === "string" && n.className.split(/\s+/).includes("chat-pinned"));
      assert.ok(pinned, "pinned bar should be in chatTop");

      const search = findFirst(chatTop, (n) => n && typeof n.className === "string" && n.className.split(/\s+/).includes("chat-search"));
      assert.ok(search, "search bar should be in chatTop");

      const pinnedInHost = findFirst(chatHost, (n) => n && typeof n.className === "string" && n.className.split(/\s+/).includes("chat-pinned"));
      assert.equal(pinnedInHost, null, "pinned bar must not be inside chatHost/history");

      const searchInHost = findFirst(chatHost, (n) => n && typeof n.className === "string" && n.className.split(/\s+/).includes("chat-search"));
      assert.equal(searchInHost, null, "search bar must not be inside chatHost/history");

      const lines = findFirst(chatHost, (n) => n && typeof n.className === "string" && n.className.split(/\s+/).includes("chat-lines"));
      assert.ok(lines, "chat lines should be rendered inside chatHost");

      assert.equal(chatJump.classList.contains("hidden"), false, "chatJump should be visible when not at bottom");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: mobile virtual history без сохранённого start сразу показывает хвост", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      withMobileWindow(() => {
        const layout = makeChatLayout();
        helper.renderChat(layout, makeLongChatState());

        const indices = virtualizedMessageIndices(layout.chatHost);
        assert.equal(Math.min(...indices), 60);
        assert.equal(Math.max(...indices), 259);
        assert.ok(
          findFirst(layout.chatHost, (n) => n && typeof n.getAttribute === "function" && n.getAttribute("data-virtual-spacer") === "top"),
          "tail window should keep a top spacer for older messages"
        );
      });
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: mobile virtual history сохраняет явный start=0 для верхней позиции", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      withMobileWindow(() => {
        const layout = makeChatLayout();
        helper.renderChat(layout, makeLongChatState(0));

        const indices = virtualizedMessageIndices(layout.chatHost);
        assert.equal(Math.min(...indices), 0);
        assert.equal(Math.max(...indices), 199);
        assert.ok(
          findFirst(layout.chatHost, (n) => n && typeof n.getAttribute === "function" && n.getAttribute("data-virtual-spacer") === "bottom"),
          "explicit top window should keep a bottom spacer for newer messages"
        );
      });
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: без выбранного чата область чата пустая, composer/placeholder не рендерим", async () => {
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
      chatJump.className = "btn chat-jump";
      chatSelectionBar.className = "chat-selection-bar hidden";

      chatTop.replaceChildren({ nodeType: 3, textContent: "seed-top" });
      chatHost.replaceChildren({ nodeType: 3, textContent: "seed-host" });

      helper.renderChat(
        { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar },
        {
          selected: null,
        }
      );

      assert.equal(chatTop._children.length, 0);
      assert.equal(chatHost._children.length, 0);
      assert.equal(chatJump.classList.contains("hidden"), true);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: сохраняет scrollTop если replaceChildren сбрасывает его (iOS/WebKit)", async () => {
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

      chatHost.setAttribute("data-chat-key", "dm:123-456-789");
      chatHost.scrollTop = 420;
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      // Simulate iOS/WebKit quirk: scrollTop may reset after a full DOM replacement.
      const origReplace = chatHost.replaceChildren.bind(chatHost);
      chatHost.replaceChildren = (...nodes) => {
        origReplace(...nodes);
        chatHost.scrollTop = 0;
      };

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            { kind: "in", from: "123-456-789", to: "854-432-319", room: null, text: "привет", ts: 1700000000, id: 1 },
          ],
        },
        historyHasMore: { "dm:123-456-789": false },
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
      assert.equal(chatHost.scrollTop, 420, "expected scrollTop restored after DOM replacement");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: file_viewer overlay сохраняет историю выбранного чата", async () => {
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

      chatHost.setAttribute("data-chat-key", "dm:123-456-789");
      chatHost.scrollTop = 420;
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatSearchResults, chatSearchFooter, chatHost, chatJump, chatSelectionBar };
      const state = {
        page: "main",
        modal: { kind: "file_viewer", chatKey: "dm:123-456-789", msgIdx: 0, fileId: "f-1", openedAtMs: 1000 },
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            { kind: "in", from: "123-456-789", to: "854-432-319", room: null, text: "фото", ts: 1700000000, id: 1 },
          ],
        },
        historyHasMore: { "dm:123-456-789": false },
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

      const lines = findFirst(chatHost, (n) => n && typeof n.className === "string" && n.className.split(/\s+/).includes("chat-lines"));
      assert.ok(lines, "chat lines should stay rendered behind file viewer overlay");
      assert.equal(chatHost.scrollTop, 420, "expected scrollTop preserved while file viewer overlay is open");
    });
  } finally {
    await helper.cleanup();
  }
});
