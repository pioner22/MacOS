import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

test("calls: header buttons have call actions", async () => {
  const src = await readFile(path.resolve("src/components/header/renderHeader.ts"), "utf8");
  assert.match(src, /call-start-audio/);
  assert.match(src, /call-start-video/);
});

test("calls: modal renderer supports kind=call", async () => {
  const src = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.match(src, /createLazyCallModalRuntime/);
  assert.match(src, /state\.modal\?\.kind\s*===\s*["']call["']/);
});

test("calls: CSS contains modal-call layout", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.modal\.modal-call/);
  assert.match(css, /html\.call-surface-open\s+\.overlay\.overlay-viewer\s*\{[\s\S]*?height:\s*var\(--app-vh,\s*100dvh\)/);
  assert.match(css, /html\.call-surface-open\s+\.overlay\.overlay-viewer\s+\.modal\.modal-call\s*\{[\s\S]*?width:\s*100dvw;[\s\S]*?max-width:\s*100dvw/);
  assert.match(css, /\.call-controls\s*\{[\s\S]*?padding-bottom:\s*max\([\s\S]*?--app-frame-bottom-inset[\s\S]*?--app-gap-bottom/);
  assert.match(css, /\.call-control-buttons\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(css, /\.call-frame/);
  assert.match(css, /\.call-permission/);
  assert.match(css, /\.call-device/);
  assert.match(css, /\.call-live-backdrop/);
  assert.match(css, /\.call-jitsi-ready iframe/);
});

test("calls: ringing stays on call card until peer accepts", async () => {
  const src = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  assert.match(src, /const shouldShowMeeting = Boolean\(joinUrl\) && phase === "active";/);
  assert.match(src, /showHero\(\);\n\s*return;/);
});

test("calls: call_invite is not blocked by toast dedupe", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.ok(!/if \(!showToastHere\) return true;/.test(src));
});

test("calls: media permission gate asks from the call modal", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const renderSrc = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.doesNotMatch(src, /placement:\s*"center"/);
  assert.match(src, /phase:\s*"permission"/);
  assert.match(src, /permissionToken/);
  assert.match(src, /requestMediaAccess/);
  assert.match(src, /navigator\.mediaDevices\.getUserMedia\(buildCallMediaConstraints\(mode\)\)/);
  assert.match(src, /requestDesktopCapturePermissions/);
  assert.match(src, /разрешение закреплено за Safari\/Chrome/);
  assert.match(src, /Инструкция iPhone/);
  assert.match(src, /настройки сайта или браузера/);
  assert.match(src, /queryCapturePermissionState/);
  assert.match(modalSrc, /call-permission/);
  assert.match(modalSrc, /settingsLabel/);
  assert.match(modalSrc, /onRequestMediaAccess/);
  assert.match(modalSrc, /onOpenMediaSettings/);
  assert.match(renderSrc, /onCallRequestMediaAccess/);
  assert.match(renderSrc, /onCallOpenMediaSettings/);
});

test("calls: client sends call_invite_ack and dedupes same call invite", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.match(src, /call_invite_ack/);
  assert.match(src, /currentCallId === callId/);
});

test("calls: accepted call stays in the in-app call surface", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.doesNotMatch(src, /isMobileLikeUi/);
  assert.doesNotMatch(src, /window\.open\(u, "_blank", "noopener,noreferrer"\)/);
  assert.match(src, /phase:\s*"active"/);
});

test("calls: ringing calls have a bounded cleanup timeout", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.match(src, /CALL_RING_TIMEOUT_MS = 45_000/);
  assert.match(src, /startCallRingingTimeout\(callId, false\)/);
  assert.match(src, /startCallRingingTimeout\(callId, true\)/);
  assert.match(src, /clearCallRingingTimeout\(callId\)/);
  assert.match(src, /Вызов пропущен/);
});

test("calls: modal exposes speaker route control with iPhone fallback", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(modalSrc, /data-icon": "speaker"/);
  assert.match(modalSrc, /aria-pressed": "false"/);
  assert.match(modalSrc, /setAudioOutputDevice/);
  assert.match(modalSrc, /Переключаем на динамик/);
  assert.match(modalSrc, /На iPhone аудиовывод переключается системно/);
  assert.match(css, /\.call-ctl\[data-icon="speaker"\]::before/);
  assert.match(css, /\.call-ctl-route-unsupported/);
});

test("calls: control buttons expose active, busy and tap feedback states", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(modalSrc, /call-control-status/);
  assert.match(modalSrc, /setControlStatus/);
  assert.match(modalSrc, /pulseControl/);
  assert.match(modalSrc, /call-ctl-pending/);
  assert.match(modalSrc, /Микрофон выключен/);
  assert.match(modalSrc, /Камера включена/);
  assert.match(modalSrc, /Принимаем вызов/);
  assert.match(css, /\.call-control-status/);
  assert.match(css, /\.call-control-buttons/);
  assert.match(css, /\.call-ctl-on::after/);
  assert.match(css, /\.call-ctl-off::after/);
  assert.match(css, /\.call-ctl-success/);
  assert.match(css, /\.call-ctl-error/);
  assert.match(css, /@keyframes call-control-spin/);
});

test("calls: jitsi external API uses configured meet host", async () => {
  const src = await readFile(path.resolve("src/helpers/calls/jitsiExternalApi.ts"), "utf8");
  assert.ok(!/meet\.jit\.si/.test(src));
  assert.match(src, /return host;/);
});

test("calls: modal wires Jitsi quality telemetry", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const telemetrySrc = await readFile(path.resolve("src/helpers/calls/callQualityTelemetry.ts"), "utf8");
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(modalSrc, /watchJitsiQuality/);
  assert.match(modalSrc, /call-quality/);
  assert.match(telemetrySrc, /videoQualityChanged/);
  assert.match(telemetrySrc, /p2pStatusChanged/);
  assert.match(telemetrySrc, /peerConnectionFailure/);
  assert.match(telemetrySrc, /getRoomsInfo/);
  assert.match(css, /\.call-quality/);
});

test("calls: modal wires Jitsi media policy", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const policySrc = await readFile(path.resolve("src/helpers/calls/jitsiMediaPolicy.ts"), "utf8");
  assert.match(modalSrc, /buildJitsiMediaPolicy\(mode\)/);
  assert.match(modalSrc, /userInfo:\s*\{\s*displayName\s*\}/);
  assert.match(modalSrc, /defaultLocalDisplayName:\s*displayName/);
  assert.match(policySrc, /maxBitratesVideo/);
  assert.match(policySrc, /enableLayerSuspension/);
  assert.match(policySrc, /saveData/);
  assert.match(policySrc, /prejoinConfig/);
  assert.match(policySrc, /requireDisplayName:\s*false/);
  assert.match(policySrc, /enableWelcomePage:\s*false/);
  assert.match(policySrc, /notifications:\s*\[\]/);
  assert.match(policySrc, /hideConferenceSubject:\s*true/);
  assert.match(policySrc, /disableSelfViewSettings:\s*true/);
  assert.match(modalSrc, /DISABLE_JOIN_LEAVE_NOTIFICATIONS:\s*true/);
  assert.match(modalSrc, /MOBILE_APP_PROMO:\s*false/);
  assert.match(modalSrc, /CONNECTION_INDICATOR_DISABLED:\s*true/);
});

test("calls: modal keeps a dark live backdrop until Jitsi is ready", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(modalSrc, /call-live-backdrop/);
  assert.match(modalSrc, /videoConferenceJoined/);
  assert.match(modalSrc, /markMeetingReady/);
  assert.match(modalSrc, /scheduleJitsiReadyWatchdog/);
  assert.match(modalSrc, /camera \*; microphone \*/);
  assert.match(modalSrc, /call-jitsi-ready/);
  assert.match(modalSrc, /isAndroidNativeCallSurface/);
  assert.match(modalSrc, /JITSI_ANDROID_NATIVE_FALLBACK_DELAY_MS = 7200/);
  assert.match(modalSrc, /if \(nativeAndroid\) \{\s*updateLiveStatus\("Ждём видеомост…"\);\s*return;\s*\}/);
  assert.match(modalSrc, /if \(nativeAndroid\) \{\s*markMeetingFailed\("Видеомост не загрузился"\);\s*return;\s*\}/);
  assert.match(css, /\.call-jitsi iframe,\n\.call-iframe-shell iframe/);
  assert.match(css, /opacity:\s*0;\n\s*pointer-events:\s*none;/);
  assert.match(css, /\.call-jitsi-ready \.call-live-backdrop/);
  assert.match(css, /\.call-iframe-ready \.call-live-backdrop/);
  assert.match(css, /\.call-iframe-loaded \.call-live-backdrop/);
  assert.match(css, /overflow-wrap:\s*anywhere;/);
  assert.doesNotMatch(css, /opacity:\s*0\.16;/);
  assert.match(modalSrc, /call-iframe-loaded/);
  assert.match(modalSrc, /Открыть видеомост/);
});

test("calls: meet join URL starts the requested media unmuted and skips prejoin", async () => {
  const src = await readFile(path.resolve("src/helpers/calls/meetUrl.ts"), "utf8");
  assert.match(src, /hash\.set\("config\.startWithAudioMuted", "false"\)/);
  assert.match(src, /hash\.set\("config\.startWithVideoMuted", mode === "audio" \? "true" : "false"\)/);
  assert.match(src, /hash\.set\("config\.requireDisplayName", "false"\)/);
  assert.match(src, /hash\.set\("config\.prejoinConfig\.enabled", "false"\)/);
  assert.match(src, /hash\.set\("config\.notifications", "\[\]"\)/);
  assert.match(src, /hash\.set\("interfaceConfig\.DISABLE_JOIN_LEAVE_NOTIFICATIONS", "true"\)/);
  assert.match(src, /hash\.set\("interfaceConfig\.SHOW_JITSI_WATERMARK", "false"\)/);
  assert.match(src, /hash\.set\("userInfo\.displayName", name\)/);
  assert.match(src, /hash\.set\("config\.defaultLocalDisplayName", name\)/);
});

test("calls: incoming notification fallback works before lazy tab notifier loads", async () => {
  const lazySrc = await readFile(path.resolve("src/helpers/notify/tabNotifierLazy.ts"), "utf8");
  const callsSrc = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.match(lazySrc, /notificationPermissionGranted/);
  assert.match(lazySrc, /shouldAndMarkFallback\("system", notifKey, ttlMs\)/);
  assert.doesNotMatch(lazySrc, /return false;\n\s*},\n\s*\};\n\s*return singleton;/);
  assert.match(callsSrc, /new Notification\(title, \{ body, tag, silent: false \}\)/);
});

test("calls: message context menu has selected preview and compact action height", async () => {
  const rendererSrc = await readFile(path.resolve("src/components/modals/renderContextMenu.ts"), "utf8");
  const featureSrc = await readFile(path.resolve("src/app/features/contextMenu/contextMenuFeature.ts"), "utf8");
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(featureSrc, /anchorPreview/);
  assert.match(rendererSrc, /ctx-selected-preview/);
  assert.match(rendererSrc, /actionCount \* 40/);
  assert.match(rendererSrc, /messageContextTopLimit/);
  assert.match(rendererSrc, /data-anchor-visible/);
  assert.match(css, /\.ctx-menu\.ctx-menu-message-action-list \.ctx-selected-preview/);
  assert.match(css, /min-height:\s*40px;/);
});

test("calls: message context spotlight participates in chat render cache key", async () => {
  const renderChatSrc = await readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8");
  const responsiveCss = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(renderChatSrc, /contextMenuMessageIdx/);
  assert.match(renderChatSrc, /state\.modal\?\.kind === "context_menu"/);
  assert.match(responsiveCss, /\.msg-context-active\s*\{[\s\S]*filter:\s*none !important;/);
});
