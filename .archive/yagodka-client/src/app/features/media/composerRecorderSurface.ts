export type ComposerRecorderKind = "voice" | "video";
export type ComposerRecorderMode = "preview" | "recording";
export type ComposerRecorderPreviewIssue = "no_frame" | "muted" | "ended" | "black_frame";

export interface ComposerRecorderSurfaceState {
  kind: ComposerRecorderKind;
  mode?: ComposerRecorderMode;
  locked?: boolean;
  canceling?: boolean;
  elapsedMs?: number;
  previewStream?: MediaStream | null;
  hint?: string;
  primaryLabel?: string;
  primaryTitle?: string;
}

export interface ComposerRecorderSurface {
  show: (state: ComposerRecorderSurfaceState) => void;
  update: (patch: Partial<ComposerRecorderSurfaceState>) => void;
  clear: () => void;
}

export interface ComposerRecorderSurfaceDeps {
  anchorButton: HTMLElement;
  onStop: () => void;
  onCancel: () => void;
  onPreviewIssue?: (issue: ComposerRecorderPreviewIssue) => void;
}

interface ComposerRecorderSurfaceRefs {
  host: HTMLElement;
  structureKey: string;
  previewStream: MediaStream | null;
  lead: HTMLElement;
  title: HTMLSpanElement;
  time: HTMLSpanElement;
  hint: HTMLSpanElement;
  cancelBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
}

function formatElapsed(msRaw: number | undefined): string {
  const ms = Math.max(0, Number(msRaw) || 0);
  const total = Math.floor(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function labelForKind(kind: ComposerRecorderKind): string {
  return kind === "video" ? "Видео" : "Голос";
}

function hintForState(state: ComposerRecorderSurfaceState): string {
  if (state.hint) return state.hint;
  if (state.kind === "video" && state.mode === "preview") return "Камера готова. Нажмите запись, чтобы начать.";
  if (state.canceling) return "Отпустите, чтобы отменить";
  if (state.locked) return "Запись закреплена";
  return "Отпустите для отправки. Влево — отмена, вверх — замок.";
}

function primaryLabelForState(state: ComposerRecorderSurfaceState): string {
  if (state.primaryLabel) return state.primaryLabel;
  return state.kind === "video" && state.mode === "preview" ? "●" : "✓";
}

function primaryTitleForState(state: ComposerRecorderSurfaceState): string {
  if (state.primaryTitle) return state.primaryTitle;
  return state.kind === "video" && state.mode === "preview" ? "Начать запись" : "Отправить запись";
}

function videoTrackIssue(stream: MediaStream): ComposerRecorderPreviewIssue | null {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) return "no_frame";
    if (track.readyState === "ended") return "ended";
    if (track.muted) return "muted";
  } catch {
    return "no_frame";
  }
  return null;
}

function isNearlyBlackFrame(video: HTMLVideoElement): boolean {
  try {
    if (!video.videoWidth || !video.videoHeight) return false;
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let brightPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = Math.max(data[i] || 0, data[i + 1] || 0, data[i + 2] || 0);
      sum += value;
      if (value > 18) brightPixels += 1;
    }
    const pixels = data.length / 4;
    return pixels > 0 && sum / pixels < 8 && brightPixels <= 2;
  } catch {
    return false;
  }
}

function installPreviewHealthCheck(
  video: HTMLVideoElement,
  stream: MediaStream,
  onPreviewIssue: ((issue: ComposerRecorderPreviewIssue) => void) | undefined
): void {
  if (!onPreviewIssue || typeof window === "undefined") return;
  let done = false;
  const report = (issue: ComposerRecorderPreviewIssue) => {
    if (done) return;
    done = true;
    onPreviewIssue(issue);
  };
  const check = () => {
    if (done) return;
    const trackIssue = videoTrackIssue(stream);
    if (trackIssue) {
      report(trackIssue);
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      report("no_frame");
      return;
    }
    if (isNearlyBlackFrame(video)) {
      report("black_frame");
    }
  };
  window.setTimeout(check, 1600);
  video.addEventListener("emptied", () => report("no_frame"), { once: true });
  video.addEventListener("stalled", () => report("no_frame"), { once: true });
}

function createVideoPreview(
  stream: MediaStream,
  onPreviewIssue?: (issue: ComposerRecorderPreviewIssue) => void
): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "composer-video-self-preview";
  wrap.setAttribute("aria-hidden", "true");

  const video = document.createElement("video");
  video.className = "composer-video-self-preview-video";
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "true");
  try {
    (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
    video.srcObject = stream;
    void video.play?.();
  } catch {
    // The stream is still valid; playback may start after the element is attached.
  }
  installPreviewHealthCheck(video, stream, onPreviewIssue);
  wrap.appendChild(video);
  return wrap;
}

function ensureHost(anchorButton: HTMLElement): HTMLElement | null {
  const wrap = anchorButton.closest(".input-wrap") as HTMLElement | null;
  const row = wrap?.querySelector(".composer-row") as HTMLElement | null;
  if (!wrap || !row) return null;
  const existing = wrap.querySelector(".composer-recorder") as HTMLElement | null;
  if (existing) return existing;
  const host = document.createElement("div");
  host.className = "composer-recorder hidden";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  wrap.insertBefore(host, row);
  return host;
}

function previewStreamForState(state: ComposerRecorderSurfaceState): MediaStream | null {
  return state.kind === "video" ? state.previewStream ?? null : null;
}

function structureKeyForState(state: ComposerRecorderSurfaceState): string {
  const mode = state.mode || "recording";
  return `${state.kind}:${mode}:${previewStreamForState(state) ? "video" : "dot"}`;
}

function createLeadForState(
  state: ComposerRecorderSurfaceState,
  onPreviewIssue?: (issue: ComposerRecorderPreviewIssue) => void
): HTMLElement {
  const previewStream = previewStreamForState(state);
  if (previewStream) {
    return createVideoPreview(previewStream, state.mode === "preview" ? onPreviewIssue : undefined);
  }
  const dot = document.createElement("span");
  dot.className = "composer-recorder-dot";
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

function syncDynamicState(host: HTMLElement, refs: ComposerRecorderSurfaceRefs, state: ComposerRecorderSurfaceState): void {
  host.classList.remove("hidden");
  host.dataset.recorderKind = state.kind;
  host.dataset.recorderMode = state.mode || "recording";
  host.dataset.recorderState = state.canceling ? "cancel" : state.locked ? "locked" : "hold";
  host.dataset.recorderPreviewStable = previewStreamForState(state) ? "true" : "false";

  refs.title.textContent = labelForKind(state.kind);
  refs.time.textContent = formatElapsed(state.elapsedMs);
  refs.hint.textContent = hintForState(state);
  refs.stopBtn.className = `btn btn-primary composer-recorder-btn ${
    state.kind === "video" && state.mode === "preview" ? "composer-recorder-record" : "composer-recorder-send"
  }`;
  refs.stopBtn.title = primaryTitleForState(state);
  refs.stopBtn.setAttribute("aria-label", primaryTitleForState(state));
  refs.stopBtn.textContent = primaryLabelForState(state);
}

export function createComposerRecorderSurface(deps: ComposerRecorderSurfaceDeps): ComposerRecorderSurface {
  const { anchorButton, onStop, onCancel, onPreviewIssue } = deps;
  let current: ComposerRecorderSurfaceState | null = null;
  let refs: ComposerRecorderSurfaceRefs | null = null;

  const resetStructure = () => {
    refs = null;
  };

  const buildStructure = (host: HTMLElement, state: ComposerRecorderSurfaceState): ComposerRecorderSurfaceRefs => {
    const lead = createLeadForState(state, onPreviewIssue);

    const title = document.createElement("span");
    title.className = "composer-recorder-title";

    const time = document.createElement("span");
    time.className = "composer-recorder-time";

    const hint = document.createElement("span");
    hint.className = "composer-recorder-hint";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn composer-recorder-btn composer-recorder-cancel";
    cancelBtn.type = "button";
    cancelBtn.title = "Отменить запись";
    cancelBtn.setAttribute("aria-label", "Отменить запись");
    cancelBtn.textContent = "×";
    cancelBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    });

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onStop();
    });

    host.replaceChildren(lead, title, time, hint, cancelBtn, stopBtn);
    const nextRefs: ComposerRecorderSurfaceRefs = {
      host,
      structureKey: structureKeyForState(state),
      previewStream: previewStreamForState(state),
      lead,
      title,
      time,
      hint,
      cancelBtn,
      stopBtn,
    };
    syncDynamicState(host, nextRefs, state);
    return nextRefs;
  };

  const render = () => {
    const host = ensureHost(anchorButton);
    if (!host) return;
    if (!current) {
      host.classList.add("hidden");
      host.replaceChildren();
      resetStructure();
      return;
    }
    const state = current;
    const structureKey = structureKeyForState(state);
    const previewStream = previewStreamForState(state);
    const needsStructure =
      !refs || refs.host !== host || refs.structureKey !== structureKey || refs.previewStream !== previewStream;
    if (needsStructure) {
      refs = buildStructure(host, state);
      return;
    }
    const stableRefs = refs;
    if (!stableRefs) return;
    syncDynamicState(host, stableRefs, state);
  };

  return {
    show(state) {
      current = { ...state };
      render();
    },
    update(patch) {
      if (!current) return;
      current = { ...current, ...patch };
      render();
    },
    clear() {
      current = null;
      render();
    },
  };
}
