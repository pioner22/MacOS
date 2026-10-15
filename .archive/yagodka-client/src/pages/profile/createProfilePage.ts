import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { focusElement } from "../../helpers/ui/focus";
import type { AppState, ThemeMode } from "../../stores/types";

export interface ProfilePageActions {
  onDraftChange: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onSave: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onRefresh: () => void;
  onCopyId: () => void;
  onShareId: () => void;
  onOpenSessionsPage: () => void;
  onSkinChange: (skinId: string) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onAvatarSelect: (file: File | null) => void;
  onAvatarClear: () => void;
  onPushEnable: () => void;
  onPushDisable: () => void;
  onNotifyInAppEnable: () => void;
  onNotifyInAppDisable: () => void;
  onNotifySoundEnable: () => void;
  onNotifySoundDisable: () => void;
  onForcePwaUpdate: () => void;
}

export interface ProfilePage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

export function createProfilePage(actions: ProfilePageActions): ProfilePage {
  const title = el("div", { class: "chat-title" }, ["Профиль"]);

  const profileName = el("div", { class: "profile-name" }, ["—"]);
  const profileHandle = el("div", { class: "profile-handle" }, ["—"]);
  const profileId = el("div", { class: "profile-id" }, [""]);
  const profileIdValue = el("button", { class: "profile-id-value", type: "button", title: "Скопировать ID" }, ["—"]) as HTMLButtonElement;
  const btnCopyId = el("button", { class: "btn btn-primary profile-id-copy", type: "button" }, ["Скопировать"]) as HTMLButtonElement;
  const btnShareId = el("button", { class: "btn profile-id-share", type: "button" }, ["Поделиться"]) as HTMLButtonElement;
  const profileIdCard = el("div", { class: "profile-id-card", role: "region", "aria-label": "Ваш ID" }, [
    el("div", { class: "profile-id-card-label" }, ["Ваш ID для контактов"]),
    profileIdValue,
    el("div", { class: "profile-id-card-hint" }, ["ID можно отправить другому пользователю, чтобы он быстро нашёл и добавил вас."]),
    el("div", { class: "profile-id-card-actions" }, [btnCopyId, btnShareId]),
  ]);
  const profileStatusPill = el("span", { class: "profile-pill profile-pill-status" }, ["—"]);
  const profileThemePill = el("span", { class: "profile-pill" }, ["—"]);
  const profileSessionsPill = el("span", { class: "profile-pill" }, ["—"]);
  const profileSummary = el("div", { class: "profile-summary", "aria-label": "Сводка профиля" }, [
    profileStatusPill,
    profileThemePill,
    profileSessionsPill,
  ]);
  const profileCompletenessValue = el("div", { class: "profile-insight-value" }, ["—"]);
  const profileCompletenessDetail = el("div", { class: "profile-insight-detail" }, ["Поля профиля"]);
  const profileNotifyValue = el("div", { class: "profile-insight-value" }, ["—"]);
  const profileNotifyDetail = el("div", { class: "profile-insight-detail" }, ["Уведомления"]);
  const profileDevicesValue = el("div", { class: "profile-insight-value" }, ["—"]);
  const profileDevicesDetail = el("div", { class: "profile-insight-detail" }, ["Устройства"]);
  const profileInsightGrid = el("div", { class: "profile-insight-grid", "aria-label": "Ключевые настройки профиля" }, [
    el("div", { class: "profile-insight-card profile-insight-card-primary" }, [
      el("div", { class: "profile-insight-label" }, ["Карточка"]),
      profileCompletenessValue,
      profileCompletenessDetail,
    ]),
    el("div", { class: "profile-insight-card" }, [
      el("div", { class: "profile-insight-label" }, ["Уведомления"]),
      profileNotifyValue,
      profileNotifyDetail,
    ]),
    el("div", { class: "profile-insight-card" }, [
      el("div", { class: "profile-insight-label" }, ["Устройства"]),
      profileDevicesValue,
      profileDevicesDetail,
    ]),
  ]);

  const avatarPreview = el("button", { class: "avatar avatar-xl profile-avatar-btn", type: "button", "aria-label": "Аватар профиля" });
  const avatarFile = el("input", { class: "hidden", type: "file", accept: "image/*" }) as HTMLInputElement;
  const btnAvatarUpload = el("button", { class: "btn", type: "button" }, ["Загрузить…"]);
  const btnAvatarClear = el("button", { class: "btn btn-danger", type: "button" }, ["Удалить"]);
  const avatarActions = el("div", { class: "profile-head-actions" }, [btnAvatarUpload, btnAvatarClear, avatarFile]);
  const headTop = el("div", { class: "profile-head-top" }, [
    avatarPreview,
    el("div", { class: "profile-head-main" }, [profileName, profileHandle, profileId, profileSummary]),
  ]);
  const head = el("div", { class: "profile-card profile-head" }, [headTop, profileIdCard, avatarActions]);

  const displayNameLabel = el("label", { class: "modal-label", for: "profile-display-name" }, ["Имя"]);
  const displayNameInput = el("input", {
    class: "modal-input",
    type: "text",
    id: "profile-display-name",
    placeholder: "Имя",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const handleLabel = el("label", { class: "modal-label", for: "profile-handle" }, ["Логин"]);
  const handleInput = el("input", {
    class: "modal-input",
    type: "text",
    id: "profile-handle",
    placeholder: "@name",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const statusLabel = el("label", { class: "modal-label", for: "profile-status" }, ["Статус"]);
  const statusInput = el("input", {
    class: "modal-input",
    type: "text",
    id: "profile-status",
    placeholder: "Например: на связи",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const bioLabel = el("label", { class: "modal-label", for: "profile-bio" }, ["О себе"]);
  const bioInput = el("textarea", {
    class: "modal-input",
    id: "profile-bio",
    placeholder: "Коротко о себе…",
    rows: "4",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLTextAreaElement;

  const skinLabel = el("label", { class: "modal-label", for: "profile-skin" }, ["Стиль интерфейса"]);
  const skinSelect = el("select", { class: "modal-input", id: "profile-skin" }, []) as HTMLSelectElement;
  const skinHint = el("div", { class: "profile-hint" }, ["Оформление применяется сразу и не меняет ваши сообщения."]);

  const themeLabel = el("div", { class: "modal-label" }, ["Тема"]);
  const btnLight = el("button", { class: "btn", type: "button", "data-theme": "light" }, ["Светлый"]);
  const btnDark = el("button", { class: "btn", type: "button", "data-theme": "dark" }, ["Тёмный"]);
  const themeToggle = el("div", { class: "theme-toggle", role: "group", "aria-label": "Тема" }, [btnLight, btnDark]);
  const themeHint = el("div", { class: "profile-hint" }, ["Быстрое переключение темы (светлая/тёмная)"]);

  const pushLabel = el("div", { class: "modal-label" }, ["Уведомления (PWA)"]);
  const pushStatus = el("div", { class: "profile-hint" }, ["—"]);
  const btnPushEnable = el("button", { class: "btn btn-primary", type: "button" }, ["Включить"]);
  const btnPushDisable = el("button", { class: "btn", type: "button" }, ["Выключить"]);
  const pushActions = el("div", { class: "profile-actions" }, [btnPushEnable, btnPushDisable]);

  const notifyInAppLabel = el("div", { class: "modal-label" }, ["Уведомления в приложении"]);
  const notifyInAppHint = el("div", { class: "profile-hint" }, ["Показывать уведомления, когда вкладка скрыта (без Push)"]);
  const btnNotifyInAppOn = el("button", { class: "btn", type: "button" }, ["Вкл"]);
  const btnNotifyInAppOff = el("button", { class: "btn", type: "button" }, ["Выкл"]);
  const notifyInAppActions = el("div", { class: "profile-actions" }, [btnNotifyInAppOn, btnNotifyInAppOff]);

  const notifySoundLabel = el("div", { class: "modal-label" }, ["Звук уведомлений"]);
  const notifySoundHint = el("div", { class: "profile-hint" }, ["Звук работает, когда приложение открыто (Push‑звук зависит от ОС)"]);
  const btnNotifySoundOn = el("button", { class: "btn", type: "button" }, ["Вкл"]);
  const btnNotifySoundOff = el("button", { class: "btn", type: "button" }, ["Выкл"]);
  const notifySoundActions = el("div", { class: "profile-actions" }, [btnNotifySoundOn, btnNotifySoundOff]);

  const pwaUpdateLabel = el("div", { class: "modal-label" }, ["Обновления приложения"]);
  const pwaUpdateHint = el("div", { class: "profile-hint" }, ["—"]);
  const btnPwaUpdate = el("button", { class: "btn btn-primary", type: "button" }, ["Проверить обновление"]);
  const pwaUpdateActions = el("div", { class: "profile-actions" }, [btnPwaUpdate]);

  const sessionsHint = el("div", { class: "profile-hint" }, ["Список устройств открывается отдельно, чтобы профиль оставался компактным."]);
  const sessionsSummary = el("div", { class: "profile-hint" }, ["Откройте список устройств, чтобы проверить входы и завершить лишние."]);
  const btnOpenSessions = el("button", { class: "btn", type: "button" }, ["Открыть устройства"]);
  const sessionsActions = el("div", { class: "profile-actions" }, [btnOpenSessions]);

  const field = (label: HTMLElement, control: HTMLElement, extraClass = ""): HTMLElement =>
    el("div", { class: `profile-field-control${extraClass ? ` ${extraClass}` : ""}` }, [label, control]);

  const account = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["Аккаунт"]),
    el("div", { class: "profile-field-grid" }, [
      field(displayNameLabel, displayNameInput),
      field(handleLabel, handleInput),
      field(statusLabel, statusInput, "profile-field-status"),
    ]),
    field(bioLabel, bioInput),
  ]);

  const appearance = el("div", { class: "profile-card profile-card-appearance" }, [
    el("div", { class: "profile-card-title" }, ["Оформление"]),
    themeLabel,
    themeToggle,
    themeHint,
    skinLabel,
    skinSelect,
    skinHint,
  ]);

  const notifications = el("div", { class: "profile-card profile-card-notifications" }, [
    el("div", { class: "profile-card-title" }, ["Уведомления"]),
    pushLabel,
    pushActions,
    pushStatus,
    notifyInAppLabel,
    notifyInAppActions,
    notifyInAppHint,
    notifySoundLabel,
    notifySoundActions,
    notifySoundHint,
  ]);

  const pwaCard = el("div", { class: "profile-card profile-card-pwa" }, [
    el("div", { class: "profile-card-title" }, ["Приложение"]),
    pwaUpdateLabel,
    pwaUpdateActions,
    pwaUpdateHint,
  ]);

  const sessionsCard = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["Устройства"]),
    sessionsHint,
    sessionsSummary,
    sessionsActions,
  ]);

  const root = el("div", { class: "page page-profile" }, [
    title,
    head,
    profileInsightGrid,
    account,
    appearance,
    notifications,
    sessionsCard,
    pwaCard,
  ]);

  function draft() {
    return { displayName: displayNameInput.value, handle: handleInput.value, bio: bioInput.value, status: statusInput.value };
  }

  function save() {
    actions.onSave(draft());
  }

  profileIdValue.addEventListener("click", () => actions.onCopyId());
  btnCopyId.addEventListener("click", () => actions.onCopyId());
  btnShareId.addEventListener("click", () => actions.onShareId());
  skinSelect.addEventListener("change", () => actions.onSkinChange(skinSelect.value));
  btnLight.addEventListener("click", () => actions.onThemeChange("light"));
  btnDark.addEventListener("click", () => actions.onThemeChange("dark"));
  btnPushEnable.addEventListener("click", () => actions.onPushEnable());
  btnPushDisable.addEventListener("click", () => actions.onPushDisable());
  btnNotifyInAppOn.addEventListener("click", () => actions.onNotifyInAppEnable());
  btnNotifyInAppOff.addEventListener("click", () => actions.onNotifyInAppDisable());
  btnNotifySoundOn.addEventListener("click", () => actions.onNotifySoundEnable());
  btnNotifySoundOff.addEventListener("click", () => actions.onNotifySoundDisable());
  btnPwaUpdate.addEventListener("click", () => actions.onForcePwaUpdate());
  btnOpenSessions.addEventListener("click", () => actions.onOpenSessionsPage());

  avatarPreview.addEventListener("click", () => avatarFile.click());
  btnAvatarUpload.addEventListener("click", () => avatarFile.click());
  avatarFile.addEventListener("change", () => {
    const file = avatarFile.files && avatarFile.files.length ? avatarFile.files[0] : null;
    avatarFile.value = "";
    actions.onAvatarSelect(file);
  });
  btnAvatarClear.addEventListener("click", () => actions.onAvatarClear());

  displayNameInput.addEventListener("input", () => actions.onDraftChange(draft()));
  handleInput.addEventListener("input", () => actions.onDraftChange(draft()));
  statusInput.addEventListener("input", () => actions.onDraftChange(draft()));
  bioInput.addEventListener("input", () => actions.onDraftChange(draft()));

  handleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });
  displayNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });
  statusInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });

  function update(state: AppState) {
    const me = state.selfId ? state.profiles[state.selfId] : null;
    const myId = state.selfId || state.authRememberedId || "";
    profileName.textContent = me?.display_name ? me.display_name : "Без имени";
    const h = me?.handle ? String(me.handle).trim() : "";
    profileHandle.textContent = h ? (h.startsWith("@") ? h : `@${h}`) : "Логин не задан";
    profileId.textContent = myId ? `ID: ${myId}` : "ID появится после входа";
    profileIdValue.textContent = myId || "—";
    profileIdValue.disabled = !myId;
    btnCopyId.disabled = !myId;
    btnShareId.disabled = !myId;
    const statusRaw = String(me?.status || state.profileDraftStatus || "").trim();
    profileStatusPill.textContent = statusRaw ? `Статус: ${statusRaw}` : "Статус не задан";
    profileStatusPill.classList.toggle("is-muted", !statusRaw);
    profileThemePill.textContent = state.theme === "light" ? "Светлая тема" : "Тёмная тема";
    const profileFields = [
      String(me?.display_name || state.profileDraftDisplayName || "").trim(),
      h,
      statusRaw,
      String(me?.bio || state.profileDraftBio || "").trim(),
    ];
    const completion = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);
    profileCompletenessValue.textContent = completion >= 100 ? "Готов" : completion >= 75 ? "Почти" : "Черновик";
    profileCompletenessDetail.textContent =
      completion >= 100 ? "Профиль заполнен" : completion >= 75 ? "Осталось чуть-чуть" : completion >= 50 ? "Добавьте пару деталей" : "Добавьте имя, логин и статус";

    const url = myId ? getStoredAvatar("dm", myId) : null;
    const hue = avatarHue(`dm:${myId || "anon"}`);
    avatarPreview.style.setProperty("--avatar-h", String(hue));
    avatarPreview.classList.toggle("avatar-img", Boolean(url));
    avatarPreview.textContent = url ? "" : avatarMonogram("dm", myId);
    avatarPreview.style.backgroundImage = url ? `url(${url})` : "";
    const hasServerAvatar = Boolean((me?.avatar_rev || 0) > 0 && me?.avatar_mime);
    (btnAvatarClear as HTMLButtonElement).disabled = !url && !hasServerAvatar;

    if (document.activeElement !== displayNameInput && displayNameInput.value !== state.profileDraftDisplayName) {
      displayNameInput.value = state.profileDraftDisplayName;
    }
    if (document.activeElement !== handleInput && handleInput.value !== state.profileDraftHandle) {
      handleInput.value = state.profileDraftHandle;
    }
    if (document.activeElement !== statusInput && statusInput.value !== state.profileDraftStatus) {
      statusInput.value = state.profileDraftStatus;
    }
    if (document.activeElement !== bioInput && bioInput.value !== state.profileDraftBio) {
      bioInput.value = state.profileDraftBio;
    }

    const skins = state.skins || [];
    const sig = skins.map((s) => s.id).join("|");
    if (skinSelect.dataset.sig !== sig) {
      skinSelect.dataset.sig = sig;
      skinSelect.replaceChildren(
        ...skins.map((s) => {
          const opt = el("option", { value: s.id }, [s.title]);
          (opt as HTMLOptionElement).selected = s.id === state.skin;
          return opt;
        })
      );
    }
    if (document.activeElement !== skinSelect && skinSelect.value !== state.skin) {
      skinSelect.value = state.skin;
    }

    const isLight = state.theme === "light";
    btnLight.classList.toggle("btn-active", isLight);
    btnDark.classList.toggle("btn-active", !isLight);

    const pushSupported = Boolean(state.pwaPushSupported);
    const perm = state.pwaPushPermission;
    const subscribed = Boolean(state.pwaPushSubscribed);
    const serverKey = Boolean(state.pwaPushPublicKey);
    const optOut = Boolean(state.pwaPushOptOut);
    let pushText = "—";
    if (!pushSupported) pushText = "Push не поддерживается в этом браузере";
    else if (!serverKey) pushText = "Push отключен на сервере";
    else if (perm === "denied") pushText = "Разрешение на уведомления запрещено";
    else if (perm === "default") pushText = "Нужно разрешение на уведомления";
    else if (subscribed) pushText = "Push включен";
    else if (optOut) pushText = "Push отключен пользователем";
    else pushText = "Разрешение есть, Push еще не включен";
    if (state.pwaPushStatus && state.pwaPushStatus !== pushText) {
      pushText = `${pushText} · ${state.pwaPushStatus}`;
    }
    pushStatus.textContent = pushText;
    profileNotifyValue.textContent = subscribed ? "Включены" : state.notifyInAppEnabled ? "В приложении" : "Тихий режим";
    profileNotifyDetail.textContent = subscribed ? "Push готов" : state.notifyInAppEnabled ? "Показываем внутри" : "Уведомления выключены";
    btnPushEnable.disabled = !pushSupported || !serverKey || subscribed;
    btnPushDisable.disabled = !pushSupported || !subscribed;

    const notifyApiSupported = typeof Notification !== "undefined" && typeof Notification.requestPermission === "function";
    btnNotifyInAppOn.disabled = !notifyApiSupported;
    btnNotifyInAppOff.disabled = !notifyApiSupported;
    btnNotifyInAppOn.classList.toggle("btn-active", Boolean(state.notifyInAppEnabled));
    btnNotifyInAppOff.classList.toggle("btn-active", !Boolean(state.notifyInAppEnabled));

    btnNotifySoundOn.classList.toggle("btn-active", Boolean(state.notifySoundEnabled));
    btnNotifySoundOff.classList.toggle("btn-active", !Boolean(state.notifySoundEnabled));

    const swSupported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
    let updateText = "Проверяет свежую версию и применяет её после подтверждения.";
    if (!swSupported) updateText = "PWA обновления не поддерживаются в этом браузере";
    else if (state.pwaUpdate?.stage === "error") updateText = state.pwaUpdate.detail || "Обновление требует повторной проверки.";
    else if (state.pwaUpdate?.stage === "checking") updateText = "Проверяем свежую сборку и Service Worker.";
    else if (state.pwaUpdate?.stage === "applying" || state.pwaUpdate?.stage === "verifying") updateText = "Обновление устанавливается и проверяется.";
    else if (state.pwaUpdateAvailable) updateText = "Доступно обновление — нажмите, чтобы применить.";
    pwaUpdateHint.textContent = updateText;
    btnPwaUpdate.disabled = !swSupported;

    const sessionEntries = Array.isArray(state.sessionDevices) ? state.sessionDevices : [];
    const otherCount = sessionEntries.filter((entry) => !entry.current).length;
    profileSessionsPill.textContent = sessionEntries.length ? `Устройств: ${sessionEntries.length}` : "Устройства";
    profileDevicesValue.textContent = sessionEntries.length ? String(sessionEntries.length) : "Проверить";
    profileDevicesDetail.textContent = otherCount ? `Других: ${otherCount}` : sessionEntries.length ? "Только текущее" : "Откройте список";
    sessionsHint.textContent =
      state.sessionDevicesStatus || "Список устройств открывается отдельно, чтобы профиль оставался компактным.";
    if (!sessionEntries.length) {
      sessionsSummary.textContent = "Откройте список устройств, чтобы проверить входы и завершить лишние.";
    } else if (!otherCount) {
      sessionsSummary.textContent = "Сейчас известно только текущее устройство. Подробности доступны отдельно.";
    } else {
      sessionsSummary.textContent = `Устройств: ${sessionEntries.length}. Других: ${otherCount}. Подробности и управление доступны отдельно.`;
    }
    btnOpenSessions.disabled = !(state.authed && state.conn === "connected");
  }

  return {
    root,
    update,
    focus: () => {
      if (window.matchMedia && window.matchMedia("(max-width: 600px)").matches) return;
      focusElement(displayNameInput, { select: true });
    },
  };
}
