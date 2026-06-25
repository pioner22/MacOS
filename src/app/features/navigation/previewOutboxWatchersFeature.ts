import type { Store } from "../../../stores/store";
import type { AppState, ConnStatus, TargetRef } from "../../../stores/types";
import { hasWhenOnlineOutboxEntries, shouldAttemptOutboxDrain } from "../../../helpers/runtime/deliveryCoordinator";

function previewIdsSignature(items: Array<{ id?: string }>): string {
  return items
    .map((entry) => String(entry?.id || "").trim())
    .filter(Boolean)
    .join("|");
}

function friendOnlineSignature(friends: Array<{ id?: string; online?: boolean }>): string {
  return friends
    .map((f) => {
      const id = String(f?.id || "").trim();
      if (!id) return "";
      return `${id}:${f?.online ? "1" : "0"}`;
    })
    .filter(Boolean)
    .join("|");
}

export interface PreviewOutboxWatchersFeatureDeps {
  store: Store<AppState>;
  drainFileGetQueue: () => void;
  enqueueHistoryPreview: (target: TargetRef) => void;
  drainOutbox: () => void;
  scheduleSavePinnedMessages: () => void;
}

export function installPreviewOutboxWatchersFeature(deps: PreviewOutboxWatchersFeatureDeps): void {
  const { store, drainFileGetQueue, enqueueHistoryPreview, drainOutbox, scheduleSavePinnedMessages } = deps;

  let prevPinnedMessagesRef = store.get().pinnedMessages;
  store.subscribe(() => {
    const st = store.get();
    if (!st.authed || !st.selfId) {
      prevPinnedMessagesRef = st.pinnedMessages;
      return;
    }
    if (st.pinnedMessages !== prevPinnedMessagesRef) {
      prevPinnedMessagesRef = st.pinnedMessages;
      scheduleSavePinnedMessages();
    }
  });

  let previewFriendsRef = store.get().friends;
  let previewGroupsRef = store.get().groups;
  let previewBoardsRef = store.get().boards;
  let previewFriendsSig = previewIdsSignature(previewFriendsRef || []);
  let previewGroupsSig = previewIdsSignature(previewGroupsRef || []);
  let previewBoardsSig = previewIdsSignature(previewBoardsRef || []);
  let previewConn: ConnStatus = store.get().conn;
  let previewAuthed = store.get().authed;
  store.subscribe(() => {
    const st = store.get();
    const friendsRefChanged = st.friends !== previewFriendsRef;
    const groupsRefChanged = st.groups !== previewGroupsRef;
    const boardsRefChanged = st.boards !== previewBoardsRef;
    let nextFriendsSig = previewFriendsSig;
    let nextGroupsSig = previewGroupsSig;
    let nextBoardsSig = previewBoardsSig;
    if (friendsRefChanged) {
      previewFriendsRef = st.friends;
      nextFriendsSig = previewIdsSignature(st.friends || []);
    }
    if (groupsRefChanged) {
      previewGroupsRef = st.groups;
      nextGroupsSig = previewIdsSignature(st.groups || []);
    }
    if (boardsRefChanged) {
      previewBoardsRef = st.boards;
      nextBoardsSig = previewIdsSignature(st.boards || []);
    }
    const friendsChanged = nextFriendsSig !== previewFriendsSig;
    const groupsChanged = nextGroupsSig !== previewGroupsSig;
    const boardsChanged = nextBoardsSig !== previewBoardsSig;
    const connChanged = st.conn !== previewConn || st.authed !== previewAuthed;
    previewFriendsSig = nextFriendsSig;
    previewGroupsSig = nextGroupsSig;
    previewBoardsSig = nextBoardsSig;
    previewConn = st.conn;
    previewAuthed = st.authed;
    if (connChanged && st.authed && st.conn === "connected") {
      drainFileGetQueue();
    }
    if (!st.authed || st.conn !== "connected") return;
    if (!friendsChanged && !groupsChanged && !boardsChanged && !connChanged) return;
    for (const f of st.friends || []) {
      const id = String(f?.id || "").trim();
      if (!id) continue;
      enqueueHistoryPreview({ kind: "dm", id });
    }
    for (const g of st.groups || []) {
      const id = String(g?.id || "").trim();
      if (!id) continue;
      enqueueHistoryPreview({ kind: "group", id });
    }
    for (const b of st.boards || []) {
      const id = String(b?.id || "").trim();
      if (!id) continue;
      enqueueHistoryPreview({ kind: "board", id });
    }
  });

  let prevFriendOnlineSig = friendOnlineSignature(store.get().friends || []);
  store.subscribe(() => {
    const st = store.get();
    const nextSig = friendOnlineSignature(st.friends || []);
    if (nextSig === prevFriendOnlineSig) return;
    prevFriendOnlineSig = nextSig;
    if (!hasWhenOnlineOutboxEntries(st.outbox)) return;
    if (!shouldAttemptOutboxDrain(st)) return;
    drainOutbox();
  });
}
