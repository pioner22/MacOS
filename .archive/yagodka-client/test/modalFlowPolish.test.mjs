import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

async function bundleEntry(entryPath, exportName) {
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
    if (typeof mod[exportName] !== "function") {
      throw new Error(`${exportName} export missing`);
    }
    return { fn: mod[exportName], cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
  for (const kid of kids) {
    if (kid && typeof kid === "object") {
      const hit = findFirst(kid, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

function collectText(node) {
  if (!node) return "";
  if (typeof node.textContent === "string") return node.textContent;
  const kids = Array.isArray(node._children) ? node._children : [];
  let out = "";
  for (const kid of kids) {
    if (kid && typeof kid === "object") out += collectText(kid);
    else if (typeof kid === "string") out += kid;
  }
  return out;
}

test("renderSendScheduleModal: dedicated shell + Escape cancel + Enter schedule", async () => {
  const helper = await bundleEntry("src/components/modals/renderSendScheduleModal.ts", "renderSendScheduleModal");
  try {
    withDomStubs(() => {
      let scheduled = 0;
      let cancelled = 0;
      const node = helper.fn("Текст", Date.now() + 60_000, "Ошибка", "Отложить", "Запланировать", {
        onSchedule() {
          scheduled += 1;
        },
        onCancel() {
          cancelled += 1;
        },
      });
      assert.ok(node.className.includes("modal-send-schedule"));
      assert.equal(node.getAttribute("role"), "dialog");
      assert.equal(node.getAttribute("aria-modal"), "true");
      const keydown = node._listeners.get("keydown") || [];
      assert.equal(keydown.length, 1);
      keydown[0]({ key: "Escape", shiftKey: false, preventDefault() {} });
      keydown[0]({ key: "Enter", shiftKey: false, preventDefault() {} });
      assert.equal(cancelled, 1);
      assert.equal(scheduled, 1);
    });
  } finally {
    await helper.cleanup();
  }
});

test("welcome/logout shells: status semantics + dialog Escape close", async () => {
  const welcome = await bundleEntry("src/components/modals/renderWelcomeModal.ts", "renderWelcomeModal");
  const logout = await bundleEntry("src/components/modals/renderLogoutModal.ts", "renderLogoutModal");
  try {
    withDomStubs(() => {
      const welcomeNode = welcome.fn("Подключение…");
      assert.equal(welcomeNode.getAttribute("role"), "status");
      assert.equal(welcomeNode.getAttribute("aria-live"), "polite");
      assert.equal(welcomeNode.getAttribute("aria-busy"), "true");
      assert.equal(findFirst(welcomeNode, (n) => typeof n?.className === "string" && String(n.className).includes("screen-bar")), null);
      assert.equal(findFirst(welcomeNode, (n) => typeof n?.className === "string" && String(n.className).includes("screen-steps")), null);

      let closed = 0;
      let relogin = 0;
      let switched = 0;
      const logoutNode = logout.fn("Сессия завершена", "854-432-319", {
        onClose() {
          closed += 1;
        },
        onRelogin() {
          relogin += 1;
        },
        onUseDifferentAccount() {
          switched += 1;
        },
      });
      assert.equal(logoutNode.getAttribute("role"), "dialog");
      assert.equal(logoutNode.getAttribute("aria-modal"), "true");
      const chip = findFirst(
        logoutNode,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("screen-chip")
      );
      assert.ok(chip, "screen-chip not found");
      const account = findFirst(
        logoutNode,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("screen-note-value")
      );
      assert.ok(account, "screen-note-value not found");
      assert.match(collectText(account), /854-432-319/);
      const reloginBtn = findFirst(
        logoutNode,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Войти снова/.test(collectText(n))
      );
      assert.ok(reloginBtn, "relogin button not found");
      const switchBtn = findFirst(
        logoutNode,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Другой аккаунт/.test(collectText(n))
      );
      assert.ok(switchBtn, "switch account button not found");
      (reloginBtn._listeners.get("click") || [])[0]({ type: "click" });
      (switchBtn._listeners.get("click") || [])[0]({ type: "click" });
      assert.equal(relogin, 1);
      assert.equal(switched, 1);
      const keydown = logoutNode._listeners.get("keydown") || [];
      assert.equal(keydown.length, 1);
      keydown[0]({ key: "Escape", preventDefault() {} });
      assert.equal(closed, 1);

      const recoveredNode = logout.fn("Нет соединения: code=1005", "854-432-319", {
        onClose() {},
        onRelogin() {},
        onUseDifferentAccount() {},
      });
      assert.doesNotMatch(collectText(recoveredNode), /code=1005/);
      assert.match(collectText(recoveredNode), /Сессия завершена на этом устройстве/i);
    });
  } finally {
    await welcome.cleanup();
    await logout.cleanup();
  }
});

test("modal flow polish: CSS and source guards present", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.modal-send-schedule\b/);
  assert.match(css, /\.modal-actions\.modal-actions-compose\b/);
  assert.match(css, /\.modal-screen-status\s+\.screen-sub\b/);
  assert.match(css, /\.auth-session-card\b/);
  assert.match(css, /\.auth-entry-layout\b/);
  assert.match(css, /--auth-entry-shell:/);
  assert.match(css, /--auth-entry-side:/);
  assert.match(css, /--auth-entry-text:/);
  assert.match(css, /--auth-mobile-bg:/);
  assert.match(css, /--auth-mobile-bg-start:/);
  assert.match(css, /--auth-mobile-bg-mid:/);
  assert.match(css, /--auth-mobile-bg-end:/);
  assert.match(css, /--auth-mobile-bottom-bg:\s*#d8eee8;/);
  assert.match(css, /--auth-mobile-panel:/);
  assert.match(css, /--auth-mobile-panel-top:/);
  assert.doesNotMatch(css, /\.auth-layout-logo\b/);
  assert.doesNotMatch(css, /--auth-entry-surface/);
  assert.match(css, /\.auth-entry-hero\b/);
  assert.match(css, /\.auth-hero-brand-block\b/);
  assert.match(css, /\.auth-hero-orb\s*{[^}]*position:\s*relative;/s);
  assert.match(css, /\.auth-hero-wordmark\b/);
  assert.match(css, /\.auth-hero-message\b/);
  assert.match(css, /\.auth-welcome-screen\s+\.screen-brand\s*{[^}]*letter-spacing:\s*0;/s);
  assert.match(css, /\.auth-entry-panel\b/);
  assert.match(css, /\.auth-entry-layout\s*{[^}]*height:\s*clamp\(528px,/s);
  assert.match(css, /\.auth-entry-layout\s*{[^}]*background:\s*var\(--auth-entry-shell\);/s);
  assert.match(css, /\.auth-entry-panel\s*{[^}]*background:\s*var\(--auth-entry-panel-bg\);/s);
  assert.match(css, /\.auth-entry-panel\s+\.btn\.auth-close\s*{[^}]*position:\s*static;/s);
  assert.match(css, /#auth-pages\.auth-entry-page,\s*#auth-pages\.auth-entry-page\s+\*\s*{[^}]*transition:\s*none;/s);
  assert.match(css, /\.auth-panel-heading\s*{[^}]*min-height:\s*76px;/s);
  assert.match(css, /\.auth-entry-panel\s+\.auth-entry-form-fixed\s*{[^}]*grid-template-rows:\s*70px 70px 40px 48px;/s);
  assert.match(css, /\.auth-field-stack\s*{[^}]*min-height:\s*70px;/s);
  assert.match(css, /\.auth-entry-notice-empty\s*{[^}]*visibility:\s*hidden;/s);
  assert.match(css, /\.auth-entry-panel\s+\.auth-entry-notice\s*{[^}]*min-height:\s*44px;[^}]*max-height:\s*44px;/s);
  assert.match(css, /#auth-pages\.auth-entry-page\s+>\s+\.auth-entry-scroll\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.auth-entry-panel\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.overlay\.overlay-auth:not\(\.hidden\)\s*{[^}]*animation:\s*none;/s);
  assert.match(css, /\.modal-screen\s+\.screen-bar\s*{[^}]*display:\s*none;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-hero\s*{[^}]*display:\s*none;/);
  assert.match(css, /\.auth-entry-update-marker\s*{[^}]*position:\s*absolute;[^}]*bottom:\s*14px;[^}]*letter-spacing:\s*0;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*html\.has-auth-pages,\s*body\.has-auth-pages\s*{[^}]*--auth-safe-bottom:\s*max\(10px,\s*var\(--safe-bottom-pad\)\);[^}]*--auth-viewport-min:\s*var\(--app-vh,\s*100dvh\);[^}]*--app-frame-bg:\s*var\(--auth-mobile-screen-bg\);[^}]*background:\s*var\(--auth-mobile-screen-bg\);[^}]*overflow-y:\s*hidden;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*html\.has-auth-pages,\s*body\.has-auth-pages\s*{[^}]*--auth-mobile-canvas-bg:\s*#eaf5f0;[^}]*--app-host-canvas-bg:\s*var\(--auth-mobile-canvas-bg\);[^}]*background-color:\s*var\(--auth-mobile-canvas-bg\);/);
  assert.match(css, /html\.has-auth-pages\s+body\.has-auth-pages\s*{[^}]*--app-host-canvas-bg:\s*var\(--auth-mobile-canvas-bg\);[^}]*background-color:\s*var\(--auth-mobile-canvas-bg\);/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*html\.is-ios\.has-auth-pages\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;/);
  assert.doesNotMatch(css, /html\.is-ios\.has-auth-pages\s*{[^}]*position:\s*static;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*html\.has-auth-pages\s+#app\s*{[^}]*height:\s*var\(--auth-viewport-min\);[^}]*min-height:\s*0;[^}]*background:\s*var\(--auth-mobile-screen-bg\);[^}]*background-color:\s*var\(--auth-mobile-canvas-bg\);[^}]*overflow:\s*hidden;/);
  assert.doesNotMatch(css, /html\.has-auth-pages\s+#app\s*{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*body\.has-auth-pages::after\s*{[^}]*background:\s*var\(--auth-mobile-screen-bg\);/);
  assert.doesNotMatch(css, /body\.has-auth-pages::after\s*{[^}]*display:\s*none;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*#auth-pages\.auth-entry-page::after\s*{[^}]*display:\s*none;/);
  assert.doesNotMatch(css, /#auth-pages\.auth-entry-page::after\s*{[^}]*position:\s*fixed;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.overlay\.overlay-auth\s*{[^}]*place-items:\s*stretch;[^}]*padding:\s*0;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.overlay\.overlay-auth\s*{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*height:\s*100%;[^}]*background:\s*var\(--auth-mobile-screen-bg\);[^}]*overflow:\s*hidden;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.overlay\.overlay-auth:not\(\.hidden\)\s*>\s*\.modal\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*#auth-pages\.auth-entry-page\s+>\s+\.auth-entry-scroll\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;[^}]*align-items:\s*center;[^}]*justify-content:\s*stretch;[^}]*padding:\s*0 18px;[^}]*overflow-y:\s*hidden;[^}]*scroll-padding-bottom:\s*var\(--auth-scroll-bottom-space\);/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-update-marker\s*{[^}]*position:\s*fixed;[^}]*bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\);[^}]*z-index:\s*12;[^}]*transform:\s*translateX\(-50%\);[^}]*margin:\s*0;[^}]*pointer-events:\s*none;/);
  assert.doesNotMatch(css, /--auth-viewport-min:\s*var\(--app-frame-vh/);
  assert.match(css, /html\.kbd-open\.has-auth-pages\s+\.auth-entry-update-marker\s*{[^}]*display:\s*inline-flex;[^}]*opacity:\s*0\.74;/s);
  assert.doesNotMatch(css, /html\.kbd-open\.has-auth-pages\s+\.auth-entry-update-marker\s*{[^}]*display:\s*none;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*#auth-pages\.auth-entry-page\s+\.tabs-tab,\s*#auth-pages\.auth-entry-page\s+\.tabs-tab\.active,\s*#auth-pages\.auth-entry-page\s+\.tabs-tab\s+\.container\s*{[^}]*background:\s*transparent;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-layout\s*{[^}]*flex:\s*1 1 auto;[^}]*height:\s*100%;[^}]*max-height:\s*none;[^}]*min-height:\s*0;[^}]*max-width:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s*{[^}]*height:\s*100%;[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto auto auto auto minmax\(0,\s*1fr\) auto;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s*{[^}]*align-content:\s*start;[^}]*padding:\s*calc\(clamp\(8px,\s*1\.6vh,\s*18px\)\s*\+\s*env\(safe-area-inset-top\)\)\s+0\s+calc\(24px\s*\+\s*var\(--auth-safe-bottom\)\);/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-entry-form-fixed\s*{[^}]*align-self:\s*start;[^}]*margin-top:\s*clamp\(2px,\s*0\.5vh,\s*6px\);/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s*{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;[^}]*background:\s*transparent;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-panel-top,\s*\.modal-auth\s+\.auth-panel-top\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-brand\s*{[^}]*flex-direction:\s*column;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-brand-icon\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.modal-tabs\s*{[^}]*border-radius:\s*18px;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.modal-tabs\s+\.btn\s*{[^}]*background:\s*transparent;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-note\s*{[^}]*max-height:\s*28px;/);
  assert.match(css, /html\.kbd-open\.has-auth-pages\s+\.auth-entry-panel\s*{[^}]*padding:\s*calc\(6px\s*\+\s*env\(safe-area-inset-top\)\)\s+0\s+calc\(10px\s*\+\s*var\(--auth-safe-bottom\)\);[^}]*gap:\s*4px;/s);
  assert.match(css, /html\.kbd-open\.has-auth-pages\s+\.auth-entry-panel\s+\.auth-entry-form-fixed\s*{[^}]*grid-template-rows:\s*52px 52px 40px;[^}]*min-height:\s*156px;[^}]*margin-top:\s*2px;/s);
  assert.match(css, /html\.kbd-open\.has-auth-pages\s+\.auth-entry-panel\s+\.auth-note\s*{[^}]*min-height:\s*0;[^}]*max-height:\s*0;[^}]*opacity:\s*0;/s);
  assert.match(css, /html\.kbd-open\.has-auth-pages\s+\.auth-entry-panel\s+\.modal-input\s*{[^}]*min-height:\s*38px;/s);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.modal-input\s*{[^}]*border-radius:\s*16px;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-entry-notice\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-primary-cta\s*{[^}]*background:\s*linear-gradient\(180deg,\s*var\(--auth-mobile-primary\) 0%,\s*var\(--auth-mobile-primary-strong\) 100%\);/);
  assert.match(css, /#auth-pages\.auth-entry-page\s+\.auth-entry-panel\s+\.btn\.btn-primary\.auth-primary-cta:not\(:disabled\)\s*{[^}]*background:\s*var\(--auth-accent-warm\);/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*#auth-pages\.auth-entry-page\s+\.auth-entry-panel\s+\.btn\.btn-primary\.auth-primary-cta:not\(:disabled\)\s*{[^}]*background:\s*linear-gradient\(180deg,\s*var\(--auth-mobile-primary\) 0%,\s*var\(--auth-mobile-primary-strong\) 100%\);/);
  assert.match(css, /\.auth-entry-panel\s+\.auth-primary-cta:disabled\s*{[^}]*background:\s*#8da1bb;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-primary-cta:disabled\s*{[^}]*background:\s*#94a8ba;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-chip-row\s*{[^}]*display:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-progress-list\s*{[^}]*display:\s*none;/);
  assert.match(css, /\.modal-screen\s+\.screen-chip\b/);
  assert.match(css, /#auth-pages > \.scrollable\s*{[^}]*padding:/s);
  assert.match(css, /#auth-pages \.tabs-tab \.container\s*{[^}]*min-height:\s*0;[^}]*flex:\s*0 0 auto;/s);

  const forwardSrc = await readFile(path.resolve("src/components/modals/renderForwardModal.ts"), "utf8");
  assert.match(forwardSrc, /class:\s*"btn btn-secondary"/);
  assert.match(forwardSrc, /role:\s*"dialog"/);
  assert.match(forwardSrc, /"aria-modal":\s*"true"/);

  const renderAppSrc = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.match(renderAppSrc, /prevSendScheduleAt/);
  assert.match(renderAppSrc, /hadSendScheduleModal/);
  assert.match(renderAppSrc, /state\.modal\?\.kind === "send_schedule"/);
  assert.match(renderAppSrc, /scheduleChromeColorSync/);

  const logoutFeatureSrc = await readFile(path.resolve("src/app/features/auth/logoutFeature.ts"), "utf8");
  assert.match(logoutFeatureSrc, /modal:\s*\{\s*kind:\s*"auth"\s*\}/);
  assert.doesNotMatch(logoutFeatureSrc, /modal:\s*\{\s*kind:\s*"logout"\s*\}/);

  const authSrc = await readFile(path.resolve("src/components/modals/renderAuthModal.ts"), "utf8");
  assert.doesNotMatch(authSrc, /auth-layout-logo/);
  assert.match(authSrc, /auth-hero-brand-block/);
  assert.match(authSrc, /auth-hero-wordmark/);
  assert.match(authSrc, /auth-hero-message/);
  assert.match(authSrc, /AUTH_ENTRY_PANEL_TITLE/);
  assert.match(authSrc, /AUTH_ENTRY_HELPER/);
  assert.match(authSrc, /APP_VERSION/);
  assert.match(authSrc, /auth-entry-update-marker/);
  assert.match(authSrc, /Web \$\{APP_VERSION\}/);
  assert.match(authSrc, /auth-hero-version/);
  assert.match(authSrc, /обновлени\[ея\] веб-клиента/);
  assert.match(authSrc, /auth-entry-notice-empty/);
  assert.match(authSrc, /copy\.heroTitle/);
  assert.match(authSrc, /copy\.heroCopy/);
  assert.doesNotMatch(authSrc, /auth-chip-row/);
  assert.doesNotMatch(authSrc, /auth-progress-card/);
  assert.doesNotMatch(authSrc, /auth-session-card/);

  const chromeColorsSrc = await readFile(path.resolve("src/helpers/ui/chromeColors.ts"), "utf8");
  assert.match(chromeColorsSrc, /AUTH_CHROME_COLOR\s*=\s*"#eaf5f0"/);
  assert.match(chromeColorsSrc, /classList\.contains\("has-auth-pages"\)/);
  assert.match(chromeColorsSrc, /readResolvedCssColor\(style,\s*"--app-host-canvas-bg"\)/);
  assert.match(chromeColorsSrc, /readResolvedCssColor\(style,\s*"--safe-area-bg"\)/);

  const sidebarOverlaySrc = await readFile(path.resolve("src/app/features/sidebar/sidebarOverlayFeature.ts"), "utf8");
  assert.match(sidebarOverlaySrc, /scheduleChromeColorSync/);
  assert.match(sidebarOverlaySrc, /document\.documentElement\.classList\.toggle\("sidebar-mobile-open",\s*shouldOpen\);[\s\S]*scheduleChromeColorSync\(\);/);
});
