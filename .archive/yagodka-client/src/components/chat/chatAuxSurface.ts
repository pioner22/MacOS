import { el } from "../../helpers/dom/el";
import { getActiveConversationTarget } from "../../helpers/navigation/mainConversationState";
import { formatTime } from "../../helpers/time";
import type { Layout } from "../layout/types";
import type { AppState, ChatMessage } from "../../stores/types";
import { renderChatPinnedSurface } from "./chatPinnedSurface";
import { resolveUserLabel, searchResultPreview, trimSearchPreview } from "./renderChatHelpers";

export interface RenderChatPinnedDeferredOptions {
  mount: HTMLElement;
  msgs: ChatMessage[];
  pinnedIds: number[] | null;
  activeRaw: number | null;
  pinnedHidden: boolean;
}

export interface RenderChatSearchDeferredOptions {
  layout: Pick<Layout, "chatSearchResults" | "chatSearchFooter">;
  state: AppState;
  msgs: ChatMessage[];
  hits: number[];
  activePos: number;
  searchResultsOpen: boolean;
  friendLabels: Map<string, string>;
}

export function renderPinnedSurface(opts: RenderChatPinnedDeferredOptions): void {
  const { mount, msgs, pinnedIds, activeRaw, pinnedHidden } = opts;
  if (pinnedHidden || !Array.isArray(pinnedIds) || !pinnedIds.length) {
    mount.replaceChildren();
    return;
  }
  const node = renderChatPinnedSurface({ msgs, pinnedIds, activeRaw });
  mount.replaceChildren(...(node ? [node] : []));
}

export function renderSearchDeferredSurface(opts: RenderChatSearchDeferredOptions): void {
  const { layout, state, msgs, hits, activePos, searchResultsOpen, friendLabels } = opts;
  const activeConversation = getActiveConversationTarget(state);

  let searchFooter: HTMLElement | null = null;
  if (activeConversation && state.chatSearchOpen) {
    const total = hits.length;
    const hasQuery = Boolean((state.chatSearchQuery || "").trim());
    const countLabel = total ? `${Math.min(activePos + 1, total)}/${total}` : hasQuery ? "0/0" : "";
    const count = el(
      "span",
      { class: `chat-search-count${hasQuery ? "" : " is-empty"}`, "aria-live": "polite" },
      [countLabel || ""]
    );
    const dateInput = el("input", {
      class: "modal-input chat-search-date",
      id: "chat-search-date",
      type: "date",
      "aria-label": "Перейти к дате",
    }) as HTMLInputElement;
    dateInput.value = state.chatSearchDate || "";
    const dateClear = el(
      "button",
      {
        class: "btn chat-search-date-clear",
        type: "button",
        title: "Сбросить дату",
        "data-action": "chat-search-date-clear",
        ...(dateInput.value ? {} : { disabled: "true" }),
      },
      ["×"]
    );
    const btnPrev = el(
      "button",
      {
        class: "btn chat-search-nav",
        type: "button",
        "data-action": "chat-search-prev",
        "aria-label": "Предыдущий результат",
        ...(total ? {} : { disabled: "true" }),
      },
      ["↑"]
    );
    const btnNext = el(
      "button",
      {
        class: "btn chat-search-nav",
        type: "button",
        "data-action": "chat-search-next",
        "aria-label": "Следующий результат",
        ...(total ? {} : { disabled: "true" }),
      },
      ["↓"]
    );
    const controls = el("div", { class: "chat-search-controls" }, [btnPrev, btnNext]);
    const footerClass = `chat-search-footer-row${searchResultsOpen ? " is-open" : ""}`;
    searchFooter = el(
      "div",
      { class: footerClass, "data-action": "chat-search-results-toggle", "aria-expanded": searchResultsOpen ? "true" : "false" },
      [count, dateInput, dateClear, controls]
    );
  }

  if (searchResultsOpen) {
    const maxResults = 200;
    const totalHits = hits.length;
    let windowStart = 0;
    let windowHits = hits;
    if (totalHits > maxResults) {
      const half = Math.floor(maxResults / 2);
      const clampStart = Math.max(0, Math.min(totalHits - maxResults, activePos - half));
      windowStart = clampStart;
      windowHits = hits.slice(windowStart, windowStart + maxResults);
    }
    const rows: HTMLElement[] = [];
    const showFrom = Boolean(activeConversation && activeConversation.kind !== "dm");
    for (let i = 0; i < windowHits.length; i += 1) {
      const msgIdx = windowHits[i];
      const m = msgs[msgIdx];
      if (!m) continue;
      const hitPos = windowStart + i;
      const preview = trimSearchPreview(searchResultPreview(m));
      const textEl = el("div", { class: "chat-search-result-text" }, [preview]);
      const metaItems: HTMLElement[] = [];
      if (showFrom && m.kind !== "sys") {
        metaItems.push(el("span", { class: "chat-search-result-from" }, [resolveUserLabel(state, m.from, friendLabels)]));
      }
      const time = typeof m.ts === "number" && Number.isFinite(m.ts) ? formatTime(m.ts) : "";
      if (time) {
        metaItems.push(el("span", { class: "chat-search-result-time" }, [time]));
      }
      const body = el("div", { class: "chat-search-result-body" }, [textEl, ...(metaItems.length ? [el("div", { class: "chat-search-result-meta" }, metaItems)] : [])]);
      const active = hitPos === activePos;
      rows.push(
        el(
          "button",
          {
            class: `chat-search-result${active ? " is-active" : ""}`,
            type: "button",
            "data-action": "chat-search-result",
            "data-msg-idx": String(msgIdx),
            "data-hit-pos": String(hitPos),
            ...(active ? { "aria-current": "true" } : {}),
          },
          [body]
        )
      );
    }
    if (!rows.length) {
      rows.push(el("div", { class: "chat-search-results-empty" }, ["Ничего не найдено"]));
    }
    const list = el("div", { class: "chat-search-results-list", role: "list" }, rows);
    const header =
      totalHits > maxResults
        ? el("div", { class: "chat-search-results-hint" }, [
            `Показаны ${windowStart + 1}-${windowStart + windowHits.length} из ${totalHits}`,
          ])
        : null;
    layout.chatSearchResults.classList.remove("hidden");
    layout.chatSearchResults.replaceChildren(...(header ? [header, list] : [list]));
  } else {
    layout.chatSearchResults.classList.add("hidden");
    layout.chatSearchResults.replaceChildren();
  }

  if (searchFooter) {
    layout.chatSearchFooter.classList.remove("hidden");
    layout.chatSearchFooter.replaceChildren(searchFooter);
  } else {
    layout.chatSearchFooter.classList.add("hidden");
    layout.chatSearchFooter.replaceChildren();
  }
}
