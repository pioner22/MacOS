export type CapturePermissionKind = "microphone" | "camera";

export type MediaAccessKind = "microphone" | "camera" | "camera_microphone";

export type DesktopMediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

export interface DesktopCapturePermissionResult {
  ok: boolean;
  camera: PermissionState | null;
  microphone: PermissionState | null;
  rawStatuses: Partial<Record<CapturePermissionKind, DesktopMediaAccessStatus>>;
  requested: boolean;
  blockedKind: CapturePermissionKind | null;
  canOpenSettings: boolean;
  reason?: string;
}

function desktopBridge(): YagodkaDesktopBridge | null {
  try {
    return (globalThis as typeof globalThis & { yagodkaDesktop?: YagodkaDesktopBridge }).yagodkaDesktop || null;
  } catch {
    return null;
  }
}

function normalizeCapturePermissionKind(rawKind: unknown): CapturePermissionKind | null {
  const kind = String(rawKind || "").trim().toLowerCase();
  return kind === "camera" || kind === "microphone" ? kind : null;
}

function normalizeCapturePermissionKinds(rawKinds: CapturePermissionKind[]): CapturePermissionKind[] {
  const out: CapturePermissionKind[] = [];
  for (const rawKind of rawKinds) {
    const kind = normalizeCapturePermissionKind(rawKind);
    if (kind && !out.includes(kind)) out.push(kind);
  }
  return out.length ? out : ["camera", "microphone"];
}

function normalizeDesktopMediaStatus(rawStatus: unknown): DesktopMediaAccessStatus {
  const status = String(rawStatus || "").trim().toLowerCase();
  if (status === "not-determined" || status === "granted" || status === "denied" || status === "restricted") return status;
  return "unknown";
}

function permissionStateFromDesktopStatus(status: DesktopMediaAccessStatus): PermissionState | null {
  if (status === "granted") return "granted";
  if (status === "denied" || status === "restricted") return "denied";
  if (status === "not-determined") return "prompt";
  return null;
}

function entryForKind(rawResult: unknown, kind: CapturePermissionKind): { status: DesktopMediaAccessStatus; requested: boolean; reason: string } {
  const result = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : {};
  const permissions = result.permissions && typeof result.permissions === "object" ? (result.permissions as Record<string, unknown>) : {};
  const entry = permissions[kind] && typeof permissions[kind] === "object" ? (permissions[kind] as Record<string, unknown>) : {};
  return {
    status: normalizeDesktopMediaStatus(entry.status),
    requested: Boolean(entry.requested),
    reason: String(entry.reason || result.reason || "").trim(),
  };
}

function buildDesktopPermissionResult(rawResult: unknown, kinds: CapturePermissionKind[]): DesktopCapturePermissionResult {
  const result = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : {};
  const rawStatuses: Partial<Record<CapturePermissionKind, DesktopMediaAccessStatus>> = {};
  let requested = false;
  let blockedKind: CapturePermissionKind | null = null;
  let reason = String(result.reason || "").trim();
  const wanted = normalizeCapturePermissionKinds(kinds);
  for (const kind of wanted) {
    const entry = entryForKind(result, kind);
    rawStatuses[kind] = entry.status;
    requested = requested || entry.requested;
    if (!reason && entry.reason) reason = entry.reason;
    if (!blockedKind && (entry.status === "denied" || entry.status === "restricted")) blockedKind = kind;
  }
  const camera = rawStatuses.camera ? permissionStateFromDesktopStatus(rawStatuses.camera) : null;
  const microphone = rawStatuses.microphone ? permissionStateFromDesktopStatus(rawStatuses.microphone) : null;
  return {
    ok: Boolean(result.ok) && !blockedKind,
    camera,
    microphone,
    rawStatuses,
    requested,
    blockedKind,
    canOpenSettings: Boolean(blockedKind),
    ...(reason ? { reason } : {}),
  };
}

export function canUseDesktopMediaPermissions(): boolean {
  const media = desktopBridge()?.mediaPermissions;
  return Boolean(media?.getStatus || media?.request);
}

export async function queryDesktopCapturePermissionState(kind: CapturePermissionKind): Promise<PermissionState | null> {
  const media = desktopBridge()?.mediaPermissions;
  if (typeof media?.getStatus !== "function") return null;
  try {
    const result = await media.getStatus([kind]);
    const entry = entryForKind(result, kind);
    return permissionStateFromDesktopStatus(entry.status);
  } catch {
    return null;
  }
}

export async function requestDesktopCapturePermissions(kindsRaw: CapturePermissionKind[]): Promise<DesktopCapturePermissionResult | null> {
  const media = desktopBridge()?.mediaPermissions;
  if (typeof media?.request !== "function") return null;
  const kinds = normalizeCapturePermissionKinds(kindsRaw);
  try {
    const result = await media.request(kinds);
    return buildDesktopPermissionResult(result, kinds);
  } catch {
    return {
      ok: false,
      camera: kinds.includes("camera") ? "denied" : null,
      microphone: kinds.includes("microphone") ? "denied" : null,
      rawStatuses: {},
      requested: false,
      blockedKind: kinds[0] || null,
      canOpenSettings: false,
      reason: "desktop_bridge_failed",
    };
  }
}

export async function openDesktopMediaPermissionSettings(kind: CapturePermissionKind): Promise<boolean> {
  const media = desktopBridge()?.mediaPermissions;
  if (typeof media?.openSettings !== "function") return false;
  try {
    const result = await media.openSettings(kind);
    return Boolean((result as { ok?: unknown } | null)?.ok);
  } catch {
    return false;
  }
}

export async function queryCapturePermissionState(kind: CapturePermissionKind): Promise<PermissionState | null> {
  const desktopState = await queryDesktopCapturePermissionState(kind);
  if (desktopState) return desktopState;
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status?.state ?? null;
  } catch {
    return null;
  }
}

export function isBusyMediaAccessError(errorRaw: unknown): boolean {
  const name = String((errorRaw as { name?: unknown } | null)?.name ?? "").trim().toLowerCase();
  return name === "notreadableerror" || name === "trackstarterror" || name === "aborterror";
}

export function formatMediaAccessError(kind: MediaAccessKind, errorRaw: unknown): string {
  const name = String((errorRaw as { name?: unknown } | null)?.name ?? "").trim().toLowerCase();
  const accessLabel =
    kind === "camera" ? "камере" : kind === "camera_microphone" ? "камере и микрофону" : "микрофону";
  if (name === "notallowederror" || name === "permissiondeniederror" || name === "securityerror") {
    return `Разрешите доступ к ${accessLabel} в настройках приложения или браузера`;
  }
  if (name === "notfounderror" || name === "devicesnotfounderror") {
    if (kind === "camera") return "Камера не найдена";
    if (kind === "camera_microphone") return "Камера или микрофон не найдены";
    return "Микрофон не найден";
  }
  if (name === "notreadableerror" || name === "trackstarterror" || name === "aborterror") {
    if (kind === "camera") return "Камера сейчас недоступна. Закройте приложение, которое использует её, или повторите освобождение.";
    if (kind === "camera_microphone") {
      return "Камера или микрофон сейчас недоступны. Закройте приложение, которое использует устройство, или повторите освобождение.";
    }
    return "Микрофон сейчас недоступен. Закройте приложение, которое использует его, или повторите освобождение.";
  }
  if (kind === "camera") return "Не удалось получить доступ к камере";
  if (kind === "camera_microphone") return "Не удалось получить доступ к камере и микрофону";
  return "Не удалось получить доступ к микрофону";
}
