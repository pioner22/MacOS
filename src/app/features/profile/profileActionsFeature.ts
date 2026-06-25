import type { Store } from "../../../stores/store";
import type { AppState, SearchResultEntry } from "../../../stores/types";

type ProfileDraft = { displayName: string; handle: string; bio: string; status: string };

interface AvatarFeatureLike {
  setProfileAvatar: (file: File | null) => void;
  clearProfileAvatar: () => void;
}

export interface ProfileActionsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  markUserInput: () => void;
  buildSearchServerShareText: (state: AppState, items: SearchResultEntry[]) => string;
  tryAppendShareTextToSelected: (text: string) => boolean;
  copyText: (text: string) => boolean | Promise<boolean>;
  getAvatarFeature: () => AvatarFeatureLike | null;
  profileAutosaveDelayMs?: number;
}

export interface ProfileActionsFeature {
  onProfileDraftChange: (draft: ProfileDraft) => void;
  onSearchServerForward: (items: SearchResultEntry[]) => void;
  onProfileSave: (draft: ProfileDraft) => void;
  onProfileRefresh: () => void;
  onProfileCopyId: () => void;
  onProfileShareId: () => void;
  onSessionsRefresh: () => void;
  onSessionsLogoutOthers: () => void;
  onProfileAvatarSelect: (file: File | null) => void;
  onProfileAvatarClear: () => void;
}

const PROFILE_AUTOSAVE_DELAY_MS = 650;

function normalizeProfileDraft(draft: ProfileDraft) {
  const display_name = draft.displayName.trim();
  const handle = draft.handle.trim();
  const bio = draft.bio.trim();
  const status = draft.status.trim();
  return {
    display_name: display_name || null,
    handle: handle || null,
    bio: bio || null,
    status: status || null,
  };
}

function profilePayloadSignature(payload: ReturnType<typeof normalizeProfileDraft>): string {
  return JSON.stringify([payload.display_name, payload.handle, payload.bio, payload.status]);
}

export function createProfileActionsFeature(deps: ProfileActionsFeatureDeps): ProfileActionsFeature {
  const { store, send, markUserInput, buildSearchServerShareText, tryAppendShareTextToSelected, copyText, getAvatarFeature } = deps;
  const autosaveDelayMs = Math.max(0, Math.trunc(Number(deps.profileAutosaveDelayMs ?? PROFILE_AUTOSAVE_DELAY_MS) || 0));
  let profileAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledProfileSignature = "";
  let lastSentProfileSignature = "";

  const currentProfileSignature = (): string => {
    const st = store.get();
    const selfId = String(st.selfId || "").trim();
    const me = selfId ? st.profiles?.[selfId] : null;
    if (!me) return "";
    return profilePayloadSignature(
      normalizeProfileDraft({
        displayName: String(me.display_name ?? ""),
        handle: String(me.handle ?? ""),
        bio: String(me.bio ?? ""),
        status: String(me.status ?? ""),
      })
    );
  };

  const sendProfileDraft = (draft: ProfileDraft, source: "manual" | "auto"): boolean => {
    const payload = normalizeProfileDraft(draft);
    const signature = profilePayloadSignature(payload);
    if (source === "auto" && (signature === lastSentProfileSignature || signature === currentProfileSignature())) {
      return false;
    }
    lastSentProfileSignature = signature;
    send({ type: "profile_set", ...payload });
    store.set({ status: source === "auto" ? "Профиль сохраняется автоматически…" : "Сохранение профиля…" });
    return true;
  };

  const scheduleProfileAutosave = (draft: ProfileDraft) => {
    const payload = normalizeProfileDraft(draft);
    const signature = profilePayloadSignature(payload);
    if (signature === lastSentProfileSignature || signature === currentProfileSignature()) {
      if (profileAutosaveTimer) {
        clearTimeout(profileAutosaveTimer);
        profileAutosaveTimer = null;
      }
      scheduledProfileSignature = "";
      return;
    }
    scheduledProfileSignature = signature;
    if (profileAutosaveTimer) clearTimeout(profileAutosaveTimer);
    profileAutosaveTimer = setTimeout(() => {
      profileAutosaveTimer = null;
      const scheduled = scheduledProfileSignature;
      scheduledProfileSignature = "";
      if (!scheduled || scheduled !== profilePayloadSignature(normalizeProfileDraft(draft))) return;
      sendProfileDraft(draft, "auto");
    }, autosaveDelayMs);
  };

  const onProfileDraftChange = (draft: ProfileDraft) => {
    markUserInput();
    store.set({
      profileDraftDisplayName: draft.displayName,
      profileDraftHandle: draft.handle,
      profileDraftBio: draft.bio,
      profileDraftStatus: draft.status,
    });
    scheduleProfileAutosave(draft);
  };

  const onSearchServerForward = (items: SearchResultEntry[]) => {
    const st = store.get();
    const list = Array.isArray(items) ? items : [];
    const text = buildSearchServerShareText(st, list);
    if (!text) return;
    if (tryAppendShareTextToSelected(text)) return;
    copyText(text);
  };

  const onProfileSave = (draft: ProfileDraft) => {
    if (profileAutosaveTimer) {
      clearTimeout(profileAutosaveTimer);
      profileAutosaveTimer = null;
    }
    scheduledProfileSignature = "";
    sendProfileDraft(draft, "manual");
  };

  const onProfileRefresh = () => {
    send({ type: "profile_get" });
  };

  const currentSelfId = (): string => String(store.get().selfId || store.get().authRememberedId || "").trim();

  const onProfileCopyId = () => {
    const id = currentSelfId();
    if (!id) {
      store.set({ status: "ID станет доступен после входа" });
      return;
    }
    void Promise.resolve(copyText(id)).then((ok) => {
      store.set({ status: ok ? "ID скопирован" : "Не удалось скопировать ID" });
    });
  };

  const onProfileShareId = () => {
    const id = currentSelfId();
    if (!id) {
      store.set({ status: "ID станет доступен после входа" });
      return;
    }
    const text = `Мой ID в Ягодке: ${id}`;
    void (async () => {
      try {
        if (typeof navigator.share === "function") {
          await navigator.share({ title: "Мой ID в Ягодке", text });
          store.set({ status: "ID отправлен" });
          return;
        }
      } catch {
        // fallback to clipboard below
      }
      const ok = await Promise.resolve(copyText(id));
      store.set({ status: ok ? "ID скопирован для отправки" : "Не удалось подготовить ID" });
    })();
  };

  const onSessionsRefresh = () => {
    const st = store.get();
    if (st.conn !== "connected" || !st.authed) return;
    send({ type: "sessions_list" });
    store.set({
      sessionDevicesStatus: "Обновляем список активных сессий…",
      status: "Обновляем список активных сессий…",
    });
  };

  const onSessionsLogoutOthers = () => {
    const st = store.get();
    if (st.conn !== "connected" || !st.authed) return;
    send({ type: "sessions_logout_others" });
    store.set({
      sessionDevicesStatus: "Отключаем другие устройства…",
      status: "Отключаем другие устройства…",
    });
  };

  const onProfileAvatarSelect = (file: File | null) => {
    getAvatarFeature()?.setProfileAvatar(file);
  };

  const onProfileAvatarClear = () => {
    getAvatarFeature()?.clearProfileAvatar();
  };

  return {
    onProfileDraftChange,
    onSearchServerForward,
    onProfileSave,
    onProfileRefresh,
    onProfileCopyId,
    onProfileShareId,
    onSessionsRefresh,
    onSessionsLogoutOthers,
    onProfileAvatarSelect,
    onProfileAvatarClear,
  };
}
