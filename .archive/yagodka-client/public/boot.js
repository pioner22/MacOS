(function () {
  var RECOVER_KEY = "yagodka_boot_recover_v1";
  var SOFT_RELOAD_KEY = "yagodka_boot_soft_reload_v1";
  var UPDATING_KEY = "yagodka_updating";
  var FORCE_RECOVER_KEY = "yagodka_force_recover";
  var BOOTED_EVENT = "yagodka:booted";
  var APP_SELECTOR = ".app";
  var LOOP_KEY = "yagodka_boot_loop_v1";
  var LOOP_RESET_MS = 2 * 60 * 1000;
  var LOOP_MAX = 3;
  var LIVE_BUILD_TIMEOUT_MS = 2500;
  var BOOT_RECOVERY_STEP_TIMEOUT_MS = 3500;
  var RECOVERY_CLASS = "boot-recovery";
  var LEGACY_UPDATE_TEXT_RE = /Обновляем приложение[\s\S]{0,240}Сбрасываем старый кэш приложения перед запуском новой версии/i;
  var LEGACY_UPDATE_CLASS_RE = /(?:^|\s)required-update-gate(?:\s|$)/;
  var STALE_BOOT_BUILD_RE = /^(\d+\.\d+\.\d+)(?:-([a-f0-9]{12}))?$/i;

  var statusEl = document.getElementById("boot-status");
  var versionEl = document.getElementById("boot-version");
  var root = document.getElementById("app");
  var booted = false;
  var requiresBootEvent = false;
  var loopBlocked = false;

  function setStatus(text) {
    try {
      if (statusEl) statusEl.textContent = text;
    } catch {}
  }

  function createRecoveryElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function readVersionText() {
    try {
      var fromText = versionEl && versionEl.textContent ? String(versionEl.textContent).trim() : "";
      if (fromText) return fromText;
      var fromData = versionEl && versionEl.getAttribute ? String(versionEl.getAttribute("data-build-version") || "").trim() : "";
      if (fromData) return "Web " + fromData;
      var meta = document.querySelector('meta[name="yagodka-build-id"]');
      var fromMeta = meta && meta.getAttribute ? String(meta.getAttribute("content") || "").trim() : "";
      if (fromMeta) return "Web " + fromMeta;
    } catch {}
    return "";
  }

  function readCurrentBuildId() {
    try {
      var meta = document.querySelector('meta[name="yagodka-build-id"]');
      var fromMeta = meta && meta.getAttribute ? String(meta.getAttribute("content") || "").trim() : "";
      if (fromMeta) return fromMeta;
      var fromData = versionEl && versionEl.getAttribute ? String(versionEl.getAttribute("data-build-version") || "").trim() : "";
      if (fromData) return fromData;
      var fromText = versionEl && versionEl.textContent ? String(versionEl.textContent).trim() : "";
      var match = fromText.match(/\b(\d+\.\d+\.\d+(?:-[a-f0-9]{12})?)\b/i);
      return match ? String(match[1] || "").trim() : "";
    } catch {
      return "";
    }
  }

  function splitBuildId(id) {
    var raw = String(id || "").trim();
    var match = raw.match(STALE_BOOT_BUILD_RE);
    if (!match) return { version: "", build: "" };
    return { version: String(match[1] || "").trim(), build: String(match[2] || "").trim().toLowerCase() };
  }

  function isStaleBuild(currentId, liveId) {
    var current = splitBuildId(currentId);
    var live = splitBuildId(liveId);
    if (!current.version || !live.version) return false;
    if (current.version !== live.version) return true;
    if (current.build && live.build && current.build !== live.build) return true;
    return false;
  }

  async function fetchLiveBuildId() {
    if (typeof fetch !== "function") return "";
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = window.setTimeout(function () {
        try {
          controller.abort();
        } catch {}
      }, LIVE_BUILD_TIMEOUT_MS);
    }
    try {
      var opts = { cache: "no-store" };
      if (controller) opts.signal = controller.signal;
      var res = await fetch("./sw.js?boot_ts=" + Date.now(), opts);
      if (!res || !res.ok) return "";
      var text = await res.text();
      var match = String(text || "").match(/\bBUILD_ID\s*=\s*["']([^"']+)["']/);
      return match ? String(match[1] || "").trim() : "";
    } catch {
      return "";
    } finally {
      if (timer !== null) {
        try {
          window.clearTimeout(timer);
        } catch {}
      }
    }
  }

  async function withTimeout(promise, timeoutMs, fallback) {
    var timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise(function (resolve) {
          timer = window.setTimeout(function () {
            resolve(fallback);
          }, Math.max(0, timeoutMs || 0));
        }),
      ]);
    } catch {
      return fallback;
    } finally {
      if (timer !== null) {
        try {
          window.clearTimeout(timer);
        } catch {}
      }
    }
  }

  async function unregisterServiceWorkersBounded() {
    try {
      if (!("serviceWorker" in navigator)) return;
      var regs = await withTimeout(navigator.serviceWorker.getRegistrations(), BOOT_RECOVERY_STEP_TIMEOUT_MS, []);
      await withTimeout(
        Promise.all(
          (regs || []).map(function (r) {
            return withTimeout(r.unregister(), 1200, false);
          })
        ),
        BOOT_RECOVERY_STEP_TIMEOUT_MS,
        []
      );
    } catch {}
  }

  async function clearYagodkaCachesBounded() {
    try {
      if (!("caches" in window)) return;
      var keys = await withTimeout(caches.keys(), BOOT_RECOVERY_STEP_TIMEOUT_MS, []);
      var dels = (keys || [])
        .filter(function (k) {
          return String(k || "").indexOf("yagodka-") === 0;
        })
        .map(function (k) {
          return withTimeout(caches.delete(k), 1200, false);
        });
      await withTimeout(Promise.all(dels), BOOT_RECOVERY_STEP_TIMEOUT_MS, []);
    } catch {}
  }

  function cleanUrl(paramName) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete("__yg_update");
      url.searchParams.delete("__pwa_reset");
      url.searchParams.delete("__yg_continue");
      url.searchParams.delete("__boot_recover");
      if (paramName) url.searchParams.set(paramName, String(Date.now()));
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  function navigateClean(paramName) {
    var url = cleanUrl(paramName);
    try {
      window.location.replace(url);
      return;
    } catch {}
    try {
      window.location.href = url;
    } catch {}
  }

  function renderRecoveryScreen() {
    if (!root) return;
    var versionText = readVersionText();
    try {
      var main = createRecoveryElement("main", RECOVERY_CLASS);
      main.setAttribute("role", "status");
      main.setAttribute("aria-live", "polite");

      var mark = createRecoveryElement("div", "boot-recovery__mark", "!");
      mark.setAttribute("aria-hidden", "true");
      main.appendChild(mark);
      main.appendChild(createRecoveryElement("h1", "boot-recovery__title", "Не удалось завершить обновление"));
      main.appendChild(
        createRecoveryElement(
          "p",
          "boot-recovery__text",
          "Автоматический перезапуск остановлен. Откройте приложение сейчас или повторите очистку кэша."
        )
      );
      if (versionText) main.appendChild(createRecoveryElement("p", "boot-recovery__version", versionText));

      var actions = createRecoveryElement("div", "boot-recovery__actions");
      var openButton = createRecoveryElement("button", "boot-recovery__button boot-recovery__button--primary", "Открыть приложение");
      openButton.setAttribute("type", "button");
      openButton.setAttribute("data-boot-action", "open");
      actions.appendChild(openButton);
      var retryButton = createRecoveryElement("button", "boot-recovery__button", "Повторить обновление");
      retryButton.setAttribute("type", "button");
      retryButton.setAttribute("data-boot-action", "retry");
      actions.appendChild(retryButton);
      main.appendChild(actions);

      root.textContent = "";
      root.appendChild(main);
      var style = document.createElement("style");
      style.textContent =
        "html,body,#app{background:#f7fafc!important;background-color:#f7fafc!important}" +
        ".boot-recovery{box-sizing:border-box;min-height:100%;min-height:100dvh;display:grid;align-content:center;justify-content:center;gap:14px;padding:28px;color:#14211b;background:linear-gradient(180deg,#fff,#eef6f2),#f7fafc;font:600 16px/1.35 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}" +
        ".boot-recovery__mark{display:grid;place-items:center;width:48px;height:48px;border-radius:999px;background:#b4232d;color:#fff;font-size:26px;font-weight:900;box-shadow:0 0 0 6px rgba(180,35,45,.14)}" +
        ".boot-recovery__title{width:min(440px,calc(100vw - 56px));margin:0;color:#14211b;font-size:24px;line-height:1.18;font-weight:850;letter-spacing:0}" +
        ".boot-recovery__text{width:min(440px,calc(100vw - 56px));margin:0;color:#44534d;font-size:15px;line-height:1.45;font-weight:600}" +
        ".boot-recovery__version{width:min(440px,calc(100vw - 56px));margin:0;color:#5e6f68;font-size:12px;line-height:1.35;font-weight:800}" +
        ".boot-recovery__actions{width:min(440px,calc(100vw - 56px));display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}" +
        ".boot-recovery__button{min-height:46px;border:1px solid #b9c8c1;border-radius:14px;background:#fff;color:#14211b;padding:0 16px;font:800 15px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}" +
        ".boot-recovery__button--primary{border-color:#1877f2;background:#1877f2;color:#fff}";
      document.head && document.head.appendChild(style);
      root.addEventListener(
        "click",
        function (ev) {
          var target = ev && ev.target;
          var action = target && target.getAttribute ? target.getAttribute("data-boot-action") : "";
          if (action === "open") {
            clearBootFlags();
            navigateClean("__boot_recover");
          }
          if (action === "retry") {
            try {
              sessionStorage.removeItem(RECOVER_KEY);
              localStorage.removeItem(LOOP_KEY);
            } catch {}
            void recover(true);
          }
        },
        { once: false }
      );
    } catch {
      setStatus("Не удалось завершить обновление. Откройте приложение или повторите обновление.");
    }
  }

  function hasBooted() {
    if (requiresBootEvent) return booted;
    try {
      return Boolean(document.querySelector(APP_SELECTOR));
    } catch {
      return false;
    }
  }

  function legacyUpdateGateVisible() {
    try {
      if (hasBooted()) return false;
      var text = document.body && document.body.textContent ? String(document.body.textContent) : "";
      if (LEGACY_UPDATE_TEXT_RE.test(text)) return true;
      var gate = document.querySelector(".required-update-gate");
      if (!gate) return false;
      var className = String(gate.className || "");
      var gateText = gate.textContent ? String(gate.textContent) : "";
      return LEGACY_UPDATE_CLASS_RE.test(className) && /Сбрасываем старый кэш приложения/i.test(gateText);
    } catch {
      return false;
    }
  }

  function recoverLegacyUpdateGate() {
    if (legacyUpdateGateVisible()) {
      requiresBootEvent = true;
      setStatus("Восстанавливаем запуск…");
      void recover(true);
      return true;
    }
    return false;
  }

  function clearBootFlags() {
    try {
      sessionStorage.removeItem(UPDATING_KEY);
      sessionStorage.removeItem(RECOVER_KEY);
      sessionStorage.removeItem(SOFT_RELOAD_KEY);
      sessionStorage.removeItem(FORCE_RECOVER_KEY);
      localStorage.removeItem(LOOP_KEY);
    } catch {}
  }

  function readLoopState() {
    try {
      var raw = localStorage.getItem(LOOP_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      var count = Number(parsed.count || 0);
      var ts = Number(parsed.ts || 0);
      if (!count || !ts) return null;
      return { count: count, ts: ts };
    } catch {
      return null;
    }
  }

  function bumpLoopState() {
    var now = Date.now();
    var prev = readLoopState();
    var base = prev && now - prev.ts <= LOOP_RESET_MS ? prev.count : 0;
    var next = { count: base + 1, ts: now };
    try {
      localStorage.setItem(LOOP_KEY, JSON.stringify(next));
    } catch {}
    return next;
  }

  function allowReload() {
    if (loopBlocked) return false;
    var now = Date.now();
    var prev = readLoopState();
    if (prev && now - prev.ts <= LOOP_RESET_MS && prev.count >= LOOP_MAX) {
      loopBlocked = true;
      clearBootFlags();
      setStatus("Слишком много перезапусков. Обновите страницу или переустановите приложение.");
      renderRecoveryScreen();
      return false;
    }
    bumpLoopState();
    return true;
  }

  async function recover(force) {
    if (hasBooted()) return;
    var alreadyTried = false;
    try {
      alreadyTried = sessionStorage.getItem(RECOVER_KEY) === "1";
    } catch {}

    if (alreadyTried && !force) {
      setStatus("Не удалось запустить приложение. Обновите страницу или перезапустите приложение.");
      renderRecoveryScreen();
      return;
    }

    try {
      sessionStorage.setItem(RECOVER_KEY, "1");
    } catch {}

    setStatus("Восстановление обновления…");

    await unregisterServiceWorkersBounded();
    await clearYagodkaCachesBounded();

    if (!allowReload()) return;
    navigateClean("__boot_recover");
  }

  async function recoverStaleBootBuild() {
    var currentBuildId = readCurrentBuildId();
    if (!currentBuildId) return false;
    var liveBuildId = await fetchLiveBuildId();
    if (!isStaleBuild(currentBuildId, liveBuildId)) return false;
    requiresBootEvent = true;
    setStatus("Обновляем Web " + liveBuildId + "…");
    try {
      sessionStorage.setItem(UPDATING_KEY, "1");
    } catch {}
    try {
      localStorage.removeItem("yagodka_active_build_id_v1");
    } catch {}
    await unregisterServiceWorkersBounded();
    await clearYagodkaCachesBounded();
    if (!allowReload()) return true;
    navigateClean("__boot_recover");
    return true;
  }

  try {
    var force = sessionStorage.getItem(FORCE_RECOVER_KEY) === "1";
    var updating = sessionStorage.getItem(UPDATING_KEY) === "1";
    requiresBootEvent = force || updating;
    if (force) setStatus("Перезапуск…");
    else if (updating) setStatus("Обновление…");
  } catch {}

  window.addEventListener(
    BOOTED_EVENT,
    function () {
      booted = true;
      clearBootFlags();
    },
    { once: true }
  );

  try {
    if (sessionStorage.getItem(FORCE_RECOVER_KEY) === "1") {
      void recover();
      return;
    }
  } catch {}

  void recoverStaleBootBuild();

  if (root && "MutationObserver" in window) {
    var mo = new MutationObserver(function () {
      if (recoverLegacyUpdateGate()) {
        mo.disconnect();
        return;
      }
      if (!hasBooted()) return;
      mo.disconnect();
      clearBootFlags();
    });
    try {
      mo.observe(root, { childList: true, subtree: true });
    } catch {}
  }

  window.addEventListener(
    "error",
    function (ev) {
      var t = ev && ev.target;
      if (!t || !t.tagName) return;
      if (String(t.tagName).toUpperCase() !== "SCRIPT") return;
      void recover();
    },
    true
  );

  window.setTimeout(function () {
    recoverLegacyUpdateGate();
  }, 1200);

  window.setTimeout(function () {
    if (hasBooted()) return;
    // iOS PWA иногда показывает "чёрный экран" после обновления, но ручной Ctrl+R/перезапуск помогает.
    // Поэтому при update/force сначала делаем мягкий reload один раз, и только затем — тяжёлый recover.
    if (requiresBootEvent) {
      try {
        if (sessionStorage.getItem(SOFT_RELOAD_KEY) !== "1") {
          if (!allowReload()) return;
          sessionStorage.setItem(SOFT_RELOAD_KEY, "1");
          setStatus("Перезапуск…");
          window.location.reload();
          return;
        }
      } catch {}
    }
    void recover();
  }, 7000);
})();
