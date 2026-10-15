import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

async function withDomStubs(run) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
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
    }
    setAttribute(name, value) {
      const k = String(name);
      const v = String(value);
      this._attrs.set(k, v);
    }
    removeAttribute(name) {
      this._attrs.delete(String(name));
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
    addEventListener(type, handler) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      list.push(handler);
      this._listeners.set(key, list);
    }
    removeEventListener(type, handler) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      const next = handler ? list.filter((h) => h !== handler) : [];
      if (next.length) this._listeners.set(key, next);
      else this._listeners.delete(key);
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
    documentElement: { dataset: {} },
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };

  try {
    return await run();
  } finally {
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;

    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;

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

test("sidebar: Ctrl+Click/ПКМ не активирует строку (не меняет выбранный чат)", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(async () => {
      const calls = [];
      const target = document.createElement("div");
      const state = {
        // required-ish fields
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
        mobileSidebarTab: "contacts",
        conversations: { "dm:123-456-789": [{ ts: 1, from: "123-456-789", text: "привет", kind: "in" }] },
        drafts: {},
      };

      helper.renderSidebar(
        target,
        state,
        (t) => calls.push(t),
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

      const btn = findFirst(target, (n) => typeof n.getAttribute === "function" && n.getAttribute("data-ctx-id") === "123-456-789");
      assert.ok(btn, "row button not found");
      assert.equal(btn.getAttribute("data-online"), "1");

      btn.dispatchEvent({ type: "click", ctrlKey: true, button: 0 });
      assert.equal(calls.length, 0);

      btn.dispatchEvent({ type: "click", ctrlKey: false, button: 0 });
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], { kind: "dm", id: "123-456-789" });

      document.documentElement.dataset.sidebarClickSuppressUntil = String(Date.now() + 1000);
      btn.dispatchEvent({ type: "click", ctrlKey: false, button: 0 });
      assert.equal(calls.length, 2, "root context suppression should not eat ordinary row activation");

      btn.setAttribute("data-ctx-suppress-until", String(Date.now() + 1000));
      btn.dispatchEvent({
        type: "click",
        ctrlKey: false,
        button: 0,
        preventDefault() {},
        stopPropagation() {},
      });
      assert.equal(calls.length, 2, "local context suppression should block the immediate follow-up click");

      btn.setAttribute("data-ctx-suppress-until", "0");
      btn.dispatchEvent({ type: "click", ctrlKey: false, button: 0 });
      assert.equal(calls.length, 3, "ordinary click after local suppression should work");
    });
  } finally {
    await helper.cleanup();
  }
});

test("sidebar: avatarsRev инвалидирует рендер (локальные аватары обновляются без перезагрузки)", async () => {
  const helper = await loadRenderSidebar();
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
        const target = document.createElement("div");
        const state = {
          friends: [{ id: "123-456-789", online: true, unread: 0 }],
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
          conversations: { "dm:123-456-789": [{ ts: 1, from: "123-456-789", text: "привет", kind: "in" }] },
          drafts: {},
          avatarsRev: 0,
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();

        const btn = findFirst(target, (n) => typeof n.getAttribute === "function" && n.getAttribute("data-ctx-id") === "123-456-789");
        assert.ok(btn, "row button not found");
        const avatar1 = findFirst(btn, (n) => typeof n.className === "string" && String(n.className).split(/\s+/).includes("avatar"));
        assert.ok(avatar1, "avatar node not found");
        assert.ok(!String(avatar1.className).split(/\s+/).includes("avatar-img"), "avatar should start without avatar-img");

        store.set("yagodka_avatar:dm:123-456-789", "data:image/png;base64,AAAA");
        state.avatarsRev += 1;

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        await flushLazySidebarRender();

        const btn2 = findFirst(target, (n) => typeof n.getAttribute === "function" && n.getAttribute("data-ctx-id") === "123-456-789");
        assert.ok(btn2, "row button not found after rerender");
        const avatar2 = findFirst(btn2, (n) => typeof n.className === "string" && String(n.className).split(/\s+/).includes("avatar"));
        assert.ok(avatar2, "avatar node not found after rerender");
        assert.ok(String(avatar2.className).split(/\s+/).includes("avatar-img"), "avatar should become avatar-img after avatarsRev");
      } finally {
        if (prevLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = prevLocalStorage;
      }
    });
  } finally {
    await helper.cleanup();
  }
});

test("sidebar: presenceTick alone does not replace contact rows under hover", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(async () => {
      const target = document.createElement("div");
      const state = {
        friends: [{ id: "123-456-789", online: true, unread: 0 }],
        profiles: {},
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
        conversations: { "dm:123-456-789": [{ ts: 1, from: "123-456-789", text: "привет", kind: "in" }] },
        drafts: {},
        presenceTick: 1,
      };

      helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
      await flushLazySidebarRender();

      const body = target._sidebarBody;
      const children = body?._children;
      const btn = findFirst(target, (n) => typeof n.getAttribute === "function" && n.getAttribute("data-ctx-id") === "123-456-789");
      assert.ok(body, "sidebar body not found");
      assert.ok(Array.isArray(children), "sidebar body children not found");
      assert.ok(btn, "row button not found");

      state.presenceTick += 1;
      helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
      await flushLazySidebarRender();

      assert.equal(target._sidebarBody, body);
      assert.equal(body._children, children);
      assert.equal(
        findFirst(target, (n) => typeof n.getAttribute === "function" && n.getAttribute("data-ctx-id") === "123-456-789"),
        btn
      );
    });
  } finally {
    await helper.cleanup();
  }
});

test("sidebar: row descendants inherit cursor to keep PWA hover stable", async () => {
  const css = await readFile(path.resolve("src/scss/components.part01.css"), "utf8");
  assert.match(css, /\.sidebar\s+\.row\s+\*\s*\{[\s\S]*?cursor:\s*inherit;/);
});

test("sidebar: показывает display_name вместо ID (если известен профиль)", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(async () => {
      const target = document.createElement("div");
      const state = {
        friends: [{ id: "123-456-789", online: true, unread: 0 }],
        profiles: { "123-456-789": { id: "123-456-789", display_name: "Алиса" } },
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
        conversations: { "dm:123-456-789": [{ ts: 1, from: "123-456-789", text: "привет", kind: "in" }] },
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
        () => {},
        () => {}
      );
      await flushLazySidebarRender();

      const btn = findFirst(target, (n) => typeof n.getAttribute === "function" && n.getAttribute("data-ctx-id") === "123-456-789");
      assert.ok(btn, "row button not found");

      const title = findFirst(btn, (n) => typeof n.className === "string" && n.className.split(" ").includes("row-title"));
      assert.ok(title, "row title not found");
      const text = Array.isArray(title._children) ? title._children.map((c) => (c && typeof c === "object" ? c.textContent : "")).join("") : "";
      assert.equal(text, "Алиса");
    });
  } finally {
    await helper.cleanup();
  }
});

test("sidebar: «Ожидают» убраны, а pending подсвечивает контакт (row-attn)", async () => {
  const helper = await loadRenderSidebar();
  try {
    await withDomStubs(async () => {
      const target = document.createElement("div");
      const state = {
        friends: [],
        profiles: {},
        groups: [],
        boards: [],
        pinned: [],
        pendingIn: ["999-000-111"],
        pendingOut: [],
        pendingGroupInvites: [],
        pendingGroupJoinRequests: [],
        pendingBoardInvites: [],
        fileOffersIn: [],
        selected: null,
        page: "main",
        conversations: {},
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
        () => {},
        () => {}
      );
      await flushLazySidebarRender();

      const hasPendingSection = findFirst(
        target,
        (n) => n && typeof n === "object" && n.nodeType === 3 && String(n.textContent || "").includes("Ожида")
      );
      assert.equal(hasPendingSection, null, "pending section should not be rendered");

      const btn = findFirst(target, (n) => typeof n.getAttribute === "function" && n.getAttribute("data-ctx-id") === "999-000-111");
      assert.ok(btn, "pending peer row not found");
      assert.ok(String(btn.className || "").split(" ").includes("row-attn"), "pending peer should be marked with row-attn");
    });
  } finally {
    await helper.cleanup();
  }
});
