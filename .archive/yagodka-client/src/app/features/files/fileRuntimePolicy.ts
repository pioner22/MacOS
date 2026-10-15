type FileRuntimeStateLike = {
  authed?: boolean | null;
  conn?: string | null;
  netLeader?: boolean | null;
};

type FileRuntimeVisibilityDoc = {
  visibilityState?: string | null;
};

export function isFileRuntimeDocumentVisible(doc: FileRuntimeVisibilityDoc | null | undefined = globalThis.document): boolean {
  try {
    return !doc || doc.visibilityState !== "hidden";
  } catch {
    return true;
  }
}

export function canDrainFileRuntime(state: FileRuntimeStateLike | null | undefined): boolean {
  return Boolean(state?.authed) && String(state?.conn || "") === "connected";
}

export function canQueueFilePrefetch(opts: {
  prefetchAllowed: boolean;
  doc?: FileRuntimeVisibilityDoc | null;
}): boolean {
  return Boolean(opts.prefetchAllowed) && isFileRuntimeDocumentVisible(opts.doc);
}

export function canDrainFilePrefetch(
  state: FileRuntimeStateLike | null | undefined,
  opts: {
    prefetchAllowed: boolean;
    requireLeader?: boolean;
    doc?: FileRuntimeVisibilityDoc | null;
  }
): boolean {
  if (!canDrainFileRuntime(state)) return false;
  if (!canQueueFilePrefetch({ prefetchAllowed: opts.prefetchAllowed, doc: opts.doc })) return false;
  if (opts.requireLeader && !state?.netLeader) return false;
  return true;
}

export function resolveFileGetEnqueuePolicy(params: {
  priority: "high" | "prefetch";
  silent: boolean;
  prefetchAllowed: boolean;
  state: FileRuntimeStateLike | null | undefined;
  doc?: FileRuntimeVisibilityDoc | null;
}): { allow: boolean; reason: "prefetch_blocked" | "not_leader" | null } {
  if (params.priority !== "prefetch") return { allow: true, reason: null };
  if (!canQueueFilePrefetch({ prefetchAllowed: params.prefetchAllowed, doc: params.doc })) {
    return { allow: false, reason: "prefetch_blocked" };
  }
  if (params.silent && !params.state?.netLeader) {
    return { allow: false, reason: "not_leader" };
  }
  return { allow: true, reason: null };
}
