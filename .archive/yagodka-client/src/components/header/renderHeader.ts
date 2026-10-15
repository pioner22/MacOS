import { el } from "../../helpers/dom/el";
import { buildAppShellProjection } from "../../helpers/navigation/appShellProjection";
import { splitBuildId } from "../../helpers/version/buildId";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { getMeetBaseUrl } from "../../config/env";
import type { AppState } from "../../stores/types";
import type { Layout } from "../layout/types";

export function renderHeader(layout: Layout, state: AppState) {
  const mobileUi = isMobileLikeUi();
  const webBuild = splitBuildId(state.clientVersion);
  const verTitle = state.serverVersion ? `srv ${state.serverVersion}` : "";
  const headerId = state.selfId ?? state.authRememberedId ?? "—";
  const shell = buildAppShellProjection(state);

  const chatSearchBtn = null;
  const navAction = shell.navAction;
  const navTitle = shell.navTitle;
  const navAria = shell.navAria;
  const navIcon = shell.navIcon;

  layout.headerLeft.replaceChildren(
    el(
      "button",
      {
        class: "nav-toggle hk-btn",
        type: "button",
        "data-action": navAction,
        title: navTitle,
        "aria-label": navAria,
      },
      [navIcon]
    ),
    " ",
    el("span", { class: "hdr-label" }, ["Ваш ID: "]),
    el("span", { class: "hdr-id" }, [headerId]),
    "  ",
    el("span", { class: "hdr-ver", title: verTitle || undefined }, [`v${webBuild.version || "—"}`]),
    el("span", { class: "hdr-sep" }, [" | "]),
    el("span", { class: "hdr-title" }, [shell.pageTitle])
  );
  const showCallActions = shell.showCallActions;
  const meetReady = Boolean(getMeetBaseUrl());
  const canCall = Boolean(showCallActions && meetReady && state.authed && state.conn === "connected" && state.modal?.kind !== "call");
  const showChatMenu = shell.showChatMenu;
  const showAuthButton = shell.showAuthButton;
  const statusLabel = state.status || "";
  const statusTone = state.toast?.kind || (state.conn === "connected" ? "info" : state.conn === "connecting" ? "warn" : "error");
  layout.headerRight.setAttribute("data-status-empty", statusLabel ? "0" : "1");
  layout.headerRight.setAttribute("data-status-tone", statusTone);
  const statusEl = el(
    "span",
    {
      class: "hdr-status",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
      title: statusLabel || undefined,
    },
    [statusLabel]
  );
  const statusActionButtons = (state.toast?.actions || [])
    .map((action) => ({
      id: String(action?.id || "").trim(),
      label: String(action?.label || "").trim(),
      primary: Boolean(action?.primary),
    }))
    .filter((action) => action.id && action.label && action.id !== "dismiss")
    .slice(0, 2)
    .map((action) =>
      el(
        "button",
        {
          class: action.primary ? "btn hdr-status-action hdr-status-action-primary" : "btn hdr-status-action",
          type: "button",
          "data-action": "toast-action",
          "data-toast-id": action.id,
          title: action.label,
        },
        [action.label]
      )
    );
  const actionButtons: HTMLElement[] = [];
  if (showAuthButton) {
    actionButtons.push(
      el(
        "button",
        {
          class: "hdr-auth",
          type: "button",
          title: "Войти или зарегистрироваться",
          "aria-label": "Войти или зарегистрироваться",
          "data-action": "auth-open",
        },
        ["Войти"]
      )
    );
  }
  if (showCallActions) {
    actionButtons.push(
      el(
        "button",
        {
          class: "hdr-action",
          type: "button",
          ...(canCall ? {} : { disabled: "true" }),
          title: "Аудиозвонок",
          "aria-label": "Аудиозвонок",
          "data-action": "call-start-audio",
          "data-icon": "call",
        },
        []
      ),
      el(
        "button",
        {
          class: "hdr-action",
          type: "button",
          ...(canCall ? {} : { disabled: "true" }),
          title: "Видеозвонок",
          "aria-label": "Видеозвонок",
          "data-action": "call-start-video",
          "data-icon": "video",
        },
        []
      )
    );
  }
  if (showChatMenu) {
    actionButtons.push(
      el(
        "button",
        {
          class: "hdr-action",
          type: "button",
          title: "Меню чата",
          "aria-label": "Меню чата",
          "data-action": "chat-topbar-menu",
          "data-icon": "menu",
        },
        []
      )
    );
  }
  const statusActions = statusActionButtons.length ? el("span", { class: "hdr-status-actions" }, statusActionButtons) : null;
  const actions = actionButtons.length ? el("span", { class: "hdr-actions" }, actionButtons) : null;
  if (actions) {
    layout.headerRight.replaceChildren(statusEl, ...(statusActions ? [statusActions] : []), actions);
  } else if (statusActions) {
    layout.headerRight.replaceChildren(statusEl, statusActions);
  } else {
    layout.headerRight.replaceChildren(statusEl);
  }

  if (mobileUi) {
    layout.hotkeys.replaceChildren();
  } else {
    const f10Label = state.authed ? "выход" : "зайти";
    layout.hotkeys.replaceChildren(
      ...[
        ["F1", "info"],
        ["F2", "профиль"],
        ["F5", "чат+"],
        ["F6", "доска+"],
        ["F7", "файлы"],
        ["F10", f10Label],
      ].map(([k, v]) =>
        el(
          "button",
          { class: "hk-btn", type: "button", "data-key": k, title: `${k} — ${v}`, "aria-label": `${v} (${k})` },
          [el("span", { class: "hk-kbd", "aria-hidden": "true" }, [k]), el("span", { class: "hk-label", "aria-hidden": "true" }, [v])]
        )
      )
    );
  }
}
