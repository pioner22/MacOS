import { el } from "../../helpers/dom/el";
import type { Layout } from "./types";

export function createLayout(root: HTMLElement, opts?: { iosStandalone?: boolean }): Layout {
  const iosStandalone = Boolean(opts?.iosStandalone);
  root.classList.add("app-frame");
  const headerLeft = el("div", { class: "hdr-left" });
  const headerRight = el("div", { class: "hdr-right" });
  const hotkeys = el("div", { class: "hotkeys" });

  const header = el("header", { class: "hdr" }, [headerLeft, headerRight, hotkeys]);

  const sidebar = el("aside", { class: "sidebar" });
  const sidebarBody = el("div", { class: "sidebar-body" });
  const sidebarDock = el("div", { class: "sidebar-bottom-dock", "aria-hidden": "true" });
  const sidebarResizeHandle = el("div", { class: "sidebar-resize-handle", "aria-hidden": "true" });
  sidebar.appendChild(sidebarBody);
  sidebar.appendChild(sidebarDock);
  sidebar.appendChild(sidebarResizeHandle);
  const chatTop = el("div", { class: "chat-top hidden" });
  const chatSearchResults = el("div", { class: "chat-search-results hidden" });
  const chatHost = el("div", { class: "chat-host" });
  const chatSearchFooter = el("div", { class: "chat-search-footer hidden" });
  const chatSelectionBar = el("div", { class: "chat-selection-bar selection-wrapper hidden" });
  const chatJumpIcon = el("span", { class: "chat-jump-icon", "aria-hidden": "true" }, ["↓"]);
  const chatJumpLabel = el("span", { class: "chat-jump-label hidden", "aria-hidden": "true" }, [""]);
  const chatJumpBadge = el("span", { class: "chat-jump-badge hidden", "aria-hidden": "true" }, [""]);
  const chatJump = el(
    "button",
    { class: "btn chat-jump hidden", type: "button", "data-action": "chat-jump-bottom", "aria-label": "Вниз" },
    [chatJumpLabel, chatJumpIcon, chatJumpBadge]
  ) as HTMLButtonElement;
  const chat = el("main", { class: "chat" }, [chatTop, chatSearchResults, chatHost, chatJump]);

  const input = el("textarea", {
    class: "input",
    rows: "1",
    placeholder: "Сообщение",
    "data-ios-assistant": "composer",
    // iOS PWA (standalone) иногда показывает системную панель Undo/Redo/✓ вместо подсказок.
    // Для композера включаем “обычный” режим клавиатуры, чтобы снизить шанс появления панели.
    // На остальных платформах оставляем строгий режим (без автокоррекции/спеллчека) по умолчанию.
    spellcheck: iosStandalone ? "true" : "false",
    autocomplete: "off",
    autocorrect: iosStandalone ? "on" : "off",
    autocapitalize: iosStandalone ? "sentences" : "off",
    inputmode: "text",
    enterkeyhint: "send",
  }) as HTMLTextAreaElement;
  const attachBtn = el("button", { class: "btn composer-action composer-attach", type: "button", title: "Файл", "aria-label": "Прикрепить файл" }, [
    "＋",
  ]) as HTMLButtonElement;
  const emojiBtn = el("button", { class: "btn composer-action composer-emoji", type: "button", title: "Эмодзи", "aria-label": "Открыть эмодзи" }, [
    "☺︎",
  ]) as HTMLButtonElement;
  const voiceBtn = el(
    "button",
    { class: "btn composer-action composer-voice", type: "button", title: "Голосовое", "aria-label": "Записать голосовое сообщение" },
    ["🎙"]
  ) as HTMLButtonElement;
  const videoNoteBtn = el(
    "button",
    {
      class: "btn composer-action composer-video-note",
      type: "button",
      title: "Видео-сота",
      "aria-label": "Записать видеосообщение (сота)",
    },
    ["⬡"]
  ) as HTMLButtonElement;
  const sendBtn = el(
    "button",
    {
      class: "btn composer-action composer-send",
      type: "button",
      title: "Отправить",
      "aria-label": "Отправить",
      "data-action": "composer-send",
    },
    ["→"]
  ) as HTMLButtonElement;
  const boardEditorBtn = el(
    "button",
    {
      class: "btn composer-action composer-board-editor hidden",
      type: "button",
      title: "Редактор новости",
      "aria-label": "Редактор новости",
      "data-action": "board-editor-toggle",
    },
    ["✎"]
  ) as HTMLButtonElement;
  const editBar = el("div", { class: "composer-edit hidden", id: "composer-edit", role: "status", "aria-live": "polite" }, [
    el("div", { class: "composer-edit-body" }, [
      el("div", { class: "composer-edit-title" }, ["Редактирование"]),
      el("div", { class: "composer-edit-text", id: "composer-edit-text" }, [""]),
    ]),
    el(
      "button",
      {
        class: "btn composer-edit-cancel",
        type: "button",
        "data-action": "composer-edit-cancel",
        title: "Отменить редактирование",
        "aria-label": "Отменить редактирование",
      },
      ["×"]
    ),
  ]);
  const helperBar = el("div", { class: "composer-helper hidden", id: "composer-helper", role: "status", "aria-live": "polite" }, [
    el("div", { class: "composer-helper-icon", id: "composer-helper-icon", "aria-hidden": "true" }, ["↩"]),
    el("div", { class: "composer-helper-body" }, [
      el("div", { class: "composer-helper-title", id: "composer-helper-title" }, ["Ответ"]),
      el("div", { class: "composer-helper-text", id: "composer-helper-text" }, [""]),
    ]),
    el("div", { class: "composer-helper-actions" }, [
      el(
        "button",
        {
          class: "btn composer-helper-menu",
          type: "button",
          id: "composer-helper-menu",
          "data-action": "composer-helper-menu",
          title: "Меню",
          "aria-label": "Меню",
        },
        ["⋯"]
      ),
      el(
        "button",
        {
          class: "btn composer-helper-cancel",
          type: "button",
          "data-action": "composer-helper-cancel",
          title: "Отменить",
          "aria-label": "Отменить",
        },
        ["×"]
      ),
    ]),
  ]);
  const composerMeta = el("div", { class: "composer-meta" }, [
    el("span", { class: "composer-hint", "aria-hidden": "true" }, ["Shift+Enter — новая строка"]),
    el("span", { class: "composer-count", "aria-hidden": "true" }, ["0/4000"]),
  ]);

  const boardEditorToolbar = el("div", { class: "board-editor-toolbar", role: "toolbar", "aria-label": "Форматирование новости" }, [
    el("button", { class: "btn board-editor-tool", type: "button", "data-action": "board-tool-heading", title: "Заголовок (#)" }, ["H"]),
    el("button", { class: "btn board-editor-tool", type: "button", "data-action": "board-tool-list", title: "Список (•)" }, ["•"]),
    el("button", { class: "btn board-editor-tool", type: "button", "data-action": "board-tool-quote", title: "Цитата (>)" }, ["❝"]),
    el("button", { class: "btn board-editor-tool", type: "button", "data-action": "board-tool-divider", title: "Разделитель (—)" }, ["—"]),
    el("span", { class: "board-editor-sep", "aria-hidden": "true" }, [""]),
    el(
      "button",
      {
        class: "btn board-editor-tool board-editor-kind kind-added",
        type: "button",
        "data-action": "board-tool-kind-added",
        title: "Секция (зелёный)",
        "aria-label": "Секция (зелёный)",
      },
      ["##"]
    ),
    el(
      "button",
      {
        class: "btn board-editor-tool board-editor-kind kind-improved",
        type: "button",
        "data-action": "board-tool-kind-improved",
        title: "Секция (синий)",
        "aria-label": "Секция (синий)",
      },
      ["##"]
    ),
    el(
      "button",
      {
        class: "btn board-editor-tool board-editor-kind kind-fixed",
        type: "button",
        "data-action": "board-tool-kind-fixed",
        title: "Секция (жёлтый)",
        "aria-label": "Секция (жёлтый)",
      },
      ["##"]
    ),
    el(
      "button",
      {
        class: "btn board-editor-tool board-editor-kind kind-notes",
        type: "button",
        "data-action": "board-tool-kind-notes",
        title: "Секция (нейтр.)",
        "aria-label": "Секция (нейтр.)",
      },
      ["##"]
    ),
  ]);

  const boardEditorPreviewBody = el("div", { class: "board-editor-preview-body" }, [""]);
  const boardEditorPreview = el("div", { class: "board-editor-preview" }, [
    el("div", { class: "board-editor-preview-title" }, ["Предпросмотр"]),
    boardEditorPreviewBody,
  ]);

  const boardScheduleInput = el("input", {
    class: "board-editor-datetime",
    id: "board-editor-schedule-at",
    type: "datetime-local",
    "data-ios-assistant": "strict",
    autocomplete: "off",
  }) as HTMLInputElement;
  const boardScheduleBtn = el(
    "button",
    { class: "btn board-editor-schedule-btn", type: "button", "data-action": "board-schedule-add" },
    ["Запланировать"]
  ) as HTMLButtonElement;
  const boardScheduleClearBtn = el(
    "button",
    { class: "btn board-editor-schedule-clear", type: "button", "data-action": "board-schedule-clear" },
    ["Сброс"]
  ) as HTMLButtonElement;
  const boardScheduleRow = el("div", { class: "board-editor-schedule" }, [
    el("div", { class: "board-editor-schedule-label" }, ["Публикация"]),
    boardScheduleInput,
    boardScheduleBtn,
    boardScheduleClearBtn,
  ]);
  const boardScheduleHint = el("div", { class: "board-editor-schedule-hint" }, [
    "Можно запланировать на ближайшие 7 дней (по вашему времени). Best‑effort: отправка произойдёт, пока приложение открыто (или при следующем запуске, если время уже наступило).",
  ]);
  const boardScheduleList = el("div", { class: "board-editor-schedule-list" }, [""]);

  const boardPublishBtn = el("button", { class: "btn board-editor-publish", type: "button", "data-action": "board-publish" }, [
    "Опубликовать",
  ]) as HTMLButtonElement;
  const boardActionsRow = el("div", { class: "board-editor-actions" }, [boardPublishBtn]);

  const boardEditorWrap = el("div", { class: "board-editor hidden", id: "board-editor" }, [
    boardEditorToolbar,
    boardScheduleRow,
    boardScheduleHint,
    boardScheduleList,
    boardEditorPreview,
    boardActionsRow,
  ]);
  const composerActionsLeft = el("div", { class: "composer-actions composer-actions-left" }, [
    // Telegram-like: ✏️ стоит рядом со скрепкой (особенно важно на mobile, где смайлы скрыты).
    attachBtn,
    boardEditorBtn,
    emojiBtn,
  ]);
  const composerActionsMedia = el("div", { class: "composer-actions composer-actions-media" }, [videoNoteBtn, voiceBtn]);
  const composerField = el("div", { class: "composer-field" }, [composerActionsLeft, input, composerActionsMedia]);
  const composerRow = el("div", { class: "composer-row" }, [
    composerField,
    el("div", { class: "composer-actions composer-actions-right" }, [sendBtn]),
  ]);
  const inputWrap = el("div", { class: "input-wrap" }, [chatSelectionBar, editBar, helperBar, boardEditorWrap, composerRow, composerMeta]);

  const footer = el("footer", { class: "footer" });
  const toastHost = el("div", { class: "toast-host hidden", "aria-live": "polite", "aria-atomic": "true" });
  const navOverlay = el("div", { class: "nav-overlay hidden", "aria-hidden": "true" });
  const overlay = el("div", { class: "overlay hidden" });

  const chatCol = el("div", { class: "chat-col" }, [chat, chatSearchFooter, inputWrap]);
  const rightCol = el("aside", { class: "right-col hidden", "aria-hidden": "true" });
  const grid = el("div", { class: "grid" }, [sidebar, chatCol, rightCol]);

  const app = el("div", { class: "app" }, [header, grid, footer, toastHost, navOverlay, overlay]);
  // Keep the boot screen in DOM until the app signals it has booted.
  // This prevents a "black screen" during PWA update/restart flows.
  const boot = root.querySelector(".boot");
  if (boot) root.replaceChildren(boot, app);
  else root.replaceChildren(app);

  return {
    root,
    headerLeft,
    headerRight,
    hotkeys,
    sidebar,
    sidebarBody,
    sidebarDock,
    sidebarResizeHandle,
    chat,
    chatTop,
    chatSearchResults,
    chatSearchFooter,
    chatSelectionBar,
    chatHost,
    chatJump,
    chatJumpLabel,
    chatJumpBadge,
    rightCol,
    toastHost,
    inputWrap,
    input,
    attachBtn,
    emojiBtn,
    voiceBtn,
    videoNoteBtn,
    sendBtn,
    boardEditorBtn,
    boardEditorWrap,
    boardEditorToolbar,
    boardEditorPreview,
    boardEditorPreviewBody,
    boardScheduleInput,
    boardScheduleBtn,
    boardScheduleClearBtn,
    boardScheduleList,
    boardPublishBtn,
    footer,
    navOverlay,
    overlay,
  };
}
