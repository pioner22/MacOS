import { isVideoLikeFile as sharedIsVideoLikeFile } from "./mediaKind";

export function isVideoLikeFile(name: string, mime?: string | null): boolean {
  return sharedIsVideoLikeFile(name, mime);
}
