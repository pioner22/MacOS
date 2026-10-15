import { dmKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

export interface AuthRequestsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface AuthRequestsFeature {
  requestAuth: (peer: string) => void;
  acceptAuth: (peer: string) => void;
  declineAuth: (peer: string) => void;
  cancelAuth: (peer: string) => void;
}

function replaceActionMessage(
  prev: AppState,
  peer: string,
  localId: string,
  text: string
): { hasUpdate: boolean; conversations: AppState["conversations"] } {
  const key = dmKey(peer);
  const conv = prev.conversations[key] || [];
  const idx = conv.findIndex((msg) => String(msg.localId || "") === localId);
  if (idx < 0) {
    return { hasUpdate: false, conversations: prev.conversations };
  }
  const nextConv: ChatMessage[] = [
    ...conv.slice(0, idx),
    { ...conv[idx], text, attachment: null },
    ...conv.slice(idx + 1),
  ];
  return {
    hasUpdate: true,
    conversations: { ...prev.conversations, [key]: nextConv },
  };
}

export function createAuthRequestsFeature(deps: AuthRequestsFeatureDeps): AuthRequestsFeature {
  const { store, send } = deps;

  const requestAuth = (peer: string) => {
    const id = String(peer || "").trim();
    if (!id) return;
    if (!store.get().authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const st = store.get();
    if (st.friends.some((friend) => friend.id === id)) {
      store.set({ status: `Уже в контактах: ${id}` });
      return;
    }
    if (st.pendingOut.includes(id)) {
      store.set({ status: `Запрос уже отправлен: ${id}` });
      return;
    }
    if (st.pendingIn.includes(id)) {
      store.set({ status: `Есть входящий запрос: ${id}` });
      return;
    }
    send({ type: "authz_request", to: id });
    store.set({ status: `Запрос отправляется: ${id}` });
  };

  const acceptAuth = (peer: string) => {
    send({ type: "authz_response", peer, accept: true });
    store.set((prev) => {
      const localId = `action:auth_in:${peer}`;
      const patched = replaceActionMessage(prev, peer, localId, `Запрос принят: ${peer}`);
      return {
        ...prev,
        pendingIn: prev.pendingIn.filter((id) => id !== peer),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Принят запрос: ${peer}`,
      };
    });
  };

  const declineAuth = (peer: string) => {
    send({ type: "authz_response", peer, accept: false });
    store.set((prev) => {
      const localId = `action:auth_in:${peer}`;
      const patched = replaceActionMessage(prev, peer, localId, `Запрос отклонён: ${peer}`);
      return {
        ...prev,
        pendingIn: prev.pendingIn.filter((id) => id !== peer),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Отклонён запрос: ${peer}`,
      };
    });
  };

  const cancelAuth = (peer: string) => {
    send({ type: "authz_cancel", peer });
    store.set((prev) => {
      const localId = `action:auth_out:${peer}`;
      const patched = replaceActionMessage(prev, peer, localId, `Запрос отменён: ${peer}`);
      return {
        ...prev,
        pendingOut: prev.pendingOut.filter((id) => id !== peer),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Отменён запрос: ${peer}`,
      };
    });
  };

  return {
    requestAuth,
    acceptAuth,
    declineAuth,
    cancelAuth,
  };
}
