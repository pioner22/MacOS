import { getPageViewTarget } from "../../../helpers/navigation/viewState";
import type { Store } from "../../../stores/store";
import type { AppState, PageKind } from "../../../stores/types";

export interface PageSetDispatchFeatureDeps {
  store: Store<AppState>;
  setPage: (page: PageKind) => void;
  send: (payload: any) => void;
}

export interface PageSetDispatchFeature {
  handleSetPage: (page: PageKind) => void;
}

export function createPageSetDispatchFeature(deps: PageSetDispatchFeatureDeps): PageSetDispatchFeature {
  const { store, setPage, send } = deps;

  const handleSetPage = (page: PageKind) => {
    setPage(page);
    const st = store.get();
    if (page === "profile" && st.authed && st.conn === "connected") {
      send({ type: "profile_get" });
      return;
    }
    if (page === "sessions" && st.authed && st.conn === "connected") {
      send({ type: "sessions_list" });
      return;
    }
    const pageTarget = getPageViewTarget(st);
    if (page === "group" && st.authed && st.conn === "connected" && pageTarget?.kind === "group") {
      send({ type: "group_info", group_id: pageTarget.id });
      return;
    }
    if (page === "board" && st.authed && st.conn === "connected" && pageTarget?.kind === "board") {
      send({ type: "board_info", board_id: pageTarget.id });
    }
  };

  return { handleSetPage };
}
