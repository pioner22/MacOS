import { el } from "../../helpers/dom/el";
import type { AppState } from "../../stores/types";
import type { AlbumItem } from "./renderChatHelpers";
import { recoverFromLazyImportError } from "../../app/bootstrap/lazyImportRecovery";
import { layoutTelegramAlbum, RectPart } from "../../helpers/chat/telegramGroupedLayout";
import { resolveHistoryMediaSlotSize } from "./chatVisualPreviewShared";

type ChatDeferredMediaModule = typeof import("./chatDeferredMediaSurface");

export type RenderDeferredVoicePlayerOptions = {
  url: string | null;
  fileId?: string | null;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
  msgIdx?: number | null;
};

export type RenderDeferredAlbumLineOptions = {
  state: AppState;
  items: AlbumItem[];
  friendLabels?: Map<string, string>;
  opts?: {
    selectionMode?: boolean;
    selected?: boolean;
    partial?: boolean;
    groupStartIdx?: number;
    groupEndIdx?: number;
    albumLayout?: { maxWidth: number; minWidth: number; spacing: number };
  };
};

type RenderDeferredVoicePlayerCtx = {
  mount: HTMLElement;
  opts: RenderDeferredVoicePlayerOptions;
};

type RenderDeferredAlbumLineCtx = RenderDeferredAlbumLineOptions & {
  mount: HTMLElement;
};

type AlbumPlaceholderGeometry = {
  albumFileKind: "image" | "video";
  albumW: number | null;
  albumH: number | null;
  layout: ReturnType<typeof layoutTelegramAlbum> | null;
  layoutOk: boolean;
};

let deferredMediaModule: ChatDeferredMediaModule | null = null;
let deferredMediaPromise: Promise<ChatDeferredMediaModule> | null = null;
let deferredMediaLoadFailed = false;
let deferredMediaRecovering = false;

function canRenderMount(mount: HTMLElement | null): mount is HTMLElement {
  if (!mount) return false;
  return (mount as HTMLElement & { isConnected?: boolean }).isConnected !== false;
}

function ensureDeferredMediaModule() {
  if (deferredMediaModule) return Promise.resolve(deferredMediaModule);
  if (deferredMediaPromise) return deferredMediaPromise;
  deferredMediaPromise = import("./chatDeferredMediaSurface")
    .then((mod: ChatDeferredMediaModule) => {
      deferredMediaModule = mod;
      deferredMediaLoadFailed = false;
      deferredMediaRecovering = false;
      return mod;
    })
    .catch((err) => {
      deferredMediaLoadFailed = true;
      deferredMediaRecovering = recoverFromLazyImportError(err, "chat_deferred_media");
      deferredMediaPromise = null;
      throw err;
    })
    .finally(() => {
      if (deferredMediaModule) deferredMediaPromise = null;
    });
  return deferredMediaPromise;
}

function renderDeferredVoicePlaceholder(opts: RenderDeferredVoicePlayerOptions, message: string) {
  const track = el("button", { class: "btn chat-voice-track", type: "button", "aria-label": "Перемотка", disabled: "true" }, [
    el("span", { class: "chat-voice-progress", "aria-hidden": "true" }, [""]),
  ]);
  const wrap = el(
    "div",
    {
      class: "chat-voice chat-voice-placeholder chat-voice-loading",
      "data-voice-state": "paused",
      role: "status",
      "aria-live": "polite",
    },
    [
      el("button", { class: "btn chat-voice-play", type: "button", "aria-label": message, disabled: "true" }, [""]),
      track,
      el("div", { class: "chat-voice-time" }, ["—"]),
      el("button", { class: "btn chat-voice-speed", type: "button", "aria-hidden": "true", tabindex: "-1", disabled: "true" }, ["1x"]),
    ]
  );
  wrap.style.setProperty("--voice-progress", "0%");
  if (String(opts.fileId || "").trim()) {
    wrap.setAttribute("data-file-kind", "audio");
    wrap.setAttribute("data-file-id", String(opts.fileId || "").trim());
  }
  return wrap;
}

function albumEdgeAttrs(sides?: number | null): Record<string, string | undefined> {
  const mask = typeof sides === "number" && Number.isFinite(sides) ? sides : 0;
  return {
    "data-album-edge-top": mask & RectPart.Top ? "1" : undefined,
    "data-album-edge-right": mask & RectPart.Right ? "1" : undefined,
    "data-album-edge-bottom": mask & RectPart.Bottom ? "1" : undefined,
    "data-album-edge-left": mask & RectPart.Left ? "1" : undefined,
  };
}

function resolveAlbumPlaceholderGeometry(options: RenderDeferredAlbumLineOptions): AlbumPlaceholderGeometry {
  const items = Array.isArray(options.items) ? options.items : [];
  const layoutCfg = options.opts?.albumLayout ?? { maxWidth: 420, minWidth: 100, spacing: 1 };
  const sizes = items.map((item) => {
    return item?.info ? resolveHistoryMediaSlotSize(item.info) : { w: 1000, h: 1000 };
  });
  const albumFileKind = items.length && items.every((item) => item?.info?.isVideo) ? "video" : "image";
  const layout = (() => {
    try {
      return layoutTelegramAlbum(sizes, layoutCfg);
    } catch {
      return null;
    }
  })();
  const albumW = layout && Number.isFinite(layout.width) && layout.width > 0 ? layout.width : null;
  const albumH = layout && Number.isFinite(layout.height) && layout.height > 0 ? layout.height : null;
  const layoutOk = Boolean(albumW && albumH && layout && Array.isArray(layout.layout) && layout.layout.length === items.length);
  return { albumFileKind, albumW, albumH, layout, layoutOk };
}

function renderDeferredAlbumPlaceholder(options: RenderDeferredAlbumLineOptions, message: string) {
  const geometry = resolveAlbumPlaceholderGeometry(options);
  const gridItems = options.items.map((item, index) => {
    const lay = geometry.layoutOk && geometry.layout ? geometry.layout.layout[index] : null;
    const style =
      lay && geometry.albumW && geometry.albumH
        ? `width: ${(lay.geometry.width / geometry.albumW) * 100}%; height: ${(lay.geometry.height / geometry.albumH) * 100}%; top: ${(lay.geometry.y / geometry.albumH) * 100}%; left: ${(lay.geometry.x / geometry.albumW) * 100}%;`
        : "";
    const fileKind = item?.info?.isVideo ? "video" : "image";
    return el(
      "div",
      {
        class: "chat-album-item chat-album-placeholder-item",
        "data-msg-idx": String(item?.idx ?? index),
        ...albumEdgeAttrs(lay?.sides),
        ...(style ? { style } : {}),
      },
      [
        el("div", { class: "chat-file-preview chat-file-preview-album chat-file-preview-empty chat-file-preview-loading", "data-file-kind": fileKind }, [
          el("span", { class: "chat-file-placeholder", "aria-hidden": "true" }, [""]),
        ]),
      ]
    );
  });
  const grid = el(
    "div",
    {
      class: geometry.layoutOk ? "chat-album-grid chat-album-grid-mosaic chat-album-grid-loading" : "chat-album-grid chat-album-grid-loading",
      "data-count": String(Math.max(1, options.items.length)),
    },
    gridItems
  );
  if (geometry.layoutOk && geometry.albumW && geometry.albumH) {
    grid.style.width = `${Math.round(geometry.albumW)}px`;
    grid.style.height = `${Math.round(geometry.albumH)}px`;
  }
  return [
    el("div", { class: "msg-avatar" }, [el("span", { class: "avatar avatar-skel", "aria-hidden": "true" }, [""])]),
    el("div", { class: "msg-body" }, [
      el("div", { class: "msg-from msg-from-placeholder", "aria-hidden": "true" }, [el("span", { class: "msg-from-name" }, [""])]),
      el("div", { class: "chat-album-surface chat-album-surface-loading", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
        grid,
        el("div", { class: "msg-attach-footer msg-attach-footer-media msg-attach-footer-meta-only chat-album-footer-loading" }, [
          el("div", { class: "msg-meta chat-album-loading-meta", title: message }, [""]),
        ]),
      ]),
    ]),
  ];
}

export function renderDeferredVoicePlayer(opts: RenderDeferredVoicePlayerOptions): HTMLElement {
  const mount = el("div", { class: "chat-deferred-media-mount chat-deferred-voice-mount" });
  const ctx: RenderDeferredVoicePlayerCtx = { mount, opts };
  if (deferredMediaModule) {
    deferredMediaModule.renderDeferredVoicePlayerSurface(ctx);
    return mount;
  }
  mount.replaceChildren(
    renderDeferredVoicePlaceholder(
      opts,
      deferredMediaRecovering ? "Обновляем приложение..." : deferredMediaLoadFailed ? "Не удалось загрузить аудио" : "Загрузка аудио..."
    )
  );
  void ensureDeferredMediaModule()
    .then((mod) => {
      if (!canRenderMount(mount)) return;
      mod.renderDeferredVoicePlayerSurface(ctx);
    })
    .catch(() => {
      if (!canRenderMount(mount)) return;
      mount.replaceChildren(renderDeferredVoicePlaceholder(opts, deferredMediaRecovering ? "Обновляем приложение..." : "Не удалось загрузить аудио"));
    });
  return mount;
}

export function renderDeferredAlbumLine(options: RenderDeferredAlbumLineOptions): HTMLElement {
  const first = options.items[0];
  const kind = String(first?.msg?.kind || "in");
  const mount = el("div", { class: `msg msg-${kind} msg-attach msg-album msg-album-loading` });
  const ctx: RenderDeferredAlbumLineCtx = { mount, ...options };
  const geometry = resolveAlbumPlaceholderGeometry(options);
  mount.setAttribute("data-msg-kind", kind);
  mount.setAttribute("data-msg-attach", first?.msg?.attachment?.kind ? String(first.msg.attachment.kind) : "file");
  mount.setAttribute("data-msg-file", geometry.albumFileKind);
  mount.setAttribute("data-msg-album", "1");
  mount.setAttribute("data-msg-footer", "stacked");
  mount.setAttribute("data-msg-album-layout", geometry.layoutOk ? "mosaic" : "grid");
  if (geometry.layoutOk && geometry.albumW) mount.style.setProperty("--chat-album-shell-width", `${Math.round(geometry.albumW)}px`);
  if (geometry.layoutOk && geometry.albumW && geometry.albumH) {
    mount.style.setProperty("--chat-album-shell-ratio", `${Math.round(geometry.albumW)} / ${Math.round(geometry.albumH)}`);
  }
  if (deferredMediaModule) {
    deferredMediaModule.renderDeferredAlbumLineSurface(ctx);
    return mount;
  }
  mount.replaceChildren(
    ...renderDeferredAlbumPlaceholder(
      options,
      deferredMediaRecovering ? "Обновляем приложение..." : deferredMediaLoadFailed ? "Не удалось загрузить альбом" : "Загрузка альбома..."
    )
  );
  void ensureDeferredMediaModule()
    .then((mod) => {
      if (!canRenderMount(mount)) return;
      mod.renderDeferredAlbumLineSurface(ctx);
    })
    .catch(() => {
      if (!canRenderMount(mount)) return;
      mount.replaceChildren(
        ...renderDeferredAlbumPlaceholder(options, deferredMediaRecovering ? "Обновляем приложение..." : "Не удалось загрузить альбом")
      );
    });
  return mount;
}
