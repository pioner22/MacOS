import type { PwaUpdateDecision, PwaUpdateRuntimeState, PwaUpdateStage } from "../../stores/types";

export const PWA_UPDATE_STAGE_PROGRESS: Record<PwaUpdateStage, number> = {
  idle: 0,
  available: 16,
  checking: 30,
  downloading: 52,
  applying: 74,
  verifying: 90,
  done: 100,
  error: 100,
};

export type PwaUpdateStatePatch = {
  buildId?: string | null;
  message?: string;
  detail?: string;
  progress?: number;
  error?: string | null;
  userDecision?: PwaUpdateDecision;
  updatedAt?: number | null;
};

export function createPwaUpdateState(stage: PwaUpdateStage = "idle", patch: PwaUpdateStatePatch = {}): PwaUpdateRuntimeState {
  return {
    stage,
    buildId: patch.buildId ?? null,
    message: patch.message ?? "",
    detail: patch.detail ?? "",
    progress: patch.progress ?? PWA_UPDATE_STAGE_PROGRESS[stage],
    error: patch.error ?? null,
    userDecision: patch.userDecision ?? null,
    updatedAt: patch.updatedAt ?? (stage === "idle" ? null : Date.now()),
  };
}

export function mergePwaUpdateState(
  prev: PwaUpdateRuntimeState | undefined | null,
  stage: PwaUpdateStage,
  patch: PwaUpdateStatePatch = {}
): PwaUpdateRuntimeState {
  const base = prev ?? createPwaUpdateState();
  return {
    ...base,
    stage,
    buildId: Object.prototype.hasOwnProperty.call(patch, "buildId") ? (patch.buildId ?? null) : base.buildId,
    message: Object.prototype.hasOwnProperty.call(patch, "message") ? (patch.message ?? "") : base.message,
    detail: Object.prototype.hasOwnProperty.call(patch, "detail") ? (patch.detail ?? "") : base.detail,
    progress: patch.progress ?? PWA_UPDATE_STAGE_PROGRESS[stage],
    error: Object.prototype.hasOwnProperty.call(patch, "error") ? (patch.error ?? null) : base.error,
    userDecision: Object.prototype.hasOwnProperty.call(patch, "userDecision") ? (patch.userDecision ?? null) : base.userDecision,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
}

export function isPwaUpdateBusy(stage: PwaUpdateStage): boolean {
  return stage === "checking" || stage === "downloading" || stage === "applying" || stage === "verifying";
}
