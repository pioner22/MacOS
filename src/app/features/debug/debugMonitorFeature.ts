import type { GatewayTransport } from "../../../lib/net/gatewayClient";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { conversationKey } from "../../../helpers/chat/conversationKey";
import { el } from "../../../helpers/dom/el";
import { buildClientInfoTags } from "../../../helpers/device/clientTags";
import { getFileCacheStats, listFileCacheEntries } from "../../../helpers/files/fileBlobCache";
import { loadFileCachePrefs } from "../../../helpers/files/fileCachePrefs";

type DebugEntry = {
  ts: number;
  kind: string;
  data?: any;
};

type DebugHudLike = {
  isEnabled: () => boolean;
  log?: (msg: string) => void;
  setEnabled?: (enabled: boolean, opts?: { persist?: boolean }) => void;
  toggle?: () => void;
};

type DebugMonitorFeatureDeps = {
  store: Store<AppState>;
  gateway: GatewayTransport;
  mount: HTMLElement;
  chatHost: HTMLElement;
  debugHud?: DebugHudLike;
};

type DebugMonitorFeature = {
  dispose: () => void;
};

type DebugReportConfig = {
  endpoint: string;
  eventEndpoint: string;
  token: string;
  eventToken: string;
  enabled: boolean;
  intervalMs: number;
  autoUpload: boolean;
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

function parseReportInterval(raw: string | null): number {
  const ms = Math.round(Number(raw));
  if (!Number.isFinite(ms) || ms <= 0) return 90_000;
  return Math.max(10_000, Math.min(300_000, ms));
}

function deriveDebugEventEndpoint(baseUrl: string): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw, window.location.href);
    if (/\/client\/report\/?$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/client\/report\/?$/, "/client/event");
      return u.toString();
    }
    return `${u.origin}${u.pathname.replace(/\/?$/, "/")}client/event`;
  } catch {
    return `${raw.replace(/\/?$/, "/")}client/event`;
  }
}

function resolveHttpUrl(raw: string): string {
  const val = String(raw || "").trim();
  if (!val) return "";
  try {
    const u = new URL(val, window.location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

function readDebugReportConfig(): DebugReportConfig {
  let endpoint = "";
  let eventEndpoint = "";
  let token = "";
  let eventToken = "";
  let enabled = false;
  let intervalMs = 90_000;
  let autoUpload = true;
  let queryEnabled: string | null = null;
  let persist = false;
  try {
    const sp = new URLSearchParams(window.location.search);
    const queryEndpoint = sp.get("debug_report_url") || sp.get("dbg_report_url");
    const queryEventEndpoint = sp.get("debug_event_url") || sp.get("dbg_event_url");
    queryEnabled = sp.get("debug_report_upload");
    const queryEventUpload = sp.get("debug_event_upload");
    const queryInterval = sp.get("debug_report_interval");
    persist = parseBoolish(sp.get("debug_persist") || sp.get("dbg_persist") || sp.get("debug_report_persist") || sp.get("dbg_report_persist"));
    if (queryEndpoint) endpoint = queryEndpoint.trim();
    if (queryEventEndpoint) eventEndpoint = queryEventEndpoint.trim();
    if (queryEnabled !== null) autoUpload = parseBoolish(queryEnabled);
    if (queryEventUpload !== null) autoUpload = parseBoolish(queryEventUpload);
    intervalMs = parseReportInterval(queryInterval);
    enabled = parseBoolish(sp.get("debug_report"));
  } catch {
    // ignore
  }
  try {
    const globalToken = String((window as any).__YAGODKA_DEBUG_TOKEN__ || "").trim();
    const globalEventToken = String((window as any).__YAGODKA_DEBUG_EVENT_TOKEN__ || "").trim();
    if (!token && globalToken) token = globalToken;
    if (!eventToken && globalEventToken) eventToken = globalEventToken;
  } catch {
    // ignore
  }
  try {
    const lsEndpoint = window.localStorage?.getItem("yagodka_debug_report_url");
    if (!endpoint && lsEndpoint) endpoint = String(lsEndpoint).trim();
    const lsEventEndpoint = window.localStorage?.getItem("yagodka_debug_event_url");
    if (!eventEndpoint && lsEventEndpoint) eventEndpoint = String(lsEventEndpoint).trim();
    if (!enabled) {
      const lsEnabled = window.localStorage?.getItem("yagodka_debug_report");
      if (lsEnabled != null) enabled = parseBoolish(lsEnabled);
    }
    if (queryEnabled === null && intervalMs === 90_000) {
      const lsInterval = window.localStorage?.getItem("yagodka_debug_report_interval");
      intervalMs = parseReportInterval(lsInterval);
    }
  } catch {
    // ignore
  }
  endpoint = resolveHttpUrl(endpoint);
  eventEndpoint = resolveHttpUrl(eventEndpoint);
  if (enabled && !endpoint && token) {
    endpoint = resolveHttpUrl("/debug/client/report");
  }
  if (!eventEndpoint && endpoint) eventEndpoint = deriveDebugEventEndpoint(endpoint);
  if (!eventToken) eventToken = token;
  const hasEndpoint = Boolean(endpoint);
  const hasEventEndpoint = Boolean(eventEndpoint);
  if (!hasEndpoint) {
    endpoint = "";
    enabled = false;
  }
  if (!hasEventEndpoint) {
    eventEndpoint = "";
  }
  if (persist) {
    try {
      if (endpoint) window.localStorage?.setItem("yagodka_debug_report_url", endpoint);
      if (eventEndpoint) window.localStorage?.setItem("yagodka_debug_event_url", eventEndpoint);
      window.localStorage?.setItem("yagodka_debug_report", enabled ? "1" : "0");
      window.localStorage?.setItem("yagodka_debug_report_interval", String(intervalMs));
    } catch {
      // ignore
    }
  }
  return {
    endpoint,
    eventEndpoint,
    token,
    eventToken,
    enabled,
    intervalMs,
    autoUpload: Boolean(autoUpload && hasEndpoint),
  };
}

function isInputLike(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as any).isContentEditable) return true;
  return false;
}

function truncate(value: unknown, maxLen = 220): string {
  const s = typeof value === "string" ? value : String(value ?? "");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 12))}…(${s.length})`;
}

function redactUrl(raw: string): string {
  const val = String(raw || "").trim();
  if (!val) return "";
  if (val.startsWith("blob:")) return `${val.slice(0, 36)}…`;
  if (val.startsWith("data:")) return "data:<redacted>";
  try {
    const u = new URL(val, window.location.href);
    const sensitive = new Set([
      "token",
      "sig",
      "signature",
      "auth",
      "authorization",
      "key",
      "pass",
      "password",
      "session",
      "sid",
      "jwt",
    ]);
    for (const k of Array.from(u.searchParams.keys())) {
      if (sensitive.has(k.toLowerCase())) u.searchParams.set(k, "<redacted>");
      else if (u.searchParams.get(k) && u.searchParams.get(k)!.length > 80) u.searchParams.set(k, "<trimmed>");
    }
    u.hash = "";
    return u.toString();
  } catch {
    return truncate(val, 260);
  }
}

function safeDomTargetSummary(target: EventTarget | null): Record<string, any> | null {
  const elTarget = target instanceof HTMLElement ? target : null;
  if (!elTarget) return null;
  const actionEl = elTarget.closest("[data-action]") as HTMLElement | null;
  const action = actionEl ? String(actionEl.getAttribute("data-action") || "").trim() : "";
  const fileEl = elTarget.closest("[data-file-id]") as HTMLElement | null;
  const fileId = fileEl ? String(fileEl.getAttribute("data-file-id") || "").trim() : "";
  const msgIdx = fileEl ? String(fileEl.getAttribute("data-msg-idx") || "").trim() : "";
  return {
    tag: elTarget.tagName.toLowerCase(),
    cls: truncate(elTarget.className || "", 120),
    ...(action ? { action } : {}),
    ...(fileId ? { fileId } : {}),
    ...(msgIdx ? { msgIdx } : {}),
  };
}

function safeErrorSummary(err: unknown): Record<string, any> {
  const e = err instanceof Error ? err : new Error(String(err ?? "error"));
  const out: Record<string, any> = {
    name: truncate(e.name || "Error", 80),
    message: truncate(e.message || "", 300),
  };
  const stack = typeof e.stack === "string" ? e.stack : "";
  if (stack) out.stack = truncate(stack, 2400);
  return out;
}

function summarizeGatewayPayload(msg: any): Record<string, any> | null {
  if (!msg || typeof msg !== "object") return null;
  const type = String((msg as any).type || "").trim();
  if (!type) return null;
  const out: Record<string, any> = { type };

  const tracked = new Set([
    "auth",
    "auth_fail",
    "error",
    "send",
    "message_delete",
    "message_read",
    "message_delivered_to_device",
    "history",
    "history_result",
    "file_get",
    "file_downloaded",
    "file_offer",
    "file_accept",
    "file_reject",
    "file_upload_complete",
    "file_chunk",
    "reaction_set",
    "avatar_get",
    "profile_get",
    "board_list",
    "group_list",
    "prefs_set",
    "search",
    "update_check",
    "update_required",
    "client_update",
    "PWA_OUTBOX_SYNC",
  ]);
  if (!tracked.has(type) && !type.startsWith("file_") && !type.startsWith("PWA_")) return { type };

  const fileId = String((msg as any).file_id || (msg as any).fileId || "").trim();
  if (fileId) out.file_id = fileId;
  const id = (msg as any).id;
  if (typeof id === "number" && Number.isFinite(id)) out.id = Math.trunc(id);
  const room = String((msg as any).room || (msg as any).room_id || "").trim();
  if (room) out.room = room;
  const peer = String((msg as any).peer || (msg as any).from || (msg as any).to || "").trim();
  if (peer) out.peer = peer;
  const transport = String((msg as any).transport || "").trim();
  if (transport) out.transport = transport;
  const reason = String((msg as any).reason || "").trim();
  if (reason) out.reason = truncate(reason, 240);
  const status = String((msg as any).status || "").trim();
  if (status) out.status = status;
  const mime = String((msg as any).mime || "").trim();
  if (mime) out.mime = truncate(mime, 100);

  const urlRaw = (msg as any).url ? String((msg as any).url) : "";
  if (urlRaw) out.url = redactUrl(urlRaw);
  const thumbUrlRaw = (msg as any).thumb_url ? String((msg as any).thumb_url) : "";
  if (thumbUrlRaw) out.thumb_url = redactUrl(thumbUrlRaw);

  if (type === "history_result") {
    const rows = Array.isArray((msg as any).rows) ? (msg as any).rows : [];
    out.messages = rows.length;
    let files = 0;
    let missingMime = 0;
    const sample: Array<{ file_id: string; name: string; mime: string | null; size: number }> = [];
    for (const m of rows) {
      const att = m?.attachment;
      if (!att || att.kind !== "file") continue;
      const fid = String(att.fileId || att.file_id || "").trim();
      if (!fid) continue;
      files += 1;
      const name = String(att.name || "").trim();
      const mt = att.mime ? String(att.mime).trim() : null;
      if (!mt) missingMime += 1;
      if (sample.length < 8) sample.push({ file_id: fid, name: truncate(name, 80), mime: mt ? truncate(mt, 80) : null, size: Number(att.size || 0) || 0 });
      if (files >= 180) break;
    }
    const rawHasMore = (msg as any).has_more;
    if (rawHasMore !== undefined) out.has_more = Boolean(rawHasMore);
    if (files) out.file_attachments = { total: files, missing_mime: missingMime, sample };
    if (typeof (msg as any).before_id !== "undefined") out.before_id = Number((msg as any).before_id) || 0;
    if (typeof (msg as any).since_id !== "undefined") out.since_id = Number((msg as any).since_id) || 0;
    if (typeof (msg as any).read_up_to_id !== "undefined") out.read_up_to_id = Number((msg as any).read_up_to_id) || 0;
    if (Boolean((msg as any).preview)) out.preview = true;
  }

  if (type === "error") {
    const code = String((msg as any).code || "").trim();
    const message = String((msg as any).message || (msg as any).detail || "").trim();
    if (code) out.code = truncate(code, 80);
    if (message) out.message = truncate(message, 380);
  }

  const countKeys = Object.keys(msg).filter((k) => typeof (msg as any)[k] !== "undefined").length;
  if (countKeys) out.key_count = Math.min(countKeys, 64);

  const unknownPayloadKeys = ["text", "content", "version", "payload", "query", "query_id", "body", "state", "target"];
  for (const key of unknownPayloadKeys) {
    if (!Object.prototype.hasOwnProperty.call(msg, key)) continue;
    const raw = (msg as any)[key];
    if (raw == null) continue;
    if (typeof raw === "string") {
      if (raw.trim()) out[key] = truncate(raw, 200);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    } else if (typeof raw === "boolean") {
      out[key] = raw;
    }
  }

  return out;
}

function summarizeState(st: AppState): Record<string, any> {
  const selected = st.selected ? `${st.selected.kind}:${st.selected.id}` : null;
  const chatKey = st.selected ? conversationKey(st.selected) : null;
  const fileTransfers = Array.isArray(st.fileTransfers) ? st.fileTransfers : [];
  const errTransfers = fileTransfers.filter((t) => t?.status === "error").length;
  const downloading = fileTransfers.filter((t) => t?.status === "downloading").length;
  const uploading = fileTransfers.filter((t) => t?.status === "uploading").length;
  const modalKind = st.modal ? String((st.modal as any).kind || "") : null;
  const viewerFileId = modalKind === "file_viewer" ? String((st.modal as any).fileId || "").trim() : "";
  return {
    page: st.page,
    conn: st.conn,
    authed: Boolean(st.authed),
    selected,
    chat_key: chatKey,
    modal: modalKind || null,
    ...(viewerFileId ? { viewer_file_id: viewerFileId } : {}),
    file_transfers: { total: fileTransfers.length, downloading, uploading, error: errTransfers },
  };
}

function isInterestingFetchUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl, window.location.href);
    if (u.origin !== window.location.origin) return false;
    const path = (u.pathname || "").toLowerCase();
    if (path.includes("/files") || path.includes("/thumb")) return true;
    if (path.includes("/version") || path.includes("/manifest") || path.includes("/client/report") || path.includes("/client/event") || path.includes("/update")) return true;
    if (path.includes("/__yagodka_cache__")) return true;
    if (path.endsWith(".json")) return true;
    return false;
  } catch {
    return false;
  }
}

export function installDebugMonitorFeature(deps: DebugMonitorFeatureDeps): DebugMonitorFeature {
  const { store, gateway, mount, chatHost } = deps;
  const debugHud = deps.debugHud || null;

  const MAX_ENTRIES = 2600;
  const startedAt = Date.now();
  const entries: DebugEntry[] = [];
  const reportConfig = readDebugReportConfig();
  let errorCount = 0;
  let reportUploadTimer: number | null = null;
  let reportUploadInFlight = false;
  let reportUploadInterval: number | null = null;
  const MAX_EVENT_ENTRIES = 1600;
  const eventUploadQueue: DebugEntry[] = [];
  let eventUploadTimer: number | null = null;
  let eventUploadInFlight = false;

  const push = (kind: string, data?: any, options?: { trackEventUpload?: boolean }) => {
    const k = String(kind || "").trim();
    if (!k) return;
    const entry: DebugEntry = { ts: Date.now(), kind: k, ...(data !== undefined ? { data } : {}) };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    if (options?.trackEventUpload !== false) queueEventForUpload(entry);
  };

  const pushError = (kind: string, err: unknown, extra?: any, opts: { trackEventUpload?: boolean } = {}) => {
    errorCount += 1;
    push(kind, { err: safeErrorSummary(err), ...(extra ? { extra } : {}) }, opts);
  };

  const eventHeaders = (token: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers["X-Debug-Token"] = token;
    }
    return headers;
  };

  const queueEventForUpload = (entry: DebugEntry) => {
    if (
      !reportConfig.enabled ||
      !reportConfig.autoUpload ||
      !reportConfig.eventEndpoint ||
      ["report.upload.ok", "report.upload.fail", "report.upload.error", "event.upload.ok", "event.upload.fail", "event.upload.error"].includes(
        String(entry.kind || "")
      )
    ) {
      return;
    }
    eventUploadQueue.push(entry);
    if (eventUploadQueue.length > MAX_EVENT_ENTRIES) {
      eventUploadQueue.splice(0, eventUploadQueue.length - MAX_EVENT_ENTRIES);
    }
    scheduleEventUpload("monitor_event");
  };

  const uploadEvents = async (reason: string, immediate = false) => {
    if (!reportConfig.enabled || !reportConfig.autoUpload || !reportConfig.eventEndpoint || eventUploadInFlight) return;
    if (!eventUploadQueue.length) {
      return;
    }
    if (eventUploadTimer !== null) {
      window.clearTimeout(eventUploadTimer);
      eventUploadTimer = null;
    }
    if (!immediate) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!eventUploadQueue.length) return;
    }
    const batch = eventUploadQueue.splice(0, 120);
    eventUploadInFlight = true;
    try {
      const response = await fetch(reportConfig.eventEndpoint, {
        method: "POST",
        headers: eventHeaders(reportConfig.eventToken || reportConfig.token),
        body: JSON.stringify({
          kind: "debug.event.batch",
          reason,
          started_at: new Date(startedAt).toISOString(),
          state: summarizeState(store.get()),
          events: batch,
          meta: buildClientInfoTags(),
        }),
        keepalive: true,
      });
      if (!response.ok) {
        eventUploadQueue.unshift(...batch);
        push(
          "event.upload.fail",
          {
            status: response.status,
            endpoint: redactUrl(reportConfig.eventEndpoint),
            reason,
          },
          { trackEventUpload: false }
        );
        return;
      }
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        // ignore
      }
      push(
        "event.upload.ok",
        {
          status: response.status,
          reason,
          path: payload?.path || null,
          count: batch.length,
        },
        { trackEventUpload: false }
      );
    } catch (e) {
      eventUploadQueue.unshift(...batch);
      pushError("event.upload.error", e, { endpoint: redactUrl(reportConfig.eventEndpoint), reason }, { trackEventUpload: false });
    } finally {
      eventUploadInFlight = false;
      renderUi();
      if (eventUploadQueue.length) {
        scheduleEventUpload("event_queue");
      }
    }
  };

  const scheduleEventUpload = (reason: string, immediate = false) => {
    if (!reportConfig.enabled || !reportConfig.autoUpload || !reportConfig.eventEndpoint) return;
    if (immediate) {
      void uploadEvents(reason, true);
      return;
    }
    if (eventUploadTimer !== null) return;
    eventUploadTimer = window.setTimeout(() => {
      eventUploadTimer = null;
      void uploadEvents(reason);
    }, Math.max(1_000, Math.min(8_000, Math.round(reportConfig.intervalMs / 8))));
  };

  const uploadReport = async (reason: string) => {
    if (!reportConfig.enabled || !reportConfig.autoUpload || !reportConfig.endpoint || reportUploadInFlight) return;
    reportUploadInFlight = true;
    try {
      const report = await api.buildReport();
      const response = await fetch(reportConfig.endpoint, {
        method: "POST",
        headers: eventHeaders(reportConfig.token),
        body: JSON.stringify({ reason, ...report }),
        keepalive: true,
      });
      if (!response.ok) {
        push(
          "report.upload.fail",
          {
            status: response.status,
            reason,
            endpoint: redactUrl(reportConfig.endpoint),
          },
          { trackEventUpload: false }
        );
        return;
      }
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        // ignore
      }
      push(
        "report.upload.ok",
        {
          status: response.status,
          reason,
          path: payload?.path || null,
        },
        { trackEventUpload: false }
      );
    } catch (e) {
      push("report.upload.error", { endpoint: redactUrl(reportConfig.endpoint), reason }, { trackEventUpload: false });
      pushError("report.upload.error", e, { endpoint: redactUrl(reportConfig.endpoint), reason }, { trackEventUpload: false });
    } finally {
      reportUploadInFlight = false;
      renderUi();
    }
  };

  const scheduleReportUpload = (reason: string, immediate = false) => {
    if (!reportConfig.enabled || !reportConfig.autoUpload || !reportConfig.endpoint) return;
    if (immediate) {
      void uploadReport(reason);
      return;
    }
    if (reportUploadTimer !== null) return;
    reportUploadTimer = window.setTimeout(() => {
      reportUploadTimer = null;
      void uploadReport(reason);
    }, Math.max(5_000, Math.min(30_000, Math.round(reportConfig.intervalMs / 4))));
  };

  const dbgHudLog = (msg: string) => {
    try {
      debugHud?.log?.(msg);
    } catch {
      // ignore
    }
  };

  const api = {
    push,
    pushError,
    dump: () => entries.slice(),
    clear: () => {
      entries.length = 0;
      errorCount = 0;
      dbgHudLog("debugMonitor.clear");
      renderUi();
    },
    buildReport: () => {
      const st = store.get();
      const uid = st.selfId ? String(st.selfId) : null;
      const cacheStats = uid ? getFileCacheStats(uid) : null;
      const cacheSample = uid ? listFileCacheEntries(uid, { limit: 20 }) : [];
      const cachePrefs = uid ? loadFileCachePrefs(uid) : null;
      const storageEstimate = (() => {
        try {
          return (navigator as any).storage?.estimate?.();
        } catch {
          return null;
        }
      })();
      const storagePersisted = (() => {
        try {
          return (navigator as any).storage?.persisted?.();
        } catch {
          return null;
        }
      })();
      return Promise.all([
        Promise.resolve(storageEstimate).catch(() => null),
        Promise.resolve(storagePersisted).catch(() => null),
      ])
        .then(([estimate, persisted]) => {
          const report = {
            generated_at: new Date().toISOString(),
            started_at: new Date(startedAt).toISOString(),
            duration_ms: Date.now() - startedAt,
            meta: buildClientInfoTags(),
            state: summarizeState(st),
            storage: estimate || null,
            storage_persisted: typeof persisted === "boolean" ? persisted : null,
            cache: cacheStats ? { ...cacheStats, sample: cacheSample, prefs: cachePrefs } : null,
            errors: errorCount,
            entries,
          };
          return report;
        })
        .catch(() => ({
          generated_at: new Date().toISOString(),
          started_at: new Date(startedAt).toISOString(),
          duration_ms: Date.now() - startedAt,
          meta: buildClientInfoTags(),
          state: summarizeState(store.get()),
          storage: null,
          cache: null,
          errors: errorCount,
          entries,
        }));
    },
  };

  const g: any = globalThis as any;
  const GLOBAL_KEY = "__yagodka_debug_monitor";
  const GLOBAL_IN_HOOK = "__yagodka_debug_on_gateway_in";
  const prevGlobal = g[GLOBAL_KEY];
  try {
    g[GLOBAL_KEY] = api;
  } catch {
    // ignore
  }

  let enabled = Boolean(debugHud?.isEnabled?.() ?? (shouldEnableFromLocation() || shouldEnableFromStorage()));
  let stopFns: Array<() => void> = [];
  let fetchOrig: any = null;
  let gatewaySendOrig: ((payload: any) => boolean) | null = null;
  let uiMounted = false;
  let uiOpen = false;

  const uiBtn = el("button", { type: "button" }, ["DBG"]) as HTMLButtonElement;
  const uiPanel = el("div", {}, []) as HTMLDivElement;
  const uiPre = el("pre", {}, [""]) as HTMLPreElement;
  const uiHeader = el("div", {}, []) as HTMLDivElement;

  const setUiStyle = () => {
    uiBtn.style.position = "fixed";
    uiBtn.style.right = "12px";
    uiBtn.style.bottom = "12px";
    uiBtn.style.zIndex = "2147483647";
    uiBtn.style.padding = "8px 10px";
    uiBtn.style.borderRadius = "10px";
    uiBtn.style.border = "1px solid rgba(255,255,255,0.18)";
    uiBtn.style.background = "rgba(20,20,20,0.72)";
    uiBtn.style.color = "white";
    uiBtn.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
    uiBtn.style.fontSize = "12px";
    uiBtn.style.userSelect = "none";

    uiPanel.style.position = "fixed";
    uiPanel.style.right = "12px";
    uiPanel.style.bottom = "52px";
    uiPanel.style.width = "min(520px, calc(100vw - 24px))";
    uiPanel.style.maxHeight = "min(62vh, 520px)";
    uiPanel.style.overflow = "auto";
    uiPanel.style.zIndex = "2147483647";
    uiPanel.style.padding = "10px";
    uiPanel.style.borderRadius = "12px";
    uiPanel.style.border = "1px solid rgba(255,255,255,0.16)";
    uiPanel.style.background = "rgba(10,10,10,0.82)";
    uiPanel.style.color = "white";
    uiPanel.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
    uiPanel.style.fontSize = "12px";
    uiPanel.style.display = "none";

    uiHeader.style.display = "flex";
    uiHeader.style.gap = "8px";
    uiHeader.style.flexWrap = "wrap";
    uiHeader.style.alignItems = "center";
    uiHeader.style.marginBottom = "8px";

    uiPre.style.whiteSpace = "pre-wrap";
    uiPre.style.wordBreak = "break-word";
    uiPre.style.margin = "0";
    uiPre.style.opacity = "0.92";
  };

  const makeHdrBtn = (label: string, onClick: () => void) => {
    const b = el("button", { type: "button" }, [label]) as HTMLButtonElement;
    b.style.padding = "6px 10px";
    b.style.borderRadius = "10px";
    b.style.border = "1px solid rgba(255,255,255,0.18)";
    b.style.background = "rgba(30,30,30,0.8)";
    b.style.color = "white";
    b.style.fontFamily = "inherit";
    b.style.fontSize = "12px";
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  const scanMedia = () => {
    try {
      const st = store.get();
      const chatKey = st.selected ? conversationKey(st.selected) : "";
      const nodes = chatHost.querySelectorAll("button.chat-file-preview[data-file-id]");
      let broken = 0;
      let empty = 0;
      const sample: any[] = [];
      for (const node of Array.from(nodes)) {
        if (!(node instanceof HTMLButtonElement)) continue;
        const fileId = String(node.getAttribute("data-file-id") || "").trim();
        const kind = String(node.getAttribute("data-file-kind") || "").trim() || null;
        const img = node.querySelector("img.chat-file-img");
        const isEmpty = node.classList.contains("chat-file-preview-empty");
        const isBroken = img instanceof HTMLImageElement && img.complete && img.naturalWidth === 0;
        if (isEmpty) empty += 1;
        if (isBroken) broken += 1;
        if ((isEmpty || isBroken) && sample.length < 12) {
          sample.push({
            fileId,
            kind,
            msgIdx: String(node.getAttribute("data-msg-idx") || "").trim() || null,
            src: img instanceof HTMLImageElement ? redactUrl(img.currentSrc || img.src || "") : null,
          });
        }
      }
      push("media.scan", { chatKey: chatKey || null, total: nodes.length, empty, broken, sample });
      dbgHudLog(`media.scan total=${nodes.length} empty=${empty} broken=${broken}`);
      renderUi();
    } catch (e) {
      pushError("media.scan.error", e);
    }
  };

  const copyReport = async () => {
    try {
      const report = await api.buildReport();
      const text = JSON.stringify(report, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        push("report.copy.ok", { bytes: text.length });
        dbgHudLog("report.copy ok");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-99999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        push("report.copy.fallback", { bytes: text.length });
      }
      renderUi();
      push("report.copy.done", { bytes: text.length });
    } catch (e) {
      pushError("report.copy.error", e);
    }
  };

  const downloadReport = async () => {
    try {
      const report = await api.buildReport();
      const text = JSON.stringify(report, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `yagodka-debug-${Date.now()}.json`;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
        a.remove();
      }, 0);
      push("report.download", { bytes: text.length });
      renderUi();
      scheduleReportUpload("manual");
    } catch (e) {
      pushError("report.download.error", e);
    }
  };

  const renderUi = () => {
    if (!uiMounted) return;
    const tail = entries.slice(-40);
    const lines = tail.map((e) => {
      const t = new Date(e.ts).toISOString().slice(11, 23);
      const data = e.data === undefined ? "" : ` ${truncate(JSON.stringify(e.data), 380)}`;
      return `${t} ${e.kind}${data}`;
    });
    uiPre.textContent = lines.join("\n");
    uiBtn.textContent = errorCount ? `DBG (${errorCount})` : "DBG";
  };

  const mountUi = () => {
    if (uiMounted) return;
    uiMounted = true;
    setUiStyle();
    uiBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      uiOpen = !uiOpen;
      uiPanel.style.display = uiOpen ? "block" : "none";
      renderUi();
    });
    const btnCopy = makeHdrBtn("Copy report", () => void copyReport());
    const btnDl = makeHdrBtn("Download report", () => void downloadReport());
    const btnUpload = makeHdrBtn("Upload report", () => void uploadReport("manual"));
    const btnScan = makeHdrBtn("Scan media", () => scanMedia());
    const btnClear = makeHdrBtn("Clear", () => api.clear());
    uiHeader.append(btnCopy, btnDl, btnUpload, btnScan, btnClear);
    uiPanel.append(uiHeader, uiPre);
    mount.append(uiBtn, uiPanel);
    renderUi();
  };

  const unmountUi = () => {
    if (!uiMounted) return;
    uiMounted = false;
    uiOpen = false;
    try {
      uiBtn.remove();
      uiPanel.remove();
    } catch {
      // ignore
    }
  };

  const installFetchPatch = () => {
    if (fetchOrig) return;
    try {
      if (typeof fetch !== "function") return;
      fetchOrig = fetch.bind(globalThis);
    (globalThis as any).fetch = async (input: any, init?: any) => {
        const t0 = Date.now();
        const urlRaw = typeof input === "string" ? input : input?.url ? String(input.url) : "";
        const method = String(init?.method || "GET").toUpperCase();
        const shouldLog = isInterestingFetchUrl(urlRaw);
        const loggedUrl = shouldLog ? (() => {
          try {
            return redactUrl(urlRaw);
          } catch {
            return "";
          }
        })() : "";
        if (shouldLog) {
          const hdrs = init?.headers || {};
          const range = typeof hdrs?.get === "function" ? String(hdrs.get("Range") || "") : String(hdrs?.Range || hdrs?.range || "");
          push("fetch.start", { method, url: loggedUrl, ...(range ? { range: truncate(range, 80) } : {}) });
        }
        try {
          const res = await fetchOrig(input, init);
          if (shouldLog) {
            const ct = String(res.headers.get("Content-Type") || "").trim();
            const cl = String(res.headers.get("Content-Length") || "").trim();
            push("fetch.res", { status: res.status, ok: res.ok, url: loggedUrl || redactUrl(res.url || urlRaw), ct: truncate(ct, 120), cl: truncate(cl, 40), ms: Date.now() - t0 });
            scheduleReportUpload("fetch");
          }
          return res;
        } catch (e) {
          if (shouldLog) {
            pushError("fetch.err", e, { method, url: loggedUrl || redactUrl(urlRaw), ms: Date.now() - t0 });
            scheduleReportUpload("fetch_error");
          }
          throw e;
        }
      };
      push("fetch.patch", { ok: true });
    } catch (e) {
      pushError("fetch.patch.error", e);
    }
  };

  const uninstallFetchPatch = () => {
    if (!fetchOrig) return;
    try {
      (globalThis as any).fetch = fetchOrig;
    } catch {
      // ignore
    }
    fetchOrig = null;
  };

  const installGatewaySendPatch = () => {
    if (gatewaySendOrig) return;
    try {
      gatewaySendOrig = gateway.send.bind(gateway);
      gateway.send = (payload: any) => {
        const summary = summarizeGatewayPayload(payload);
        if (summary) push("gateway.out", summary);
        const ok = gatewaySendOrig ? gatewaySendOrig(payload) : false;
        if (summary) push("gateway.out.result", { type: summary.type, ok });
        if (summary && summary.type) {
          if (
            [
              "message_read",
              "history",
              "file_get",
              "send",
              "file_downloaded",
              "file_upload_complete",
              "history_result",
              "auth",
              "authz_request",
              "authz_response",
              "message_delete",
              "search",
              "prefs_set",
              "update_check",
              "update_required",
              "client_update",
            ].includes(String(summary.type))
          ) {
            scheduleReportUpload("gateway_out");
          }
        }
        return ok;
      };
      push("gateway.patch", { ok: true });
    } catch (e) {
      pushError("gateway.patch.error", e);
    }
  };

  const uninstallGatewaySendPatch = () => {
    if (!gatewaySendOrig) return;
    try {
      gateway.send = gatewaySendOrig as any;
    } catch {
      // ignore
    }
    gatewaySendOrig = null;
  };

  const installGlobalGatewayInHook = () => {
    try {
      g[GLOBAL_IN_HOOK] = (msg: any) => {
        const summary = summarizeGatewayPayload(msg);
        if (summary) push("gateway.in", summary);
        if (summary && summary.type) scheduleReportUpload("gateway_in");
      };
    } catch {
      // ignore
    }
  };

  const uninstallGlobalGatewayInHook = () => {
    try {
      if (g[GLOBAL_IN_HOOK]) delete g[GLOBAL_IN_HOOK];
    } catch {
      // ignore
    }
  };

  const installEventListeners = () => {
    const onClick = (e: Event) => {
      if (!enabled) return;
      const target = e.target as HTMLElement | null;
      if (isInputLike(target)) return;
      const summary = safeDomTargetSummary(e.target);
      if (!summary) return;
      push("ui.click", summary);
      const action = String((summary as any).action || "");
      if (action) dbgHudLog(`click:${action}`);
      renderUi();
    };
    const onPointer = (e: Event) => {
      if (!enabled) return;
      const ev = e as PointerEvent;
      const target = ev.target as HTMLElement | null;
      if (isInputLike(target)) return;
      const summary = safeDomTargetSummary(ev.target);
      if (!summary) return;
      push("ui.pointer", {
        ...summary,
        type: ev.type,
        pt: String(ev.pointerType || ""),
        x: Math.round(Number(ev.clientX || 0)),
        y: Math.round(Number(ev.clientY || 0)),
      });
      renderUi();
    };
    const onKey = (e: Event) => {
      if (!enabled) return;
      const ev = e as KeyboardEvent;
      const target = ev.target as HTMLElement | null;
      if (isInputLike(target)) return;
      const key = String(ev.key || "");
      if (!key) return;
      const safeKey = key.length === 1 ? "" : key; // do not capture typed chars
      if (!safeKey) return;
      push("ui.key", { key: safeKey, alt: ev.altKey, ctrl: ev.ctrlKey, meta: ev.metaKey, shift: ev.shiftKey });
      renderUi();
    };
    const onError = (e: Event) => {
      if (!enabled) return;
      const ev = e as ErrorEvent;
      if (ev?.error) {
        pushError("window.error", ev.error, { message: truncate(ev.message, 300), src: truncate(ev.filename || "", 160), line: ev.lineno, col: ev.colno });
        dbgHudLog("window.error");
        renderUi();
      }
    };
    const onUnhandled = (e: Event) => {
      if (!enabled) return;
      const ev = e as PromiseRejectionEvent;
      pushError("window.unhandledrejection", ev?.reason, null);
      dbgHudLog("unhandledrejection");
      renderUi();
    };
    const onResourceError = (e: Event) => {
      if (!enabled) return;
      const target = e.target as any;
      if (target instanceof HTMLImageElement) {
        const fileId = String(target.closest?.("[data-file-id]")?.getAttribute?.("data-file-id") || "").trim();
        push("resource.img.error", {
          fileId: fileId || null,
          src: redactUrl(target.currentSrc || target.src || ""),
          w: target.naturalWidth || 0,
          h: target.naturalHeight || 0,
          complete: Boolean(target.complete),
          cls: truncate(target.className || "", 120),
        });
        dbgHudLog("img.error");
        renderUi();
      } else if (target instanceof HTMLVideoElement) {
        const fileId = String(target.closest?.("[data-file-id]")?.getAttribute?.("data-file-id") || "").trim();
        push("resource.video.error", {
          fileId: fileId || null,
          src: redactUrl(target.currentSrc || target.src || ""),
          err: String((target.error as any)?.code || ""),
          cls: truncate(target.className || "", 120),
        });
        dbgHudLog("video.error");
        renderUi();
      }
    };
    const onVisibility = () => {
      if (!enabled) return;
      const state = String(document.visibilityState || "");
      push("app.visibility", { state, hidden: Boolean(document.hidden) });
      renderUi();
    };
    const onOnline = () => {
      if (!enabled) return;
      push("app.online", { online: true });
      renderUi();
    };
    const onOffline = () => {
      if (!enabled) return;
      push("app.online", { online: false });
      renderUi();
    };
    const onFocus = () => {
      if (!enabled) return;
      push("app.focus", { focused: true });
      renderUi();
    };
    const onBlur = () => {
      if (!enabled) return;
      push("app.focus", { focused: false });
      renderUi();
    };
    const onPageShow = (e: Event) => {
      if (!enabled) return;
      const ev: any = e as PageTransitionEvent;
      push("app.pageshow", { persisted: Boolean(ev && ev.persisted) });
      renderUi();
    };
    const onPageHide = (e: Event) => {
      if (!enabled) return;
      const ev: any = e as PageTransitionEvent;
      push("app.pagehide", { persisted: Boolean(ev && ev.persisted) });
      renderUi();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("pointerup", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled as any);
    window.addEventListener("error", onResourceError, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pageshow", onPageShow, true);
    window.addEventListener("pagehide", onPageHide, true);

    stopFns.push(() => document.removeEventListener("click", onClick, true));
    stopFns.push(() => document.removeEventListener("pointerdown", onPointer, true));
    stopFns.push(() => document.removeEventListener("pointerup", onPointer, true));
    stopFns.push(() => document.removeEventListener("keydown", onKey, true));
    stopFns.push(() => window.removeEventListener("error", onError));
    stopFns.push(() => window.removeEventListener("unhandledrejection", onUnhandled as any));
    stopFns.push(() => window.removeEventListener("error", onResourceError, true));
    stopFns.push(() => document.removeEventListener("visibilitychange", onVisibility));
    stopFns.push(() => window.removeEventListener("online", onOnline));
    stopFns.push(() => window.removeEventListener("offline", onOffline));
    stopFns.push(() => window.removeEventListener("focus", onFocus));
    stopFns.push(() => window.removeEventListener("blur", onBlur));
    stopFns.push(() => window.removeEventListener("pageshow", onPageShow, true));
    stopFns.push(() => window.removeEventListener("pagehide", onPageHide, true));
  };

  let storeUnsub: (() => void) | null = null;
  const installStoreSubscription = () => {
    if (storeUnsub) return;
    let lastConn = "";
    let lastAuthed = false;
    let lastPage = "";
    let lastModal = "";
    let lastSelected = "";
    let lastStatus = "";
    let lastHistoryLoading = false;
    let lastConvLen = -1;
    let lastUpdateLatest = "";
    const check = () => {
      if (!enabled) return;
      const st = store.get();
      const conn = String(st.conn || "");
      if (conn && conn !== lastConn) {
        lastConn = conn;
        push("state.conn", { conn });
        dbgHudLog(`conn:${conn}`);
      }
      const authed = Boolean(st.authed);
      if (authed !== lastAuthed) {
        lastAuthed = authed;
        push("state.authed", { authed });
        if (authed) push("user.login", { at: new Date().toISOString() });
      }
      const page = String(st.page || "");
      if (page && page !== lastPage) {
        lastPage = page;
        push("state.page", { page });
      }
      const selected = st.selected ? `${st.selected.kind}:${st.selected.id}` : "";
      if (selected !== lastSelected) {
        lastSelected = selected;
        push("state.selected", { selected: selected || null });
      }
      const modal = st.modal ? String((st.modal as any).kind || "") : "";
      if (modal !== lastModal) {
        lastModal = modal;
        push("state.modal", { modal: modal || null });
      }
      const status = String(st.status || "");
      if (status && status !== lastStatus) {
        lastStatus = status;
        push("state.status", { status: truncate(status, 200) });
      }
      const key = st.selected ? conversationKey(st.selected) : "";
      const loading = Boolean(key && st.historyLoading?.[key]);
      if (loading !== lastHistoryLoading) {
        lastHistoryLoading = loading;
        push("state.history_loading", { chatKey: key || null, loading });
      }
      if (key) {
        const conv = st.conversations?.[key] || [];
        const len = Array.isArray(conv) ? conv.length : 0;
        if (len !== lastConvLen) {
          if (lastConvLen >= 0) push("state.conv_len", { chatKey: key, len });
          lastConvLen = len;
        }
      } else {
        lastConvLen = -1;
      }
      const updateLatest = String((st as any).updateLatest || "");
      if (updateLatest && updateLatest !== lastUpdateLatest) {
        lastUpdateLatest = updateLatest;
        push("state.update_latest", { updateLatest });
      }
      renderUi();
    };
    let raf: number | null = null;
    const onStore = () => {
      if (!enabled) return;
      if (raf !== null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        check();
      });
    };
    storeUnsub = store.subscribe(onStore);
    stopFns.push(() => {
      try {
        if (raf !== null) window.cancelAnimationFrame(raf);
      } catch {
        // ignore
      }
    });
  };

  const setEnabled = (next: boolean) => {
    const on = Boolean(next);
    if (enabled === on) return;
    enabled = on;
    if (enabled) {
      push("debug.enabled", { at: new Date().toISOString(), reportUrl: reportConfig.endpoint ? "set" : null });
      push("debug.boot", {
        at: new Date().toISOString(),
        page: String(store.get().page || ""),
        conn: String(store.get().conn || ""),
        authed: Boolean(store.get().authed),
      });
      scheduleReportUpload("debug_enabled", true);
      mountUi();
      installFetchPatch();
      installGatewaySendPatch();
      installGlobalGatewayInHook();
      installEventListeners();
      installStoreSubscription();
      if (!storeUnsub) installStoreSubscription();
      if (!storeUnsub) return;
      dbgHudLog("debugMonitor enabled");
      renderUi();
      return;
    }
    push("debug.disabled", { at: new Date().toISOString() });
    if (reportUploadTimer !== null) {
      window.clearTimeout(reportUploadTimer);
      reportUploadTimer = null;
    }
    uninstallFetchPatch();
    uninstallGatewaySendPatch();
    uninstallGlobalGatewayInHook();
    for (const fn of stopFns.splice(0, stopFns.length)) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    try {
      storeUnsub?.();
    } catch {
      // ignore
    }
    storeUnsub = null;
    unmountUi();
  };

  if (debugHud) {
    try {
      const origSet = debugHud.setEnabled?.bind(debugHud);
      if (origSet) {
        debugHud.setEnabled = (value: boolean, opts?: { persist?: boolean }) => {
          origSet(value, opts);
          setEnabled(Boolean(value));
        };
      }
      const origToggle = debugHud.toggle?.bind(debugHud);
      if (origToggle) {
        debugHud.toggle = () => {
          origToggle();
          setEnabled(Boolean(debugHud.isEnabled()));
        };
      }
    } catch {
      // ignore
    }
  }

  setEnabled(enabled);

  const dispose = () => {
    try {
      setEnabled(false);
    } catch {
      // ignore
    }
    if (reportUploadTimer !== null) {
      window.clearTimeout(reportUploadTimer);
      reportUploadTimer = null;
    }
    try {
      if (g[GLOBAL_KEY] === api) delete g[GLOBAL_KEY];
      else g[GLOBAL_KEY] = prevGlobal;
    } catch {
      // ignore
    }
  };

  return { dispose };
}
