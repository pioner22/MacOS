import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadPage(relPath, exportName) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(relPath)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod[exportName] !== "function") throw new Error(`${exportName} export missing`);
    return { factory: mod[exportName], cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
    HTMLSelectElement: globalThis.HTMLSelectElement,
    window: globalThis.window,
  };

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this.textContent = "";
      this.value = "";
      this.disabled = false;
      this.dataset = {};
      this.style = { setProperty() {} };
      this._attrs = new Map();
      this._children = [];
      this._listeners = new Map();
      this.classList = {
        toggle: () => {},
      };
    }
    setAttribute(name, value) {
      this._attrs.set(String(name), String(value));
      if (String(name).toLowerCase() === "value") this.value = String(value);
    }
    hasAttribute(name) {
      return this._attrs.has(String(name));
    }
    getAttribute(name) {
      const value = this._attrs.get(String(name));
      return value === undefined ? null : value;
    }
    append(node) {
      this._children.push(node);
    }
    replaceChildren(...nodes) {
      this._children = nodes.map((n) => (typeof n === "string" ? globalThis.document.createTextNode(n) : n));
    }
    addEventListener(type, cb) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      list.push(cb);
      this._listeners.set(key, list);
    }
    focus() {}
    click() {
      const list = this._listeners.get("click") || [];
      for (const cb of list) cb({ type: "click", preventDefault() {} });
    }
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
      this.type = "text";
      this.files = null;
    }
  }

  class HTMLTextAreaElementStub extends HTMLElementStub {
    constructor() {
      super("textarea");
    }
  }

  class HTMLSelectElementStub extends HTMLElementStub {
    constructor() {
      super("select");
    }
  }

  globalThis.HTMLElement = HTMLElementStub;
  globalThis.HTMLInputElement = HTMLInputElementStub;
  globalThis.HTMLTextAreaElement = HTMLTextAreaElementStub;
  globalThis.HTMLSelectElement = HTMLSelectElementStub;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.document = {
    activeElement: null,
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === "input") return new HTMLInputElementStub();
      if (t === "textarea") return new HTMLTextAreaElementStub();
      if (t === "select") return new HTMLSelectElementStub();
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
    if (prev.HTMLSelectElement === undefined) delete globalThis.HTMLSelectElement;
    else globalThis.HTMLSelectElement = prev.HTMLSelectElement;
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
  }
}

function getText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  const children = Array.isArray(node._children) ? node._children : [];
  return [String(node.textContent || ""), ...children.map(getText)].join("");
}

function collectNodes(node, predicate, out = []) {
  if (!node || node.nodeType === 3) return out;
  if (predicate(node)) out.push(node);
  const children = Array.isArray(node._children) ? node._children : [];
  for (const child of children) collectNodes(child, predicate, out);
  return out;
}

test("profile page: session management moved out of main profile body", async () => {
  const helper = await loadPage("src/pages/profile/createProfilePage.ts", "createProfilePage");
  try {
    withDomStubs(() => {
      const page = helper.factory({
        onDraftChange() {},
        onSave() {},
        onRefresh() {},
        onOpenSessionsPage() {},
        onSkinChange() {},
        onThemeChange() {},
        onAvatarSelect() {},
        onAvatarClear() {},
        onPushEnable() {},
        onPushDisable() {},
        onNotifyInAppEnable() {},
        onNotifyInAppDisable() {},
        onNotifySoundEnable() {},
        onNotifySoundDisable() {},
        onForcePwaUpdate() {},
      });
      const text = getText(page.root);
      assert.ok(text.includes("Открыть устройства"));
      assert.ok(!text.includes("Другие устройства"));
      assert.ok(!text.includes("Активные сессии"));
    });
  } finally {
    await helper.cleanup();
  }
});

test("profile page: W-1036 removes manual save and refresh footer actions", async () => {
  const helper = await loadPage("src/pages/profile/createProfilePage.ts", "createProfilePage");
  try {
    withDomStubs(() => {
      const page = helper.factory({
        onDraftChange() {},
        onSave() {},
        onRefresh() {},
        onOpenSessionsPage() {},
        onSkinChange() {},
        onThemeChange() {},
        onAvatarSelect() {},
        onAvatarClear() {},
        onPushEnable() {},
        onPushDisable() {},
        onNotifyInAppEnable() {},
        onNotifyInAppDisable() {},
        onNotifySoundEnable() {},
        onNotifySoundDisable() {},
        onForcePwaUpdate() {},
      });
      const text = getText(page.root);
      const footerActions = collectNodes(page.root, (node) => String(node.className || "").split(/\s+/).includes("page-actions"));

      assert.equal(footerActions.length, 0, "profile must not render a bottom page-actions footer");
      assert.equal(text.includes("Сохранить"), false, "profile must not show a manual save button or hint");
      assert.equal(text.includes("Обновить"), false, "profile must not show a manual refresh button");
    });
  } finally {
    await helper.cleanup();
  }
});

test("sessions page: dedicated session controls render separately from profile", async () => {
  const helper = await loadPage("src/pages/profile/createSessionsPage.ts", "createSessionsPage");
  try {
    withDomStubs(() => {
      const page = helper.factory({
        onBackToProfile() {},
        onRefresh() {},
        onLogoutOthers() {},
      });
      page.update({
        authed: true,
        conn: "connected",
        sessionDevicesStatus: "Активно сессий: 2.",
        sessionDevices: [
          { current: true, online: true, client_kind: "web", client_version: "0.1.756", user_agent: "Mozilla/5.0 (Macintosh)", ip_masked: "192.168.*.*", issued_at: 1700000000, last_used_at: 1700000000, expires_at: 1701000000 },
          { current: false, online: false, client_kind: "pwa", client_version: "0.1.755", user_agent: "Mozilla/5.0 (iPhone)", ip_masked: "10.20.*.*", issued_at: 1690000000, last_used_at: 1695000000, expires_at: 1700500000 },
        ],
      });
      const text = getText(page.root);
      assert.ok(text.includes("Выйти на других устройствах"));
      assert.ok(text.includes("Это устройство"));
      assert.ok(text.includes("Другие устройства"));
    });
  } finally {
    await helper.cleanup();
  }
});
