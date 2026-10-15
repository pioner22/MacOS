import { el } from "../../helpers/dom/el";
import { focusElement } from "../../helpers/ui/focus";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { AppState, SessionDeviceEntry } from "../../stores/types";

export interface SessionsPageActions {
  onBackToProfile: () => void;
  onRefresh: () => void;
  onLogoutOthers: () => void;
}

export interface SessionsPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

function sessionKindLabel(kind: string | null | undefined): string {
  const value = String(kind || "").trim().toLowerCase();
  if (value === "web") return "Веб";
  if (value === "cli") return "CLI";
  if (value === "pwa") return "PWA";
  return value ? value.toUpperCase() : "Устройство";
}

function sessionPlatformLabel(userAgent: string | null | undefined): string {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return "";
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) return "Android";
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("linux")) return "Linux";
  return "Браузер";
}

function formatSessionMoment(ts: number | null | undefined): string {
  const value = Number(ts || 0);
  if (!Number.isFinite(value) || value <= 0) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value * 1000));
  } catch {
    return new Date(value * 1000).toLocaleString("ru-RU");
  }
}

function sessionTitle(entry: SessionDeviceEntry): string {
  if (entry.current) return "Это устройство";
  const primary = sessionKindLabel(entry.client_kind);
  const platform = sessionPlatformLabel(entry.user_agent);
  return platform && platform !== primary ? `${primary} · ${platform}` : primary || platform || "Устройство";
}

function sessionMetaLines(entry: SessionDeviceEntry): string[] {
  const lines: string[] = [];
  const identity = [sessionKindLabel(entry.client_kind), sessionPlatformLabel(entry.user_agent), entry.client_version ? `v${entry.client_version}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (identity) lines.push(identity);
  lines.push(entry.online ? "Сейчас онлайн" : `Последняя активность: ${formatSessionMoment(entry.last_used_at || entry.issued_at || null)}`);
  const tail = [
    entry.ip_masked ? `Сеть ${entry.ip_masked}` : "",
    entry.expires_at ? `истекает ${formatSessionMoment(entry.expires_at)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (tail) lines.push(tail);
  return lines;
}

function renderSessionEntries(host: HTMLElement, entries: SessionDeviceEntry[], emptyText: string) {
  if (!entries.length) {
    host.replaceChildren(el("div", { class: "profile-session-empty" }, [emptyText]));
    return;
  }
  host.replaceChildren(
    ...entries.map((entry) =>
      el("div", { class: "profile-session-card" }, [
        el("div", { class: "profile-session-head" }, [
          el("div", { class: "profile-session-name" }, [sessionTitle(entry)]),
          el(
            "div",
            {
              class: entry.current ? "profile-session-chip profile-session-chip-current" : "profile-session-chip",
            },
            [entry.current ? "Текущее" : entry.online ? "Онлайн" : "Недавно"]
          ),
        ]),
        ...sessionMetaLines(entry).map((line) => el("div", { class: "profile-session-meta" }, [line])),
      ])
    )
  );
}

export function createSessionsPage(actions: SessionsPageActions): SessionsPage {
  const mobileUi = isMobileLikeUi();
  const title = el("div", { class: "chat-title" }, ["Сессии"]);
  const summary = el("div", { class: "profile-hint" }, ["—"]);
  const hint = el("div", { class: "profile-hint" }, [
    "Здесь показаны текущая сессия и недавние устройства этого аккаунта. Основной профиль больше не раздувается этим списком.",
  ]);
  const btnBack = el("button", { class: "btn", type: "button" }, ["К профилю"]);
  const btnRefresh = el("button", { class: "btn", type: "button" }, ["Обновить список"]);
  const btnLogoutOthers = el("button", { class: "btn btn-danger", type: "button" }, ["Выйти на других устройствах"]);
  const actionsRow = el("div", { class: "profile-actions" }, [btnBack, btnRefresh, btnLogoutOthers]);

  const currentTitle = el("div", { class: "profile-section-title" }, ["Это устройство"]);
  const currentList = el("div", { class: "profile-session-list" }, []);
  const otherTitle = el("div", { class: "profile-section-title" }, ["Другие устройства"]);
  const otherList = el("div", { class: "profile-session-list" }, []);

  const summaryCard = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["Управление сессиями"]),
    hint,
    summary,
    actionsRow,
  ]);

  const sessionsCard = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["Список устройств"]),
    currentTitle,
    currentList,
    otherTitle,
    otherList,
  ]);

  const pageHint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["Esc — назад"]);
  const root = el("div", { class: "page page-profile page-sessions" }, [title, summaryCard, sessionsCard, ...(pageHint ? [pageHint] : [])]);

  btnBack.addEventListener("click", () => actions.onBackToProfile());
  btnRefresh.addEventListener("click", () => actions.onRefresh());
  btnLogoutOthers.addEventListener("click", () => actions.onLogoutOthers());

  function update(state: AppState) {
    const sessionEntries = Array.isArray(state.sessionDevices) ? state.sessionDevices : [];
    const currentEntries = sessionEntries.filter((entry) => entry.current);
    const otherEntries = sessionEntries.filter((entry) => !entry.current);
    summary.textContent =
      state.sessionDevicesStatus ||
      "Здесь можно обновить список устройств и при необходимости завершить все остальные сессии.";
    btnRefresh.disabled = !(state.authed && state.conn === "connected");
    btnLogoutOthers.disabled = !(state.authed && state.conn === "connected") || otherEntries.length === 0;
    renderSessionEntries(currentList, currentEntries, "Текущая сессия появится здесь после первого обновления.");
    renderSessionEntries(otherList, otherEntries, "Других активных устройств сейчас нет.");
  }

  return {
    root,
    update,
    focus: () => {
      if (window.matchMedia && window.matchMedia("(max-width: 600px)").matches) return;
      focusElement(btnRefresh);
    },
  };
}
