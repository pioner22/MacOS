import { conversationKey } from "../../../helpers/chat/conversationKey";
import { markPwaStabilityHold, resolvePwaStabilityHoldMs } from "../../../helpers/pwa/stabilityHold";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

type IncidentDetail = Record<string, unknown>;

type IncidentReporterOptions = {
  key?: string;
  dedupeMs?: number;
};

export interface ClientIncidentReporterDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  dedupeWindowMs?: number;
}

export interface ClientIncidentReporter {
  report: (kind: string, detail?: IncidentDetail | null, opts?: IncidentReporterOptions) => boolean;
  reset: () => void;
}

const DEFAULT_DEDUPE_MS = 30_000;
const MAX_TRACKED_INCIDENTS = 400;
const MAX_DETAIL_KEYS = 24;
const MAX_DETAIL_ARRAY = 8;
const MAX_DETAIL_STRING = 240;

function sanitizeString(value: string): string {
  return String(value || "").trim().slice(0, MAX_DETAIL_STRING);
}

function sanitizeDetailValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = sanitizeString(value);
    return normalized || null;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DETAIL_ARRAY)
      .map((item) => sanitizeDetailValue(item))
      .filter((item) => item !== undefined);
    return items.length ? items : null;
  }
  return undefined;
}

function sanitizeDetail(detail?: IncidentDetail | null): IncidentDetail {
  const out: IncidentDetail = {};
  if (!detail || typeof detail !== "object") return out;
  let seen = 0;
  for (const [rawKey, rawValue] of Object.entries(detail)) {
    const key = sanitizeString(rawKey);
    if (!key) continue;
    const value = sanitizeDetailValue(rawValue);
    if (value === undefined) continue;
    out[key] = value;
    seen += 1;
    if (seen >= MAX_DETAIL_KEYS) break;
  }
  return out;
}

function defaultIncidentKey(kind: string, detail: IncidentDetail): string {
  const tokens = [
    kind,
    typeof detail.file_id === "string" ? detail.file_id : "",
    typeof detail.message_id === "string" || typeof detail.message_id === "number" ? String(detail.message_id) : "",
    typeof detail.conversation_key === "string" ? detail.conversation_key : "",
    typeof detail.mode === "string" ? detail.mode : "",
    typeof detail.reason === "string" ? detail.reason : "",
    detail.final_failure === true ? "final" : "",
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return tokens.join("|");
}

function shouldHoldPwaStability(kind: string): boolean {
  const normalized = sanitizeString(kind || "").toLowerCase();
  return normalized === "history_request_timeout" || normalized === "file_download_failed" || normalized === "media_preview_failed";
}

export function createClientIncidentReporter(deps: ClientIncidentReporterDeps): ClientIncidentReporter {
  const { store, send, dedupeWindowMs = DEFAULT_DEDUPE_MS } = deps;
  const dedupe = new Map<string, number>();
  let gcCounter = 0;

  const prune = (now: number) => {
    gcCounter += 1;
    if (gcCounter % 32 !== 0 && dedupe.size < MAX_TRACKED_INCIDENTS) return;
    for (const [key, expiresAt] of dedupe.entries()) {
      if (expiresAt <= now) dedupe.delete(key);
    }
    if (dedupe.size <= MAX_TRACKED_INCIDENTS) return;
    const oldest = [...dedupe.entries()].sort((a, b) => a[1] - b[1]).slice(0, dedupe.size - MAX_TRACKED_INCIDENTS);
    for (const [key] of oldest) dedupe.delete(key);
  };

  const report: ClientIncidentReporter["report"] = (kind, detail, opts) => {
    const incidentKind = sanitizeString(kind || "unknown");
    if (!incidentKind) return false;
    const st = store.get();
    if (!st.authed || st.conn !== "connected") return false;

    const selected = st.selected || null;
    const selectedKey = selected ? conversationKey(selected) : "";
    const payloadDetail = sanitizeDetail(detail);
    if (!payloadDetail.conversation_key && selectedKey) payloadDetail.conversation_key = selectedKey;
    if (!payloadDetail.selected_kind && selected?.kind) payloadDetail.selected_kind = selected.kind;
    if (!payloadDetail.selected_id && selected?.id) payloadDetail.selected_id = selected.id;
    if (!payloadDetail.page && st.page) payloadDetail.page = st.page;
    if (!payloadDetail.conn && st.conn) payloadDetail.conn = st.conn;
    if (!payloadDetail.net_leader && typeof st.netLeader === "boolean") payloadDetail.net_leader = st.netLeader;
    const visibility = typeof document !== "undefined" ? document.visibilityState : null;
    if (!payloadDetail.visibility && visibility) payloadDetail.visibility = visibility;

    const incidentKey = sanitizeString(opts?.key || defaultIncidentKey(incidentKind, payloadDetail) || incidentKind);
    const now = Date.now();
    prune(now);
    const ttl = Math.max(1000, Number(opts?.dedupeMs ?? dedupeWindowMs) || dedupeWindowMs);
    const seenUntil = dedupe.get(incidentKey) || 0;
    if (seenUntil > now) return false;
    dedupe.set(incidentKey, now + ttl);

    if (shouldHoldPwaStability(incidentKind)) {
      markPwaStabilityHold(incidentKind, resolvePwaStabilityHoldMs(incidentKind));
    }
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("yagodka:client-incident", {
            detail: { kind: incidentKind, detail: payloadDetail, key: incidentKey, ttl },
          })
        );
      }
    } catch {
      // ignore
    }
    send({
      type: "client_incident",
      incident_kind: incidentKind,
      detail: payloadDetail,
    });
    return true;
  };

  return {
    report,
    reset() {
      dedupe.clear();
    },
  };
}
