import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const shouldMinifyBuild = process.env.YAGODKA_WEB_MINIFY !== "0";
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

function loadAndroidAppVersionMeta(): { versionName: string; versionCode: number } {
  const gradlePath = path.join(ROOT_DIR, "android", "app", "build.gradle");
  try {
    const raw = fs.readFileSync(gradlePath, "utf8");
    const versionNameMatch = raw.match(/versionName\s+"([^"]+)"/);
    const versionCodeMatch = raw.match(/versionCode\s+(\d+)/);
    const versionName = versionNameMatch?.[1]?.trim() || "";
    const versionCode = Number(versionCodeMatch?.[1] ?? 0);
    if (!versionName || !Number.isFinite(versionCode) || versionCode <= 0) {
      return { versionName: "", versionCode: 0 };
    }
    return { versionName, versionCode: Math.trunc(versionCode) };
  } catch {
    return { versionName: "", versionCode: 0 };
  }
}

const androidAppVersionMeta = loadAndroidAppVersionMeta();

function resolveAppChunk(cleanId: string): string | undefined {
  if (cleanId.includes("/src/app/handleServerMessage")) return "app-handle-server-message";
  if (cleanId.includes("/src/app/renderApp")) return "app-render";
  if (cleanId.includes("/src/app/features/files/") || cleanId.includes("/src/app/features/media/")) return "app-files";
  if (cleanId.includes("/src/app/features/emoji/")) return "app-emoji";
          if (
            cleanId.includes("/src/app/features/contextMenu/contextMenuActionsFeature") ||
            cleanId.includes("/src/app/features/contextMenu/roomModerationActionsFeature")
          ) {
            return "app-context-actions";
          }
          if (cleanId.includes("/src/app/features/navigation/chatSurfaceDeferredActions.ts")) {
            return "app-chat-surface-secondary";
          }
          if (cleanId.includes("/src/app/features/navigation/chatSurfaceMediaActions.ts")) {
            return "app-chat-surface-media";
          }
          if (cleanId.includes("/src/app/features/navigation/chatHostDeferredEvents.ts")) {
            return "app-chat-host-deferred";
          }
          if (
            cleanId.includes("/src/app/features/search/chatSearchUiFeature.ts") ||
            cleanId.includes("/src/app/features/members/membersChipsFeature.ts")
          ) {
            return "app-search-members-ui";
          }
          if (
            cleanId.includes("/src/app/features/hotkeys/") ||
            cleanId.includes("/src/app/features/navigation/sidebarChatContextInteractionsFeature.ts") ||
            cleanId.includes("/src/app/features/profile/profileActionsFeature.ts") ||
            cleanId.includes("/src/app/features/search/searchInputActionsFeature.ts") ||
            cleanId.includes("/src/app/features/search/searchHistoryActionsFeature.ts") ||
            cleanId.includes("/src/app/features/search/searchShareFormatters.ts") ||
            cleanId.includes("/src/app/features/pwa/notifyActionsFeature.ts") ||
            cleanId.includes("/src/app/features/sidebar/sidebarClickSuppressionFeature.ts") ||
            cleanId.includes("/src/app/features/sidebar/sidebarContextMenuScrollFeature.ts") ||
            cleanId.includes("/src/app/features/sidebar/sidebarKeyboardContextMenuFeature.ts") ||
            cleanId.includes("/src/app/features/sidebar/sidebarLongPressContextMenuFeature.ts") ||
            cleanId.includes("/src/app/features/sidebar/sidebarMouseContextMenuFeature.ts") ||
            cleanId.includes("/src/app/features/sidebar/sidebarSwipeTabsFeature.ts") ||
            cleanId.includes("/src/app/features/contextMenu/chatLongPressContextMenuFeature.ts") ||
            cleanId.includes("/src/app/features/contextMenu/chatMouseContextMenuFeature.ts") ||
            cleanId.includes("/src/app/features/contextMenu/chatReplySwipeFeature.ts") ||
            cleanId.includes("/src/app/features/history/chatSelectionDragFeature.ts")
          ) {
            return "app-nav-deferred";
          }
          if (
            cleanId.includes("/src/app/features/history/") ||
            cleanId.includes("/src/app/features/outbox/") ||
            cleanId.includes("/src/app/features/persistence/")
          ) {
    return "app-history";
  }
  if (
    cleanId.includes("/src/app/features/navigation/") ||
    cleanId.includes("/src/app/features/sidebar/") ||
    cleanId.includes("/src/app/features/search/") ||
    cleanId.includes("/src/app/features/members/") ||
    cleanId.includes("/src/app/features/avatar/") ||
    cleanId.includes("/src/app/features/auth/") ||
    cleanId.includes("/src/app/features/profile/") ||
    cleanId.includes("/src/app/features/hotkeys/") ||
    cleanId.includes("/src/app/features/contextMenu/") ||
    cleanId.includes("/src/app/features/ui/")
  ) {
    return "app-navigation";
  }
  if (cleanId.includes("/src/app/features/pwa/")) return "app-pwa";
  if (cleanId.includes("/src/app/features/calls/") || cleanId.includes("/src/app/features/net/")) return "app-realtime";
  if (cleanId.includes("/src/app/features/debug/")) return "app-debug";
  return undefined;
}

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
    __ANDROID_APP_VERSION_NAME__: JSON.stringify(androidAppVersionMeta.versionName),
    __ANDROID_APP_VERSION_CODE__: String(androidAppVersionMeta.versionCode || 0),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    minify: shouldMinifyBuild ? "esbuild" : false,
    cssMinify: shouldMinifyBuild,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const cleanId = id.replace(/\\/g, "/");
          if (cleanId.includes("/src/config/changelog/") || cleanId.includes("/src/config/changelog.ts")) return "page-help";
          if (cleanId.includes("/src/helpers/runtime/nativeRuntime.ts")) return "boot-config";
          if (cleanId.includes("/src/config/app.ts") || cleanId.includes("/src/config/env.ts")) return "boot-config";
          if (
            cleanId.includes("/src/helpers/skin/skin.ts") ||
            cleanId.includes("/src/helpers/theme/theme.ts") ||
            cleanId.includes("/src/helpers/ui/chromeColors.ts") ||
            cleanId.includes("/src/helpers/ui/iosInputAssistant.ts") ||
            cleanId.includes("/src/helpers/ui/appViewport.ts") ||
            cleanId.includes("/src/helpers/ui/fancyCaret.ts") ||
            cleanId.includes("/src/helpers/ui/environmentAgent.ts")
          ) {
            return "boot-helpers";
          }
          if (cleanId.includes("/src/helpers/pwa/registerServiceWorker.ts")) return "boot-pwa";
          if (
            cleanId.includes("/src/helpers/ui/emojiCatalog") ||
            cleanId.includes("/src/helpers/ui/emoji.ts") ||
            cleanId.includes("/src/helpers/ui/emojiShared")
          ) {
            return "app-emoji";
          }
          if (
            cleanId.includes("/src/helpers/chat/historyIdb.ts") ||
            cleanId.includes("/src/helpers/chat/historyCache.ts") ||
            cleanId.includes("/src/helpers/chat/historyCachePrefs.ts") ||
            cleanId.includes("/src/helpers/files/fileTransferHistory.ts")
          ) {
            return "helper-history-storage";
          }
          if (cleanId.includes("/src/helpers/notify/tabNotifier.ts")) return "helper-notify";
          if (
            cleanId.includes("/src/components/sidebar/renderSidebarMobile.ts")
          ) {
            return "sidebar-mobile";
          }
          if (cleanId.includes("/src/components/sidebar/renderSidebarMenuSurface.ts")) {
            return "sidebar-menu";
          }
          if (cleanId.includes("/src/components/sidebar/renderSidebarDesktopTabsSurface.ts")) {
            return "sidebar-desktop-tabs";
          }
          if (cleanId.includes("/src/components/sidebar/renderSidebarStandalone.ts")) {
            return "sidebar-standalone";
          }
          if (
            cleanId.includes("/src/components/modals/renderHeavyModal.ts") ||
            cleanId.includes("/src/components/modals/renderForwardModal.ts") ||
            cleanId.includes("/src/components/modals/renderFileViewerModal.ts") ||
            cleanId.includes("/src/components/modals/viewerFooterShell.ts")
          ) {
            return "modal-heavy";
          }
          if (
            cleanId.includes("/src/components/modals/renderSecondaryModal.ts") ||
            cleanId.includes("/src/components/modals/renderMembersAddModal.ts") ||
            cleanId.includes("/src/components/modals/renderMembersRemoveModal.ts") ||
            cleanId.includes("/src/components/modals/renderRenameModal.ts") ||
            cleanId.includes("/src/components/modals/renderFileSendModal.ts") ||
            cleanId.includes("/src/components/modals/renderInviteUserModal.ts") ||
            cleanId.includes("/src/components/modals/renderActionModal.ts") ||
            cleanId.includes("/src/components/modals/renderBoardPostModal.ts") ||
            cleanId.includes("/src/components/modals/renderSendScheduleModal.ts") ||
            cleanId.includes("/src/components/modals/renderReactionsModal.ts")
          ) {
            return "modal-secondary";
          }
          if (
            cleanId.includes("/src/components/chat/chatAuxSurface.ts") ||
            cleanId.includes("/src/components/chat/chatPinnedSurface.ts")
          ) {
            return "chat-aux-surface";
          }
          if (cleanId.includes("/src/components/chat/chatDeferredMediaSurface.ts")) {
            return "chat-media-surface";
          }
          if (cleanId.includes("/src/components/chat/chatSpecialMessageSurface.ts")) {
            return "chat-special-message-surface";
          }
          if (cleanId.includes("/src/components/chat/chatVisualPreviewSurface.ts")) {
            return "chat-visual-preview-surface";
          }
          if (cleanId.includes("/src/components/modals/call/createCallModal.ts")) return "modal-call";
          if (cleanId.includes("/src/helpers/ui/debugHud")) return "app-debug";
          if (
            cleanId.includes("/src/helpers/pwa/installPrompt") ||
            cleanId.includes("/src/helpers/pwa/shouldReloadForBuild")
          ) {
            return "app-pwa";
          }
          if (cleanId.includes("node_modules")) return "vendor";
          if (cleanId.includes("/src/config/")) return "config";
          if (cleanId.includes("/src/pages/help/")) return "page-help";
          if (cleanId.includes("/src/pages/search/")) return "page-search";
          if (cleanId.includes("/src/pages/profile/")) return "page-profile";
          if (cleanId.includes("/src/pages/user/")) return "page-user";
          if (cleanId.includes("/src/pages/room/")) return "page-room";
          if (cleanId.includes("/src/pages/files/")) return "page-files";
          if (cleanId.includes("/src/pages/create/")) return "page-create";
          if (cleanId.includes("/src/pages/")) return "pages";
          if (cleanId.includes("/src/components/")) return "components";
          if (cleanId.includes("/src/helpers/")) return "helpers";
          if (cleanId.includes("/src/stores/")) return "stores";
          const appChunk = resolveAppChunk(cleanId);
          if (appChunk) return appChunk;
          return undefined;
        },
      },
    },
  },
});
