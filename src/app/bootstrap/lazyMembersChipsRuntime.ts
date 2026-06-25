import { normalizeMemberToken, type MemberTokenStatus } from "../../helpers/members/memberTokens";
import { resolveMemberTokensForSubmit, type ResolveMemberTokensResult } from "../../helpers/members/resolveMemberTokens";
import { parseMembersInput } from "../features/members/membersInputShared";
import type { CreateMembersScope, MembersChipsFeature, MembersChipsFeatureDeps } from "../features/members/membersChipsFeature";
import { scheduleDeferredTask } from "./scheduleDeferredTask";

type DeferredMembersCall =
  | { kind: "clearMembersAddLookups"; args: [] }
  | { kind: "resetCreateMembers"; args: [CreateMembersScope] }
  | { kind: "renderMembersAddChips"; args: [] }
  | { kind: "drainMembersAddLookups"; args: [] }
  | { kind: "drainCreateMembersLookups"; args: [CreateMembersScope] }
  | { kind: "consumeMembersAddEntry"; args: [boolean] }
  | { kind: "consumeCreateMembersEntry"; args: [CreateMembersScope, boolean] };

function invokeMembersCall(feature: MembersChipsFeature, call: DeferredMembersCall): void {
  switch (call.kind) {
    case "clearMembersAddLookups":
      feature.clearMembersAddLookups();
      break;
    case "resetCreateMembers":
      feature.resetCreateMembers(...call.args);
      break;
    case "renderMembersAddChips":
      feature.renderMembersAddChips();
      break;
    case "drainMembersAddLookups":
      feature.drainMembersAddLookups();
      break;
    case "drainCreateMembersLookups":
      feature.drainCreateMembersLookups(...call.args);
      break;
    case "consumeMembersAddEntry":
      feature.consumeMembersAddEntry(...call.args);
      break;
    case "consumeCreateMembersEntry":
      feature.consumeCreateMembersEntry(...call.args);
      break;
  }
}

function membersDom(scope: "members_add" | CreateMembersScope): {
  entry: HTMLInputElement;
  hidden: HTMLInputElement;
} | null {
  if (scope === "members_add") {
    const entry = document.getElementById("members-add-entry") as HTMLInputElement | null;
    const hidden = document.getElementById("members-add-input") as HTMLInputElement | null;
    if (!entry || !hidden) return null;
    return { entry, hidden };
  }
  const base = scope === "group_create" ? "group-members" : "board-members";
  const entry = document.getElementById(`${base}-entry`) as HTMLInputElement | null;
  const hidden = document.getElementById(base) as HTMLInputElement | null;
  if (!entry || !hidden) return null;
  return { entry, hidden };
}

function normalizedDomTokens(scope: "members_add" | CreateMembersScope): string[] {
  const dom = membersDom(scope);
  if (!dom) return [];
  return Array.from(new Set(parseMembersInput(dom.hidden.value)));
}

function commitEntryTokens(scope: "members_add" | CreateMembersScope, forceAll: boolean): void {
  if (!forceAll) return;
  const dom = membersDom(scope);
  if (!dom) return;
  const current = new Set(normalizedDomTokens(scope));
  for (const raw of parseMembersInput(dom.entry.value)) {
    const normalized = normalizeMemberToken(raw);
    if (!normalized) continue;
    current.add(normalized.value);
  }
  dom.hidden.value = Array.from(current).join(" ");
  dom.entry.value = "";
}

function resolveFallbackTokens(tokens: string[]): ResolveMemberTokensResult {
  const statusByToken = new Map<string, MemberTokenStatus>();
  for (const token of tokens) {
    const normalized = normalizeMemberToken(token);
    if (!normalized || normalized.kind === "invalid") {
      statusByToken.set(token, "invalid");
      continue;
    }
    statusByToken.set(token, normalized.kind === "id" ? "ok" : "pending");
  }
  return resolveMemberTokensForSubmit({
    tokens,
    statusByToken,
    handleToId: new Map<string, string>(),
  });
}

export function createLazyMembersChipsRuntime(
  deps: MembersChipsFeatureDeps
): MembersChipsFeature & { startDeferredBoot: () => void } {
  let featureImpl: MembersChipsFeature | null = null;
  let featurePromise: Promise<MembersChipsFeature | null> | null = null;
  let listenersInstalled = false;
  let bootStarted = false;
  const pendingCalls: DeferredMembersCall[] = [];

  function flushPendingCalls(feature: MembersChipsFeature): void {
    const queue = pendingCalls.splice(0);
    for (const call of queue) invokeMembersCall(feature, call);
  }

  function ensureFeatureLoaded(): Promise<MembersChipsFeature | null> {
    if (featureImpl) return Promise.resolve(featureImpl);
    if (!featurePromise) {
      featurePromise = import("../features/members/membersChipsFeature")
        .then(({ createMembersChipsFeature }) => {
          const feature = createMembersChipsFeature(deps);
          featureImpl = feature;
          if (listenersInstalled) feature.installEventListeners();
          flushPendingCalls(feature);
          featurePromise = null;
          return feature;
        })
        .catch(() => {
          featurePromise = null;
          return null;
        });
    }
    return featurePromise;
  }

  function queueCall(call: DeferredMembersCall): void {
    if (featureImpl) {
      invokeMembersCall(featureImpl, call);
      return;
    }
    pendingCalls.push(call);
    startDeferredBoot();
    void ensureFeatureLoaded();
  }

  function startDeferredBoot(): void {
    if (bootStarted) return;
    bootStarted = true;
    scheduleDeferredTask(() => {
      void ensureFeatureLoaded().catch(() => {});
    });
  }

  return {
    startDeferredBoot,
    installEventListeners() {
      if (listenersInstalled) return;
      listenersInstalled = true;
      startDeferredBoot();
      if (featureImpl) featureImpl.installEventListeners();
    },
    dispose() {
      pendingCalls.length = 0;
      featureImpl?.dispose();
      listenersInstalled = false;
    },
    handleSearchResultMessage(msg) {
      if (featureImpl) return featureImpl.handleSearchResultMessage(msg);
      return false;
    },
    clearMembersAddLookups() {
      queueCall({ kind: "clearMembersAddLookups", args: [] });
    },
    resetCreateMembers(scope) {
      queueCall({ kind: "resetCreateMembers", args: [scope] });
    },
    renderMembersAddChips() {
      queueCall({ kind: "renderMembersAddChips", args: [] });
    },
    drainMembersAddLookups() {
      queueCall({ kind: "drainMembersAddLookups", args: [] });
    },
    drainCreateMembersLookups(scope) {
      queueCall({ kind: "drainCreateMembersLookups", args: [scope] });
    },
    consumeMembersAddEntry(forceAll) {
      if (!featureImpl) commitEntryTokens("members_add", forceAll);
      queueCall({ kind: "consumeMembersAddEntry", args: [forceAll] });
    },
    consumeCreateMembersEntry(scope, forceAll) {
      if (!featureImpl) commitEntryTokens(scope, forceAll);
      queueCall({ kind: "consumeCreateMembersEntry", args: [scope, forceAll] });
    },
    getMembersAddTokens() {
      return featureImpl?.getMembersAddTokens() ?? normalizedDomTokens("members_add");
    },
    getCreateMembersTokens(scope) {
      return featureImpl?.getCreateMembersTokens(scope) ?? normalizedDomTokens(scope);
    },
    resolveMembersAddTokensForSubmit(tokens) {
      return featureImpl?.resolveMembersAddTokensForSubmit(tokens) ?? resolveFallbackTokens(tokens);
    },
    resolveCreateMembersTokensForSubmit(scope, tokens) {
      return featureImpl?.resolveCreateMembersTokensForSubmit(scope, tokens) ?? resolveFallbackTokens(tokens);
    },
  };
}
