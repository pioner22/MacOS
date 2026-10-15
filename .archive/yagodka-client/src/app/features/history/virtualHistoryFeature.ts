import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { conversationKey } from "../../../helpers/chat/conversationKey";
import { resolveVirtualStartForIndex, resolveVirtualStartForScroll } from "../../../helpers/chat/historyViewportCoordinator";
import { getChatHistoryViewportRuntime } from "../../../helpers/chat/historyViewportRuntime";
import { isChatStickyBottomActive } from "../../../helpers/chat/stickyBottom";
import {
  HISTORY_VIRTUAL_OVERSCAN,
  HISTORY_VIRTUAL_THRESHOLD,
  HISTORY_VIRTUAL_WINDOW,
  clampVirtualAvg,
  getVirtualMaxStart,
  getVirtualStart,
  shouldVirtualize,
} from "../../../helpers/chat/virtualHistory";

type DeviceCapsLike = {
  constrained: boolean;
  slowNetwork: boolean;
};

export interface VirtualHistoryFeatureDeps {
  store: Store<AppState>;
  chatHost: HTMLElement;
  deviceCaps: DeviceCapsLike;
}

export interface VirtualHistoryFeature {
  maybeUpdateVirtualWindow: (scrollTop: number) => void;
  ensureIndexVisible: (key: string, msgsLength: number, idx: number, searchActive: boolean) => void;
  maybeClampStartAtTop: (st: AppState) => boolean;
}

export function createVirtualHistoryFeature(deps: VirtualHistoryFeatureDeps): VirtualHistoryFeature {
  const { store, chatHost, deviceCaps } = deps;

  const historyVirtualThreshold = deviceCaps.slowNetwork ? 200 : deviceCaps.constrained ? 240 : HISTORY_VIRTUAL_THRESHOLD;
  const historyVirtualWindow = deviceCaps.slowNetwork ? 160 : deviceCaps.constrained ? 200 : HISTORY_VIRTUAL_WINDOW;
  const historyVirtualOverscan = deviceCaps.slowNetwork ? 45 : deviceCaps.constrained ? 60 : HISTORY_VIRTUAL_OVERSCAN;

  let lastVirtualWindowUpdateAt = 0;

  const maybeUpdateVirtualWindow: VirtualHistoryFeature["maybeUpdateVirtualWindow"] = (scrollTop) => {
    const st = store.get();
    if (st.page !== "main") return;
    if (!st.selected) return;
    if (st.chatSearchOpen && st.chatSearchQuery.trim()) return;
    const key = conversationKey(st.selected);
    if (!key) return;
    const msgs = st.conversations[key] || [];
    if (!shouldVirtualize(msgs.length, false, historyVirtualThreshold)) return;

    const runtime = getChatHistoryViewportRuntime(chatHost);
    const avgMap = runtime.virtualAvgHeights;
    const stick = runtime.stickyBottom;
    const { currentStart, targetStart } = resolveVirtualStartForScroll({
      msgsLength: msgs.length,
      currentStart: st.historyVirtualStart?.[key],
      scrollTop,
      avgHint: clampVirtualAvg(avgMap?.get(key)),
      overscan: historyVirtualOverscan,
      windowSize: historyVirtualWindow,
      stickToBottom: isChatStickyBottomActive(chatHost, stick, key),
    });
    const delta = Math.abs(targetStart - currentStart);
    if (delta < Math.max(8, Math.floor(historyVirtualOverscan / 2))) return;
    const now = Date.now();
    if (now - lastVirtualWindowUpdateAt < 120) return;
    lastVirtualWindowUpdateAt = now;
    store.set((prev) => ({
      ...prev,
      historyVirtualStart: { ...prev.historyVirtualStart, [key]: targetStart },
    }));
  };

  const ensureIndexVisible: VirtualHistoryFeature["ensureIndexVisible"] = (key, msgsLength, idx, searchActive) => {
    if (!key) return;
    const msgIdx = Number(idx);
    if (!Number.isFinite(msgIdx) || msgIdx < 0) return;
    if (!shouldVirtualize(msgsLength, searchActive, historyVirtualThreshold)) return;
    const targetStart = resolveVirtualStartForIndex(msgsLength, msgIdx, historyVirtualWindow);
    store.set((prev) => ({
      ...prev,
      historyVirtualStart: { ...prev.historyVirtualStart, [key]: targetStart },
    }));
  };

  const maybeClampStartAtTop: VirtualHistoryFeature["maybeClampStartAtTop"] = (st) => {
    const clampKey = st.selected ? conversationKey(st.selected) : "";
    if (
      clampKey &&
      st.page === "main" &&
      (!st.modal || st.modal.kind === "context_menu") &&
      st.historyLoaded?.[clampKey] &&
      st.historyHasMore?.[clampKey] === false
    ) {
      const currentStart = st.historyVirtualStart?.[clampKey];
      if (chatHost.scrollTop <= 2 && currentStart !== 0) {
        store.set((prev) => ({
          ...prev,
          historyVirtualStart: { ...prev.historyVirtualStart, [clampKey]: 0 },
        }));
        return true;
      }
    }
    return false;
  };

  return { maybeUpdateVirtualWindow, ensureIndexVisible, maybeClampStartAtTop };
}
