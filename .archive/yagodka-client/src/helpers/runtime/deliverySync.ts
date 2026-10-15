import { sanitizeDraftMap } from "../chat/drafts";
import { sanitizeOutboxMap, type OutboxMap } from "../chat/outbox";
import { sanitizeRuntimeFileTransfers } from "../files/fileTransferHistory";
import type {
  AppState,
  DomainSyncSource,
  FileTransferEntry,
  RuntimeDeliveryDomainSyncState,
  RuntimeDeliverySyncState,
} from "../../stores/types";

type RuntimeDeliveryDomain = keyof RuntimeDeliverySyncState;

type RuntimeDeliverySyncPatch = Partial<{
  drafts: Partial<RuntimeDeliveryDomainSyncState>;
  fileTransfers: Partial<RuntimeDeliveryDomainSyncState>;
  outbox: Partial<RuntimeDeliveryDomainSyncState>;
}>;

function normalizeDomainSource(raw: unknown, fallback: DomainSyncSource): DomainSyncSource {
  const value = String(raw || "").trim().toLowerCase();
  return value === "cache" || value === "server" || value === "empty" ? (value as DomainSyncSource) : fallback;
}

function normalizeTs(raw: unknown): number | null {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? n : null;
}

export function createRuntimeDeliveryDomainSyncState(
  patch?: Partial<RuntimeDeliveryDomainSyncState> | null
): RuntimeDeliveryDomainSyncState {
  const loaded = Boolean(patch?.loaded);
  const source = normalizeDomainSource(patch?.source, loaded ? "server" : "empty");
  return {
    loaded,
    source,
    reconcilePending: Boolean(patch?.reconcilePending ?? (source === "cache" && loaded)),
    lastServerAt: normalizeTs(patch?.lastServerAt),
    lastLocalAt: normalizeTs(patch?.lastLocalAt),
  };
}

export function createRuntimeDeliverySyncState(
  patch?: Partial<RuntimeDeliverySyncState> | null
): RuntimeDeliverySyncState {
  return {
    drafts: createRuntimeDeliveryDomainSyncState(patch?.drafts),
    fileTransfers: createRuntimeDeliveryDomainSyncState(patch?.fileTransfers),
    outbox: createRuntimeDeliveryDomainSyncState(patch?.outbox),
  };
}

export function getRuntimeDeliverySyncState(state: Pick<AppState, "deliverySync">): RuntimeDeliverySyncState {
  return createRuntimeDeliverySyncState(state.deliverySync);
}

export function getRuntimeDeliveryDomainSyncState(
  state: Pick<AppState, "deliverySync">,
  domain: RuntimeDeliveryDomain
): RuntimeDeliveryDomainSyncState {
  return createRuntimeDeliveryDomainSyncState(getRuntimeDeliverySyncState(state)[domain]);
}

export function applyRuntimeDeliverySyncState(prev: AppState, patch: RuntimeDeliverySyncPatch): AppState {
  const current = getRuntimeDeliverySyncState(prev);
  return {
    ...prev,
    deliverySync: createRuntimeDeliverySyncState({
      drafts: patch.drafts ? { ...current.drafts, ...patch.drafts } : current.drafts,
      fileTransfers: patch.fileTransfers ? { ...current.fileTransfers, ...patch.fileTransfers } : current.fileTransfers,
      outbox: patch.outbox ? { ...current.outbox, ...patch.outbox } : current.outbox,
    }),
  };
}

function applyRuntimeDeliveryDomainValue<T extends AppState>(
  prev: T,
  domain: RuntimeDeliveryDomain,
  value: T["drafts"] | T["fileTransfers"] | T["outbox"],
  patch: Partial<RuntimeDeliveryDomainSyncState>
): T {
  const next =
    domain === "drafts"
      ? ({ ...prev, drafts: sanitizeDraftMap(value) } as T)
      : domain === "fileTransfers"
        ? ({ ...prev, fileTransfers: sanitizeRuntimeFileTransfers(value) as FileTransferEntry[] } as T)
        : ({ ...prev, outbox: sanitizeOutboxMap(value as OutboxMap) } as T);
  return applyRuntimeDeliverySyncState(next, { [domain]: patch } as RuntimeDeliverySyncPatch) as T;
}

export function applyDraftMapSnapshot(
  prev: AppState,
  drafts: Record<string, string>,
  opts?: { source?: DomainSyncSource; reconcilePending?: boolean }
): AppState {
  const source = opts?.source || "server";
  return applyRuntimeDeliveryDomainValue(prev, "drafts", drafts, {
    loaded: true,
    source,
    reconcilePending: Boolean(opts?.reconcilePending ?? (source === "cache")),
    ...(source === "server" ? { lastServerAt: Date.now() } : { lastLocalAt: Date.now() }),
  });
}

export function applyDraftMapMutation(prev: AppState, drafts: Record<string, string>): AppState {
  const current = getRuntimeDeliveryDomainSyncState(prev, "drafts");
  return applyRuntimeDeliveryDomainValue(prev, "drafts", drafts, {
    loaded: true,
    source: current.loaded ? current.source : "server",
    reconcilePending: current.reconcilePending,
    lastLocalAt: Date.now(),
  });
}

export function applyFileTransferSnapshot(
  prev: AppState,
  fileTransfers: FileTransferEntry[],
  opts?: { source?: DomainSyncSource; reconcilePending?: boolean }
): AppState {
  const source = opts?.source || "server";
  return applyRuntimeDeliveryDomainValue(prev, "fileTransfers", fileTransfers, {
    loaded: true,
    source,
    reconcilePending: Boolean(opts?.reconcilePending ?? (source === "cache")),
    ...(source === "server" ? { lastServerAt: Date.now() } : { lastLocalAt: Date.now() }),
  });
}

export function applyFileTransferMutation(prev: AppState, fileTransfers: FileTransferEntry[]): AppState {
  const current = getRuntimeDeliveryDomainSyncState(prev, "fileTransfers");
  return applyRuntimeDeliveryDomainValue(prev, "fileTransfers", fileTransfers, {
    loaded: true,
    source: current.loaded ? current.source : "server",
    reconcilePending: current.reconcilePending,
    lastLocalAt: Date.now(),
  });
}

export function applyOutboxSnapshot(
  prev: AppState,
  outbox: OutboxMap,
  opts?: { source?: DomainSyncSource; reconcilePending?: boolean }
): AppState {
  const source = opts?.source || "server";
  return applyRuntimeDeliveryDomainValue(prev, "outbox", outbox, {
    loaded: true,
    source,
    reconcilePending: Boolean(opts?.reconcilePending ?? (source === "cache")),
    ...(source === "server" ? { lastServerAt: Date.now() } : { lastLocalAt: Date.now() }),
  });
}

export function applyOutboxMutation(prev: AppState, outbox: OutboxMap): AppState {
  const current = getRuntimeDeliveryDomainSyncState(prev, "outbox");
  return applyRuntimeDeliveryDomainValue(prev, "outbox", outbox, {
    loaded: true,
    source: current.loaded ? current.source : "server",
    reconcilePending: current.reconcilePending,
    lastLocalAt: Date.now(),
  });
}

export function resetRuntimeDeliveryState(prev: AppState): AppState {
  return {
    ...prev,
    drafts: {},
    fileTransfers: [],
    outbox: {},
    deliverySync: createRuntimeDeliverySyncState(),
  };
}
