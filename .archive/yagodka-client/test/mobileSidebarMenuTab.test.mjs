import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderSidebar() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/sidebar/renderSidebar.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderSidebar !== "function") {
      throw new Error("renderSidebar export missing");
    }
    return { renderSidebar: mod.renderSidebar, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

async function withDomStubs(run, opts = {}) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    navigatorDesc: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
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

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this._attrs = new Map();
      this._children = [];
      this._listeners = new Map();
      this.style = new StyleStub();
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.scrollHeight = 0;
      this.clientHeight = 0;
      this.scrollWidth = 0;
      this.clientWidth = 0;
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
    removeAttribute(name) {
      this._attrs.delete(String(name));
    }
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
    }
    replaceChildren(...nodes) {
      this._children = [...nodes];
    }
    addEventListener(type, handler) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      list.push(handler);
      this._listeners.set(key, list);
    }
    removeEventListener(type, handler) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      this._listeners.set(
        key,
        list.filter((h) => h !== handler)
      );
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
  const isMobile = Boolean(opts.isMobile);
  const standalone = Boolean(opts.standalone);
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      standalone,
      maxTouchPoints: 0,
    },
    configurable: true,
  });
  globalThis.window = {
    matchMedia: (query) => {
      const q = String(query || "");
      if (q.includes("max-width: 600px")) return { matches: isMobile };
      if (q.includes("display-mode: standalone") || q.includes("display-mode: fullscreen")) return { matches: standalone };
      return { matches: false };
    },
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  try {
    return await run();
  } finally {
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;

    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;

    if (prev.navigatorDesc) Object.defineProperty(globalThis, "navigator", prev.navigatorDesc);
    else delete globalThis.navigator;

    if (prev.HTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = prev.HTMLElement;

    if (prev.HTMLInputElement === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = prev.HTMLInputElement;

    if (prev.HTMLTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = prev.HTMLTextAreaElement;
  }
}

async function flushLazySidebarRender() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function collectText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  const kids = Array.isArray(node._children) ? node._children : [];
  return kids.map(collectText).join("");
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

function hasText(root, needle) {
  const txt = collectText(root);
  return txt.includes(String(needle));
}

function ctxKeyForSidebarRow(row) {
  if (!row || typeof row.getAttribute !== "function") return "";
  const kind = String(row.getAttribute("data-ctx-kind") || "").trim();
  const id = String(row.getAttribute("data-ctx-id") || "").trim();
  if (!kind || !id) return "";
  if (kind === "dm") return `dm:${id}`;
  if (kind === "group" || kind === "board") return `room:${id}`;
  return `${kind}:${id}`;
}

function sidebarRowsInSection(chatlist, sectionLabel) {
  const rows = [];
  const kids = Array.isArray(chatlist?._children) ? chatlist._children : [];
  let active = false;
  for (const node of kids) {
    if (!node || typeof node !== "object") continue;
    if (node.tagName === "DIV" && String(node.className || "").includes("pane-section")) {
      if (active) break;
      active = collectText(node).trim() === sectionLabel;
      continue;
    }
    if (!active || node.tagName !== "BUTTON") continue;
    const key = ctxKeyForSidebarRow(node);
    if (key) rows.push(key);
  }
  return rows;
}

function sidebarRowsAll(chatlist) {
  return findAll(chatlist, (node) => node.tagName === "BUTTON")
    .map((row) => ctxKeyForSidebarRow(row))
    .filter(Boolean);
}

function mkState(tab) {
  return {
    friends: [{ id: "123-456-789", online: true, friend: true, unread: 0 }],
    groups: [],
    boards: [],
    pinned: [],
    pendingIn: [],
    pendingOut: [],
    pendingGroupInvites: [],
    pendingGroupJoinRequests: [],
    pendingBoardInvites: [],
    fileOffersIn: [],
    selected: null,
    page: "main",
    mobileSidebarTab: tab,
    sidebarQuery: "",
    conversations: { "dm:123-456-789": [] },
    drafts: {},
  };
}

function paddedContactId(index) {
  const s = String(index).padStart(3, "0");
  return `100-000-${s}`;
}

function mkLargeContactState(count = 120) {
  const friends = [];
  const profiles = {};
  const conversations = {};
  for (let i = 0; i < count; i += 1) {
    const id = paddedContactId(i + 1);
    friends.push({ id, online: i % 2 === 0, friend: true, unread: 0 });
    profiles[id] = { id, display_name: `Контакт ${i + 1}` };
    conversations[`dm:${id}`] = [{ ts: i + 1, from: id, text: `сообщение ${i + 1}`, kind: "in" }];
  }
  return {
    friends,
    profiles,
    groups: [],
    boards: [],
    pinned: [],
    archived: [],
    muted: [],
    pendingIn: [],
    pendingOut: [],
    pendingGroupInvites: [],
    pendingGroupJoinRequests: [],
    pendingBoardInvites: [],
    fileOffersIn: [],
    selected: null,
    page: "main",
    mobileSidebarTab: "contacts",
    sidebarQuery: "",
    conversations,
    drafts: {},
  };
}

function findSidebarBody(target) {
  return findAll(target, (n) => n.tagName === "DIV" && String(n.className || "").includes("sidebar-body"))[0] || null;
}

function renderSidebarForTest(helper, target, state) {
  helper.renderSidebar(
    target,
    state,
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {}
  );
}

test("mobile sidebar: 4 вкладки (Контакты/Группы/Каналы/Меню), старое chats открывает Контакты", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        helper.renderSidebar(
          target,
          mkState("chats"),
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {}
        );
        await flushLazySidebarRender();
        const bottomDock = findAll(target, (n) => String(n.className || "").includes("sidebar-mobile-bottom"))[0];
        assert.ok(bottomDock, "mobile tabs must mount in bottom dock");
        assert.equal(bottomDock.getAttribute("aria-hidden"), null);
        assert.equal(bottomDock.getAttribute("role"), "navigation");
        assert.equal(Boolean(findAll(bottomDock, (n) => String(n.className || "").includes("sidebar-tabs-bottom-nav"))[0]), true);
        const sticky = findAll(target, (n) => String(n.className || "").includes("sidebar-mobile-sticky"))[0];
        assert.equal(Boolean(findAll(sticky, (n) => String(n.className || "").includes("sidebar-tabs"))[0]), false);
        const searchTrigger = findAll(sticky, (n) => n.tagName === "BUTTON" && String(n.className || "").includes("sidebar-search-trigger"))[0];
        assert.ok(searchTrigger, "mobile search starts as a magnifier trigger");
        const tabs = findAll(target, (n) => n.tagName === "BUTTON" && String(n.className || "").includes("sidebar-tab"));
        const labels = tabs.map((b) => collectText(b).trim());
        assert.deepEqual(labels, ["Контакты", "Группы", "Каналы", "Меню"]);
        assert.deepEqual(tabs.map((b) => b.getAttribute("data-tab-icon")), ["contacts", "groups", "boards", "menu"]);
        assert.equal(hasText(target, "Контакты"), true);
        assert.equal(hasText(target, "Сообщения"), false);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Контакты не содержат пункты меню (они в отдельной вкладке)", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        helper.renderSidebar(
          target,
          mkState("contacts"),
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {}
        );
        await flushLazySidebarRender();
        assert.equal(hasText(target, "Поиск"), false);
        assert.equal(hasText(target, "Создать группу"), false);
        assert.equal(hasText(target, "Онлайн"), false);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Меню содержит навигацию/создание и подсказки", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        helper.renderSidebar(
          target,
          mkState("menu"),
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {}
        );
        await flushLazySidebarRender();
        assert.equal(hasText(target, "Навигация"), true);
        assert.equal(hasText(target, "Профиль и настройки"), true);
        assert.equal(hasText(target, "Поиск по истории"), true);
        assert.equal(hasText(target, "Медиа и файлы"), true);
        assert.equal(hasText(target, "Новая группа"), true);
        assert.equal(hasText(target, "Справка и версия"), true);
        assert.equal(hasText(target, "Подсказки"), true);
        assert.equal(hasText(target, "Онлайн"), false);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: поиск фильтрует список и вызывает onSetSidebarQuery", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const calls = [];
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: false, unread: 0 },
          ],
          profiles: { "111-111-111": { id: "111-111-111", display_name: "Алиса" } },
          groups: [],
          boards: [],
          pinned: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "contacts",
          sidebarQuery: "али",
          conversations: {
            "dm:111-111-111": [{ ts: 1, from: "111-111-111", text: "привет", kind: "in" }],
            "dm:222-222-222": [{ ts: 2, from: "222-222-222", text: "йо", kind: "in" }],
          },
          drafts: {},
        };

        helper.renderSidebar(
          target,
          state,
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          (q) => calls.push(String(q)),
          () => {},
          () => {},
          () => {}
        );
        await flushLazySidebarRender();

        assert.equal(hasText(target, "Алиса"), true);
        assert.equal(hasText(target, "222-222-222"), false);

        const inputs = findAll(target, (n) => n.tagName === "INPUT" && String(n.className || "").includes("sidebar-search-input"));
        assert.equal(inputs.length > 0, true);
        const input = inputs[0];
        input.value = "test";
        input.dispatchEvent({ type: "input" });
        assert.deepEqual(calls, ["test"]);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Контакты показывают личные строки без групп и каналов", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: false, unread: 0 },
          ],
          groups: [{ id: "g-1", name: "Группа 1" }],
          boards: [{ id: "b-1", name: "Канал 1" }],
          pinned: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "chats",
          sidebarQuery: "",
          conversations: {
            "dm:111-111-111": [{ ts: 10, from: "111-111-111", text: "hi", kind: "in" }],
            "dm:222-222-222": [],
            "room:g-1": [],
            "room:b-1": [{ ts: 20, from: "111-111-111", text: "board", kind: "in" }],
          },
          drafts: {},
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();

        assert.equal(hasText(target, "Личные сообщения"), false);
        assert.equal(hasText(target, "111-111-111"), true);
        assert.equal(hasText(target, "222-222-222"), true);
        assert.equal(hasText(target, "Группа 1"), false);
        assert.equal(hasText(target, "Канал 1"), false);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Группы показывают только созданные групповые пространства", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        const state = {
          friends: [{ id: "111-111-111", online: true, unread: 0 }],
          groups: [{ id: "g-1", name: "Группа 1" }],
          boards: [{ id: "b-1", name: "Канал 1" }],
          pinned: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "groups",
          sidebarQuery: "",
          conversations: {
            "dm:111-111-111": [{ ts: 10, from: "111-111-111", text: "hi", kind: "in" }],
            "room:g-1": [{ ts: 20, from: "111-111-111", text: "group", kind: "in" }],
            "room:b-1": [{ ts: 30, from: "111-111-111", text: "channel", kind: "in" }],
          },
          drafts: {},
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();

        assert.equal(hasText(target, "Группы"), true);
        assert.equal(hasText(target, "Группа 1"), true);
        assert.equal(hasText(target, "Канал 1"), false);
        const chatlists = findAll(target, (n) => n.tagName === "DIV" && String(n.className || "").includes("chatlist"));
        assert.equal(chatlists.length > 0, true);
        assert.deepEqual(sidebarRowsInSection(chatlists[0], "Группы"), ["room:g-1"]);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Контакты показывают всех пользователей", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: false, unread: 0 },
          ],
          groups: [],
          boards: [],
          pinned: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "contacts",
          sidebarQuery: "",
          conversations: {
            "dm:111-111-111": [{ ts: 10, from: "111-111-111", text: "hi", kind: "in" }],
            "dm:222-222-222": [],
          },
          drafts: {},
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();

        assert.equal(hasText(target, "111-111-111"), true);
        assert.equal(hasText(target, "222-222-222"), true);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: pinned rows остаются внутри своих секций", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: true, unread: 0 },
          ],
          groups: [
            { id: "g-1", name: "Группа 1" },
            { id: "g-2", name: "Группа 2" },
          ],
          boards: [],
          pinned: ["room:g-1", "dm:111-111-111", "room:g-2", "dm:222-222-222"],
          archived: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "contacts",
          sidebarQuery: "",
          sidebarChatFilter: "all",
          conversations: {
            "dm:111-111-111": [{ ts: 1, from: "111-111-111", text: "a", kind: "in" }],
            "dm:222-222-222": [{ ts: 2, from: "222-222-222", text: "b", kind: "in" }],
            "room:g-1": [],
            "room:g-2": [],
          },
          drafts: {},
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();

        const chatlists = findAll(target, (n) => n.tagName === "DIV" && String(n.className || "").includes("chatlist"));
        assert.equal(chatlists.length > 0, true);
        const chatlist = chatlists[0];
        assert.deepEqual(sidebarRowsAll(chatlist), ["dm:111-111-111", "dm:222-222-222"]);

        const groupsTarget = document.createElement("div");
        helper.renderSidebar(groupsTarget, { ...state, mobileSidebarTab: "groups" }, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();
        const groupChatlists = findAll(groupsTarget, (n) => n.tagName === "DIV" && String(n.className || "").includes("chatlist"));
        assert.equal(groupChatlists.length > 0, true);
        assert.deepEqual(sidebarRowsInSection(groupChatlists[0], "Группы"), ["room:g-1", "room:g-2"]);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Контакты показывают превью личных диалогов, группы остаются отдельно", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: true, unread: 0 },
          ],
          groups: [{ id: "g-1", name: "Группа 1" }],
          boards: [],
          pinned: [],
          archived: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "contacts",
          sidebarQuery: "",
          sidebarChatFilter: "all",
          conversations: {
            "dm:111-111-111": [{ ts: 10, from: "111-111-111", text: "a", kind: "in" }],
            "dm:222-222-222": [{ ts: 30, from: "222-222-222", text: "b", kind: "in" }],
            "room:g-1": [{ ts: 20, from: "111-111-111", text: "c", kind: "in" }],
          },
          drafts: {},
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();

        const chatlists = findAll(target, (n) => n.tagName === "DIV" && String(n.className || "").includes("chatlist"));
        assert.equal(chatlists.length > 0, true);
        const chatlist = chatlists[0];
        assert.deepEqual(sidebarRowsAll(chatlist), ["dm:111-111-111", "dm:222-222-222"]);
        assert.equal(hasText(target, "b"), true);
        assert.equal(hasText(target, "c"), false);

        const groupsTarget = document.createElement("div");
        helper.renderSidebar(groupsTarget, { ...state, mobileSidebarTab: "groups" }, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();
        const groupChatlists = findAll(groupsTarget, (n) => n.tagName === "DIV" && String(n.className || "").includes("chatlist"));
        assert.equal(groupChatlists.length > 0, true);
        assert.deepEqual(sidebarRowsInSection(groupChatlists[0], "Группы"), ["room:g-1"]);
        assert.equal(hasText(groupsTarget, "c"), true);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: список контактов не пересобирается от обновления истории", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        const state = mkLargeContactState();

        renderSidebarForTest(helper, target, state);
        await flushLazySidebarRender();

        const body = findSidebarBody(target);
        assert.ok(body, "sidebar body must exist");
        body.scrollHeight = 4800;
        body.clientHeight = 720;
        body.scrollTop = 840;

        let replaceCalls = 0;
        const originalReplaceChildren = body.replaceChildren.bind(body);
        body.replaceChildren = (...nodes) => {
          replaceCalls += 1;
          originalReplaceChildren(...nodes);
          body.scrollTop = 0;
        };

        const nextState = {
          ...state,
          conversations: {
            ...state.conversations,
            [`dm:${paddedContactId(1)}`]: [{ ts: 999, from: paddedContactId(1), text: "новая история", kind: "in" }],
          },
        };

        renderSidebarForTest(helper, target, nextState);
        await flushLazySidebarRender();

        assert.equal(replaceCalls, 0);
        assert.equal(body.scrollTop, 840);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: список контактов сохраняет прокрутку при обновлении профилей", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        const state = mkLargeContactState();

        renderSidebarForTest(helper, target, state);
        await flushLazySidebarRender();

        const body = findSidebarBody(target);
        assert.ok(body, "sidebar body must exist");
        body.scrollHeight = 4800;
        body.clientHeight = 720;
        body.scrollTop = 960;

        let replaceCalls = 0;
        const originalReplaceChildren = body.replaceChildren.bind(body);
        body.replaceChildren = (...nodes) => {
          replaceCalls += 1;
          originalReplaceChildren(...nodes);
          body.scrollTop = 0;
        };

        const renamedId = paddedContactId(2);
        const nextState = {
          ...state,
          profiles: {
            ...state.profiles,
            [renamedId]: { id: renamedId, display_name: "Переименованный контакт" },
          },
        };

        renderSidebarForTest(helper, target, nextState);
        await flushLazySidebarRender();

        assert.equal(replaceCalls > 0, true);
        assert.equal(body.scrollTop, 960);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("standalone sidebar: desktop PWA рендерит tabs без отдельной вкладки меню", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(
      async () => {
        const target = document.createElement("div");
        helper.renderSidebar(
          target,
          mkState("chats"),
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {}
        );
        await flushLazySidebarRender();
        const tabs = findAll(target, (n) => n.tagName === "BUTTON" && String(n.className || "").includes("sidebar-tab"));
        const labels = tabs.map((b) => collectText(b).trim());
        assert.deepEqual(labels, ["Контакты", "Группы", "Каналы"]);
        assert.equal(hasText(target, "Меню"), false);
      },
      { isMobile: false, standalone: true }
    );
  } finally {
    await helper.cleanup();
  }
});
