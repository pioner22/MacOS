import { el } from "../dom/el";
import { APP_VERSION } from "../../config/app";

type DebugHudState = {
  enabled: boolean;
  mounted: boolean;
  rafId: number | null;
  intervalId: number | null;
  logs: string[];
};

function parseBoolish(value: string | null): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function shouldEnableFromLocation(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("debug")) return parseBoolish(sp.get("debug"));
  } catch {
    // ignore
  }
  return false;
}

function shouldEnableFromStorage(): boolean {
  try {
    return parseBoolish(window.localStorage?.getItem("yagodka_debug"));
  } catch {
    return false;
  }
}

function setStorageEnabled(enabled: boolean): void {
  try {
    if (!window.localStorage) return;
    if (enabled) window.localStorage.setItem("yagodka_debug", "1");
    else window.localStorage.removeItem("yagodka_debug");
  } catch {
    // ignore
  }
}

function ts(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function readCssVar(name: string): string {
  try {
    const docEl = document.documentElement;
    const raw = window.getComputedStyle(docEl).getPropertyValue(name);
    const v = String(raw || "").trim();
    return v || "∅";
  } catch {
    return "∅";
  }
}

function fmtNum(n: unknown): string {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "∅";
  const s = Math.abs(num) >= 1000 ? String(Math.round(num)) : String(+num.toFixed(2));
  return s;
}

export type DebugHudDeps = {
  mount: HTMLElement;
  chatHost: HTMLElement;
  getState: () => any;
};

export type DebugHudApi = {
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean, opts?: { persist?: boolean }) => void;
  toggle: () => void;
  log: (msg: string) => void;
};

export function installDebugHud(deps: DebugHudDeps): DebugHudApi {
  const state: DebugHudState = {
    enabled: shouldEnableFromLocation() || shouldEnableFromStorage(),
    mounted: false,
    rafId: null,
    intervalId: null,
    logs: [],
  };

  const hud = el("div", { class: "debug-hud hidden", role: "region", "aria-label": "Debug HUD" });
  const head = el("div", { class: "debug-hud-head" }, [`DBG ${APP_VERSION}`]);
  const closeBtn = el("button", { class: "btn debug-hud-close", type: "button", "aria-label": "Close debug" }, ["×"]);
  head.appendChild(closeBtn);
  const body = el("pre", { class: "debug-hud-body" }, [""]);
  hud.appendChild(head);
  hud.appendChild(body);

  const pushLog = (msg: string) => {
    const line = `${ts()} ${String(msg || "").trim()}`.trim();
    if (!line) return;
    state.logs.push(line);
    if (state.logs.length > 24) state.logs.splice(0, state.logs.length - 24);
  };

  const render = () => {
    state.rafId = null;
    if (!state.enabled) return;
    const vv = window.visualViewport;
    const st = deps.getState?.();
    const selected = st?.selected ? `${st.selected.kind}:${st.selected.id}` : "∅";
    const key = String(deps.chatHost.getAttribute("data-chat-key") || "") || "∅";
    const lines: string[] = [];
    lines.push(`page=${String(st?.page || "∅")} modal=${String(st?.modal?.kind || "∅")} conn=${String(st?.conn || "∅")}`);
    lines.push(`selected=${selected} chatKey=${key}`);
    lines.push(
      `vv.h=${fmtNum(vv?.height)} vv.top=${fmtNum((vv as any)?.offsetTop)} vv.scale=${fmtNum(vv?.scale)} innerH=${fmtNum(window.innerHeight)} clientH=${fmtNum(document.documentElement?.clientHeight)}`
    );
    lines.push(`screen.h=${fmtNum((window as any).screen?.height)} outerH=${fmtNum((window as any).outerHeight)} availH=${fmtNum((window as any).screen?.availHeight)}`);
    lines.push(
      `vars: --vh=${readCssVar("--vh")} --app-vh=${readCssVar("--app-vh")} --gap=${readCssVar("--app-gap-bottom")} --safeRaw=${readCssVar("--safe-bottom-raw")} --safePad=${readCssVar("--safe-bottom-pad")}`
    );
    lines.push(
      `chat: top=${fmtNum(deps.chatHost.scrollTop)} h=${fmtNum(deps.chatHost.clientHeight)} sh=${fmtNum(deps.chatHost.scrollHeight)}`
    );
    if (state.logs.length) {
      lines.push("");
      lines.push("events:");
      lines.push(...state.logs.slice(-10));
    }
    body.textContent = lines.join("\n");
  };

  const scheduleRender = (reason?: string) => {
    if (!state.enabled) return;
    if (reason) pushLog(reason);
    if (state.rafId !== null) return;
    state.rafId = window.requestAnimationFrame(render);
  };

  const start = () => {
    if (state.mounted) return;
    state.mounted = true;
    deps.mount.appendChild(hud);
    hud.classList.remove("hidden");
    pushLog("enabled");

    const vv = window.visualViewport;
    const onWinResize = () => scheduleRender("window.resize");
    const onOrient = () => scheduleRender("orientationchange");
    const onFocusIn = () => scheduleRender("focusin");
    const onFocusOut = () => scheduleRender("focusout");
    const onVvResize = () => scheduleRender("vv.resize");
    const onVvScroll = () => scheduleRender("vv.scroll");
    const onChatScroll = () => scheduleRender("chat.scroll");

    window.addEventListener("resize", onWinResize, { passive: true });
    window.addEventListener("orientationchange", onOrient, { passive: true });
    document.addEventListener("focusin", onFocusIn, { passive: true });
    document.addEventListener("focusout", onFocusOut, { passive: true });
    vv?.addEventListener("resize", onVvResize, { passive: true });
    vv?.addEventListener("scroll", onVvScroll, { passive: true });
    deps.chatHost.addEventListener("scroll", onChatScroll, { passive: true });

    state.intervalId = window.setInterval(() => scheduleRender(), 900);

    closeBtn.addEventListener("click", () => {
      api.setEnabled(false, { persist: true });
    });

    scheduleRender("render");

    apiCleanup = () => {
      window.removeEventListener("resize", onWinResize);
      window.removeEventListener("orientationchange", onOrient);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", onVvResize);
      vv?.removeEventListener("scroll", onVvScroll);
      deps.chatHost.removeEventListener("scroll", onChatScroll);
    };
  };

  let apiCleanup: (() => void) | null = null;

  const stop = () => {
    if (!state.mounted) return;
    state.mounted = false;
    if (state.rafId !== null) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    if (state.intervalId !== null) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
    apiCleanup?.();
    apiCleanup = null;
    hud.remove();
    state.logs = [];
  };

  const api: DebugHudApi = {
    isEnabled: () => state.enabled,
    setEnabled: (enabled: boolean, opts?: { persist?: boolean }) => {
      const next = Boolean(enabled);
      if (state.enabled === next) return;
      state.enabled = next;
      if (opts?.persist) setStorageEnabled(next);
      if (state.enabled) start();
      else stop();
    },
    toggle: () => {
      api.setEnabled(!state.enabled, { persist: true });
    },
    log: (msg: string) => scheduleRender(String(msg || "").trim()),
  };

  if (state.enabled) start();

  try {
    (window as any).__yagodka_debug_hud = api;
  } catch {
    // ignore
  }

  return api;
}

