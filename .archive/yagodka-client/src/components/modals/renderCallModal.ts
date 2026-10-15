import type { AppState } from "../../stores/types";
import { el } from "../../helpers/dom/el";
import { buildMeetJoinUrl } from "../../helpers/calls/meetUrl";
import { resolveCallDisplayName } from "../../helpers/calls/callIdentity";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { copyText } from "../../helpers/dom/copyText";

export interface CallModalActions {
  onHangup: () => void;
  onOpenExternal: (url: string) => void;
}

export function renderCallModal(
  state: AppState,
  modal: Extract<AppState["modal"], { kind: "call" }>,
  actions: CallModalActions
): HTMLElement {
  const title = String(modal.title || "Звонок").trim() || "Звонок";
  const mode = modal.mode === "audio" ? "audio" : "video";
  const roomName = String(modal.roomName || "").trim();
  const joinUrl = roomName ? buildMeetJoinUrl(roomName, mode, resolveCallDisplayName(state)) : null;
  const phase = modal.phase ?? (modal.callId && roomName ? "active" : roomName ? "ringing" : "creating");
  const phaseLabel = phase === "active" ? "в звонке" : phase === "ringing" ? "звоним…" : "создание…";

  const headTitle = el("div", { class: "call-title" }, [title]);
  const headSub = el("div", { class: "call-sub" }, [`${mode === "audio" ? "аудио" : "видео"} · ${phaseLabel}`]);
  const headLeft = el("div", { class: "call-head-left" }, [headTitle, headSub]);

  const openExternalBtn = el(
    "button",
    { class: "btn call-open", type: "button", ...(joinUrl ? {} : { disabled: "true" }) },
    ["Открыть отдельно"]
  ) as HTMLButtonElement;
  openExternalBtn.addEventListener("click", () => {
    if (!joinUrl) return;
    actions.onOpenExternal(joinUrl);
  });

  const copyDefaultLabel = "Скопировать ссылку";
  const copyLinkBtn = el(
    "button",
    { class: "btn call-copy", type: "button", ...(joinUrl ? {} : { disabled: "true" }) },
    [copyDefaultLabel]
  ) as HTMLButtonElement;
  copyLinkBtn.addEventListener("click", async () => {
    if (!joinUrl) return;
    const ok = await copyText(joinUrl);
    copyLinkBtn.textContent = ok ? "Скопировано" : "Не удалось";
    window.setTimeout(() => {
      copyLinkBtn.textContent = copyDefaultLabel;
    }, 2000);
  });

  const hangupBtn = el(
    "button",
    { class: "btn btn-danger call-hangup", type: "button" },
    [phase === "active" ? "Завершить" : "Отменить"]
  ) as HTMLButtonElement;
  hangupBtn.addEventListener("click", () => actions.onHangup());

  const head = el("div", { class: "call-head" }, [
    headLeft,
    el("div", { class: "call-head-actions" }, [openExternalBtn, copyLinkBtn, hangupBtn]),
  ]);

  const mobileUi = isMobileLikeUi();
  const body = (() => {
    if (phase === "creating") {
      return el("div", { class: "call-fallback" }, [
        el("div", { class: "call-fallback-title" }, ["Создаём звонок…"]),
        el("div", { class: "call-fallback-sub" }, ["Если нажали случайно — нажмите «Отменить»."]),
      ]);
    }
    if (!joinUrl) {
      return el("div", { class: "call-fallback" }, [
        el("div", { class: "call-fallback-title" }, ["Сервис звонков не настроен"]),
        el("div", { class: "call-fallback-sub" }, ["Нужен URL Jitsi (VITE_MEET_URL / meet.yagodka.org)."]),
      ]);
    }
    if (mobileUi) {
      const openBtn = el("button", { class: "btn btn-primary call-open-mobile", type: "button" }, ["Открыть звонок"]) as HTMLButtonElement;
      openBtn.addEventListener("click", () => actions.onOpenExternal(joinUrl));
      return el("div", { class: "call-fallback" }, [
        el("div", { class: "call-fallback-title" }, ["Открыть звонок"]),
        el("div", { class: "call-fallback-sub" }, ["На мобильных устройствах надёжнее открывать звонок отдельно."]),
        openBtn,
      ]);
    }
    const iframe = el("iframe", {
      class: "call-frame",
      src: joinUrl,
      allow: "camera; microphone; fullscreen; display-capture; autoplay",
      referrerpolicy: "no-referrer",
      allowfullscreen: "true",
      title,
    }) as HTMLIFrameElement;
    return el("div", { class: "call-body" }, [iframe]);
  })();

  return el("div", { class: "modal modal-call" }, [head, body]);
}
