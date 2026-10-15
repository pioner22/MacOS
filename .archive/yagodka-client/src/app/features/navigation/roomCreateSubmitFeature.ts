import type { MembersChipsFeature } from "../members/membersChipsFeature";
import { normalizeHandle } from "../members/membersInputShared";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface RoomCreateSubmitFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  roomInfoMax: number;
  getMembersChipsFeature: () => MembersChipsFeature | null;
}

export interface RoomCreateSubmitFeature {
  createGroup: () => void;
  createBoard: () => void;
}

function normalizeRoomText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function createRoomCreateSubmitFeature(deps: RoomCreateSubmitFeatureDeps): RoomCreateSubmitFeature {
  const { store, send, roomInfoMax, getMembersChipsFeature } = deps;

  const createGroup = () => {
    if (!store.get().authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения", groupCreateMessage: "Нет соединения" });
      return;
    }
    const name = (document.getElementById("group-name") as HTMLInputElement | null)?.value?.trim() ?? "";
    const description = normalizeRoomText(
      (document.getElementById("group-description") as HTMLTextAreaElement | null)?.value ?? ""
    );
    const rules = normalizeRoomText((document.getElementById("group-rules") as HTMLTextAreaElement | null)?.value ?? "");
    if (!name) {
      store.set({ groupCreateMessage: "Введите название чата" });
      return;
    }
    if (description.length > roomInfoMax) {
      store.set({ groupCreateMessage: "Описание слишком длинное" });
      return;
    }
    if (rules.length > roomInfoMax) {
      store.set({ groupCreateMessage: "Правила слишком длинные" });
      return;
    }
    const chips = getMembersChipsFeature();
    if (!chips) return;
    chips.consumeCreateMembersEntry("group_create", true);
    const tokens = chips.getCreateMembersTokens("group_create");
    if (tokens.length) {
      const res = chips.resolveCreateMembersTokensForSubmit("group_create", tokens);
      if (!res.ok) {
        if (res.reason === "pending") {
          store.set({ groupCreateMessage: "Проверяем участников… подождите" });
          chips.drainCreateMembersLookups("group_create");
          return;
        }
        if (res.reason === "invalid") {
          store.set({
            groupCreateMessage: `Исправьте участников: ${res.invalid.slice(0, 6).join(", ")}${res.invalid.length > 6 ? "…" : ""}`,
          });
          return;
        }
        store.set({
          groupCreateMessage: `Не удалось найти: ${res.missing.slice(0, 6).join(", ")}${res.missing.length > 6 ? "…" : ""}`,
        });
        return;
      }
      const payload: any = { type: "group_create", name, members: res.members };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      send(payload);
    } else {
      const payload: any = { type: "group_create", name };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      send(payload);
    }
    store.set({ status: "Создание чата…", groupCreateMessage: "" });
  };

  const createBoard = () => {
    if (!store.get().authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения", boardCreateMessage: "Нет соединения" });
      return;
    }
    const name = (document.getElementById("board-name") as HTMLInputElement | null)?.value?.trim() ?? "";
    const handleRaw = (document.getElementById("board-handle") as HTMLInputElement | null)?.value ?? "";
    const description = normalizeRoomText(
      (document.getElementById("board-description") as HTMLTextAreaElement | null)?.value ?? ""
    );
    const rules = normalizeRoomText((document.getElementById("board-rules") as HTMLTextAreaElement | null)?.value ?? "");
    if (!name) {
      store.set({ boardCreateMessage: "Введите название доски" });
      return;
    }
    if (description.length > roomInfoMax) {
      store.set({ boardCreateMessage: "Описание слишком длинное" });
      return;
    }
    if (rules.length > roomInfoMax) {
      store.set({ boardCreateMessage: "Правила слишком длинные" });
      return;
    }
    const handle = handleRaw ? normalizeHandle(handleRaw) : null;
    if (handleRaw && !handle) {
      store.set({ boardCreateMessage: "Некорректный хэндл (пример: @news)" });
      return;
    }
    const chips = getMembersChipsFeature();
    if (!chips) return;
    chips.consumeCreateMembersEntry("board_create", true);
    const tokens = chips.getCreateMembersTokens("board_create");
    if (tokens.length) {
      const res = chips.resolveCreateMembersTokensForSubmit("board_create", tokens);
      if (!res.ok) {
        if (res.reason === "pending") {
          store.set({ boardCreateMessage: "Проверяем участников… подождите" });
          chips.drainCreateMembersLookups("board_create");
          return;
        }
        if (res.reason === "invalid") {
          store.set({
            boardCreateMessage: `Исправьте участников: ${res.invalid.slice(0, 6).join(", ")}${res.invalid.length > 6 ? "…" : ""}`,
          });
          return;
        }
        store.set({
          boardCreateMessage: `Не удалось найти: ${res.missing.slice(0, 6).join(", ")}${res.missing.length > 6 ? "…" : ""}`,
        });
        return;
      }
      const payload: any = { type: "board_create", name, handle: handle || undefined, members: res.members };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      send(payload);
    } else {
      const payload: any = { type: "board_create", name, handle: handle || undefined };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      send(payload);
    }
    store.set({ status: "Создание доски…", boardCreateMessage: "" });
  };

  return {
    createGroup,
    createBoard,
  };
}
