import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuItem } from "../../../stores/types";
import { getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";
import type { ComposerHelperDraftResolution } from "./composerHelperDraftFeature";

export interface ComposerHelperMenuFeatureDeps {
  store: Store<AppState>;
  markUserActivity: () => void;
  resolveComposerHelperDraft: (st: AppState) => ComposerHelperDraftResolution;
}

export interface ComposerHelperMenuFeature {
  openComposerHelperMenu: (x: number, y: number) => void;
}

export function createComposerHelperMenuFeature(deps: ComposerHelperMenuFeatureDeps): ComposerHelperMenuFeature {
  const { store, markUserActivity, resolveComposerHelperDraft } = deps;

  const openComposerHelperMenu = (x: number, y: number) => {
    const st = store.get();
    if (st.modal) return;
    const helper = resolveComposerHelperDraft(st);
    if (!helper) return;
    markUserActivity();
    const items: ContextMenuItem[] =
      helper.kind === "reply"
        ? [
            { id: "composer_helper_show_message", label: "Показать сообщение", icon: "↥" },
            { id: "composer_helper_reply_another", label: "Ответить на другое", icon: "↩" },
            { id: "composer_helper_quote", label: "Цитировать", icon: "❝" },
            { id: "composer_helper_cancel", label: "Не отвечать", icon: "×", danger: true },
          ]
        : [{ id: "composer_helper_cancel", label: "Отменить", icon: "×", danger: true }];
    store.set({
      modal: {
        kind: "context_menu",
        payload: {
          x,
          y,
          title: helper.kind === "forward" ? "Переслано" : "Ответ",
          target: { kind: "composer_helper", id: getActiveConversationTarget(st)?.id || helper.key },
          items,
        },
      },
    });
  };

  return {
    openComposerHelperMenu,
  };
}
