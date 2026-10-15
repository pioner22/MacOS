import type { MembersChipsFeature } from "../members/membersChipsFeature";
import { parseMembersInput } from "../members/membersInputShared";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface RoomMembersSubmitFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  getMembersChipsFeature: () => MembersChipsFeature | null;
}

export interface RoomMembersSubmitFeature {
  membersAddSubmit: () => void;
  membersRemoveSubmit: () => void;
  renameSubmit: () => void;
}

export function createRoomMembersSubmitFeature(deps: RoomMembersSubmitFeatureDeps): RoomMembersSubmitFeature {
  const { store, send, getMembersChipsFeature } = deps;

  const membersAddSubmit = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const chips = getMembersChipsFeature();
    if (!chips) return;
    chips.consumeMembersAddEntry(true);
    const tokens = chips.getMembersAddTokens();
    if (!tokens.length) {
      store.set({ modal: { ...modal, message: "Введите хотя бы один ID или @handle" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const res = chips.resolveMembersAddTokensForSubmit(tokens);
    if (!res.ok) {
      if (res.reason === "pending") {
        store.set({ modal: { ...modal, message: "Проверяем участников… подождите" } });
        chips.drainMembersAddLookups();
        return;
      }
      if (res.reason === "invalid") {
        store.set({
          modal: { ...modal, message: `Исправьте участников: ${res.invalid.slice(0, 6).join(", ")}${res.invalid.length > 6 ? "…" : ""}` },
        });
        return;
      }
      store.set({
        modal: { ...modal, message: `Не удалось найти: ${res.missing.slice(0, 6).join(", ")}${res.missing.length > 6 ? "…" : ""}` },
      });
      return;
    }
    const members = res.members;
    if (modal.targetKind === "group") {
      send({ type: "group_add", group_id: modal.targetId, members });
      store.set({ modal: { ...modal, message: "Отправляем приглашения…" }, status: "Приглашения отправляются…" });
      return;
    }
    send({ type: "board_add", board_id: modal.targetId, members });
    store.set({ modal: { ...modal, message: "Добавляем участников…" }, status: "Добавление участников…" });
  };

  const membersRemoveSubmit = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_remove") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const raw = (document.getElementById("members-remove-input") as HTMLInputElement | null)?.value ?? "";
    const members = Array.from(new Set(parseMembersInput(raw))).filter((id) => id !== st.selfId);
    if (!members.length) {
      store.set({ modal: { ...modal, message: "Введите хотя бы один ID или @handle" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (modal.targetKind === "group") {
      send({ type: "group_remove", group_id: modal.targetId, members });
      store.set({ modal: { ...modal, message: "Удаляем участников…" }, status: "Удаление участников…" });
      return;
    }
    send({ type: "board_remove", board_id: modal.targetId, members });
    store.set({ modal: { ...modal, message: "Удаляем участников…" }, status: "Удаление участников…" });
  };

  const renameSubmit = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "rename") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const name = (document.getElementById("rename-name") as HTMLInputElement | null)?.value?.trim() ?? "";
    if (!name) {
      store.set({ modal: { ...modal, message: "Введите название" } });
      return;
    }
    if (name.length > 64) {
      store.set({ modal: { ...modal, message: "Название слишком длинное" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (modal.targetKind === "group") {
      send({ type: "group_rename", group_id: modal.targetId, name });
      store.set({ modal: { ...modal, message: "Сохраняем…" }, status: "Переименование…" });
      return;
    }
    send({ type: "board_rename", board_id: modal.targetId, name });
    store.set({ modal: { ...modal, message: "Сохраняем…" }, status: "Переименование…" });
  };

  return {
    membersAddSubmit,
    membersRemoveSubmit,
    renameSubmit,
  };
}
