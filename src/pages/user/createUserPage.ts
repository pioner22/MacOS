import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { AppState } from "../../stores/types";

export interface UserPageActions {
  onBack: () => void;
  onOpenChat: (id: string) => void;
}

export interface UserPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

export function createUserPage(actions: UserPageActions): UserPage {
  const mobileUi = isMobileLikeUi();
  const title = el("div", { class: "chat-title" }, ["Контакт"]);

  const profileName = el("div", { class: "profile-name" }, ["—"]);
  const profileHandle = el("div", { class: "profile-handle" }, ["—"]);
  const profileId = el("div", { class: "profile-id" }, [""]);

  const avatarView = el("div", { class: "avatar avatar-xl profile-avatar-btn", role: "img", "aria-label": "Аватар контакта" });
  const headTop = el("div", { class: "profile-head-top" }, [avatarView, el("div", { class: "profile-head-main" }, [profileName, profileHandle, profileId])]);
  const head = el("div", { class: "profile-card profile-head" }, [headTop]);

  const statusValue = el("div", { class: "profile-field-value" }, ["—"]);
  const bioValue = el("div", { class: "profile-field-value profile-bio-text" }, ["—"]);
  const about = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["О пользователе"]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Статус"]), statusValue]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["О себе"]), bioValue]),
  ]);

  const btnChat = el("button", { class: "btn btn-primary", type: "button" }, ["Сообщение"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnChat]);

  const hint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["Esc — назад"]);

  const root = el("div", { class: "page page-profile page-user" }, [title, head, actionsRow, about, ...(hint ? [hint] : [])]);

  btnChat.addEventListener("click", () => {
    const id = String(root.getAttribute("data-user-id") || "").trim();
    if (!id) return;
    actions.onOpenChat(id);
  });

  function update(state: AppState) {
    const id = String(state.userViewId || "").trim();
    root.setAttribute("data-user-id", id);

    const prof = id ? state.profiles[id] : null;
    profileName.textContent = prof?.display_name ? String(prof.display_name) : id || "—";
    const h = prof?.handle ? String(prof.handle).trim() : "";
    profileHandle.textContent = h ? (h.startsWith("@") ? h : `@${h}`) : "Логин не задан";
    profileId.textContent = id ? `ID: ${id}` : "";

    statusValue.textContent = prof?.status ? String(prof.status) : "—";
    bioValue.textContent = prof?.bio ? String(prof.bio) : "—";

    const url = id ? getStoredAvatar("dm", id) : null;
    avatarView.style.setProperty("--avatar-h", String(avatarHue(`dm:${id || "anon"}`)));
    avatarView.classList.toggle("avatar-img", Boolean(url));
    avatarView.textContent = url ? "" : avatarMonogram("dm", id);
    (avatarView as HTMLElement).style.backgroundImage = url ? `url(${url})` : "";

    (btnChat as HTMLButtonElement).disabled = !id;
  }

  return {
    root,
    update,
    focus: () => {
      if (mobileUi) return;
      btnChat.focus();
    },
  };
}
