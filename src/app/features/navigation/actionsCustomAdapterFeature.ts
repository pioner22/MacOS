import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

type SearchHistoryItem = { target: TargetRef; idx: number };

export interface ActionsCustomAdapterFeatureDeps {
  store: Store<AppState>;
  formatSearchHistoryShareText: (state: AppState, items: SearchHistoryItem[]) => string;
  tryAppendShareTextToSelected: (text: string) => boolean | Promise<boolean>;
  copyText: (text: string) => boolean | Promise<boolean>;
  handleContextMenuAction: (itemId: string) => Promise<void>;
}

export interface ActionsCustomAdapterFeature {
  onSearchHistoryForward: (items: SearchHistoryItem[]) => void;
  onContextMenuAction: (itemId: string) => void;
}

export function createActionsCustomAdapterFeature(
  deps: ActionsCustomAdapterFeatureDeps
): ActionsCustomAdapterFeature {
  const { store, formatSearchHistoryShareText, tryAppendShareTextToSelected, copyText, handleContextMenuAction } = deps;

  const onSearchHistoryForward = (items: SearchHistoryItem[]) => {
    const st = store.get();
    const list = Array.isArray(items) ? items : [];
    const text = formatSearchHistoryShareText(st, list);
    if (!text) return;
    void (async () => {
      if (await tryAppendShareTextToSelected(text)) return;
      await copyText(text);
    })();
  };

  const onContextMenuAction = (itemId: string) => {
    void handleContextMenuAction(itemId);
  };

  return {
    onSearchHistoryForward,
    onContextMenuAction,
  };
}
