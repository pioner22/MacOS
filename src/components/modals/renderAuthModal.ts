import { el } from "../../helpers/dom/el";
import { canUseDesktopBiometricUnlock } from "../../helpers/auth/session";
import { applyLegacyIdMask } from "../../helpers/id/legacyIdMask";
import { focusElement } from "../../helpers/ui/focus";
import { APP_VERSION } from "../../config/app";
import type { AuthMode, ConnStatus, SkinInfo } from "../../stores/types";

export interface AuthModalActions {
  onLogin: () => void;
  onRegister: () => void;
  onTouchId?: () => void;
  onModeChange: (mode: "register" | "login") => void;
  onUseDifferentAccount: () => void;
  onSkinChange: (skinId: string) => void;
  onClose: () => void;
}

type RenderAuthModalLegacyArgs = [
  skins: SkinInfo[],
  currentSkin: string,
  actions: AuthModalActions,
];

type RenderAuthModalExtendedArgs = [
  status: string | undefined,
  conn: ConnStatus,
  skins: SkinInfo[],
  currentSkin: string,
  actions: AuthModalActions,
];

interface EntryCopy {
  panelTitle: string;
  panelSubtitle: string;
  heroTitle: string;
  heroCopy: string;
  primaryLabel: string;
  helper: string;
}

const AUTH_ENTRY_PANEL_TITLE = "Вход в Ягодку";
const AUTH_ENTRY_PANEL_SUBTITLE = "Введите данные аккаунта или создайте новый профиль.";
const AUTH_ENTRY_HERO_TITLE = "Рабочий мессенджер для команды";
const AUTH_ENTRY_HERO_COPY = "Общайтесь, отправляйте файлы и возвращайтесь к рабочим чатам без лишних шагов.";
const AUTH_ENTRY_HELPER = "Для входа нужен ID и ручной ключ. Если создаёте аккаунт, сохраните выданный ID после регистрации.";
const AUTH_ID_INPUT_ID = "auth-id";
const AUTH_LOGIN_MANUAL_INPUT_ID = "auth-manual-entry";
const AUTH_REGISTER_MANUAL_INPUT_ID = "auth-manual-entry-a";
const AUTH_REGISTER_CONFIRM_INPUT_ID = "auth-manual-entry-b";
const AUTH_MANUAL_INPUT_LABEL = "Ручной ввод";
const AUTH_MANUAL_INPUT_PLACEHOLDER = "Введите вручную";
const AUTH_CREDENTIAL_IGNORE_ATTRS = {
  "aria-autocomplete": "none",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
  "data-protonpass-ignore": "true",
  "data-credentialless": "true",
  "data-credential-field": "false",
  "data-autofill-suppressed": "1",
  autofill: "off",
};
const AUTH_ID_FIELD_ATTRS = {
  ...AUTH_CREDENTIAL_IGNORE_ATTRS,
  autocomplete: "off",
};
const AUTH_MANUAL_FIELD_ATTRS = {
  ...AUTH_CREDENTIAL_IGNORE_ATTRS,
  autocomplete: "one-time-code",
  inputmode: "text",
};

function isQuietStatus(status: string, connected: boolean, mode: AuthMode): boolean {
  if (!status) return true;
  if (status === "Связь с сервером установлена" || status === "Вы снова в Ягодке." || status === "Вход выполнен") return true;
  if (connected && status.startsWith("Соединение установлено")) return true;
  if (/обновлени[ея] веб-клиента|service worker|build_id/i.test(status)) return true;
  if (status.startsWith("Подключение") || status.startsWith("Подключаем")) return mode !== "auto";
  return false;
}

function resolveNotice(message: string, status: string, connected: boolean, mode: AuthMode): string {
  if (message) return message;
  if (isQuietStatus(status, connected, mode)) return "";
  if (/code=|errno=|websocket|gateway|build_id|service worker/i.test(status)) {
    return "Нет связи. Проверьте интернет.";
  }
  if (/нет соединения|нет связи/i.test(status)) {
    return "Нет связи. Проверьте интернет.";
  }
  return status;
}

function resolvePrimaryLabel(copy: EntryCopy, status: string, connected: boolean): string {
  if (connected) return copy.primaryLabel;
  if (/обновлени[ея]|обновление клиента|клиента перед подключением/i.test(status)) return "Обновление клиента";
  if (/подключени|подключаем/i.test(status)) return "Подключение…";
  return "Проверьте интернет";
}

function resolveCopy(mode: AuthMode): EntryCopy {
  if (mode === "auto") {
    return {
      panelTitle: AUTH_ENTRY_PANEL_TITLE,
      panelSubtitle: AUTH_ENTRY_PANEL_SUBTITLE,
      heroTitle: AUTH_ENTRY_HERO_TITLE,
      heroCopy: AUTH_ENTRY_HERO_COPY,
      primaryLabel: "Ввести ключ",
      helper: AUTH_ENTRY_HELPER,
    };
  }
  if (mode === "register") {
    return {
      panelTitle: AUTH_ENTRY_PANEL_TITLE,
      panelSubtitle: AUTH_ENTRY_PANEL_SUBTITLE,
      heroTitle: AUTH_ENTRY_HERO_TITLE,
      heroCopy: AUTH_ENTRY_HERO_COPY,
      primaryLabel: "Зарегистрироваться",
      helper: AUTH_ENTRY_HELPER,
    };
  }
  return {
    panelTitle: AUTH_ENTRY_PANEL_TITLE,
    panelSubtitle: AUTH_ENTRY_PANEL_SUBTITLE,
    heroTitle: AUTH_ENTRY_HERO_TITLE,
    heroCopy: AUTH_ENTRY_HERO_COPY,
    primaryLabel: "Войти",
    helper: AUTH_ENTRY_HELPER,
  };
}

function createTouchIdButton(actions: AuthModalActions): HTMLButtonElement {
  const btn = el("button", { class: "btn btn-secondary auth-touchid-btn", type: "button" }, ["Touch ID"]) as HTMLButtonElement;
  btn.addEventListener("click", () => actions.onTouchId?.());
  return btn;
}

export function renderAuthModal(
  mode: AuthMode,
  rememberedId: string | null,
  message: string | undefined,
  ...rest: RenderAuthModalLegacyArgs | RenderAuthModalExtendedArgs
): HTMLElement {
  let status = "";
  let conn: ConnStatus = "connected";
  let skins: SkinInfo[] = [];
  let currentSkin = "";
  let actions: AuthModalActions;

  if (Array.isArray(rest[0])) {
    skins = rest[0];
    currentSkin = String(rest[1] ?? "");
    actions = rest[2] as AuthModalActions;
  } else {
    status = String(rest[0] ?? "");
    conn = (rest[1] as ConnStatus) ?? "connected";
    skins = Array.isArray(rest[2]) ? rest[2] : [];
    currentSkin = String(rest[3] ?? "");
    actions = rest[4] as AuthModalActions;
  }

  const rememberedIdValue = String(rememberedId ?? "").trim();
  const connected = conn === "connected";
  const hasRememberedId = mode === "login" && Boolean(rememberedIdValue);
  const copy = resolveCopy(mode);
  const rawMessage = String(message ?? "").trim();
  const rawStatus = String(status ?? "").trim();
  const visibleNotice = resolveNotice(rawMessage, rawStatus, connected, mode);
  const noticeClass = `auth-entry-notice${visibleNotice ? "" : " auth-entry-notice-empty"}`;
  const showSkinPicker = false;
  const showTouchId = mode === "login" && Boolean(rememberedIdValue) && canUseDesktopBiometricUnlock() && Boolean(actions.onTouchId);

  function wrapWithIdEditAction(input: HTMLInputElement, hasRemembered: boolean): HTMLElement {
    if (!hasRemembered) return input;
    const toggle = el(
      "button",
      {
        class: "btn field-action field-action-edit",
        type: "button",
        "aria-label": "Сменить ID",
        title: "Сменить ID",
      },
      [""]
    ) as HTMLButtonElement;

    toggle.addEventListener("click", () => {
      focusElement(input, { select: true });
    });

    return el("div", { class: "field-with-action auth-id-edit" }, [input, toggle]);
  }

  function wrapWithCodeVisibilityToggle(input: HTMLInputElement): HTMLElement {
    const toggle = el(
      "button",
      {
        class: "btn field-action field-action-eye",
        type: "button",
        "aria-label": "Показать ввод",
        "aria-pressed": "false",
        title: "Показать ввод",
      },
      [""]
    ) as HTMLButtonElement;

    const apply = (visible: boolean) => {
      try {
        input.type = "text";
      } catch {
        // ignore
      }
      input.setAttribute("data-manual-mask", "1");
      input.setAttribute("data-mask-visible", visible ? "1" : "0");
      toggle.classList.toggle("on", visible);
      toggle.setAttribute("aria-pressed", visible ? "true" : "false");
      toggle.setAttribute("aria-label", visible ? "Скрыть ввод" : "Показать ввод");
      toggle.title = visible ? "Скрыть ввод" : "Показать ввод";
    };

    toggle.addEventListener("click", () => {
      const visible = input.getAttribute("data-mask-visible") !== "1";
      apply(visible);
      focusElement(input);
    });

    apply(input.getAttribute("data-mask-visible") === "1");
    return el("div", { class: "field-with-action" }, [input, toggle]);
  }

  function hardenManualEntryInput(input: HTMLInputElement): void {
    input.setAttribute("readonly", "true");
    input.setAttribute("data-manual-entry-ready", "0");
    const unlock = () => {
      input.removeAttribute("readonly");
      input.setAttribute("data-manual-entry-ready", "1");
    };
    input.addEventListener("pointerdown", unlock, { capture: true });
    input.addEventListener("touchstart", unlock, { capture: true });
    input.addEventListener("focus", unlock);
    input.addEventListener("keydown", unlock);
  }

  const root = el("div", { id: "auth-pages", class: `auth-entry-page auth-entry-${mode}` });
  const scrollable = el("div", { class: "scrollable auth-entry-scroll" });
  const layout = el("div", { class: `container modal-auth auth-entry-layout ${mode === "register" ? "page-signUp" : "page-sign"}` });
  const updateMarkerText = `Web ${APP_VERSION}`;
  const updateMarker = el(
    "div",
    { class: "auth-entry-update-marker", "aria-label": `Версия web-клиента ${APP_VERSION}` },
    [updateMarkerText]
  );
  const btnClose = el("button", { class: "btn auth-close", type: "button", title: "Закрыть", "aria-label": "Закрыть" }, [
    "×",
  ]) as HTMLButtonElement;

  const hero = el("section", { class: "auth-entry-hero", "aria-label": "Ягодка" }, [
    el("div", { class: "auth-hero-brand-block" }, [
      el("div", { class: "auth-hero-orb", "aria-hidden": "true" }, [
        el("img", { class: "auth-logo", src: "./icons/icon.svg", alt: "" }, []),
      ]),
      el("div", { class: "auth-hero-wordmark" }, ["Ягодка"]),
      el("div", { class: "auth-hero-version" }, [`Web ${APP_VERSION}`]),
    ]),
    el("div", { class: "auth-hero-message" }, [
      el("div", { class: "auth-hero-kicker" }, ["Ягодка"]),
      el("div", { class: "auth-hero-title" }, [copy.heroTitle]),
      el("div", { class: "auth-hero-copy" }, [copy.heroCopy]),
    ]),
  ]);

  const brand = el("div", { class: "auth-brand" }, [
    el("img", { class: "auth-brand-icon", src: "./icons/icon.svg", alt: "" }, []),
    el("div", { class: "auth-brand-text" }, ["Ягодка"]),
  ]);
  const tabRegister = el("button", { class: "btn auth-tab", type: "button" }, ["Создать"]);
  const tabLogin = el("button", { class: "btn auth-tab", type: "button" }, ["Вход"]);
  const tabs = el("div", { class: "modal-tabs auth-segmented-tabs" }, [tabRegister, tabLogin]);
  tabRegister.classList.toggle("btn-active", mode === "register");
  tabLogin.classList.toggle("btn-active", mode === "login");
  if (mode === "register") tabRegister.setAttribute("aria-pressed", "true");
  if (mode === "login") tabLogin.setAttribute("aria-pressed", "true");

  const panel = el("section", { class: "auth-entry-panel" }, [
    el("div", { class: "auth-panel-top" }, [brand, btnClose]),
    el("div", { class: "auth-panel-heading" }, [
      el("div", { class: "auth-subtitle" }, [copy.panelTitle]),
      el("div", { class: "auth-note" }, [copy.panelSubtitle]),
    ]),
    ...(mode === "auto" ? [] : [tabs]),
    el("div", { class: noticeClass, ...(visibleNotice ? {} : { "aria-hidden": "true" }) }, [visibleNotice]),
  ]);

  const skinLabel = el("label", { class: "modal-label", for: "auth-skin" }, ["Оформление"]);
  const skinSelect = el("select", { class: "modal-input", id: "auth-skin" }, []) as HTMLSelectElement;
  skinSelect.replaceChildren(
    ...(skins || []).map((s) => {
      const opt = el("option", { value: s.id }, [s.title]);
      (opt as HTMLOptionElement).selected = s.id === currentSkin;
      return opt;
    })
  );

  const formId = "auth-form";
  const primaryButton =
    mode === "auto"
      ? null
      : (el(
          "button",
          { class: "btn btn-primary auth-primary-cta", type: "button", ...(connected ? {} : { disabled: "true" }) },
          [resolvePrimaryLabel(copy, rawStatus, connected)]
        ) as HTMLButtonElement);

  const body =
    mode === "auto"
      ? el("div", { class: "modal-body input-wrapper auth-entry-form auth-entry-form-auto" })
      : el("div", {
          class: "modal-body input-wrapper auth-entry-form auth-entry-form-fixed",
          id: formId,
          autocomplete: "off",
          "data-form-type": "other",
          "data-auth-form": "manual-only",
        });

  if (mode === "auto") {
    const useManualLogin = el("button", { class: "btn btn-primary auth-primary-cta", type: "button" }, [copy.primaryLabel]) as HTMLButtonElement;
    const useOtherAccount = el("button", { class: "btn btn-secondary", type: "button" }, ["Другой аккаунт"]) as HTMLButtonElement;
    useManualLogin.addEventListener("click", () => actions.onModeChange(rememberedIdValue ? "login" : "register"));
    useOtherAccount.addEventListener("click", () => actions.onUseDifferentAccount());
    body.append(
      el("div", { class: "modal-help auth-section-lead" }, [copy.helper]),
      el("div", { class: "modal-actions modal-actions-compose auth-inline-actions" }, [
        useManualLogin,
        useOtherAccount,
      ])
    );
  } else if (mode === "register") {
    const pw1Input = el("input", {
      class: "modal-input auth-manual-key-input",
      id: AUTH_REGISTER_MANUAL_INPUT_ID,
      name: "manual-field-a",
      type: "text",
      placeholder: AUTH_MANUAL_INPUT_PLACEHOLDER,
      ...AUTH_MANUAL_FIELD_ATTRS,
      "data-manual-mask": "1",
      "data-mask-visible": "0",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      enterkeyhint: "next",
    }) as HTMLInputElement;
    const pw2Input = el("input", {
      class: "modal-input auth-manual-key-input",
      id: AUTH_REGISTER_CONFIRM_INPUT_ID,
      name: "manual-field-b",
      type: "text",
      placeholder: "Повторите ввод",
      ...AUTH_MANUAL_FIELD_ATTRS,
      "data-manual-mask": "1",
      "data-mask-visible": "0",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      enterkeyhint: "done",
    }) as HTMLInputElement;
    hardenManualEntryInput(pw1Input);
    hardenManualEntryInput(pw2Input);
    body.append(
      el("div", { class: "auth-field-stack" }, [
        el("label", { class: "modal-label", for: AUTH_REGISTER_MANUAL_INPUT_ID }, [AUTH_MANUAL_INPUT_LABEL]),
        wrapWithCodeVisibilityToggle(pw1Input),
      ]),
      el("div", { class: "auth-field-stack" }, [
        el("label", { class: "modal-label", for: AUTH_REGISTER_CONFIRM_INPUT_ID }, ["Повтор ввода"]),
        wrapWithCodeVisibilityToggle(pw2Input),
      ]),
      el("div", { class: "modal-help auth-section-lead" }, [copy.helper]),
      el("div", { class: "modal-actions" }, primaryButton ? [primaryButton] : [])
    );
  } else {
    const idInput = el("input", {
      class: "modal-input",
      id: AUTH_ID_INPUT_ID,
      name: "manual-identity",
      placeholder: "517-048-184 или @login",
      ...AUTH_ID_FIELD_ATTRS,
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      inputmode: "text",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "next",
      value: rememberedIdValue,
    }) as HTMLInputElement;
    let autoSelected = false;
    idInput.addEventListener("focus", () => {
      if (autoSelected) return;
      if (!hasRememberedId) return;
      if (idInput.value !== rememberedIdValue) return;
      autoSelected = true;
      try {
        idInput.select();
      } catch {
        // ignore
      }
    });
    idInput.addEventListener("input", () => {
      applyLegacyIdMask(idInput);
    });
    const pwInput = el("input", {
      class: "modal-input auth-manual-key-input",
      id: AUTH_LOGIN_MANUAL_INPUT_ID,
      name: "manual-field",
      type: "text",
      placeholder: AUTH_MANUAL_INPUT_PLACEHOLDER,
      ...AUTH_MANUAL_FIELD_ATTRS,
      "data-manual-mask": "1",
      "data-mask-visible": "0",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "done",
    }) as HTMLInputElement;
    hardenManualEntryInput(pwInput);
    const touchIdBtn = showTouchId ? createTouchIdButton(actions) : null;
    const manualIdBlock = el("div", { class: "auth-field-stack auth-manual-id" }, [
      el("label", { class: "modal-label", for: AUTH_ID_INPUT_ID }, ["ID или @логин"]),
      wrapWithIdEditAction(idInput, hasRememberedId),
    ]);

    body.append(
      manualIdBlock,
      el("div", { class: "auth-field-stack" }, [
        el("label", { class: "modal-label", for: AUTH_LOGIN_MANUAL_INPUT_ID }, [AUTH_MANUAL_INPUT_LABEL]),
        wrapWithCodeVisibilityToggle(pwInput),
      ]),
      el("div", { class: "modal-help auth-section-lead" }, [copy.helper]),
      el("div", { class: `modal-actions${touchIdBtn ? " auth-inline-actions" : ""}` }, [
        ...(touchIdBtn ? [touchIdBtn] : []),
        ...(primaryButton ? [primaryButton] : []),
      ])
    );
  }

  panel.append(
    body,
    ...(showSkinPicker
      ? [
          el("div", { class: "auth-extra" }, [
            skinLabel,
            skinSelect,
            el("div", { class: "modal-help auth-extra-help" }, ["Можно поменять и после входа."]),
          ]),
        ]
      : []),
    el("div", { class: "modal-warn auth-entry-warn-reserved", "aria-hidden": "true" })
  );
  layout.append(hero, panel);
  scrollable.append(layout, updateMarker);
  root.append(scrollable);

  tabRegister.addEventListener("click", () => actions.onModeChange("register"));
  tabLogin.addEventListener("click", () => actions.onModeChange("login"));
  skinSelect.addEventListener("change", () => actions.onSkinChange(skinSelect.value));
  btnClose.addEventListener("click", () => actions.onClose());

  if (mode !== "auto") {
    const submitCurrentMode = () => {
      if (mode === "register") actions.onRegister();
      else actions.onLogin();
    };

    body.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key !== "Enter" || ev.isComposing) return;
      ev.preventDefault();
      submitCurrentMode();
    });

    if (primaryButton) {
      // iOS Safari/PWA can miss linked form semantics. Keep a direct tap path.
      primaryButton.addEventListener("click", (e) => {
        e.preventDefault();
        submitCurrentMode();
      });
    }
  }
  return root;
}
