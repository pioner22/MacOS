import { el } from "../../helpers/dom/el";
import { layoutTelegramAlbum, RectPart } from "../../helpers/chat/telegramGroupedLayout";
import {
  applyVoicePlaybackRate,
  consumeVoiceAutoplay,
  cycleVoicePlaybackRate,
  getVoicePlaybackRate,
  releaseMediaFocus,
  takeMediaFocus,
} from "../../helpers/media/audioSession";
import { renderRichText } from "../../helpers/chat/richText";
import type { AppState } from "../../stores/types";
import { renderAttachmentFooterShell } from "./attachmentFooterShell";
import { renderMediaOverlayControls } from "./mediaOverlayControls";
import { renderMessageSelectionControl } from "./messageSelectionControl";
import { renderImagePreviewButton, renderVideoPreviewButton } from "./chatVisualPreviewSurface";
import { resolveHistoryMediaSlotSize } from "./chatVisualPreviewShared";
import { classifyAudioAttachment } from "../../helpers/files/audioAttachmentKind";
import {
  AlbumItem,
  avatar,
  buildMessageMeta,
  extractFileCaptionText,
  isEmojiOnlyText,
  renderMessageRef,
  renderReactions,
  resolveUserAccent,
  resolveUserHandle,
  resolveUserLabel,
} from "./renderChatHelpers";

type RenderDeferredVoicePlayerCtx = {
  mount: HTMLElement;
  opts: {
    url: string | null;
    fileId?: string | null;
    name?: string | null;
    size?: number | null;
    mime?: string | null;
    msgIdx?: number | null;
  };
};

type RenderDeferredAlbumLineCtx = {
  mount: HTMLElement;
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

function formatVoiceTime(valueSeconds: number): string {
  const raw = Number(valueSeconds);
  if (!Number.isFinite(raw) || raw <= 0) return "0:00";
  const total = Math.max(0, Math.round(raw));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatVoiceRate(value: number): string {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return "1x";
  if (Math.abs(raw - 1.5) < 0.01) return "1.5x";
  if (Math.abs(raw - 2) < 0.01) return "2x";
  return `${raw}x`;
}

function normalizeMountClassName(baseClassName: string, extraClass: string): string {
  const parts = new Set(
    `${baseClassName} ${extraClass}`
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
  );
  parts.delete("msg-album-loading");
  return [...parts].join(" ");
}

function renderVoicePlayer(opts: RenderDeferredVoicePlayerCtx["opts"]): HTMLElement {
  const url = opts.url;
  const audio = url ? (el("audio", { class: "chat-voice-audio", src: url, preload: "metadata" }) as HTMLAudioElement) : null;
  const playBtn = el("button", { class: "btn chat-voice-play", type: "button", "aria-label": "Воспроизвести" }, [""]);
  const bar = el("span", { class: "chat-voice-progress", "aria-hidden": "true" }, [""]);
  const track = el("button", { class: "btn chat-voice-track", type: "button", "aria-label": "Перемотка" }, [bar]);
  const time = el("div", { class: "chat-voice-time" }, ["0:00"]);
  const name = String(opts.name || "");
  const audioKind = classifyAudioAttachment(name, opts.mime);
  const voiceLike = audioKind === "voice";
  const speedBtn = voiceLike
    ? (el("button", { class: "btn chat-voice-speed", type: "button", "aria-label": "Скорость воспроизведения" }, [
        formatVoiceRate(getVoicePlaybackRate()),
      ]) as HTMLButtonElement)
    : null;
  const wrap = el("div", { class: `chat-voice${url ? "" : " chat-voice-placeholder"}`, "data-voice-state": "paused" }, [
    playBtn,
    track,
    time,
    ...(speedBtn ? [speedBtn] : []),
    ...(audio ? [audio] : []),
  ]);
  wrap.style.setProperty("--voice-progress", "0%");

  const fileId = String(opts.fileId || "").trim();
  if (fileId) {
    wrap.setAttribute("data-file-kind", "audio");
    wrap.setAttribute("data-audio-kind", audioKind);
    wrap.setAttribute("data-file-id", fileId);
    wrap.setAttribute("data-name", String(opts.name || ""));
    wrap.setAttribute("data-size", String(Number(opts.size || 0) || 0));
    if (opts.mime) wrap.setAttribute("data-mime", String(opts.mime));
    if (typeof opts.msgIdx === "number" && Number.isFinite(opts.msgIdx)) {
      wrap.setAttribute("data-msg-idx", String(Math.trunc(opts.msgIdx)));
    }
  }

  if (!audio) {
    track.setAttribute("disabled", "true");
    time.textContent = "—";
    if (!fileId) playBtn.setAttribute("disabled", "true");
    playBtn.setAttribute("aria-label", fileId ? "Загрузить и воспроизвести" : "Недоступно");
    if (speedBtn) {
      speedBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = cycleVoicePlaybackRate(getVoicePlaybackRate());
        speedBtn.textContent = formatVoiceRate(next);
      });
    }
    return wrap;
  }

  const canWireControls =
    typeof (playBtn as any).addEventListener === "function" &&
    typeof (track as any).addEventListener === "function" &&
    typeof (audio as any).addEventListener === "function" &&
    typeof (audio as any).play === "function" &&
    typeof (audio as any).pause === "function";
  if (!canWireControls) {
    playBtn.setAttribute("disabled", "true");
    track.setAttribute("disabled", "true");
    time.textContent = "—";
    return wrap;
  }

  let duration = 0;
  const setProgressPct = (pct: number) => {
    const safe = Math.max(0, Math.min(100, Math.round(pct)));
    wrap.style.setProperty("--voice-progress", `${safe}%`);
  };
  const setState = (state: "playing" | "paused") => {
    wrap.setAttribute("data-voice-state", state);
    playBtn.setAttribute("aria-label", state === "playing" ? "Пауза" : "Воспроизвести");
  };

  playBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (audio.paused) {
      takeMediaFocus(audio);
      if (voiceLike) applyVoicePlaybackRate(audio);
      setState("playing");
      void audio.play().catch(() => {
        releaseMediaFocus(audio);
        setState("paused");
      });
    } else {
      audio.pause();
      setState("paused");
    }
  });

  track.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    if (rect.width <= 0) return;
    const ratio = x / rect.width;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      audio.currentTime = Math.max(0, Math.min(duration, ratio * duration));
    } catch {
      // ignore
    }
  });

  if (speedBtn) {
    speedBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = cycleVoicePlaybackRate(audio.playbackRate || getVoicePlaybackRate());
      speedBtn.textContent = formatVoiceRate(next);
      try {
        audio.playbackRate = next;
      } catch {
        // ignore
      }
    });
  }

  audio.addEventListener("loadedmetadata", () => {
    duration = Number(audio.duration);
    if (Number.isFinite(duration) && duration > 0) {
      time.textContent = formatVoiceTime(duration);
      setProgressPct(0);
    }
    if (voiceLike) {
      applyVoicePlaybackRate(audio);
    } else {
      try {
        audio.playbackRate = 1;
      } catch {
        // ignore
      }
    }
  });
  audio.addEventListener("timeupdate", () => {
    const current = Number(audio.currentTime) || 0;
    if (Number.isFinite(duration) && duration > 0) {
      const pct = (current / duration) * 100;
      setProgressPct(pct);
      time.textContent = formatVoiceTime(Math.max(0, duration - current));
      return;
    }
    setProgressPct(0);
    time.textContent = formatVoiceTime(current);
  });
  audio.addEventListener("ended", () => {
    setProgressPct(0);
    if (Number.isFinite(duration) && duration > 0) time.textContent = formatVoiceTime(duration);
    releaseMediaFocus(audio);
    setState("paused");
  });
  audio.addEventListener("pause", () => {
    releaseMediaFocus(audio);
    setState("paused");
  });
  audio.addEventListener("error", () => {
    releaseMediaFocus(audio);
    setState("paused");
  });
  audio.addEventListener("play", () => {
    takeMediaFocus(audio);
    if (voiceLike) {
      applyVoicePlaybackRate(audio);
    } else {
      try {
        audio.playbackRate = 1;
      } catch {
        // ignore
      }
    }
    setState("playing");
    if (!Number.isFinite(duration) || duration <= 0) {
      time.textContent = formatVoiceTime(Number(audio.currentTime) || 0);
    }
  });

  if (fileId && consumeVoiceAutoplay(fileId)) {
    takeMediaFocus(audio);
    if (voiceLike) applyVoicePlaybackRate(audio);
    setState("playing");
    void audio.play().catch(() => {
      releaseMediaFocus(audio);
      setState("paused");
    });
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

export function renderDeferredVoicePlayerSurface(ctx: RenderDeferredVoicePlayerCtx) {
  ctx.mount.replaceChildren(renderVoicePlayer(ctx.opts));
}

export function renderDeferredAlbumLineSurface(ctx: RenderDeferredAlbumLineCtx) {
  const { mount, state, items, friendLabels } = ctx;
  if (!items.length) {
    mount.replaceChildren();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const fromId = String(first.msg.from || "").trim();
  const selfId = String(state.selfId || "").trim();
  const displayFromId = first.msg.kind === "out" ? selfId : fromId;
  const accentId = displayFromId;
  const resolvedLabel = displayFromId ? resolveUserLabel(state, displayFromId, friendLabels) : "";
  const fromLabel = resolvedLabel && resolvedLabel !== "—" ? resolvedLabel : first.msg.kind === "out" ? "Я" : "—";
  const fromHandle = displayFromId ? resolveUserHandle(state, displayFromId) : "";
  const showHandle = Boolean(fromHandle && !fromLabel.includes(fromHandle));
  const titleLabel = showHandle ? `${fromLabel} ${fromHandle}` : fromLabel;
  const showFrom = true;
  const canOpenProfile = Boolean(displayFromId);
  const albumCaption = (() => {
    let unique: string | null = null;
    for (const item of items) {
      const caption = extractFileCaptionText(item?.msg?.text);
      if (!caption) continue;
      if (unique === null) unique = caption;
      else if (unique !== caption) return "";
    }
    return unique ?? "";
  })();
  const bodyChildren: HTMLElement[] = [];
  if (showFrom) {
    const attrs = canOpenProfile
      ? {
          class: "msg-from msg-from-btn",
          type: "button",
          "data-action": "user-open",
          "data-user-id": displayFromId,
          title: `Профиль: ${titleLabel}`,
        }
      : { class: "msg-from" };
    const labelChildren = [el("span", { class: "msg-from-name" }, [fromLabel])];
    if (showHandle) labelChildren.push(el("span", { class: "msg-from-handle" }, [fromHandle]));
    const node = canOpenProfile ? el("button", attrs, labelChildren) : el("div", attrs, labelChildren);
    bodyChildren.push(node);
  }
  const ref = first.msg.reply || first.msg.forward;
  if (ref) {
    const kind = first.msg.reply ? "reply" : "forward";
    const refNode = renderMessageRef(state, ref, kind, friendLabels);
    if (refNode) bodyChildren.push(refNode);
  }

  const selectionMode = Boolean(ctx.opts?.selectionMode);
  const selected = Boolean(ctx.opts?.selected);
  const partial = Boolean(ctx.opts?.partial);
  const selectionIdx = typeof last.idx === "number" && Number.isFinite(last.idx) ? Math.trunc(last.idx) : null;
  let selectionBtnPlacedInGrid = false;
  const selectionBtn =
    selectionMode && selectionIdx !== null
      ? renderMessageSelectionControl({
          selectionIdx,
          selected,
          partial,
          groupStartIdx: ctx.opts?.groupStartIdx ?? null,
          groupEndIdx: ctx.opts?.groupEndIdx ?? null,
        })
      : null;

  const gridItems: HTMLElement[] = [];
  const hasCaption = Boolean(albumCaption);
  const emojiOnly = hasCaption ? isEmojiOnlyText(albumCaption) : false;
  const albumFileKind = items.every((item) => item && item.info && item.info.isVideo) ? "video" : "image";
  const layoutCfg = ctx.opts?.albumLayout ?? { maxWidth: 420, minWidth: 100, spacing: 1 };
  const sizes = items.map((item) => resolveHistoryMediaSlotSize(item.info));
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
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const viewerCaption = extractFileCaptionText(item.msg.text) || albumCaption;
    const preview = item.info.isImage
      ? renderImagePreviewButton(item.info, { className: "chat-file-preview-album", msgIdx: item.idx, caption: viewerCaption })
      : item.info.isVideo
        ? renderVideoPreviewButton(item.info, { className: "chat-file-preview-album", msgIdx: item.idx, caption: viewerCaption })
        : null;
    if (!preview) continue;
    const lay = layoutOk && layout ? layout.layout[index] : null;
    const style =
      lay && albumW && albumH
        ? `width: ${(lay.geometry.width / albumW) * 100}%; height: ${(lay.geometry.height / albumH) * 100}%; top: ${(lay.geometry.y / albumH) * 100}%; left: ${(lay.geometry.x / albumW) * 100}%;`
        : "";
    const wrap = el(
      "div",
      {
        class: "chat-album-item",
        "data-msg-idx": String(item.idx),
        ...albumEdgeAttrs(lay?.sides),
        ...(layoutOk && style ? { style } : {}),
      },
      [preview]
    );
    gridItems.push(wrap);
  }
  const grid = el("div", { class: layoutOk ? "chat-album-grid chat-album-grid-mosaic" : "chat-album-grid", "data-count": String(items.length) }, gridItems);
  if (layoutOk && albumW && albumH) {
    grid.style.width = `${Math.round(albumW)}px`;
    grid.style.height = `${Math.round(albumH)}px`;
  }
  if (selectionBtn) selectionBtnPlacedInGrid = true;
  const overlayControls = renderMediaOverlayControls({ selectionBtn });
  if (overlayControls) grid.append(overlayControls);
  const richCaptionNode = albumCaption
    ? el("div", { class: `msg-text msg-caption${emojiOnly ? " msg-emoji-only" : ""}` }, renderRichText(albumCaption))
    : null;
  const metaNode = el("div", { class: "msg-meta" }, buildMessageMeta(last.msg));
  const footerNode = renderAttachmentFooterShell({ caption: richCaptionNode, meta: metaNode, media: true });
  bodyChildren.push(el("div", { class: "chat-album-surface" }, [grid, footerNode]));
  const reacts = renderReactions(last.msg);
  if (reacts) bodyChildren.push(reacts);

  const lineChildren: HTMLElement[] = [];
  if (displayFromId) {
    const avatarNode = avatar("dm", displayFromId);
    if (canOpenProfile) {
      lineChildren.push(
        el("div", { class: "msg-avatar" }, [
          el(
            "button",
            { class: "msg-avatar-btn", type: "button", "data-action": "user-open", "data-user-id": displayFromId, title: `Профиль: ${titleLabel}` },
            [avatarNode]
          ),
        ])
      );
    } else {
      lineChildren.push(el("div", { class: "msg-avatar" }, [avatarNode]));
    }
  }
  const bodyNode = el("div", { class: "msg-body" }, bodyChildren);
  if (first.msg.kind === "out") {
    lineChildren.push(bodyNode);
    if (selectionBtn && !selectionBtnPlacedInGrid) lineChildren.push(selectionBtn);
  } else {
    if (selectionBtn && !selectionBtnPlacedInGrid) lineChildren.push(selectionBtn);
    lineChildren.push(bodyNode);
  }

  mount.className = normalizeMountClassName(mount.className, `msg msg-${first.msg.kind} msg-attach msg-album`);
  mount.replaceChildren(...lineChildren);
  mount.setAttribute("data-msg-kind", String(first.msg.kind || ""));
  mount.setAttribute("data-msg-attach", first.msg.attachment?.kind ? String(first.msg.attachment.kind) : "file");
  mount.setAttribute("data-msg-file", albumFileKind);
  mount.setAttribute("data-msg-album", "1");
  mount.setAttribute("data-msg-footer", "stacked");
  if (hasCaption) {
    mount.setAttribute("data-msg-has-text", "1");
    mount.setAttribute("data-msg-has-caption", "1");
  }
  if (emojiOnly) mount.setAttribute("data-msg-emoji-only", "1");
  if (reacts) mount.setAttribute("data-msg-has-reacts", "1");
  if (ref) {
    mount.setAttribute("data-msg-has-ref", "1");
    mount.setAttribute("data-msg-ref", first.msg.reply ? "reply" : "forward");
  }
  mount.setAttribute("data-msg-album-layout", layoutOk ? "mosaic" : "grid");
  if (layoutOk && albumW) mount.style.setProperty("--chat-album-shell-width", `${Math.round(albumW)}px`);
  if (layoutOk && albumW && albumH) mount.style.setProperty("--chat-album-shell-ratio", `${Math.round(albumW)} / ${Math.round(albumH)}`);
  const accent = resolveUserAccent(accentId);
  if (accent) {
    mount.style.setProperty("--msg-accent", accent);
    mount.style.setProperty("--msg-from-color", accent);
  }
}
