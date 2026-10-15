import type { AppState } from "../../../stores/types";
import type { ComposerSendMenuFeature, SendMenuDraft } from "./composerSendMenuFeature";

export interface ComposerSendMenuActionsFeatureDeps {
  composerSendMenuFeature: ComposerSendMenuFeature;
}

export interface ComposerSendMenuActionsFeature {
  buildSendMenuDraftFromComposer: (st: AppState) => SendMenuDraft | null;
  openSendMenu: (x: number, y: number) => void;
  openSendScheduleModalWithDraft: (draft: SendMenuDraft) => void;
  openSendScheduleModal: () => void;
}

export function createComposerSendMenuActionsFeature(deps: ComposerSendMenuActionsFeatureDeps): ComposerSendMenuActionsFeature {
  const { composerSendMenuFeature } = deps;

  const buildSendMenuDraftFromComposer = (st: AppState): SendMenuDraft | null => composerSendMenuFeature.buildSendMenuDraftFromComposer(st);

  const openSendMenu = (x: number, y: number) => {
    composerSendMenuFeature.openSendMenu(x, y);
  };

  const openSendScheduleModalWithDraft = (draft: SendMenuDraft) => {
    composerSendMenuFeature.openSendScheduleModalWithDraft(draft);
  };

  const openSendScheduleModal = () => {
    composerSendMenuFeature.openSendScheduleModal();
  };

  return {
    buildSendMenuDraftFromComposer,
    openSendMenu,
    openSendScheduleModalWithDraft,
    openSendScheduleModal,
  };
}
