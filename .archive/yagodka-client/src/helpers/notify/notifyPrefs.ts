const NOTIFY_INAPP_KEY = "yagodka_notify_inapp";
const NOTIFY_SOUND_KEY = "yagodka_notify_sound";

export function getNotifyInAppEnabled(): boolean {
  try {
    // Default: enabled. Store only the opt-out.
    return localStorage.getItem(NOTIFY_INAPP_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setNotifyInAppEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(NOTIFY_INAPP_KEY);
    else localStorage.setItem(NOTIFY_INAPP_KEY, "0");
  } catch {
    // ignore
  }
}

export function getNotifySoundEnabled(): boolean {
  try {
    // Default: enabled. Store only the opt-out.
    return localStorage.getItem(NOTIFY_SOUND_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setNotifySoundEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(NOTIFY_SOUND_KEY);
    else localStorage.setItem(NOTIFY_SOUND_KEY, "0");
  } catch {
    // ignore
  }
}

