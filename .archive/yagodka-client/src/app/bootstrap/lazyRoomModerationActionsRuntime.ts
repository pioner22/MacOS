import type {
  RoomModerationActionsFeature,
  RoomModerationActionsFeatureDeps,
} from "../features/contextMenu/roomModerationActionsFeature";
import type { TargetRef } from "../../stores/types";
import { recoverFromLazyImportError } from "./lazyImportRecovery";

export function createLazyRoomModerationActionsRuntime(
  deps: RoomModerationActionsFeatureDeps
): RoomModerationActionsFeature {
  let runtime: RoomModerationActionsFeature | null = null;
  let runtimePromise: Promise<RoomModerationActionsFeature | null> | null = null;

  function loadRuntime(): Promise<RoomModerationActionsFeature | null> {
    if (runtime) return Promise.resolve(runtime);
    if (!runtimePromise) {
      runtimePromise = import("../features/contextMenu/roomModerationActionsFeature")
        .then(({ createRoomModerationActionsFeature }) => {
          const nextRuntime = createRoomModerationActionsFeature(deps);
          runtime = nextRuntime;
          runtimePromise = null;
          return nextRuntime;
        })
        .catch((err) => {
          recoverFromLazyImportError(err, "room_moderation_actions");
          runtimePromise = null;
          return null;
        });
    }
    return runtimePromise;
  }

  function callRuntime<K extends keyof RoomModerationActionsFeature>(
    key: K,
    args: Parameters<RoomModerationActionsFeature[K]>
  ) {
    void loadRuntime().then((loadedRuntime) => {
      const method = loadedRuntime?.[key];
      if (typeof method === "function") {
        (method as (...innerArgs: Parameters<RoomModerationActionsFeature[K]>) => void)(...args);
      }
    });
  }

  return {
    onRoomMemberRemove(kind: TargetRef["kind"], roomId: string, memberId: string) {
      callRuntime("onRoomMemberRemove", [kind, roomId, memberId]);
    },
    onBlockToggle(memberId: string) {
      callRuntime("onBlockToggle", [memberId]);
    },
    onRoomWriteToggle(kind: TargetRef["kind"], roomId: string, memberId: string, value: boolean) {
      callRuntime("onRoomWriteToggle", [kind, roomId, memberId, value]);
    },
    onRoomRefresh(kind: TargetRef["kind"], roomId: string) {
      callRuntime("onRoomRefresh", [kind, roomId]);
    },
    onRoomInfoSave(kind: TargetRef["kind"], roomId: string, description: string, rules: string) {
      callRuntime("onRoomInfoSave", [kind, roomId, description, rules]);
    },
    onRoomLeave(kind: TargetRef["kind"], roomId: string) {
      callRuntime("onRoomLeave", [kind, roomId]);
    },
    onRoomDisband(kind: TargetRef["kind"], roomId: string) {
      callRuntime("onRoomDisband", [kind, roomId]);
    },
  };
}
