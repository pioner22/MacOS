import type { RenderActions } from "../../renderApp";

type AuthUiActions = Pick<
  RenderActions,
  | "onAuthOpen"
  | "onAuthLogout"
  | "onAuthLogin"
  | "onAuthRegister"
  | "onAuthTouchId"
  | "onAuthModeChange"
  | "onAuthUseDifferentAccount"
  | "onCloseModal"
  | "onDismissUpdate"
  | "onReloadUpdate"
  | "onApplyPwaUpdate"
  | "onDeferPwaUpdate"
  | "onSkinChange"
  | "onThemeChange"
>;

type ProfileActions = Pick<
  RenderActions,
  | "onProfileDraftChange"
  | "onSearchServerForward"
  | "onProfileSave"
  | "onProfileRefresh"
  | "onProfileCopyId"
  | "onProfileShareId"
  | "onSessionsRefresh"
  | "onSessionsLogoutOthers"
  | "onProfileAvatarSelect"
  | "onProfileAvatarClear"
>;

type NotifyActions = Pick<
  RenderActions,
  | "onPushEnable"
  | "onPushDisable"
  | "onNotifyInAppEnable"
  | "onNotifyInAppDisable"
  | "onNotifySoundEnable"
  | "onNotifySoundDisable"
  | "onForcePwaUpdate"
>;

export type ActionsAccountFeature = AuthUiActions & ProfileActions & NotifyActions;

export interface ActionsAccountFeatureDeps {
  authUiActions: AuthUiActions;
  profileActions: ProfileActions;
  notifyActions: NotifyActions;
}

export function createActionsAccountFeature(deps: ActionsAccountFeatureDeps): ActionsAccountFeature {
  const { authUiActions, profileActions, notifyActions } = deps;
  return {
    ...authUiActions,
    ...profileActions,
    ...notifyActions,
  };
}
