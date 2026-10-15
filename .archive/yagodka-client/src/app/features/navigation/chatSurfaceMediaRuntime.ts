import type { ChatSurfaceDeferredDeps } from "./chatSurfaceEventsFeature";
import { recoverFromLazyImportError } from "../../bootstrap/lazyImportRecovery";
import {
  applyVoicePlaybackRate,
  cycleVoicePlaybackRate,
  getVoicePlaybackRate,
  releaseMediaFocus,
  takeMediaFocus,
} from "../../../helpers/media/audioSession";

type ChatSurfaceMediaModule = typeof import("./chatSurfaceMediaActions");
type ChatSurfaceMediaActions = ReturnType<ChatSurfaceMediaModule["createChatSurfaceMediaActions"]>;

function stopEvent(event: MouseEvent): void {
  try {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  } catch {
    // ignore
  }
}

function formatVoiceTime(valueSeconds: number): string {
  const raw = Number(valueSeconds);
  if (!Number.isFinite(raw) || raw <= 0) return "0:00";
  const total = Math.max(0, Math.round(raw));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatVoiceRate(value: number): string {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return "1x";
  if (Math.abs(raw - 1.5) < 0.01) return "1.5x";
  if (Math.abs(raw - 2) < 0.01) return "2x";
  return `${raw}x`;
}

function isVoiceLikeName(wrap: HTMLElement): boolean {
  const audioKind = String(wrap.getAttribute("data-audio-kind") || "").trim().toLowerCase();
  if (audioKind === "voice") return true;
  if (audioKind === "music") return false;
  const name = String(wrap.getAttribute("data-name") || "").trim().toLowerCase();
  return name.startsWith("voice_") || name.startsWith("voice-note") || name.startsWith("voice_note");
}

function setVoiceProgress(wrap: HTMLElement, pct: number): void {
  const safe = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  wrap.style.setProperty("--voice-progress", `${safe}%`);
}

function setVoiceState(wrap: HTMLElement, playBtn: HTMLButtonElement | null, state: "playing" | "paused"): void {
  wrap.setAttribute("data-voice-state", state);
  playBtn?.setAttribute("aria-label", state === "playing" ? "Пауза" : "Воспроизвести");
}

function resolveVoiceDuration(wrap: HTMLElement, audio: HTMLAudioElement): number {
  const raw = Number(audio.duration);
  if (Number.isFinite(raw) && raw > 0) {
    wrap.setAttribute("data-voice-duration", String(raw));
    return raw;
  }
  const stored = Number(wrap.getAttribute("data-voice-duration") || 0);
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

function updateVoiceTime(wrap: HTMLElement, audio: HTMLAudioElement): void {
  const time = wrap.querySelector(".chat-voice-time") as HTMLElement | null;
  const duration = resolveVoiceDuration(wrap, audio);
  if (!time) return;
  const current = Number(audio.currentTime) || 0;
  if (duration > 0) {
    setVoiceProgress(wrap, (current / duration) * 100);
    time.textContent = formatVoiceTime(Math.max(0, duration - current));
    return;
  }
  setVoiceProgress(wrap, 0);
  time.textContent = formatVoiceTime(current);
}

function ensureVoiceFallbackBound(wrap: HTMLElement, audio: HTMLAudioElement, playBtn: HTMLButtonElement | null): void {
  if (wrap.getAttribute("data-voice-fallback-bound") === "1") return;
  wrap.setAttribute("data-voice-fallback-bound", "1");
  const voiceLike = isVoiceLikeName(wrap);
  const time = wrap.querySelector(".chat-voice-time") as HTMLElement | null;

  audio.addEventListener("loadedmetadata", () => {
    const duration = resolveVoiceDuration(wrap, audio);
    if (duration > 0 && time) time.textContent = formatVoiceTime(duration);
    setVoiceProgress(wrap, 0);
    if (voiceLike) applyVoicePlaybackRate(audio);
  });
  audio.addEventListener("timeupdate", () => updateVoiceTime(wrap, audio));
  audio.addEventListener("ended", () => {
    const duration = resolveVoiceDuration(wrap, audio);
    setVoiceProgress(wrap, 0);
    if (duration > 0 && time) time.textContent = formatVoiceTime(duration);
    releaseMediaFocus(audio);
    setVoiceState(wrap, playBtn, "paused");
  });
  audio.addEventListener("pause", () => {
    releaseMediaFocus(audio);
    setVoiceState(wrap, playBtn, "paused");
  });
  audio.addEventListener("play", () => {
    takeMediaFocus(audio);
    if (voiceLike) {
      applyVoicePlaybackRate(audio);
    } else {
      try {
        audio.playbackRate = 1;
      } catch {
        // ignore
      }
    }
    setVoiceState(wrap, playBtn, "playing");
    updateVoiceTime(wrap, audio);
  });
  audio.addEventListener("error", () => {
    releaseMediaFocus(audio);
    setVoiceState(wrap, playBtn, "paused");
  });
}

function toggleResolvedVoicePlayback(voicePlayBtn: HTMLButtonElement, wrap: HTMLElement, audio: HTMLAudioElement): void {
  ensureVoiceFallbackBound(wrap, audio, voicePlayBtn);
  if (audio.paused) {
    takeMediaFocus(audio);
    if (isVoiceLikeName(wrap)) applyVoicePlaybackRate(audio);
    setVoiceState(wrap, voicePlayBtn, "playing");
    void audio.play().catch(() => {
      releaseMediaFocus(audio);
      setVoiceState(wrap, voicePlayBtn, "paused");
    });
    return;
  }
  audio.pause();
  setVoiceState(wrap, voicePlayBtn, "paused");
}

function seekResolvedVoicePlayback(track: HTMLButtonElement, wrap: HTMLElement, audio: HTMLAudioElement, event: MouseEvent): void {
  ensureVoiceFallbackBound(wrap, audio, wrap.querySelector("button.chat-voice-play") as HTMLButtonElement | null);
  const duration = resolveVoiceDuration(wrap, audio);
  if (!duration) return;
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return;
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  try {
    audio.currentTime = Math.max(0, Math.min(duration, (x / rect.width) * duration));
  } catch {
    // ignore
  }
}

export function createLazyChatSurfaceMediaRuntime(deps: ChatSurfaceDeferredDeps) {
  let runtime: ChatSurfaceMediaActions | null = null;
  let runtimePromise: Promise<ChatSurfaceMediaActions | null> | null = null;

  const ensureRuntime = async (): Promise<ChatSurfaceMediaActions | null> => {
    if (runtime) return runtime;
    if (runtimePromise) return runtimePromise;
    runtimePromise = import("./chatSurfaceMediaActions")
      .then((mod) => {
        runtime = mod.createChatSurfaceMediaActions(deps);
        return runtime;
      })
      .catch((err) => {
        recoverFromLazyImportError(err, "chat_surface_media");
        return null;
      })
      .finally(() => {
        if (!runtime) runtimePromise = null;
      });
    return runtimePromise;
  };

  const maybeHandleChatClick = (event: MouseEvent, target: HTMLElement | null): boolean => {
    const voiceSpeedBtn = target?.closest("button.chat-voice-speed") as HTMLButtonElement | null;
    if (voiceSpeedBtn) {
      const wrap = voiceSpeedBtn.closest("div.chat-voice") as HTMLElement | null;
      const audio = wrap?.querySelector("audio.chat-voice-audio") as HTMLAudioElement | null;
      if (wrap && audio) {
        stopEvent(event);
        const next = cycleVoicePlaybackRate(audio.playbackRate || getVoicePlaybackRate());
        voiceSpeedBtn.textContent = formatVoiceRate(next);
        try {
          audio.playbackRate = next;
        } catch {
          // ignore
        }
        return true;
      }
    }

    const voiceTrack = target?.closest("button.chat-voice-track") as HTMLButtonElement | null;
    if (voiceTrack && !voiceTrack.disabled) {
      const wrap = voiceTrack.closest("div.chat-voice") as HTMLElement | null;
      const audio = wrap?.querySelector("audio.chat-voice-audio") as HTMLAudioElement | null;
      if (wrap && audio) {
        stopEvent(event);
        seekResolvedVoicePlayback(voiceTrack, wrap, audio, event);
        return true;
      }
    }

    const voicePlayBtn = target?.closest("button.chat-voice-play") as HTMLButtonElement | null;
    if (voicePlayBtn) {
      const wrap = voicePlayBtn.closest("div.chat-voice") as HTMLElement | null;
      const placeholder = Boolean(wrap?.classList.contains("chat-voice-placeholder"));
      const fileId = String(wrap?.getAttribute("data-file-id") || "").trim();
      if (wrap && placeholder && fileId) {
        stopEvent(event);
        void ensureRuntime().then((loaded) => {
          loaded?.handleVoicePlaceholderClick(voicePlayBtn, wrap);
        });
        return true;
      }
      const audio = wrap?.querySelector("audio.chat-voice-audio") as HTMLAudioElement | null;
      if (wrap && audio && !voicePlayBtn.disabled) {
        stopEvent(event);
        toggleResolvedVoicePlayback(voicePlayBtn, wrap, audio);
        return true;
      }
    }

    const mediaToggle = target?.closest("[data-action='media-toggle']") as HTMLElement | null;
    if (mediaToggle) {
      const preview = mediaToggle.closest("button.chat-file-preview") as HTMLButtonElement | null;
      const video = preview?.querySelector("video.chat-file-video") as HTMLVideoElement | null;
      if (preview && video) {
        stopEvent(event);
        void ensureRuntime().then((loaded) => {
          loaded?.handleMediaToggleClick(preview, video);
        });
        return true;
      }
    }

    const viewBtn = target?.closest("button[data-action='open-file-viewer']") as HTMLButtonElement | null;
    if (viewBtn) {
      if (viewBtn.disabled || viewBtn.getAttribute("data-media-missing") === "1") {
        stopEvent(event);
        return true;
      }
      const url = String(viewBtn.getAttribute("data-url") || "").trim();
      const fileId = String(viewBtn.getAttribute("data-file-id") || "").trim();
      if (url || fileId) {
        stopEvent(event);
        void ensureRuntime().then((loaded) => {
          loaded?.handleOpenFileViewerClick(viewBtn);
        });
        return true;
      }
    }

    return false;
  };

  return {
    maybeHandleChatClick,
  };
}
