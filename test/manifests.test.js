import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Chrome and Firefox manifests must only differ where the browsers do:
// side panel vs sidebar, service worker vs background scripts, gecko settings.
const chrome = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const firefox = JSON.parse(readFileSync(new URL("../manifest.firefox.json", import.meta.url), "utf8"));

test("both manifests agree on name, version, commands, hosts and icons", () => {
  for (const k of ["manifest_version", "name", "version", "description", "commands", "host_permissions", "icons", "action"]) {
    assert.deepEqual(firefox[k], chrome[k], k);
  }
});

test("permissions match apart from Chrome's sidePanel", () => {
  assert.deepEqual(firefox.permissions, chrome.permissions.filter((p) => p !== "sidePanel"));
});

test("each manifest uses its own panel and background mechanism, on the same files", () => {
  assert.equal(chrome.side_panel.default_path, firefox.sidebar_action.default_panel);
  assert.deepEqual(firefox.background.scripts, [chrome.background.service_worker]);
  assert.equal(firefox.background.type, chrome.background.type);
  assert.ok(firefox.browser_specific_settings.gecko.id);
});
