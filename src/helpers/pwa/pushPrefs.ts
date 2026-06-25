const PUSH_OPTOUT_KEY = "yagodka_pwa_push_opt_out";

export function getPushOptOut(): boolean {
  try {
    return localStorage.getItem(PUSH_OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPushOptOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(PUSH_OPTOUT_KEY, "1");
    else localStorage.removeItem(PUSH_OPTOUT_KEY);
  } catch {
    // ignore
  }
}
