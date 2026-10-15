import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

export interface RoomInfoSubmitFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  roomInfoMax: number;
}

export interface RoomInfoSubmitFeature {
  saveRoomInfo: (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => void;
}

export function createRoomInfoSubmitFeature(deps: RoomInfoSubmitFeatureDeps): RoomInfoSubmitFeature {
  const { store, send, roomInfoMax } = deps;

  const saveRoomInfo = (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => {
    const st = store.get();
    const rid = String(roomId || "").trim();
    if (!rid) return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const entry = kind === "group" ? st.groups.find((g) => g.id === rid) : st.boards.find((b) => b.id === rid);
    const ownerId = String(entry?.owner_id || "").trim();
    if (!ownerId || ownerId !== String(st.selfId || "").trim()) {
      store.set({ status: "Только владелец может менять описание" });
      return;
    }
    if (description.length > roomInfoMax) {
      store.set({ status: "Описание слишком длинное" });
      return;
    }
    if (rules.length > roomInfoMax) {
      store.set({ status: "Правила слишком длинные" });
      return;
    }
    if (kind === "group") {
      send({ type: "group_set_info", group_id: rid, description: description || null, rules: rules || null });
      store.set({ status: "Сохраняем информацию чата…" });
      return;
    }
    send({ type: "board_set_info", board_id: rid, description: description || null, rules: rules || null });
    store.set({ status: "Сохраняем информацию доски…" });
  };

  return {
    saveRoomInfo,
  };
}
