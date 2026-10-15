import type { Layout } from "../../../components/layout/types";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { recoverFromLazyImportError } from "../../bootstrap/lazyImportRecovery";

export interface ChatHostDeferredDeps {
  store: Store<AppState>;
  layout: Pick<Layout, "chat" | "chatHost" | "inputWrap" | "chatSearchFooter">;
  getMaxScrollTop: (host: HTMLElement) => number;
  scheduleChatJumpVisibility: () => void;
  maybeRecordLastRead: (key: string) => void;
  scheduleAutoFetchVisiblePreviews: () => void;
  ensureVideoMutedDefault: (video: HTMLVideoElement) => void;
  scheduleViewportReadUpdate: () => void;
  markUserChatScroll: () => void;
}

type ChatHostDeferredModule = typeof import("./chatHostDeferredEvents");

export function createLazyChatHostDeferredRuntime(deps: ChatHostDeferredDeps) {
  let started = false;

  const startDeferredBoot = () => {
    if (started) return;
    started = true;
    void import("./chatHostDeferredEvents")
      .then((mod: ChatHostDeferredModule) => {
        mod.installChatHostDeferredEvents(deps);
      })
      .catch((err) => {
        recoverFromLazyImportError(err, "chat_host_deferred");
        started = false;
      });
  };

  return {
    startDeferredBoot,
  };
}
