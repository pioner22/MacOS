import { getMeetBaseUrl } from "../../../config/env";
import type { AppState, TargetRef } from "../../../stores/types";
import type { Store } from "../../../stores/store";
import { buildMeetJoinUrl, type CallMode } from "../../../helpers/calls/meetUrl";
import { resolveCallDisplayName } from "../../../helpers/calls/callIdentity";
import {
  canUseDesktopMediaPermissions,
  formatMediaAccessError,
  openDesktopMediaPermissionSettings,
  queryCapturePermissionState,
  requestDesktopCapturePermissions,
  type CapturePermissionKind,
  type DesktopCapturePermissionResult,
  type MediaAccessKind,
} from "../../../helpers/media/permissions";
import { isIOS, isStandaloneDisplayMode } from "../../../helpers/ui/iosInputAssistant";
import type { TabNotifierLike } from "../../../helpers/notify/tabNotifierLazy";

export type ToastFn = (
  message: string,
  opts?: {
    kind?: "info" | "success" | "warn" | "error";
    undo?: () => void;
    actions?: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }>;
    timeoutMs?: number;
    placement?: "bottom" | "center";
  }
) => void;

export interface CallsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  showToast: ToastFn;
  tabNotifier: TabNotifierLike;
  formatTargetLabel: (st: AppState, target: TargetRef) => string;
  formatSenderLabel: (st: AppState, senderId: string) => string;
}

export type CallModalState = Extract<AppState["modal"], { kind: "call" }>;
type CallPermissionState = NonNullable<CallModalState["permission"]>;

const CALL_RING_TIMEOUT_MS = 45_000;

export interface CallsFeature {
  startCall: (mode: CallMode) => void;
  requestMediaAccess: () => void;
  openMediaSettings: (kind: CapturePermissionKind) => void;
  acceptCall: (callId: string) => void;
  declineCall: (callId: string) => void;
  handleMessage: (msg: any) => boolean;
  closeCallModal: () => void;
}

function formatCallCreateError(reasonRaw: string, limit?: number): string {
  const reason = String(reasonRaw || "").trim();
  const map: Record<string, string> = {
    rate_limited: "Слишком часто. Попробуйте позже",
    bad_mode: "Некорректный режим звонка",
    bad_target: "Некорректный получатель",
    caller_busy: "Вы уже звоните",
    bad_peer: "Некорректный ID получателя",
    not_authorized: "Можно звонить только друзьям",
    blocked_by_recipient: "Пользователь вас заблокировал",
    blocked_by_sender: "Вы заблокировали пользователя",
    server_error: "Ошибка сервера",
    peer_offline: "Пользователь оффлайн",
    peer_busy: "Пользователь занят",
    not_supported: "Звонки тут не поддерживаются",
    not_in_group: "Вы не участник этого чата",
    group_check_failed: "Не удалось проверить доступ к чату",
    no_online_peers: "Никого нет онлайн",
  };
  if (reason === "too_many_participants") {
    const lim = Number(limit ?? 0);
    return lim > 0 ? `Слишком много участников (лимит ${lim})` : "Слишком много участников";
  }
  return map[reason] ?? (reason || "ошибка");
}

function callTitleForTarget(
  st: AppState,
  target: TargetRef,
  mode: CallMode,
  incoming: boolean,
  formatTargetLabel: (st: AppState, target: TargetRef) => string
): string {
  const base = formatTargetLabel(st, target);
  const dir = incoming ? "Входящий" : "Звонок";
  const kind = mode === "audio" ? "аудио" : "видео";
  return base ? `${dir}: ${base} (${kind})` : `${dir} (${kind})`;
}

function callTitleForIncoming(
  st: AppState,
  fromId: string,
  mode: CallMode,
  roomId: string | null | undefined,
  formatTargetLabel: (st: AppState, target: TargetRef) => string,
  formatSenderLabel: (st: AppState, senderId: string) => string
): string {
  const fromLabel = formatSenderLabel(st, fromId);
  if (roomId) {
    const base = formatTargetLabel(st, { kind: "group", id: roomId });
    const kind = mode === "audio" ? "аудио" : "видео";
    return base ? `Вызов в чате: ${base} (${kind})` : `Вызов (${kind})`;
  }
  const kind = mode === "audio" ? "аудио" : "видео";
  return fromLabel ? `Входящий: ${fromLabel} (${kind})` : `Входящий (${kind})`;
}

function formatCallEndNotice(reasonRaw: string, opts: { isCaller: boolean; bySelf: boolean }): { label: string; kind: "info" | "warn" } {
  const reason = String(reasonRaw || "").trim();
  if (reason === "timeout") return { label: "Нет ответа", kind: "warn" };
  if (reason === "rejected") return { label: opts.isCaller ? "Собеседник отклонил звонок" : "Звонок отклонен", kind: "info" };
  if (reason === "not_found") return { label: "Звонок уже недоступен", kind: "warn" };
  if (reason === "not_allowed") return { label: "Нет доступа к звонку", kind: "warn" };
  if (reason === "gc") return { label: "Звонок завершен по таймауту активности", kind: "warn" };
  if (reason === "ended") return { label: opts.bySelf ? "Звонок завершен" : "Собеседник завершил звонок", kind: "info" };
  return { label: "Звонок завершен", kind: "info" };
}

function callPermissionToken(): string {
  return `call-perm-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function callMediaAccessKind(mode: CallMode): MediaAccessKind {
  return mode === "video" ? "camera_microphone" : "microphone";
}

function callMediaKinds(mode: CallMode): CapturePermissionKind[] {
  return mode === "video" ? ["microphone", "camera"] : ["microphone"];
}

function callMediaAccessLabel(mode: CallMode): string {
  return mode === "video" ? "камере и микрофону" : "микрофону";
}

function callMediaDeviceLabel(mode: CallMode): string {
  return mode === "video" ? "Камера и микрофон" : "Микрофон";
}

function browserPermissionDetail(mode: CallMode): string {
  const access = callMediaAccessLabel(mode);
  if (isIOS()) {
    const surface = isStandaloneDisplayMode() ? "PWA на экране Домой" : "страница в браузере";
    return `На iPhone Ягодка сейчас работает как ${surface}; разрешение закреплено за Safari/Chrome, а не за отдельной Ягодкой. Включите ${access} в настройках браузера и нажмите «Проверить снова».`;
  }
  return `Системный запрос появляется только после нажатия в приложении. Если доступ уже был запрещен, включите ${access} в настройках сайта или браузера и нажмите «Проверить снова».`;
}

function browserPermissionSettingsLabel(): string {
  return isIOS() ? "Инструкция iPhone" : "Как включить доступ";
}

function browserPermissionCanShowSettingsHelp(): boolean {
  return isIOS();
}

function browserPermissionRequestDetail(): string {
  if (isIOS()) {
    return "Если появилось системное окно iPhone, нажмите «Разрешить». Если окна нет, доступ уже выключен в настройках браузера.";
  }
  return "Если появилось системное окно, нажмите «Разрешить».";
}

function buildCallMediaConstraints(mode: CallMode): MediaStreamConstraints {
  if (mode !== "video") return { audio: true, video: false };
  return {
    audio: true,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

function stopMediaStream(stream: MediaStream | null | undefined): void {
  try {
    for (const track of stream?.getTracks() ?? []) track.stop();
  } catch {
    // ignore
  }
}

function mediaErrorName(errorRaw: unknown): string {
  return String((errorRaw as { name?: unknown } | null)?.name ?? "").trim().toLowerCase();
}

export function createCallsFeature(deps: CallsFeatureDeps): CallsFeature {
  const { store, send, showToast, tabNotifier, formatTargetLabel, formatSenderLabel } = deps;
  let callCreateLocalId: string | null = null;
  let callCreateTimeoutTimer: number | null = null;
  let callRingingTimeoutTimer: number | null = null;
  let callRingingTimeoutCallId = "";
  let mediaAccessInFlight = false;
  const abortedLocalIds = new Map<string, number>();

  function sendInviteAck(callIdRaw: string) {
    const callId = String(callIdRaw || "").trim();
    if (!callId) return;
    const st = store.get();
    if (st.conn !== "connected" || !st.authed) return;
    try {
      send({ type: "call_invite_ack", call_id: callId });
    } catch {
      // ignore
    }
  }

  function pruneAbortedLocalIds(now: number) {
    // Keep this bounded; local_id is only used for the "create -> result" handshake.
    if (abortedLocalIds.size <= 12) return;
    for (const [id, ts] of abortedLocalIds) {
      if (now - ts > 2 * 60 * 1000) abortedLocalIds.delete(id);
    }
    if (abortedLocalIds.size <= 12) return;
    const entries = Array.from(abortedLocalIds.entries()).sort((a, b) => a[1] - b[1]);
    for (const [id] of entries.slice(0, Math.max(0, entries.length - 12))) {
      abortedLocalIds.delete(id);
    }
  }

  function clearCallCreateTimeout() {
    if (callCreateTimeoutTimer === null) return;
    window.clearTimeout(callCreateTimeoutTimer);
    callCreateTimeoutTimer = null;
  }

  function clearCallRingingTimeout(callIdRaw?: string) {
    const callId = String(callIdRaw || "").trim();
    if (callId && callRingingTimeoutCallId && callRingingTimeoutCallId !== callId) return;
    if (callRingingTimeoutTimer !== null) {
      try {
        window.clearTimeout(callRingingTimeoutTimer);
      } catch {
        // ignore
      }
    }
    callRingingTimeoutTimer = null;
    callRingingTimeoutCallId = "";
  }

  function startCallRingingTimeout(callIdRaw: string, incoming: boolean) {
    const callId = String(callIdRaw || "").trim();
    if (!callId) return;
    clearCallRingingTimeout();
    callRingingTimeoutCallId = callId;
    callRingingTimeoutTimer = window.setTimeout(() => {
      if (callRingingTimeoutCallId !== callId) return;
      callRingingTimeoutTimer = null;
      callRingingTimeoutCallId = "";
      const stNow = store.get();
      const modal = stNow.modal;
      if (!modal || modal.kind !== "call" || String(modal.callId || "").trim() !== callId) return;
      const phase = modal.phase ?? (modal.roomName ? "ringing" : "creating");
      if (phase !== "ringing") return;
      if (stNow.conn === "connected" && stNow.authed) {
        try {
          send({ type: incoming ? "call_reject" : "call_end", call_id: callId });
        } catch {
          // ignore
        }
      }
      store.set({ modal: null, status: incoming ? "Вызов пропущен" : "Нет ответа" });
      showToast(incoming ? "Вызов пропущен" : "Нет ответа", { kind: "warn", timeoutMs: 7000 });
    }, CALL_RING_TIMEOUT_MS);
  }

  function markAbortedLocalId(localId: string) {
    const id = String(localId || "").trim();
    if (!id) return;
    const now = Date.now();
    abortedLocalIds.set(id, now);
    pruneAbortedLocalIds(now);
  }

  function startCallCreateTimeout(localId: string) {
    const id = String(localId || "").trim();
    if (!id) return;
    clearCallCreateTimeout();
    callCreateTimeoutTimer = window.setTimeout(() => {
      if (callCreateLocalId !== id) return;
      markAbortedLocalId(id);
      callCreateLocalId = null;
      callCreateTimeoutTimer = null;
      const stNow = store.get();
      if (stNow.modal?.kind === "call" && stNow.modal.phase === "creating" && !String(stNow.modal.callId || "").trim()) {
        store.set({ modal: null });
      }
      showToast("Не удалось начать звонок (нет ответа). Попробуйте ещё раз", { kind: "warn", timeoutMs: 8000 });
    }, 9000);
  }

  function resolveStartCallContext(quiet = false): { st: AppState; sel: NonNullable<AppState["selected"]> } | null {
    const st = store.get();
    if (st.modal) return null;
    if (!st.authed || st.conn !== "connected") {
      if (!quiet) showToast("Нет соединения", { kind: "warn", timeoutMs: 5000 });
      return null;
    }
    if (!getMeetBaseUrl()) {
      if (!quiet) showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
      return null;
    }
    const sel = st.selected;
    if (!sel || st.page !== "main") {
      if (!quiet) store.set({ status: "Выберите контакт или чат" });
      return null;
    }
    if (sel.kind === "board") {
      if (!quiet) showToast("Звонки на досках пока недоступны", { kind: "warn", timeoutMs: 6000 });
      return null;
    }
    if (callCreateLocalId) {
      if (!quiet) showToast("Звонок уже создаётся…", { kind: "info", timeoutMs: 4000 });
      return null;
    }
    return { st, sel };
  }

  function permissionRequestState(mode: CallMode): CallPermissionState {
    return {
      status: "requesting",
      message: `Разрешите доступ к ${callMediaAccessLabel(mode)}`,
      detail: browserPermissionRequestDetail(),
      blockedKind: mode === "video" ? "camera" : "microphone",
      canOpenSettings: false,
    };
  }

  function patchPermissionGate(token: string, permission: CallPermissionState, status?: string) {
    const gateToken = String(token || "").trim();
    if (!gateToken) return;
    store.set((prev) => {
      if (prev.modal?.kind !== "call" || prev.modal.phase !== "permission" || prev.modal.permissionToken !== gateToken) return prev;
      return {
        ...prev,
        modal: { ...prev.modal, permission, phaseAt: Date.now() },
        ...(status ? { status } : {}),
      };
    });
  }

  function permissionGateStillOpen(token: string): boolean {
    const modal = store.get().modal;
    return Boolean(modal?.kind === "call" && modal.phase === "permission" && modal.permissionToken === token);
  }

  function desktopPermissionIssue(mode: CallMode, result: DesktopCapturePermissionResult): CallPermissionState {
    const blocked = result.blockedKind || (mode === "video" ? "camera" : "microphone");
    const status = result.rawStatuses[blocked];
    const device = blocked === "camera" ? "камере" : "микрофону";
    const message =
      status === "restricted"
        ? `Система ограничила доступ к ${device}`
        : `Доступ к ${device} запрещен в настройках приложения`;
    return {
      status: "blocked",
      message,
      detail: "Откройте настройки приватности, разрешите доступ для Ягодки и нажмите «Проверить снова».",
      blockedKind: blocked,
      canOpenSettings: result.canOpenSettings,
    };
  }

  async function inferBlockedKind(mode: CallMode, errorRaw: unknown): Promise<CapturePermissionKind> {
    if (mode !== "video") return "microphone";
    const name = mediaErrorName(errorRaw);
    if (name === "notfounderror" || name === "devicesnotfounderror") return "camera";
    try {
      const micState = await queryCapturePermissionState("microphone");
      if (micState === "denied") return "microphone";
      const camState = await queryCapturePermissionState("camera");
      if (camState === "denied") return "camera";
    } catch {
      // ignore
    }
    return "camera";
  }

  async function browserPermissionIssue(mode: CallMode, errorRaw: unknown): Promise<CallPermissionState> {
    const name = mediaErrorName(errorRaw);
    const blockedKind = await inferBlockedKind(mode, errorRaw);
    if (name === "notallowederror" || name === "permissiondeniederror" || name === "securityerror") {
      return {
        status: "blocked",
        message: `Доступ к ${callMediaAccessLabel(mode)} не выдан`,
        detail: browserPermissionDetail(mode),
        blockedKind,
        canOpenSettings: browserPermissionCanShowSettingsHelp(),
        settingsLabel: browserPermissionSettingsLabel(),
      };
    }
    if (name === "notfounderror" || name === "devicesnotfounderror") {
      return {
        status: "error",
        message: mode === "video" ? "Камера или микрофон не найдены" : "Микрофон не найден",
        detail: "Проверьте, что устройство подключено и доступно браузеру.",
        blockedKind,
        canOpenSettings: false,
      };
    }
    if (name === "notreadableerror" || name === "trackstarterror" || name === "aborterror") {
      return {
        status: "error",
        message: `${callMediaDeviceLabel(mode)} сейчас заняты`,
        detail: "Закройте другое приложение или вкладку, где используется камера/микрофон, затем нажмите «Проверить снова».",
        blockedKind,
        canOpenSettings: false,
      };
    }
    return {
      status: "error",
      message: formatMediaAccessError(callMediaAccessKind(mode), errorRaw),
      detail: browserPermissionDetail(mode),
      blockedKind,
      canOpenSettings: browserPermissionCanShowSettingsHelp(),
      settingsLabel: browserPermissionSettingsLabel(),
    };
  }

  function showPermissionIssue(issue: CallPermissionState) {
    const blockedKind = issue.blockedKind || "microphone";
    const actions: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }> = [];
    if (issue.canOpenSettings) {
      actions.push({
        id: `call_media_settings_${blockedKind}`,
        label: issue.settingsLabel || (blockedKind === "camera" ? "Настройки камеры" : "Настройки микрофона"),
        primary: true,
        onClick: () => openMediaSettings(blockedKind),
      });
    }
    actions.push({
      id: "call_media_retry",
      label: "Проверить снова",
      primary: !issue.canOpenSettings,
      onClick: () => requestMediaAccess(),
    });
    showToast(issue.message, { kind: "warn", timeoutMs: 10000, actions });
  }

  async function ensureMediaAccess(mode: CallMode, token: string): Promise<boolean> {
    const gateToken = String(token || "").trim();
    if (!gateToken || !permissionGateStillOpen(gateToken)) return false;
    if (mediaAccessInFlight) {
      showToast("Подтвердите запрос камеры/микрофона в системном окне", { kind: "info", timeoutMs: 5000 });
      return false;
    }

    if (typeof window !== "undefined" && !window.isSecureContext) {
      const issue: CallPermissionState = {
        status: "unsupported",
        message: "Звонки с камерой и микрофоном доступны только по HTTPS",
        detail: "Откройте Ягодку через защищенный адрес и повторите звонок.",
        blockedKind: mode === "video" ? "camera" : "microphone",
        canOpenSettings: false,
      };
      patchPermissionGate(gateToken, issue, issue.message);
      showPermissionIssue(issue);
      return false;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const issue: CallPermissionState = {
        status: "unsupported",
        message: "Этот браузер не поддерживает доступ к камере и микрофону",
        detail: "Откройте Ягодку в Safari/Chrome/Edge или в приложении и повторите звонок.",
        blockedKind: mode === "video" ? "camera" : "microphone",
        canOpenSettings: false,
      };
      patchPermissionGate(gateToken, issue, issue.message);
      showPermissionIssue(issue);
      return false;
    }

    mediaAccessInFlight = true;
    patchPermissionGate(gateToken, permissionRequestState(mode), `Запрашиваем доступ к ${callMediaAccessLabel(mode)}…`);
    try {
      if (canUseDesktopMediaPermissions()) {
        const desktopPerm = await requestDesktopCapturePermissions(callMediaKinds(mode));
        if (desktopPerm && !desktopPerm.ok) {
          const issue = desktopPermissionIssue(mode, desktopPerm);
          patchPermissionGate(gateToken, issue, issue.message);
          showPermissionIssue(issue);
          return false;
        }
      }

      if (!permissionGateStillOpen(gateToken)) return false;
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildCallMediaConstraints(mode));
        return true;
      } catch (error) {
        const issue = await browserPermissionIssue(mode, error);
        patchPermissionGate(gateToken, issue, issue.message);
        showPermissionIssue(issue);
        return false;
      } finally {
        stopMediaStream(stream);
      }
    } finally {
      mediaAccessInFlight = false;
    }
  }

  function targetFromCallModal(modal: CallModalState): TargetRef | null {
    const roomId = String(modal.room || "").trim();
    if (roomId) return { kind: "group", id: roomId };
    const toId = String(modal.to || "").trim();
    if (toId) return { kind: "dm", id: toId };
    return null;
  }

  function openOutgoingPermissionGate(ctx: { st: AppState; sel: NonNullable<AppState["selected"]> }, mode: CallMode): string {
    const token = callPermissionToken();
    const target: TargetRef = ctx.sel.kind === "dm" ? { kind: "dm", id: ctx.sel.id } : { kind: "group", id: ctx.sel.id };
    const title = callTitleForTarget(ctx.st, target, mode, false, formatTargetLabel);
    store.set({
      modal: {
        kind: "call",
        callId: "",
        roomName: "",
        mode,
        from: ctx.st.selfId || "",
        ...(target.kind === "dm" ? { to: target.id } : { room: target.id }),
        title,
        phase: "permission",
        phaseAt: Date.now(),
        permissionToken: token,
        permission: permissionRequestState(mode),
      },
      status: `Запрашиваем доступ к ${callMediaAccessLabel(mode)}…`,
    });
    return token;
  }

  function setIncomingPermissionGate(callId: string, mode: CallMode): string | null {
    const existing = store.get().modal;
    if (!existing || existing.kind !== "call" || String(existing.callId || "").trim() !== callId) return null;
    const token = existing.phase === "permission" && existing.permissionToken ? existing.permissionToken : callPermissionToken();
    store.set((prev) => {
      if (prev.modal?.kind !== "call" || String(prev.modal.callId || "").trim() !== callId) return prev;
      return {
        ...prev,
        modal: {
          ...prev.modal,
          phase: "permission",
          phaseAt: Date.now(),
          permissionToken: token,
          permission: permissionRequestState(mode),
        },
        status: `Запрашиваем доступ к ${callMediaAccessLabel(mode)}…`,
      };
    });
    return token;
  }

  function beginOutgoingCallCreateFromModal(modal: CallModalState) {
    const st = store.get();
    if (st.conn !== "connected" || !st.authed) {
      store.set({ modal: null });
      showToast("Нет соединения", { kind: "warn", timeoutMs: 5000 });
      return;
    }
    if (!getMeetBaseUrl()) {
      store.set({ modal: null });
      showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
      return;
    }
    if (callCreateLocalId) {
      showToast("Звонок уже создаётся…", { kind: "info", timeoutMs: 4000 });
      return;
    }
    const target = targetFromCallModal(modal);
    if (!target) {
      store.set({ modal: null, status: "Выберите контакт или чат" });
      return;
    }
    const mode: CallMode = modal.mode === "audio" ? "audio" : "video";
    const title = callTitleForTarget(st, target, mode, false, formatTargetLabel);
    callCreateLocalId = `call-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    store.set({
      modal: {
        kind: "call",
        callId: "",
        roomName: "",
        mode,
        from: st.selfId || "",
        ...(target.kind === "dm" ? { to: target.id } : { room: target.id }),
        title,
        phase: "creating",
        phaseAt: Date.now(),
      },
      status: mode === "audio" ? "Аудиозвонок…" : "Видеозвонок…",
    });
    startCallCreateTimeout(callCreateLocalId);
    try {
      send({
        type: "call_create",
        mode,
        ...(target.kind === "dm" ? { peer: target.id } : { room: target.id }),
        local_id: callCreateLocalId,
      });
    } catch {
      clearCallCreateTimeout();
      callCreateLocalId = null;
      store.set({ modal: null });
      showToast("Не удалось начать звонок (ошибка соединения)", { kind: "warn", timeoutMs: 8000 });
    }
  }

  function requestMediaAccess() {
    void requestMediaAccessInternal();
  }

  async function requestMediaAccessInternal() {
    const stBefore = store.get();
    const modal = stBefore.modal;
    if (!modal || modal.kind !== "call" || modal.phase !== "permission") return;
    const token = modal.permissionToken || callPermissionToken();
    if (!modal.permissionToken) {
      store.set((prev) => {
        if (prev.modal?.kind !== "call" || prev.modal.phase !== "permission") return prev;
        return { ...prev, modal: { ...prev.modal, permissionToken: token } };
      });
    }
    const mode: CallMode = modal.mode === "audio" ? "audio" : "video";
    if (!(await ensureMediaAccess(mode, token))) return;
    const stNow = store.get();
    const modalNow = stNow.modal;
    if (!modalNow || modalNow.kind !== "call" || modalNow.phase !== "permission" || modalNow.permissionToken !== token) return;
    const callId = String(modalNow.callId || "").trim();
    if (modalNow.incoming && callId) {
      await acceptCallInternal(callId, { skipMediaAccess: true });
      return;
    }
    beginOutgoingCallCreateFromModal(modalNow);
  }

  function openMediaSettings(kindRaw: CapturePermissionKind) {
    void openMediaSettingsInternal(kindRaw);
  }

  async function openMediaSettingsInternal(kindRaw: CapturePermissionKind) {
    const kind: CapturePermissionKind = kindRaw === "camera" ? "camera" : "microphone";
    const ok = await openDesktopMediaPermissionSettings(kind);
    if (!ok) {
      if (isIOS()) {
        const device = kind === "camera" ? "камеру" : "микрофон";
        showToast(
          `iPhone: откройте настройки Safari/Chrome и разрешите ${device}. Если Ягодка открыта ссылкой, отдельной Ягодки в списке приложений не будет.`,
          { kind: "info", timeoutMs: 14000 }
        );
        return;
      }
      showToast("Откройте настройки сайта или браузера и разрешите доступ вручную", { kind: "info", timeoutMs: 8000 });
    }
  }

  function acceptCall(callIdRaw: string) {
    void acceptCallInternal(callIdRaw);
  }

  async function acceptCallInternal(callIdRaw: string, opts?: { skipMediaAccess?: boolean }) {
    const callId = String(callIdRaw || "").trim();
    if (!callId) return;
    clearCallRingingTimeout(callId);
    const stBefore = store.get();
    const modal = stBefore.modal;
    if (!modal || modal.kind !== "call" || String(modal.callId || "").trim() !== callId) return;
    const roomName = String(modal.roomName || "").trim();
    const mode: CallMode = String(modal.mode || "").trim() === "audio" ? "audio" : "video";
    const joinUrl = roomName ? buildMeetJoinUrl(roomName, mode, resolveCallDisplayName(stBefore)) : null;
    if (!joinUrl) {
      showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
      if (stBefore.conn === "connected" && stBefore.authed) {
        try {
          send({ type: "call_reject", call_id: callId });
        } catch {
          // ignore
        }
      }
      store.set({ modal: null });
      return;
    }
    if (!opts?.skipMediaAccess) {
      const token = setIncomingPermissionGate(callId, mode);
      if (!token) return;
      if (!(await ensureMediaAccess(mode, token))) return;
    }

    const stNow = store.get();
    const modalNow = stNow.modal;
    if (!modalNow || modalNow.kind !== "call" || String(modalNow.callId || "").trim() !== callId) return;

    if (stNow.conn === "connected" && stNow.authed) {
      try {
        send({ type: "call_accept", call_id: callId });
      } catch {
        // ignore
      }
    }

    store.set((prev) => {
      if (prev.modal?.kind !== "call" || String(prev.modal.callId || "").trim() !== callId) return prev;
      return { ...prev, modal: { ...prev.modal, phase: "active", phaseAt: Date.now() }, status: "Звонок…" };
    });
  }

  function declineCall(callIdRaw: string) {
    const callId = String(callIdRaw || "").trim();
    if (!callId) return;
    const stNow = store.get();
    const modal = stNow.modal;
    if (!modal || modal.kind !== "call" || String(modal.callId || "").trim() !== callId) return;
    clearCallRingingTimeout(callId);
    if (stNow.conn === "connected" && stNow.authed) {
      try {
        send({ type: "call_reject", call_id: callId });
      } catch {
        // ignore
      }
    }
    store.set({ modal: null, status: "Звонок отклонен" });
    showToast("Звонок отклонен", { kind: "info", timeoutMs: 5000 });
  }

  function startCall(mode: CallMode) {
    void startCallInternal(mode);
  }

  async function startCallInternal(mode: CallMode) {
    const firstCtx = resolveStartCallContext(false);
    if (!firstCtx) return;
    const token = openOutgoingPermissionGate(firstCtx, mode);
    if (!(await ensureMediaAccess(mode, token))) return;
    const modal = store.get().modal;
    if (!modal || modal.kind !== "call" || modal.phase !== "permission" || modal.permissionToken !== token) return;
    beginOutgoingCallCreateFromModal(modal);
  }

  function closeCallModal() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "call") return;
    const callId = String(modal.callId || "").trim();
    clearCallRingingTimeout(callId);
    const incoming = Boolean(modal.incoming);
    const phase = modal.phase ?? (callId && modal.roomName ? "active" : modal.roomName ? "ringing" : "creating");
    if (callId && st.conn === "connected" && st.authed) {
      try {
        if (incoming && phase !== "active") {
          send({ type: "call_reject", call_id: callId });
        } else {
          send({ type: "call_end", call_id: callId });
        }
      } catch {
        // ignore
      }
    }
    if (!callId && callCreateLocalId) {
      markAbortedLocalId(callCreateLocalId);
      callCreateLocalId = null;
      clearCallCreateTimeout();
    }
    store.set({ modal: null, status: callId ? (incoming && phase !== "active" ? "Звонок отклонен" : "Звонок завершен") : "Звонок отменен" });
  }

  function handleMessage(msg: any): boolean {
    const t = String(msg?.type ?? "");

    if (t === "call_create_result") {
      const ok = Boolean(msg?.ok);
      const localId = String(msg?.local_id ?? "").trim();
      if (!localId) return true;
      if (abortedLocalIds.has(localId)) {
        abortedLocalIds.delete(localId);
        clearCallCreateTimeout();
        if (callCreateLocalId === localId) callCreateLocalId = null;
        if (ok) {
          const callId = String(msg?.call_id ?? "").trim();
          const stNow = store.get();
          if (callId && stNow.conn === "connected" && stNow.authed) {
            try {
              send({ type: "call_end", call_id: callId });
            } catch {
              // ignore
            }
          }
        }
        return true;
      }
      if (!callCreateLocalId || localId !== callCreateLocalId) return true;
      clearCallCreateTimeout();
      callCreateLocalId = null;

      if (!ok) {
        const stNow = store.get();
        if (stNow.modal?.kind === "call" && stNow.modal.phase === "creating") {
          store.set({ modal: null });
        }
        const reason = String(msg?.reason ?? "ошибка");
        const limit = typeof msg?.limit === "number" && Number.isFinite(msg.limit) ? Math.trunc(msg.limit) : undefined;
        showToast(formatCallCreateError(reason, limit), { kind: "warn", timeoutMs: 8000 });
        return true;
      }

      const callId = String(msg?.call_id ?? "").trim();
      const roomName = String(msg?.room_name ?? "").trim();
      const mode: CallMode = String(msg?.mode ?? "").trim() === "audio" ? "audio" : "video";
      const roomId = typeof msg?.room === "string" ? String(msg.room).trim() : "";
      const toId = typeof msg?.to === "string" ? String(msg.to).trim() : "";
      if (!callId || !roomName) return true;

      const st = store.get();
      const joinUrl = buildMeetJoinUrl(roomName, mode, resolveCallDisplayName(st));
      if (!joinUrl) {
        showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
        if (st.conn === "connected" && st.authed) {
          try {
            send({ type: "call_end", call_id: callId });
          } catch {
            // ignore
          }
        }
        if (st.modal?.kind === "call" && st.modal.phase === "creating") {
          store.set({ modal: null });
        }
        return true;
      }
      const target: TargetRef | null = roomId ? { kind: "group", id: roomId } : toId ? { kind: "dm", id: toId } : null;
      const title = target ? callTitleForTarget(st, target, mode, false, formatTargetLabel) : `Звонок (${mode === "audio" ? "аудио" : "видео"})`;
      store.set({
        modal: {
          kind: "call",
          callId,
          roomName,
          mode,
          from: st.selfId || "",
          ...(roomId ? { room: roomId } : { to: toId }),
          title,
          phase: "ringing",
          phaseAt: Date.now(),
        },
        status: "Звонок…",
      });
      startCallRingingTimeout(callId, false);
      if (tabNotifier.shouldShowToast(`call_ringing:${callId}`)) {
        const targetLabel = target ? formatTargetLabel(st, target) : "";
        showToast(targetLabel ? `Вызываем: ${targetLabel}` : "Вызываем…", {
          kind: "info",
          timeoutMs: 6000,
        });
      }
      return true;
    }

    if (t === "call_invite") {
      const callId = String(msg?.call_id ?? "").trim();
      const roomName = String(msg?.room_name ?? "").trim();
      const fromId = String(msg?.from ?? "").trim();
      const mode: CallMode = String(msg?.mode ?? "").trim() === "audio" ? "audio" : "video";
      const roomId = typeof msg?.room === "string" ? String(msg.room).trim() : "";
      if (!callId || !roomName || !fromId) return true;
      sendInviteAck(callId);

      const stNow = store.get();
      if (stNow.modal?.kind === "call") {
        const currentCallId = String(stNow.modal.callId || "").trim();
        if (currentCallId === callId) {
          store.set((prev) => {
            if (prev.modal?.kind !== "call" || String(prev.modal.callId || "").trim() !== callId) return prev;
            return {
              ...prev,
              modal: {
                ...prev.modal,
                roomName,
                mode,
                from: fromId,
                ...(roomId ? { room: roomId } : { to: String(msg?.to ?? "").trim() || null }),
                incoming: true,
                phase: "ringing",
                phaseAt: Date.now(),
              },
            };
          });
          startCallRingingTimeout(callId, true);
          return true;
        }
        if (stNow.conn === "connected" && stNow.authed) {
          try {
            send({ type: "call_reject", call_id: callId });
          } catch {
            // ignore
          }
        }
        return true;
      }

      const notifKey = roomId ? `call_invite:room:${roomId}:${callId}` : `call_invite:dm:${fromId}:${callId}`;
      try {
        const permission = Notification?.permission ?? "default";
        if (permission === "granted" && tabNotifier.shouldShowSystemNotification(notifKey)) {
          const title = "Ягодка: звонок";
          const body = roomId ? `Чат: ${formatTargetLabel(stNow, { kind: "group", id: roomId })}` : `От: ${formatSenderLabel(stNow, fromId)}`;
          const tag = roomId ? `yagodka:room:${roomId}` : `yagodka:dm:${fromId}`;
          new Notification(title, { body, tag, silent: false });
        }
      } catch {
        // ignore
      }

      const title = callTitleForIncoming(stNow, fromId, mode, roomId || null, formatTargetLabel, formatSenderLabel);
      const joinUrl = buildMeetJoinUrl(roomName, mode, resolveCallDisplayName(stNow));
      if (!joinUrl) {
        showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
        if (stNow.conn === "connected" && stNow.authed) {
          try {
            send({ type: "call_reject", call_id: callId });
          } catch {
            // ignore
          }
        }
        return true;
      }

      store.set({
        modal: {
          kind: "call",
          callId,
          roomName,
          mode,
          from: fromId,
          ...(roomId ? { room: roomId } : { to: String(msg?.to ?? "").trim() || null }),
          title,
          incoming: true,
          phase: "ringing",
          phaseAt: Date.now(),
        },
        status: title,
      });
      startCallRingingTimeout(callId, true);
      if (tabNotifier.shouldShowToast(`call_invite_toast:${callId}`)) {
        showToast(title, {
          kind: "info",
          timeoutMs: 12000,
          actions: [
            { id: `call_accept:${callId}`, label: "Принять", primary: true, onClick: () => acceptCall(callId) },
            { id: `call_decline:${callId}`, label: "Отклонить", onClick: () => declineCall(callId) },
          ],
        });
      }

      return true;
    }

    if (t === "call_state") {
      const callId = String(msg?.call_id ?? "").trim();
      const state = String(msg?.state ?? "").trim();
      const reason = String(msg?.reason ?? "").trim();
      if (!callId || !state) return true;
      const stNow = store.get();

      if (stNow.modal?.kind === "call" && stNow.modal.callId === callId) {
        if (state === "ended") {
          clearCallRingingTimeout(callId);
          store.set({ modal: null });
        } else if (state === "active") {
          clearCallRingingTimeout(callId);
          store.set((prev) => {
            if (prev.modal?.kind !== "call" || prev.modal.callId !== callId) return prev;
            return { ...prev, modal: { ...prev.modal, phase: "active", phaseAt: Date.now() }, status: "В звонке" };
          });
        } else if (state === "ringing") {
          startCallRingingTimeout(callId, Boolean(stNow.modal.incoming));
          store.set((prev) => {
            if (prev.modal?.kind !== "call" || prev.modal.callId !== callId) return prev;
            return { ...prev, modal: { ...prev.modal, phase: "ringing", phaseAt: Date.now() } };
          });
        }
      }

      if (state === "ended") {
        const me = String(stNow.selfId || "").trim();
        const fromId = String(msg?.from ?? "").trim();
        const endedBy = String(msg?.ended_by ?? "").trim();
        const isCaller = Boolean(me && fromId && me === fromId);
        const bySelf = Boolean(me && endedBy && me === endedBy);
        const notice = formatCallEndNotice(reason, { isCaller, bySelf });
        if (tabNotifier.shouldShowToast(`call_end:${callId}`)) {
          showToast(notice.label, {
            kind: notice.kind,
            timeoutMs: 7000,
          });
        }
      }
      return true;
    }

    return false;
  }

  return { startCall, requestMediaAccess, openMediaSettings, acceptCall, declineCall, handleMessage, closeCallModal };
}
