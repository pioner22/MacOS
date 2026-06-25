import type { ActionModalPayload, ConfirmAction, PageKind, TargetRef } from "../stores/types";
import type { ChatSearchCounts, ChatSearchFilter } from "../helpers/chat/chatSearch";

interface PageNavigationFeatureLike {
  setPage: (page: PageKind) => void;
  openUserPage: (id: string) => void;
  openGroupPage: (id: string) => void;
  openBoardPage: (id: string) => void;
  openRightPanel: (target: TargetRef) => void;
  closeRightPanel: () => void;
}

interface HistoryFeatureLike {
  requestHistory: (target: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) => void;
  enqueueHistoryPreview: (target: TargetRef) => void;
  requestMoreHistory: () => void;
  scheduleWarmup: () => void;
  scheduleBackfill: () => void;
  clearPendingRequests: () => void;
}

interface ReadReceiptsFeatureLike {
  maybeSendMessageRead: (peerId: string, upToId?: number | null) => void;
  maybeSendRoomRead: (roomId: string, upToId: number) => void;
}

interface ChatTargetSelectionFeatureLike {
  selectTarget: (target: TargetRef) => void;
  clearSelectedTarget: () => void;
}

interface ChatJumpFeatureLike {
  scrollToChatMsgIdx: (idx: number) => void;
  jumpToChatMsgIdx: (idx: number) => void;
}

interface OpenChatFromSearchFeatureLike {
  openChatFromSearch: (target: TargetRef, query: string, msgIdx?: number) => void;
}

interface ChatSearchUiFeatureLike {
  setChatSearchDate: (value: string) => void;
  closeChatSearch: () => void;
  openChatSearch: () => void;
  setChatSearchQuery: (query: string) => void;
  setChatSearchFilter: (next: ChatSearchFilter) => void;
  toggleChatSearchResults: (force?: boolean) => void;
  setChatSearchPos: (pos: number) => void;
  stepChatSearch: (dir: 1 | -1) => void;
  focusChatSearch: (selectAll?: boolean) => void;
}

interface ActionModalRoutingFeatureLike {
  openActionModal: (payload: ActionModalPayload) => void;
}

interface ModalOpenersFeatureLike {
  openGroupCreateModal: () => void;
  openBoardCreateModal: () => void;
  openMembersAddModal: (targetKind: "group" | "board", targetId: string) => void;
  openMembersRemoveModal: (targetKind: "group" | "board", targetId: string) => void;
  openRenameModal: (targetKind: "group" | "board", targetId: string) => void;
  openConfirmModal: (payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => void;
}

interface RoomCreateSubmitFeatureLike {
  createGroup: () => void;
  createBoard: () => void;
}

interface RoomMembersSubmitFeatureLike {
  membersAddSubmit: () => void;
  membersRemoveSubmit: () => void;
  renameSubmit: () => void;
}

interface ScheduleSubmitFeatureLike {
  sendScheduleSubmit: () => void;
  sendScheduleWhenOnlineSubmit: () => void;
}

export function normalizeChatSearchFilter(filter: ChatSearchFilter, counts: ChatSearchCounts): ChatSearchFilter {
  if (filter === "all") return "all";
  return counts[filter] > 0 ? filter : "all";
}

export function sameChatSearchCounts(a: ChatSearchCounts, b: ChatSearchCounts): boolean {
  return a.all === b.all && a.media === b.media && a.files === b.files && a.links === b.links && a.music === b.music && a.voice === b.voice;
}

export function sameNumberArray(a: number[], b: number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createMountNavigationBridge(deps: {
  getPageNavigationFeature: () => PageNavigationFeatureLike;
  getHistoryFeature: () => HistoryFeatureLike | null;
  getReadReceiptsFeature: () => ReadReceiptsFeatureLike;
  getChatTargetSelectionFeature: () => ChatTargetSelectionFeatureLike;
  getChatJumpFeature: () => ChatJumpFeatureLike;
  getOpenChatFromSearchFeature: () => OpenChatFromSearchFeatureLike;
  getChatSearchUiFeature: () => ChatSearchUiFeatureLike;
}) {
  const {
    getPageNavigationFeature,
    getHistoryFeature,
    getReadReceiptsFeature,
    getChatTargetSelectionFeature,
    getChatJumpFeature,
    getOpenChatFromSearchFeature,
    getChatSearchUiFeature,
  } = deps;

  return {
    setPage: (page: PageKind) => getPageNavigationFeature().setPage(page),
    openUserPage: (id: string) => getPageNavigationFeature().openUserPage(id),
    openGroupPage: (id: string) => getPageNavigationFeature().openGroupPage(id),
    openBoardPage: (id: string) => getPageNavigationFeature().openBoardPage(id),
    openRightPanel: (target: TargetRef) => getPageNavigationFeature().openRightPanel(target),
    closeRightPanel: () => getPageNavigationFeature().closeRightPanel(),
    requestHistory: (target: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) =>
      getHistoryFeature()?.requestHistory(target, opts),
    enqueueHistoryPreview: (target: TargetRef) => getHistoryFeature()?.enqueueHistoryPreview(target),
    requestMoreHistory: () => getHistoryFeature()?.requestMoreHistory(),
    scheduleHistoryWarmup: () => {
      getHistoryFeature()?.scheduleWarmup();
      getHistoryFeature()?.scheduleBackfill();
    },
    clearPendingHistoryRequests: () => getHistoryFeature()?.clearPendingRequests(),
    maybeSendMessageRead: (peerId: string, upToId?: number | null) => getReadReceiptsFeature().maybeSendMessageRead(peerId, upToId),
    maybeSendRoomRead: (roomId: string, upToId: number) => getReadReceiptsFeature().maybeSendRoomRead(roomId, upToId),
    selectTarget: (target: TargetRef) => getChatTargetSelectionFeature().selectTarget(target),
    clearSelectedTarget: () => getChatTargetSelectionFeature().clearSelectedTarget(),
    scrollToChatMsgIdx: (idx: number) => getChatJumpFeature().scrollToChatMsgIdx(idx),
    jumpToChatMsgIdx: (idx: number) => getChatJumpFeature().jumpToChatMsgIdx(idx),
    openChatFromSearch: (target: TargetRef, query: string, msgIdx?: number) =>
      getOpenChatFromSearchFeature().openChatFromSearch(target, query, msgIdx),
    setChatSearchDate: (value: string) => getChatSearchUiFeature().setChatSearchDate(value),
    closeChatSearch: () => getChatSearchUiFeature().closeChatSearch(),
    openChatSearch: () => getChatSearchUiFeature().openChatSearch(),
    setChatSearchQuery: (query: string) => getChatSearchUiFeature().setChatSearchQuery(query),
    setChatSearchFilter: (next: ChatSearchFilter) => getChatSearchUiFeature().setChatSearchFilter(next),
    toggleChatSearchResults: (force?: boolean) => getChatSearchUiFeature().toggleChatSearchResults(force),
    setChatSearchPos: (pos: number) => getChatSearchUiFeature().setChatSearchPos(pos),
    stepChatSearch: (dir: 1 | -1) => getChatSearchUiFeature().stepChatSearch(dir),
    focusChatSearch: (selectAll = false) => getChatSearchUiFeature().focusChatSearch(selectAll),
  };
}

export function createMountModalBridge(deps: {
  getActionModalRoutingFeature: () => ActionModalRoutingFeatureLike;
  getModalOpenersFeature: () => ModalOpenersFeatureLike;
  getRoomCreateSubmitFeature: () => RoomCreateSubmitFeatureLike;
  getRoomMembersSubmitFeature: () => RoomMembersSubmitFeatureLike;
  getScheduleSubmitFeature: () => ScheduleSubmitFeatureLike;
}) {
  const {
    getActionModalRoutingFeature,
    getModalOpenersFeature,
    getRoomCreateSubmitFeature,
    getRoomMembersSubmitFeature,
    getScheduleSubmitFeature,
  } = deps;

  return {
    openActionModal: (payload: ActionModalPayload) => getActionModalRoutingFeature().openActionModal(payload),
    openGroupCreateModal: () => getModalOpenersFeature().openGroupCreateModal(),
    openBoardCreateModal: () => getModalOpenersFeature().openBoardCreateModal(),
    openMembersAddModal: (targetKind: "group" | "board", targetId: string) => getModalOpenersFeature().openMembersAddModal(targetKind, targetId),
    openMembersRemoveModal: (targetKind: "group" | "board", targetId: string) =>
      getModalOpenersFeature().openMembersRemoveModal(targetKind, targetId),
    openRenameModal: (targetKind: "group" | "board", targetId: string) => getModalOpenersFeature().openRenameModal(targetKind, targetId),
    openConfirmModal: (payload: {
      title: string;
      message: string;
      action: ConfirmAction;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
    }) => getModalOpenersFeature().openConfirmModal(payload),
    createGroup: () => getRoomCreateSubmitFeature().createGroup(),
    createBoard: () => getRoomCreateSubmitFeature().createBoard(),
    membersAddSubmit: () => getRoomMembersSubmitFeature().membersAddSubmit(),
    membersRemoveSubmit: () => getRoomMembersSubmitFeature().membersRemoveSubmit(),
    renameSubmit: () => getRoomMembersSubmitFeature().renameSubmit(),
    sendScheduleSubmit: () => getScheduleSubmitFeature().sendScheduleSubmit(),
    sendScheduleWhenOnlineSubmit: () => getScheduleSubmitFeature().sendScheduleWhenOnlineSubmit(),
  };
}
