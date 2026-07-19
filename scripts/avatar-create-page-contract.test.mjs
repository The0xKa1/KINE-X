import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const createPageUrl = new URL("../src/components/pages/CreatePage.ts", import.meta.url);
const mainUrl = new URL("../src/main.ts", import.meta.url);

test("Create page delegates photo identities to the Avatar Vault without exposing the legacy upload flow", async () => {
  const source = await readFile(createPageUrl, "utf8");

  assert.match(source, /class="create-vault-cta"[^>]*href="#\/avatars"/);
  assert.match(source, /getSelectedAvatarId/,
    "video imports may still bind an existing reusable avatar identity");
  assert.doesNotMatch(source, /AvatarImportFlow|AvatarApplyPayload/);
  assert.doesNotMatch(source, /data-create-tab="avatar"|id="createAvatarGrid"/);
  assert.doesNotMatch(source, /id="avatar(?:File|Drop|Preview|Name|Submit|Enter|Progress|Status)/);
  assert.doesNotMatch(source, /onAvatarReady|onAvatarEnter/);
});

test("composition root has no reachable legacy avatar-job hydration or Create-page callbacks", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.doesNotMatch(source, /onAvatarReady|onAvatarEnter/);
  assert.doesNotMatch(source, /PersistedAvatarJob|hydrateAvatarJob/);
  assert.doesNotMatch(source, /avatarBinUrl/,
    "legacy /import/avatar job payloads must not be coupled to seed hydration");
});
