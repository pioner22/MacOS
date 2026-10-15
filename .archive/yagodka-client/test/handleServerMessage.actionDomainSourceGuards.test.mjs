import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readSrc(relPath) {
  return await readFile(path.resolve(relPath), "utf8");
}

test("handleServerMessage: action/invite conversation domain is delegated to a dedicated module", async () => {
  const mainSrc = await readSrc("src/app/handleServerMessage.ts");
  const actionSrc = await readSrc("src/app/handleServerMessage/actionDomain.ts");

  assert.match(mainSrc, /import \{ handleActionConversationMessage \} from "\.\/handleServerMessage\/actionDomain"/);
  assert.match(mainSrc, /if \(handleActionConversationMessage\(t, msg, state, patch\)\) return;/);

  for (const event of [
    "authz_pending",
    "authz_request",
    "authz_request_result",
    "authz_response_result",
    "authz_cancel_result",
    "authz_accepted",
    "authz_declined",
    "authz_cancelled",
    "group_invite",
    "group_invite_response_result",
    "group_join_request",
    "board_invite",
    "board_invite_response_result",
  ]) {
    const escaped = event.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(mainSrc, new RegExp(`if \\(t === "${escaped}"\\)`));
    assert.match(actionSrc, new RegExp(`t === "${escaped}"`));
  }
});
