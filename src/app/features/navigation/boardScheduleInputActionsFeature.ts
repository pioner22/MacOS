import { conversationKey } from "../../../helpers/chat/conversationKey";
import { updateDraftMap } from "../../../helpers/chat/drafts";
import { getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";
import { applyDraftMapMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface BoardScheduleInputActionsFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  boardScheduleInput: HTMLInputElement;
  appMsgMaxLen: number;
  maxBoardScheduleDelayMs: () => number;
  saveBoardScheduleForUser: (userId: string, posts: Array<any>) => void;
  armBoardScheduleTimer: () => void;
  scheduleSaveDrafts: () => void;
  autosizeInput: (el: HTMLTextAreaElement) => void;
  scheduleBoardEditorPreview: () => void;
  showToast: (message: string, opts?: { kind?: "info" | "success" | "warn" | "error" }) => void;
}

export interface BoardScheduleInputActionsFeature {
  handleBoardScheduleInputWrapClick: (target: HTMLElement | null, event: Event) => boolean;
}

export function createBoardScheduleInputActionsFeature(deps: BoardScheduleInputActionsFeatureDeps): BoardScheduleInputActionsFeature {
  const {
    store,
    input,
    boardScheduleInput,
    appMsgMaxLen,
    maxBoardScheduleDelayMs,
    saveBoardScheduleForUser,
    armBoardScheduleTimer,
    scheduleSaveDrafts,
    autosizeInput,
    scheduleBoardEditorPreview,
    showToast,
  } = deps;

  const notifyStore = () => {
    if (typeof (store as any).notify === "function") (store as any).notify();
  };

  const handleBoardScheduleInputWrapClick = (target: HTMLElement | null, event: Event): boolean => {
    const scheduleAddBtn = target?.closest("button[data-action='board-schedule-add']") as HTMLButtonElement | null;
    if (scheduleAddBtn) {
      event.preventDefault();
      const st = store.get();
      const sel = getActiveConversationTarget(st);
      if (!sel || sel.kind !== "board") return true;
      if (!st.authed || !st.selfId) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return true;
      }
      const board = (st.boards || []).find((entry) => entry.id === sel.id);
      const owner = String(board?.owner_id || "").trim();
      const me = String(st.selfId || "").trim();
      if (owner && me && owner !== me) {
        store.set({ status: "На доске писать может только владелец" });
        return true;
      }

      const rawText = String(input.value || "").trimEnd();
      const body = rawText.trim();
      if (!body) return true;
      if (body.length > appMsgMaxLen) {
        store.set({ status: `Слишком длинный пост (${body.length}/${appMsgMaxLen})` });
        return true;
      }

      const rawWhen = String(boardScheduleInput.value || "").trim();
      const match = rawWhen.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!match) {
        store.set({ status: "Выберите дату/время" });
        return true;
      }
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hours = Number(match[4]);
      const minutes = Number(match[5]);
      const when = new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
      if (!Number.isFinite(when)) {
        store.set({ status: "Некорректная дата" });
        return true;
      }
      const now = Date.now();
      const maxAt = now + maxBoardScheduleDelayMs();
      if (when < now) {
        store.set({ status: "Время уже прошло — выберите будущее" });
        return true;
      }
      if (when > maxAt) {
        store.set({ status: "Максимум — 7 дней вперёд" });
        return true;
      }

      const id = `sched-${now}-${Math.random().toString(16).slice(2, 10)}`;
      const item = { id, boardId: sel.id, text: rawText, scheduleAt: Math.trunc(when), createdAt: now };
      const nextList = [...(Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : []), item].sort((a, b) => a.scheduleAt - b.scheduleAt);
      store.set((prev) => ({ ...prev, boardScheduledPosts: nextList }));
      saveBoardScheduleForUser(st.selfId, nextList);
      armBoardScheduleTimer();

      boardScheduleInput.value = "";
      notifyStore();

      const convKey = conversationKey(sel);
      store.set((prev) => {
        const drafts = convKey ? updateDraftMap(prev.drafts, convKey, "") : prev.drafts;
        return { ...applyDraftMapMutation(prev, drafts), input: "" };
      });
      scheduleSaveDrafts();
      try {
        input.value = "";
        autosizeInput(input);
        input.focus();
        scheduleBoardEditorPreview();
      } catch {
        // ignore
      }
      showToast("Пост запланирован", { kind: "success" });
      return true;
    }

      const scheduleClearBtn = target?.closest("button[data-action='board-schedule-clear']") as HTMLButtonElement | null;
    if (scheduleClearBtn) {
      event.preventDefault();
      boardScheduleInput.value = "";
      notifyStore();
      return true;
    }

    const scheduleCancelBtn = target?.closest("button[data-action='board-schedule-cancel']") as HTMLButtonElement | null;
    if (scheduleCancelBtn) {
      event.preventDefault();
      const id = String(scheduleCancelBtn.getAttribute("data-sched-id") || "").trim();
      const st = store.get();
      if (!id) return true;
      const next = (st.boardScheduledPosts || []).filter((entry) => entry.id !== id);
      if (next.length === (st.boardScheduledPosts || []).length) return true;
      store.set((prev) => ({ ...prev, boardScheduledPosts: next }));
      if (st.selfId) saveBoardScheduleForUser(st.selfId, next);
      armBoardScheduleTimer();
      showToast("Запланированная публикация отменена", { kind: "info" });
      return true;
    }

    return false;
  };

  return {
    handleBoardScheduleInputWrapClick,
  };
}
