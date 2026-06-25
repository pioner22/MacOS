import type { ToastState } from "../../stores/types";

export function defaultToastTimeoutMs(toast: ToastState): number {
  const actions = Array.isArray(toast.actions) ? toast.actions : [];
  return actions.length ? 6500 : 3500;
}

