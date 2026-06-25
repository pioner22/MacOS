export type ConnStatus = "connecting" | "connected" | "disconnected";

export type ModalKind =
  | "auth"
  | "welcome"
  | "logout"
  | "update"
  | "pwa_update"
  | "send_schedule"
  | "forward_select"
  | "members_add"
  | "members_remove"
  | "rename"
  | "confirm"
  | "file_send"
  | "file_viewer"
  | "call"
  | "invite_user"
  | "action"
  | "context_menu";

export interface ActionModalAuthIn {
  kind: "auth_in";
  peer: string;
  note?: string | null;
}

export interface ActionModalAuthOut {
  kind: "auth_out";
  peer: string;
}

export interface ActionModalGroupInvite {
  kind: "group_invite";
  groupId: string;
  from: string;
  name?: string | null;
  handle?: string | null;
  description?: string | null;
  rules?: string | null;
}

export interface ActionModalGroupJoinRequest {
  kind: "group_join_request";
  groupId: string;
  from: string;
  name?: string | null;
  handle?: string | null;
}

export interface ActionModalBoardInvite {
  kind: "board_invite";
  boardId: string;
  from: string;
  name?: string | null;
  handle?: string | null;
  description?: string | null;
  rules?: string | null;
}

export interface ActionModalFileOffer {
  kind: "file_offer";
  fileId: string;
  from: string;
  name: string;
  size: number;
  room?: string | null;
}

export type ActionModalPayload =
  | ActionModalAuthIn
  | ActionModalAuthOut
  | ActionModalGroupInvite
  | ActionModalGroupJoinRequest
  | ActionModalBoardInvite
  | ActionModalFileOffer;

export type ContextMenuTargetKind =
  | "dm"
  | "group"
  | "board"
  | "auth_in"
  | "auth_out"
  | "message"
  | "pinned_messages"
  | "composer_helper"
  | "composer_send"
  | "sidebar_tools";

export interface ContextMenuTarget {
  kind: ContextMenuTargetKind;
  id: string;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  subLabel?: string;
  meta?: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export interface ContextMenuPayload {
  x: number;
  y: number;
  title: string;
  target: ContextMenuTarget;
  items: ContextMenuItem[];
  anchorPreview?: string;
  reactionBar?: { emojis: string[]; active?: string | null };
}

export type ConfirmAction =
  | { kind: "chat_clear"; peer: string }
  | { kind: "room_clear"; roomId: string }
  | { kind: "friend_remove"; peer: string }
  | { kind: "group_member_remove"; groupId: string; memberId: string }
  | { kind: "board_member_remove"; boardId: string; memberId: string }
  | { kind: "group_leave"; groupId: string }
  | { kind: "board_leave"; boardId: string }
  | { kind: "group_disband"; groupId: string }
  | { kind: "board_disband"; boardId: string }
  | { kind: "pinned_bar_hide"; chatKey: string }
  | { kind: "pinned_message_toggle"; chatKey: string; msgId: number }
  | { kind: "pinned_messages_unpin_all"; chatKey: string };

export type FileTransferStatus =
  | "offering"
  | "uploading"
  | "uploaded"
  | "downloading"
  | "complete"
  | "rejected"
  | "error";

export interface FileOfferIn {
  id: string;
  from: string;
  name: string;
  size: number;
  room?: string | null;
  mime?: string | null;
}

export interface FileTransferEntry {
  localId: string;
  id?: string | null;
  name: string;
  size: number;
  direction: "out" | "in";
  peer: string;
  room?: string | null;
  status: FileTransferStatus;
  progress: number;
  error?: string | null;
  url?: string | null;
  mime?: string | null;
  acceptedBy?: string[];
  receivedBy?: string[];
}

export type PwaUpdateStage = "idle" | "available" | "checking" | "downloading" | "applying" | "verifying" | "done" | "error";
export type PwaUpdateDecision = "pending" | "later" | "accepted" | null;

export interface PwaUpdateRuntimeState {
  stage: PwaUpdateStage;
  buildId: string | null;
  message: string;
  detail: string;
  progress: number;
  error: string | null;
  userDecision: PwaUpdateDecision;
  updatedAt: number | null;
}

export type DesktopUpdateState =
  | "idle"
  | "disabled"
  | "checking"
  | "available"
  | "not_available"
  | "downloading"
  | "ready"
  | "installing"
  | "failed";

export interface DesktopUpdateRuntimeState {
  state: DesktopUpdateState;
  supported: boolean;
  reason: string;
  appVersion: string;
  feedUrl: string;
  autoCheck: boolean;
  updateInfo: {
    version: string;
    releaseDate: string;
  } | null;
  progress: {
    percent: number;
    transferred: number;
    total: number;
  } | null;
  error: string;
  updatedAt: number | null;
}

export interface FileThumbEntry {
  url: string;
  mime: string | null;
  ts: number;
  w?: number | null;
  h?: number | null;
  mediaW?: number | null;
  mediaH?: number | null;
}

export type ModalState =
  | { kind: "auth"; message?: string }
  | { kind: "welcome" }
  | { kind: "logout" }
  | { kind: "update" }
  | { kind: "pwa_update" }
  | { kind: "desktop_update" }
  | { kind: "reactions"; chatKey: string; msgId: number }
  | {
      kind: "call";
      callId: string;
      roomName: string;
      mode: "audio" | "video";
      from: string;
      to?: string | null;
      room?: string | null;
      title: string;
      incoming?: boolean;
      phase?: "permission" | "creating" | "ringing" | "active";
      phaseAt?: number; // ms timestamp (used for local UI timer)
      permissionToken?: string;
      permission?: {
        status: "idle" | "requesting" | "blocked" | "error" | "unsupported";
        message: string;
        detail?: string;
        blockedKind?: "camera" | "microphone" | null;
        canOpenSettings?: boolean;
        settingsLabel?: string;
      };
    }
  | {
      kind: "send_schedule";
      target: TargetRef;
      text: string;
      replyDraft?: MessageHelperDraft | null;
      forwardDraft?: MessageHelperDraft | null;
      suggestedAt?: number;
      preserveComposer?: boolean;
      message?: string;
      edit?: { key: string; localId: string } | null;
      title?: string;
      confirmLabel?: string;
    }
  | {
      kind: "forward_select";
      forwardDraft?: MessageHelperDraft | null;
      forwardDrafts?: MessageHelperDraft[] | null;
      message?: string;
    }
  | { kind: "board_post"; boardId: string }
  | { kind: "members_add"; targetKind: "group" | "board"; targetId: string; title: string; message?: string }
  | { kind: "members_remove"; targetKind: "group" | "board"; targetId: string; title: string; message?: string }
  | { kind: "rename"; targetKind: "group" | "board"; targetId: string; title: string; currentName: string | null; message?: string }
  | { kind: "confirm"; title: string; message: string; action: ConfirmAction; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
  | {
      kind: "file_send";
      files: File[];
      target: TargetRef;
      caption?: string;
      captionDisabled?: boolean;
      captionHint?: string;
      restoreInput?: string | null;
      previewUrls?: Array<string | null>;
    }
  | {
      kind: "file_viewer";
      fileId?: string | null;
      url: string;
      name: string;
      size: number;
      mime?: string | null;
      caption?: string | null;
      fallbackUrl?: string | null;
      autoplay?: boolean;
      chatKey?: string | null;
      msgIdx?: number | null;
      prevIdx?: number | null;
      nextIdx?: number | null;
      openedAtMs?: number | null;
    }
  | { kind: "invite_user"; peer: string; message?: string }
  | { kind: "action"; payload: ActionModalPayload; message?: string }
  | { kind: "context_menu"; payload: ContextMenuPayload };

export type PageKind =
  | "main"
  | "search"
  | "profile"
  | "sessions"
  | "user"
  | "group"
  | "board"
  | "files"
  | "help"
  | "group_create"
  | "board_create";

export type AuthMode = "auto" | "register" | "login";

export type MobileSidebarTab = "chats" | "groups" | "contacts" | "boards" | "menu";

export interface ChatFolderEntry {
  id: string;
  title: string;
  emoji?: string | null;
  include: string[];
  exclude: string[];
}

export type TargetKind = "dm" | "group" | "board";

export interface TargetRef {
  kind: TargetKind;
  id: string;
}

export type ChatAttachment =
  | {
      kind: "file";
      localId?: string | null;
      fileId?: string | null;
      name: string;
      size: number;
      mime?: string | null;
      thumbW?: number | null;
      thumbH?: number | null;
      mediaW?: number | null;
      mediaH?: number | null;
      durationS?: number | null;
    }
  | {
      kind: "action";
      payload: ActionModalPayload;
    };

export interface MessageReactions {
  counts: Record<string, number>;
  mine?: string | null;
}

export interface ChatMessageRef {
  id?: number | null;
  localId?: string | null;
  from?: string;
  text?: string;
  attachment?: ChatAttachment | null;
  via_bot?: string;
  post_author?: string;
  hidden_profile?: boolean;
}

export interface MessageHelperDraft extends ChatMessageRef {
  key: string;
  preview: string;
}

export interface ChatSelectionState {
  key: string;
  ids: string[];
}

export interface ChatMessage {
  ts: number;
  from: string;
  text: string;
  to?: string;
  room?: string;
  localId?: string | null;
  id?: number | null;
  status?: "sending" | "queued" | "sent" | "delivered" | "read" | "error";
  edited?: boolean;
  edited_ts?: number;
  kind: "in" | "out" | "sys";
  attachment?: ChatAttachment | null;
  reply?: ChatMessageRef | null;
  forward?: ChatMessageRef | null;
  reactions?: MessageReactions | null;
  whenOnline?: boolean;
  scheduleAt?: number; // ms timestamp
}

export interface OutboxEntry {
  localId: string;
  ts: number;
  text: string;
  to?: string;
  room?: string;
  status?: "queued" | "sending" | "sent";
  attempts?: number;
  lastAttemptAt?: number;
  whenOnline?: boolean;
  silent?: boolean;
  scheduleAt?: number; // ms timestamp
}

export interface BoardScheduledPost {
  id: string;
  boardId: string;
  text: string;
  scheduleAt: number; // ms timestamp
  createdAt: number; // ms timestamp
}

export interface EditingMessageState {
  key: string;
  id: number;
  prevDraft: string;
}

export interface LastReadMarker {
  id?: number;
  ts?: number;
}

export interface FriendEntry {
  id: string;
  online: boolean;
  unread: number;
  last_seen_at?: string | null;
  display_name?: string | null;
  handle?: string | null;
  avatar_rev?: number;
  avatar_mime?: string | null;
}

export interface TopPeerEntry {
  id: string;
  last_ts?: number | null;
  msg_count?: number;
}

export interface GroupEntry {
  id: string;
  name?: string | null;
  owner_id?: string | null;
  handle?: string | null;
  description?: string | null;
  rules?: string | null;
  avatar_rev?: number | null;
  avatar_mime?: string | null;
  members?: string[];
  post_banned?: string[];
}

export interface BoardEntry {
  id: string;
  name?: string | null;
  owner_id?: string | null;
  handle?: string | null;
  description?: string | null;
  rules?: string | null;
  avatar_rev?: number | null;
  avatar_mime?: string | null;
  members?: string[];
}

export interface SearchResultEntry {
  id: string;
  name?: string | null;
  handle?: string | null;
  online?: boolean;
  friend?: boolean;
  group?: boolean;
  board?: boolean;
}

export interface UserProfile {
  id: string;
  display_name?: string | null;
  handle?: string | null;
  bio?: string | null;
  status?: string | null;
  avatar_rev?: number;
  avatar_mime?: string | null;
  client_version?: string | null;
  client_web_version?: string | null;
}

export interface SessionDeviceEntry {
  current: boolean;
  online: boolean;
  client_kind?: string | null;
  client_version?: string | null;
  user_agent?: string | null;
  ip_masked?: string | null;
  issued_at?: number | null;
  last_used_at?: number | null;
  expires_at?: number | null;
}

export type ToastKind = "info" | "success" | "warn" | "error";

export interface ToastAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ToastState {
  message: string;
  kind?: ToastKind;
  actions?: ToastAction[];
  placement?: "bottom" | "center";
}

export interface SkinInfo {
  id: string;
  title: string;
}

export type ThemeMode = "light" | "dark";
export type MessageViewMode = "bubble" | "plain" | "compact";
export type HistorySyncSource = "empty" | "cache" | "server";
export type DomainSyncSource = "empty" | "cache" | "server";

export type ConversationHistoryEmptyNoticeKind = "cleared" | "message_deleted";
export type ConversationHistoryEmptyNoticeScope = "dm" | "room" | "unknown";

export interface ConversationHistoryEmptyNotice {
  kind: ConversationHistoryEmptyNoticeKind;
  scope: ConversationHistoryEmptyNoticeScope;
  by: string | null;
  at: number | null;
  deleted: number | null;
}

export interface ConversationHistorySyncState {
  loaded: boolean;
  previewOnly: boolean;
  cursor: number | null;
  hasMore: boolean | null;
  loading: boolean;
  loadingSlots: number;
  virtualStart: number;
  source: HistorySyncSource;
  reconcilePending: boolean;
  lastServerAt: number | null;
  emptyNotice: ConversationHistoryEmptyNotice | null;
}

export interface RosterSyncState {
  loaded: boolean;
  source: DomainSyncSource;
  reconcilePending: boolean;
  lastServerAt: number | null;
  lastPresenceAt: number | null;
}

export interface ProfileSyncState {
  loaded: boolean;
  source: DomainSyncSource;
  lastServerAt: number | null;
  avatarCheckedAt: number | null;
}

export interface SidebarSyncState {
  loaded: boolean;
  source: DomainSyncSource;
  reconcilePending: boolean;
  lastServerAt: number | null;
  lastLocalAt: number | null;
}

export interface RuntimeDeliveryDomainSyncState {
  loaded: boolean;
  source: DomainSyncSource;
  reconcilePending: boolean;
  lastServerAt: number | null;
  lastLocalAt: number | null;
}

export interface RuntimeDeliverySyncState {
  drafts: RuntimeDeliveryDomainSyncState;
  fileTransfers: RuntimeDeliveryDomainSyncState;
  outbox: RuntimeDeliveryDomainSyncState;
}

export interface AppState {
  conn: ConnStatus;
  netLeader: boolean;
  authed: boolean;
  selfId: string | null;
  serverVersion: string | null;
  clientVersion: string;
  status: string;

  authMode: AuthMode;
  authRememberedId: string | null;

  skin: string;
  skins: SkinInfo[];
  theme: ThemeMode;
  messageView: MessageViewMode;

  mobileSidebarTab: MobileSidebarTab;
  sidebarFolderId: string;
  sidebarQuery: string;
  sidebarArchiveOpen: boolean;
  sidebarSync: SidebarSyncState;
  presenceTick: number;

  friends: FriendEntry[];
  topPeers: TopPeerEntry[];
  pendingIn: string[];
  pendingOut: string[];
  muted: string[];
  blocked: string[];
  blockedBy: string[];
  pinned: string[];
  archived: string[];
  chatFolders: ChatFolderEntry[];
  pinnedMessages: Record<string, number[]>;
  pinnedMessageActive: Record<string, number>;
  pinnedBarHidden: Record<string, string>;
  pendingGroupInvites: ActionModalGroupInvite[];
  pendingGroupJoinRequests: ActionModalGroupJoinRequest[];
  pendingBoardInvites: ActionModalBoardInvite[];
  fileOffersIn: FileOfferIn[];
  fileTransfers: FileTransferEntry[];
  fileThumbs: Record<string, FileThumbEntry>;

  groups: GroupEntry[];
  boards: BoardEntry[];

  selected: TargetRef | null;
  conversations: Record<string, ChatMessage[]>;
  historySync: Record<string, ConversationHistorySyncState>;
  rosterSync: RosterSyncState;
  profileSync: Record<string, ProfileSyncState>;
  historyLoaded: Record<string, boolean>;
  historyPreviewOnly: Record<string, boolean>;
  historyCursor: Record<string, number>;
  historyHasMore: Record<string, boolean>;
  historyLoading: Record<string, boolean>;
  historyLoadingSlots: Record<string, number>;
  historyVirtualStart: Record<string, number>;
  lastRead: Record<string, LastReadMarker>;

  outbox: Record<string, OutboxEntry[]>;
  deliverySync: RuntimeDeliverySyncState;

  drafts: Record<string, string>;
  input: string;
  editing: EditingMessageState | null;
  replyDraft: MessageHelperDraft | null;
  forwardDraft: MessageHelperDraft | null;
  chatSelection: ChatSelectionState | null;
  boardComposerOpen: boolean;
  boardScheduledPosts: BoardScheduledPost[];

  chatSearchOpen: boolean;
  chatSearchResultsOpen: boolean;
  chatSearchQuery: string;
  chatSearchDate: string;
  chatSearchFilter: import("../helpers/chat/chatSearch").ChatSearchFilter;
  chatSearchHits: number[];
  chatSearchPos: number;
  chatSearchCounts: import("../helpers/chat/chatSearch").ChatSearchCounts;

  page: PageKind;
  rightPanel: TargetRef | null;
  userViewId: string | null;
  groupViewId: string | null;
  boardViewId: string | null;
  searchQuery: string;
  searchResults: SearchResultEntry[];
  groupCreateMessage: string;
  boardCreateMessage: string;
  profiles: Record<string, UserProfile>;
  profileDraftDisplayName: string;
  profileDraftHandle: string;
  profileDraftBio: string;
  profileDraftStatus: string;
  sessionDevices: SessionDeviceEntry[];
  sessionDevicesStatus: string | null;

  toast: ToastState | null;
  modal: ModalState | null;
  updateLatest: string | null;
  updateDismissedLatest: string | null;
  pwaUpdateAvailable: boolean;
  pwaUpdate: PwaUpdateRuntimeState;
  desktopUpdate: DesktopUpdateRuntimeState;
  pwaPushSupported: boolean;
  pwaPushPermission: "default" | "granted" | "denied";
  pwaPushSubscribed: boolean;
  pwaPushPublicKey: string | null;
  pwaPushStatus: string | null;
  pwaPushOptOut: boolean;

  notifyInAppEnabled: boolean;
  notifySoundEnabled: boolean;

  avatarsRev: number;
}
