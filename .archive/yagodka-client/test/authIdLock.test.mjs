import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderAuthModal() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderAuthModal.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderAuthModal !== "function") throw new Error("renderAuthModal export missing");
    return { renderAuthModal: mod.renderAuthModal, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
    addEventListener(type, handler) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      list.push(handler);
      this._listeners.set(key, list);
    }
    dispatchEvent(event) {
      const ev = event || {};
      const key = String(ev.type || "");
      const list = this._listeners.get(key) || [];
      for (const h of list) h(ev);
      return true;
    }
    focus() {}
    select() {}
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
      this.type = "text";
      this.value = "";
    }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (String(name).toLowerCase() === "type") this.type = String(value);
      if (String(name).toLowerCase() === "value") this.value = String(value);
    }
  }

  class HTMLTextAreaElementStub extends HTMLElementStub {
    constructor() {
      super("textarea");
      this.value = "";
    }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (String(name).toLowerCase() === "value") this.value = String(value);
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

function hasClass(node, name) {
  return typeof node?.className === "string" && String(node.className).split(/\s+/).includes(name);
}

test("renderAuthModal: rememberedId не блокирует поле ID и показывает кнопку «Сменить ID»", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "login",
        "854-432-319",
        undefined,
        [
          { id: "showcase", title: "Showcase" },
          { id: "telegram-web", title: "Telegram Web" },
        ],
        "showcase",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const idInput = findFirst(modal, (n) => typeof n?.getAttribute === "function" && n.getAttribute("id") === "auth-id");
      assert.ok(idInput, "auth-id input not found");
      assert.equal(idInput.hasAttribute("readonly"), false);
      assert.equal(idInput.getAttribute("data-fancy-caret"), "off");

      const editBtn = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("field-action-edit")
      );
      assert.ok(editBtn, "field-action-edit button not found");

      const lockWrap = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-id-edit")
      );
      assert.ok(lockWrap, "auth-id-edit wrapper not found");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: modern entry shell keeps hero and focused auth panel", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "register",
        null,
        undefined,
        [{ id: "telegram-exact", title: "Telegram (точный)" }],
        "telegram-exact",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      assert.ok(
        findFirst(modal, (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-entry-layout")),
        "auth-entry-layout not found"
      );
      assert.ok(
        findFirst(modal, (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-entry-hero")),
        "auth-entry-hero not found"
      );
      assert.ok(
        findFirst(modal, (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-entry-panel")),
        "auth-entry-panel not found"
      );
      assert.match(collectText(modal), /Вход в Ягодку/);
      assert.match(collectText(modal), /Введите данные аккаунта или создайте новый профиль/);
      assert.doesNotMatch(collectText(modal), /сервер|версия клиента|сессия|устройство/i);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: login/register keep a stable corporate heading and reserved notice slot", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const actions = {
        onLogin: () => {},
        onRegister: () => {},
        onModeChange: () => {},
        onUseDifferentAccount: () => {},
        onSkinChange: () => {},
        onClose: () => {},
      };
      const skins = [{ id: "telegram-exact", title: "Telegram (точный)" }];
      const login = helper.renderAuthModal("login", null, undefined, skins, "telegram-exact", actions);
      const register = helper.renderAuthModal("register", null, undefined, skins, "telegram-exact", actions);
      const loginTitle = findFirst(login, (n) => hasClass(n, "auth-subtitle"));
      const registerTitle = findFirst(register, (n) => hasClass(n, "auth-subtitle"));
      assert.equal(collectText(loginTitle), "Вход в Ягодку");
      assert.equal(collectText(registerTitle), "Вход в Ягодку");

      const loginNote = findFirst(login, (n) => hasClass(n, "auth-note"));
      const registerNote = findFirst(register, (n) => hasClass(n, "auth-note"));
      assert.equal(collectText(loginNote), "Введите данные аккаунта или создайте новый профиль.");
      assert.equal(collectText(registerNote), "Введите данные аккаунта или создайте новый профиль.");

      const loginNotice = findFirst(login, (n) => hasClass(n, "auth-entry-notice"));
      const registerNotice = findFirst(register, (n) => hasClass(n, "auth-entry-notice"));
      assert.ok(loginNotice, "login notice slot not found");
      assert.ok(registerNotice, "register notice slot not found");
      assert.ok(hasClass(loginNotice, "auth-entry-notice-empty"));
      assert.ok(hasClass(registerNotice, "auth-entry-notice-empty"));

      const failed = helper.renderAuthModal("login", null, "Введите ручной ключ", skins, "telegram-exact", actions);
      const failedNotice = findFirst(failed, (n) => hasClass(n, "auth-entry-notice"));
      assert.equal(collectText(failedNotice), "Введите ручной ключ");
      assert.equal(hasClass(failedNotice, "auth-entry-notice-empty"), false);

      const loginForm = findFirst(login, (n) => hasClass(n, "auth-entry-form-fixed"));
      const registerForm = findFirst(register, (n) => hasClass(n, "auth-entry-form-fixed"));
      assert.ok(loginForm, "login fixed form not found");
      assert.ok(registerForm, "register fixed form not found");
      assert.equal((loginForm._children || []).filter(Boolean).length, (registerForm._children || []).filter(Boolean).length);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: auto-resume screen keeps manual and different-account actions", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      let manual = 0;
      let switched = 0;
      const modal = helper.renderAuthModal(
        "auto",
        "854-432-319",
        undefined,
        "Пробуем восстановить сохранённую сессию…",
        "connected",
        [{ id: "telegram-exact", title: "Telegram (точный)" }],
        "telegram-exact",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {
            manual += 1;
          },
          onUseDifferentAccount: () => {
            switched += 1;
          },
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      assert.match(collectText(modal), /Вход в Ягодку/);
      assert.doesNotMatch(collectText(modal), /Автовход|Подключение|Сессия|Готовим защищённый канал/i);
      const manualBtn = findFirst(
        modal,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Ввести ключ/.test(collectText(n))
      );
      const switchBtn = findFirst(
        modal,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Другой аккаунт/.test(collectText(n))
      );
      assert.ok(manualBtn, "manual login button not found");
      assert.ok(switchBtn, "different-account button not found");
      (manualBtn._listeners.get("click") || [])[0]({ type: "click" });
      (switchBtn._listeners.get("click") || [])[0]({ type: "click" });
      assert.equal(manual, 1);
      assert.equal(switched, 1);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: без rememberedId поле ID остаётся редактируемым", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "login",
        null,
        undefined,
        [{ id: "showcase", title: "Showcase" }],
        "showcase",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const idInput = findFirst(modal, (n) => typeof n?.getAttribute === "function" && n.getAttribute("id") === "auth-id");
      assert.ok(idInput, "auth-id input not found");
      assert.equal(idInput.hasAttribute("readonly"), false);

      const lockWrap = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-id-edit")
      );
      assert.equal(lockWrap, null, "auth-id-edit wrapper must not be rendered without rememberedId");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: rememberedId остаётся в статичной форме без quick-login карточки", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "login",
        "854-432-319",
        undefined,
        [{ id: "showcase", title: "Showcase" }],
        "showcase",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const sessionCard = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-session-card")
      );
      assert.equal(sessionCard, null, "quick-login card must not resize the auth surface");

      const hiddenManual = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-manual-id-hidden")
      );
      assert.equal(hiddenManual, null, "manual ID block must stay visible and stable");

      const idInput = findFirst(modal, (n) => typeof n?.getAttribute === "function" && n.getAttribute("id") === "auth-id");
      assert.equal(idInput?.getAttribute("value"), "854-432-319");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: quick-login сохраняет primary CTA и убирает theme picker из основного потока", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "login",
        "854-432-319",
        undefined,
        [{ id: "telegram-exact", title: "Telegram (точный)" }],
        "telegram-exact",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const primaryBtn = findFirst(
        modal,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Войти/.test(collectText(n))
      );
      assert.ok(primaryBtn, "primary login button not found");

      const skinLabel = findFirst(
        modal,
        (n) => typeof n?.tagName === "string" && n.tagName === "LABEL" && /Скин \(тема\)/.test(collectText(n))
      );
      assert.equal(skinLabel, null, "theme picker should not be rendered in quick-login mode");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: primary CTA sends login via direct click fallback", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      let loginCalls = 0;
      const modal = helper.renderAuthModal(
        "login",
        "854-432-319",
        undefined,
        [{ id: "telegram-exact", title: "Telegram (точный)" }],
        "telegram-exact",
        {
          onLogin: () => {
            loginCalls += 1;
          },
          onRegister: () => {},
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const primaryBtn = findFirst(
        modal,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Войти/.test(collectText(n))
      );
      assert.ok(primaryBtn, "primary login button not found");
      const clicks = primaryBtn._listeners.get("click") || [];
      assert.equal(clicks.length, 1, "primary login button must have a click fallback");
      let prevented = false;
      clicks[0]({
        type: "click",
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
      assert.equal(loginCalls, 1);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: manual access-code input avoids browser credential form semantics", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "login",
        "854-432-319",
        undefined,
        [{ id: "telegram-exact", title: "Telegram (точный)" }],
        "telegram-exact",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const keyInput = findFirst(modal, (n) => typeof n?.getAttribute === "function" && n.getAttribute("id") === "auth-manual-entry");
      assert.ok(keyInput, "manual key input not found");
      assert.equal(keyInput.getAttribute("type"), "text");
      assert.equal(keyInput.getAttribute("autocomplete"), "one-time-code");
      assert.equal(keyInput.getAttribute("data-manual-mask"), "1");
      assert.equal(keyInput.getAttribute("data-lpignore"), "true");
      assert.equal(keyInput.getAttribute("data-1p-ignore"), "true");
      assert.equal(keyInput.getAttribute("data-credentialless"), "true");
      assert.equal(keyInput.getAttribute("data-credential-field"), "false");
      assert.equal(keyInput.getAttribute("data-autofill-suppressed"), "1");
      assert.equal(keyInput.getAttribute("autofill"), "off");
      assert.equal(keyInput.getAttribute("name"), "manual-field");
      assert.equal(keyInput.getAttribute("readonly"), "true");
      assert.equal(keyInput.getAttribute("data-manual-entry-ready"), "0");
      assert.equal(findFirst(modal, (n) => typeof n?.getAttribute === "function" && /pw|pass|secret|password|code/i.test(String(n.getAttribute("id") || ""))), null);
      assert.equal(findFirst(modal, (n) => typeof n?.getAttribute === "function" && /pw|pass|secret|password|code/i.test(String(n.getAttribute("name") || ""))), null);
      assert.equal(findFirst(modal, (n) => /Код доступа|Повторите код/.test(collectText(n))), null);
      assert.equal(findFirst(modal, (n) => typeof n?.tagName === "string" && n.tagName === "FORM"), null);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: manual code visibility never switches input to browser password type", async () => {
  const src = await readFile(path.resolve("src/components/modals/renderAuthModal.ts"), "utf8");

  assert.match(src, /wrapWithCodeVisibilityToggle/);
  assert.doesNotMatch(src, /wrapWithPasswordToggle/);
  assert.doesNotMatch(src, /type\s*=\s*[^;\n]*["']password["']/);
  assert.doesNotMatch(src, /toLowerCase\(\)\s*===\s*["']password["']/);
});

test("renderAuthModal: primary CTA sends register via direct click fallback", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      let registerCalls = 0;
      const modal = helper.renderAuthModal(
        "register",
        null,
        undefined,
        [{ id: "telegram-exact", title: "Telegram (точный)" }],
        "telegram-exact",
        {
          onLogin: () => {},
          onRegister: () => {
            registerCalls += 1;
          },
          onModeChange: () => {},
          onUseDifferentAccount: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const primaryBtn = findFirst(
        modal,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Зарегистрироваться/.test(collectText(n))
      );
      assert.ok(primaryBtn, "primary register button not found");
      const clicks = primaryBtn._listeners.get("click") || [];
      assert.equal(clicks.length, 1, "primary register button must have a click fallback");
      let prevented = false;
      clicks[0]({
        type: "click",
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
      assert.equal(registerCalls, 1);
    });
  } finally {
    await helper.cleanup();
  }
});
