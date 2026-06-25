import { canDrainFilePrefetch, canDrainFileRuntime } from "./fileRuntimePolicy";

export type FileHttpDownloadPriority = "high" | "prefetch";

export type FileHttpDownloadQueueMeta = {
  url: string;
  name: string;
  size: number;
  mime: string | null;
  silent: boolean;
  queuedAtMs: number;
};

type FileHttpRuntimeStateLike = {
  authed?: boolean | null;
  conn?: string | null;
  netLeader?: boolean | null;
};

type FileHttpInFlightEntry = {
  controller: AbortController;
  priority: FileHttpDownloadPriority;
  silent: boolean;
  queuedAtMs: number;
  resetToken: number;
};

type FileHttpRuntimeDeps = {
  getState: () => FileHttpRuntimeStateLike;
  prefetchAllowed: boolean;
  maxConcurrency: number;
  prefetchConcurrency: number;
  isUserRequested: (fileId: string) => boolean;
  debugHook?: (kind: string, data?: any) => void;
  onStart: (params: {
    fileId: string;
    priority: FileHttpDownloadPriority;
    meta: FileHttpDownloadQueueMeta;
    controller: AbortController;
    resetToken: number;
  }) => void;
};

export type FileHttpDownloadRuntime = {
  queueState: () => {
    queued_high: number;
    queued_prefetch: number;
    inflight: number;
    inflight_prefetch: number;
  };
  isQueuedOrActive: (fileId: string) => boolean;
  enqueue: (
    fileId: string,
    params: {
      url: string;
      name: string;
      size: number;
      mime: string | null;
      silent: boolean;
      priority: FileHttpDownloadPriority;
    }
  ) => void;
  abort: (fileId: string, reason?: string, opts?: { quiet?: boolean }) => void;
  scheduleDrain: () => void;
  hasQuietAbort: (fileId: string) => boolean;
  hasLegacyFallbackAttempted: (fileId: string) => boolean;
  markLegacyFallbackAttempted: (fileId: string) => void;
  getResetToken: () => number;
  finish: (fileId: string) => void;
  reset: () => void;
};

export function createFileHttpDownloadRuntime(deps: FileHttpRuntimeDeps): FileHttpDownloadRuntime {
  const debugHook = deps.debugHook ?? (() => {});
  const queueHigh: string[] = [];
  const queuePrefetch: string[] = [];
  const queueMeta = new Map<string, FileHttpDownloadQueueMeta>();
  const inFlight = new Map<string, FileHttpInFlightEntry>();
  const quietAbort = new Set<string>();
  const legacyFallbackAttempted = new Set<string>();
  let resetToken = 0;
  let drainTimer: number | null = null;

  const queueState = () => {
    let inflightPrefetch = 0;
    for (const entry of inFlight.values()) {
      if (entry.priority === "prefetch") inflightPrefetch += 1;
    }
    return {
      queued_high: queueHigh.length,
      queued_prefetch: queuePrefetch.length,
      inflight: inFlight.size,
      inflight_prefetch: inflightPrefetch,
    };
  };

  const dropQueue = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    queueMeta.delete(fid);
    const highIdx = queueHigh.indexOf(fid);
    if (highIdx >= 0) queueHigh.splice(highIdx, 1);
    const prefIdx = queuePrefetch.indexOf(fid);
    if (prefIdx >= 0) queuePrefetch.splice(prefIdx, 1);
  };

  const isQueuedOrActive = (fileId: string): boolean => {
    const fid = String(fileId || "").trim();
    return Boolean(fid && (queueMeta.has(fid) || inFlight.has(fid)));
  };

  const scheduleDrain = () => {
    if (drainTimer !== null) return;
    drainTimer = window.setTimeout(() => {
      drainTimer = null;
      drain();
    }, 0);
  };

  const canPrefetch = () =>
    canDrainFilePrefetch(deps.getState(), {
      prefetchAllowed: deps.prefetchAllowed,
      requireLeader: true,
    });

  const promoteUserRequestedPrefetchToHigh = () => {
    for (let i = 0; i < queuePrefetch.length; i += 1) {
      const fid = queuePrefetch[i];
      if (!fid) continue;
      if (!deps.isUserRequested(fid)) continue;
      queuePrefetch.splice(i, 1);
      i -= 1;
      if (!queueHigh.includes(fid)) queueHigh.push(fid);
      const meta = queueMeta.get(fid);
      if (meta && meta.silent) queueMeta.set(fid, { ...meta, silent: false });
      debugHook("file.http.promote", { fileId: fid, reason: "user_request", ...queueState() });
    }
  };

  const start = (fileId: string, priority: FileHttpDownloadPriority) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const meta = queueMeta.get(fid);
    dropQueue(fid);
    if (!meta) return;
    const controller = new AbortController();
    inFlight.set(fid, {
      controller,
      priority,
      silent: meta.silent,
      queuedAtMs: meta.queuedAtMs,
      resetToken,
    });
    debugHook("file.http.start", {
      fileId: fid,
      priority,
      silent: meta.silent,
      queue_ms: Math.max(0, Date.now() - meta.queuedAtMs),
      ...queueState(),
    });
    deps.onStart({ fileId: fid, priority, meta, controller, resetToken });
  };

  const drain = () => {
    const state = deps.getState();
    if (!canDrainFileRuntime(state)) return;

    promoteUserRequestedPrefetchToHigh();

    while (queueHigh.length && inFlight.size < deps.maxConcurrency) {
      const fid = queueHigh.shift();
      if (!fid || !queueMeta.has(fid)) continue;
      start(fid, "high");
    }

    if (!canPrefetch()) return;
    while (
      queuePrefetch.length &&
      inFlight.size < deps.maxConcurrency &&
      queueState().inflight_prefetch < deps.prefetchConcurrency
    ) {
      const fid = queuePrefetch.shift();
      if (!fid || !queueMeta.has(fid)) continue;
      start(fid, "prefetch");
    }
  };

  const abort = (fileId: string, reason = "abort", opts: { quiet?: boolean } = {}) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const current = inFlight.get(fid);
    if (opts.quiet && current) quietAbort.add(fid);
    dropQueue(fid);
    if (current) {
      try {
        current.controller.abort();
      } catch {
        // ignore
      }
    }
    debugHook("file.http.abort", { fileId: fid, reason, quiet: Boolean(opts.quiet), ...queueState() });
  };

  const enqueue = (
    fileId: string,
    params: {
      url: string;
      name: string;
      size: number;
      mime: string | null;
      silent: boolean;
      priority: FileHttpDownloadPriority;
    }
  ) => {
    const fid = String(fileId || "").trim();
    if (!fid || isQueuedOrActive(fid)) return;
    queueMeta.set(fid, {
      url: params.url,
      name: params.name,
      size: params.size,
      mime: params.mime,
      silent: params.silent,
      queuedAtMs: Date.now(),
    });
    if (params.priority === "prefetch") queuePrefetch.push(fid);
    else queueHigh.push(fid);
    scheduleDrain();
  };

  const finish = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    quietAbort.delete(fid);
    inFlight.delete(fid);
    scheduleDrain();
  };

  const reset = () => {
    resetToken += 1;
    queueHigh.length = 0;
    queuePrefetch.length = 0;
    queueMeta.clear();
    legacyFallbackAttempted.clear();
    if (drainTimer !== null) {
      try {
        window.clearTimeout(drainTimer);
      } catch {
        // ignore
      }
      drainTimer = null;
    }
    for (const [fid, entry] of Array.from(inFlight.entries())) {
      quietAbort.add(fid);
      try {
        entry.controller.abort();
      } catch {
        // ignore
      }
    }
    inFlight.clear();
  };

  return {
    queueState,
    isQueuedOrActive,
    enqueue,
    abort,
    scheduleDrain,
    hasQuietAbort: (fileId: string) => quietAbort.has(String(fileId || "").trim()),
    hasLegacyFallbackAttempted: (fileId: string) => legacyFallbackAttempted.has(String(fileId || "").trim()),
    markLegacyFallbackAttempted: (fileId: string) => {
      const fid = String(fileId || "").trim();
      if (fid) legacyFallbackAttempted.add(fid);
    },
    getResetToken: () => resetToken,
    finish,
    reset,
  };
}
