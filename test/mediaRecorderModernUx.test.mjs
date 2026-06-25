import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("media recorder UX: voice/video use shared capture session and composer surface", () => {
  const voice = read("src/app/features/media/composerVoiceRecordFeature.ts");
  const video = read("src/app/features/media/composerVideoNoteRecordFeature.ts");
  const capture = read("src/helpers/media/captureSession.ts");
  const permissions = read("src/helpers/media/permissions.ts");
  const surface = read("src/app/features/media/composerRecorderSurface.ts");
  const layout = read("src/components/layout/createLayout.ts");
  const composerCss = read("src/scss/components.part03.css");

  for (const src of [voice, video]) {
    assert.match(src, /claimCaptureSession/);
    assert.match(src, /activateCaptureSession/);
    assert.match(src, /releaseCaptureSession/);
    assert.match(src, /requestCaptureStream/);
    assert.match(src, /forceReleaseMediaDevices/);
    assert.match(src, /Освободить и повторить/);
    assert.match(src, /createComposerRecorderSurface/);
    assert.doesNotMatch(src, /placement:\s*"center"/);
    assert.doesNotMatch(src, /настройках сайта/);
    assert.doesNotMatch(src, /нажмите ещё раз чтобы остановить/);
  }

  assert.match(voice, /pointerdown/);
  assert.match(voice, /pointermove/);
  assert.match(voice, /pointerup/);
  assert.match(voice, /LOCK_DY_PX/);
  assert.match(voice, /CANCEL_DX_PX/);

  assert.match(video, /preparePreview/);
  assert.match(video, /startRecordingFromPreview/);
  assert.match(video, /mode:\s*"preview"/);
  assert.match(video, /previewStream/);
  assert.match(video, /requestDesktopCapturePermissions/);
  assert.match(video, /openDesktopMediaPermissionSettings/);
  assert.match(video, /Настройки камеры/);
  assert.match(video, /Камера отдаёт чёрный кадр/);
  assert.match(video, /onPreviewIssue/);
  assert.match(video, /Подтвердите доступ к камере и микрофону/);
  assert.match(video, /Проверить снова/);
  assert.match(video, /videoNoteBtn\.addEventListener\("click"/);
  assert.doesNotMatch(video, /pointerdown/);

  for (const src of [voice]) {
    assert.match(src, /pointerdown/);
    assert.match(src, /pointermove/);
    assert.match(src, /pointerup/);
    assert.match(src, /LOCK_DY_PX/);
    assert.match(src, /CANCEL_DX_PX/);
  }

  assert.match(capture, /pagehide/);
  assert.match(capture, /visibilitychange/);
  assert.match(capture, /DESKTOP_HIDDEN_RELEASE_GRACE_MS/);
  assert.match(capture, /isDesktopRuntime/);
  assert.match(capture, /scheduleHiddenStop/);
  assert.match(capture, /document\.hidden\)\s*scheduleHiddenStop/);
  assert.match(capture, /stopStreamTracks/);
  assert.match(capture, /leasedStreams/);
  assert.match(capture, /retryCooldownMs/);
  assert.match(permissions, /media\?\.request/);
  assert.match(permissions, /media\?\.getStatus/);
  assert.match(permissions, /openDesktopMediaPermissionSettings/);
  assert.match(permissions, /настройках приложения или браузера/);
  assert.match(surface, /composer-recorder/);
  assert.match(surface, /composer-video-self-preview/);
  assert.match(surface, /isNearlyBlackFrame/);
  assert.match(surface, /playsinline/);
  assert.match(surface, /ComposerRecorderSurfaceRefs/);
  assert.match(surface, /structureKeyForState/);
  assert.match(surface, /syncDynamicState/);
  assert.match(surface, /refs\.previewStream !== previewStream/);
  assert.match(surface, /dataset\.recorderPreviewStable/);
  assert.match(surface, /Отпустите для отправки/);

  assert.match(layout, /composer-actions composer-actions-media/);
  assert.match(layout, /class:\s*"composer-field"\s*},\s*\[composerActionsLeft,\s*input,\s*composerActionsMedia\]/);
  assert.doesNotMatch(layout, /\[videoNoteBtn,\s*voiceBtn,\s*sendBtn\]/);
  assert.match(composerCss, /\.composer-field\s+\.btn\.composer-action\.composer-voice/);
  assert.match(composerCss, /\.composer-field\s+\.btn\.composer-action\.composer-video-note/);
  assert.match(composerCss, /\.composer-field\s+\.btn\.composer-action\.composer-voice,\s*[\s\S]*?\.composer-field\s+\.btn\.composer-action\.composer-video-note\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(composerCss, /\.composer-actions-right\s*\{[\s\S]*?display:\s*none;/);
  assert.match(composerCss, /\.input-wrap\.composer-has-text\s+\.composer-actions-right\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(composerCss, /\.input-wrap\.composer-has-text\s+\.composer-actions-media\s+\.btn\.composer-voice:not\(\.is-recording\)/);
  assert.match(composerCss, /\.btn\.composer-video-note\.is-previewing/);
  assert.match(composerCss, /\.btn\.composer-video-note\.is-recording-locked::after/);
});

test("media recorder UX: video notes auto-send like voice notes", () => {
  const video = read("src/app/features/media/composerVideoNoteRecordFeature.ts");
  const fileSend = read("src/app/features/files/fileSendModalFeature.ts");
  assert.match(video, /__yagodka_auto_send = "video_note_record"/);
  assert.match(fileSend, /autoSendKind === "voice_record" \|\| autoSendKind === "video_note_record"/);
});
