import { el } from "../../../helpers/dom/el";
import { EMOJI_RECENTS_ID, loadEmojiCatalog, updateEmojiRecents } from "../../../helpers/ui/emoji";
import { insertTextAtSelection } from "../../../helpers/ui/textSelection";
import type { EmojiCategory } from "../../../helpers/ui/emojiCatalog";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

const EMOJI_RECENTS_KEY = "yagodka:emoji_recents:v1";
const EMOJI_RECENTS_MAX = 24;

type EmojiPickerMode = "composer" | "reaction";
type EmojiReactionTarget = { key: string; msgId: number };
type EmojiCatalog = Awaited<ReturnType<typeof loadEmojiCatalog>>;

export interface EmojiPopoverFeatureDeps {
  store: Store<AppState>;
  inputWrap: HTMLElement;
  input: HTMLTextAreaElement;
  emojiButton: HTMLButtonElement;
  send: (payload: any) => void;
}

export interface EmojiPopoverFeature {
  installEventListeners: () => void;
  dispose: () => void;
  open: () => void;
  openForReaction: (target: EmojiReactionTarget) => void;
  close: () => void;
  isOpen: () => boolean;
}

function loadEmojiRecents(): string[] {
  try {
    const raw = localStorage.getItem(EMOJI_RECENTS_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x) => typeof x === "string" && x && x.length <= 16).slice(0, EMOJI_RECENTS_MAX);
  } catch {
    return [];
  }
}

function saveEmojiRecents(recents: string[]) {
  try {
    localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // ignore
  }
}

export function createEmojiPopoverFeature(deps: EmojiPopoverFeatureDeps): EmojiPopoverFeature {
  const { store, inputWrap, input, emojiButton, send } = deps;

  let listenersInstalled = false;
  let emojiOpen = false;
  let emojiPickerMode: EmojiPickerMode = "composer";
  let emojiPickerReactionTarget: EmojiReactionTarget | null = null;
  let emojiPopover: HTMLElement | null = null;
  let emojiTabs: HTMLElement | null = null;
  let emojiContent: HTMLElement | null = null;
  let emojiSearchInput: HTMLInputElement | null = null;
  let emojiSearchWrap: HTMLElement | null = null;
  let emojiActiveSection = EMOJI_RECENTS_ID;
  let emojiSearch = "";
  let emojiHideTimer: number | null = null;
  let emojiLastQuery = "";
  let emojiCatalog: EmojiCatalog | null = null;
  let emojiCatalogLoading = false;
  let emojiCatalogError: string | null = null;

  const clearEmojiHideTimer = () => {
    if (emojiHideTimer === null) return;
    window.clearTimeout(emojiHideTimer);
    emojiHideTimer = null;
  };

  const resetEmojiPickerMode = () => {
    emojiPickerMode = "composer";
    emojiPickerReactionTarget = null;
  };

  const ensureEmojiCatalog = () => {
    if (emojiCatalog || emojiCatalogLoading) return;
    emojiCatalogLoading = true;
    emojiCatalogError = null;
    void loadEmojiCatalog()
      .then((mod) => {
        emojiCatalog = mod;
        emojiCatalogLoading = false;
        if (emojiOpen) renderEmojiPopover();
      })
      .catch(() => {
        emojiCatalogLoading = false;
        emojiCatalogError = "Не удалось загрузить эмодзи";
        if (emojiOpen) renderEmojiPopover();
      });
  };

  const setActiveEmojiTab = (sectionId: string) => {
    emojiActiveSection = sectionId;
    if (!emojiTabs) return;
    const tabs = emojiTabs.querySelectorAll<HTMLButtonElement>("button.emoji-tab[data-emoji-section]");
    tabs.forEach((btn) => {
      const active = btn.dataset.emojiSection === sectionId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  };

  const syncEmojiActiveTabFromScroll = () => {
    if (!emojiContent) return;
    const sections = Array.from(emojiContent.querySelectorAll<HTMLElement>(".emoji-section[data-section]"));
    if (!sections.length) return;
    const top = emojiContent.scrollTop + 8;
    let current = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= top) current = section;
      else break;
    }
    const nextId = current.dataset.section;
    if (nextId) setActiveEmojiTab(nextId);
  };

  const scrollToEmojiSection = (sectionId: string, behavior: ScrollBehavior = "smooth") => {
    if (!emojiContent) return;
    const target = emojiContent.querySelector<HTMLElement>(`.emoji-section[data-section="${sectionId}"]`);
    if (!target) return;
    emojiContent.scrollTo({ top: Math.max(0, target.offsetTop - 4), behavior });
  };

  const renderEmojiTabs = (sections: EmojiCategory[]) => {
    if (!emojiTabs) return;
    if (!sections.length) {
      emojiTabs.replaceChildren();
      return;
    }
    if (!sections.some((s) => s.id === emojiActiveSection)) {
      emojiActiveSection = sections[0].id;
    }
    const buttons = sections.map((section) =>
      el(
        "button",
        {
          class: `emoji-tab${section.id === emojiActiveSection ? " is-active" : ""}`,
          type: "button",
          role: "tab",
          "data-emoji-section": section.id,
          "aria-selected": section.id === emojiActiveSection ? "true" : "false",
          "aria-controls": `emoji-section-${section.id}`,
          title: section.title,
        },
        [section.icon]
      )
    );
    emojiTabs.replaceChildren(...buttons);
  };

  const renderEmojiContent = (sections: EmojiCategory[], hasQuery: boolean) => {
    if (!emojiContent) return;
    const contentNodes: HTMLElement[] = [];
    for (const section of sections) {
      if (!section.items.length) continue;
      const title = el("div", { class: "emoji-section-title" }, [section.title]);
      const grid = el(
        "div",
        { class: "emoji-grid", role: "listbox", "aria-label": section.title },
        section.items.map((e) => el("button", { class: "emoji-btn", type: "button", "data-emoji": e, title: e, "aria-label": e }, [e]))
      );
      const block = el("section", { class: "emoji-section", id: `emoji-section-${section.id}`, "data-section": section.id }, [title, grid]);
      contentNodes.push(block);
    }
    if (!contentNodes.length) {
      const empty = el("div", { class: "emoji-empty" }, [hasQuery ? "Ничего не найдено" : "Эмодзи пока нет"]);
      emojiContent.replaceChildren(empty);
      return;
    }
    emojiContent.replaceChildren(...contentNodes);
  };

  const renderEmojiLoading = () => {
    if (emojiTabs) emojiTabs.replaceChildren();
    if (!emojiContent) return;
    const msg = emojiCatalogError ? emojiCatalogError : "Загрузка эмодзи...";
    emojiContent.replaceChildren(el("div", { class: "emoji-empty" }, [msg]));
  };

  const renderEmojiPopover = () => {
    const pop = ensureEmojiPopover();
    if (!emojiCatalog) {
      ensureEmojiCatalog();
      if (emojiSearchInput) {
        emojiSearchInput.disabled = true;
        emojiSearchInput.placeholder = "Загрузка эмодзи";
        if (emojiSearchInput.value) emojiSearchInput.value = "";
      }
      if (emojiSearchWrap) emojiSearchWrap.classList.remove("has-value");
      pop.classList.remove("emoji-searching");
      renderEmojiLoading();
      return;
    }

    if (emojiSearchInput) {
      emojiSearchInput.disabled = false;
      emojiSearchInput.placeholder = "Поиск эмодзи";
    }

    const sections = emojiCatalog.buildEmojiSections(loadEmojiRecents());
    const filtered = emojiCatalog.filterEmojiSections(sections, emojiSearch);
    const hasQuery = emojiSearch.trim().length > 0;

    if (emojiSearchInput && emojiSearchInput.value !== emojiSearch) {
      emojiSearchInput.value = emojiSearch;
    }
    if (emojiSearchWrap) emojiSearchWrap.classList.toggle("has-value", hasQuery);
    pop.classList.toggle("emoji-searching", hasQuery);

    renderEmojiTabs(sections);
    renderEmojiContent(filtered, hasQuery);

    if (emojiContent && emojiLastQuery !== emojiSearch) {
      emojiContent.scrollTop = 0;
      emojiLastQuery = emojiSearch;
    }
    syncEmojiActiveTabFromScroll();
  };

  const close = () => {
    emojiOpen = false;
    emojiButton.classList.remove("btn-active");
    if (!emojiPopover) return;
    resetEmojiPickerMode();
    emojiSearch = "";
    emojiLastQuery = "";
    if (emojiSearchInput) emojiSearchInput.value = "";
    if (emojiSearchWrap) emojiSearchWrap.classList.remove("has-value");
    emojiPopover.classList.remove("emoji-searching");
    emojiPopover.classList.remove("emoji-open");
    clearEmojiHideTimer();
    emojiHideTimer = window.setTimeout(() => {
      if (!emojiOpen) emojiPopover?.classList.add("hidden");
    }, 160);
  };

  const open = () => {
    if (input.disabled) return;
    resetEmojiPickerMode();
    emojiOpen = true;
    emojiButton.classList.add("btn-active");
    const pop = ensureEmojiPopover();
    renderEmojiPopover();
    clearEmojiHideTimer();
    pop.classList.remove("hidden");
    requestAnimationFrame(() => pop.classList.add("emoji-open"));
  };

  const openForReaction = (target: EmojiReactionTarget) => {
    if (!target.key || !target.msgId) return;
    emojiPickerMode = "reaction";
    emojiPickerReactionTarget = target;
    emojiOpen = true;
    emojiButton.classList.add("btn-active");
    const pop = ensureEmojiPopover();
    renderEmojiPopover();
    clearEmojiHideTimer();
    pop.classList.remove("hidden");
    requestAnimationFrame(() => pop.classList.add("emoji-open"));
  };

  const handlePopoverClick = (ev: Event) => {
    const closeBtn = (ev.target as HTMLElement | null)?.closest("button[data-action='emoji-close']") as HTMLButtonElement | null;
    if (closeBtn) {
      ev.preventDefault();
      close();
      return;
    }

    const clearBtn = (ev.target as HTMLElement | null)?.closest("button[data-action='emoji-search-clear']") as HTMLButtonElement | null;
    if (clearBtn) {
      ev.preventDefault();
      emojiSearch = "";
      if (emojiSearchInput) emojiSearchInput.value = "";
      renderEmojiPopover();
      try {
        emojiSearchInput?.focus({ preventScroll: true });
      } catch {
        emojiSearchInput?.focus();
      }
      return;
    }

    const tabBtn = (ev.target as HTMLElement | null)?.closest("button[data-emoji-section]") as HTMLButtonElement | null;
    if (tabBtn) {
      ev.preventDefault();
      const nextId = String(tabBtn.dataset.emojiSection || "");
      if (nextId) {
        setActiveEmojiTab(nextId);
        scrollToEmojiSection(nextId);
      }
      return;
    }

    const target = (ev.target as HTMLElement | null)?.closest("button[data-emoji]") as HTMLButtonElement | null;
    if (!target) return;
    ev.preventDefault();

    const emoji = String(target.dataset.emoji || "");
    if (!emoji) return;

    if (emojiPickerMode === "reaction") {
      const st = store.get();
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        close();
        return;
      }
      if (!st.authed) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const targetInfo = emojiPickerReactionTarget;
      if (!targetInfo || !targetInfo.key || !targetInfo.msgId) {
        close();
        return;
      }
      const conv = st.conversations?.[targetInfo.key] || [];
      let msg: ChatMessage | null = null;
      for (let i = conv.length - 1; i >= 0; i -= 1) {
        const candidate = conv[i];
        const mid = candidate && typeof candidate.id === "number" && Number.isFinite(candidate.id) ? candidate.id : null;
        if (mid && mid === targetInfo.msgId) {
          msg = candidate;
          break;
        }
      }
      if (!msg) {
        close();
        return;
      }
      const mine = typeof msg.reactions?.mine === "string" ? msg.reactions.mine : null;
      const nextEmoji = mine === emoji ? null : emoji;
      send({ type: "reaction_set", id: targetInfo.msgId, emoji: nextEmoji });
      const recents = loadEmojiRecents();
      const next = updateEmojiRecents(recents, emoji, EMOJI_RECENTS_MAX);
      saveEmojiRecents(next);
      close();
      return;
    }

    if (input.disabled) return;

    const { value, caret } = insertTextAtSelection({
      value: input.value || "",
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      insertText: emoji,
    });
    input.value = value;
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      // ignore
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }

    const recents = loadEmojiRecents();
    const next = updateEmojiRecents(recents, emoji, EMOJI_RECENTS_MAX);
    saveEmojiRecents(next);
    renderEmojiPopover();
  };

  const handlePopoverKeyDown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const handleEmojiSearchInput = () => {
    emojiSearch = emojiSearchInput?.value || "";
    renderEmojiPopover();
  };

  const handleEmojiScroll = () => {
    if (!emojiOpen) return;
    syncEmojiActiveTabFromScroll();
  };

  const ensureEmojiPopover = (): HTMLElement => {
    if (emojiPopover) return emojiPopover;
    const pop = el("div", { class: "emoji-popover hidden", role: "dialog", "aria-label": "Эмодзи" });
    const field = inputWrap.querySelector(".composer-field");
    (field || inputWrap).append(pop);
    emojiPopover = pop;

    const closeBtn = el("button", { class: "btn emoji-close", type: "button", "aria-label": "Закрыть эмодзи", "data-action": "emoji-close" }, ["x"]);
    const searchInput = el("input", {
      class: "emoji-search-input",
      type: "search",
      placeholder: "Поиск эмодзи",
      "aria-label": "Поиск эмодзи",
    });
    emojiSearchInput = searchInput;
    const clearBtn = el(
      "button",
      { class: "emoji-search-clear", type: "button", "aria-label": "Очистить поиск", "data-action": "emoji-search-clear" },
      ["x"]
    );
    const searchWrap = el("label", { class: "emoji-search", role: "search" }, [searchInput, clearBtn]);
    emojiSearchWrap = searchWrap;
    const head = el("div", { class: "emoji-head" }, [searchWrap, closeBtn]);
    const tabs = el("div", { class: "emoji-tabs", role: "tablist", "aria-label": "Категории эмодзи" });
    emojiTabs = tabs;
    const content = el("div", { class: "emoji-content", role: "tabpanel", "aria-label": "Список эмодзи" });
    emojiContent = content;
    pop.append(head, tabs, content);

    pop.addEventListener("click", handlePopoverClick);
    pop.addEventListener("keydown", handlePopoverKeyDown);
    searchInput.addEventListener("input", handleEmojiSearchInput);
    content.addEventListener("scroll", handleEmojiScroll, { passive: true });

    return pop;
  };

  const handleEmojiButtonClick = (e: Event) => {
    e.preventDefault();
    if (emojiOpen) close();
    else open();
  };

  const handleDocumentPointerDown = (e: Event) => {
    if (!emojiOpen) return;
    const t = (e as PointerEvent).target as Node | null;
    if (!t) return;
    if (emojiPopover && emojiPopover.contains(t)) return;
    if (emojiButton.contains(t)) return;
    close();
  };

  const installEventListeners = () => {
    if (listenersInstalled) return;
    emojiButton.addEventListener("click", handleEmojiButtonClick);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    listenersInstalled = true;
  };

  const dispose = () => {
    if (!listenersInstalled) return;
    emojiButton.removeEventListener("click", handleEmojiButtonClick);
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    if (emojiPopover) {
      emojiPopover.removeEventListener("click", handlePopoverClick);
      emojiPopover.removeEventListener("keydown", handlePopoverKeyDown);
    }
    if (emojiSearchInput) {
      emojiSearchInput.removeEventListener("input", handleEmojiSearchInput);
    }
    if (emojiContent) {
      emojiContent.removeEventListener("scroll", handleEmojiScroll);
    }
    close();
    listenersInstalled = false;
  };

  return {
    installEventListeners,
    dispose,
    open,
    openForReaction,
    close,
    isOpen: () => emojiOpen,
  };
}
