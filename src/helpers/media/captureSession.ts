export type CaptureSessionKind = "voice" | "video_note";

export interface CaptureSessionOwner {
  readonly id: number;
  readonly kind: CaptureSessionKind;
}

interface ActiveCaptureSession {
  owner: CaptureSessionOwner;
  stream: MediaStream;
  stop: (reason: "superseded" | "pagehide" | "hidden" | "manual") => void;
}

let nextOwnerId = 0;
let pendingOwner: CaptureSessionOwner | null = null;
let activeSession: ActiveCaptureSession | null = null;
let lifecycleInstalled = false;
let lastReleaseAt = 0;
let hiddenStopTimer: number | null = null;
const leasedStreams = new Set<MediaStream>();
const DESKTOP_HIDDEN_RELEASE_GRACE_MS = 45_000;

function sameOwner(a: CaptureSessionOwner | null | undefined, b: CaptureSessionOwner | null | undefined): boolean {
  return Boolean(a && b && a.id === b.id && a.kind === b.kind);
}

function stopStreamTracks(stream: MediaStream | null | undefined): void {
  try {
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (stream) leasedStreams.delete(stream);
    lastReleaseAt = Date.now();
  } catch {
    // ignore
  }
}

function rememberStream(stream: MediaStream): void {
  leasedStreams.add(stream);
  const forgetIfEnded = () => {
    try {
      const tracks = stream.getTracks();
      if (!tracks.length || tracks.every((track) => track.readyState === "ended")) leasedStreams.delete(stream);
    } catch {
      leasedStreams.delete(stream);
    }
  };
  try {
    for (const track of stream.getTracks()) track.addEventListener("ended", forgetIfEnded, { once: true });
  } catch {
    // ignore
  }
}

function stopAllTrackedStreams(): void {
  for (const stream of Array.from(leasedStreams)) stopStreamTracks(stream);
}

function isDesktopRuntime(): boolean {
  return Boolean((globalThis as { yagodkaDesktop?: unknown }).yagodkaDesktop);
}

function clearHiddenStopTimer(): void {
  if (hiddenStopTimer === null || typeof window === "undefined") return;
  window.clearTimeout(hiddenStopTimer);
  hiddenStopTimer = null;
}

function scheduleHiddenStop(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  clearHiddenStopTimer();
  if (!document.hidden) return;
  if (!isDesktopRuntime()) {
    stopActive("hidden");
    return;
  }
  hiddenStopTimer = window.setTimeout(() => {
    hiddenStopTimer = null;
    if (document.hidden) stopActive("hidden");
  }, DESKTOP_HIDDEN_RELEASE_GRACE_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, ms)));
}

function mediaErrorName(errorRaw: unknown): string {
  return String((errorRaw as { name?: unknown } | null)?.name ?? "").trim().toLowerCase();
}

function isBusyMediaError(errorRaw: unknown): boolean {
  const name = mediaErrorName(errorRaw);
  return name === "notreadableerror" || name === "trackstarterror" || name === "aborterror";
}

async function waitForReleaseCooldown(ms: number): Promise<void> {
  const elapsed = Date.now() - lastReleaseAt;
  if (elapsed >= ms) return;
  await sleep(ms - elapsed);
}

function stopActive(reason: "superseded" | "pagehide" | "hidden" | "manual"): void {
  clearHiddenStopTimer();
  const session = activeSession;
  if (!session) return;
  try {
    session.stop(reason);
  } catch {
    // ignore
  }
  stopStreamTracks(session.stream);
  if (sameOwner(activeSession?.owner, session.owner)) activeSession = null;
}

function installLifecycleGuards(): void {
  if (lifecycleInstalled || typeof window === "undefined" || typeof document === "undefined") return;
  lifecycleInstalled = true;
  try {
    window.addEventListener("pagehide", () => stopActive("pagehide"), { capture: true });
    window.addEventListener("beforeunload", () => stopActive("pagehide"), { capture: true });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) scheduleHiddenStop();
        else clearHiddenStopTimer();
      },
      { capture: true }
    );
  } catch {
    // ignore
  }
}

export function claimCaptureSession(kind: CaptureSessionKind): CaptureSessionOwner | null {
  installLifecycleGuards();
  if (pendingOwner || activeSession) return null;
  pendingOwner = { id: ++nextOwnerId, kind };
  return pendingOwner;
}

export function activateCaptureSession(
  owner: CaptureSessionOwner,
  stream: MediaStream,
  stop: ActiveCaptureSession["stop"]
): boolean {
  installLifecycleGuards();
  if (!sameOwner(pendingOwner, owner) || activeSession) {
    stopStreamTracks(stream);
    return false;
  }
  pendingOwner = null;
  rememberStream(stream);
  activeSession = { owner, stream, stop };
  return true;
}

export function releaseCaptureSession(owner: CaptureSessionOwner | null | undefined): void {
  if (!owner) return;
  if (sameOwner(pendingOwner, owner)) pendingOwner = null;
  const session = activeSession;
  if (!sameOwner(session?.owner, owner)) return;
  stopStreamTracks(session?.stream);
  activeSession = null;
}

export function cancelPendingCaptureSession(owner: CaptureSessionOwner | null | undefined): void {
  if (sameOwner(pendingOwner, owner)) pendingOwner = null;
}

export function hasActiveCaptureSession(owner?: CaptureSessionOwner | null): boolean {
  if (!owner) return Boolean(pendingOwner || activeSession);
  return sameOwner(pendingOwner, owner) || sameOwner(activeSession?.owner, owner);
}

export function describeActiveCaptureSession(): string {
  const kind = activeSession?.owner.kind || pendingOwner?.kind || "";
  if (kind === "voice") return "Сначала завершите запись голоса";
  if (kind === "video_note") return "Сначала завершите запись видео";
  return "Сначала завершите текущую запись";
}

export function forceStopActiveCaptureSession(): void {
  stopActive("manual");
}

export function forceReleaseMediaDevices(): void {
  stopActive("manual");
  stopAllTrackedStreams();
  pendingOwner = null;
}

export async function requestCaptureStream(
  owner: CaptureSessionOwner,
  constraints: MediaStreamConstraints,
  opts?: { fallbackConstraints?: MediaStreamConstraints; retryCooldownMs?: number }
): Promise<MediaStream> {
  installLifecycleGuards();
  if (!sameOwner(pendingOwner, owner)) {
    throw new Error("capture_session_not_pending");
  }
  const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!mediaDevices?.getUserMedia) throw new Error("media_devices_unavailable");
  const cooldownMs = Math.max(120, Math.min(1200, Math.trunc(Number(opts?.retryCooldownMs ?? 320) || 0)));

  await waitForReleaseCooldown(cooldownMs);
  try {
    const stream = await mediaDevices.getUserMedia(constraints);
    rememberStream(stream);
    return stream;
  } catch (error) {
    if (!isBusyMediaError(error)) throw error;
    stopActive("manual");
    stopAllTrackedStreams();
    await sleep(cooldownMs);
    const stream = await mediaDevices.getUserMedia(opts?.fallbackConstraints ?? constraints);
    rememberStream(stream);
    return stream;
  }
}
