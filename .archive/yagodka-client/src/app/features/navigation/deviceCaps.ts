import { isMobileLikeUi } from "../../../helpers/ui/mobileLike";
import { isIOS } from "../../../helpers/ui/iosInputAssistant";

export interface DeviceCaps {
  constrained: boolean;
  saveData: boolean;
  slowNetwork: boolean;
  prefetchAllowed: boolean;
  fileGetMax: number;
  fileGetPrefetch: number;
  fileGetTimeoutMs: number;
  historyPrefetchLimit: number;
  historyWarmupLimit: number;
  historyWarmupConcurrency: number;
  historyWarmupQueueMax: number;
  historyWarmupDelayMs: number;
  historyRequestTimeoutMs: number;
}

export function createDeviceCaps(): DeviceCaps {
  const clamp = (min: number, value: number, max: number) => Math.max(min, Math.min(max, value));
  const cores = (() => {
    try {
      const raw = Number((navigator as any)?.hardwareConcurrency ?? 0);
      return Number.isFinite(raw) && raw > 0 ? Math.min(12, Math.max(2, raw)) : 4;
    } catch {
      return 4;
    }
  })();
  const memoryGb = (() => {
    try {
      const raw = Number((navigator as any)?.deviceMemory ?? 0);
      return Number.isFinite(raw) && raw > 0 ? raw : 4;
    } catch {
      return 4;
    }
  })();
  const connection = (() => {
    try {
      return (navigator as any)?.connection ?? null;
    } catch {
      return null;
    }
  })();
  const saveData = Boolean(connection && (connection as any).saveData);
  const effectiveType = String((connection as any)?.effectiveType || "").toLowerCase();
  const slowNetwork = saveData || effectiveType.includes("2g") || effectiveType.includes("3g");
  const ios = isIOS();
  const mobileLike = isMobileLikeUi();
  const constrained = mobileLike || memoryGb <= 4 || slowNetwork;
  const fileGetMax = constrained ? (slowNetwork ? 5 : 7) : 10;
  const fileGetPrefetch = clamp(slowNetwork ? 3 : 5, Math.round(fileGetMax * 0.7), slowNetwork ? 4 : 7);
  const historyWarmupConcurrency = ios
    ? 1
    : clamp(slowNetwork ? 3 : 5, Math.round(cores * (constrained ? 0.6 : 0.75)), slowNetwork ? 5 : 7);
  return {
    constrained,
    saveData,
    slowNetwork,
    prefetchAllowed: !saveData && !ios,
    fileGetMax,
    fileGetPrefetch,
    fileGetTimeoutMs: slowNetwork ? 45_000 : constrained ? 35_000 : 25_000,
    historyPrefetchLimit: ios ? 80 : slowNetwork ? 180 : constrained ? 240 : 320,
    historyWarmupLimit: ios ? 80 : slowNetwork ? 220 : constrained ? 280 : 360,
    historyWarmupConcurrency,
    historyWarmupQueueMax: ios ? 8 : slowNetwork ? 40 : constrained ? 60 : 80,
    historyWarmupDelayMs: ios ? 700 : slowNetwork ? 160 : constrained ? 110 : 70,
    historyRequestTimeoutMs: slowNetwork ? 18_000 : constrained ? 14_000 : 12_000,
  };
}
