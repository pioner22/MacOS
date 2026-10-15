import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface NotifyActionsFeatureDeps {
  store: Store<AppState>;
  enablePush: () => Promise<void> | void;
  disablePush: () => Promise<void> | void;
  setNotifyInAppEnabled: (value: boolean) => void;
  setNotifySoundEnabled: (value: boolean) => void;
  syncNotifyPrefsToServiceWorker: () => void;
  forcePwaUpdate: () => Promise<void> | void;
}

export interface NotifyActionsFeature {
  onPushEnable: () => void;
  onPushDisable: () => void;
  onNotifyInAppEnable: () => void;
  onNotifyInAppDisable: () => void;
  onNotifySoundEnable: () => void;
  onNotifySoundDisable: () => void;
  onForcePwaUpdate: () => void;
}

export function createNotifyActionsFeature(deps: NotifyActionsFeatureDeps): NotifyActionsFeature {
  const { store, enablePush, disablePush, setNotifyInAppEnabled, setNotifySoundEnabled, syncNotifyPrefsToServiceWorker, forcePwaUpdate } = deps;

  const onPushEnable = () => {
    void enablePush();
  };

  const onPushDisable = () => {
    void disablePush();
  };

  const onNotifyInAppEnable = () => {
    setNotifyInAppEnabled(true);
    store.set({ notifyInAppEnabled: true, status: "Уведомления в приложении: включены" });
  };

  const onNotifyInAppDisable = () => {
    setNotifyInAppEnabled(false);
    store.set({ notifyInAppEnabled: false, status: "Уведомления в приложении: выключены" });
  };

  const onNotifySoundEnable = () => {
    setNotifySoundEnabled(true);
    store.set({ notifySoundEnabled: true, status: "Звук уведомлений: включен" });
    syncNotifyPrefsToServiceWorker();
  };

  const onNotifySoundDisable = () => {
    setNotifySoundEnabled(false);
    store.set({ notifySoundEnabled: false, status: "Звук уведомлений: выключен" });
    syncNotifyPrefsToServiceWorker();
  };

  const onForcePwaUpdate = () => {
    void forcePwaUpdate();
  };

  return {
    onPushEnable,
    onPushDisable,
    onNotifyInAppEnable,
    onNotifyInAppDisable,
    onNotifySoundEnable,
    onNotifySoundDisable,
    onForcePwaUpdate,
  };
}
