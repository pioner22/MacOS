const VOICE_RATE_KEY = "yagodka.voice.playback_rate.v1";

const VOICE_RATES = [1, 1.5, 2] as const;
type VoiceRate = (typeof VOICE_RATES)[number];

let activeMedia: HTMLMediaElement | null = null;
let pendingVoiceAutoplay: { fileId: string; ts: number } | null = null;

const AUTOPLAY_TTL_MS = 30_000;

function normalizeVoiceRate(value: unknown): VoiceRate {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  if (raw <= 1.25) return 1;
  if (raw <= 1.75) return 1.5;
  return 2;
}

function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function getVoicePlaybackRate(): VoiceRate {
  const raw = readLocalStorage(VOICE_RATE_KEY);
  return normalizeVoiceRate(raw ? Number(raw) : 1);
}

export function setVoicePlaybackRate(value: unknown): VoiceRate {
  const rate = normalizeVoiceRate(value);
  writeLocalStorage(VOICE_RATE_KEY, String(rate));
  return rate;
}

export function cycleVoicePlaybackRate(current?: unknown): VoiceRate {
  const cur = normalizeVoiceRate(current ?? getVoicePlaybackRate());
  const idx = VOICE_RATES.indexOf(cur);
  const next = VOICE_RATES[(idx + 1) % VOICE_RATES.length] || 1;
  return setVoicePlaybackRate(next);
}

export function applyVoicePlaybackRate(media: HTMLMediaElement): void {
  try {
    media.playbackRate = getVoicePlaybackRate();
  } catch {
    // ignore
  }
}

export function takeMediaFocus(media: HTMLMediaElement): void {
  const prev = activeMedia;
  if (prev && prev !== media) {
    try {
      prev.pause();
    } catch {
      // ignore
    }
  }
  activeMedia = media;
}

export function releaseMediaFocus(media: HTMLMediaElement): void {
  if (activeMedia !== media) return;
  activeMedia = null;
}

export function pauseActiveMedia(): void {
  try {
    activeMedia?.pause();
  } catch {
    // ignore
  }
}

export function requestVoiceAutoplay(fileId: string): void {
  const fid = String(fileId || "").trim();
  if (!fid) return;
  pendingVoiceAutoplay = { fileId: fid, ts: Date.now() };
}

export function consumeVoiceAutoplay(fileId: string): boolean {
  const fid = String(fileId || "").trim();
  if (!fid) return false;
  const pending = pendingVoiceAutoplay;
  if (!pending || pending.fileId !== fid) return false;
  pendingVoiceAutoplay = null;
  return Date.now() - pending.ts <= AUTOPLAY_TTL_MS;
}

