import { getStoredSessionToken, isSessionAutoAuthBlocked } from "../../../helpers/auth/session";
import { pauseActiveMedia } from "../../../helpers/media/audioSession";
import {
  activateCaptureSession,
  cancelPendingCaptureSession,
  claimCaptureSession,
  describeActiveCaptureSession,
  forceReleaseMediaDevices,
  hasActiveCaptureSession,
  releaseCaptureSession,
  requestCaptureStream,
  type CaptureSessionOwner,
} from "../../../helpers/media/captureSession";
import {
  canUseDesktopMediaPermissions,
  formatMediaAccessError,
  openDesktopMediaPermissionSettings,
  queryCapturePermissionState,
  requestDesktopCapturePermissions,
  type CapturePermissionKind,
  type DesktopCapturePermissionResult,
} from "../../../helpers/media/permissions";
import { nowTs } from "../../../helpers/time";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";
import { createComposerRecorderSurface } from "./composerRecorderSurface";
import type { ComposerRecorderPreviewIssue } from "./composerRecorderSurface";
import type { ToastFn } from "./composerVoiceRecordFeature";

export interface ComposerVideoNoteRecordFeatureDeps {
  store: Store<AppState>;
  videoNoteBtn: HTMLButtonElement;
  showToast: ToastFn;
  openFileSendModal: (files: File[], target: TargetRef) => void;
}

export interface ComposerVideoNoteRecordFeature {
  bind: () => void;
  stop: () => void;
}

function pickSupportedMimeType(candidates: string[]): string | null {
  const MR = (globalThis as any).MediaRecorder as typeof MediaRecorder | undefined;
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  for (const c of candidates) {
    const t = String(c || "").trim();
    if (!t) continue;
    try {
      if (MR.isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return null;
}

function extForMime(mimeRaw: string): string {
  const mt = String(mimeRaw || "").toLowerCase();
  if (!mt) return "webm";
  if (mt.includes("webm")) return "webm";
  if (mt.includes("mp4")) return "mp4";
  if (mt.includes("ogg")) return "ogv";
  return "webm";
}

function hasLiveTrack(stream: MediaStream, kind: "audio" | "video"): boolean {
  try {
    return stream.getTracks().some((track) => track.kind === kind && track.readyState === "live");
  } catch {
    return false;
  }
}

export function createComposerVideoNoteRecordFeature(deps: ComposerVideoNoteRecordFeatureDeps): ComposerVideoNoteRecordFeature {
  const { store, videoNoteBtn, showToast, openFileSendModal } = deps;

  const baseTitle = videoNoteBtn.getAttribute("title") || "Видео";
  const baseAriaLabel = videoNoteBtn.getAttribute("aria-label") || "Записать видеосообщение";
  let lastUiState: string | null = null;

  let captureOwner: CaptureSessionOwner | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let startedAt = 0;
  let recordingTarget: TargetRef | null = null;
  let recordCanceled = false;
  let recordingLocked = false;
  let previewPreparing = false;
  let elapsedTimer: number | null = null;
  let stopFallbackTimer: number | null = null;
  let previewIssueStream: MediaStream | null = null;

  const recorderSurface = createComposerRecorderSurface({
    anchorButton: videoNoteBtn,
    onStop: () => {
      if (recorder) {
        finishRecording();
        return;
      }
      void startRecordingFromPreview({ locked: true });
    },
    onCancel: () => finishRecording({ cancel: true }),
    onPreviewIssue: (issue) => handlePreviewIssue(issue),
  });

  const applyPermissionUi = (mic: PermissionState | null, cam: PermissionState | null) => {
    const ui =
      mic === "denied" || cam === "denied"
        ? "denied"
        : mic === "granted" && cam === "granted"
          ? "granted"
          : mic || cam
            ? "prompt"
            : null;
    if (ui === lastUiState) return;
    lastUiState = ui;
    try {
      if (ui) videoNoteBtn.setAttribute("data-media-perm", ui);
      else videoNoteBtn.removeAttribute("data-media-perm");
      if (ui === "denied") {
        const deniedMic = mic === "denied";
        const deniedCam = cam === "denied";
        const suffix = deniedCam && deniedMic ? " (нет доступа к камере и микрофону)" : deniedCam ? " (нет доступа к камере)" : " (нет доступа к микрофону)";
        videoNoteBtn.setAttribute("title", `${baseTitle}${suffix}`);
        videoNoteBtn.setAttribute("aria-label", `${baseAriaLabel}.${suffix}`);
      } else {
        videoNoteBtn.setAttribute("title", baseTitle);
        videoNoteBtn.setAttribute("aria-label", baseAriaLabel);
      }
    } catch {
      // ignore
    }
  };

  const syncPermissionUi = async () => {
    const mic = await queryCapturePermissionState("microphone");
    const cam = await queryCapturePermissionState("camera");
    applyPermissionUi(mic, cam);
  };

  const setRecordingUi = (on: boolean) => {
    const active = on || Boolean(stream) || previewPreparing;
    try {
      videoNoteBtn.classList.toggle("is-recording", on);
      videoNoteBtn.classList.toggle("is-recording-locked", on && recordingLocked);
      videoNoteBtn.classList.toggle("is-previewing", !on && Boolean(stream));
      videoNoteBtn.classList.toggle("is-preparing", previewPreparing);
      videoNoteBtn.setAttribute("aria-pressed", active ? "true" : "false");
    } catch {
      // ignore
    }
  };

  const startElapsedTimer = () => {
    if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
    elapsedTimer = window.setInterval(() => {
      if (!startedAt) return;
      recorderSurface.update({ elapsedMs: Date.now() - startedAt });
    }, 250);
  };

  const stopElapsedTimer = () => {
    if (elapsedTimer !== null) {
      window.clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  };

  const reset = () => {
    if (stopFallbackTimer !== null) {
      window.clearTimeout(stopFallbackTimer);
      stopFallbackTimer = null;
    }
    recorder = null;
    chunks = [];
    startedAt = 0;
    recordingTarget = null;
    recordCanceled = false;
    recordingLocked = false;
    previewPreparing = false;
    captureOwner = null;
    stream = null;
    previewIssueStream = null;
    stopElapsedTimer();
    setRecordingUi(false);
    recorderSurface.clear();
  };

  function finishRecording(opts?: { cancel?: boolean }) {
    if (opts?.cancel) recordCanceled = true;
    const current = recorder;
    if (!current) {
      cancelPendingCaptureSession(captureOwner);
      releaseCaptureSession(captureOwner);
      reset();
      return;
    }
    try {
      if (current.state !== "inactive") {
        current.stop();
        if (stopFallbackTimer !== null) window.clearTimeout(stopFallbackTimer);
        stopFallbackTimer = window.setTimeout(() => {
          stopFallbackTimer = null;
          releaseCaptureSession(captureOwner);
          reset();
        }, 1400);
      } else {
        releaseCaptureSession(captureOwner);
        reset();
      }
    } catch {
      releaseCaptureSession(captureOwner);
      reset();
    }
  }

  const stop = () => finishRecording({ cancel: true });

  const showMediaStatus = (message: string, opts?: Parameters<ToastFn>[1]) => {
    store.set({ status: message });
    showToast(message, opts);
  };

  const permissionRetryAction = (target: TargetRef, primary = true) => ({
    id: "media_permission_retry",
    label: "Проверить снова",
    primary,
    onClick: () => void preparePreview(target),
  });

  const openSettingsAction = (kind: CapturePermissionKind, primary = false) => ({
    id: `media_open_${kind}_settings`,
    label: kind === "camera" ? "Настройки камеры" : "Настройки микрофона",
    primary,
    onClick: () => void openDesktopMediaPermissionSettings(kind),
  });

  function desktopPermissionMessage(result: DesktopCapturePermissionResult): string {
    const blocked = result.blockedKind;
    const status = blocked ? result.rawStatuses[blocked] : null;
    if (status === "restricted") {
      return blocked === "microphone"
        ? "Доступ к микрофону ограничен macOS. Разрешите Ягодке в настройках приватности."
        : "Доступ к камере ограничен macOS. Разрешите Ягодке в настройках приватности.";
    }
    if (blocked === "microphone") return "Разрешите Ягодке доступ к микрофону в настройках macOS";
    if (blocked === "camera") return "Разрешите Ягодке доступ к камере в настройках macOS";
    return "macOS не выдала доступ к камере и микрофону. Проверьте настройки приватности.";
  }

  function showDesktopPermissionBlocked(result: DesktopCapturePermissionResult, target: TargetRef) {
    const blocked = result.blockedKind || "camera";
    const actions = [openSettingsAction(blocked, true), permissionRetryAction(target, false)];
    showMediaStatus(desktopPermissionMessage(result), { kind: "warn", timeoutMs: 11000, actions });
  }

  function showPreviewIssue(issue: ComposerRecorderPreviewIssue, target: TargetRef | null) {
    const message =
      issue === "black_frame"
        ? "Камера отдаёт чёрный кадр. Проверьте, включена ли камера, шторка или виртуальная камера."
        : "Камера подключена, но изображение не поступает. Проверьте доступ камеры и попробуйте снова.";
    const actions: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }> = [];
    if (target) {
      actions.push({
        id: "media_preview_retry",
        label: "Повторить",
        primary: true,
        onClick: () => {
          forceReleaseMediaDevices();
          void preparePreview(target);
        },
      });
    }
    if (canUseDesktopMediaPermissions()) actions.push(openSettingsAction("camera"));
    showMediaStatus(message, { kind: "warn", timeoutMs: 10000, actions });
  }

  function handlePreviewIssue(issue: ComposerRecorderPreviewIssue) {
    const currentStream = stream;
    if (!currentStream || previewIssueStream === currentStream) return;
    previewIssueStream = currentStream;
    showPreviewIssue(issue, recordingTarget);
  }

  function ensureSendContext(): TargetRef | null {
    const st = store.get();
    if (st.conn !== "connected") {
      showMediaStatus("Нет соединения", { kind: "warn", timeoutMs: 4500 });
      return null;
    }
    if (!st.authed) {
      const token = getStoredSessionToken();
      if (token) {
        if (isSessionAutoAuthBlocked()) {
          store.set({
            authMode: st.authRememberedId ? "login" : "register",
            modal: { kind: "auth", message: "Сессия активна в другом окне. Чтобы продолжить здесь — войдите снова." },
          });
          return null;
        }
        showMediaStatus("Авторизация… подождите", { kind: "info", timeoutMs: 3500 });
        return null;
      }
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return null;
    }
    const target = st.selected;
    if (!target) {
      showMediaStatus("Выберите контакт или чат слева", { kind: "info", timeoutMs: 4500 });
      return null;
    }
    if (st.modal && st.modal.kind !== "context_menu") {
      showMediaStatus("Сначала закройте окно", { kind: "info", timeoutMs: 4500 });
      return null;
    }
    return target;
  }

  async function preparePreview(target: TargetRef) {
    if (previewPreparing) {
      showMediaStatus("Камера уже включается…", { kind: "info", timeoutMs: 2500 });
      return;
    }
    if (recorder) {
      showMediaStatus("Сначала завершите запись видео", { kind: "info", timeoutMs: 3500 });
      return;
    }
    if (stream && captureOwner) {
      recorderSurface.show({
        kind: "video",
        mode: "preview",
        previewStream: stream,
        elapsedMs: 0,
        primaryLabel: "●",
        primaryTitle: "Начать запись",
      });
      setRecordingUi(false);
      return;
    }
    if (hasActiveCaptureSession()) {
      showMediaStatus(describeActiveCaptureSession(), { kind: "info", timeoutMs: 3500 });
      return;
    }
    pauseActiveMedia();
    const owner = claimCaptureSession("video_note");
    if (!owner) {
      showMediaStatus(describeActiveCaptureSession(), { kind: "info", timeoutMs: 3500 });
      return;
    }
    captureOwner = owner;
    recordCanceled = false;
    recordingLocked = false;
    previewPreparing = true;
    setRecordingUi(false);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      cancelPendingCaptureSession(owner);
      reset();
      showMediaStatus("Запись доступна только по HTTPS", { kind: "warn", timeoutMs: 7000 });
      return;
    }
    const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.getUserMedia) {
      cancelPendingCaptureSession(owner);
      reset();
      showMediaStatus("Запись не поддерживается в этом браузере", { kind: "warn", timeoutMs: 6000 });
      return;
    }
    const MR = (globalThis as any).MediaRecorder as typeof MediaRecorder | undefined;
    if (!MR) {
      cancelPendingCaptureSession(owner);
      reset();
      showMediaStatus("Запись не поддерживается в этом браузере", { kind: "warn", timeoutMs: 6000 });
      return;
    }

    const desktopPerm = await requestDesktopCapturePermissions(["camera", "microphone"]);
    if (desktopPerm) {
      applyPermissionUi(desktopPerm.microphone, desktopPerm.camera);
      if (!desktopPerm.ok) {
        cancelPendingCaptureSession(owner);
        reset();
        showDesktopPermissionBlocked(desktopPerm, target);
        return;
      }
      if (desktopPerm.requested) {
        showMediaStatus("Доступ к камере и микрофону подтверждён", { kind: "success", timeoutMs: 2400 });
      }
    }

    const micPerm = desktopPerm?.microphone ?? (await queryCapturePermissionState("microphone"));
    const camPerm = desktopPerm?.camera ?? (await queryCapturePermissionState("camera"));
    applyPermissionUi(micPerm, camPerm);
    if (micPerm === "denied") {
      cancelPendingCaptureSession(owner);
      reset();
      showMediaStatus("Разрешите микрофон в настройках приложения или браузера, затем нажмите видео ещё раз", {
        kind: "warn",
        timeoutMs: 9000,
        actions: canUseDesktopMediaPermissions() ? [openSettingsAction("microphone", true), permissionRetryAction(target, false)] : [permissionRetryAction(target)],
      });
      return;
    }
    if (camPerm === "denied") {
      cancelPendingCaptureSession(owner);
      reset();
      showMediaStatus("Разрешите камеру в настройках приложения или браузера, затем нажмите видео ещё раз", {
        kind: "warn",
        timeoutMs: 9000,
        actions: canUseDesktopMediaPermissions() ? [openSettingsAction("camera", true), permissionRetryAction(target, false)] : [permissionRetryAction(target)],
      });
      return;
    }
    if (micPerm !== "granted" || camPerm !== "granted") {
      showMediaStatus("Подтвердите доступ к камере и микрофону", { kind: "info", timeoutMs: 5000 });
    }

    let nextStream: MediaStream;
    try {
      nextStream = await requestCaptureStream(
        owner,
        {
          video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: "user" },
          audio: true,
        },
        {
          retryCooldownMs: 420,
          fallbackConstraints: {
            video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: "user" },
            audio: true,
          },
        }
      );
    } catch (error) {
      cancelPendingCaptureSession(owner);
      showMediaStatus(formatMediaAccessError("camera_microphone", error), {
        kind: "warn",
        timeoutMs: 9000,
        actions: [
          {
            id: "media_release_retry",
            label: "Освободить и повторить",
            primary: true,
            onClick: () => {
              forceReleaseMediaDevices();
              void preparePreview(target);
            },
          },
        ],
      });
      void syncPermissionUi();
      reset();
      return;
    }

    if (
      !activateCaptureSession(owner, nextStream, () => {
        recordCanceled = true;
        finishRecording({ cancel: true });
      })
    ) {
      reset();
      showMediaStatus(describeActiveCaptureSession(), { kind: "info", timeoutMs: 3500 });
      return;
    }
    stream = nextStream;
    recordingTarget = target;
    previewIssueStream = null;
    previewPreparing = false;
    setRecordingUi(false);
    recorderSurface.show({
      kind: "video",
      mode: "preview",
      previewStream: nextStream,
      elapsedMs: 0,
      primaryLabel: "●",
      primaryTitle: "Начать запись",
    });
    showMediaStatus("Камера готова", { kind: "success", timeoutMs: 2200 });
  }

  async function startRecordingFromPreview(opts?: { locked?: boolean }) {
    if (recorder) return;
    const owner = captureOwner;
    const currentStream = stream;
    const target = recordingTarget;
    if (!owner || !currentStream || !target) {
      const nextTarget = ensureSendContext();
      if (nextTarget) await preparePreview(nextTarget);
      return;
    }
    const MR = (globalThis as any).MediaRecorder as typeof MediaRecorder | undefined;
    if (!MR) {
      releaseCaptureSession(owner);
      reset();
      showMediaStatus("Запись не поддерживается в этом браузере", { kind: "warn", timeoutMs: 6000 });
      return;
    }
    if (!hasLiveTrack(currentStream, "video") || !hasLiveTrack(currentStream, "audio")) {
      releaseCaptureSession(owner);
      reset();
      showMediaStatus("Камера или микрофон стали недоступны. Включите видео ещё раз.", {
        kind: "warn",
        timeoutMs: 8000,
        actions: [{ id: "media_preview_retry", label: "Включить снова", primary: true, onClick: () => void preparePreview(target) }],
      });
      return;
    }
    recordCanceled = false;
    recordingLocked = Boolean(opts?.locked);
    chunks = [];
    startedAt = Date.now();

    const mimeType =
      pickSupportedMimeType([
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ]) || undefined;
    try {
      recorder = mimeType ? new MR(currentStream, { mimeType }) : new MR(currentStream);
    } catch {
      releaseCaptureSession(owner);
      reset();
      showMediaStatus("Не удалось начать запись", { kind: "error", timeoutMs: 6000 });
      return;
    }

    const currentRecorder = recorder;
    currentRecorder.addEventListener("dataavailable", (e) => {
      try {
        const data = (e as BlobEvent).data;
        if (data && data.size > 0) chunks.push(data);
      } catch {
        // ignore
      }
    });

    currentRecorder.addEventListener(
      "stop",
      () => {
        if (stopFallbackTimer !== null) {
          window.clearTimeout(stopFallbackTimer);
          stopFallbackTimer = null;
        }
        const tgt = recordingTarget;
        const canceled = recordCanceled;
        const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
        const nextChunks = chunks.slice();
        const type = currentRecorder.mimeType || mimeType || "video/webm";
        releaseCaptureSession(owner);
        reset();
        if (canceled) {
          showMediaStatus("Запись отменена", { kind: "info", timeoutMs: 1800 });
          return;
        }
        if (!tgt) return;
        if (!nextChunks.length || elapsedMs < 900) {
          showMediaStatus("Видео слишком короткое", { kind: "info", timeoutMs: 2500 });
          return;
        }
        const blob = new Blob(nextChunks, { type });
        const ext = extForMime(blob.type);
        const name = `video_note_${nowTs()}.${ext}`;
        const file = new File([blob], name, { type: blob.type || "video/webm" });
        try {
          (file as any).__yagodka_auto_send = "video_note_record";
        } catch {
          // ignore
        }
        openFileSendModal([file], tgt);
        const seconds = Math.max(1, Math.round(elapsedMs / 1000));
        showMediaStatus(`Видео ${seconds} сек`, { kind: "success", timeoutMs: 2200 });
      },
      { once: true }
    );

    try {
      currentRecorder.start();
    } catch {
      releaseCaptureSession(owner);
      reset();
      showMediaStatus("Не удалось начать запись", { kind: "error", timeoutMs: 6000 });
      return;
    }
    setRecordingUi(true);
    recorderSurface.show({
      kind: "video",
      mode: "recording",
      locked: recordingLocked,
      elapsedMs: 0,
      previewStream: currentStream,
      hint: "Идёт запись. Нажмите ✓ для отправки или × для отмены.",
    });
    startElapsedTimer();
  }

  const bind = () => {
    void syncPermissionUi();
    try {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void syncPermissionUi();
      });
      window.addEventListener("focus", () => void syncPermissionUi());
    } catch {
      // ignore
    }

    videoNoteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (previewPreparing) return;
      if (recorder) {
        finishRecording();
        return;
      }
      if (stream) {
        void startRecordingFromPreview({ locked: true });
        return;
      }
      const target = ensureSendContext();
      if (!target) return;
      void preparePreview(target);
    });
  };

  return { bind, stop };
}
